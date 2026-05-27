/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DOM_MEDIA_MEDIACONTROL_AUDIOSESSIONRECORD_H_
#define DOM_MEDIA_MEDIACONTROL_AUDIOSESSIONRECORD_H_

#include "mozilla/Maybe.h"
#include "mozilla/dom/AudioSessionBinding.h"

namespace mozilla::dom {

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
