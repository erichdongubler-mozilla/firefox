/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SpeechRecognition.h"
#include "SpeechTrackListener.h"
#include "nsProxyRelease.h"

namespace mozilla::dom {

SpeechTrackListener::SpeechTrackListener(SpeechRecognition* aRecognition)
    : mRecognition(new nsMainThreadPtrHolder<SpeechRecognition>(
          "SpeechTrackListener::SpeechTrackListener", aRecognition, false)),
      mRemovedPromise(
          mRemovedHolder.Ensure("SpeechTrackListener::mRemovedPromise")) {
  MOZ_ASSERT(NS_IsMainThread());
}

already_AddRefed<SpeechTrackListener> SpeechTrackListener::Create(
    SpeechRecognition* aRecognition) {
  MOZ_ASSERT(NS_IsMainThread());
  RefPtr<SpeechTrackListener> listener = new SpeechTrackListener(aRecognition);

  listener->mRemovedPromise->Then(
      GetCurrentSerialEventTarget(), __func__,
      [listener] { listener->mRecognition = nullptr; });

  return listener.forget();
}

void SpeechTrackListener::NotifyQueuedChanges(
    MediaTrackGraph* aGraph, TrackTime aTrackOffset,
    const MediaSegment& aQueuedMedia) {}

void SpeechTrackListener::NotifyEnded(MediaTrackGraph* aGraph) {
  // TODO dispatch SpeechEnd event so services can be informed
}

void SpeechTrackListener::NotifyRemoved(MediaTrackGraph* aGraph) {
  mRemovedHolder.ResolveIfExists(true, __func__);
}

}  // namespace mozilla::dom
