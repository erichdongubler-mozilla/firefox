/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SpeechRecognition.h"

#include <algorithm>

#include "AudioSegment.h"
#include "MediaEnginePrefs.h"
#include "SpeechRecognitionAlternative.h"
#include "SpeechRecognitionBackend.h"
#include "SpeechRecognitionResult.h"
#include "SpeechRecognitionResultList.h"
#include "SpeechTrackListener.h"
#include "VideoUtils.h"
#include "mozilla/AbstractThread.h"
#include "mozilla/MediaManager.h"
#include "mozilla/Preferences.h"
#include "mozilla/Services.h"
#include "mozilla/StaticPrefs_media.h"
#include "mozilla/dom/AudioStreamTrack.h"
#include "mozilla/dom/BindingUtils.h"
#include "mozilla/dom/Document.h"
#include "mozilla/dom/Element.h"
#include "mozilla/dom/MediaStreamError.h"
#include "mozilla/dom/MediaStreamTrackBinding.h"
#include "mozilla/dom/RootedDictionary.h"
#include "mozilla/dom/SpeechGrammar.h"
#include "mozilla/dom/SpeechRecognitionBinding.h"
#include "mozilla/dom/SpeechRecognitionEvent.h"
#include "nsCOMPtr.h"
#include "nsComponentManagerUtils.h"
#include "nsContentUtils.h"
#include "nsCycleCollectionParticipant.h"
#include "nsGlobalWindowInner.h"
#include "nsIObserverService.h"
#include "nsIPermissionManager.h"
#include "nsIPrincipal.h"
#include "nsPIDOMWindow.h"
#include "nsQueryObject.h"
#include "nsServiceManagerUtils.h"

// Undo the windows.h damage
#if defined(XP_WIN) && defined(GetMessage)
#  undef GetMessage
#endif

namespace mozilla::dom {

NS_IMPL_CYCLE_COLLECTION_WEAK_PTR_INHERITED(SpeechRecognition,
                                            DOMEventTargetHelper, mStream,
                                            mTrack, mSpeechGrammarList,
                                            mListener)

NS_INTERFACE_MAP_BEGIN_CYCLE_COLLECTION(SpeechRecognition)
NS_INTERFACE_MAP_END_INHERITING(DOMEventTargetHelper)

NS_IMPL_ADDREF_INHERITED(SpeechRecognition, DOMEventTargetHelper)
NS_IMPL_RELEASE_INHERITED(SpeechRecognition, DOMEventTargetHelper)

NS_IMPL_CYCLE_COLLECTION_INHERITED(SpeechRecognition::TrackListener,
                                   DOMMediaStream::TrackListener,
                                   mSpeechRecognition)
NS_IMPL_ADDREF_INHERITED(SpeechRecognition::TrackListener,
                         DOMMediaStream::TrackListener)
NS_IMPL_RELEASE_INHERITED(SpeechRecognition::TrackListener,
                          DOMMediaStream::TrackListener)
NS_INTERFACE_MAP_BEGIN_CYCLE_COLLECTION(SpeechRecognition::TrackListener)
NS_INTERFACE_MAP_END_INHERITING(DOMMediaStream::TrackListener)

SpeechRecognition::SpeechRecognition(nsPIDOMWindowInner* aOwnerWindow)
    : DOMEventTargetHelper(aOwnerWindow),
      mSpeechGrammarList(new SpeechGrammarList(aOwnerWindow)),
      mContinuous(false),
      mInterimResults(false),
      mMaxAlternatives(1) {
  Reset();
}

SpeechRecognition::~SpeechRecognition() = default;

JSObject* SpeechRecognition::WrapObject(JSContext* aCx,
                                        JS::Handle<JSObject*> aGivenProto) {
  return SpeechRecognition_Binding::Wrap(aCx, this, aGivenProto);
}

already_AddRefed<SpeechRecognition> SpeechRecognition::Constructor(
    const GlobalObject& aGlobal, ErrorResult& aRv) {
  nsCOMPtr<nsPIDOMWindowInner> win = do_QueryInterface(aGlobal.GetAsSupports());
  if (!win) {
    aRv.Throw(NS_ERROR_FAILURE);
    return nullptr;
  }

  RefPtr<SpeechRecognition> object = new SpeechRecognition(win);
  return object.forget();
}

void SpeechRecognition::Reset() {
  if (mStream) {
    mStream->UnregisterTrackListener(mListener);
    mStream = nullptr;
    mListener = nullptr;
  }
  mTrack = nullptr;
  mTrackIsOwned = false;
  mStopRecordingPromise = nullptr;
  mAborted = false;
}

void SpeechRecognition::ResetAndEnd() {
  Reset();
  DispatchTrustedEvent(u"end"_ns);
}

NS_IMETHODIMP
SpeechRecognition::StartRecording(RefPtr<AudioStreamTrack>& aTrack) {
  // hold a reference so that the underlying track doesn't get collected.
  mTrack = aTrack;
  MOZ_ASSERT(!mTrack->Ended());

  mSpeechListener = SpeechTrackListener::Create(this);
  mTrack->AddListener(mSpeechListener);

  return NS_OK;
}

RefPtr<GenericNonExclusivePromise> SpeechRecognition::StopRecording() {
  if (!mTrack) {
    // Recording wasn't started, or has already been stopped.
    if (mStream) {
      // Ensure we don't start recording because a track became available
      // before we get reset.
      mStream->UnregisterTrackListener(mListener);
      mListener = nullptr;
    }
    return GenericNonExclusivePromise::CreateAndResolve(true, __func__);
  }

  if (mStopRecordingPromise) {
    return mStopRecordingPromise;
  }

  mTrack->RemoveListener(mSpeechListener);
  if (mTrackIsOwned) {
    mTrack->Stop();
  }

  DispatchTrustedEvent(u"audioend"_ns);

  return nullptr;
}

already_AddRefed<SpeechGrammarList> SpeechRecognition::Grammars() const {
  RefPtr<SpeechGrammarList> speechGrammarList = mSpeechGrammarList;
  return speechGrammarList.forget();
}

void SpeechRecognition::SetGrammars(SpeechGrammarList& aArg) {
  mSpeechGrammarList = &aArg;
}

void SpeechRecognition::GetLang(nsString& aRetVal) const { aRetVal = mLang; }

void SpeechRecognition::SetLang(const nsAString& aArg) { mLang = aArg; }

bool SpeechRecognition::GetContinuous(ErrorResult& aRv) const {
  return mContinuous;
}

void SpeechRecognition::SetContinuous(bool aArg, ErrorResult& aRv) {
  mContinuous = aArg;
}

bool SpeechRecognition::InterimResults() const { return mInterimResults; }

void SpeechRecognition::SetInterimResults(bool aArg) { mInterimResults = aArg; }

uint32_t SpeechRecognition::MaxAlternatives() const { return mMaxAlternatives; }

void SpeechRecognition::SetMaxAlternatives(uint32_t aArg) {
  mMaxAlternatives = aArg;
}

void SpeechRecognition::GetServiceURI(nsString& aRetVal,
                                      ErrorResult& aRv) const {
  aRv.Throw(NS_ERROR_NOT_IMPLEMENTED);
}

void SpeechRecognition::SetServiceURI(const nsAString& aArg, ErrorResult& aRv) {
  aRv.Throw(NS_ERROR_NOT_IMPLEMENTED);
}

void SpeechRecognition::Start(const Optional<NonNull<DOMMediaStream>>& aStream,
                              CallerType aCallerType, ErrorResult& aRv) {
  MediaStreamConstraints constraints;
  constraints.mAudio.SetAsBoolean() = true;

  MOZ_ASSERT(!mListener);
  mListener = new TrackListener(this);

  if (aStream.WasPassed()) {
    mStream = &aStream.Value();
    mTrackIsOwned = false;
    mStream->RegisterTrackListener(mListener);
    nsTArray<RefPtr<AudioStreamTrack>> tracks;
    mStream->GetAudioTracks(tracks);
    for (const RefPtr<AudioStreamTrack>& track : tracks) {
      if (!track->Ended()) {
        NotifyTrackAdded(track);
        break;
      }
    }
  } else {
    mTrackIsOwned = true;
    nsPIDOMWindowInner* win = GetOwnerWindow();
    if (!win || !win->IsFullyActive()) {
      aRv.ThrowInvalidStateError("The document is not fully active.");
      return;
    }
    AutoNoJSAPI nojsapi;
    RefPtr<SpeechRecognition> self(this);
    MediaManager::Get()
        ->GetUserMedia(win, constraints, aCallerType)
        ->Then(
            GetCurrentSerialEventTarget(), __func__,
            [this, self](RefPtr<DOMMediaStream>&& aStream) {
              nsTArray<RefPtr<AudioStreamTrack>> tracks;
              aStream->GetAudioTracks(tracks);
              if (mAborted) {
                // We were probably aborted. Exit early.
                for (const RefPtr<AudioStreamTrack>& track : tracks) {
                  track->Stop();
                }
                return;
              }
              mStream = std::move(aStream);
              mStream->RegisterTrackListener(mListener);
              for (const RefPtr<AudioStreamTrack>& track : tracks) {
                if (!track->Ended()) {
                  NotifyTrackAdded(track);
                }
              }
            },
            [this, self](RefPtr<MediaMgrError>&& error) {
              if (mAborted) {
                // We were probably aborted. Exit early.
                return;
              }
              SpeechRecognitionErrorCode errorCode;

              if (error->mName == MediaMgrError::Name::NotAllowedError) {
                errorCode = SpeechRecognitionErrorCode::Not_allowed;
              } else {
                errorCode = SpeechRecognitionErrorCode::Audio_capture;
              }
              DispatchError(errorCode, error->mMessage);
            });
  }
}

void SpeechRecognition::Stop() { ResetAndEnd(); }

void SpeechRecognition::Abort() {
  if (mAborted) {
    return;
  }

  mAborted = true;
  ResetAndEnd();
}

void SpeechRecognition::NotifyTrackAdded(
    const RefPtr<MediaStreamTrack>& aTrack) {
  if (mTrack) {
    return;
  }

  RefPtr<AudioStreamTrack> audioTrack = aTrack->AsAudioStreamTrack();
  if (!audioTrack) {
    return;
  }

  if (audioTrack->Ended()) {
    return;
  }

  StartRecording(audioTrack);
}

void SpeechRecognition::DispatchError(SpeechRecognitionErrorCode aErrorCode,
                                      const nsACString& aMessage) {
  MOZ_ASSERT(NS_IsMainThread());

  RefPtr<SpeechRecognitionError> srError =
      new SpeechRecognitionError(nullptr, nullptr, nullptr);

  srError->InitSpeechRecognitionError(u"error"_ns, true, false, aErrorCode,
                                      aMessage);
  srError->SetTrusted(true);

  DispatchEvent(*srError);
}

}  // namespace mozilla::dom
