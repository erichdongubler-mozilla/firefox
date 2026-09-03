/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "AudioStream.h"
#include "gtest/gtest.h"

using namespace mozilla;

// AudioClock maps the audio engine's raw frame counter -- an absolute,
// monotonically increasing frame position -- to a media-time position in
// microseconds. Rebase(rawCount) re-zeroes that mapping so the given raw count
// corresponds to media position 0: it sets the base offset to rawCount, the
// base position to 0, and replaces the serviced-frame history with the audio
// handed over but not yet played. The argument is a frame count, not a time: a
// stream reused across a seek keeps its counter climbing, so the clock is
// re-zeroed at the current count, while the seek target itself is applied
// separately by the sink. At 48000 Hz one second is exactly 48000 frames, so
// the expected microsecond values below are exact.

// Rebase at a non-zero count: after servicing frames, Rebase(currentRawCount)
// makes that count read as position 0, and later servicing advances from there.
TEST(AudioClock, RebaseOnReset)
{
  const uint32_t rate = 48000;
  AudioClock clock(rate);

  clock.UpdateFrameHistory(rate, 0, false);
  EXPECT_EQ(clock.GetPosition(rate), 1000000)
      << "one second of serviced frames reads as 1.0 s";

  clock.Rebase(rate, AudioClock::CarryUnplayed::Yes);
  EXPECT_EQ(clock.GetPosition(rate), 0)
      << "rebasing at the current count makes that count read as 0";

  clock.UpdateFrameHistory(rate / 2, 0, false);
  EXPECT_EQ(clock.GetPosition(rate + rate / 2), 500000)
      << "servicing half a second more reads as 0.5 s from the rebased base";

  clock.Rebase(rate + rate / 2, AudioClock::CarryUnplayed::Yes);
  EXPECT_EQ(clock.GetPosition(rate + rate / 2), 0)
      << "a second rebase re-zeroes again at the current count";
}

// Rebase at zero: the boundary case (RebaseLive falls back to Rebase(0) when
// the engine position reads 0). Nothing has been played, so all of the
// accumulated history is carried over as worth no media time.
TEST(AudioClock, RebaseToZero)
{
  const uint32_t rate = 48000;
  AudioClock clock(rate);

  clock.UpdateFrameHistory(rate, 0, false);
  EXPECT_EQ(clock.GetPosition(rate), 1000000)
      << "one second of serviced frames reads as 1.0 s";

  clock.Rebase(0, AudioClock::CarryUnplayed::Yes);
  EXPECT_EQ(clock.GetPosition(0), 0)
      << "Rebase(0) makes the current count read as 0";

  clock.UpdateFrameHistory(rate, 0, false);
  EXPECT_EQ(clock.GetPosition(rate), 0)
      << "the first second is the carried-over audio, so it reads as 0";
  EXPECT_EQ(clock.GetPosition(2 * rate), 1000000)
      << "the second past it was serviced after the rebase and reads as 1.0 s";
}

// Only macOS routes callback info through a queue, so only there can an item
// reach the history after a rebase. A seek stops the sink, so its callbacks are
// pure underrun, and a seek longer than the queue holds strands the overflow on
// the audio thread until a later callback flushes it. Those frames sit at or
// below the rebase anchor, and an underrun-only append merges into the first
// chunk, so applying them again would freeze the clock for the whole stranded
// amount.
//
//   frames:  0 ... 150 silent callbacks ... 71,520 --- 72,000
//                                          ^ rebase      ^ write cursor
TEST(AudioClock, RebaseAfterQueueOverflowOfSilence)
{
  const uint32_t rate = 48000;
  const uint32_t framesPerCallback = rate / 100;
  const uint32_t callbacks = 150;
  AudioClock clock(rate);

  for (uint32_t i = 0; i < callbacks; ++i) {
    clock.UpdateFrameHistory(0, framesPerCallback, false);
  }
  const int64_t written =
      static_cast<int64_t>(callbacks) * static_cast<int64_t>(framesPerCallback);
  const int64_t played = written - framesPerCallback;

  clock.Rebase(played, AudioClock::CarryUnplayed::Yes);
  clock.UpdateFrameHistory(framesPerCallback, 0, false);

  EXPECT_EQ(clock.GetPosition(written), 0) << "the unplayed window reads 0";
  EXPECT_EQ(clock.GetPosition(written + rate / 1000), 1000)
      << "1 ms past the carried window reads as 1 ms, not frozen by the "
         "stranded silence";
}
