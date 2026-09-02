/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2  et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SpeechRecognitionBackend.h"

#include <utility>

#include "SpeechRecognition.h"
#include "SpeechTrackListener.h"
#include "mozilla/AbstractThread.h"
#include "mozilla/Assertions.h"
#include "mozilla/ClearOnShutdown.h"
#include "mozilla/dom/AudioStreamTrack.h"
#include "mozilla/dom/ContentChild.h"
#include "mozilla/dom/Promise.h"
#include "mozilla/dom/SpeechRecognitionBinding.h"
#include "mozilla/hwinference/PSpeechRecognition.h"
#include "mozilla/hwinference/SpeechRecognitionChild.h"
#include "mozilla/ipc/MessageChannel.h"
#include "mozilla/ipc/ProtocolUtils.h"

namespace mozilla::dom {

using namespace mozilla::ipc;

StaticAutoPtr<mozilla::EventTargetCapability<nsISerialEventTarget>>
    SpeechRecognitionBackend::sIPCCapability;
int32_t SpeechRecognitionBackend::sIPCActorUsers = 0;

static LazyLogModule gSpeechRecognitionBackendLog("SpeechRecognitionBackend");

#define LOG(fmt, ...)                                                      \
  MOZ_LOG_FMT(gSpeechRecognitionBackendLog, mozilla::LogLevel::Debug, fmt, \
              ##__VA_ARGS__)
#define LOGV(fmt, ...)                                                       \
  MOZ_LOG_FMT(gSpeechRecognitionBackendLog, mozilla::LogLevel::Verbose, fmt, \
              ##__VA_ARGS__)
#define LOGE(fmt, ...)                                                     \
  MOZ_LOG_FMT(gSpeechRecognitionBackendLog, mozilla::LogLevel::Error, fmt, \
              ##__VA_ARGS__)

// How long the shared IPC thread stays idle before its backing OS thread is
// released. The serial event target itself lives for the process lifetime.
static constexpr uint32_t IPC_THREAD_IDLE_TIMEOUT_MS = 5000;

SpeechRecognitionBackend::SpeechRecognitionIPCActorUserGuard::
    ~SpeechRecognitionIPCActorUserGuard() {
  if (NS_IsMainThread()) {
    SpeechRecognitionBackend::ReleaseIPCActorUser();
  } else {
    NS_DispatchToMainThread(NS_NewRunnableFunction(
        "SpeechRecognitionIPCActorUserGuard::Release", [] {
          AssertIsOnMainThread();
          SpeechRecognitionBackend::ReleaseIPCActorUser();
        }));
  }
}

/* static */
void SpeechRecognitionBackend::AcquireIPCActorUser() {
  AssertIsOnMainThread();
  ++sIPCActorUsers;
}

/* static */
void SpeechRecognitionBackend::ReleaseIPCActorUser() {
  AssertIsOnMainThread();
  MOZ_ASSERT(sIPCActorUsers > 0);
  if (--sIPCActorUsers || !sIPCCapability) {
    return;
  }

  // Close the HWInference connection once no session needs it, so the utility
  // process isn't kept alive by an idle connection. The serial event target is
  // kept (its backing OS thread is released on idle by the LazyIdleThread);
  // the next EnsureIPC() reopens the connection on that same target.
  nsCOMPtr<nsIRunnable> close = NS_NewRunnableFunction(
      "SpeechRecognitionBackend::CloseHWInferenceChildIfAny",
      [] { CloseHWInferenceChildIfAny(); });
  sIPCCapability->Dispatch(close.forget());
}

SpeechRecognitionBackend::SpeechRecognitionBackend(
    SpeechRecognition* aParent, uint32_t aGraphRate, const nsString& aLanguage,
    const nsTArray<nsString>& aPhrases)
    : mParent(aParent),
      mLanguage(NS_ConvertUTF16toUTF8(aLanguage)),
      mPhrases(aPhrases.Clone()) {}

SpeechRecognitionBackend::~SpeechRecognitionBackend() { Abort(); }

nsresult SpeechRecognitionBackend::Start() { return NS_OK; }

void SpeechRecognitionBackend::Stop() {}

void SpeechRecognitionBackend::Abort() {
  AssertIsOnMainThread();
  LOG("SpeechRecognitionBackend::Abort");
  Stop();
}

void SpeechRecognitionBackend::AttachToTrack(AudioStreamTrack* aTrack) {
  AssertIsOnMainThread();
  MOZ_ASSERT(aTrack);
}

void SpeechRecognitionBackend::DetachFromTrack() { AssertIsOnMainThread(); }

void SpeechRecognitionBackend::DataCallback(TrackTime aTime,
                                            const AudioChunk& aChunk) {}

void SpeechRecognitionBackend::NotifyTrackEnded() {}

/* static */
void SpeechRecognitionBackend::EnsureIPCThread() {
  AssertIsOnMainThread();

  if (!sIPCCapability) {
    // IPC actors are bound to the event target they were opened on, so the
    // target has to outlive them: a LazyIdleThread keeps a single one for the
    // process lifetime, and only releases its backing OS thread when idle.
    RefPtr<LazyIdleThread> thread =
        new LazyIdleThread(IPC_THREAD_IDLE_TIMEOUT_MS, "SpeechIPC");
    sIPCCapability = new EventTargetCapability<nsISerialEventTarget>(thread);
    LOG("Created shared IPC thread for speech recognition");
    ClearOnShutdown(&sIPCCapability);
  }
}

/* static */
void SpeechRecognitionBackend::AssertOnIPCThread() {
  sIPCCapability->AssertOnCurrentThread();
}

/* static */
template <typename SendFunc>
auto SpeechRecognitionBackend::RunWithTransientSession(SendFunc&& aSendFunc) {
  AssertIsOnMainThread();

  using SendPromise = typename decltype(aSendFunc(
      std::declval<hwinference::SpeechRecognitionChild*>()))::element_type;
  using ResolveValueType = typename SendPromise::ResolveValueType;
  using OperationPromise = MozPromise<ResolveValueType, nsresult, true>;

  MozPromiseHolder<OperationPromise> holder;
  RefPtr<OperationPromise> operation = holder.Ensure(__func__);
  CreateSession([holder = std::move(holder),
                 aSendFunc = std::forward<SendFunc>(aSendFunc)](
                    hwinference::SpeechRecognitionChild* aChild) mutable {
    AssertOnIPCThread();
    if (!aChild) {
      holder.Reject(NS_ERROR_FAILURE, __func__);
      return;
    }
    RefPtr child = aChild;
    aSendFunc(aChild)->Then(
        GetCurrentSerialEventTarget(), __func__,
        [holder = std::move(holder),
         child](typename SendPromise::ResolveOrRejectValue&& aValue) mutable {
          AssertOnIPCThread();
          child->Close();
          if (aValue.IsReject()) {
            holder.Reject(NS_ERROR_FAILURE, __func__);
            return;
          }
          holder.Resolve(std::move(aValue.ResolveValue()), __func__);
        });
  });
  return operation;
}

/* static */
already_AddRefed<Promise> SpeechRecognitionBackend::Available(
    nsIGlobalObject* aGlobal, const nsTArray<nsCString>& aLanguages) {
  AssertIsOnMainThread();

  if (!aGlobal) {
    return nullptr;
  }

  ErrorResult rv;
  RefPtr<Promise> promise = Promise::Create(aGlobal, rv);
  if (rv.Failed()) {
    return nullptr;
  }

  nsTArray<nsCString> languages = aLanguages.Clone();
  if (languages.IsEmpty()) {
    languages.AppendElement("en-US"_ns);
  }

  LOG("SpeechRecognitionBackend::Available - Starting availability check for "
      "{} languages",
      languages.Length());

  if (MOZ_LOG_TEST(gSpeechRecognitionBackendLog, LogLevel::Debug)) {
    for (const auto& lang : languages) {
      LOG("SpeechRecognitionBackend::Available - Language requested: {}",
          lang.get());
    }
  }

  using IsModelInstalledPromise =
      hwinference::PSpeechRecognitionChild::IsModelInstalledPromise;
  using AvailabilityPromise = MozPromise<AvailabilityStatus, nsresult, true>;
  // RunWithTransientSession turns any rejection into NS_ERROR_FAILURE, so the
  // IPC reject reason is forwarded verbatim rather than converted at each step.
  using SendAvailabilityPromise =
      MozPromise<AvailabilityStatus, ResponseRejectReason, true>;
  RunWithTransientSession(
      [languages = std::move(languages)](
          hwinference::SpeechRecognitionChild* aChild) mutable
          -> RefPtr<SendAvailabilityPromise> {
        RefPtr<hwinference::SpeechRecognitionChild> child = aChild;
        return IsModelInstalledNative(child, languages)
            ->Then(GetCurrentSerialEventTarget(), __func__,
                   [child, languages = std::move(languages)](
                       IsModelInstalledPromise::ResolveOrRejectValue&& aValue)
                       -> RefPtr<SendAvailabilityPromise> {
                     if (aValue.IsReject()) {
                       return SendAvailabilityPromise::CreateAndReject(
                           aValue.RejectValue(), __func__);
                     }
                     if (aValue.ResolveValue()) {
                       return SendAvailabilityPromise::CreateAndResolve(
                           AvailabilityStatus::Available, __func__);
                     }
                     return child->SendIsModelAvailable(languages)
                         ->Map(GetCurrentSerialEventTarget(), __func__,
                               [](bool aAvailable) {
                                 return aAvailable
                                            ? AvailabilityStatus::Downloadable
                                            : AvailabilityStatus::Unavailable;
                               });
                   });
      })
      ->Then(GetMainThreadSerialEventTarget(), __func__,
             [promise](AvailabilityPromise::ResolveOrRejectValue&& aValue) {
               promise->MaybeResolve(aValue.IsResolve()
                                         ? aValue.ResolveValue()
                                         : AvailabilityStatus::Unavailable);
             });

  return promise.forget();
}

/* static */
RefPtr<hwinference::PSpeechRecognitionChild::IsModelInstalledPromise>
SpeechRecognitionBackend::IsModelInstalledNative(
    hwinference::SpeechRecognitionChild* aChild,
    const nsTArray<nsCString>& aLanguages) {
  AssertOnIPCThread();

  LOG("SpeechRecognitionBackend::IsModelInstalledNative - Starting installed "
      "check for {} languages",
      aLanguages.Length());

  return aChild->SendIsModelInstalled(aLanguages);
}

/* static */
void SpeechRecognitionBackend::CreateSession(
    MoveOnlyFunction<void(hwinference::SpeechRecognitionChild*)> aCallback) {
  AssertIsOnMainThread();

  RefPtr<SpeechRecognitionIPCActorUserGuard> guard =
      MakeRefPtr<SpeechRecognitionIPCActorUserGuard>();
  EnsureIPCThread();

  Endpoint<hwinference::PSpeechRecognitionParent> parentEndpoint;
  Endpoint<hwinference::PSpeechRecognitionChild> childEndpoint;
  MOZ_ALWAYS_SUCCEEDS(hwinference::PSpeechRecognition::CreateEndpoints(
      &parentEndpoint, &childEndpoint));
  ContentChild::GetSingleton()->SendCreateSpeechRecognition(
      std::move(parentEndpoint));

  sIPCCapability->Dispatch(NS_NewRunnableFunction(
      "SpeechRecognitionBackend::CreateSession",
      [guard = std::move(guard), endpoint = std::move(childEndpoint),
       callback = std::move(aCallback)]() mutable {
        AssertOnIPCThread();
        RefPtr child = new hwinference::SpeechRecognitionChild(guard.forget());
        if (!endpoint.Bind(child)) {
          callback(nullptr);
          return;
        }
        callback(child);
      }));
}

/* static */
already_AddRefed<Promise> SpeechRecognitionBackend::Install(
    nsIGlobalObject* aGlobal, const nsTArray<nsCString>& aLanguages) {
  AssertIsOnMainThread();

  if (!aGlobal) {
    return nullptr;
  }

  ErrorResult rv;
  RefPtr<Promise> promise = Promise::Create(aGlobal, rv);
  if (rv.Failed()) {
    return nullptr;
  }

  if (aLanguages.IsEmpty()) {
    promise->MaybeResolve(false);
    return promise.forget();
  }

  LOG("SpeechRecognitionBackend::Install - Starting install for {} languages",
      aLanguages.Length());

  using InstallPromise = MozPromise<bool, nsresult, true>;
  RunWithTransientSession(
      [languages = aLanguages.Clone()](
          hwinference::SpeechRecognitionChild* aChild) mutable {
        return aChild->SendInstallModels(std::move(languages));
      })
      ->Then(GetMainThreadSerialEventTarget(), __func__,
             [promise](InstallPromise::ResolveOrRejectValue&& aValue) {
               bool success = aValue.IsResolve() && aValue.ResolveValue();
               LOG("SpeechRecognitionBackend::Install - Install completed: {}",
                   success ? "success" : "failed");
               promise->MaybeResolve(success);
             });

  return promise.forget();
}

}  // namespace mozilla::dom

#undef LOG
#undef LOGV
#undef LOGE
