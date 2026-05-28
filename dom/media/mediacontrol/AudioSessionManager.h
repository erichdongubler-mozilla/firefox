/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DOM_MEDIA_MEDIACONTROL_AUDIOSESSIONMANAGER_H_
#define DOM_MEDIA_MEDIACONTROL_AUDIOSESSIONMANAGER_H_

#include "AudioSessionRecord.h"
#include "mozilla/Attributes.h"
#include "mozilla/Maybe.h"
#include "mozilla/dom/AudioSessionBinding.h"
#include "nsTHashMap.h"

namespace mozilla::dom {

class MediaController;

/**
 * Owns the parent-side AudioSession spec state for a single tab
 * (per-top-level-BC). Encapsulates the per-browsing-context override map and
 * the "compute the audio session type" and "update the selected audio
 * session" algorithms behind a small mutator API, so callers cannot reach the
 * underlying map without going through the manager.
 *
 * The owner (`MediaController`) holds the manager directly. The manager keeps
 * a raw back-pointer to the owner for event dispatch and for inherited
 * per-BC audibility queries; the owner outlives the manager by construction.
 */
class AudioSessionManager final {
 public:
  explicit AudioSessionManager(MediaController* aController);
  ~AudioSessionManager() = default;

  AudioSessionManager(const AudioSessionManager&) = delete;
  AudioSessionManager& operator=(const AudioSessionManager&) = delete;

  // Mutators. Each one runs the post-mutation invariant:
  // recompute selected → recompute effective → maybe fire change event.
  void SetTypeOverride(uint64_t aBrowsingContextId, AudioSessionType aType);
  void NotifyAudibilityChanged(uint64_t aBrowsingContextId);
  void NotifyBcDiscarded(uint64_t aBrowsingContextId);

  // The audio-session type that applies to the given browsing context. The
  // user override takes precedence; otherwise the type comes from the
  // browsing context's currently audible sources.
  AudioSessionType EffectiveTypeForBc(uint64_t aBrowsingContextId) const;

  // The audio-session type the tab is currently exposing to chrome
  // consumers. Returns Auto when the tab is producing no audio.
  AudioSessionType GetEffectiveType() const;

  // Test-only accessor for the per-browsing-context AudioSession record.
  // Returns nullptr when no record exists.
  const AudioSessionRecord* GetRecordForTesting(
      uint64_t aBrowsingContextId) const;

 private:
  // The selected audio session for this tab per the spec algorithm:
  // the audio session whose interruptions and focus changes the tab's
  // audible browsing contexts would observe. Nothing() when no audio
  // session is currently selected.
  Maybe<AudioSessionType> GetSelectedAudioSessionType() const;

  // Fire the change event when the resolved effective type changed.
  void MaybeFireEffectiveTypeChanged();

  // Non-owning back-pointer; the controller holds this manager by value as
  // a member, so the controller always outlives the manager.
  MediaController* const MOZ_NON_OWNING_REF mController;

  // Per-browsing-context AudioSession state.
  nsTHashMap<nsUint64HashKey, AudioSessionRecord> mAudioSessions;

  // Cached last value of GetEffectiveType().
  AudioSessionType mLastDispatchedEffectiveType = AudioSessionType::Auto;
};

}  // namespace mozilla::dom

#endif  // DOM_MEDIA_MEDIACONTROL_AUDIOSESSIONMANAGER_H_
