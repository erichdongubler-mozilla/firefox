/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DOM_MEDIA_MEDIACONTROL_AUDIOSESSIONRECORD_H_
#define DOM_MEDIA_MEDIACONTROL_AUDIOSESSIONRECORD_H_

#include "mozilla/Maybe.h"
#include "mozilla/dom/AudioSessionBinding.h"

namespace mozilla::dom {

// Priority rank of an audio-session type. Higher rank wins. The enum values
// in AudioSession.webidl are ordered so that the integer is the rank
// directly. `Auto` is rank 0 and never participates in selection.
inline int AudioSessionTypePriorityRank(AudioSessionType aType) {
  return static_cast<int>(aType);
}

// Default type when no source ranks (the spec fallback,
// https://w3c.github.io/audio-session/#compute-the-audio-session-type step 6).
inline constexpr AudioSessionType DefaultAudioSessionType() {
  return AudioSessionType::Ambient;
}

/**
 * Per-browsing-context AudioSession spec state held in the parent process by
 * MediaController. Lifetime is independent of ContextMediaInfo (the audibility
 * store on MediaPlaybackStatus): an override can be present on a browsing
 * context that has never played media, and ContextMediaInfo can exist without
 * any matching AudioSessionRecord.
 */
class AudioSessionRecord {
 public:
  // The AudioSession type the user set on this browsing context. `Nothing()`
  // when the user has not set one (or assigned "auto"); in that case the
  // effective type comes from walking the audible sources.
  // https://w3c.github.io/audio-session/#enumdef-audiosessiontype
  Maybe<AudioSessionType> GetTypeOverride() const { return mTypeOverride; }

  void SetTypeOverride(uint64_t aBcId, Maybe<AudioSessionType> aTypeOverride);

 private:
  void LogState(uint64_t aBcId) const;

  Maybe<AudioSessionType> mTypeOverride;
};

}  // namespace mozilla::dom

#endif  // DOM_MEDIA_MEDIACONTROL_AUDIOSESSIONRECORD_H_
