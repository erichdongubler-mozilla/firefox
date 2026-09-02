/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2  et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SpeechRecognitionBackend.h"

#include "SpeechRecognition.h"
#include "SpeechTrackListener.h"
#include "mozilla/AbstractThread.h"
#include "mozilla/Assertions.h"
#include "mozilla/dom/AudioStreamTrack.h"
#include "mozilla/dom/ContentChild.h"
#include "mozilla/dom/Promise.h"

namespace mozilla::dom {

static LazyLogModule gSpeechRecognitionBackendLog("SpeechRecognitionBackend");

#define LOG(...) \
  MOZ_LOG_FMT(gSpeechRecognitionBackendLog, LogLevel::Debug, __VA_ARGS__)
#define LOGV(...) \
  MOZ_LOG_FMT(gSpeechRecognitionBackendLog, LogLevel::Verbose, __VA_ARGS__)
#define LOGE(...) \
  MOZ_LOG_FMT(gSpeechRecognitionBackendLog, LogLevel::Error, __VA_ARGS__)

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

already_AddRefed<Promise> SpeechRecognitionBackend::Available(
    nsIGlobalObject* aGlobal, const nsTArray<nsCString>& aLanguages) {
  return nullptr;
}

already_AddRefed<Promise> SpeechRecognitionBackend::Install(
    nsIGlobalObject* aGlobal, const nsTArray<nsCString>& aLanguages) {
  return nullptr;
}

}  // namespace mozilla::dom

#undef LOG
#undef LOGV
#undef LOGE
