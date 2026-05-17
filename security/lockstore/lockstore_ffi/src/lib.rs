/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

pub use lockstore_rs::LockstoreDatastore;
use lockstore_rs::{LockstoreError, LockstoreKeystore, KEYSTORE_FILENAME};
use nserror::{
    nsresult, NS_ERROR_ABORT, NS_ERROR_FAILURE, NS_ERROR_INVALID_ARG, NS_ERROR_NOT_AVAILABLE,
    NS_ERROR_NOT_INITIALIZED, NS_OK,
};
use nsstring::{nsACString, nsCString};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use thin_vec::ThinVec;
use zeroize::Zeroize;

// ============================================================================
// Handle Types
// ============================================================================

pub struct LockstoreKeystoreHandle {
    keystore: Arc<LockstoreKeystore>,
    profile_path: PathBuf,
}

// ============================================================================
// Helpers
// ============================================================================

fn error_to_nsresult(err: LockstoreError) -> nsresult {
    log::error!("Lockstore error: {}", err);
    match err {
        LockstoreError::NotFound(_) => NS_ERROR_NOT_AVAILABLE,
        LockstoreError::Serialization(_) => NS_ERROR_INVALID_ARG,
        LockstoreError::NotExtractable(_) => NS_ERROR_NOT_AVAILABLE,
        LockstoreError::AuthenticationCancelled => NS_ERROR_ABORT,
        LockstoreError::InvalidKekRef(_) => NS_ERROR_INVALID_ARG,
        LockstoreError::Locked => NS_ERROR_NOT_AVAILABLE,
        LockstoreError::WrongPassword => NS_ERROR_ABORT,
        LockstoreError::NotInitialized => NS_ERROR_NOT_INITIALIZED,
        _ => NS_ERROR_FAILURE,
    }
}

// ============================================================================
// Keystore FFI Functions
// ============================================================================

/// # Safety
/// `ret_handle` must be a writable location. On `NS_OK` the handle is
/// owned by the caller and must be released via
/// `lockstore_keystore_close`.
#[no_mangle]
pub unsafe extern "C" fn lockstore_keystore_open(
    profile_path: &nsACString,
    ret_handle: &mut *mut LockstoreKeystoreHandle,
) -> nsresult {
    if profile_path.is_empty() {
        log::error!("Profile path cannot be empty");
        return NS_ERROR_INVALID_ARG;
    }

    let profile_path_str = profile_path.to_utf8();
    let profile = PathBuf::from(profile_path_str.as_ref());
    let keystore_path = profile.join(KEYSTORE_FILENAME);

    let keystore = match LockstoreKeystore::new(keystore_path) {
        Ok(k) => Arc::new(k),
        Err(e) => return error_to_nsresult(e),
    };

    let handle = Box::new(LockstoreKeystoreHandle {
        keystore,
        profile_path: profile,
    });

    *ret_handle = Box::into_raw(handle);
    NS_OK
}

#[no_mangle]
pub extern "C" fn lockstore_keystore_create_dek(
    handle: &LockstoreKeystoreHandle,
    collection: &nsACString,
    kek_ref: &nsACString,
    extractable: bool,
) -> nsresult {
    if collection.is_empty() || kek_ref.is_empty() {
        log::error!("Collection and kek_ref cannot be empty");
        return NS_ERROR_INVALID_ARG;
    }

    let coll_str = collection.to_utf8();
    let kek_ref_str = kek_ref.to_utf8();

    match handle
        .keystore
        .create_dek(&coll_str, &kek_ref_str, extractable)
    {
        Ok(_) => NS_OK,
        Err(e) => error_to_nsresult(e),
    }
}

#[no_mangle]
pub extern "C" fn lockstore_keystore_get_dek(
    handle: &LockstoreKeystoreHandle,
    collection: &nsACString,
    kek_ref: &nsACString,
    ret_dek: &mut ThinVec<u8>,
) -> nsresult {
    if collection.is_empty() || kek_ref.is_empty() {
        log::error!("Collection and kek_ref cannot be empty");
        return NS_ERROR_INVALID_ARG;
    }

    let coll_str = collection.to_utf8();
    let kek_ref_str = kek_ref.to_utf8();

    match handle.keystore.get_dek(&coll_str, &kek_ref_str) {
        Ok((dek_bytes, _cipher_suite)) => {
            *ret_dek = dek_bytes.into();
            NS_OK
        }
        Err(e) => error_to_nsresult(e),
    }
}

/// Delete the DEK for `collection`. The keystore does not track the
/// associated datastore; callers are responsible for disposing of any
/// ciphertext under this collection by other means before (or after)
/// this call.
#[no_mangle]
pub extern "C" fn lockstore_keystore_delete_dek(
    handle: &LockstoreKeystoreHandle,
    collection: &nsACString,
) -> nsresult {
    if collection.is_empty() {
        log::error!("Collection cannot be empty");
        return NS_ERROR_INVALID_ARG;
    }

    let coll_str = collection.to_utf8();

    match handle.keystore.delete_dek(&coll_str) {
        Ok(()) => NS_OK,
        Err(e) => error_to_nsresult(e),
    }
}

#[no_mangle]
pub extern "C" fn lockstore_keystore_list_collections(
    handle: &LockstoreKeystoreHandle,
    ret_collections: &mut ThinVec<nsCString>,
) -> nsresult {
    match handle.keystore.list_collections() {
        Ok(collections) => {
            *ret_collections = collections
                .into_iter()
                .map(|c| nsCString::from(&c[..]))
                .collect();
            NS_OK
        }
        Err(e) => error_to_nsresult(e),
    }
}

#[no_mangle]
pub extern "C" fn lockstore_keystore_add_kek(
    handle: &LockstoreKeystoreHandle,
    collection: &nsACString,
    from_kek_ref: &nsACString,
    to_kek_ref: &nsACString,
) -> nsresult {
    if collection.is_empty() || from_kek_ref.is_empty() || to_kek_ref.is_empty() {
        log::error!("Collection, from_kek_ref and to_kek_ref cannot be empty");
        return NS_ERROR_INVALID_ARG;
    }
    let coll_str = collection.to_utf8();
    let from_str = from_kek_ref.to_utf8();
    let to_str = to_kek_ref.to_utf8();
    match handle.keystore.add_kek(&coll_str, &from_str, &to_str) {
        Ok(()) => NS_OK,
        Err(e) => error_to_nsresult(e),
    }
}

#[no_mangle]
pub extern "C" fn lockstore_keystore_remove_kek(
    handle: &LockstoreKeystoreHandle,
    collection: &nsACString,
    kek_ref: &nsACString,
) -> nsresult {
    if collection.is_empty() || kek_ref.is_empty() {
        log::error!("Collection and kek_ref cannot be empty");
        return NS_ERROR_INVALID_ARG;
    }
    let coll_str = collection.to_utf8();
    let kek_ref_str = kek_ref.to_utf8();
    match handle.keystore.remove_kek(&coll_str, &kek_ref_str) {
        Ok(()) => NS_OK,
        Err(e) => error_to_nsresult(e),
    }
}

/// # Safety
/// `plaintext_ptr` must point to at least `plaintext_len` initialised
/// bytes that remain valid for the duration of the call when
/// `plaintext_len > 0`. When `plaintext_len == 0` the pointer is not
/// dereferenced and may be null (or whatever sentinel
/// `nsTArray::Elements()` returns for empty arrays). Ownership remains
/// with the caller; Lockstore copies what it needs before returning.
#[no_mangle]
pub unsafe extern "C" fn lockstore_keystore_encrypt(
    handle: &LockstoreKeystoreHandle,
    collection: &nsACString,
    kek_ref: &nsACString,
    plaintext_ptr: *const u8,
    plaintext_len: usize,
    ret_ciphertext: &mut ThinVec<u8>,
) -> nsresult {
    if collection.is_empty() || kek_ref.is_empty() {
        return NS_ERROR_INVALID_ARG;
    }
    // Length-first check: short-circuits before any pointer
    // dereference, so the caller does not need to nullptr-guard for
    // empty buffers — passing `nsTArray::Elements()` unconditionally is
    // safe.
    if plaintext_len == 0 {
        return NS_ERROR_INVALID_ARG;
    }
    if plaintext_ptr.is_null() {
        return NS_ERROR_INVALID_ARG;
    }
    let coll_str = collection.to_utf8();
    let kek_ref_str = kek_ref.to_utf8();
    // SAFETY: non-zero len + non-null ptr validated above; caller's
    // contract requires this to point at `plaintext_len` valid bytes.
    let plaintext = unsafe { std::slice::from_raw_parts(plaintext_ptr, plaintext_len) };
    match handle.keystore.encrypt(&coll_str, &kek_ref_str, plaintext) {
        Ok(bytes) => {
            *ret_ciphertext = bytes.into();
            NS_OK
        }
        Err(e) => error_to_nsresult(e),
    }
}

/// # Safety
/// `ciphertext_ptr` must point to at least `ciphertext_len`
/// initialised bytes that remain valid for the duration of the call
/// when `ciphertext_len > 0`. When `ciphertext_len == 0` the pointer
/// is not dereferenced. Ownership remains with the caller.
#[no_mangle]
pub unsafe extern "C" fn lockstore_keystore_decrypt(
    handle: &LockstoreKeystoreHandle,
    collection: &nsACString,
    kek_ref: &nsACString,
    ciphertext_ptr: *const u8,
    ciphertext_len: usize,
    ret_plaintext: &mut ThinVec<u8>,
) -> nsresult {
    if collection.is_empty() || kek_ref.is_empty() {
        return NS_ERROR_INVALID_ARG;
    }
    if ciphertext_len == 0 {
        return NS_ERROR_INVALID_ARG;
    }
    if ciphertext_ptr.is_null() {
        return NS_ERROR_INVALID_ARG;
    }
    let coll_str = collection.to_utf8();
    let kek_ref_str = kek_ref.to_utf8();
    // SAFETY: non-zero len + non-null ptr validated above; caller's
    // contract requires this to point at `ciphertext_len` valid bytes.
    let ciphertext = unsafe { std::slice::from_raw_parts(ciphertext_ptr, ciphertext_len) };
    match handle.keystore.decrypt(&coll_str, &kek_ref_str, ciphertext) {
        Ok(bytes) => {
            *ret_plaintext = bytes.into();
            NS_OK
        }
        Err(e) => error_to_nsresult(e),
    }
}

/// # Safety
/// `handle` must be a non-null pointer previously returned by
/// `lockstore_keystore_open` that has not yet been passed to this
/// function. Consumes the handle and zeroises every cached KEK before
/// returning.
#[no_mangle]
pub unsafe extern "C" fn lockstore_keystore_close(
    handle: *mut LockstoreKeystoreHandle,
) -> nsresult {
    // C++ can't trigger Rust's `Drop` directly, so this fn is the
    // C-callable entry point that consumes the boxed handle. The
    // explicit `lock()` call here is defensive: it zeroises every
    // cached KEK (PrP + PKCS#11 auth cache) even if another
    // `Arc<LockstoreKeystore>` is still alive somewhere (the struct is
    // `Clone`). Without that call we'd only zeroise when the *last*
    // `Arc` drops, which the FFI consumer can't always guarantee.
    //
    // SAFETY: caller's contract guarantees `handle` is a live, owned
    // `Box::into_raw` pointer that has not yet been passed to this fn.
    if let Some(boxed) = unsafe { handle.as_mut() } {
        boxed.keystore.lock();
    }
    // SAFETY: same as above; consumes the handle.
    let _ = unsafe { Box::from_raw(handle) };
    NS_OK
}

// ============================================================================
// Primary Password FFI Functions (init / change)
// ============================================================================
//
// These remain PrP-specific: PKCS#11 tokens have no equivalent
// "initialise" concept in Lockstore (the PIN is set elsewhere), so
// these are not part of the unified lock/unlock API.

/// Set or change the primary password. `old` is empty for initial
/// setup. Lockstore copies the caller's bytes into its own buffers,
/// uses them, and zeroises those internal buffers before returning;
/// the caller's `nsACString` views are never mutated. Callers should
/// still observe their own hygiene for the strings they passed in.
#[no_mangle]
pub extern "C" fn lockstore_keystore_set_prp(
    handle: &LockstoreKeystoreHandle,
    old: &nsACString,
    new: &nsACString,
) -> nsresult {
    if new.is_empty() {
        return NS_ERROR_INVALID_ARG;
    }
    // Defensive copies that we own and can zeroise; the caller's
    // `&nsACString` references remain const-correct.
    let mut new_buf: Vec<u8> = new[..].to_vec();
    let mut old_buf: Option<Vec<u8>> = if old.is_empty() {
        None
    } else {
        Some(old[..].to_vec())
    };

    let result = handle.keystore.set_prp(old_buf.as_deref(), &new_buf);

    new_buf.zeroize();
    if let Some(ref mut o) = old_buf {
        o.zeroize();
    }

    match result {
        Ok(()) => NS_OK,
        Err(e) => error_to_nsresult(e),
    }
}

#[no_mangle]
pub extern "C" fn lockstore_keystore_has_prp(
    handle: &LockstoreKeystoreHandle,
    out_has: &mut bool,
) -> nsresult {
    *out_has = handle.keystore.has_prp();
    NS_OK
}

// ============================================================================
// Unified KEK lock/unlock FFI
// ============================================================================
//
// Dispatches internally on the kek_ref's KekType. For PrimaryPassword
// `secret` is the password used to derive the KEK; for Pkcs11Token
// `secret` is typically unused (NSS prompts for the PIN). For LocalKey
// these are no-ops.

/// Unlock the KEK referenced by `kek_ref` using `secret` (a password
/// for PrimaryPassword, a PIN for PKCS#11, or empty / ignored for
/// LocalKey). Lockstore copies the secret bytes into its own buffer,
/// uses them, and zeroises that buffer before returning; the caller's
/// `nsACString` view is never mutated.
#[no_mangle]
pub extern "C" fn lockstore_keystore_unlock_kek(
    handle: &LockstoreKeystoreHandle,
    kek_ref: &nsACString,
    secret: &nsACString,
    timeout_ms: u32,
) -> nsresult {
    if kek_ref.is_empty() {
        return NS_ERROR_INVALID_ARG;
    }
    let mut secret_buf: Vec<u8> = secret[..].to_vec();
    let kek_ref_str = kek_ref.to_utf8();
    let result = handle.keystore.unlock_kek(
        &kek_ref_str,
        &secret_buf,
        Duration::from_millis(timeout_ms as u64),
    );
    secret_buf.zeroize();

    match result {
        Ok(()) => NS_OK,
        Err(e) => error_to_nsresult(e),
    }
}

#[no_mangle]
pub extern "C" fn lockstore_keystore_lock_kek(
    handle: &LockstoreKeystoreHandle,
    kek_ref: &nsACString,
) -> nsresult {
    if kek_ref.is_empty() {
        return NS_ERROR_INVALID_ARG;
    }
    let kek_ref_str = kek_ref.to_utf8();
    handle.keystore.lock_kek(&kek_ref_str);
    NS_OK
}

#[no_mangle]
pub extern "C" fn lockstore_keystore_is_kek_unlocked(
    handle: &LockstoreKeystoreHandle,
    kek_ref: &nsACString,
    out_unlocked: &mut bool,
) -> nsresult {
    if kek_ref.is_empty() {
        return NS_ERROR_INVALID_ARG;
    }
    let kek_ref_str = kek_ref.to_utf8();
    *out_unlocked = handle.keystore.is_kek_unlocked(&kek_ref_str);
    NS_OK
}

/// Lock every KEK that holds cached authentication (PrimaryPassword KEK
/// and every per-kek_ref PKCS#11 entry). Intended for shutdown / logout
/// paths that should invalidate all unlocked state in a single call.
#[no_mangle]
pub extern "C" fn lockstore_keystore_lock(handle: &LockstoreKeystoreHandle) -> nsresult {
    handle.keystore.lock();
    NS_OK
}

// ============================================================================
// Datastore FFI Functions
// ============================================================================

/// # Safety
/// `ret_handle` must be a writable location. On `NS_OK` the handle is
/// owned by the caller and must be released via
/// `lockstore_datastore_close`.
#[no_mangle]
pub unsafe extern "C" fn lockstore_datastore_open(
    keystore_handle: &LockstoreKeystoreHandle,
    collection: &nsACString,
    kek_ref: &nsACString,
    ret_handle: &mut *mut LockstoreDatastore,
) -> nsresult {
    if collection.is_empty() || kek_ref.is_empty() {
        log::error!("Collection and kek_ref cannot be empty");
        return NS_ERROR_INVALID_ARG;
    }

    let coll_str = collection.to_utf8();
    let kek_ref_str = kek_ref.to_utf8();

    let datastore = match LockstoreDatastore::new(
        keystore_handle.profile_path.clone(),
        coll_str.to_string(),
        keystore_handle.keystore.clone(),
        &kek_ref_str,
    ) {
        Ok(d) => d,
        Err(e) => return error_to_nsresult(e),
    };

    *ret_handle = Box::into_raw(Box::new(datastore));
    NS_OK
}

/// # Safety
/// `data_ptr` must point to at least `data_len` initialised bytes that
/// remain valid for the duration of the call. `data_len` must be
/// non-zero. Ownership remains with the caller.
#[no_mangle]
pub unsafe extern "C" fn lockstore_datastore_put(
    handle: &LockstoreDatastore,
    entry_name: &nsACString,
    data_ptr: *const u8,
    data_len: usize,
) -> nsresult {
    if entry_name.is_empty() {
        log::error!("Entry name cannot be empty");
        return NS_ERROR_INVALID_ARG;
    }

    if data_ptr.is_null() || data_len == 0 {
        log::error!("Invalid data pointer or length");
        return NS_ERROR_INVALID_ARG;
    }

    // SAFETY: caller's contract; pointer is non-null and points at
    // `data_len` valid bytes.
    let data_slice = unsafe { std::slice::from_raw_parts(data_ptr, data_len) };
    let entry_str = entry_name.to_utf8();

    match handle.put(&entry_str, data_slice) {
        Ok(_) => NS_OK,
        Err(e) => error_to_nsresult(e),
    }
}

#[no_mangle]
pub extern "C" fn lockstore_datastore_get(
    handle: &LockstoreDatastore,
    entry_name: &nsACString,
    ret_data: &mut ThinVec<u8>,
) -> nsresult {
    if entry_name.is_empty() {
        log::error!("Entry name cannot be empty");
        return NS_ERROR_INVALID_ARG;
    }

    let entry_str = entry_name.to_utf8();

    match handle.get(&entry_str) {
        Ok(data) => {
            *ret_data = data.into();
            NS_OK
        }
        Err(e) => error_to_nsresult(e),
    }
}

#[no_mangle]
pub extern "C" fn lockstore_datastore_delete(
    handle: &LockstoreDatastore,
    entry_name: &nsACString,
) -> nsresult {
    if entry_name.is_empty() {
        log::error!("Entry name cannot be empty");
        return NS_ERROR_INVALID_ARG;
    }

    let entry_str = entry_name.to_utf8();

    match handle.delete(&entry_str) {
        Ok(()) => NS_OK,
        Err(e) => error_to_nsresult(e),
    }
}

#[no_mangle]
pub extern "C" fn lockstore_datastore_keys(
    handle: &LockstoreDatastore,
    ret_entries: &mut ThinVec<nsCString>,
) -> nsresult {
    match handle.keys() {
        Ok(entries) => {
            *ret_entries = entries
                .into_iter()
                .map(|e| nsCString::from(&e[..]))
                .collect();
            NS_OK
        }
        Err(e) => error_to_nsresult(e),
    }
}

/// # Safety
/// `handle` must be a non-null pointer previously returned by
/// `lockstore_datastore_open` that has not yet been passed to this
/// function. Consumes the handle.
#[no_mangle]
pub unsafe extern "C" fn lockstore_datastore_close(handle: *mut LockstoreDatastore) -> nsresult {
    // SAFETY: caller's contract guarantees `handle` is a live, owned
    // `Box::into_raw` pointer.
    unsafe { Box::from_raw(handle).close() };
    NS_OK
}
