/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "AudioSessionRecord.h"
#include "MediaControlService.h"
#include "MediaController.h"
#include "gtest/gtest.h"
#include "mozilla/dom/AudioSessionBinding.h"
#include "mozilla/dom/MediaSessionBinding.h"

using namespace mozilla::dom;

#define CONTROLLER_ID 0
#define FAKE_CONTEXT_ID 0

#define FIRST_CONTROLLER_ID 0

TEST(MediaController, DefaultValueCheck)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
  ASSERT_TRUE(!controller->IsAnyMediaBeingControlled());
  ASSERT_TRUE(controller->Id() == CONTROLLER_ID);
  ASSERT_TRUE(controller->PlaybackState() == MediaSessionPlaybackState::None);
  ASSERT_TRUE(!controller->IsAudible());
}

TEST(MediaController, IsAnyMediaBeingControlled)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
  ASSERT_TRUE(!controller->IsAnyMediaBeingControlled());

  controller->NotifyMediaPlaybackChanged(FAKE_CONTEXT_ID,
                                         MediaPlaybackState::eStarted);
  ASSERT_TRUE(controller->IsAnyMediaBeingControlled());

  controller->NotifyMediaPlaybackChanged(FAKE_CONTEXT_ID,
                                         MediaPlaybackState::eStarted);
  ASSERT_TRUE(controller->IsAnyMediaBeingControlled());

  controller->NotifyMediaPlaybackChanged(FAKE_CONTEXT_ID,
                                         MediaPlaybackState::eStopped);
  ASSERT_TRUE(controller->IsAnyMediaBeingControlled());

  controller->NotifyMediaPlaybackChanged(FAKE_CONTEXT_ID,
                                         MediaPlaybackState::eStopped);
  ASSERT_TRUE(!controller->IsAnyMediaBeingControlled());
}

class FakeControlledMedia final {
 public:
  explicit FakeControlledMedia(MediaController* aController)
      : mController(aController) {
    mController->NotifyMediaPlaybackChanged(FAKE_CONTEXT_ID,
                                            MediaPlaybackState::eStarted);
  }

  void SetPlaying(MediaPlaybackState aState) {
    if (mPlaybackState == aState) {
      return;
    }
    mController->NotifyMediaPlaybackChanged(FAKE_CONTEXT_ID, aState);
    mPlaybackState = aState;
  }

  void SetAudible(MediaAudibleState aState) {
    if (mAudibleState == aState) {
      return;
    }
    mController->NotifyMediaAudibleChanged(FAKE_CONTEXT_ID, aState);
    mAudibleState = aState;
  }

  ~FakeControlledMedia() {
    if (mPlaybackState == MediaPlaybackState::ePlayed) {
      mController->NotifyMediaPlaybackChanged(FAKE_CONTEXT_ID,
                                              MediaPlaybackState::ePaused);
    }
    mController->NotifyMediaPlaybackChanged(FAKE_CONTEXT_ID,
                                            MediaPlaybackState::eStopped);
  }

 private:
  MediaPlaybackState mPlaybackState = MediaPlaybackState::eStopped;
  MediaAudibleState mAudibleState = MediaAudibleState::eInaudible;
  RefPtr<MediaController> mController;
};

TEST(MediaController, ActiveAndDeactiveController)
{
  RefPtr<MediaControlService> service = MediaControlService::GetService();
  ASSERT_TRUE(service->GetActiveControllersNum() == 0);

  RefPtr<MediaController> controller = new MediaController(FIRST_CONTROLLER_ID);

  // In order to check active control number after FakeControlledMedia
  // destroyed.
  {
    FakeControlledMedia fakeMedia(controller);
    fakeMedia.SetPlaying(MediaPlaybackState::ePlayed);
    ASSERT_TRUE(service->GetActiveControllersNum() == 1);

    fakeMedia.SetAudible(MediaAudibleState::eAudible);
    ASSERT_TRUE(service->GetActiveControllersNum() == 1);

    fakeMedia.SetAudible(MediaAudibleState::eInaudible);
    ASSERT_TRUE(service->GetActiveControllersNum() == 1);
  }

  ASSERT_TRUE(service->GetActiveControllersNum() == 0);
}

TEST(MediaController, AudibleChanged)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);

  FakeControlledMedia fakeMedia(controller);
  fakeMedia.SetPlaying(MediaPlaybackState::ePlayed);
  ASSERT_TRUE(!controller->IsAudible());

  fakeMedia.SetAudible(MediaAudibleState::eAudible);
  ASSERT_TRUE(controller->IsAudible());

  fakeMedia.SetAudible(MediaAudibleState::eInaudible);
  ASSERT_TRUE(!controller->IsAudible());
}

TEST(MediaController, PlayingStateChangeViaControlledMedia)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);

  // In order to check playing state after FakeControlledMedia destroyed.
  {
    FakeControlledMedia foo(controller);
    ASSERT_TRUE(controller->PlaybackState() == MediaSessionPlaybackState::None);

    foo.SetPlaying(MediaPlaybackState::ePlayed);
    ASSERT_TRUE(controller->PlaybackState() ==
                MediaSessionPlaybackState::Playing);

    foo.SetPlaying(MediaPlaybackState::ePaused);
    ASSERT_TRUE(controller->PlaybackState() ==
                MediaSessionPlaybackState::Paused);

    foo.SetPlaying(MediaPlaybackState::ePlayed);
    ASSERT_TRUE(controller->PlaybackState() ==
                MediaSessionPlaybackState::Playing);
  }

  // FakeControlledMedia has been destroyed, no playing media exists.
  ASSERT_TRUE(controller->PlaybackState() == MediaSessionPlaybackState::Paused);
}

TEST(MediaController, ControllerShouldRemainPlayingIfAnyPlayingMediaExists)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);

  {
    FakeControlledMedia foo(controller);
    ASSERT_TRUE(controller->PlaybackState() == MediaSessionPlaybackState::None);

    foo.SetPlaying(MediaPlaybackState::ePlayed);
    ASSERT_TRUE(controller->PlaybackState() ==
                MediaSessionPlaybackState::Playing);

    // foo is playing, so controller is in `playing` state.
    FakeControlledMedia bar(controller);
    ASSERT_TRUE(controller->PlaybackState() ==
                MediaSessionPlaybackState::Playing);

    bar.SetPlaying(MediaPlaybackState::ePlayed);
    ASSERT_TRUE(controller->PlaybackState() ==
                MediaSessionPlaybackState::Playing);

    // Although we paused bar, but foo is still playing, so the controller would
    // still be in `playing`.
    bar.SetPlaying(MediaPlaybackState::ePaused);
    ASSERT_TRUE(controller->PlaybackState() ==
                MediaSessionPlaybackState::Playing);

    foo.SetPlaying(MediaPlaybackState::ePaused);
    ASSERT_TRUE(controller->PlaybackState() ==
                MediaSessionPlaybackState::Paused);
  }

  // both foo and bar have been destroyed, no playing media exists.
  ASSERT_TRUE(controller->PlaybackState() == MediaSessionPlaybackState::Paused);
}

TEST(MediaController, PictureInPictureModeOrFullscreen)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
  ASSERT_TRUE(!controller->IsBeingUsedInPIPModeOrFullscreen());

  controller->SetIsInPictureInPictureMode(FAKE_CONTEXT_ID, true);
  ASSERT_TRUE(controller->IsBeingUsedInPIPModeOrFullscreen());

  controller->SetIsInPictureInPictureMode(FAKE_CONTEXT_ID, false);
  ASSERT_TRUE(!controller->IsBeingUsedInPIPModeOrFullscreen());

  controller->NotifyMediaFullScreenState(FAKE_CONTEXT_ID, true);
  ASSERT_TRUE(controller->IsBeingUsedInPIPModeOrFullscreen());

  controller->NotifyMediaFullScreenState(FAKE_CONTEXT_ID, false);
  ASSERT_TRUE(!controller->IsBeingUsedInPIPModeOrFullscreen());
}

// Helper that simulates an uncontrollable source (e.g. Web Audio, Web Speech)
// reporting its audibility lifecycle to the MediaController. The destructor
// drops audibility automatically so individual tests don't have to do it.
class FakeUncontrollableSource final {
 public:
  explicit FakeUncontrollableSource(MediaController* aController,
                                    uint64_t aContextId = FAKE_CONTEXT_ID)
      : mController(aController), mContextId(aContextId) {}

  void SetAudible(MediaAudibleState aState) {
    if (mAudibleState == aState) {
      return;
    }
    mController->NotifyMediaAudibleChanged(mContextId, aState,
                                           ControlType::eUncontrollable);
    mAudibleState = aState;
  }

  ~FakeUncontrollableSource() {
    if (mAudibleState == MediaAudibleState::eAudible) {
      mController->NotifyMediaAudibleChanged(mContextId,
                                             MediaAudibleState::eInaudible,
                                             ControlType::eUncontrollable);
    }
  }

 private:
  MediaAudibleState mAudibleState = MediaAudibleState::eInaudible;
  RefPtr<MediaController> mController;
  uint64_t mContextId;
};

TEST(MediaController, UncontrollableSourceAudible)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
  ASSERT_FALSE(controller->IsAudible());

  FakeUncontrollableSource src(controller);
  src.SetAudible(MediaAudibleState::eAudible);
  ASSERT_TRUE(controller->IsAudible());

  src.SetAudible(MediaAudibleState::eInaudible);
  ASSERT_FALSE(controller->IsAudible());
}

TEST(MediaController, UncontrollableSourceDoesNotActivateController)
{
  RefPtr<MediaControlService> service = MediaControlService::GetService();
  ASSERT_TRUE(service->GetActiveControllersNum() == 0);

  RefPtr<MediaController> controller = new MediaController(FIRST_CONTROLLER_ID);
  {
    FakeUncontrollableSource src(controller);
    ASSERT_TRUE(service->GetActiveControllersNum() == 0);
    src.SetAudible(MediaAudibleState::eAudible);
    ASSERT_TRUE(service->GetActiveControllersNum() == 0);
  }
  ASSERT_TRUE(service->GetActiveControllersNum() == 0);
}

TEST(MediaController, UncontrollableAudibleCombinedWithControllable)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);

  FakeControlledMedia controlSrc(controller);
  controlSrc.SetPlaying(MediaPlaybackState::ePlayed);
  ASSERT_FALSE(controller->IsAudible());

  FakeUncontrollableSource uncontrolSrc(controller);
  uncontrolSrc.SetAudible(MediaAudibleState::eAudible);
  ASSERT_TRUE(controller->IsAudible());

  // Both sources audible: controllable becomes inaudible, controller must
  // still report audible because the uncontrollable source is still audible.
  controlSrc.SetAudible(MediaAudibleState::eAudible);
  ASSERT_TRUE(controller->IsAudible());
  controlSrc.SetAudible(MediaAudibleState::eInaudible);
  ASSERT_TRUE(controller->IsAudible());

  // Now the uncontrollable source goes inaudible too: controller is silent.
  uncontrolSrc.SetAudible(MediaAudibleState::eInaudible);
  ASSERT_FALSE(controller->IsAudible());

  // And bringing only the controllable back is enough on its own.
  controlSrc.SetAudible(MediaAudibleState::eAudible);
  ASSERT_TRUE(controller->IsAudible());

  // Drop audibility before scope exit; FakeControlledMedia's destructor only
  // emits ePaused/eStopped, and MediaPlaybackStatus asserts the source is
  // inaudible by the time it is destroyed.
  controlSrc.SetAudible(MediaAudibleState::eInaudible);
}

TEST(MediaController, MultipleUncontrollableSources)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
  ASSERT_FALSE(controller->IsAudible());

  {
    FakeUncontrollableSource src1(controller, 1);
    FakeUncontrollableSource src2(controller, 2);

    src1.SetAudible(MediaAudibleState::eAudible);
    ASSERT_TRUE(controller->IsAudible());

    src2.SetAudible(MediaAudibleState::eAudible);
    ASSERT_TRUE(controller->IsAudible());

    src1.SetAudible(MediaAudibleState::eInaudible);
    ASSERT_TRUE(controller->IsAudible());

    src2.SetAudible(MediaAudibleState::eInaudible);
    ASSERT_FALSE(controller->IsAudible());
  }
  ASSERT_FALSE(controller->IsAudible());
}

TEST(MediaController, AudioSessionOverride_StoresValueAndIsKeyedByBc)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
  constexpr uint64_t kFrameA = 1;
  constexpr uint64_t kFrameB = 2;

  controller->SetAudioSessionTypeOverride(kFrameA,
                                          AudioSessionType::Transient_solo);
  const AudioSessionRecord* a =
      controller->GetAudioSessionRecordForTesting(kFrameA);
  ASSERT_NE(a, nullptr);
  ASSERT_TRUE(a->GetTypeOverride());
  EXPECT_EQ(*a->GetTypeOverride(), AudioSessionType::Transient_solo);

  // Setting a different override on another BC must not disturb the first.
  controller->SetAudioSessionTypeOverride(kFrameB, AudioSessionType::Playback);

  a = controller->GetAudioSessionRecordForTesting(kFrameA);
  const AudioSessionRecord* b =
      controller->GetAudioSessionRecordForTesting(kFrameB);
  ASSERT_NE(a, nullptr);
  ASSERT_NE(b, nullptr);
  EXPECT_EQ(*a->GetTypeOverride(), AudioSessionType::Transient_solo);
  EXPECT_EQ(*b->GetTypeOverride(), AudioSessionType::Playback);
}

TEST(MediaController, AudioSessionOverride_AutoClearsTypeButKeepsRecord)
{
  constexpr AudioSessionType kOverrides[] = {
      AudioSessionType::Ambient,         AudioSessionType::Transient,
      AudioSessionType::Transient_solo,  AudioSessionType::Playback,
      AudioSessionType::Play_and_record,
  };
  for (auto override : kOverrides) {
    RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
    constexpr uint64_t kFrame = 42;

    controller->SetAudioSessionTypeOverride(kFrame, override);
    ASSERT_NE(controller->GetAudioSessionRecordForTesting(kFrame), nullptr);

    // Auto normalises to "no override" but the record is kept so other
    // per-AudioSession state stays intact.
    controller->SetAudioSessionTypeOverride(kFrame, AudioSessionType::Auto);
    const AudioSessionRecord* rec =
        controller->GetAudioSessionRecordForTesting(kFrame);
    ASSERT_NE(rec, nullptr);
    EXPECT_TRUE(rec->GetTypeOverride().isNothing());
  }
}

TEST(MediaController, AudioSessionOverride_ClearAudioSessionForDropsEntry)
{
  constexpr AudioSessionType kOverrides[] = {
      AudioSessionType::Ambient,         AudioSessionType::Transient,
      AudioSessionType::Transient_solo,  AudioSessionType::Playback,
      AudioSessionType::Play_and_record,
  };
  for (auto override : kOverrides) {
    RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
    constexpr uint64_t kFrame = 7;

    controller->SetAudioSessionTypeOverride(kFrame, override);
    ASSERT_NE(controller->GetAudioSessionRecordForTesting(kFrame), nullptr);

    controller->ClearAudioSessionFor(kFrame);
    EXPECT_EQ(controller->GetAudioSessionRecordForTesting(kFrame), nullptr);

    // Clearing a BC that never had an override is a no-op.
    controller->ClearAudioSessionFor(kFrame + 1);
    EXPECT_EQ(controller->GetAudioSessionRecordForTesting(kFrame + 1), nullptr);
  }
}

TEST(MediaController, EffectiveTypeForBc_UnknownBcReturnsDefault)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
  EXPECT_EQ(controller->EffectiveTypeForBc(42), DefaultAudioSessionType());
}

TEST(MediaController, EffectiveTypeForBc_OverrideWinsOverSource)
{
  // Every user-settable override (i.e. every type except Auto, which
  // normalises to "no override") must take precedence over the source-
  // derived type, and clearing the override must fall back to the source.
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
  constexpr uint64_t kBc = 5;
  controller->NotifyMediaAudibleChanged(kBc, MediaAudibleState::eAudible,
                                        ControlType::eControllable,
                                        AudioSessionType::Playback);
  EXPECT_EQ(controller->EffectiveTypeForBc(kBc), AudioSessionType::Playback);

  constexpr AudioSessionType kOverrides[] = {
      AudioSessionType::Ambient,         AudioSessionType::Transient,
      AudioSessionType::Transient_solo,  AudioSessionType::Playback,
      AudioSessionType::Play_and_record,
  };
  for (auto override : kOverrides) {
    controller->SetAudioSessionTypeOverride(kBc, override);
    EXPECT_EQ(controller->EffectiveTypeForBc(kBc), override);

    // Clearing the override falls back to the source-derived type.
    controller->SetAudioSessionTypeOverride(kBc, AudioSessionType::Auto);
    EXPECT_EQ(controller->EffectiveTypeForBc(kBc), AudioSessionType::Playback);
  }

  controller->NotifyMediaAudibleChanged(kBc, MediaAudibleState::eInaudible,
                                        ControlType::eControllable,
                                        AudioSessionType::Playback);
}

// Every non-Auto AudioSessionType, used by the iterating tests below.
constexpr AudioSessionType kAllAudioSessionTypesExceptAuto[] = {
    AudioSessionType::Ambient,         AudioSessionType::Transient,
    AudioSessionType::Transient_solo,  AudioSessionType::Playback,
    AudioSessionType::Play_and_record,
};

TEST(MediaController, GetEffectiveAudioSessionType_NoAudibleBcReturnsAuto)
{
  RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
  EXPECT_EQ(controller->GetEffectiveAudioSessionType(), AudioSessionType::Auto);
}

TEST(MediaController,
     GetEffectiveAudioSessionType_SingleAudibleBcReportsSourceType)
{
  // Every audio-session source type, when carried by the only audible BC,
  // resolves to that same type.
  for (auto src : kAllAudioSessionTypesExceptAuto) {
    RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
    constexpr uint64_t kBc = 1;
    controller->NotifyMediaAudibleChanged(kBc, MediaAudibleState::eAudible,
                                          ControlType::eControllable, src);
    EXPECT_EQ(controller->GetEffectiveAudioSessionType(), src)
        << "src=" << static_cast<int>(src);
  }
}

TEST(MediaController,
     GetEffectiveAudioSessionType_OverrideWinsAndAutoResetFallsBack)
{
  // For every (source, override) pair, the override drives the surface and
  // a subsequent Auto-reset falls back to the source-derived type.
  for (auto src : kAllAudioSessionTypesExceptAuto) {
    for (auto ovr : kAllAudioSessionTypesExceptAuto) {
      RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
      constexpr uint64_t kBc = 1;
      controller->NotifyMediaAudibleChanged(kBc, MediaAudibleState::eAudible,
                                            ControlType::eControllable, src);
      EXPECT_EQ(controller->GetEffectiveAudioSessionType(), src);

      controller->SetAudioSessionTypeOverride(kBc, ovr);
      EXPECT_EQ(controller->GetEffectiveAudioSessionType(), ovr);

      controller->SetAudioSessionTypeOverride(kBc, AudioSessionType::Auto);
      EXPECT_EQ(controller->GetEffectiveAudioSessionType(), src);
    }
  }
}

TEST(MediaController,
     GetEffectiveAudioSessionType_TwoExclusiveBcsPickMostRecent)
{
  // Two audible BCs, both exclusive types: the most recently audible wins
  // regardless of the type ordering on each side.
  for (auto first : kExclusiveAudioSessionTypes) {
    for (auto second : kExclusiveAudioSessionTypes) {
      RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
      constexpr uint64_t kBcA = 1;
      constexpr uint64_t kBcB = 2;
      controller->NotifyMediaAudibleChanged(kBcA, MediaAudibleState::eAudible,
                                            ControlType::eControllable, first);
      controller->NotifyMediaAudibleChanged(kBcB, MediaAudibleState::eAudible,
                                            ControlType::eControllable, second);
      EXPECT_EQ(controller->GetEffectiveAudioSessionType(), second);
    }
  }
}

TEST(MediaController,
     GetEffectiveAudioSessionType_TwoNonExclusiveBcsPickHighestPriority)
{
  // Two audible BCs, only non-exclusive types: no audio session is selected
  // per spec, so the chrome surface falls back to the highest-priority
  // effective type.
  for (auto first : kNonExclusiveAudioSessionTypes) {
    for (auto second : kNonExclusiveAudioSessionTypes) {
      RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
      constexpr uint64_t kBcA = 1;
      constexpr uint64_t kBcB = 2;
      controller->NotifyMediaAudibleChanged(kBcA, MediaAudibleState::eAudible,
                                            ControlType::eControllable, first);
      controller->NotifyMediaAudibleChanged(kBcB, MediaAudibleState::eAudible,
                                            ControlType::eControllable, second);
      const AudioSessionType expected =
          AudioSessionTypePriorityRank(first) >=
                  AudioSessionTypePriorityRank(second)
              ? first
              : second;
      EXPECT_EQ(controller->GetEffectiveAudioSessionType(), expected);
    }
  }
}

TEST(MediaController, GetEffectiveAudioSessionType_ExclusiveBeatsNonExclusive)
{
  // For every (exclusive, non-exclusive) pair: the non-exclusive BC becomes
  // audible LAST (so it is the most recent), yet spec selection ignores it
  // and the exclusive type wins.
  for (auto exclusive : kExclusiveAudioSessionTypes) {
    for (auto nonExclusive : kNonExclusiveAudioSessionTypes) {
      RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
      constexpr uint64_t kBcA = 1;
      constexpr uint64_t kBcB = 2;
      controller->NotifyMediaAudibleChanged(kBcA, MediaAudibleState::eAudible,
                                            ControlType::eControllable,
                                            exclusive);
      controller->NotifyMediaAudibleChanged(kBcB, MediaAudibleState::eAudible,
                                            ControlType::eControllable,
                                            nonExclusive);
      EXPECT_EQ(controller->GetEffectiveAudioSessionType(), exclusive);
    }
  }
}

TEST(MediaController,
     GetEffectiveAudioSessionType_HandoffWhenSelectedBcGoesSilent)
{
  // For every (first, second) pair of exclusive types: BcA audible with
  // `first` then BcB audible with `second`. BcB is selected (most recent).
  // When BcB goes silent, selection falls back to BcA. When BcA also goes
  // silent the surface returns Auto.
  for (auto first : kExclusiveAudioSessionTypes) {
    for (auto second : kExclusiveAudioSessionTypes) {
      RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
      constexpr uint64_t kBcA = 1;
      constexpr uint64_t kBcB = 2;

      controller->NotifyMediaAudibleChanged(kBcA, MediaAudibleState::eAudible,
                                            ControlType::eControllable, first);
      controller->NotifyMediaAudibleChanged(kBcB, MediaAudibleState::eAudible,
                                            ControlType::eControllable, second);
      EXPECT_EQ(controller->GetEffectiveAudioSessionType(), second);

      controller->NotifyMediaAudibleChanged(kBcB, MediaAudibleState::eInaudible,
                                            ControlType::eControllable, second);
      EXPECT_EQ(controller->GetEffectiveAudioSessionType(), first);

      controller->NotifyMediaAudibleChanged(kBcA, MediaAudibleState::eInaudible,
                                            ControlType::eControllable, first);
      EXPECT_EQ(controller->GetEffectiveAudioSessionType(),
                AudioSessionType::Auto);
    }
  }
}

TEST(MediaController, GetEffectiveAudioSessionType_OverrideSetBeforePlayApplies)
{
  // For every (override, source) pair: the override is set before any
  // audibility transition; once the BC becomes audible with `source`, the
  // surface reports the stored override.
  for (auto override : kAllAudioSessionTypesExceptAuto) {
    for (auto source : kAllAudioSessionTypesExceptAuto) {
      RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
      constexpr uint64_t kBc = 1;

      controller->SetAudioSessionTypeOverride(kBc, override);
      EXPECT_EQ(controller->GetEffectiveAudioSessionType(),
                AudioSessionType::Auto);

      controller->NotifyMediaAudibleChanged(kBc, MediaAudibleState::eAudible,
                                            ControlType::eControllable, source);
      EXPECT_EQ(controller->GetEffectiveAudioSessionType(), override);
    }
  }
}

TEST(MediaController,
     GetEffectiveAudioSessionType_UncontrollableOnlyBcParticipates)
{
  // An uncontrollable-only audible BC drives the chrome surface for every
  // source type.
  for (auto src : kAllAudioSessionTypesExceptAuto) {
    RefPtr<MediaController> controller = new MediaController(CONTROLLER_ID);
    constexpr uint64_t kBc = 1;

    controller->NotifyMediaAudibleChanged(kBc, MediaAudibleState::eAudible,
                                          ControlType::eUncontrollable, src);
    EXPECT_EQ(controller->GetEffectiveAudioSessionType(), src);
  }
}
