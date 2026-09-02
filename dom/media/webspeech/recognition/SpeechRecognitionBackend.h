/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_dom_SpeechRecognitionBackend_h
#define mozilla_dom_SpeechRecognitionBackend_h

#include "AudioSegment.h"
#include "mozilla/WeakPtr.h"
#include "nsIThread.h"
#include "nsString.h"
#include "nsTArray.h"

namespace mozilla::hwinference {
class HWInferenceManagerChild;
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

class SpeechRecognitionBackend
    : public SupportsThreadSafeWeakPtr<SpeechRecognitionBackend> {
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

 private:
  virtual ~SpeechRecognitionBackend();

  WeakPtr<SpeechRecognition> mParent;
  nsCString mLanguage;
  nsTArray<nsString> mPhrases;
};

}  // namespace mozilla::dom

#endif
