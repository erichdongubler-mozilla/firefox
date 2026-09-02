/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8  et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DOM_MEDIA_WEBSPEECH_RECOGNITION_SPEECHRECOGNITIONPARENT_H_
#define DOM_MEDIA_WEBSPEECH_RECOGNITION_SPEECHRECOGNITIONPARENT_H_

#include <functional>

#include "WavDumper.h"
#include "mozilla/FileUtils.h"
#include "mozilla/MozPromise.h"
#include "mozilla/SPSCQueue.h"
#include "mozilla/ThreadSafety.h"
#include "mozilla/UniquePtr.h"
#include "mozilla/dom/Promise.h"
#include "mozilla/dom/ipc/IdType.h"
#include "mozilla/hwinference/PHWInferenceChild.h"
#include "mozilla/hwinference/PSpeechRecognitionParent.h"
#include "nsCOMPtr.h"
#include "nsISupportsImpl.h"
#include "nsIThread.h"
#include "nsStringFwd.h"

namespace mozilla::llama {
struct LlamaLibWrapper;
}

namespace mozilla::hwinference {
class HWInferenceChild;
}

// Opaque handles from mudler/parakeet.cpp's streaming C-API (parakeet_capi.h).
struct parakeet_ctx;
struct parakeet_stream;

namespace mozilla::hwinference {

class SpeechRecognitionParent final : public PSpeechRecognitionParent {
 public:
  NS_INLINE_DECL_THREADSAFE_REFCOUNTING(SpeechRecognitionParent, override)

  // aContentId is the GeckoChildID the parent process assigned to the content
  // process that created this session. It is never supplied by content, and is
  // forwarded with install requests so the parent can verify the window owner.
  explicit SpeechRecognitionParent(dom::ContentParentId aContentId);

  ipc::IPCResult RecvIsModelAvailable(const nsTArray<nsCString>& aLanguages,
                                      IsModelAvailableResolver&& aResolver);
  mozilla::ipc::IPCResult RecvInstallModels(
      const nsTArray<nsCString>& aLanguages, InstallModelsResolver&& aResolver);
  mozilla::ipc::IPCResult RecvInit(const nsCString& aEngineId,
                                   const nsCString& aLanguage,
                                   const nsTArray<nsString>& aPhrases,
                                   InitResolver&& aResolver);
  mozilla::ipc::IPCResult RecvProcessAudioData(nsTArray<float>&& aAudioData);
  mozilla::ipc::IPCResult RecvStop();

  void ActorDestroy(ActorDestroyReason aReason) override;

  struct ModelIdentifier {
    nsCString mModelName;
    nsCString mFileName;
    nsCString mRevision = "main"_ns;
    nsCString ToString() const;
  };

  ModelIdentifier LanguagesToModelIdentifier(
      const nsTArray<nsCString>& aLanguages);

  void ResolveOrRejectInitOnIPCThread(InitResolver&& aResolver, bool aSuccess)
      MOZ_EXCLUDES(mLock);

 private:
  // Session lifecycle. Stopping and Destroyed are terminal.
  enum class State { Idle, Initializing, Running, Stopping, Destroyed };

  ~SpeechRecognitionParent();
  void LoadPreferences();

  const dom::ContentParentId mContentId;

  // Shared by RecvIsModelAvailable and RecvInstallModels, which otherwise
  // only differ in the HWInferenceChild call they make. Resolves
  // aResolver(false) if the utility process/HWInferenceChild isn't
  // available; otherwise calls aSendFunc(hwInferenceChild), tracks the
  // resulting promise in aRequestHolder, and resolves aResolver with the
  // result (false on IPC rejection).
  using BoolPromise = hwinference::PHWInferenceChild::IsModelAvailablePromise;
  mozilla::ipc::IPCResult RunHWInferenceBoolQuery(
      const char* aFuncName,
      std::function<RefPtr<BoolPromise>(hwinference::HWInferenceChild*)>
          aSendFunc,
      std::function<void(const bool&)> aResolver,
      MozPromiseRequestHolder<BoolPromise>& aRequestHolder);

  // Runs on mRecognitionThread. Takes ownership of mModelFile, loads it, and
  // enters ProcessAudioStreaming() unless the session was torn down meanwhile.
  void InitializeParakeetContext(InitResolver&& aResolver);
  void RetrieveModel(InitResolver&& aResolver);
  // Fetches an already-installed model's file. Only called by RetrieveModel()
  // after confirming the model is installed.
  void FetchModelFile(const nsCString& aModelId, InitResolver&& aResolver);
  // Cache-aware streaming path (mudler/parakeet.cpp streaming C-API).
  // Runs on mRecognitionThread, and returns once mState leaves Running.
  void ProcessAudioStreaming();
  bool IsRunning() MOZ_EXCLUDES(mLock);
  // Runs on mRecognitionThread, which alone owns mCapiCtx and mCapiStream.
  void DestroyParakeetContext(mozilla::llama::LlamaLibWrapper* aLib);
  void SignalError(const nsCString& aErrorMessage);

  // Static tracking of the single active recognition session
  static StaticMutex sSessionMutex;
  static StaticRefPtr<SpeechRecognitionParent> sActiveSession
      MOZ_GUARDED_BY(sSessionMutex);

  Mutex mLock;
  State mState MOZ_GUARDED_BY(mLock) = State::Idle;
  // Recognition language
  // Set during RecvInit, then constant
  nsCString mLanguage MOZ_GUARDED_BY(mLock);
  // Contextual biasing phrases
  // Set during RecvInit, then constant
  nsTArray<nsString> mPhrases MOZ_GUARDED_BY(mLock);
  // Model file handle, handed to InitializeParakeetContext() on the recognition
  // thread, which owns and closes it from then on.
  mozilla::UniquePtr<FILE, mozilla::FCloseDeleter> mModelFile
      MOZ_GUARDED_BY(mLock);
  // Streaming backend handles (mudler/parakeet.cpp), owned by the recognition
  // thread.
  parakeet_ctx* mCapiCtx = nullptr;
  parakeet_stream* mCapiStream = nullptr;

  // Lock-free queue to convey audio from the IPC thread to the processing
  // thread. Producer is the IPC thread, consumer is the processing thread.
  mozilla::SPSCQueue<float> mAudioQueue;

  // Started in RecvInit, then stopped and join on actor destroyed, recognitions
  // stopped, etc.
  nsCOMPtr<nsIThread> mRecognitionThread;

  // Dumps audio sent to the recognizer. This will contain segments of about
  // 10s of audio, representing the audio sent for inference.
  // MOZ_DISABLE_UTILITY_SANDBOX=1 MOZ_DUMP_AUDIO=1 to activate
  WavDumper mRecognitionAudioDumper;

  // Position in the audio stream that has been processed in samples
  // This provides a rather crude timing estimate, but will be improved.
  size_t mProcessedAudioPos;

  // Outstanding requests to the utility process, disconnected in
  // ActorDestroy() so their callbacks never run (and resolve a dead IPDL
  // resolver) after the actor is torn down.
  MozPromiseRequestHolder<
      hwinference::PHWInferenceChild::IsModelAvailablePromise>
      mIsModelAvailableRequest;
  // Tracks RetrieveModel()'s installation check, run before fetching the model
  // file for a recognition session.
  MozPromiseRequestHolder<
      hwinference::PHWInferenceChild::IsModelInstalledPromise>
      mRetrieveModelIsInstalledRequest;
  MozPromiseRequestHolder<hwinference::PHWInferenceChild::InstallModelPromise>
      mInstallModelRequest;
  MozPromiseRequestHolder<hwinference::PHWInferenceChild::GetModelFilePromise>
      mGetModelFileRequest;
};

}  // namespace mozilla::hwinference

#endif  // DOM_MEDIA_WEBSPEECH_RECOGNITION_SPEECHRECOGNITIONPARENT_H_
