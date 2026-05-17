/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use crate::crypto::{self, CipherSuite, DEFAULT_CIPHER_SUITE};
use crate::pbkdf2;
use crate::utils;
use crate::{KekType, LockstoreError, KEK_REF_PREFIX, KEK_REF_PRP};

use kvstore::{Database, GetOptions, Key, Store, StorePath};
use nss_rs::aead::Aead;
use nss_rs::p11;
use nss_rs::SymKey;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use zeroize::Zeroize;

/// Logical kvstore database name under which keystore rows (DEK
/// metadata, PrP params) live within `lockstore.keys.sqlite`. Single
/// physical SQLite file, multiple logical databases keyed by this name.
const DB_NAME: &str = "lockstore.keys";
const DEK_PREFIX: &str = "lockstore::dek::";
const PRP_PARAMS_KEY: &str = "lockstore::prp::params";
const PRP_VERIFIER_PLAINTEXT: &[u8] = b"lockstore-prp-verifier";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WrappedDek {
    kek_type: KekType,
    kek_ref: String,
    wrapped_dek: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DekMetadata {
    wrapped_deks: Vec<WrappedDek>,
    cipher_suite: CipherSuite,
    #[serde(default)]
    extractable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrimaryPasswordParams {
    salt: Vec<u8>,
    iterations: u32,
    verifier: Vec<u8>,
    cipher_suite: CipherSuite,
}

/// Exclusive access to the keystore's DEK metadata. Acquired via
/// [`LockstoreKeystore::acquire_connection`].
///
/// Holding a `ConnectionHandle` is the witness that the caller has
/// exclusive write access to DEK metadata: every operation that walks
/// or mutates collection rows
/// ([`list_collections`](Self::list_collections), `load_metadata`,
/// `save_metadata`) is a method on this type, so the compiler enforces
/// that a thread cannot read the collection list and then load a row
/// without holding the lock across both steps. Single-step mutations
/// on [`LockstoreKeystore`] (`create_dek`, `add_kek`, `remove_kek`,
/// `delete_dek`, `set_prp`) acquire a connection internally;
/// multi-step operations (primary-password rotation, batch
/// maintenance) acquire one explicitly and hold it across the whole
/// pass.
pub struct ConnectionHandle<'a> {
    keystore: &'a LockstoreKeystore,
    // The guard's `Drop` is what releases the underlying mutex; the
    // leading underscore tells the compiler we're keeping it solely
    // for its drop-time side-effect.
    _guard: std::sync::MutexGuard<'a, ()>,
}

impl<'a> ConnectionHandle<'a> {
    /// Returns the names of every collection that currently has DEK
    /// metadata stored.
    pub fn list_collections(&self) -> Result<Vec<String>, LockstoreError> {
        use kvstore::DatabaseError;

        let reader = self.keystore.store.reader()?;
        let db_name = DB_NAME.to_string();

        let collections = reader
            .read(|conn| {
                let mut stmt = conn
                    .prepare(
                        "SELECT data.key FROM data
                         JOIN dbs ON data.db_id = dbs.id
                         WHERE dbs.name = ?1
                         AND data.key LIKE ?2
                         ORDER BY data.key",
                    )
                    .map_err(DatabaseError::from)?;

                let dek_pattern = format!("{}%", DEK_PREFIX);
                let names: Result<Vec<String>, _> = stmt
                    .query_map([&db_name, &dek_pattern], |row| {
                        let key: String = row.get(0)?;
                        Ok(key.strip_prefix(DEK_PREFIX).unwrap_or(&key).to_string())
                    })
                    .map_err(DatabaseError::from)?
                    .collect();

                names.map_err(DatabaseError::from)
            })
            .map_err(LockstoreError::Database)?;

        Ok(collections)
    }

    fn load_metadata(&self, collection_name: &str) -> Result<DekMetadata, LockstoreError> {
        let dek_key = format!("{}{}", DEK_PREFIX, collection_name);
        let db = Database::new(&self.keystore.store, DB_NAME);
        let key = Key::from(dek_key.as_str());

        let metadata_value = db.get(&key, &GetOptions::default())?.ok_or_else(|| {
            LockstoreError::NotFound(format!("DEK not found for collection: {}", collection_name))
        })?;

        let metadata_bytes = utils::value_to_bytes(&metadata_value)?;
        Ok(serde_json::from_slice(&metadata_bytes)?)
    }

    fn save_metadata(
        &self,
        collection_name: &str,
        metadata: &DekMetadata,
    ) -> Result<(), LockstoreError> {
        let dek_key = format!("{}{}", DEK_PREFIX, collection_name);
        let db = Database::new(&self.keystore.store, DB_NAME);
        let key = Key::from(dek_key.as_str());
        let metadata_bytes = serde_json::to_vec(metadata)?;
        let value = utils::bytes_to_value(&metadata_bytes)?;
        db.put(&[(key, Some(value))])?;
        Ok(())
    }
}

/// Bytes of a plaintext KEK held in memory for a bounded window;
/// `Drop` runs `zeroize::Zeroize`.
struct CachedKek {
    kek: Vec<u8>,
    expires_at: Instant,
}

impl Drop for CachedKek {
    fn drop(&mut self) {
        self.kek.zeroize();
    }
}

#[derive(Clone)]
pub struct LockstoreKeystore {
    store: Arc<Store>,
    in_memory: bool,
    prp_cache: Arc<Mutex<Option<CachedKek>>>,
    /// Backs the `ConnectionHandle` guard: a coarse write-lock
    /// acquired by every operation that walks or mutates DEK metadata.
    /// Callers acquire a handle via [`acquire_connection`](Self::acquire_connection)
    /// rather than touching this directly; the handle's `Drop` releases
    /// the guard. Rotation walks every collection and rewraps each
    /// `PrimaryPassword`-bound DEK under the new KEK; holding the
    /// connection across the whole pass ensures a concurrent
    /// `create_dek` cannot leave a fresh collection wrapped under the
    /// about-to-be-stale KEK only.
    connection_lock: Arc<Mutex<()>>,
}

impl LockstoreKeystore {
    pub fn new(path: PathBuf) -> Result<Self, LockstoreError> {
        let store = Arc::new(Store::new(StorePath::OnDisk(path)));
        nss_rs::init().map_err(|e| LockstoreError::NssInitialization(e.to_string()))?;
        Ok(Self {
            store,
            in_memory: false,
            prp_cache: Arc::new(Mutex::new(None)),
            connection_lock: Arc::new(Mutex::new(())),
        })
    }

    pub fn new_in_memory() -> Result<Self, LockstoreError> {
        let store = Arc::new(Store::new(StorePath::for_in_memory()));
        nss_rs::init().map_err(|e| LockstoreError::NssInitialization(e.to_string()))?;
        Ok(Self {
            store,
            in_memory: true,
            prp_cache: Arc::new(Mutex::new(None)),
            connection_lock: Arc::new(Mutex::new(())),
        })
    }

    pub fn create_dek(
        &self,
        collection_name: &str,
        kek_ref: &str,
        extractable: bool,
    ) -> Result<(), LockstoreError> {
        self.create_dek_with_cipher(collection_name, kek_ref, extractable, DEFAULT_CIPHER_SUITE)
    }

    pub fn create_dek_with_cipher(
        &self,
        collection_name: &str,
        kek_ref: &str,
        extractable: bool,
        cipher_suite: CipherSuite,
    ) -> Result<(), LockstoreError> {
        let kek_type = KekType::from_kek_ref(kek_ref)?;

        // Serialises against `set_prp`'s rewrap pass so a brand-new
        // DEK can't be wrapped under an about-to-be-rotated KEK.
        let conn = self.acquire_connection()?;

        let dek_key = format!("{}{}", DEK_PREFIX, collection_name);
        let db = Database::new(&self.store, DB_NAME);
        let key = Key::from(dek_key.as_str());
        let existing = db.get(&key, &GetOptions::default())?;

        if existing.is_some() {
            return Err(LockstoreError::InvalidConfiguration(format!(
                "DEK already exists for collection: {}",
                collection_name
            )));
        }

        let new_dek = crypto::generate_random_key(cipher_suite);
        let kek = self.get_kek_symkey(cipher_suite, kek_ref)?;
        let wrapped = crypto::encrypt_with_symkey(&new_dek, &kek, cipher_suite)?;

        let metadata = DekMetadata {
            wrapped_deks: vec![WrappedDek {
                kek_type,
                kek_ref: kek_ref.to_string(),
                wrapped_dek: wrapped,
            }],
            cipher_suite,
            extractable,
        };

        conn.save_metadata(collection_name, &metadata)
    }

    pub(crate) fn get_dek_internal(
        &self,
        collection_name: &str,
        kek_ref: &str,
    ) -> Result<(Vec<u8>, CipherSuite, bool), LockstoreError> {
        let conn = self.acquire_connection()?;
        let metadata = conn.load_metadata(collection_name)?;

        let entry = metadata
            .wrapped_deks
            .iter()
            .find(|w| w.kek_ref == kek_ref)
            .ok_or_else(|| {
                LockstoreError::NotFound(format!(
                    "No DEK for collection '{}' with kek_ref '{}'",
                    collection_name, kek_ref
                ))
            })?;

        let kek = self.get_kek_symkey(metadata.cipher_suite, kek_ref)?;
        let dek = crypto::decrypt_with_symkey(&entry.wrapped_dek, &kek)?;

        Ok((dek, metadata.cipher_suite, metadata.extractable))
    }

    pub fn is_dek_extractable(&self, collection_name: &str) -> Result<bool, LockstoreError> {
        let conn = self.acquire_connection()?;
        let metadata = conn.load_metadata(collection_name)?;
        Ok(metadata.extractable)
    }

    pub fn get_dek(
        &self,
        collection_name: &str,
        kek_ref: &str,
    ) -> Result<(Vec<u8>, CipherSuite), LockstoreError> {
        if !self.is_dek_extractable(collection_name)? {
            return Err(LockstoreError::NotExtractable(format!(
                "DEK for '{}' is not extractable",
                collection_name
            )));
        }

        let (dek, cipher_suite, _) = self.get_dek_internal(collection_name, kek_ref)?;
        Ok((dek, cipher_suite))
    }

    /// Encrypts `plaintext` with the DEK for `(collection, kek_ref)`. The returned
    /// blob is self-describing: `[cipher_suite_id(1)] || [nonce] || [ciphertext+tag]`.
    /// The DEK does not need to be extractable; the DEK bytes never leave Lockstore.
    pub fn encrypt(
        &self,
        collection: &str,
        kek_ref: &str,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, LockstoreError> {
        let (dek, cipher_suite, _) = self.get_dek_internal(collection, kek_ref)?;
        crypto::encrypt_with_key(plaintext, &dek, cipher_suite)
    }

    /// Decrypts a blob produced by `encrypt` using the DEK for
    /// `(collection, kek_ref)`. The cipher suite is encoded in the
    /// blob's leading byte and must match the suite recorded for this
    /// DEK in `DekMetadata.cipher_suite`; a mismatch (e.g. the blob's
    /// prefix was tampered with to point at a different suite) is
    /// rejected as `LockstoreError::Decryption` before the AEAD layer
    /// gets a chance to fail with a less specific error.
    pub fn decrypt(
        &self,
        collection: &str,
        kek_ref: &str,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, LockstoreError> {
        let (dek, expected_suite, _) = self.get_dek_internal(collection, kek_ref)?;
        let blob_suite = crypto::cipher_suite_of_blob(ciphertext)?;
        if blob_suite != expected_suite {
            return Err(LockstoreError::Decryption(format!(
                "cipher-suite mismatch: blob {} but DEK was created with {}",
                blob_suite.as_str(),
                expected_suite.as_str()
            )));
        }
        crypto::decrypt_with_key(ciphertext, &dek)
    }

    pub fn add_kek(
        &self,
        collection_name: &str,
        source_kek_ref: &str,
        new_kek_ref: &str,
    ) -> Result<(), LockstoreError> {
        let new_kek_type = KekType::from_kek_ref(new_kek_ref)?;

        let conn = self.acquire_connection()?;
        let mut metadata = conn.load_metadata(collection_name)?;

        if metadata
            .wrapped_deks
            .iter()
            .any(|w| w.kek_ref == new_kek_ref)
        {
            return Err(LockstoreError::InvalidConfiguration(format!(
                "kek_ref '{}' already exists for collection '{}'",
                new_kek_ref, collection_name
            )));
        }

        let source_entry = metadata
            .wrapped_deks
            .iter()
            .find(|w| w.kek_ref == source_kek_ref)
            .ok_or_else(|| {
                LockstoreError::NotFound(format!(
                    "No DEK for collection '{}' with kek_ref '{}'",
                    collection_name, source_kek_ref
                ))
            })?;

        let source_kek = self.get_kek_symkey(metadata.cipher_suite, source_kek_ref)?;
        let dek = crypto::decrypt_with_symkey(&source_entry.wrapped_dek, &source_kek)?;

        let new_kek = self.get_kek_symkey(metadata.cipher_suite, new_kek_ref)?;
        let new_wrapped = crypto::encrypt_with_symkey(&dek, &new_kek, metadata.cipher_suite)?;

        metadata.wrapped_deks.push(WrappedDek {
            kek_type: new_kek_type,
            kek_ref: new_kek_ref.to_string(),
            wrapped_dek: new_wrapped,
        });

        conn.save_metadata(collection_name, &metadata)
    }

    pub fn remove_kek(&self, collection_name: &str, kek_ref: &str) -> Result<(), LockstoreError> {
        let conn = self.acquire_connection()?;
        let mut metadata = conn.load_metadata(collection_name)?;

        if metadata.wrapped_deks.len() <= 1 {
            return Err(LockstoreError::InvalidConfiguration(format!(
                "Cannot remove the last KEK from collection '{}'",
                collection_name
            )));
        }

        let entry = metadata
            .wrapped_deks
            .iter()
            .find(|w| w.kek_ref == kek_ref)
            .ok_or_else(|| {
                LockstoreError::NotFound(format!(
                    "No DEK for collection '{}' with kek_ref '{}'",
                    collection_name, kek_ref
                ))
            })?;

        let kek = self.get_kek_symkey(metadata.cipher_suite, kek_ref)?;
        crypto::decrypt_with_symkey(&entry.wrapped_dek, &kek)?;

        metadata.wrapped_deks.retain(|w| w.kek_ref != kek_ref);

        conn.save_metadata(collection_name, &metadata)
    }

    pub fn delete_dek(&self, collection_name: &str) -> Result<(), LockstoreError> {
        let _conn = self.acquire_connection()?;

        let dek_key = format!("{}{}", DEK_PREFIX, collection_name);
        let db = Database::new(&self.store, DB_NAME);
        let key = Key::from(dek_key.as_str());

        if !db.has(&key, &GetOptions::default())? {
            return Err(LockstoreError::NotFound(format!(
                "DEK not found for collection: {}",
                collection_name
            )));
        }

        crypto::secure_delete(&self.store, DB_NAME, &dek_key)
    }

    /// Acquire exclusive DEK-ops access on this keystore. Single-step
    /// public methods (`create_dek`, `add_kek`, `remove_kek`,
    /// `delete_dek`, `set_prp`) acquire one internally; multi-step
    /// callers (primary-password rotation, batch maintenance) should
    /// call this once and hold the result across the operation. See
    /// [`ConnectionHandle`] for what holding a connection guarantees.
    pub fn acquire_connection(&self) -> Result<ConnectionHandle<'_>, LockstoreError> {
        let guard = self
            .connection_lock
            .lock()
            .map_err(|_| LockstoreError::InvalidConfiguration("connection_lock poisoned".into()))?;
        Ok(ConnectionHandle {
            keystore: self,
            _guard: guard,
        })
    }

    /// Snapshot of all collections that currently have DEK metadata
    /// stored. Internally acquires a short-lived connection; callers
    /// that need a stable view across multiple operations should call
    /// [`acquire_connection`](Self::acquire_connection) and use
    /// [`ConnectionHandle::list_collections`] directly.
    pub fn list_collections(&self) -> Result<Vec<String>, LockstoreError> {
        self.acquire_connection()?.list_collections()
    }

    pub fn close(self) {
        self.lock_prp();
        if self.in_memory {
            let _ = crypto::zeroize(&self.store, DB_NAME, "lockstore::kek::local");
        }
        self.store.close();
    }

    // ========================================================================
    // Primary password
    // ========================================================================

    /// Returns true if a primary password has been initialized for this keystore.
    pub fn has_prp(&self) -> bool {
        self.load_prp_params().ok().flatten().is_some()
    }

    /// Returns true if the primary password KEK is currently cached and not expired.
    pub fn is_prp_unlocked(&self) -> bool {
        let mut guard = self.prp_cache.lock().unwrap();
        match guard.as_ref() {
            Some(cached) if cached.expires_at > Instant::now() => true,
            Some(_) => {
                *guard = None;
                false
            }
            None => false,
        }
    }

    /// Clears the cached primary-password KEK; cached bytes are
    /// zeroised on drop.
    pub fn lock_prp(&self) {
        let mut guard = self.prp_cache.lock().unwrap();
        *guard = None;
    }

    /// Derives the KEK from `password`, authenticates against the stored verifier,
    /// and caches the KEK in memory with an absolute deadline of `now + timeout`.
    pub fn unlock_prp(&self, password: &[u8], timeout: Duration) -> Result<(), LockstoreError> {
        let params = self
            .load_prp_params()?
            .ok_or(LockstoreError::NotInitialized)?;

        let mut kek = pbkdf2::derive_kek(
            password,
            &params.salt,
            params.iterations,
            params.cipher_suite.key_size(),
        )?;

        match crypto::decrypt_with_key(&params.verifier, &kek) {
            Ok(plaintext) if plaintext == PRP_VERIFIER_PLAINTEXT => {}
            Ok(_) | Err(_) => {
                kek.zeroize();
                return Err(LockstoreError::WrongPassword);
            }
        }

        let mut guard = self.prp_cache.lock().unwrap();
        *guard = Some(CachedKek {
            kek,
            expires_at: Instant::now() + timeout,
        });

        Ok(())
    }

    /// Initialise or change the primary password.
    ///
    /// - `old = None`: initial setup. Fails with `InvalidConfiguration`
    ///   if already initialised.
    /// - `old = Some(bytes)`: change. Verifies `old`, then rewraps every
    ///   `PrimaryPassword`-wrapped DEK across all collections under the
    ///   new KEK before persisting the new params record. A crash
    ///   mid-rewrap leaves the old params valid; any already-rewrapped
    ///   collections become unreachable until the rewrap completes on a
    ///   subsequent run.
    ///
    /// Holds `connection_lock` for the duration so concurrent `create_dek` /
    /// `add_kek` / `remove_kek` callers wait until the rotation
    /// completes and cannot end up wrapped under the now-stale old KEK.
    pub fn set_prp(&self, old: Option<&[u8]>, new: &[u8]) -> Result<(), LockstoreError> {
        self.set_prp_inner(old, new, pbkdf2::PBKDF2_ITERATIONS)
    }

    /// Identical to `set_prp` but uses a single PBKDF2
    /// iteration so the test can run in milliseconds instead of seconds.
    /// **Production code must call `set_prp`.** This is
    /// public only so integration tests in `tests/` can reach it; the
    /// name is loud on purpose.
    pub fn set_prp_test_only(&self, old: Option<&[u8]>, new: &[u8]) -> Result<(), LockstoreError> {
        self.set_prp_inner(old, new, 1)
    }

    /// Private worker shared by `set_prp` (production,
    /// 800 000 iterations) and `set_prp_test_only`
    /// (single-iteration, test-only).
    fn set_prp_inner(
        &self,
        old: Option<&[u8]>,
        new: &[u8],
        iterations: u32,
    ) -> Result<(), LockstoreError> {
        if new.is_empty() {
            return Err(LockstoreError::InvalidConfiguration(
                "new primary password must not be empty".to_string(),
            ));
        }

        let conn = self.acquire_connection()?;

        let existing = self.load_prp_params()?;
        if existing.is_some() != old.is_some() {
            return Err(LockstoreError::InvalidConfiguration(
                "Primary password state does not match: 'old' must be provided iff \
                 already initialized"
                    .to_string(),
            ));
        }

        let cipher_suite = existing
            .as_ref()
            .map(|p| p.cipher_suite)
            .unwrap_or(DEFAULT_CIPHER_SUITE);

        let new_salt = crypto::generate_random_bytes(pbkdf2::PBKDF2_SALT_SIZE);
        let new_kek = pbkdf2::derive_kek(new, &new_salt, iterations, cipher_suite.key_size())?;

        if let (Some(params), Some(old_bytes)) = (existing.as_ref(), old) {
            let old_kek = pbkdf2::derive_kek(
                old_bytes,
                &params.salt,
                params.iterations,
                params.cipher_suite.key_size(),
            )?;
            match crypto::decrypt_with_key(&params.verifier, &old_kek) {
                Ok(plaintext) if plaintext == PRP_VERIFIER_PLAINTEXT => {}
                _ => return Err(LockstoreError::WrongPassword),
            }
            self.rewrap_prp_deks(&conn, &old_kek, &new_kek, cipher_suite)?;
        }

        let verifier = crypto::encrypt_with_key(PRP_VERIFIER_PLAINTEXT, &new_kek, cipher_suite)?;
        self.save_prp_params(&PrimaryPasswordParams {
            salt: new_salt,
            iterations,
            verifier,
            cipher_suite,
        })?;
        self.lock_prp();
        Ok(())
    }

    fn rewrap_prp_deks(
        &self,
        conn: &ConnectionHandle<'_>,
        old_kek: &[u8],
        new_kek: &[u8],
        cipher_suite: CipherSuite,
    ) -> Result<(), LockstoreError> {
        let collections = conn.list_collections()?;
        for collection_name in collections {
            let mut metadata = match conn.load_metadata(&collection_name) {
                Ok(m) => m,
                Err(LockstoreError::NotFound(_)) => continue,
                Err(e) => return Err(e),
            };
            let mut changed = false;
            for entry in metadata.wrapped_deks.iter_mut() {
                if entry.kek_ref != KEK_REF_PRP {
                    continue;
                }
                let dek = crypto::decrypt_with_key(&entry.wrapped_dek, old_kek)?;
                entry.wrapped_dek = crypto::encrypt_with_key(&dek, new_kek, cipher_suite)?;
                changed = true;
            }
            if changed {
                conn.save_metadata(&collection_name, &metadata)?;
            }
        }
        Ok(())
    }

    fn load_prp_params(&self) -> Result<Option<PrimaryPasswordParams>, LockstoreError> {
        let db = Database::new(&self.store, DB_NAME);
        let key = Key::from(PRP_PARAMS_KEY);
        let value = db.get(&key, &GetOptions::default())?;
        match value {
            None => Ok(None),
            Some(v) => {
                let bytes = utils::value_to_bytes(&v)?;
                let params: PrimaryPasswordParams = serde_json::from_slice(&bytes)?;
                Ok(Some(params))
            }
        }
    }

    fn save_prp_params(&self, params: &PrimaryPasswordParams) -> Result<(), LockstoreError> {
        let db = Database::new(&self.store, DB_NAME);
        let key = Key::from(PRP_PARAMS_KEY);
        let bytes = serde_json::to_vec(params)?;
        let value = utils::bytes_to_value(&bytes)?;
        db.put(&[(key, Some(value))])?;
        Ok(())
    }

    // ========================================================================
    // KEK retrieval
    // ========================================================================

    fn get_kek_symkey(
        &self,
        cipher_suite: CipherSuite,
        kek_ref: &str,
    ) -> Result<SymKey, LockstoreError> {
        let kek_type = KekType::from_kek_ref(kek_ref)?;
        match kek_type {
            KekType::LocalKey => {
                let kek_bytes = self.get_kek_local(cipher_suite, kek_ref)?;
                Aead::import_key(cipher_suite.to_nss_algorithm(), &kek_bytes)
                    .map_err(|e| LockstoreError::Encryption(e.to_string()))
            }
            KekType::Pkcs11Token => self.get_kek_from_token(cipher_suite, kek_ref),
            KekType::PrimaryPassword => self.get_kek_prp(cipher_suite),
            #[cfg(test)]
            KekType::Test => {
                let kek_bytes = self.get_kek_local(cipher_suite, kek_ref)?;
                Aead::import_key(cipher_suite.to_nss_algorithm(), &kek_bytes)
                    .map_err(|e| LockstoreError::Encryption(e.to_string()))
            }
        }
    }

    fn get_kek_prp(&self, cipher_suite: CipherSuite) -> Result<SymKey, LockstoreError> {
        let mut guard = self.prp_cache.lock().unwrap();
        match guard.as_ref() {
            Some(cached) if cached.expires_at > Instant::now() => {
                Aead::import_key(cipher_suite.to_nss_algorithm(), &cached.kek)
                    .map_err(|e| LockstoreError::Encryption(e.to_string()))
            }
            Some(_) => {
                *guard = None;
                Err(LockstoreError::Locked)
            }
            None => Err(LockstoreError::Locked),
        }
    }

    fn get_kek_local(
        &self,
        cipher_suite: CipherSuite,
        kek_ref: &str,
    ) -> Result<Vec<u8>, LockstoreError> {
        let db = Database::new(&self.store, DB_NAME);
        let key = Key::from(kek_ref);

        let existing_kek = db.get(&key, &GetOptions::default())?;

        if let Some(value) = existing_kek {
            utils::value_to_bytes(&value)
        } else {
            let new_kek = crypto::generate_random_key(cipher_suite);
            let value = utils::bytes_to_value(&new_kek)?;
            db.put(&[(key, Some(value))])?;
            Ok(new_kek)
        }
    }

    fn get_kek_from_token(
        &self,
        cipher_suite: CipherSuite,
        kek_ref: &str,
    ) -> Result<SymKey, LockstoreError> {
        let pkcs11_uri_str = kek_ref.strip_prefix(KEK_REF_PREFIX).ok_or_else(|| {
            LockstoreError::InvalidKekRef(format!("Invalid kek_ref format: {}", kek_ref))
        })?;
        let uri = nss_rs::pk11_utils::parse(pkcs11_uri_str).map_err(|_| {
            LockstoreError::InvalidKekRef(format!("Invalid PKCS#11 URI: {}", kek_ref))
        })?;
        let slot = self.resolve_pkcs11_slot(&uri)?;

        slot.authenticate()
            .map_err(|_| LockstoreError::AuthenticationCancelled)?;

        if let Some(existing) = slot.find_key_by_nickname(kek_ref) {
            return Ok(existing);
        }

        slot.generate_token_key(
            p11::CKM_AES_KEY_GEN.into(),
            cipher_suite.key_size(),
            kek_ref,
        )
        .map_err(|e| LockstoreError::TokenError(format!("Failed to generate key: {}", e)))
    }

    fn resolve_pkcs11_slot(
        &self,
        uri: &nss_rs::pk11_utils::Pkcs11Uri,
    ) -> Result<p11::Slot, LockstoreError> {
        let token_name = uri.token.as_deref().ok_or_else(|| {
            LockstoreError::InvalidKekRef("PKCS#11 URI missing token attribute".into())
        })?;

        let internal_slot = p11::Slot::internal_key_slot()
            .map_err(|e| LockstoreError::TokenError(format!("Failed to get key slot: {}", e)))?;
        if internal_slot.token_name() == token_name {
            return Ok(internal_slot);
        }

        let slots = p11::all_token_slots(p11::CKM_AES_KEY_GEN.into());
        for slot in slots {
            if slot.token_name() == token_name {
                return Ok(slot);
            }
        }

        Err(LockstoreError::TokenError(format!(
            "Token not found: {}",
            token_name
        )))
    }

    // Metadata persistence (`load_metadata`, `save_metadata`) lives on
    // `ConnectionHandle` so the type system enforces that the caller
    // holds the connection lock.
}
