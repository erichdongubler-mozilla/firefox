/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const KEK_LOCAL = "lockstore::kek::local";
const KEK_PP = "lockstore::kek::primary_password";
const PW = "correct horse battery staple";
const PW2 = "rotated_password_42";
const PW_WRONG = "Tr0ub4dor&3";

function getService() {
  return Cc["@mozilla.org/security/lockstore;1"].getService(Ci.nsILockstore);
}

function bytes(input) {
  return new TextEncoder().encode(input);
}

function str(arr) {
  return new TextDecoder().decode(new Uint8Array(arr));
}

// `NS_ERROR_INVALID_ARG` and `NS_ERROR_ILLEGAL_VALUE` are the same
// underlying code (0x80070057); the JS error message uses the latter.
const INVALID_ARG_RE = /NS_ERROR_(INVALID_ARG|ILLEGAL_VALUE)/;

add_setup(async function () {
  do_get_profile();
});

// ---------------------------------------------------------------------------
// Service surface
// ---------------------------------------------------------------------------

add_task(function test_service_accessible() {
  const ls = getService();
  Assert.ok(ls, "nsILockstore service must be obtainable");
  Assert.ok(!ls.hasPrimaryPassword, "fresh profile has no primary password");
  Assert.ok(!ls.isKekUnlocked(KEK_PP), "fresh profile has no unlocked cache");
});

// ---------------------------------------------------------------------------
// LocalKey: createDek / encrypt / decrypt happy paths and invariants
// ---------------------------------------------------------------------------

add_task(async function test_local_key_encrypt_decrypt_roundtrip() {
  const ls = getService();
  await ls.createDek("rt", KEK_LOCAL, false);

  const plaintext = bytes("hello, lockstore");
  const ct = await ls.encrypt("rt", KEK_LOCAL, plaintext);
  Assert.greater(
    ct.length,
    plaintext.length,
    "ciphertext longer than plaintext"
  );

  const round = await ls.decrypt("rt", KEK_LOCAL, ct);
  Assert.equal(str(round), "hello, lockstore", "roundtrip equal");
});

add_task(async function test_create_dek_duplicate_rejects() {
  const ls = getService();
  // "rt" already exists from the previous task; recreating must fail.
  await Assert.rejects(
    ls.createDek("rt", KEK_LOCAL, false),
    /NS_ERROR_FAILURE/,
    "createDek on an existing collection rejects"
  );
});

add_task(async function test_create_dek_empty_args_rejected() {
  const ls = getService();
  await Assert.rejects(
    ls.createDek("", KEK_LOCAL, false),
    INVALID_ARG_RE,
    "createDek with empty collection rejects"
  );
  await Assert.rejects(
    ls.createDek("col", "", false),
    INVALID_ARG_RE,
    "createDek with empty kekRef rejects"
  );
});

add_task(async function test_encrypt_yields_unique_ciphertexts() {
  const ls = getService();
  // Same plaintext, same DEK, two encrypt calls — outputs MUST differ.
  // The cipher uses a random nonce; identical ciphertexts would be a
  // catastrophic invariant violation.
  const pt = bytes("repeatable input");
  const a = await ls.encrypt("rt", KEK_LOCAL, pt);
  const b = await ls.encrypt("rt", KEK_LOCAL, pt);
  Assert.equal(a.length, b.length, "same plaintext → same ciphertext length");
  let differs = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      differs = true;
      break;
    }
  }
  Assert.ok(differs, "two encryptions of the same plaintext must differ");
  // Both round-trip to the same plaintext.
  Assert.equal(str(await ls.decrypt("rt", KEK_LOCAL, a)), "repeatable input");
  Assert.equal(str(await ls.decrypt("rt", KEK_LOCAL, b)), "repeatable input");
});

add_task(async function test_encrypt_empty_args_rejected() {
  const ls = getService();
  await Assert.rejects(
    ls.encrypt("", KEK_LOCAL, bytes("x")),
    INVALID_ARG_RE,
    "encrypt with empty collection rejects"
  );
  await Assert.rejects(
    ls.encrypt("rt", "", bytes("x")),
    INVALID_ARG_RE,
    "encrypt with empty kekRef rejects"
  );
});

add_task(async function test_encrypt_no_dek_rejected() {
  const ls = getService();
  await Assert.rejects(
    ls.encrypt("never-created", KEK_LOCAL, bytes("x")),
    /NS_ERROR_NOT_AVAILABLE/,
    "encrypt against a collection without a DEK rejects"
  );
});

add_task(async function test_decrypt_empty_args_rejected() {
  const ls = getService();
  const ct = await ls.encrypt("rt", KEK_LOCAL, bytes("x"));
  await Assert.rejects(
    ls.decrypt("", KEK_LOCAL, ct),
    INVALID_ARG_RE,
    "decrypt with empty collection rejects"
  );
  await Assert.rejects(
    ls.decrypt("rt", "", ct),
    INVALID_ARG_RE,
    "decrypt with empty kekRef rejects"
  );
  await Assert.rejects(
    ls.decrypt("rt", KEK_LOCAL, []),
    INVALID_ARG_RE,
    "decrypt of empty ciphertext rejects"
  );
});

add_task(async function test_decrypt_no_dek_rejected() {
  const ls = getService();
  // Build a syntactically plausible ciphertext (>0 bytes) under a
  // collection that doesn't exist; FFI must reject NotAvailable.
  await Assert.rejects(
    ls.decrypt("never-created", KEK_LOCAL, [1, 2, 3, 4, 5, 6, 7, 8, 9]),
    /NS_ERROR_NOT_AVAILABLE/,
    "decrypt against a collection without a DEK rejects"
  );
});

add_task(async function test_decrypt_corrupted_ciphertext_rejects() {
  const ls = getService();
  const ct = await ls.encrypt("rt", KEK_LOCAL, bytes("tamper-me"));
  // Flip a bit somewhere inside the AEAD-protected region (skip the
  // cipher-suite tag at index 0 to avoid the early-out that triggers
  // INVALID_ARG instead of an AEAD failure).
  const tampered = new Uint8Array(ct);
  tampered[Math.floor(tampered.length / 2)] ^= 0x01;
  await Assert.rejects(
    ls.decrypt("rt", KEK_LOCAL, Array.from(tampered)),
    /NS_ERROR_/,
    "tampering with ciphertext bytes must reject"
  );
});

add_task(async function test_decrypt_truncated_ciphertext_rejects() {
  const ls = getService();
  const ct = await ls.encrypt("rt", KEK_LOCAL, bytes("truncate-me"));
  // Drop the trailing AEAD tag → decryption must reject.
  const truncated = ct.slice(0, ct.length - 4);
  await Assert.rejects(
    ls.decrypt("rt", KEK_LOCAL, Array.from(truncated)),
    /NS_ERROR_/,
    "truncated ciphertext must reject"
  );
});

add_task(async function test_decrypt_with_wrong_kek_rejects() {
  const ls = getService();
  // Create a collection wrapped only under KEK_LOCAL.
  await ls.createDek("local-only", KEK_LOCAL, false);
  const ct = await ls.encrypt("local-only", KEK_LOCAL, bytes("wrong-kek"));
  // Decrypting under a KEK that doesn't wrap this DEK must reject. PP
  // is not unlocked here either, but the failure mode we care about is
  // "this KEK doesn't wrap this collection".
  await Assert.rejects(
    ls.decrypt("local-only", KEK_PP, ct),
    /NS_ERROR_NOT_AVAILABLE/,
    "decrypt under a KEK that does not wrap the collection rejects"
  );
  // Cleanup so listCollections in later tests stays bounded.
  await ls.deleteDek("local-only");
});

// ---------------------------------------------------------------------------
// listCollections / deleteDek
// ---------------------------------------------------------------------------

add_task(async function test_list_collections_and_delete() {
  const ls = getService();
  await ls.createDek("one", KEK_LOCAL, false);
  await ls.createDek("two", KEK_LOCAL, false);
  const before = await ls.listCollections();
  Assert.ok(before.includes("one"));
  Assert.ok(before.includes("two"));

  await ls.deleteDek("one");
  const after = await ls.listCollections();
  Assert.ok(!after.includes("one"), "deleted collection disappears");
  Assert.ok(after.includes("two"), "other collection remains");

  // Second delete rejects with NotAvailable.
  await Assert.rejects(
    ls.deleteDek("one"),
    /NS_ERROR_NOT_AVAILABLE/,
    "second deleteDek rejects"
  );
  await Assert.rejects(
    ls.deleteDek("never-existed"),
    /NS_ERROR_NOT_AVAILABLE/,
    "deleteDek on missing collection rejects"
  );
});

add_task(async function test_delete_dek_empty_arg_rejected() {
  const ls = getService();
  await Assert.rejects(
    ls.deleteDek(""),
    INVALID_ARG_RE,
    "deleteDek with empty arg rejects"
  );
});

add_task(async function test_listKeks_round_trip() {
  const ls = getService();
  await ls.createDek("keks-rt", KEK_LOCAL, false);

  let refs = await ls.listKeks("keks-rt");
  Assert.deepEqual(
    refs,
    [KEK_LOCAL],
    "listKeks reports only KEK_LOCAL after createDek"
  );

  // addKek under PrimaryPassword would require PP setup; use the local
  // KEK twice as a no-op self-test would fail. Instead, exercise the
  // unknown-collection rejection path here and the addKek/removeKek
  // listing changes are pinned in the gtest where we can use the
  // synthetic test KEK level. In production the round-trip is exercised
  // end-to-end via lockstore-SDR's PP upgrade.
  await Assert.rejects(
    ls.listKeks("never-created"),
    /NS_ERROR_NOT_AVAILABLE/,
    "listKeks against an unknown collection rejects NotAvailable"
  );
  await Assert.rejects(
    ls.listKeks(""),
    /NS_ERROR_NOT_AVAILABLE/,
    "listKeks with empty arg rejects with NotAvailable (collection lookup fails)"
  );

  await ls.deleteDek("keks-rt");
});

add_task(async function test_delete_dek_nonexistent_rejects() {
  const ls = getService();
  await Assert.rejects(
    ls.deleteDek("never-existed-coll"),
    /NS_ERROR_NOT_AVAILABLE/,
    "deleteDek on a missing collection rejects"
  );
});

add_task(async function test_delete_dek_succeeds() {
  const ls = getService();
  await ls.createDek("safe-delete", KEK_LOCAL, false);
  await ls.deleteDek("safe-delete");
  await Assert.rejects(
    ls.encrypt("safe-delete", KEK_LOCAL, bytes("nope")),
    /NS_ERROR_NOT_AVAILABLE/,
    "DEK is gone after deleteDek"
  );
});

add_task(async function test_delete_dek_nonexistent_rejects() {
  const ls = getService();
  await Assert.rejects(
    ls.deleteDek("never-existed-coll-2"),
    /NS_ERROR_NOT_AVAILABLE/,
    "deleteDek on a missing collection rejects"
  );
});

add_task(async function test_delete_dek_empty_arg_rejected() {
  const ls = getService();
  await Assert.rejects(
    ls.deleteDek(""),
    INVALID_ARG_RE,
    "deleteDek with empty arg rejects"
  );
});

// ---------------------------------------------------------------------------
// PrimaryPassword lifecycle
// ---------------------------------------------------------------------------

add_task(async function test_primary_password_lifecycle() {
  const ls = getService();

  // NOTE: 800,000 PBKDF2 iterations per call. Expect ~0.5-1s per op on
  // modern hardware; this test runs a handful of them off the main
  // thread.
  await ls.setPrimaryPassword("", PW);
  Assert.ok(ls.hasPrimaryPassword, "primary password now set");
  Assert.ok(!ls.isKekUnlocked(KEK_PP), "still locked after set");

  // Wrong password rejected.
  await Assert.rejects(
    ls.unlockKek(KEK_PP, PW_WRONG, 60000),
    /NS_ERROR_ABORT/,
    "wrong password rejected"
  );
  Assert.ok(
    !ls.isKekUnlocked(KEK_PP),
    "wrong password does not populate cache"
  );

  await ls.unlockKek(KEK_PP, PW, 60000);
  Assert.ok(ls.isKekUnlocked(KEK_PP), "correct password unlocks");

  // Encrypt/decrypt under PrimaryPassword while unlocked.
  await ls.createDek("pp-col", KEK_PP, false);
  const ct = await ls.encrypt("pp-col", KEK_PP, bytes("secret"));
  const round = await ls.decrypt("pp-col", KEK_PP, ct);
  Assert.equal(str(round), "secret", "PP roundtrip while unlocked");

  // Locking invalidates the cache; subsequent encrypt rejects.
  await ls.lockKek(KEK_PP);
  Assert.ok(!ls.isKekUnlocked(KEK_PP));
  await Assert.rejects(
    ls.encrypt("pp-col", KEK_PP, bytes("nope")),
    /NS_ERROR_NOT_AVAILABLE/,
    "encrypt under locked PP rejects with Locked"
  );
});

add_task(
  async function test_set_primary_password_when_set_with_empty_old_rejected() {
    const ls = getService();
    Assert.ok(ls.hasPrimaryPassword, "PP set from previous task");
    // Empty `oldPassword` is treated as "initialise from scratch" by the
    // FFI; when PP is already set this fails with InvalidConfiguration
    // (NS_ERROR_FAILURE), not WrongPassword (NS_ERROR_ABORT).
    await Assert.rejects(
      ls.setPrimaryPassword("", "different"),
      /NS_ERROR_FAILURE/,
      "setPrimaryPassword('', ...) when PP is set rejects as init-on-initialised"
    );
    Assert.ok(ls.hasPrimaryPassword, "PP unchanged after rejected set");
  }
);

add_task(
  async function test_set_primary_password_change_with_wrong_old_rejected() {
    const ls = getService();
    await Assert.rejects(
      ls.setPrimaryPassword(PW_WRONG, PW2),
      /NS_ERROR_ABORT/,
      "setPrimaryPassword with wrong oldPassword rejects"
    );
    Assert.ok(ls.hasPrimaryPassword, "PP unchanged after rejected change");
  }
);

add_task(async function test_change_primary_password_lifecycle() {
  const ls = getService();
  // PW → PW2.
  await ls.setPrimaryPassword(PW, PW2);
  Assert.ok(ls.hasPrimaryPassword, "PP still set after change");
  Assert.ok(!ls.isKekUnlocked(KEK_PP), "change clears any cached KEK");

  // Old PW no longer works.
  await Assert.rejects(
    ls.unlockKek(KEK_PP, PW, 60000),
    /NS_ERROR_ABORT/,
    "old password no longer unlocks after change"
  );

  // New PW works.
  await ls.unlockKek(KEK_PP, PW2, 60000);
  Assert.ok(ls.isKekUnlocked(KEK_PP), "new password unlocks");

  // Restore PW so subsequent tasks (which assume PW) keep working.
  await ls.lockKek(KEK_PP);
  await ls.setPrimaryPassword(PW2, PW);
  await ls.unlockKek(KEK_PP, PW, 60000);
  Assert.ok(ls.isKekUnlocked(KEK_PP), "PP restored to PW");
});

// ---------------------------------------------------------------------------
// addKek / removeKek
// ---------------------------------------------------------------------------

add_task(async function test_add_remove_kek() {
  const ls = getService();
  // Already unlocked from prior task; re-unlock defensively.
  if (!ls.isKekUnlocked(KEK_PP)) {
    await ls.unlockKek(KEK_PP, PW, 60000);
  }

  await ls.createDek("multi", KEK_LOCAL, true);
  await ls.addKek("multi", KEK_LOCAL, KEK_PP);

  const ct = await ls.encrypt("multi", KEK_LOCAL, bytes("shared DEK"));
  const round = await ls.decrypt("multi", KEK_PP, ct);
  Assert.equal(str(round), "shared DEK", "same DEK decrypts via either KEK");

  await ls.removeKek("multi", KEK_PP);
  await Assert.rejects(
    ls.encrypt("multi", KEK_PP, bytes("nope")),
    /NS_ERROR_NOT_AVAILABLE/,
    "removed KEK is gone"
  );
});

add_task(async function test_remove_last_kek_rejected() {
  const ls = getService();
  // "multi" is now wrapped only under KEK_LOCAL (PP wrapping was
  // removed in the previous task). Removing the last wrapping must
  // fail to avoid silently orphaning the DEK.
  await Assert.rejects(
    ls.removeKek("multi", KEK_LOCAL),
    /NS_ERROR_/,
    "removing the last remaining wrapping must reject"
  );
  // Sanity: collection still usable.
  const ct = await ls.encrypt("multi", KEK_LOCAL, bytes("still here"));
  Assert.equal(
    str(await ls.decrypt("multi", KEK_LOCAL, ct)),
    "still here",
    "DEK unchanged after rejected remove"
  );
});

add_task(async function test_remove_kek_not_present_rejects() {
  const ls = getService();
  // KEK_PP doesn't wrap "multi" anymore; removing a non-present
  // wrapping must reject (vs. silently no-op).
  await Assert.rejects(
    ls.removeKek("multi", KEK_PP),
    /NS_ERROR_/,
    "removeKek of a kekRef that is not currently wrapping rejects"
  );
});

add_task(async function test_add_kek_missing_collection_rejects() {
  const ls = getService();
  if (!ls.isKekUnlocked(KEK_PP)) {
    await ls.unlockKek(KEK_PP, PW, 60000);
  }
  await Assert.rejects(
    ls.addKek("never-created-coll", KEK_LOCAL, KEK_PP),
    /NS_ERROR_NOT_AVAILABLE/,
    "addKek against a collection without a DEK rejects"
  );
});

add_task(async function test_add_kek_empty_args_rejected() {
  const ls = getService();
  await Assert.rejects(
    ls.addKek("", KEK_LOCAL, KEK_PP),
    INVALID_ARG_RE,
    "addKek with empty collection rejects"
  );
  await Assert.rejects(
    ls.addKek("multi", "", KEK_PP),
    INVALID_ARG_RE,
    "addKek with empty fromKekRef rejects"
  );
  await Assert.rejects(
    ls.addKek("multi", KEK_LOCAL, ""),
    INVALID_ARG_RE,
    "addKek with empty toKekRef rejects"
  );
});

add_task(async function test_remove_kek_empty_args_rejected() {
  const ls = getService();
  await Assert.rejects(
    ls.removeKek("", KEK_LOCAL),
    INVALID_ARG_RE,
    "removeKek with empty collection rejects"
  );
  await Assert.rejects(
    ls.removeKek("multi", ""),
    INVALID_ARG_RE,
    "removeKek with empty kekRef rejects"
  );
});

// ---------------------------------------------------------------------------
// Sync-tier behaviour
// ---------------------------------------------------------------------------

add_task(async function test_local_key_is_always_unlocked() {
  const ls = getService();
  Assert.ok(ls.isKekUnlocked(KEK_LOCAL), "LocalKey always unlocked");
  await ls.lockKek(KEK_LOCAL); // no-op
  Assert.ok(ls.isKekUnlocked(KEK_LOCAL), "LocalKey still unlocked after lock");
  await ls.unlockKek(KEK_LOCAL, "", 60000); // no-op
  Assert.ok(ls.isKekUnlocked(KEK_LOCAL));
});

add_task(async function test_lock_all() {
  const ls = getService();
  if (!ls.isKekUnlocked(KEK_PP)) {
    await ls.unlockKek(KEK_PP, PW, 60000);
  }
  Assert.ok(ls.isKekUnlocked(KEK_PP), "PP unlocked before lock()");
  await ls.lock();
  Assert.ok(!ls.isKekUnlocked(KEK_PP), "PP locked after lock()");
  Assert.ok(ls.isKekUnlocked(KEK_LOCAL), "LocalKey unaffected by lock()");
});

// ---------------------------------------------------------------------------
// Argument validation on the unified KEK API
// ---------------------------------------------------------------------------

add_task(async function test_unknown_kek_ref_rejected() {
  const ls = getService();
  const BOGUS = "lockstore::kek::bogus";
  // isKekUnlocked reports false for anything it can't resolve.
  Assert.ok(!ls.isKekUnlocked(BOGUS), "unknown kek_ref reported as locked");
  // unlockKek on an unknown kek_ref rejects with NS_ERROR_INVALID_ARG.
  await Assert.rejects(
    ls.unlockKek(BOGUS, "whatever", 60000),
    INVALID_ARG_RE,
    "unknown kek_ref rejected by unlockKek"
  );
  // lockKek on an unknown kek_ref is a silent no-op (resolves, no reject).
  await ls.lockKek(BOGUS);
});

add_task(async function test_empty_kek_ref_rejected() {
  const ls = getService();
  await Assert.rejects(
    ls.unlockKek("", "pw", 60000),
    INVALID_ARG_RE,
    "empty kek_ref rejected by unlockKek"
  );
  await Assert.rejects(
    ls.lockKek(""),
    INVALID_ARG_RE,
    "empty kek_ref rejected by lockKek"
  );
  Assert.throws(
    () => ls.isKekUnlocked(""),
    INVALID_ARG_RE,
    "empty kek_ref rejected by isKekUnlocked"
  );
});

add_task(async function test_pkcs11_malformed_uri_rejected() {
  // No PKCS#11 token is registered in the xpcshell harness, so we can
  // only exercise error paths for the PKCS#11 branch. A malformed URI
  // must be rejected without touching any slot.
  const ls = getService();
  const bogusPkcs11 = "lockstore::kek::pkcs11:not-a-valid-uri";
  await Assert.rejects(
    ls.unlockKek(bogusPkcs11, "pin-bytes", 60000),
    /NS_ERROR_(INVALID_ARG|ILLEGAL_VALUE|FAILURE)/,
    "malformed PKCS#11 URI rejected"
  );
});

// ---------------------------------------------------------------------------
// Concurrency: the service serialises FFI on a private queue. Multiple
// in-flight async ops must all complete and produce distinct ciphertexts.
// ---------------------------------------------------------------------------

add_task(async function test_concurrent_encrypts_serialised() {
  const ls = getService();
  await ls.createDek("concurrent", KEK_LOCAL, false);

  const N = 8;
  const pt = bytes("parallel-but-serialised");
  const cts = await Promise.all(
    Array.from({ length: N }, () => ls.encrypt("concurrent", KEK_LOCAL, pt))
  );
  Assert.equal(cts.length, N, "every concurrent encrypt resolved");

  // All ciphertexts of the same plaintext must be unique (random nonce).
  const seen = new Set();
  for (const ct of cts) {
    seen.add(Array.from(ct).join(","));
  }
  Assert.equal(
    seen.size,
    N,
    "every concurrent encrypt produced a unique ciphertext"
  );

  // All decrypt back to the original plaintext.
  const rounds = await Promise.all(
    cts.map(ct => ls.decrypt("concurrent", KEK_LOCAL, ct))
  );
  for (const r of rounds) {
    Assert.equal(str(r), "parallel-but-serialised");
  }

  await ls.deleteDek("concurrent");
});

add_task(async function test_concurrent_mixed_ops() {
  const ls = getService();
  // Mix createDek / encrypt / listCollections / deleteDek in flight.
  const colls = ["mix-a", "mix-b", "mix-c"];
  await Promise.all(colls.map(c => ls.createDek(c, KEK_LOCAL, false)));

  const collsAfter = await ls.listCollections();
  for (const c of colls) {
    Assert.ok(collsAfter.includes(c), `${c} present after concurrent create`);
  }

  // Encrypt under each in parallel.
  const cts = await Promise.all(
    colls.map(c => ls.encrypt(c, KEK_LOCAL, bytes(c)))
  );

  // Decrypt under each in parallel.
  const rounds = await Promise.all(
    colls.map((c, i) => ls.decrypt(c, KEK_LOCAL, cts[i]))
  );
  for (let i = 0; i < colls.length; i++) {
    Assert.equal(str(rounds[i]), colls[i], `${colls[i]} round-trips correctly`);
  }

  // Cleanup in parallel.
  await Promise.all(colls.map(c => ls.deleteDek(c)));
  const collsFinal = await ls.listCollections();
  for (const c of colls) {
    Assert.ok(!collsFinal.includes(c), `${c} cleaned up`);
  }
});

// ---------------------------------------------------------------------------
// importDek / isDekExtractable / switchKek
// ---------------------------------------------------------------------------

add_task(async function test_import_dek_roundtrip() {
  const ls = getService();
  // 32 known bytes — pattern, not crypto-quality.
  const dek = new Uint8Array(32);
  for (let i = 0; i < dek.length; i++) {
    dek[i] = (i + 1) & 0xff;
  }

  await ls.importDek("imported", KEK_LOCAL, dek, true);

  const round = await ls.getDek("imported", KEK_LOCAL);
  Assert.equal(round.length, 32, "exported DEK is 32 bytes");
  for (let i = 0; i < 32; i++) {
    Assert.equal(round[i], dek[i], `byte ${i} round-trips`);
  }

  // Sanity: encrypt/decrypt under the imported DEK.
  const ct = await ls.encrypt("imported", KEK_LOCAL, bytes("payload"));
  Assert.equal(str(await ls.decrypt("imported", KEK_LOCAL, ct)), "payload");

  await ls.deleteDek("imported");
});

add_task(async function test_import_dek_wrong_length_rejected() {
  const ls = getService();
  const short = new Uint8Array(16);
  await Assert.rejects(
    ls.importDek("short", KEK_LOCAL, short, true),
    /NS_ERROR_FAILURE/,
    "importDek with non-32-byte input rejects (InvalidConfiguration)"
  );
});

add_task(async function test_import_dek_empty_args_rejected() {
  const ls = getService();
  const dek = new Uint8Array(32);
  await Assert.rejects(
    ls.importDek("", KEK_LOCAL, dek, true),
    INVALID_ARG_RE,
    "importDek with empty collection rejects"
  );
  await Assert.rejects(
    ls.importDek("c", "", dek, true),
    INVALID_ARG_RE,
    "importDek with empty kekRef rejects"
  );
  await Assert.rejects(
    ls.importDek("c", KEK_LOCAL, [], true),
    INVALID_ARG_RE,
    "importDek with empty dekBytes rejects"
  );
});

add_task(async function test_import_dek_duplicate_rejected() {
  const ls = getService();
  const dek = new Uint8Array(32);
  await ls.importDek("dup", KEK_LOCAL, dek, true);
  await Assert.rejects(
    ls.importDek("dup", KEK_LOCAL, dek, true),
    /NS_ERROR_FAILURE/,
    "importDek on an existing collection rejects"
  );
  await ls.deleteDek("dup");
});

add_task(async function test_is_dek_extractable_true() {
  const ls = getService();
  await ls.createDek("extract-yes", KEK_LOCAL, true);
  Assert.equal(
    await ls.isDekExtractable("extract-yes"),
    true,
    "isDekExtractable reflects extractable=true at creation"
  );
  await ls.deleteDek("extract-yes");
});

add_task(async function test_is_dek_extractable_false() {
  const ls = getService();
  await ls.createDek("extract-no", KEK_LOCAL, false);
  Assert.equal(
    await ls.isDekExtractable("extract-no"),
    false,
    "isDekExtractable reflects extractable=false at creation"
  );
  await ls.deleteDek("extract-no");
});

add_task(async function test_is_dek_extractable_missing_rejected() {
  const ls = getService();
  await Assert.rejects(
    ls.isDekExtractable("never-existed-coll"),
    /NS_ERROR_NOT_AVAILABLE/,
    "isDekExtractable on a missing collection rejects"
  );
});

add_task(async function test_switch_kek_round_trip() {
  const ls = getService();
  if (!ls.isKekUnlocked(KEK_PP)) {
    await ls.unlockKek(KEK_PP, PW, 60000);
  }

  await ls.createDek("switch-rt", KEK_LOCAL, false);
  // Produce ciphertext under the OLD kek_ref; after switching to PP the
  // same ciphertext must still decrypt — switch_kek changes only the
  // wrapping, not the DEK bytes.
  const ct = await ls.encrypt("switch-rt", KEK_LOCAL, bytes("preserved"));

  await ls.switchKek("switch-rt", KEK_LOCAL, KEK_PP);

  const refs = await ls.listKeks("switch-rt");
  Assert.deepEqual(
    refs,
    [KEK_PP],
    "only the new kekRef wraps the collection after switch"
  );

  Assert.equal(
    str(await ls.decrypt("switch-rt", KEK_PP, ct)),
    "preserved",
    "ciphertext decrypts under the new kekRef (DEK bytes preserved)"
  );

  await Assert.rejects(
    ls.decrypt("switch-rt", KEK_LOCAL, ct),
    /NS_ERROR_NOT_AVAILABLE/,
    "old kekRef no longer wraps the collection"
  );

  await ls.deleteDek("switch-rt");
});

add_task(async function test_switch_kek_same_ref_rejected() {
  const ls = getService();
  await ls.createDek("same-ref", KEK_LOCAL, false);
  await Assert.rejects(
    ls.switchKek("same-ref", KEK_LOCAL, KEK_LOCAL),
    /NS_ERROR_FAILURE/,
    "switchKek(old == new) rejects as InvalidConfiguration"
  );
  await ls.deleteDek("same-ref");
});

add_task(async function test_switch_kek_empty_args_rejected() {
  const ls = getService();
  await Assert.rejects(
    ls.switchKek("", KEK_LOCAL, KEK_PP),
    INVALID_ARG_RE,
    "switchKek with empty collection rejects"
  );
  await Assert.rejects(
    ls.switchKek("c", "", KEK_PP),
    INVALID_ARG_RE,
    "switchKek with empty oldKekRef rejects"
  );
  await Assert.rejects(
    ls.switchKek("c", KEK_LOCAL, ""),
    INVALID_ARG_RE,
    "switchKek with empty newKekRef rejects"
  );
});

add_task(async function test_switch_kek_missing_collection_rejected() {
  const ls = getService();
  await Assert.rejects(
    ls.switchKek("never-existed", KEK_LOCAL, KEK_PP),
    /NS_ERROR_NOT_AVAILABLE/,
    "switchKek on a missing collection rejects"
  );
});
