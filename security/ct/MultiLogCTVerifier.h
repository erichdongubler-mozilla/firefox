/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef MultiLogCTVerifier_h
#define MultiLogCTVerifier_h

#include <vector>

#include "CTLogVerifier.h"
#include "CTVerifyResult.h"
#include "SignedCertificateTimestamp.h"
#include "mozpkix/Input.h"
#include "mozpkix/Result.h"
#include "mozpkix/Time.h"
#include "signature_cache_ffi.h"
#include "mozilla/UniquePtr.h"

namespace mozilla {
namespace ct {

void DecodeSCTs(pkix::Input encodedSctList,
                std::vector<SignedCertificateTimestamp>& decodedSCTs,
                size_t& decodingErrors);

// A Certificate Transparency verifier that can verify Signed Certificate
// Timestamps from multiple logs.
class MultiLogCTVerifier {
 public:
  MultiLogCTVerifier();

  // Adds a new log to the list of known logs to verify against.
  void AddLog(CTLogVerifier&& log);

  // Verifies SCTs embedded in the certificate itself, SCTs embedded in a
  // stapled OCSP response, and SCTs obtained via the
  // signed_certificate_timestamp TLS extension on the given |cert|.
  //
  // A certificate is permitted but not required to use multiple sources for
  // SCTs. It is expected that most certificates will use only one source
  // (embedding, TLS extension or OCSP stapling).
  //
  // The verifier stops on fatal errors (such as out of memory or invalid
  // DER encoding of |cert|), but it does not stop on SCT decoding errors. See
  // CTVerifyResult for more details.
  //
  // The internal state of the verifier object is not modified
  // during the verification process.
  //
  // |cert|  DER-encoded certificate to be validated using the provided SCTs.
  // |sctListFromCert|  SCT list embedded in |cert|, empty if not present.
  // |issuerSubjectPublicKeyInfo|  SPKI of |cert|'s issuer. Can be empty,
  //                               in which case the embedded SCT list
  //                               won't be verified.
  // |sctListFromOCSPResponse|  SCT list included in a stapled OCSP response
  //                            for |cert|. Empty if not available.
  // |sctListFromTLSExtension|  The SCT list from the TLS extension. Empty
  //                            if no extension was present.
  // |time|  The current time. Used to make sure SCTs are not in the future.
  // |distrustAfterTime|  If the root CA has a time past which newly issued
  //                      certificates are no longer trusted, this will be set
  //                      to that time. Used to ensure no SCTs with timestamps
  //                      after that time are accepted.
  // |result|  will be filled with the SCTs present, divided into categories
  //           based on the verification result.
  pkix::Result Verify(pkix::Input cert, pkix::Input issuerSubjectPublicKeyInfo,
                      pkix::Input sctListFromCert,
                      pkix::Input sctListFromOCSPResponse,
                      pkix::Input sctListFromTLSExtension, pkix::Time time,
                      Maybe<pkix::Time> distrustAfterTime,
                      CTVerifyResult& result);

 private:
  // Verifies a list of SCTs from |encodedSctList| over |expectedEntry|,
  // placing the verification results in |result|. The SCTs in the list
  // come from |origin| (as will be reflected in the origin field of each SCT).
  pkix::Result VerifySCTs(pkix::Input encodedSctList,
                          const LogEntry& expectedEntry, SCTOrigin origin,
                          pkix::Time time, Maybe<pkix::Time> distrustAfterTime,
                          CTVerifyResult& result);

  // Verifies a single, parsed SCT against all known logs.
  // Note: moves |sct| to the target list in |result|, invalidating |sct|.
  pkix::Result VerifySingleSCT(SignedCertificateTimestamp&& sct,
                               const ct::LogEntry& expectedEntry,
                               SCTOrigin origin, pkix::Time time,
                               Maybe<pkix::Time> distrustAfterTime,
                               CTVerifyResult& result);

  // The list of known logs.
  std::vector<CTLogVerifier> mLogs;

  // If many connections are made to a site using a particular certificate,
  // this cache will speed up verifications after the first one by saving the
  // results of verifying the signatures on the SCTs for that certificate.
  UniquePtr<SignatureCache, decltype(&signature_cache_free)> mSignatureCache;
};

}  // namespace ct
}  // namespace mozilla

#endif  // MultiLogCTVerifier_h
