/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "AudioSessionManager.h"

#include "MediaControlUtils.h"
#include "MediaController.h"
#include "mozilla/Uptime.h"

#undef LOG
#define LOG(msg, ...)                        \
  MOZ_LOG(gMediaControlLog, LogLevel::Debug, \
          ("AudioSessionManager=%p, " msg, this, ##__VA_ARGS__))

namespace mozilla::dom {

AudioSessionManager::AudioSessionManager(MediaController* aController)
    : mController(aController) {
  MOZ_ASSERT(mController);
}

void AudioSessionManager::SetTypeOverride(uint64_t aBrowsingContextId,
                                          AudioSessionType aType) {
  // "auto" means no override.
  mAudioSessions.LookupOrInsert(aBrowsingContextId)
      .SetTypeOverride(aBrowsingContextId, aType == AudioSessionType::Auto
                                               ? Nothing()
                                               : Some(aType));
  MaybeFireEffectiveTypeChanged();
}

void AudioSessionManager::NotifyAudibilityChanged(uint64_t aBrowsingContextId) {
  AudioSessionRecord& record =
      mAudioSessions.LookupOrInsert(aBrowsingContextId);
  const bool bcWasAudible = record.GetAudibleAtMs().isSome();
  const bool bcIsAudibleNow = mController->IsBcAudible(aBrowsingContextId);
  if (!bcWasAudible && bcIsAudibleNow) {
    record.SetAudibleAtMs(
        aBrowsingContextId,
        Some(static_cast<int64_t>(mozilla::ProcessUptimeMs().valueOr(0))));
  } else if (bcWasAudible && !bcIsAudibleNow) {
    record.SetAudibleAtMs(aBrowsingContextId, Nothing());
  }
  if (record.IsEmpty()) {
    LOG("Removing empty AudioSessionRecord bc=%" PRIu64, aBrowsingContextId);
    mAudioSessions.Remove(aBrowsingContextId);
  }
  MaybeFireEffectiveTypeChanged();
}

void AudioSessionManager::NotifyBcDiscarded(uint64_t aBrowsingContextId) {
  if (mAudioSessions.Remove(aBrowsingContextId)) {
    LOG("NotifyBcDiscarded bc=%" PRIu64, aBrowsingContextId);
    MaybeFireEffectiveTypeChanged();
  }
}

AudioSessionType AudioSessionManager::EffectiveTypeForBc(
    uint64_t aBrowsingContextId) const {
  if (auto entry = mAudioSessions.Lookup(aBrowsingContextId)) {
    if (Maybe<AudioSessionType> typeOverride = entry.Data().GetTypeOverride()) {
      MOZ_ASSERT(*typeOverride != AudioSessionType::Auto,
                 "auto must never be stored as a real override");
      return *typeOverride;
    }
  }
  return mController->EffectiveTypeForBc(aBrowsingContextId);
}

Maybe<AudioSessionType> AudioSessionManager::GetSelectedAudioSessionType()
    const {
  // Compute the selected audio session per the spec algorithm.
  // https://w3c.github.io/audio-session/#audio-session-update-selected-audio-session-algorithm
  //
  // Step 1: let activeAudioSessions be the records whose browsing context is
  // currently audible and whose effective type is exclusive.
  // TODO(bug 2040798): tighten the state and type check to follow the spec
  // more closely.
  AutoTArray<const AudioSessionRecord*, 4> activeAudioSessions;
  AutoTArray<AudioSessionType, 4> activeEffectiveTypes;
  for (const auto& entry : mAudioSessions) {
    const AudioSessionRecord& record = entry.GetData();
    if (record.GetAudibleAtMs().isNothing()) {
      continue;
    }
    const AudioSessionType type = EffectiveTypeForBc(entry.GetKey());
    if (!IsExclusiveAudioSessionType(type)) {
      continue;
    }
    activeAudioSessions.AppendElement(&record);
    activeEffectiveTypes.AppendElement(type);
  }

  // Step 2: if activeAudioSessions is empty, no audio session is selected.
  if (activeAudioSessions.IsEmpty()) {
    return Nothing();
  }

  // Step 3: if there is only one audio session in activeAudioSessions, that
  // is the selected audio session.
  if (activeAudioSessions.Length() == 1) {
    return Some(activeEffectiveTypes[0]);
  }

  // Step 5: the user agent MAY apply specific heuristics to reorder
  // activeAudioSessions. We pick "most recently audible first" using the
  // timestamp stored on each record.
  size_t winner = 0;
  for (size_t i = 1; i < activeAudioSessions.Length(); ++i) {
    if (*activeAudioSessions[i]->GetAudibleAtMs() >
        *activeAudioSessions[winner]->GetAudibleAtMs()) {
      winner = i;
    }
  }

  // Step 6: the selected audio session is the first audio session in
  // activeAudioSessions.
  return Some(activeEffectiveTypes[winner]);
}

AudioSessionType AudioSessionManager::GetEffectiveType() const {
  if (Maybe<AudioSessionType> selected = GetSelectedAudioSessionType()) {
    return *selected;
  }
  // Fall back to the highest-priority effective type among any audible
  // browsing context. This keeps the chrome surface informative when the
  // tab is playing audio that does not qualify as a selected audio session
  // per spec.
  Maybe<AudioSessionType> fallback;
  for (const auto& entry : mAudioSessions) {
    if (entry.GetData().GetAudibleAtMs().isNothing()) {
      continue;
    }
    const AudioSessionType type = EffectiveTypeForBc(entry.GetKey());
    if (!fallback || AudioSessionTypePriorityRank(type) >
                         AudioSessionTypePriorityRank(*fallback)) {
      fallback = Some(type);
    }
  }
  return fallback.valueOr(AudioSessionType::Auto);
}

void AudioSessionManager::MaybeFireEffectiveTypeChanged() {
  AudioSessionType newType = GetEffectiveType();
  if (newType == mLastDispatchedEffectiveType) {
    return;
  }
  LOG("EffectiveAudioSessionType change %s -> %s",
      GetEnumString(mLastDispatchedEffectiveType).get(),
      GetEnumString(newType).get());
  mLastDispatchedEffectiveType = newType;
  mController->DispatchAsyncEvent(u"effectiveaudiosessiontypechange"_ns);
}

const AudioSessionRecord* AudioSessionManager::GetRecordForTesting(
    uint64_t aBrowsingContextId) const {
  auto entry = mAudioSessions.Lookup(aBrowsingContextId);
  return entry ? &entry.Data() : nullptr;
}

}  // namespace mozilla::dom
