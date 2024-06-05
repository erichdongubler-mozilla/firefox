/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use pkcs11_bindings::*;
use rsclientcerts::cryptoki::*;
use rsclientcerts::manager::{ClientCertsBackend, CryptokiObject, FindObjectsCallback, Sign};
use rsclientcerts_util::error::{Error, ErrorType};
use rsclientcerts_util::error_here;
use std::ffi::c_void;

// Wrapper of C RemoteCertsDoFindObjects function implemented in PKCS11ModuleDB.cpp
fn remote_certs_do_find_objects(callback: FindObjectsCallback, ctx: &mut FindObjectsContext) {
    // `RemoteCertsDoFindObjects` queries the remote PKCS#11 module process for
    // certificates.
    unsafe extern "C" {
        fn RemoteCertsDoFindObjects(callback: FindObjectsCallback, ctx: *mut c_void);
    }

    unsafe {
        RemoteCertsDoFindObjects(callback, ctx as *mut _ as *mut c_void);
    }
}

pub struct Key {}

impl CryptokiObject for Key {
    fn matches(&self, _attrs: &[(CK_ATTRIBUTE_TYPE, Vec<u8>)]) -> bool {
        false
    }

    fn get_attribute(&self, _attribute: CK_ATTRIBUTE_TYPE) -> Option<&[u8]> {
        None
    }
}

impl Sign for Key {
    fn get_signature_length(
        &mut self,
        _data: &[u8],
        _params: &Option<CK_RSA_PKCS_PSS_PARAMS>,
    ) -> Result<usize, Error> {
        return Err(error_here!(ErrorType::LibraryFailure));
    }

    fn sign(
        &mut self,
        _data: &[u8],
        _params: &Option<CK_RSA_PKCS_PSS_PARAMS>,
    ) -> Result<Vec<u8>, Error> {
        return Err(error_here!(ErrorType::LibraryFailure));
    }
}

unsafe extern "C" fn find_objects_callback(
    typ: u8,
    data_len: usize,
    data: *const u8,
    extra_len: usize,
    extra: *const u8,
    ctx: *mut c_void,
) {
    let data = if data_len == 0 || data.is_null() {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(data, data_len) }
    }
    .to_vec();
    let extra = if extra_len == 0 || extra.is_null() {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(extra, extra_len) }
    }
    .to_vec();
    let find_objects_context: &mut FindObjectsContext = unsafe { std::mem::transmute(ctx) };
    match typ {
        1 => {
            // For remotecerts, the extra data in the case of certificates is a byte indicating if
            // the certificate is a TLS server auth trust anchor. Only add trust records for trust anchors.
            if extra == &[1] {
                if let Ok(trust) =
                    CryptokiTrust::new(&data, b"remote certificate trust".to_vec(), true)
                {
                    find_objects_context.trusts.push(trust);
                }
            }
            if let Ok(cert) = CryptokiCert::new(data, b"remote certificate".to_vec()) {
                find_objects_context.certs.push(cert);
            }
        }
        _ => {}
    }
}

struct FindObjectsContext {
    certs: Vec<CryptokiCert>,
    keys: Vec<Key>,
    trusts: Vec<CryptokiTrust>,
}

impl FindObjectsContext {
    fn new() -> FindObjectsContext {
        FindObjectsContext {
            certs: Vec::new(),
            keys: Vec::new(),
            trusts: Vec::new(),
        }
    }
}

const SLOT_DESCRIPTION_BYTES: &[u8; 64] =
    b"Remote Certificates and Keys                                    ";
const TOKEN_LABEL_BYTES: &[u8; 32] = b"Remote Certificates and Keys    ";
const TOKEN_MODEL_BYTES: &[u8; 16] = b"remotecerts     ";
const TOKEN_SERIAL_NUMBER_BYTES: &[u8; 16] = b"0000000000000000";

unsafe extern "C" {
    fn IsGeckoSearchingForClientAuthCertificates(unique_slot_id: u64) -> bool;
    fn IsGeckoSearchingForCertificates(unique_slot_id: u64) -> bool;
}

const UNIQUE_MODULE_ID: u64 = (u32::from_be_bytes(*b"RCRT") as u64) << 32;

pub struct Backend {}

impl Backend {
    pub fn new() -> Backend {
        Backend {}
    }
}

impl ClientCertsBackend for Backend {
    type Key = Key;

    fn find_objects(
        &mut self,
        slot_id: CK_SLOT_ID,
    ) -> Result<Option<(Vec<CryptokiCert>, Vec<Key>, Vec<CryptokiTrust>)>, Error> {
        if !unsafe {
            IsGeckoSearchingForClientAuthCertificates(UNIQUE_MODULE_ID | (slot_id as u64))
        } && !unsafe { IsGeckoSearchingForCertificates(UNIQUE_MODULE_ID | (slot_id as u64)) }
        {
            return Ok(None);
        }

        let mut find_objects_context = FindObjectsContext::new();
        remote_certs_do_find_objects(Some(find_objects_callback), &mut find_objects_context);
        Ok(Some((
            find_objects_context.certs,
            find_objects_context.keys,
            find_objects_context.trusts,
        )))
    }

    fn get_slot_info(&self) -> CK_SLOT_INFO {
        CK_SLOT_INFO {
            slotDescription: *SLOT_DESCRIPTION_BYTES,
            manufacturerID: *crate::MANUFACTURER_ID_BYTES,
            flags: CKF_TOKEN_PRESENT,
            ..Default::default()
        }
    }

    fn get_token_info(&self) -> CK_TOKEN_INFO {
        CK_TOKEN_INFO {
            label: *TOKEN_LABEL_BYTES,
            manufacturerID: *crate::MANUFACTURER_ID_BYTES,
            model: *TOKEN_MODEL_BYTES,
            serialNumber: *TOKEN_SERIAL_NUMBER_BYTES,
            ..Default::default()
        }
    }

    fn get_mechanism_list(&self) -> Vec<CK_MECHANISM_TYPE> {
        vec![CKM_ECDSA, CKM_RSA_PKCS, CKM_RSA_PKCS_PSS]
    }
}
