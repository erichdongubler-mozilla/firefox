/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include <atomic>
#include <set>

#include "gtest/gtest.h"
#include "mozilla/SpinEventLoopUntil.h"
#include "mozilla/gtest/MozAssertions.h"
#include "LockstoreService.h"
#include "nsString.h"
#include "nsTArray.h"
#include "nsThreadUtils.h"

using namespace mozilla;
using namespace mozilla::security::lockstore;

namespace {

constexpr auto KEK_LOCAL = "lockstore::kek::local"_ns;
constexpr auto KEK_PP = "lockstore::kek::primary_password"_ns;

nsCString UniqueCollection(const char* aPrefix) {
  // Service-level state is a process-wide singleton bound to the test
  // profile, so we suffix every collection with a counter to keep tests
  // independent within the same binary run.
  static uint32_t sCounter = 0;
  nsCString out;
  out.AppendASCII(aPrefix);
  out.AppendLiteral("-");
  out.AppendInt(++sCounter);
  return out;
}

// Runs `aFn` on a background task and spins the main loop until it
// completes. Used to drive the off-main-thread sync `Do*` methods from
// gtest, which runs on the main thread.
template <typename Fn>
void RunOnBackground(Fn&& aFn) {
  std::atomic<bool> done{false};
  MOZ_ALWAYS_SUCCEEDS(NS_DispatchBackgroundTask(
      NS_NewRunnableFunction("TestLockstoreService::RunOnBackground",
                             [&done, fn = std::forward<Fn>(aFn)]() mutable {
                               fn();
                               done.store(true);
                             })));
  MOZ_ALWAYS_TRUE(SpinEventLoopUntil("RunOnBackground"_ns,
                                     [&done]() { return done.load(); }));
}

nsTArray<uint8_t> Bytes(const char* aLiteral) {
  nsTArray<uint8_t> out;
  out.AppendElements(reinterpret_cast<const uint8_t*>(aLiteral),
                     strlen(aLiteral));
  return out;
}

}  // namespace

class LockstoreServiceTest : public ::testing::Test {
 protected:
  void SetUp() override {
    mService = LockstoreService::GetSingleton();
    ASSERT_TRUE(mService)
    << "LockstoreService singleton must be obtainable";
  }

  RefPtr<LockstoreService> mService;
};

// ---------------------------------------------------------------------------
// Singleton / lifecycle
// ---------------------------------------------------------------------------

TEST_F(LockstoreServiceTest, SingletonIdentity) {
  RefPtr<LockstoreService> a = LockstoreService::GetSingleton();
  RefPtr<LockstoreService> b = LockstoreService::GetSingleton();
  EXPECT_EQ(a.get(), b.get()) << "GetSingleton must return the same instance";
}

// ---------------------------------------------------------------------------
// createDek / listCollections / deleteDek
// ---------------------------------------------------------------------------

TEST_F(LockstoreServiceTest, CreateAndDeleteDek) {
  nsCString coll = UniqueCollection("create-delete");

  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    auto collectionsResult = mService->DoListCollections();
    ASSERT_TRUE(collectionsResult.isOk());
    auto collections = collectionsResult.unwrap();
    bool found = false;
    for (const auto& c : collections) {
      if (c == coll) {
        found = true;
        break;
      }
    }
    EXPECT_TRUE(found) << "Created collection should appear in listCollections";

    EXPECT_NS_SUCCEEDED(mService->DoDeleteDek(coll));

    // Second call rejects since the DEK is gone.
    EXPECT_EQ(mService->DoDeleteDek(coll), NS_ERROR_NOT_AVAILABLE);
  });
}

TEST_F(LockstoreServiceTest, CreateDek_DuplicateRejects) {
  nsCString coll = UniqueCollection("dup");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    EXPECT_EQ(mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false),
              NS_ERROR_FAILURE)
        << "createDek on an existing collection must reject";

    mService->DoDeleteDek(coll);
  });
}

TEST_F(LockstoreServiceTest, CreateDek_RejectsEmptyCollection) {
  RunOnBackground([&]() {
    EXPECT_EQ(mService->DoCreateDek(""_ns, KEK_LOCAL, /*extractable=*/false),
              NS_ERROR_INVALID_ARG);
  });
}

TEST_F(LockstoreServiceTest, CreateDek_RejectsEmptyKekRef) {
  nsCString coll = UniqueCollection("empty-kek");
  RunOnBackground([&]() {
    EXPECT_EQ(mService->DoCreateDek(coll, ""_ns, /*extractable=*/false),
              NS_ERROR_INVALID_ARG);
  });
}

TEST_F(LockstoreServiceTest, DeleteDek_RejectsEmptyArg) {
  RunOnBackground(
      [&]() { EXPECT_EQ(mService->DoDeleteDek(""_ns), NS_ERROR_INVALID_ARG); });
}

TEST_F(LockstoreServiceTest, ListCollections_ContainsCreated) {
  // Create three uniquely-named collections; listCollections must
  // include all three. The list may also include collections from
  // unrelated tests, so we only assert subset, not equality.
  nsCString a = UniqueCollection("list-a");
  nsCString b = UniqueCollection("list-b");
  nsCString c = UniqueCollection("list-c");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(a, KEK_LOCAL, /*extractable=*/false));
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(b, KEK_LOCAL, /*extractable=*/false));
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(c, KEK_LOCAL, /*extractable=*/false));

    auto listResult = mService->DoListCollections();
    ASSERT_TRUE(listResult.isOk());
    auto list = listResult.unwrap();
    std::set<nsCString> names;
    for (const auto& n : list) {
      names.insert(n);
    }
    EXPECT_TRUE(names.count(a)) << "listCollections missing " << a.get();
    EXPECT_TRUE(names.count(b)) << "listCollections missing " << b.get();
    EXPECT_TRUE(names.count(c)) << "listCollections missing " << c.get();

    mService->DoDeleteDek(a);
    mService->DoDeleteDek(b);
    mService->DoDeleteDek(c);
  });
}

// ---------------------------------------------------------------------------
// listKeks
// ---------------------------------------------------------------------------

TEST_F(LockstoreServiceTest, ListKeks_ReflectsCreateDek) {
  nsCString coll = UniqueCollection("keks-create");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    auto refsResult = mService->DoListKeks(coll);
    ASSERT_TRUE(refsResult.isOk());
    auto refs = refsResult.unwrap();
    ASSERT_EQ(refs.Length(), 1u);
    EXPECT_EQ(refs[0], KEK_LOCAL);

    mService->DoDeleteDek(coll);
  });
}

TEST_F(LockstoreServiceTest, ListKeks_RejectsNoDek) {
  nsCString coll = UniqueCollection("keks-missing");
  RunOnBackground([&]() {
    auto refsResult = mService->DoListKeks(coll);
    EXPECT_TRUE(refsResult.isErr());
    EXPECT_EQ(refsResult.unwrapErr(), NS_ERROR_NOT_AVAILABLE);
  });
}

TEST_F(LockstoreServiceTest, ListKeks_RejectsEmptyCollection) {
  RunOnBackground([&]() {
    auto refsResult = mService->DoListKeks(""_ns);
    EXPECT_TRUE(refsResult.isErr());
    // Empty / unknown collection surfaces as NS_ERROR_NOT_AVAILABLE: the
    // keystore layer rejects the lookup with `NotFound`, which the FFI
    // maps via `error_to_nsresult`. The FFI no longer pre-rejects empty
    // strings at the boundary.
    EXPECT_EQ(refsResult.unwrapErr(), NS_ERROR_NOT_AVAILABLE);
  });
}

// ---------------------------------------------------------------------------
// encrypt / decrypt
// ---------------------------------------------------------------------------

TEST_F(LockstoreServiceTest, EncryptDecryptRoundtrip) {
  nsCString coll = UniqueCollection("roundtrip");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    auto ctResult = mService->DoEncrypt(coll, KEK_LOCAL, Bytes("hello world"));
    ASSERT_TRUE(ctResult.isOk());
    auto ciphertext = ctResult.unwrap();
    EXPECT_GT(ciphertext.Length(), 0u);

    auto ptResult = mService->DoDecrypt(coll, KEK_LOCAL, ciphertext);
    ASSERT_TRUE(ptResult.isOk());
    auto plaintext = ptResult.unwrap();
    nsCString joined;
    for (uint8_t b : plaintext) {
      joined.Append(static_cast<char>(b));
    }
    EXPECT_STREQ(joined.get(), "hello world");

    mService->DoDeleteDek(coll);
  });
}

TEST_F(LockstoreServiceTest, Encrypt_YieldsUniqueCiphertexts) {
  nsCString coll = UniqueCollection("nonce");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    auto a = mService->DoEncrypt(coll, KEK_LOCAL, Bytes("same"));
    auto b = mService->DoEncrypt(coll, KEK_LOCAL, Bytes("same"));
    ASSERT_TRUE(a.isOk());
    ASSERT_TRUE(b.isOk());
    auto ctA = a.unwrap();
    auto ctB = b.unwrap();
    EXPECT_NE(ctA, ctB) << "Repeated encrypts of the same plaintext must "
                           "yield distinct ciphertexts (random nonce)";

    mService->DoDeleteDek(coll);
  });
}

TEST_F(LockstoreServiceTest, Decrypt_CorruptedCiphertextRejects) {
  nsCString coll = UniqueCollection("corrupt");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    auto ctResult = mService->DoEncrypt(coll, KEK_LOCAL, Bytes("payload"));
    ASSERT_TRUE(ctResult.isOk());
    auto ct = ctResult.unwrap();
    // Flip a byte in the middle to corrupt the AEAD tag.
    if (ct.Length() > 0) {
      ct[ct.Length() / 2] ^= 0xff;
    }

    auto ptResult = mService->DoDecrypt(coll, KEK_LOCAL, ct);
    EXPECT_TRUE(ptResult.isErr());

    mService->DoDeleteDek(coll);
  });
}

TEST_F(LockstoreServiceTest, Decrypt_TruncatedCiphertextRejects) {
  nsCString coll = UniqueCollection("trunc");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    auto ctResult = mService->DoEncrypt(coll, KEK_LOCAL, Bytes("payload"));
    ASSERT_TRUE(ctResult.isOk());
    auto ct = ctResult.unwrap();
    if (ct.Length() > 8) {
      ct.SetLength(ct.Length() / 2);
    }

    auto ptResult = mService->DoDecrypt(coll, KEK_LOCAL, ct);
    EXPECT_TRUE(ptResult.isErr());

    mService->DoDeleteDek(coll);
  });
}

TEST_F(LockstoreServiceTest, Decrypt_WrongKekRejects) {
  nsCString coll = UniqueCollection("wrong-kek");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    auto ctResult = mService->DoEncrypt(coll, KEK_LOCAL, Bytes("payload"));
    ASSERT_TRUE(ctResult.isOk());
    auto ct = ctResult.unwrap();

    auto ptResult = mService->DoDecrypt(coll, KEK_PP, ct);
    EXPECT_TRUE(ptResult.isErr());

    mService->DoDeleteDek(coll);
  });
}

TEST_F(LockstoreServiceTest, Encrypt_NoDekRejects) {
  nsCString coll = UniqueCollection("no-dek");
  RunOnBackground([&]() {
    auto ctResult = mService->DoEncrypt(coll, KEK_LOCAL, Bytes("payload"));
    EXPECT_TRUE(ctResult.isErr());
  });
}

TEST_F(LockstoreServiceTest, Encrypt_RejectsEmptyArgs) {
  nsCString coll = UniqueCollection("empty-enc");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    EXPECT_TRUE(mService->DoEncrypt(""_ns, KEK_LOCAL, Bytes("x")).isErr());
    EXPECT_TRUE(mService->DoEncrypt(coll, ""_ns, Bytes("x")).isErr());

    mService->DoDeleteDek(coll);
  });
}

TEST_F(LockstoreServiceTest, Decrypt_NoDekRejects) {
  nsCString coll = UniqueCollection("no-dek-dec");
  RunOnBackground([&]() {
    nsTArray<uint8_t> bogus;
    bogus.AppendElements(static_cast<const uint8_t*>(
                             reinterpret_cast<const uint8_t*>("\0\0\0\0\0\0")),
                         6);
    auto ptResult = mService->DoDecrypt(coll, KEK_LOCAL, bogus);
    EXPECT_TRUE(ptResult.isErr());
  });
}

TEST_F(LockstoreServiceTest, Decrypt_RejectsEmptyArgs) {
  nsCString coll = UniqueCollection("empty-dec");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    auto ctResult = mService->DoEncrypt(coll, KEK_LOCAL, Bytes("x"));
    ASSERT_TRUE(ctResult.isOk());
    auto ct = ctResult.unwrap();

    EXPECT_TRUE(mService->DoDecrypt(""_ns, KEK_LOCAL, ct).isErr());
    EXPECT_TRUE(mService->DoDecrypt(coll, ""_ns, ct).isErr());

    mService->DoDeleteDek(coll);
  });
}

// ---------------------------------------------------------------------------
// addKek / removeKek
// ---------------------------------------------------------------------------

TEST_F(LockstoreServiceTest, AddKek_RejectsMissingCollection) {
  nsCString coll = UniqueCollection("addkek-missing");
  RunOnBackground([&]() {
    EXPECT_EQ(mService->DoAddKek(coll, KEK_LOCAL, KEK_PP),
              NS_ERROR_NOT_AVAILABLE);
  });
}

TEST_F(LockstoreServiceTest, AddKek_RejectsEmptyArgs) {
  nsCString coll = UniqueCollection("addkek-empty");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    EXPECT_EQ(mService->DoAddKek(""_ns, KEK_LOCAL, KEK_PP),
              NS_ERROR_INVALID_ARG);
    EXPECT_EQ(mService->DoAddKek(coll, ""_ns, KEK_PP), NS_ERROR_INVALID_ARG);
    EXPECT_EQ(mService->DoAddKek(coll, KEK_LOCAL, ""_ns), NS_ERROR_INVALID_ARG);

    mService->DoDeleteDek(coll);
  });
}

TEST_F(LockstoreServiceTest, RemoveKek_RejectsEmptyArgs) {
  nsCString coll = UniqueCollection("rmkek-empty");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    EXPECT_EQ(mService->DoRemoveKek(""_ns, KEK_LOCAL), NS_ERROR_INVALID_ARG);
    EXPECT_EQ(mService->DoRemoveKek(coll, ""_ns), NS_ERROR_INVALID_ARG);

    mService->DoDeleteDek(coll);
  });
}

TEST_F(LockstoreServiceTest, RemoveKek_LastWrappingRejects) {
  nsCString coll = UniqueCollection("rmkek-last");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));

    // Removing the last KEK wrapping must be rejected — otherwise the
    // DEK would become unrecoverable.
    EXPECT_EQ(mService->DoRemoveKek(coll, KEK_LOCAL), NS_ERROR_FAILURE);

    mService->DoDeleteDek(coll);
  });
}

// ---------------------------------------------------------------------------
// Threading: concurrent dispatches all complete with `mMutex`
// serialising under the hood.
// ---------------------------------------------------------------------------

TEST_F(LockstoreServiceTest, ConcurrentEncryptsAllResolveUnique) {
  // Dispatch N encrypts in parallel on independent background tasks.
  // The service's `mMutex` guarantees they execute one at a time;
  // each must produce a distinct ciphertext (random nonce).
  nsCString coll = UniqueCollection("concurrent");
  RunOnBackground([&]() {
    EXPECT_NS_SUCCEEDED(
        mService->DoCreateDek(coll, KEK_LOCAL, /*extractable=*/false));
  });

  constexpr size_t N = 8;
  nsTArray<nsTArray<uint8_t>> results;
  results.SetLength(N);
  std::atomic<size_t> doneCount{0};

  for (size_t i = 0; i < N; ++i) {
    MOZ_ALWAYS_SUCCEEDS(NS_DispatchBackgroundTask(NS_NewRunnableFunction(
        "ConcurrentEncryptsAllResolveUnique::worker",
        [this, &coll, &results, &doneCount, i]() {
          auto r = mService->DoEncrypt(coll, KEK_LOCAL, Bytes("same-input"));
          if (r.isOk()) {
            results[i] = r.unwrap();
          }
          ++doneCount;
        })));
  }
  MOZ_ALWAYS_TRUE(
      SpinEventLoopUntil("ConcurrentEncryptsAllResolveUnique"_ns,
                         [&doneCount]() { return doneCount.load() == N; }));

  std::set<nsCString> seen;
  for (const auto& ct : results) {
    EXPECT_GT(ct.Length(), 0u);
    nsCString joined;
    for (uint8_t b : ct) {
      joined.AppendInt(static_cast<uint32_t>(b));
      joined.AppendLiteral(",");
    }
    seen.insert(std::move(joined));
  }
  EXPECT_EQ(seen.size(), N)
      << "Every concurrent encrypt must produce a unique ciphertext";

  RunOnBackground([&]() { mService->DoDeleteDek(coll); });
}

TEST_F(LockstoreServiceTest, ConcurrentMixedOpsAllComplete) {
  // Mix createDek / encrypt-decrypt / deleteDek across multiple
  // collections concurrently. All ops must complete without deadlock,
  // and listCollections at the end must reflect the post-cleanup state.
  constexpr size_t N = 4;
  nsTArray<nsCString> colls;
  for (size_t i = 0; i < N; ++i) {
    colls.AppendElement(UniqueCollection("mix"));
  }

  // Concurrent creates.
  std::atomic<size_t> createDone{0};
  for (size_t i = 0; i < N; ++i) {
    const nsCString& c = colls[i];
    MOZ_ALWAYS_SUCCEEDS(NS_DispatchBackgroundTask(NS_NewRunnableFunction(
        "ConcurrentMixedOps::create", [this, &c, &createDone]() {
          EXPECT_NS_SUCCEEDED(
              mService->DoCreateDek(c, KEK_LOCAL, /*extractable=*/false));
          ++createDone;
        })));
  }
  MOZ_ALWAYS_TRUE(
      SpinEventLoopUntil("ConcurrentMixedOps::create-wait"_ns,
                         [&createDone]() { return createDone.load() == N; }));

  // Concurrent encrypt + decrypt round-trips per collection.
  std::atomic<size_t> roundtripDone{0};
  for (size_t i = 0; i < N; ++i) {
    const nsCString& c = colls[i];
    MOZ_ALWAYS_SUCCEEDS(NS_DispatchBackgroundTask(NS_NewRunnableFunction(
        "ConcurrentMixedOps::roundtrip", [this, &c, &roundtripDone]() {
          auto ctResult = mService->DoEncrypt(c, KEK_LOCAL, Bytes("payload"));
          EXPECT_TRUE(ctResult.isOk());
          if (ctResult.isOk()) {
            auto ct = ctResult.unwrap();
            EXPECT_GT(ct.Length(), 0u);
            auto ptResult = mService->DoDecrypt(c, KEK_LOCAL, ct);
            EXPECT_TRUE(ptResult.isOk());
            if (ptResult.isOk()) {
              EXPECT_EQ(ptResult.unwrap().Length(), strlen("payload"));
            }
          }
          ++roundtripDone;
        })));
  }
  MOZ_ALWAYS_TRUE(SpinEventLoopUntil(
      "ConcurrentMixedOps::roundtrip-wait"_ns,
      [&roundtripDone]() { return roundtripDone.load() == N; }));

  // Concurrent deletes.
  std::atomic<size_t> deleteDone{0};
  for (size_t i = 0; i < N; ++i) {
    const nsCString& c = colls[i];
    MOZ_ALWAYS_SUCCEEDS(NS_DispatchBackgroundTask(NS_NewRunnableFunction(
        "ConcurrentMixedOps::delete", [this, &c, &deleteDone]() {
          EXPECT_NS_SUCCEEDED(mService->DoDeleteDek(c));
          ++deleteDone;
        })));
  }
  MOZ_ALWAYS_TRUE(
      SpinEventLoopUntil("ConcurrentMixedOps::delete-wait"_ns,
                         [&deleteDone]() { return deleteDone.load() == N; }));

  // Verify listCollections no longer contains any of them.
  RunOnBackground([&]() {
    auto remainingResult = mService->DoListCollections();
    ASSERT_TRUE(remainingResult.isOk());
    auto remaining = remainingResult.unwrap();
    for (const auto& c : colls) {
      for (const auto& r : remaining) {
        EXPECT_NE(r, c) << "Collection " << c.get()
                        << " should be gone but is still listed";
      }
    }
  });
}
