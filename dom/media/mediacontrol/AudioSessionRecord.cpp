/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "AudioSessionRecord.h"

#include "MediaControlUtils.h"

namespace mozilla::dom {

void AudioSessionRecord::LogState(uint64_t aBcId) const {
  MOZ_LOG(gMediaControlLog, LogLevel::Debug,
          ("AudioSessionRecord bc=%" PRIu64 ", typeOverride=%s", aBcId,
           mTypeOverride ? GetEnumString(*mTypeOverride).get() : "<none>"));
}

void AudioSessionRecord::SetTypeOverride(
    uint64_t aBcId, Maybe<AudioSessionType> aTypeOverride) {
  mTypeOverride = aTypeOverride;
  LogState(aBcId);
}

}  // namespace mozilla::dom
