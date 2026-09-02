/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_dom_SpeechRecognition_h
#define mozilla_dom_SpeechRecognition_h

#include "AudioSegment.h"
#include "DOMMediaStream.h"
#include "MediaTrackGraph.h"
#include "SpeechGrammarList.h"
#include "SpeechRecognitionResultList.h"
#include "js/TypeDecls.h"
#include "mozilla/DOMEventTargetHelper.h"
#include "mozilla/WeakPtr.h"
#include "mozilla/dom/BindingDeclarations.h"
#include "mozilla/dom/SpeechRecognitionError.h"
#include "nsCOMPtr.h"
#include "nsProxyRelease.h"
#include "nsString.h"
#include "nsTArray.h"
#include "nsWrapperCache.h"

namespace mozilla {

namespace media {
class ShutdownBlocker;
}

namespace dom {

#define SPEECH_RECOGNITION_TEST_EVENT_REQUEST_TOPIC \
  "SpeechRecognitionTest:RequestEvent"
#define SPEECH_RECOGNITION_TEST_END_TOPIC "SpeechRecognitionTest:End"

class GlobalObject;
class AudioStreamTrack;
class MediaStreamTrack;
class SpeechTrackListener;

class SpeechRecognition final : public DOMEventTargetHelper,
                                public SupportsWeakPtr {
 public:
  explicit SpeechRecognition(nsPIDOMWindowInner* aOwnerWindow);

  NS_DECL_ISUPPORTS_INHERITED
  NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED(SpeechRecognition,
                                           DOMEventTargetHelper)

  JSObject* WrapObject(JSContext* aCx,
                       JS::Handle<JSObject*> aGivenProto) override;

  static already_AddRefed<SpeechRecognition> Constructor(
      const GlobalObject& aGlobal, ErrorResult& aRv);

  static already_AddRefed<SpeechRecognition> WebkitSpeechRecognition(
      const GlobalObject& aGlobal, ErrorResult& aRv) {
    return Constructor(aGlobal, aRv);
  }

  already_AddRefed<SpeechGrammarList> Grammars() const;

  void SetGrammars(mozilla::dom::SpeechGrammarList& aArg);

  void GetLang(nsString& aRetVal) const;

  void SetLang(const nsAString& aArg);

  bool GetContinuous(ErrorResult& aRv) const;

  void SetContinuous(bool aArg, ErrorResult& aRv);

  bool InterimResults() const;

  void SetInterimResults(bool aArg);

  uint32_t MaxAlternatives() const;

  TaskQueue* GetTaskQueueForEncoding() const;

  void SetMaxAlternatives(uint32_t aArg);

  void GetServiceURI(nsString& aRetVal, ErrorResult& aRv) const;

  void SetServiceURI(const nsAString& aArg, ErrorResult& aRv);

  void Start(const Optional<NonNull<DOMMediaStream>>& aStream,
             CallerType aCallerType, ErrorResult& aRv);

  void Stop();

  void Abort();

  IMPL_EVENT_HANDLER(audiostart)
  IMPL_EVENT_HANDLER(soundstart)
  IMPL_EVENT_HANDLER(speechstart)
  IMPL_EVENT_HANDLER(speechend)
  IMPL_EVENT_HANDLER(soundend)
  IMPL_EVENT_HANDLER(audioend)
  IMPL_EVENT_HANDLER(result)
  IMPL_EVENT_HANDLER(nomatch)
  IMPL_EVENT_HANDLER(error)
  IMPL_EVENT_HANDLER(start)
  IMPL_EVENT_HANDLER(end)

  void NotifyTrackAdded(const RefPtr<MediaStreamTrack>& aTrack);

  class TrackListener final : public DOMMediaStream::TrackListener {
   public:
    NS_DECL_ISUPPORTS_INHERITED
    NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED(TrackListener,
                                             DOMMediaStream::TrackListener)
    explicit TrackListener(SpeechRecognition* aSpeechRecognition)
        : mSpeechRecognition(aSpeechRecognition) {}
    void NotifyTrackAdded(const RefPtr<MediaStreamTrack>& aTrack) override {
      mSpeechRecognition->NotifyTrackAdded(aTrack);
    }

   private:
    virtual ~TrackListener() = default;
    RefPtr<SpeechRecognition> mSpeechRecognition;
  };

  // aMessage should be valid UTF-8, but invalid UTF-8 byte sequences are
  // replaced with the REPLACEMENT CHARACTER on conversion to UTF-16.
  void DispatchError(SpeechRecognitionErrorCode aErrorCode,
                     const nsACString& aMessage);
  template <int N>
  void DispatchError(SpeechRecognitionErrorCode aErrorCode,
                     const char (&aMessage)[N]) {
    DispatchError(aErrorCode, nsLiteralCString(aMessage));
  }

 private:
  virtual ~SpeechRecognition();

  NS_IMETHOD StartRecording(RefPtr<AudioStreamTrack>& aDOMStream);
  RefPtr<GenericNonExclusivePromise> StopRecording();

  uint32_t ProcessAudioSegment(AudioSegment* aSegment, TrackRate aTrackRate);

  void Reset();
  void ResetAndEnd();

  RefPtr<DOMMediaStream> mStream;
  RefPtr<AudioStreamTrack> mTrack;
  bool mTrackIsOwned = false;
  RefPtr<GenericNonExclusivePromise> mStopRecordingPromise;
  RefPtr<SpeechTrackListener> mSpeechListener;
  RefPtr<media::ShutdownBlocker> mShutdownBlocker;

  bool mAborted;

  nsString mLang;

  RefPtr<SpeechGrammarList> mSpeechGrammarList;

  bool mContinuous;
  bool mInterimResults;

  // WebSpeechAPI (http://bit.ly/1JAiqeo) states:
  //
  // 1. Default value is 1
  // 2. Subsequent value is the "maximum number of SpeechRecognitionAlternatives
  // per result"
  //
  // Pocketsphinx can only return at maximum a single
  // SpeechRecognitionAlternative per SpeechRecognitionResult. So defaulting
  // mMaxAlternatives to 1, for all non zero values ignoring mMaxAlternatives
  // while for a 0 value returning no SpeechRecognitionAlternative per result is
  // a conforming implementation.
  uint32_t mMaxAlternatives;

  RefPtr<TrackListener> mListener;
};

}  // namespace dom

inline nsISupports* ToSupports(dom::SpeechRecognition* aRec) {
  return ToSupports(static_cast<DOMEventTargetHelper*>(aRec));
}

}  // namespace mozilla

#endif
