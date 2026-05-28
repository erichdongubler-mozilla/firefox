/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "gtest/gtest.h"

#include "mozilla/gtest/MozAssertions.h"
#include "mozilla/security/lockstore/lockstore_ffi_generated.h"
#include "nsCOMPtr.h"
#include "nsDirectoryServiceDefs.h"
#include "nsIFile.h"
#include "nsString.h"
#include "nsTArray.h"

using mozilla::security::lockstore::KeystoreHandle;
using mozilla::security::lockstore::lockstore_keystore_add_kek;
using mozilla::security::lockstore::lockstore_keystore_close;
using mozilla::security::lockstore::lockstore_keystore_create_dek;
using mozilla::security::lockstore::lockstore_keystore_create_kek;
using mozilla::security::lockstore::lockstore_keystore_decrypt;
using mozilla::security::lockstore::lockstore_keystore_delete_dek;
using mozilla::security::lockstore::lockstore_keystore_encrypt;
using mozilla::security::lockstore::lockstore_keystore_get_dek;
using mozilla::security::lockstore::lockstore_keystore_import_dek;
using mozilla::security::lockstore::lockstore_keystore_is_dek_extractable;
using mozilla::security::lockstore::lockstore_keystore_is_kek_unlocked;
using mozilla::security::lockstore::lockstore_keystore_list_deks;
using mozilla::security::lockstore::lockstore_keystore_lock;
using mozilla::security::lockstore::lockstore_keystore_lock_kek;
using mozilla::security::lockstore::lockstore_keystore_open;
using mozilla::security::lockstore::lockstore_keystore_remove_kek;
using mozilla::security::lockstore::lockstore_keystore_switch_kek;
using mozilla::security::lockstore::lockstore_keystore_unlock_kek;

class LockstoreKeystoreTest : public ::testing::Test {
 protected:
  nsCOMPtr<nsIFile> mTmpDir;
  nsAutoCString mProfilePath;
  KeystoreHandle* mKeystore = nullptr;
  // Per-test LocalKey kek_ref. LocalKey is no longer a canonical
  // singleton: every test mints its own via createKek("local", ...)
  // and uses the returned random-ID kek_ref throughout.
  nsCString mLocalKekRef;

  void SetUp() override {
    nsresult rv =
        NS_GetSpecialDirectory(NS_OS_TEMP_DIR, getter_AddRefs(mTmpDir));
    ASSERT_NS_SUCCEEDED(rv);
    rv = mTmpDir->AppendNative("lockstore_ks_test"_ns);
    ASSERT_NS_SUCCEEDED(rv);
    rv = mTmpDir->CreateUnique(nsIFile::DIRECTORY_TYPE, 0700);
    ASSERT_NS_SUCCEEDED(rv);
    nsAutoString profilePathWide;
    rv = mTmpDir->GetPath(profilePathWide);
    ASSERT_NS_SUCCEEDED(rv);
    mProfilePath = NS_ConvertUTF16toUTF8(profilePathWide);
  }

  void TearDown() override {
    if (mKeystore) {
      EXPECT_NS_SUCCEEDED(lockstore_keystore_close(mKeystore));
      mKeystore = nullptr;
    }
    if (mTmpDir) {
      mTmpDir->Remove(true);
    }
  }

  // Mint a fresh LocalKey kek_ref against the already-open keystore
  // and store it in `mLocalKekRef`. Call this after a successful
  // `lockstore_keystore_open` whenever the test needs a usable
  // LocalKey to wrap a DEK under.
  void MintLocalKek() {
    const nsCString kekType("local"_ns);
    const nsCString empty;
    nsresult rv =
        lockstore_keystore_create_kek(mKeystore, &kekType, &empty,
                                      /* cache_timeout_ms */ 0, &mLocalKekRef);
    ASSERT_NS_SUCCEEDED(rv);
  }

  // Mint a fresh Password kek_ref against the already-open keystore.
  // The unlocked KEK is NOT cached on creation; callers must invoke
  // lockstore_keystore_unlock_kek before any DEK op against it.
  void MintPassword(const nsACString& aPassword, nsCString& aOut) {
    const nsCString kekType("password"_ns);
    nsresult rv =
        lockstore_keystore_create_kek(mKeystore, &kekType, &aPassword,
                                      /* cache_timeout_ms */ 0, &aOut);
    ASSERT_NS_SUCCEEDED(rv);
  }
};

TEST_F(LockstoreKeystoreTest, OpenAndClose) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();
  ASSERT_NE(mKeystore, nullptr);
  nsresult rvClose = lockstore_keystore_close(mKeystore);
  mKeystore = nullptr;
  ASSERT_NS_SUCCEEDED(rvClose);
}

TEST_F(LockstoreKeystoreTest, OpenEmptyPath) {
  nsAutoCString empty;
  nsresult rv = lockstore_keystore_open(&empty, &mKeystore);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
  ASSERT_EQ(mKeystore, nullptr);
}

TEST_F(LockstoreKeystoreTest, CreateAndListDek) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("mycoll");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  nsTArray<nsCString> collections;
  rv = lockstore_keystore_list_deks(mKeystore, &collections);
  ASSERT_NS_SUCCEEDED(rv);
  ASSERT_EQ(collections.Length(), 1u);
  EXPECT_EQ(collections[0], coll);
}

TEST_F(LockstoreKeystoreTest, CreateDekEmptyCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  nsAutoCString empty;
  rv = lockstore_keystore_create_dek(mKeystore, &empty, &mLocalKekRef, false);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, CreateDekDuplicate) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("dup");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_EQ(rv, NS_ERROR_FAILURE);
}

TEST_F(LockstoreKeystoreTest, GetDekExtractable) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("extract");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, true);
  ASSERT_NS_SUCCEEDED(rv);

  nsTArray<uint8_t> dek;
  rv = lockstore_keystore_get_dek(mKeystore, &coll, &mLocalKekRef, &dek);
  ASSERT_NS_SUCCEEDED(rv);
  EXPECT_GT(dek.Length(), 0u);
}

TEST_F(LockstoreKeystoreTest, GetDekEmptyCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  nsAutoCString empty;
  nsTArray<uint8_t> dek;
  rv = lockstore_keystore_get_dek(mKeystore, &empty, &mLocalKekRef, &dek);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, GetDekNonexistent) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("nosuch");
  nsTArray<uint8_t> dek;
  rv = lockstore_keystore_get_dek(mKeystore, &coll, &mLocalKekRef, &dek);
  ASSERT_EQ(rv, NS_ERROR_NOT_AVAILABLE);
}

TEST_F(LockstoreKeystoreTest, GetDekNotExtractable) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("noextract");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  nsTArray<uint8_t> dek;
  rv = lockstore_keystore_get_dek(mKeystore, &coll, &mLocalKekRef, &dek);
  ASSERT_EQ(rv, NS_ERROR_NOT_AVAILABLE);
}

TEST_F(LockstoreKeystoreTest, DeleteDek) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("todelete");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  rv = lockstore_keystore_delete_dek(mKeystore, &coll);
  ASSERT_NS_SUCCEEDED(rv);

  nsTArray<nsCString> collections;
  rv = lockstore_keystore_list_deks(mKeystore, &collections);
  ASSERT_NS_SUCCEEDED(rv);
  EXPECT_EQ(collections.Length(), 0u);
}

TEST_F(LockstoreKeystoreTest, DeleteDekEmptyCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  nsAutoCString empty;
  rv = lockstore_keystore_delete_dek(mKeystore, &empty);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, DeleteDekNonexistent) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("nosuch");
  rv = lockstore_keystore_delete_dek(mKeystore, &coll);
  ASSERT_EQ(rv, NS_ERROR_NOT_AVAILABLE);
}

TEST_F(LockstoreKeystoreTest, ListCollectionsEmpty) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  nsTArray<nsCString> collections;
  rv = lockstore_keystore_list_deks(mKeystore, &collections);
  ASSERT_NS_SUCCEEDED(rv);
  EXPECT_EQ(collections.Length(), 0u);
}

TEST_F(LockstoreKeystoreTest, ListMultipleCollections) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString alpha("alpha");
  const nsCString beta("beta");
  const nsCString gamma("gamma");
  rv = lockstore_keystore_create_dek(mKeystore, &alpha, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);
  rv = lockstore_keystore_create_dek(mKeystore, &beta, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);
  rv = lockstore_keystore_create_dek(mKeystore, &gamma, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  nsTArray<nsCString> collections;
  rv = lockstore_keystore_list_deks(mKeystore, &collections);
  ASSERT_NS_SUCCEEDED(rv);
  ASSERT_EQ(collections.Length(), 3u);
  EXPECT_TRUE(collections.Contains(alpha));
  EXPECT_TRUE(collections.Contains(beta));
  EXPECT_TRUE(collections.Contains(gamma));
}

TEST_F(LockstoreKeystoreTest, PersistenceAcrossReopen) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("persist");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  ASSERT_NS_SUCCEEDED(lockstore_keystore_close(mKeystore));
  mKeystore = nullptr;

  rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);

  nsTArray<nsCString> collections;
  rv = lockstore_keystore_list_deks(mKeystore, &collections);
  ASSERT_NS_SUCCEEDED(rv);
  ASSERT_EQ(collections.Length(), 1u);
  EXPECT_EQ(collections[0], coll);
}

TEST_F(LockstoreKeystoreTest, AddKekEmptyCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  nsAutoCString empty;
  rv = lockstore_keystore_add_kek(mKeystore, &empty, &mLocalKekRef,
                                  &mLocalKekRef);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, AddKekNonexistentCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("nosuch");
  rv = lockstore_keystore_add_kek(mKeystore, &coll, &mLocalKekRef,
                                  &mLocalKekRef);
  ASSERT_EQ(rv, NS_ERROR_NOT_AVAILABLE);
}

TEST_F(LockstoreKeystoreTest, AddKekDuplicate) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("adddup");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  rv = lockstore_keystore_add_kek(mKeystore, &coll, &mLocalKekRef,
                                  &mLocalKekRef);
  ASSERT_EQ(rv, NS_ERROR_FAILURE);
}

TEST_F(LockstoreKeystoreTest, RemoveKekEmptyCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  nsAutoCString empty;
  rv = lockstore_keystore_remove_kek(mKeystore, &empty, &mLocalKekRef);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, RemoveKekNonexistentCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("nosuch");
  rv = lockstore_keystore_remove_kek(mKeystore, &coll, &mLocalKekRef);
  ASSERT_EQ(rv, NS_ERROR_NOT_AVAILABLE);
}

TEST_F(LockstoreKeystoreTest, RemoveKekLastRemaining) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("removelast");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  rv = lockstore_keystore_remove_kek(mKeystore, &coll, &mLocalKekRef);
  ASSERT_EQ(rv, NS_ERROR_FAILURE);
}

TEST_F(LockstoreKeystoreTest, EncryptDecryptRoundtrip) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("crypto");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  const uint8_t plaintext[] = {'h', 'e', 'l', 'l', 'o'};
  nsTArray<uint8_t> ciphertext;
  rv = lockstore_keystore_encrypt(mKeystore, &coll, &mLocalKekRef, plaintext,
                                  sizeof(plaintext), &ciphertext);
  ASSERT_NS_SUCCEEDED(rv);
  ASSERT_GT(ciphertext.Length(), sizeof(plaintext));

  nsTArray<uint8_t> round;
  rv = lockstore_keystore_decrypt(mKeystore, &coll, &mLocalKekRef,
                                  ciphertext.Elements(), ciphertext.Length(),
                                  &round);
  ASSERT_NS_SUCCEEDED(rv);
  ASSERT_EQ(round.Length(), sizeof(plaintext));
  EXPECT_EQ(memcmp(round.Elements(), plaintext, sizeof(plaintext)), 0);
}

TEST_F(LockstoreKeystoreTest, EncryptEmptyCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  nsAutoCString empty;
  const uint8_t plaintext[] = {'x'};
  nsTArray<uint8_t> ciphertext;
  rv = lockstore_keystore_encrypt(mKeystore, &empty, &mLocalKekRef, plaintext,
                                  sizeof(plaintext), &ciphertext);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, EncryptUnknownCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("nosuch");
  const uint8_t plaintext[] = {'x'};
  nsTArray<uint8_t> ciphertext;
  rv = lockstore_keystore_encrypt(mKeystore, &coll, &mLocalKekRef, plaintext,
                                  sizeof(plaintext), &ciphertext);
  ASSERT_EQ(rv, NS_ERROR_NOT_AVAILABLE);
}

TEST_F(LockstoreKeystoreTest, DecryptEmptyCiphertext) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("decempty");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  nsTArray<uint8_t> plaintext;
  rv = lockstore_keystore_decrypt(mKeystore, &coll, &mLocalKekRef, nullptr, 0,
                                  &plaintext);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, IsKekUnlockedLocalAlwaysTrue) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  // LocalKey has no interactive gate, so it's always reported unlocked.
  bool unlocked = false;
  rv = lockstore_keystore_is_kek_unlocked(mKeystore, &mLocalKekRef, &unlocked);
  ASSERT_NS_SUCCEEDED(rv);
  EXPECT_TRUE(unlocked);
}

TEST_F(LockstoreKeystoreTest, IsKekUnlockedPasswordInitiallyFalse) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);

  // A freshly-minted Password kek_ref starts locked: createKek persists
  // the wrapped KEK but does not populate the unlock cache.
  nsCString pwKekRef;
  MintPassword("hunter2"_ns, pwKekRef);
  bool unlocked = true;
  rv = lockstore_keystore_is_kek_unlocked(mKeystore, &pwKekRef, &unlocked);
  ASSERT_NS_SUCCEEDED(rv);
  EXPECT_FALSE(unlocked);
}

TEST_F(LockstoreKeystoreTest, LockKekEmptyRef) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  nsAutoCString empty;
  rv = lockstore_keystore_lock_kek(mKeystore, &empty);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, LockKekLocalIsNoop) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  // LocalKey lock/unlock never fail; they're no-ops.
  rv = lockstore_keystore_lock_kek(mKeystore, &mLocalKekRef);
  ASSERT_NS_SUCCEEDED(rv);
}

TEST_F(LockstoreKeystoreTest, UnlockKekPasswordUnknownRefFails) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);

  // A `password:` kek_ref that has no persisted record surfaces
  // InvalidKekRef → NS_ERROR_INVALID_ARG when callers try to unlock it.
  const nsCString bogusPw("lockstore::kek::password:not-a-real-id"_ns);
  const nsCString pw("pw"_ns);
  rv = lockstore_keystore_unlock_kek(mKeystore, &bogusPw, &pw,
                                     /* timeoutMs */ 60000);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, UnlockKekUnknownRefFails) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString bogus("lockstore::kek::bogus"_ns);
  const nsCString pw("pw"_ns);
  rv = lockstore_keystore_unlock_kek(mKeystore, &bogus, &pw,
                                     /* timeoutMs */ 60000);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, GetDekForPasswordWhenLockedFails) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);

  // Freshly-minted Password kek_ref starts locked. Creating a DEK
  // under it must fail with NS_ERROR_NOT_AVAILABLE (Locked) until the
  // caller invokes unlock_kek.
  nsCString pwKekRef;
  MintPassword("hunter2"_ns, pwKekRef);
  const nsCString coll("pwlocked");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &pwKekRef, false);
  ASSERT_EQ(rv, NS_ERROR_NOT_AVAILABLE);
}

TEST_F(LockstoreKeystoreTest, LockAllIsNoopWhenNothingCached) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  // `lock()` clears every cached KEK. With nothing cached it must still
  // succeed (callers on shutdown shouldn't have to check first).
  rv = lockstore_keystore_lock(mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
}

TEST_F(LockstoreKeystoreTest, ImportDekRoundtripExtractable) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("imported");
  uint8_t dek[32];
  for (size_t i = 0; i < sizeof(dek); ++i) {
    dek[i] = static_cast<uint8_t>(i + 1);
  }
  rv = lockstore_keystore_import_dek(mKeystore, &coll, &mLocalKekRef, dek,
                                     sizeof(dek), true);
  ASSERT_NS_SUCCEEDED(rv);

  nsTArray<uint8_t> round;
  rv = lockstore_keystore_get_dek(mKeystore, &coll, &mLocalKekRef, &round);
  ASSERT_NS_SUCCEEDED(rv);
  ASSERT_EQ(round.Length(), sizeof(dek));
  for (size_t i = 0; i < sizeof(dek); ++i) {
    EXPECT_EQ(round[i], dek[i]);
  }
}

TEST_F(LockstoreKeystoreTest, ImportDekWrongLength) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("badlen");
  uint8_t shortDek[16] = {0};
  rv = lockstore_keystore_import_dek(mKeystore, &coll, &mLocalKekRef, shortDek,
                                     sizeof(shortDek), true);
  ASSERT_EQ(rv, NS_ERROR_FAILURE);
}

TEST_F(LockstoreKeystoreTest, ImportDekEmptyCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  nsAutoCString empty;
  uint8_t dek[32] = {0};
  rv = lockstore_keystore_import_dek(mKeystore, &empty, &mLocalKekRef, dek,
                                     sizeof(dek), true);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, ImportDekDuplicate) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("dup");
  uint8_t dek[32] = {0};
  rv = lockstore_keystore_import_dek(mKeystore, &coll, &mLocalKekRef, dek,
                                     sizeof(dek), true);
  ASSERT_NS_SUCCEEDED(rv);

  rv = lockstore_keystore_import_dek(mKeystore, &coll, &mLocalKekRef, dek,
                                     sizeof(dek), true);
  ASSERT_EQ(rv, NS_ERROR_FAILURE);
}

TEST_F(LockstoreKeystoreTest, IsDekExtractableTrue) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("extract-yes");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, true);
  ASSERT_NS_SUCCEEDED(rv);

  bool extractable = false;
  rv = lockstore_keystore_is_dek_extractable(mKeystore, &coll, &extractable);
  ASSERT_NS_SUCCEEDED(rv);
  EXPECT_TRUE(extractable);
}

TEST_F(LockstoreKeystoreTest, IsDekExtractableFalse) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("extract-no");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  bool extractable = true;
  rv = lockstore_keystore_is_dek_extractable(mKeystore, &coll, &extractable);
  ASSERT_NS_SUCCEEDED(rv);
  EXPECT_FALSE(extractable);
}

TEST_F(LockstoreKeystoreTest, IsDekExtractableMissingCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("nope");
  bool extractable = false;
  rv = lockstore_keystore_is_dek_extractable(mKeystore, &coll, &extractable);
  ASSERT_EQ(rv, NS_ERROR_NOT_AVAILABLE);
}

TEST_F(LockstoreKeystoreTest, IsDekExtractableEmptyCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  nsAutoCString empty;
  bool extractable = false;
  rv = lockstore_keystore_is_dek_extractable(mKeystore, &empty, &extractable);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, SwitchKekEmptyArgs) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  nsAutoCString empty;
  const nsCString coll("col");
  rv = lockstore_keystore_switch_kek(mKeystore, &empty, &mLocalKekRef,
                                     &mLocalKekRef);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
  rv = lockstore_keystore_switch_kek(mKeystore, &coll, &empty, &mLocalKekRef);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
  rv = lockstore_keystore_switch_kek(mKeystore, &coll, &mLocalKekRef, &empty);
  ASSERT_EQ(rv, NS_ERROR_INVALID_ARG);
}

TEST_F(LockstoreKeystoreTest, SwitchKekSameRefRejected) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  const nsCString coll("col");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  rv = lockstore_keystore_switch_kek(mKeystore, &coll, &mLocalKekRef,
                                     &mLocalKekRef);
  // old == new is InvalidConfiguration → NS_ERROR_FAILURE per the FFI mapping.
  ASSERT_EQ(rv, NS_ERROR_FAILURE);
}

TEST_F(LockstoreKeystoreTest, SwitchKekNonexistentCollection) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  // Switching against a collection that doesn't exist must reject
  // before the kek_ref types are even consulted.
  const nsCString coll("nope");
  nsCString otherLocal;
  {
    const nsCString kekType("local"_ns);
    const nsCString empty;
    rv = lockstore_keystore_create_kek(mKeystore, &kekType, &empty, 0,
                                       &otherLocal);
    ASSERT_NS_SUCCEEDED(rv);
  }
  rv = lockstore_keystore_switch_kek(mKeystore, &coll, &mLocalKekRef,
                                     &otherLocal);
  ASSERT_EQ(rv, NS_ERROR_NOT_AVAILABLE);
}

TEST_F(LockstoreKeystoreTest, SwitchKekMissingOldWrapping) {
  nsresult rv = lockstore_keystore_open(&mProfilePath, &mKeystore);
  ASSERT_NS_SUCCEEDED(rv);
  MintLocalKek();

  // Collection wrapped only under LocalKey; "switch from <another Local>"
  // must reject because that other ref doesn't currently wrap this
  // collection.
  const nsCString coll("local-only");
  rv = lockstore_keystore_create_dek(mKeystore, &coll, &mLocalKekRef, false);
  ASSERT_NS_SUCCEEDED(rv);

  nsCString otherLocal;
  {
    const nsCString kekType("local"_ns);
    const nsCString empty;
    rv = lockstore_keystore_create_kek(mKeystore, &kekType, &empty, 0,
                                       &otherLocal);
    ASSERT_NS_SUCCEEDED(rv);
  }
  rv = lockstore_keystore_switch_kek(mKeystore, &coll, &otherLocal,
                                     &mLocalKekRef);
  ASSERT_EQ(rv, NS_ERROR_NOT_AVAILABLE);
}
