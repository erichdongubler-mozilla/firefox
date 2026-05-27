/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "MediaPlaybackStatus.h"

#include "MediaControlUtils.h"

namespace mozilla::dom {

#undef LOG
#define LOG(msg, ...)                        \
  MOZ_LOG(gMediaControlLog, LogLevel::Debug, \
          ("MediaPlaybackStatus=%p, " msg, this, ##__VA_ARGS__))

void MediaPlaybackStatus::UpdateMediaPlaybackState(uint64_t aContextId,
                                                   MediaPlaybackState aState) {
  LOG("Update playback state '%s' for context %" PRIu64,
      EnumValueToString(aState), aContextId);
  MOZ_ASSERT(NS_IsMainThread());

  ContextMediaInfo& info = GetNotNullContextInfo(aContextId);
  if (aState == MediaPlaybackState::eStarted) {
    info.IncreaseControlledMediaNum();
  } else if (aState == MediaPlaybackState::eStopped) {
    info.DecreaseControlledMediaNum();
  } else if (aState == MediaPlaybackState::ePlayed) {
    info.IncreasePlayingMediaNum();
  } else {
    MOZ_ASSERT(aState == MediaPlaybackState::ePaused);
    info.DecreasePlayingMediaNum();
  }

  LOG("UpdateMediaPlaybackState for context %" PRIu64
      " (controlled %u audible %zu)",
      aContextId, info.ControlledMediaNum(), info.AudibleSourceCount());
  // DO NOT access `info` after this line.
  MaybeDestroyContextInfo(aContextId, info);
}

void MediaPlaybackStatus::DestroyContextInfo(uint64_t aContextId) {
  MOZ_ASSERT(NS_IsMainThread());
  LOG("Remove context %" PRIu64, aContextId);
  mContextInfoMap.Remove(aContextId);
  // If the removed context is owning the audio focus, we would find another
  // context to take the audio focus if it's possible.
  if (IsContextOwningAudioFocus(aContextId)) {
    ChooseNewContextToOwnAudioFocus();
  }
}

void MediaPlaybackStatus::MaybeDestroyContextInfo(
    uint64_t aContextId, const ContextMediaInfo& aInfo) {
  // A context entry is kept while it still has any of: controlled media,
  // playing media, or an audible source. Once all three are empty the
  // entry has no remaining purpose and is destroyed.
  if (aInfo.IsAnyMediaBeingControlled() || aInfo.IsPlaying() ||
      aInfo.IsAudible()) {
    return;
  }
  DestroyContextInfo(aContextId);
}

bool MediaPlaybackStatus::UpdateMediaAudibleState(
    uint64_t aContextId, MediaAudibleState aState, ControlType aControlType,
    AudioSessionType aSessionType) {
  LOG("Update audible state '%s' for context %" PRIu64,
      EnumValueToString(aState), aContextId);
  MOZ_ASSERT(NS_IsMainThread());
  ContextMediaInfo& info = GetNotNullContextInfo(aContextId);
  const Maybe<uint64_t> oldOwner = mOwningAudioFocusContextId;

  if (aState == MediaAudibleState::eAudible) {
    info.AddAudibleSource(aControlType, aSessionType);
  } else {
    MOZ_ASSERT(aState == MediaAudibleState::eInaudible);
    info.RemoveAudibleSource(aControlType, aSessionType);
  }

  if (ShouldRequestAudioFocusForInfo(info, aControlType)) {
    SetOwningAudioFocusContextId(Some(aContextId));
  } else if (ShouldAbandonAudioFocusForInfo(info, aControlType)) {
    ChooseNewContextToOwnAudioFocus();
  }

  MaybeDestroyContextInfo(aContextId, info);
  return oldOwner != mOwningAudioFocusContextId;
}

void MediaPlaybackStatus::UpdateGuessedPositionState(
    uint64_t aContextId, const nsID& aElementId,
    const Maybe<PositionState>& aState) {
  MOZ_ASSERT(NS_IsMainThread());
  if (aState) {
    LOG("Update guessed position state for context %" PRIu64
        " element %s (duration=%f, playbackRate=%f, position=%f)",
        aContextId, aElementId.ToString().get(), aState->mDuration,
        aState->mPlaybackRate, aState->mLastReportedPlaybackPosition);
  } else {
    LOG("Clear guessed position state for context %" PRIu64 " element %s",
        aContextId, aElementId.ToString().get());
  }
  ContextMediaInfo& info = GetNotNullContextInfo(aContextId);
  info.UpdateGuessedPositionState(aElementId, aState);
}

bool MediaPlaybackStatus::IsPlaying() const {
  MOZ_ASSERT(NS_IsMainThread());
  return std::any_of(mContextInfoMap.Values().cbegin(),
                     mContextInfoMap.Values().cend(),
                     [](const auto& info) { return info->IsPlaying(); });
}

bool MediaPlaybackStatus::IsAudible() const {
  MOZ_ASSERT(NS_IsMainThread());
  return std::any_of(mContextInfoMap.Values().cbegin(),
                     mContextInfoMap.Values().cend(),
                     [](const auto& info) { return info->IsAudible(); });
}

bool MediaPlaybackStatus::IsAnyMediaBeingControlled() const {
  MOZ_ASSERT(NS_IsMainThread());
  return std::any_of(
      mContextInfoMap.Values().cbegin(), mContextInfoMap.Values().cend(),
      [](const auto& info) { return info->IsAnyMediaBeingControlled(); });
}

Maybe<PositionState> MediaPlaybackStatus::GuessedMediaPositionState(
    Maybe<uint64_t> aPreferredContextId) const {
  auto contextId = aPreferredContextId;
  if (!contextId) {
    contextId = mOwningAudioFocusContextId;
  }

  // either the preferred or focused context
  if (contextId) {
    auto entry = mContextInfoMap.Lookup(*contextId);
    if (!entry) {
      return Nothing();
    }
    LOG("Using guessed position state from preferred/focused BC %" PRId64,
        *contextId);
    return entry.Data()->GuessedPositionState();
  }

  // look for the first position state
  for (const auto& context : mContextInfoMap.Values()) {
    auto state = context->GuessedPositionState();
    if (state) {
      LOG("Using guessed position state from BC %" PRId64, context->Id());
      return state;
    }
  }
  return Nothing();
}

MediaPlaybackStatus::ContextMediaInfo&
MediaPlaybackStatus::GetNotNullContextInfo(uint64_t aContextId) {
  MOZ_ASSERT(NS_IsMainThread());
  return *mContextInfoMap.GetOrInsertNew(aContextId, aContextId);
}

Maybe<uint64_t> MediaPlaybackStatus::GetAudioFocusOwnerContextId() const {
  return mOwningAudioFocusContextId;
}

void MediaPlaybackStatus::ChooseNewContextToOwnAudioFocus() {
  // Walk every context, picking one with at least one CONTROLLABLE audible
  // source. Uncontrollable-only BCs are not focus-owner candidates. If no
  // candidate is found, no one should own the audio focus.
  for (const auto& info : mContextInfoMap.Values()) {
    if (info->HasAudibleSourceOfControlType(ControlType::eControllable)) {
      SetOwningAudioFocusContextId(Some(info->Id()));
      return;
    }
  }
  SetOwningAudioFocusContextId(Nothing());
}

void MediaPlaybackStatus::SetOwningAudioFocusContextId(
    Maybe<uint64_t>&& aContextId) {
  if (mOwningAudioFocusContextId == aContextId) {
    return;
  }
  mOwningAudioFocusContextId = std::move(aContextId);
}

bool MediaPlaybackStatus::ShouldRequestAudioFocusForInfo(
    const ContextMediaInfo& aInfo, ControlType aControlType) const {
  // Only a controllable update can claim audio focus; uncontrollable
  // sources contribute to per-tab audibility but never own the focus.
  return aControlType == ControlType::eControllable &&
         aInfo.HasAudibleSourceOfControlType(ControlType::eControllable) &&
         !IsContextOwningAudioFocus(aInfo.Id());
}

bool MediaPlaybackStatus::ShouldAbandonAudioFocusForInfo(
    const ContextMediaInfo& aInfo, ControlType aControlType) const {
  // The owner has lost its last controllable audible source, but another
  // context still has one — hand off the audio focus to that context. If
  // there is no other candidate the owner stays sticky so a subsequent
  // default-action handler still has a target. Only triggered by
  // controllable transitions; uncontrollable updates never abandon focus.
  return aControlType == ControlType::eControllable &&
         !aInfo.HasAudibleSourceOfControlType(ControlType::eControllable) &&
         IsContextOwningAudioFocus(aInfo.Id()) &&
         HasAnyControllableAudibleSource();
}

bool MediaPlaybackStatus::HasAnyControllableAudibleSource() const {
  return std::any_of(
      mContextInfoMap.Values().cbegin(), mContextInfoMap.Values().cend(),
      [](const auto& info) {
        return info->HasAudibleSourceOfControlType(ControlType::eControllable);
      });
}

bool MediaPlaybackStatus::IsContextOwningAudioFocus(uint64_t aContextId) const {
  return mOwningAudioFocusContextId ? *mOwningAudioFocusContextId == aContextId
                                    : false;
}

Maybe<PositionState>
MediaPlaybackStatus::ContextMediaInfo::GuessedPositionState() const {
  if (mGuessedPositionStateMap.Count() != 1) {
    LOG("Count is %d", mGuessedPositionStateMap.Count());
    return Nothing();
  }
  return Some(mGuessedPositionStateMap.begin()->GetData());
}

void MediaPlaybackStatus::ContextMediaInfo::UpdateGuessedPositionState(
    const nsID& aElementId, const Maybe<PositionState>& aState) {
  if (aState) {
    mGuessedPositionStateMap.InsertOrUpdate(aElementId, *aState);
  } else {
    mGuessedPositionStateMap.Remove(aElementId);
  }
}

void MediaPlaybackStatus::ContextMediaInfo::AddAudibleSource(
    ControlType aControlType, AudioSessionType aSessionType) {
  mAudibleSources.AppendElement(AudibleSource{aControlType, aSessionType});
}

void MediaPlaybackStatus::ContextMediaInfo::RemoveAudibleSource(
    ControlType aControlType, AudioSessionType aSessionType) {
  for (size_t i = 0; i < mAudibleSources.Length(); ++i) {
    const AudibleSource& src = mAudibleSources[i];
    if (src.mControlType == aControlType && src.mSessionType == aSessionType) {
      mAudibleSources.RemoveElementAt(i);
      return;
    }
  }
}

bool MediaPlaybackStatus::ContextMediaInfo::HasAudibleSourceOfControlType(
    ControlType aControlType) const {
  for (const AudibleSource& src : mAudibleSources) {
    if (src.mControlType == aControlType) {
      return true;
    }
  }
  return false;
}

}  // namespace mozilla::dom
