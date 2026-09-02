/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8  et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SpeechRecognitionParent.h"

#include <algorithm>
#include <chrono>
#include <thread>

#include "mozilla/Logging.h"
#include "mozilla/Mutex.h"
#include "mozilla/StaticMutex.h"
#include "mozilla/StaticPrefs_browser.h"
#include "mozilla/StaticPrefs_media.h"
#include "mozilla/StaticPtr.h"
#include "mozilla/hwinference/HWInferenceChild.h"
#include "mozilla/ipc/FileDescriptorUtils.h"
#include "mozilla/ipc/ProtocolUtils.h"
#include "mozilla/ipc/UtilityProcessChild.h"
#include "mozilla/llama/LlamaRuntimeLinker.h"
#include "nsDebug.h"
#include "nsReadableUtils.h"
#include "nsString.h"
#include "nsThreadUtils.h"

namespace mozilla::hwinference {

// Static initialization
StaticRefPtr<SpeechRecognitionParent> SpeechRecognitionParent::sActiveSession;
StaticMutex SpeechRecognitionParent::sSessionMutex;

static LazyLogModule gSpeechRecognitionParentLog("SpeechRecognitionParent");
#define LOGV(fmt, ...)                                             \
  MOZ_LOG_FMT(gSpeechRecognitionParentLog, LogLevel::Verbose, fmt, \
              ##__VA_ARGS__)
#define LOGD(fmt, ...) \
  MOZ_LOG_FMT(gSpeechRecognitionParentLog, LogLevel::Debug, fmt, ##__VA_ARGS__)
#define LOGE(fmt, ...) \
  MOZ_LOG_FMT(gSpeechRecognitionParentLog, LogLevel::Error, fmt, ##__VA_ARGS__)

// Task name the model hub files speech recognition models under.
static constexpr auto kSpeechRecognitionTask = "speech-recognition"_ns;

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

void SpeechRecognitionParent::ResolveOrRejectInitOnIPCThread(
    InitResolver&& aResolver, bool aSuccess) {
  if (GetActorEventTarget()->IsOnCurrentThread()) {
    LOGV("Resolving init on same thread {}", aSuccess);
    aResolver(aSuccess);
  } else {
    LOGV("Resolving init accross thread {}", aSuccess);
    GetActorEventTarget()->Dispatch(NS_NewRunnableFunction(
        "Speech recognition init runnable",
        [resolver = std::move(aResolver), aSuccess]() {
          LOGV("Resolving init accross thread {}", aSuccess);
          resolver(aSuccess);
        }));
  }
}

mozilla::ipc::IPCResult SpeechRecognitionParent::RunHWInferenceBoolQuery(
    const char* aFuncName,
    std::function<RefPtr<BoolPromise>(hwinference::HWInferenceChild*)>
        aSendFunc,
    std::function<void(const bool&)> aResolver,
    MozPromiseRequestHolder<BoolPromise>& aRequestHolder) {
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
             [self = RefPtr{this}, aResolver = std::move(aResolver), aFuncName,
              &aRequestHolder](
                 BoolPromise::ResolveOrRejectValue&& aValue) mutable {
               aRequestHolder.Complete();
               if (aValue.IsResolve()) {
                 LOGD("{} Sending response back to content process: {}",
                      aFuncName, aValue.ResolveValue() ? "true" : "false");
                 aResolver(aValue.ResolveValue());
               } else {
                 LOGE("{} IPC call to main process failed: {}", aFuncName,
                      static_cast<int>(aValue.RejectValue()));
                 aResolver(false);
               }
             })
      ->Track(aRequestHolder);

  return IPC_OK();
}

mozilla::ipc::IPCResult SpeechRecognitionParent::RecvIsModelAvailable(
    const nsTArray<nsCString>& aLanguages,
    IsModelAvailableResolver&& aResolver) {
  if (aLanguages.IsEmpty()) {
    return IPC_FAIL(this,
                    "RecvIsModelAvailable requires at least one language");
  }

  nsCString modelId = LanguagesToModelIdentifier(aLanguages).ToString();
  LOGD("{} languages: {} mapped to id={}", __func__,
       fmt::join(aLanguages, ", "), modelId.get());

  return RunHWInferenceBoolQuery(
      __func__,
      [modelId](hwinference::HWInferenceChild* aChild) {
        return aChild->SendIsModelAvailable(nsCString(kSpeechRecognitionTask),
                                            modelId);
      },
      std::move(aResolver), mIsModelAvailableRequest);
}

mozilla::ipc::IPCResult SpeechRecognitionParent::RecvInstallModels(
    const nsTArray<nsCString>& aLanguages, InstallModelsResolver&& aResolver) {
  if (aLanguages.IsEmpty()) {
    return IPC_FAIL(this, "RecvInstallModels requires at least one language");
  }

  nsCString modelId = LanguagesToModelIdentifier(aLanguages).ToString();
  LOGD("{} languages: {} mapped to id={}", __func__,
       fmt::join(aLanguages, ", "), modelId.get());

  const dom::ContentParentId contentId =
      mozilla::ipc::ActorCast<HWInferenceManagerParent>(Manager())->ContentId();

  return RunHWInferenceBoolQuery(
      __func__,
      [modelId, contentId](hwinference::HWInferenceChild* aChild) {
        return aChild->SendInstallModel(kSpeechRecognitionTask, modelId, 0,
                                        contentId);
      },
      std::move(aResolver), mInstallModelRequest);
}

SpeechRecognitionParent::SpeechRecognitionParent(
    dom::ContentParentId aContentId)
    : mContentId(aContentId),
      mLock("SpeechRecognitionLock"),
      mShouldContinueProcessing(false) {}

void SpeechRecognitionParent::RetrieveModel(InitResolver&& aResolver) {
  MOZ_ASSERT(NS_IsMainThread());
  RefPtr<mozilla::ipc::UtilityProcessChild> utilityChild =
      mozilla::ipc::UtilityProcessChild::GetSingleton();
  if (!utilityChild) {
    LOGE("{} ERROR: No UtilityProcessChild available", __func__);
    ResolveOrRejectInitOnIPCThread(std::move(aResolver), false);
    return;
  }
  mozilla::hwinference::HWInferenceChild* hwInferenceChild =
      utilityChild->GetHWInferenceChild();
  if (!hwInferenceChild) {
    LOGE("{} No HWInferenceChild available for model retrieval", __func__);
    ResolveOrRejectInitOnIPCThread(std::move(aResolver), false);
    return;
  }

  nsCString modelId;
  {
    MutexAutoLock lock(mLock);
    modelId = LanguagesToModelIdentifier(nsTArray{mLanguage}).ToString();
  }

  LOGD("{} Checking model is installed: id={}", __func__, modelId.get());

  // Only SpeechRecognition::Install() may download a model, behind its own
  // permission doorhanger. start() requires the model to already be
  // installed, so check that before FetchModelFile() rather than letting
  // GetModelFile download it on demand.
  hwInferenceChild
      ->SendIsModelInstalled(nsCString(kSpeechRecognitionTask), modelId)
      ->Then(GetCurrentSerialEventTarget(), __func__,
             [self = RefPtr{this}, aResolver = std::move(aResolver),
              modelId](hwinference::PHWInferenceChild::IsModelInstalledPromise::
                           ResolveOrRejectValue&& aValue) mutable {
               self->mRetrieveModelIsInstalledRequest.Complete();
               if (!aValue.IsResolve() || !aValue.ResolveValue()) {
                 LOGE(
                     "{} model {} is not installed; call "
                     "SpeechRecognition.install() first",
                     __func__, modelId.get());
                 self->ResolveOrRejectInitOnIPCThread(std::move(aResolver),
                                                      false);
                 return;
               }
               self->FetchModelFile(modelId, std::move(aResolver));
             })
      ->Track(mRetrieveModelIsInstalledRequest);
}

void SpeechRecognitionParent::FetchModelFile(const nsCString& aModelId,
                                             InitResolver&& aResolver) {
  MOZ_ASSERT(NS_IsMainThread());
  RefPtr<mozilla::ipc::UtilityProcessChild> utilityChild =
      mozilla::ipc::UtilityProcessChild::GetSingleton();
  mozilla::hwinference::HWInferenceChild* hwInferenceChild =
      utilityChild ? utilityChild->GetHWInferenceChild() : nullptr;
  if (!hwInferenceChild) {
    LOGE("{} No HWInferenceChild available for model retrieval", __func__);
    ResolveOrRejectInitOnIPCThread(std::move(aResolver), false);
    return;
  }

  LOGD("{} Requesting model: id={}", __func__, aModelId.get());

  hwInferenceChild
      ->SendGetModelFile(nsCString(kSpeechRecognitionTask), aModelId)
      ->Then(
          GetCurrentSerialEventTarget(), __func__,
          [self = RefPtr{this}, aResolver = std::move(aResolver)](
              hwinference::PHWInferenceChild::GetModelFilePromise::
                  ResolveOrRejectValue&& aValue) mutable {
            self->mGetModelFileRequest.Complete();
            if (aValue.IsReject()) {
              LOGE("{} Promise rejected with reason {}", __func__,
                   static_cast<int>(aValue.RejectValue()));
              self->ResolveOrRejectInitOnIPCThread(std::move(aResolver), false);
              return;
            }

            const mozilla::hwinference::GetModelFileResult& result =
                aValue.ResolveValue();
            if (result.type() ==
                mozilla::hwinference::GetModelFileResult::TGetModelError) {
              LOGE("{} GetModelError with nsresult={:x}", __func__,
                   static_cast<uint32_t>(
                       result.get_GetModelError().errorCode()));
              self->ResolveOrRejectInitOnIPCThread(std::move(aResolver), false);
              return;
            }

            // Convert FileDescriptor to FILE* using the helper function
            mozilla::ipc::FileDescriptor fd =
                result.get_GetModelFileSuccess().fd();

            FILE* file = FileDescriptorToFILE(fd, "rb");
            if (!file) {
              LOGE("{} Failed to convert FileDescriptor to FILE*", __func__);
              self->ResolveOrRejectInitOnIPCThread(std::move(aResolver), false);
              return;
            }
            // Store the file handle on the main thread
            {
              MutexAutoLock lock(self->mLock);
              self->mModelFile.reset(file);
            }

            // Signal the recognition thread that the model is ready
            LOGD("Model file ready, starting recognition thread");
            nsresult rv = NS_NewNamedThread(
                "Parakeet", getter_AddRefs(self->mRecognitionThread));
            if (NS_FAILED(rv)) {
              LOGE("Failed to create recognition thread: {:x}",
                   static_cast<uint32_t>(rv));
              self->ResolveOrRejectInitOnIPCThread(std::move(aResolver), false);
              return;
            }
            self->mRecognitionThread->Dispatch(NS_NewRunnableFunction(
                "Initialize parakeet context",
                [self, aResolver = std::move(aResolver)]() mutable {
                  self->InitializeParakeetContext(std::move(aResolver));
                }));
          })
      ->Track(mGetModelFileRequest);
}

void SpeechRecognitionParent::InitializeParakeetContext(
    InitResolver&& aResolver) {
  // This runs on the recognition thread
  MOZ_ASSERT(mRecognitionThread->IsOnCurrentThread());

  mozilla::llama::LlamaLibWrapper* lib =
      mozilla::llama::LlamaRuntimeLinker::Get();
  if (!lib) {
    LOGE("{} Failed to get runtime linker", __func__);
    ResolveOrRejectInitOnIPCThread(std::move(aResolver), false);
    return;
  }

  // Route ggml logs through gSpeechRecognitionParentLog instead of its
  // default unconditional stderr logging.
  lib->llama_log_set(
      [](ggml_log_level level, const char* text, void* /* user_data */) {
        switch (level) {
          case GGML_LOG_LEVEL_NONE:
            MOZ_LOG(gSpeechRecognitionParentLog, LogLevel::Disabled,
                    ("%s", text));
            break;
          case GGML_LOG_LEVEL_DEBUG:
            MOZ_LOG(gSpeechRecognitionParentLog, LogLevel::Debug, ("%s", text));
            break;
          case GGML_LOG_LEVEL_INFO:
            MOZ_LOG(gSpeechRecognitionParentLog, LogLevel::Info, ("%s", text));
            break;
          case GGML_LOG_LEVEL_WARN:
            MOZ_LOG(gSpeechRecognitionParentLog, LogLevel::Warning,
                    ("%s", text));
            break;
          case GGML_LOG_LEVEL_ERROR:
            MOZ_LOG(gSpeechRecognitionParentLog, LogLevel::Error, ("%s", text));
            break;
          default:
            MOZ_LOG(gSpeechRecognitionParentLog, LogLevel::Verbose,
                    ("%s", text));
            break;
        }
      },
      nullptr);

  // Test-only: widen the window before mLock is acquired below, so a test
  // can deterministically land ActorDestroy() (running on another thread)
  // in that window instead of relying on scheduling luck.
  int32_t testDelayMs =
      StaticPrefs::media_webspeech_recognition_testing_parakeet_init_delay_ms();
  if (testDelayMs > 0) {
    std::this_thread::sleep_for(std::chrono::milliseconds(testDelayMs));
  }

  // ActorDestroy() can run concurrently on the main thread while this is
  // delayed above (or otherwise still in flight). Bail out instead of
  // resurrecting mShouldContinueProcessing and starting a streaming loop
  // nobody will ever stop, or touching mModelFile after ActorDestroy has
  // cleared it.
  if (mActorDestroyed.load()) {
    LOGD("{} Actor already destroyed, abandoning init", __func__);
    return;
  }

  FILE* modelFile = nullptr;
  nsCString language;
  {
    MutexAutoLock lock(mLock);
    modelFile = mModelFile.get();
    language = mLanguage;
  }

  mCapiCtx = lib->parakeet_capi_load_fd(fileno(modelFile));
  if (!mCapiCtx) {
    LOGE("{} parakeet_capi_load_fd failed", __func__);
    ResolveOrRejectInitOnIPCThread(std::move(aResolver), false);
    return;
  }
  // parakeet reads the whole GGUF into memory during load_fd; the model file
  // isn't needed past this point.
  {
    MutexAutoLock lock(mLock);
    mModelFile = nullptr;
  }
  const char* langArg = language.IsEmpty() ? nullptr : language.get();
  mCapiStream = lib->parakeet_capi_stream_begin_lang(mCapiCtx, langArg);
  if (!mCapiStream && langArg) {
    // The multilingual model rejects languages outside its dictionary; rather
    // than fail the session, fall back to auto-detection.
    LOGD("stream_begin_lang('{}') failed; falling back to auto-detection",
         langArg);
    mCapiStream = lib->parakeet_capi_stream_begin_lang(mCapiCtx, "auto");
  }
  if (!mCapiStream) {
    LOGE("{} parakeet_capi_stream_begin_lang failed", __func__);
    ResolveOrRejectInitOnIPCThread(std::move(aResolver), false);
    return;
  }

  mShouldContinueProcessing.store(true);
  ResolveOrRejectInitOnIPCThread(std::move(aResolver), true);
  LOGD("Parakeet streaming session ready, starting streaming loop");

  // Already running on mRecognitionThread, so just call directly instead of
  // dispatching back onto it.
  ProcessAudioStreaming();
}

SpeechRecognitionParent::~SpeechRecognitionParent() {
  LOGD("{}", __func__);

  // Clear active session if this was it
  {
    StaticMutexAutoLock lock(sSessionMutex);
    if (sActiveSession == this) {
      LOGD("Clearing active session in destructor");
      sActiveSession = nullptr;
    }
  }
}

void SpeechRecognitionParent::ActorDestroy(ActorDestroyReason aReason) {
  LOGD("{} ActorDestroy called", __func__);

  mShouldContinueProcessing.store(false);
  mActorDestroyed.store(true);

  // Disconnect outstanding requests to the utility process so their
  // resolve/reject callbacks never run and try to resolve a dead IPDL
  // resolver after this actor is torn down.
  mIsModelAvailableRequest.DisconnectIfExists();
  mRetrieveModelIsInstalledRequest.DisconnectIfExists();
  mInstallModelRequest.DisconnectIfExists();
  mGetModelFileRequest.DisconnectIfExists();

  // Shutdown() joins the recognition thread, which can be blocked trying to
  // acquire mLock in InitializeParakeetContext. Join before taking the lock,
  // or that thread can never make progress and Shutdown() never returns.
  if (mRecognitionThread) {
    mRecognitionThread->Shutdown();
    mRecognitionThread = nullptr;
  }

  {
    MutexAutoLock lock(mLock);
    if (mModelFile) {
      mModelFile = nullptr;
    }
  }

  if (mCapiStream || mCapiCtx) {
    mozilla::llama::LlamaLibWrapper* lib =
        mozilla::llama::LlamaRuntimeLinker::Get();
    if (lib) {
      if (mCapiStream) {
        lib->parakeet_capi_stream_free(mCapiStream);
      }
      if (mCapiCtx) {
        lib->parakeet_capi_free(mCapiCtx);
      }
    }
    mCapiStream = nullptr;
    mCapiCtx = nullptr;
  }
}

mozilla::ipc::IPCResult SpeechRecognitionParent::RecvInit(
    const nsCString& aEngineId, const nsCString& aLanguage,
    const nsTArray<nsString>& aPhrases, InitResolver&& aResolver) {
  LOGD("{} engineId='{}' language='{}'", __func__, aEngineId.get(),
       aLanguage.get());

  // Enforce single active session
  {
    StaticMutexAutoLock lock(sSessionMutex);
    if (sActiveSession) {
      LOGE("Rejecting Init - another recognition session is already active");
      aResolver(false);
      return IPC_OK();
    }
    sActiveSession = this;
    LOGD("Session registered as active");
  }

  {
    MutexAutoLock lock(mLock);
    mLanguage = aLanguage;
    mPhrases = aPhrases.Clone();
  }

  // The testing mock (see RecvIsModelAvailable and the parent-side model
  // download in SpeechModelDownloadPermissionRequest) has no equivalent for
  // GetModelFile: there's no lightweight stand-in for an actual parseable
  // model file, so tests that only care about session/IPC lifecycle (not real
  // recognition) skip loading a model entirely rather than needing one to
  // succeed.
  if (StaticPrefs::browser_ml_modelHub_testing()) {
    LOGD("{} - testing mock: skipping model retrieval", __func__);
    aResolver(true);
    return IPC_OK();
  }

  RetrieveModel(std::move(aResolver));

  return IPC_OK();
}

void SpeechRecognitionParent::ProcessAudioStreaming() {}

}  // namespace mozilla::hwinference

#undef LOGV
#undef LOGD
#undef LOGE
