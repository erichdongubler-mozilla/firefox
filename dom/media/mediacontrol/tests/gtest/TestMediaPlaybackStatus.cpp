/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "MediaPlaybackStatus.h"
#include "gtest/gtest.h"
#include "mozilla/Maybe.h"
#include "mozilla/dom/AudioSessionBinding.h"

using namespace mozilla;
using namespace mozilla::dom;

namespace {
constexpr uint64_t kBcA = 1;
constexpr uint64_t kBcB = 2;

constexpr ControlType kControlTypes[] = {
    ControlType::eControllable,
    ControlType::eUncontrollable,
};

constexpr AudioSessionType kSessionTypes[] = {
    AudioSessionType::Auto,      AudioSessionType::Playback,
    AudioSessionType::Transient, AudioSessionType::Transient_solo,
    AudioSessionType::Ambient,   AudioSessionType::Play_and_record,
};
}  // namespace

TEST(MediaPlaybackStatus, AddAudibleSource_AppendsEntry)
{
  MediaPlaybackStatus status;
  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                 ControlType::eControllable,
                                 AudioSessionType::Playback);

  const nsTArray<AudibleSource>* sources =
      status.GetAudibleSourcesForTesting(kBcA);
  ASSERT_NE(sources, nullptr);
  ASSERT_EQ(sources->Length(), 1u);
  EXPECT_EQ((*sources)[0].mControlType, ControlType::eControllable);
  EXPECT_EQ((*sources)[0].mSessionType, AudioSessionType::Playback);
}

TEST(MediaPlaybackStatus, RemoveAudibleSource_RemovesOneMatchingEntry)
{
  MediaPlaybackStatus status;
  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                 ControlType::eControllable,
                                 AudioSessionType::Playback);
  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                 ControlType::eUncontrollable,
                                 AudioSessionType::Ambient);

  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eInaudible,
                                 ControlType::eControllable,
                                 AudioSessionType::Playback);
  const nsTArray<AudibleSource>* sources =
      status.GetAudibleSourcesForTesting(kBcA);
  ASSERT_NE(sources, nullptr);
  ASSERT_EQ(sources->Length(), 1u);
  EXPECT_EQ((*sources)[0].mControlType, ControlType::eUncontrollable);
  EXPECT_EQ((*sources)[0].mSessionType, AudioSessionType::Ambient);
}

TEST(MediaPlaybackStatus, IdenticalSourcesRemovedOneAtATime)
{
  MediaPlaybackStatus status;
  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                 ControlType::eUncontrollable,
                                 AudioSessionType::Ambient);
  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                 ControlType::eUncontrollable,
                                 AudioSessionType::Ambient);
  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                 ControlType::eUncontrollable,
                                 AudioSessionType::Ambient);

  ASSERT_EQ(status.GetAudibleSourcesForTesting(kBcA)->Length(), 3u);

  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eInaudible,
                                 ControlType::eUncontrollable,
                                 AudioSessionType::Ambient);
  ASSERT_EQ(status.GetAudibleSourcesForTesting(kBcA)->Length(), 2u);

  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eInaudible,
                                 ControlType::eUncontrollable,
                                 AudioSessionType::Ambient);
  ASSERT_EQ(status.GetAudibleSourcesForTesting(kBcA)->Length(), 1u);

  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eInaudible,
                                 ControlType::eUncontrollable,
                                 AudioSessionType::Ambient);
  EXPECT_EQ(status.GetAudibleSourcesForTesting(kBcA), nullptr);
}

TEST(MediaPlaybackStatus, IsBcAudible_ReflectsAudibleSources)
{
  for (auto controlType : kControlTypes) {
    for (auto sessionType : kSessionTypes) {
      MediaPlaybackStatus status;
      EXPECT_FALSE(status.IsBcAudibleForTesting(kBcA));

      status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                     controlType, sessionType);
      EXPECT_TRUE(status.IsBcAudibleForTesting(kBcA));
      EXPECT_FALSE(status.IsBcAudibleForTesting(kBcB));

      status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eInaudible,
                                     controlType, sessionType);
      EXPECT_FALSE(status.IsBcAudibleForTesting(kBcA));
    }
  }
}

TEST(MediaPlaybackStatus, OwnerDerivation_IgnoresUncontrollableOnlyBc)
{
  for (auto sessionType : kSessionTypes) {
    MediaPlaybackStatus status;
    status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                   ControlType::eUncontrollable, sessionType);
    EXPECT_EQ(status.GetActiveAudibleControllableContextId(), Nothing());
    EXPECT_TRUE(status.IsAudible());
  }
}

TEST(MediaPlaybackStatus, OwnerDerivation_ControllableClaimsFocus)
{
  MediaPlaybackStatus status;
  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                 ControlType::eControllable,
                                 AudioSessionType::Playback);
  EXPECT_EQ(status.GetActiveAudibleControllableContextId(), Some(kBcA));

  status.UpdateMediaAudibleState(kBcB, MediaAudibleState::eAudible,
                                 ControlType::eControllable,
                                 AudioSessionType::Playback);
  EXPECT_EQ(status.GetActiveAudibleControllableContextId(), Some(kBcB));

  status.UpdateMediaAudibleState(kBcB, MediaAudibleState::eInaudible,
                                 ControlType::eControllable,
                                 AudioSessionType::Playback);
  EXPECT_EQ(status.GetActiveAudibleControllableContextId(), Some(kBcA));
}

TEST(MediaPlaybackStatus, OwnerStickyAfterSoleControllableBecomesInaudible)
{
  MediaPlaybackStatus status;
  // Keep the BC alive past the audibility transition so the entry isn't
  // collapsed by the cleanup path — this exercises pure owner derivation.
  status.UpdateMediaPlaybackState(kBcA, MediaPlaybackState::eStarted);
  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                 ControlType::eControllable,
                                 AudioSessionType::Playback);
  EXPECT_EQ(status.GetActiveAudibleControllableContextId(), Some(kBcA));

  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eInaudible,
                                 ControlType::eControllable,
                                 AudioSessionType::Playback);
  EXPECT_EQ(status.GetActiveAudibleControllableContextId(), Some(kBcA));
}

TEST(MediaPlaybackStatus, ControllableLifecycle_OwnerAndEntryClearedAtStop)
{
  // The eInaudible for a controllable source must not destroy the BC while
  // its controlled-media counter is still non-zero. The matching eStopped
  // is what tears the entry down and clears the active context. If
  // eInaudible destroyed the entry early, the eStopped below would
  // re-create a fresh entry and DecreaseControlledMediaNum would hit
  // MOZ_DIAGNOSTIC_ASSERT.
  MediaPlaybackStatus status;
  status.UpdateMediaPlaybackState(kBcA, MediaPlaybackState::eStarted);
  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                 ControlType::eControllable,
                                 AudioSessionType::Playback);
  EXPECT_EQ(status.GetActiveAudibleControllableContextId(), Some(kBcA));

  status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eInaudible,
                                 ControlType::eControllable,
                                 AudioSessionType::Playback);
  // The entry survives the audibility round-trip because the BC still has
  // controlled media.
  EXPECT_NE(status.GetAudibleSourcesForTesting(kBcA), nullptr);

  status.UpdateMediaPlaybackState(kBcA, MediaPlaybackState::eStopped);
  EXPECT_EQ(status.GetAudibleSourcesForTesting(kBcA), nullptr);
  EXPECT_EQ(status.GetActiveAudibleControllableContextId(), Nothing());
}

TEST(MediaPlaybackStatus, UpdateMediaAudibleState_ReturnsOwnerChange)
{
  MediaPlaybackStatus status;
  EXPECT_TRUE(status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                             ControlType::eControllable,
                                             AudioSessionType::Playback));
  EXPECT_FALSE(status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                              ControlType::eControllable,
                                              AudioSessionType::Playback));
  EXPECT_TRUE(status.UpdateMediaAudibleState(kBcB, MediaAudibleState::eAudible,
                                             ControlType::eControllable,
                                             AudioSessionType::Playback));
  EXPECT_FALSE(status.UpdateMediaAudibleState(kBcA, MediaAudibleState::eAudible,
                                              ControlType::eUncontrollable,
                                              AudioSessionType::Playback));
}
