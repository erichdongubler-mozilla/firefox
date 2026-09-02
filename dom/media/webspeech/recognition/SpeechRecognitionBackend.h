/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_dom_SpeechRecognitionBackend_h
#define mozilla_dom_SpeechRecognitionBackend_h

#include "AudioSegment.h"
#include "mozilla/EventTargetCapability.h"
#include "mozilla/LazyIdleThread.h"
#include "mozilla/MoveOnlyFunction.h"
#include "mozilla/RefPtr.h"
#include "mozilla/StaticPtr.h"
#include "mozilla/ThreadSafeWeakPtr.h"
#include "mozilla/ThreadSafety.h"
#include "mozilla/TimeStamp.h"
#include "mozilla/WeakPtr.h"
#include "mozilla/hwinference/PSpeechRecognitionChild.h"
#include "mozilla/ipc/Endpoint.h"
#include "nsIThread.h"
#include "nsITimer.h"
#include "nsString.h"
#include "nsTArray.h"

namespace mozilla::hwinference {
class SpeechRecognitionChild;
}  // namespace mozilla::hwinference

namespace mozilla {
class AudibilityMonitor;
namespace dom {
class AudioStreamTrack;
class SpeechRecognition;
class SpeechTrackListener;
}  // namespace dom
}  // namespace mozilla

namespace mozilla::dom {

class Promise;

// Keeps the shared IPC actor open for as long as this guard is alive,
// releasing it on destruction - the hold is tied to the guard's own lifetime
// rather than to a promise settling. Gecko silently drops a promise's
// reaction jobs, including a PromiseNativeHandler added via
// AppendNativeHandler, once the promise's global has died (e.g. the calling
// iframe was detached before the async IPC round trip completed); tying the
// hold to this refcounted guard instead avoids leaking the HWInference
// process forever whenever a caller's frame goes away mid-flight.
//
// Created by CreateSession() and owned by the session's
// SpeechRecognitionChild, so the hold covers an actor that never binds - and
// therefore never gets an ActorDestroy() to release it from - as well as one
// that does. This counts speech's own users; the parent process holds one
// utility process keep-alive while there is at least one user.
class SpeechRecognitionIPCActorUserGuard final {
 public:
  NS_INLINE_DECL_THREADSAFE_REFCOUNTING(SpeechRecognitionIPCActorUserGuard)

  SpeechRecognitionIPCActorUserGuard();

 private:
  ~SpeechRecognitionIPCActorUserGuard();
};

class SpeechRecognitionBackend
    : public SupportsThreadSafeWeakPtr<SpeechRecognitionBackend> {
  friend class SpeechRecognitionIPCActorUserGuard;

 public:
  NS_INLINE_DECL_THREADSAFE_REFCOUNTING_WITH_DELETE_ON_MAIN_THREAD(
      SpeechRecognitionBackend)

  SpeechRecognitionBackend(SpeechRecognition* aParent, uint32_t aGraphRate,
                           const nsString& aLanguage,
                           const nsTArray<nsString>& aPhrases)
      MOZ_REQUIRES(sMainThreadCapability);
  // Called when SpeechRecognition.start() is called from JS.
  // Starts the background thread and IPC session.
  // Creates background thread and establishes IPC connection.
  nsresult Start() MOZ_REQUIRES(sMainThreadCapability);
  // Called when SpeechRecognition.stop() is called from JS.
  // Stops the background thread and IPC session.
  // Gracefully shuts down background thread and closes IPC.
  void Stop() MOZ_REQUIRES(sMainThreadCapability);
  // Called when SpeechRecognition.abort() is called from js.
  // Aborts the recognition session.
  // Immediately terminates background thread and IPC.
  void Abort() MOZ_REQUIRES(sMainThreadCapability);

  // Attach to an audio track to start receiving audio data.
  // Creates a SpeechTrackListener and attaches it to the track.
  void AttachToTrack(AudioStreamTrack* aTrack)
      MOZ_REQUIRES(sMainThreadCapability);
  // Detach from the current audio track.
  void DetachFromTrack() MOZ_REQUIRES(sMainThreadCapability);

  // == Graph thread
  // Called by SpeechTrackListener on the graph's real-time thread
  // Uses lock-free SPSC queue to send data to background thread
  void DataCallback(TrackTime aTime, const AudioChunk& aChunk);
  // Called by SpeechTrackListener when the track ends
  void NotifyTrackEnded();

  static already_AddRefed<Promise> Available(
      nsIGlobalObject* aGlobal, const nsTArray<nsCString>& aLanguages);
  static already_AddRefed<Promise> Install(
      nsIGlobalObject* aGlobal, const nsTArray<nsCString>& aLanguages);
  static RefPtr<hwinference::PSpeechRecognitionChild::IsModelInstalledPromise>
  IsModelInstalledNative(hwinference::SpeechRecognitionChild* aChild,
                         const nsTArray<nsCString>& aLanguages);

 private:
  virtual ~SpeechRecognitionBackend();

  // == IPC thread
  void StartSpeechRecognitionSession(const nsCString& aLanguage)
      MOZ_REQUIRES(sIPCCapability);
  void StopSpeechRecognitionSession() MOZ_REQUIRES(sIPCCapability);
  void HandleRecognitionResult(const nsCString& aTranscript, bool aIsFinal,
                               float aConfidence, TimeStamp aEventTime)
      MOZ_REQUIRES(sIPCCapability);
  void HandleRecognitionError(const nsCString& aError)
      MOZ_REQUIRES(sIPCCapability);

  static void CreateSession(
      MoveOnlyFunction<void(hwinference::SpeechRecognitionChild*)> aCallback)
      MOZ_REQUIRES(sMainThreadCapability);

  // Creates the shared IPC thread on first use, and publishes its serial event
  // target as sIPCCapability. The target is stable for the process lifetime;
  // its backing OS thread is released when idle (see the body).
  static void EnsureIPCThread() MOZ_REQUIRES(sMainThreadCapability);

  static void AssertOnIPCThread() MOZ_ASSERT_CAPABILITY(sIPCCapability);

  static void AcquireIPCActorUser() MOZ_REQUIRES(sMainThreadCapability);
  static void ReleaseIPCActorUser() MOZ_REQUIRES(sMainThreadCapability);

  // Opens a transient session on the IPC thread and calls aSendFunc(session)
  // there. aSendFunc must return a RefPtr<MozPromise>; the returned promise
  // forwards its result and rejects with NS_ERROR_FAILURE if setup or IPC
  // fails. The session lives exactly as long as the call it was opened for:
  // it is closed as soon as aSendFunc's promise settles, so callers must not
  // hold on to it past that point.
  template <typename SendFunc>
  static auto RunWithTransientSession(SendFunc&& aSendFunc)
      MOZ_REQUIRES(sMainThreadCapability);

 public:
  static StaticAutoPtr<mozilla::EventTargetCapability<nsISerialEventTarget>>
      sIPCCapability;

 private:
  // Number of live SpeechRecognitionIPCActorUserGuards, i.e. of things that
  // need the HWInference process: a live SpeechRecognition object, a session,
  // or a static call in flight.
  static int32_t sIPCActorUsers MOZ_GUARDED_BY(sMainThreadCapability);
  WeakPtr<SpeechRecognition> mParent;
  nsCString mLanguage;
  nsTArray<nsString> mPhrases;
};

}  // namespace mozilla::dom

#endif
