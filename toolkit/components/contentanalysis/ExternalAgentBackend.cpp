/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "ExternalAgentBackend.h"

#include "mozilla/Assertions.h"

namespace mozilla::contentanalysis {

ExternalAgentBackend::ExternalAgentBackend() = default;

void ExternalAgentBackend::OnMaxConnectionsPrefChanged() {
  MOZ_ASSERT_UNREACHABLE(
      "ExternalAgentBackend::OnMaxConnectionsPrefChanged not yet wired up (bug "
      "2044479)");
}

ExternalAgentBackend::~ExternalAgentBackend() = default;

void ExternalAgentBackend::Shutdown() {
  MOZ_ASSERT_UNREACHABLE(
      "ExternalAgentBackend::Shutdown not yet wired up (bug 2044479)");
}

nsresult ExternalAgentBackend::ForceReinitializeForTest() {
  MOZ_ASSERT_UNREACHABLE(
      "ExternalAgentBackend::ForceReinitializeForTest not yet wired up (bug "
      "2044479)");
  return NS_ERROR_NOT_IMPLEMENTED;
}

bool ExternalAgentBackend::IsCreatingClientForTest() const {
  MOZ_ASSERT_UNREACHABLE(
      "ExternalAgentBackend::IsCreatingClientForTest not yet wired up (bug "
      "2044479)");
  return false;
}

nsresult ExternalAgentBackend::EnsureReady() {
  MOZ_ASSERT_UNREACHABLE(
      "ExternalAgentBackend::EnsureReady not yet wired up (bug 2044479)");
  return NS_ERROR_NOT_IMPLEMENTED;
}

void ExternalAgentBackend::CancelUserAction(const nsACString& aUserActionId) {
  MOZ_ASSERT_UNREACHABLE(
      "ExternalAgentBackend::CancelUserAction not yet wired up (bug 2044479)");
}

nsresult ExternalAgentBackend::Analyze(
    nsCOMPtr<nsIContentAnalysisRequest> aRequest, bool aAutoAcknowledge) {
  MOZ_ASSERT_UNREACHABLE(
      "ExternalAgentBackend::Analyze not yet wired up (bug 2044479)");
  return NS_ERROR_NOT_IMPLEMENTED;
}

bool ExternalAgentBackend::IsResponsePendingForRequest(
    const nsACString& aRequestToken) {
  MOZ_ASSERT_UNREACHABLE(
      "ExternalAgentBackend::HasGottenResponseForRequest not yet wired up (bug "
      "2044479)");
  return false;
}

nsresult ExternalAgentBackend::Acknowledge(
    nsCOMPtr<nsIContentAnalysisAcknowledgement> aAcknowledgement,
    const nsACString& aRequestToken) {
  MOZ_ASSERT_UNREACHABLE(
      "ExternalAgentBackend::Acknowledge not yet wired up (bug 2044479)");
  return NS_ERROR_NOT_IMPLEMENTED;
}

RefPtr<ContentAnalysisBackend::DiagnosticInfoPromise>
ExternalAgentBackend::GetDiagnosticInfo() {
  MOZ_ASSERT_UNREACHABLE(
      "ExternalAgentBackend::GetDiagnosticInfo not yet wired up (bug 2044479)");
  return nullptr;
}

}  // namespace mozilla::contentanalysis
