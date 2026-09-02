/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8  et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SpeechRecognitionChild.h"

#include "SpeechRecognitionBackend.h"
#include "mozilla/Logging.h"
#include "mozilla/MozPromise.h"
#include "mozilla/ipc/ProtocolUtils.h"
#include "nsDebug.h"

static mozilla::LazyLogModule gSpeechRecognitionChildLog(
    "SpeechRecognitionChild");
#define LOG(level, ...) \
  MOZ_LOG_FMT(gSpeechRecognitionChildLog, level, ##__VA_ARGS__)

namespace mozilla::hwinference {

SpeechRecognitionChild::SpeechRecognitionChild(
    already_AddRefed<dom::SpeechRecognitionIPCActorUserGuard>
        aIPCActorUserGuard)
    : mIPCActorUserGuard(std::move(aIPCActorUserGuard)) {
  LOG(LogLevel::Debug, "Constructor called");
}

SpeechRecognitionChild::~SpeechRecognitionChild() {
  LOG(LogLevel::Debug, "Destructor called");
}

void SpeechRecognitionChild::ActorDestroy(ActorDestroyReason aReason) {
  LOG(LogLevel::Info, "ActorDestroy called, reason={}",
      static_cast<int>(aReason));

  if (mResultCallback || mErrorCallback || mSpeechChangeCallback) {
    LOG(LogLevel::Debug,
        "Clearing callbacks (result={}, error={}, speechChange={})",
        mResultCallback ? "set" : "null", mErrorCallback ? "set" : "null",
        mSpeechChangeCallback ? "set" : "null");
  }
  mResultCallback = nullptr;
  mErrorCallback = nullptr;
  mSpeechChangeCallback = nullptr;
}

void SpeechRecognitionChild::SetResultCallback(
    RecognitionResultCallback&& aCallback) {
  LOG(LogLevel::Debug, "SetResultCallback called");
  mResultCallback = std::move(aCallback);
}

void SpeechRecognitionChild::SetErrorCallback(
    RecognitionErrorCallback&& aCallback) {
  LOG(LogLevel::Debug, "SetErrorCallback called");
  mErrorCallback = std::move(aCallback);
}

void SpeechRecognitionChild::SetSpeechChangeCallback(
    SpeechChangeCallback&& aCallback) {
  LOG(LogLevel::Debug, "SetSpeechChangeCallback called");
  mSpeechChangeCallback = std::move(aCallback);
}

}  // namespace mozilla::hwinference

#undef LOG
