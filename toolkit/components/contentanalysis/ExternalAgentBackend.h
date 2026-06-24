/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#ifndef mozilla_externalagentbackend_h
#define mozilla_externalagentbackend_h

#include "ContentAnalysisBackend.h"
#include "mozilla/RefPtr.h"
#include "nsError.h"

namespace mozilla::contentanalysis {

// Backend that talks to an out-of-process DLP agent via the content_analysis
// SDK. Owns the SDK client connection, the background thread pool used for
// agent IO, and the retry-on-disconnect logic.
class ExternalAgentBackend final : public ContentAnalysisBackend {
 public:
  ExternalAgentBackend();

  ExternalAgentBackend(const ExternalAgentBackend&) = delete;
  ExternalAgentBackend& operator=(const ExternalAgentBackend&) = delete;

  nsresult EnsureReady() override;
  nsresult Analyze(nsCOMPtr<nsIContentAnalysisRequest> aRequest,
                   bool aAutoAcknowledge) override;
  nsresult Acknowledge(
      nsCOMPtr<nsIContentAnalysisAcknowledgement> aAcknowledgement,
      const nsACString& aRequestToken) override;
  void CancelUserAction(const nsACString& aUserActionId) override;
  RefPtr<DiagnosticInfoPromise> GetDiagnosticInfo() override;
  void Shutdown() override;
  nsresult ForceReinitializeForTest() override;

  bool IsCreatingClientForTest() const override;

  void OnMaxConnectionsPrefChanged() override;
  bool IsResponsePendingForRequest(const nsACString& aRequestToken) override;

 protected:
  ~ExternalAgentBackend() override;
};

}  // namespace mozilla::contentanalysis

#endif  // mozilla_externalagentbackend_h
