/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8  et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SpeechRecognitionParent.h"

#include <algorithm>

#include "mozilla/Logging.h"
#include "mozilla/hwinference/HWInferenceChild.h"
#include "mozilla/ipc/FileDescriptorUtils.h"
#include "mozilla/ipc/ProtocolUtils.h"
#include "mozilla/ipc/UtilityProcessChild.h"
#include "nsDebug.h"
#include "nsReadableUtils.h"
#include "nsString.h"
#include "nsThreadUtils.h"

namespace mozilla::hwinference {

static LazyLogModule gSpeechRecognitionParentLog("SpeechRecognitionParent");

#define LOGV(fmt, ...)                                             \
  MOZ_LOG_FMT(gSpeechRecognitionParentLog, LogLevel::Verbose, fmt, \
              ##__VA_ARGS__)
#define LOGD(fmt, ...) \
  MOZ_LOG_FMT(gSpeechRecognitionParentLog, LogLevel::Debug, fmt, ##__VA_ARGS__)
#define LOGE(fmt, ...) \
  MOZ_LOG_FMT(gSpeechRecognitionParentLog, LogLevel::Error, fmt, ##__VA_ARGS__)

SpeechRecognitionParent::SpeechRecognitionParent(
    dom::ContentParentId aContentId)
    : mContentId(aContentId) {
  LOGD("{}", __func__);
}

SpeechRecognitionParent::~SpeechRecognitionParent() { LOGD("{}", __func__); }

SpeechRecognitionParent::ModelIdentifier
SpeechRecognitionParent::LanguagesToModelIdentifier(
    const nsTArray<nsCString>&) {
  // For now this ignores the requested languages and always returns a single
  // hardcoded model. Per-language selection and generalization to more models
  // land in a later patch in this stack.
  // mudler/parakeet.cpp cache-aware streaming GGUF, hosted on the Mozilla
  // model hub under asr-test/parakeet.
  return {"asr-test/parakeet"_ns, "realtime_eou_120m-v1-q5_k.gguf"_ns,
          "main"_ns};
}

nsCString SpeechRecognitionParent::ModelIdentifier::ToString() const {
  return nsFmtCString("{}/{}/{}", mModelName.get(), mFileName.get(),
                      mRevision.get());
}

mozilla::ipc::IPCResult SpeechRecognitionParent::RunHWInferenceBoolQuery(
    const char* aFuncName,
    std::function<RefPtr<MozPromise<bool, ResponseRejectReason, true>>(
        hwinference::HWInferenceChild*)>
        aSendFunc,
    std::function<void(const bool&)> aResolver) {
  RefPtr<mozilla::ipc::UtilityProcessChild> utilityChild =
      mozilla::ipc::UtilityProcessChild::GetSingleton();
  if (!utilityChild) {
    LOGE("{} No UtilityProcessChild available", aFuncName);
    aResolver(false);
    return IPC_OK();
  }

  HWInferenceChild* hwInferenceChild = utilityChild->GetHWInferenceChild();
  if (!hwInferenceChild) {
    LOGE("{} No HWInferenceChild available", aFuncName);
    aResolver(false);
    return IPC_OK();
  }

  aSendFunc(hwInferenceChild)
      ->Then(GetCurrentSerialEventTarget(), __func__,
             [self = RefPtr{this}, aResolver = std::move(aResolver), aFuncName](
                 MozPromise<bool, ResponseRejectReason,
                            true>::ResolveOrRejectValue&& aValue) mutable {
               if (aValue.IsResolve()) {
                 LOGD("{} Sending response back to content process: {}",
                      aFuncName, aValue.ResolveValue() ? "true" : "false");
                 aResolver(aValue.ResolveValue());
               } else {
                 LOGE("{} IPC call to main process failed: {}", aFuncName,
                      static_cast<int>(aValue.RejectValue()));
                 aResolver(false);
               }
             });

  return IPC_OK();
}

mozilla::ipc::IPCResult SpeechRecognitionParent::RecvIsModelAvailable(
    const nsTArray<nsCString>& aLanguages,
    IsModelAvailableResolver&& aResolver) {
  if (aLanguages.IsEmpty()) {
    return IPC_FAIL(this,
                    "RecvIsModelAvailable requires at least one language");
  }

  nsCString modelId = dom::LanguagesToSpeechModelId(aLanguages);
  LOGD("{} languages: {} mapped to id={}", __func__,
       fmt::join(aLanguages, ", "), modelId.get());

  return RunHWInferenceBoolQuery(
      __func__,
      [modelId](hwinference::HWInferenceChild* aChild) {
        return aChild->SendIsModelAvailable(
            nsCString(dom::kSpeechRecognitionTask), modelId);
      },
      std::move(aResolver));
}

mozilla::ipc::IPCResult SpeechRecognitionParent::RecvInstallModels(
    const nsTArray<nsCString>& aLanguages, InstallModelsResolver&& aResolver) {
  if (aLanguages.IsEmpty()) {
    return IPC_FAIL(this, "RecvInstallModels requires at least one language");
  }

  nsCString modelId = dom::LanguagesToSpeechModelId(aLanguages);
  LOGD("{} languages: {} mapped to id={}", __func__,
       fmt::join(aLanguages, ", "), modelId.get());

  const dom::ContentParentId contentId =
      mozilla::ipc::ActorCast<HWInferenceManagerParent>(Manager())->ContentId();

  return RunHWInferenceBoolQuery(
      __func__,
      [modelId, contentId](hwinference::HWInferenceChild* aChild) {
        return aChild->SendInstallModel(dom::kSpeechRecognitionTask, modelId, 0,
                                        contentId);
      },
      std::move(aResolver));
}

void SpeechRecognitionParent::ActorDestroy(ActorDestroyReason aReason) {
  LOGD("{} ActorDestroy called", __func__);
}

}  // namespace mozilla::hwinference

#undef LOGV
#undef LOGD
#undef LOGE
