/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SpeechRecognition.h"

#include <algorithm>

#include "AudioSegment.h"
#include "CubebUtils.h"
#include "MainThreadUtils.h"
#include "MediaEnginePrefs.h"
#include "SpeechRecognitionAlternative.h"
#include "SpeechRecognitionBackend.h"
#include "SpeechRecognitionResult.h"
#include "SpeechRecognitionResultList.h"
#include "SpeechTrackListener.h"
#include "VideoUtils.h"
#include "mozilla/AbstractThread.h"
#include "mozilla/ClearOnShutdown.h"
#include "mozilla/MediaManager.h"
#include "mozilla/dom/AudioStreamTrack.h"
#include "mozilla/dom/BindingUtils.h"
#include "mozilla/dom/Document.h"
#include "mozilla/dom/Element.h"
#include "mozilla/dom/MediaStreamBinding.h"
#include "mozilla/dom/MediaStreamError.h"
#include "mozilla/dom/MediaStreamTrackBinding.h"
#include "mozilla/dom/PromiseNativeHandler.h"
#include "mozilla/dom/RootedDictionary.h"
#include "mozilla/dom/SpeechGrammar.h"
#include "mozilla/dom/SpeechRecognitionError.h"
#include "mozilla/dom/SpeechRecognitionEvent.h"
#include "mozilla/dom/SpeechRecognitionPhrase.h"
#include "mozilla/intl/Locale.h"
#include "nsCOMPtr.h"
#include "nsComponentManagerUtils.h"
#include "nsContentUtils.h"
#include "nsCycleCollectionParticipant.h"
#include "nsGkAtoms.h"
#include "nsGlobalWindowInner.h"
#include "nsIContent.h"
#include "nsIPermissionManager.h"
#include "nsIPrincipal.h"
#include "nsPIDOMWindow.h"
#include "nsQueryObject.h"
#include "nsServiceManagerUtils.h"
#include "nsString.h"

// Undo the windows.h damage
#if defined(XP_WIN) && defined(GetMessage)
#  undef GetMessage
#endif

namespace mozilla {
class Promise;
};

namespace mozilla::dom {
static LazyLogModule gSpeechRecognitionLog("SpeechRecognition");

#define LOG(...) \
  MOZ_LOG_FMT(gSpeechRecognitionLog, LogLevel::Debug, __VA_ARGS__)
#define LOGV(...) \
  MOZ_LOG_FMT(gSpeechRecognitionLog, LogLevel::Verbose, __VA_ARGS__)
#define LOGE(...) \
  MOZ_LOG_FMT(gSpeechRecognitionLog, LogLevel::Error, __VA_ARGS__)

NS_IMPL_CYCLE_COLLECTION_CLASS(SpeechRecognition)
NS_IMPL_CYCLE_COLLECTION_UNLINK_BEGIN_INHERITED(SpeechRecognition,
                                                DOMEventTargetHelper)
  NS_IMPL_CYCLE_COLLECTION_UNLINK(mTrack, mSpeechGrammarList, mListener,
                                  mPhrases, mRecognitionResults)
  NS_IMPL_CYCLE_COLLECTION_UNLINK_WEAK_PTR
NS_IMPL_CYCLE_COLLECTION_UNLINK_END
NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN_INHERITED(SpeechRecognition,
                                                  DOMEventTargetHelper)
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE(mTrack, mSpeechGrammarList, mListener,
                                    mPhrases, mRecognitionResults)
NS_IMPL_CYCLE_COLLECTION_TRAVERSE_END

nsTHashSet<nsCString> SpeechRecognition::sDownloadingLanguages;
nsTHashMap<nsCStringHashKey, RefPtr<GenericNonExclusivePromise::Private>>
    SpeechRecognition::sLanguageDownloadPromises;

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

// Lifetime considerations:
// This class, like other classes interacting with MediaStreams, has a
// non-standard lifetime:
// - If script has a direct ref, SpeechRecognition stays alive, by definition.
// Depending on its state, the backend can be cleared / destroyed early or not.
// - Otherwise, if the input track's readyState is "live" and there is some
// callback registered, SpeechRecognition stays alive. Otherwise, e.g. if the
// input track is live, script has no refs, and there are no callbacks, the
// instance isn't useful and can be collected.
//
// This is implemented using the KeepAliveIfHasListenersFor mechanism from
// DOMEventTargetHelper. When recognition starts (mStarted becomes true), we
// register the relevant event types that should keep this object alive if
// listeners are present. When recognition ends (Reset is called -- directly or
// indirectly), we unregister them.
static constexpr nsStaticAtom* const kKeepAliveEventTypes[] = {
    nsGkAtoms::onstart,       nsGkAtoms::onaudiostart, nsGkAtoms::onsoundstart,
    nsGkAtoms::onspeechstart, nsGkAtoms::onspeechend,  nsGkAtoms::onsoundend,
    nsGkAtoms::onaudioend,    nsGkAtoms::onresult,     nsGkAtoms::onnomatch,
    nsGkAtoms::onerror,       nsGkAtoms::onend};

SpeechRecognition::SpeechRecognition(nsPIDOMWindowInner* aOwnerWindow)
    : DOMEventTargetHelper(aOwnerWindow),
      mStarted(false),
      mSpeechGrammarList(new SpeechGrammarList(aOwnerWindow)),
      mContinuous(false),
      mInterimResults(false),
      mMaxAlternatives(1) {
  LOG("SpeechRecognition::SpeechRecognition");

  Reset();
}

SpeechRecognition::~SpeechRecognition() {
  MOZ_ASSERT(NS_IsMainThread(), "Destructor must be on main thread");
  LOG("SpeechRecognition::~SpeechRecognition");

  // Ensure backend is properly cleaned up
  if (mBackend) {
    mBackend->Abort(TrailingEvents::Skip);
    mBackend = nullptr;
  }
}

JSObject* SpeechRecognition::WrapObject(JSContext* aCx,
                                        JS::Handle<JSObject*> aGivenProto) {
  return SpeechRecognition_Binding::Wrap(aCx, this, aGivenProto);
}

void SpeechRecognition::DisconnectFromOwner() {
  AssertIsOnMainThread();
  if (mBackend) {
    mBackend->Abort(TrailingEvents::Skip);
    mBackend = nullptr;
  }
  Reset();
  DOMEventTargetHelper::DisconnectFromOwner();
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
  MOZ_ASSERT(NS_IsMainThread(), "Reset must be on main thread");
  if (mStarted) {
    for (nsStaticAtom* atom : kKeepAliveEventTypes) {
      IgnoreKeepAliveIfHasListenersFor(atom);
    }
  }
  mStarted = false;
  mStopping = false;
  mAborting = false;
  mBackendListening = false;
  mStartDispatched = false;
  // A track obtained via our own getUserMedia() call (the microphone path)
  // has nobody else to stop it; an explicitly-passed track is the caller's
  // to manage.
  if (mTrack && mTrackIsOwned) {
    mTrack->Stop();
  }
  mTrack = nullptr;
  mTrackIsOwned = false;
  // The microphone path (Start() with no explicit track) registers mListener
  // on mStream; it must be unregistered before being cleared (see
  // DOMMediaStream::TrackListener). Without this, mListener/mStream survive a
  // stop()/abort() and a later Start() hits MOZ_ASSERT(!mListener).
  if (mStream && mListener) {
    mStream->UnregisterTrackListener(mListener);
  }
  mListener = nullptr;
  mStream = nullptr;
  mRecognitionResults.Clear();
}

void SpeechRecognition::ResetAndEnd() {
  Reset();
  DispatchTrustedEvent(u"end"_ns);
}

void SpeechRecognition::PostResetAndEnd() {
  AssertIsOnMainThread();
  RefPtr<SpeechRecognition> self = this;
  NS_DispatchToMainThread(NS_NewRunnableFunction(
      "SpeechRecognition::PostResetAndEnd", [self = std::move(self)]() {
        // Don't end a session that started since this was queued: an "end"
        // handler can call start().
        if (self->mBackend) {
          return;
        }
        // Reset() cleared [[started]], so this session has already ended. A
        // newer session that both started and finished in between gets its
        // "end" from here, and its own runnable then no-ops - exactly one
        // "end" either way.
        if (!self->mStarted) {
          return;
        }
        self->ResetAndEnd();
      }));
}

void SpeechRecognition::MaybeDispatchStart() {
  AssertIsOnMainThread();
  if (mStartDispatched || !mStarted) {
    return;
  }
  if (!mBackendListening || !mTrack) {
    return;
  }
  mStartDispatched = true;
  DispatchTrustedEvent(u"start"_ns);
}

void SpeechRecognition::NotifyBackendListening() {
  AssertIsOnMainThread();
  mBackendListening = true;
  MaybeDispatchStart();
}

NS_IMETHODIMP
SpeechRecognition::StartRecording(RefPtr<AudioStreamTrack>& aTrack) {
  AssertIsOnMainThread();
  MOZ_ASSERT(!aTrack->Ended());
  MOZ_ASSERT(mBackend);

  mTrack = aTrack;
  mBackend->AttachToTrack(aTrack);
  MaybeDispatchStart();

  return NS_OK;
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

static bool ValidateBCP47Language(const nsACString& aLang, ErrorResult& aRv) {
  Span<const char> langSpan(aLang.BeginReading(), aLang.Length());

  // Empty strings are not valid BCP47 language tags
  if (langSpan.IsEmpty()) {
    aRv.ThrowSyntaxError("Invalid BCP47 language tag");
    return false;
  }

  intl::Locale locale;
  auto result = intl::LocaleParser::TryParse(langSpan, locale);

  if (result.isErr()) {
    aRv.ThrowSyntaxError("Invalid BCP47 language tag");
    return false;
  }

  return true;
}

bool SpeechRecognition::ProcessLocally() const { return mProcessLocally; }

void SpeechRecognition::SetProcessLocally(bool aProcessLocally) {
  mProcessLocally = aProcessLocally;
}

void SpeechRecognition::OnSetPhrases(SpeechRecognitionPhrase& aPhrase,
                                     uint32_t aIndex, ErrorResult& aRv) {
  // Note: The spec is unclear on whether dynamic updates during recognition
  // should affect ongoing recognition. For now, the backend only gets phrases
  // at Start() time.
  mPhrases.InsertElementAt(aIndex, &aPhrase);
}

void SpeechRecognition::OnDeletePhrases(SpeechRecognitionPhrase& aPhrase,
                                        uint32_t aIndex, ErrorResult& aRv) {
  MOZ_ASSERT(mPhrases.ElementAt(aIndex) == &aPhrase);
  // Similar comment as OnSetPhrases here: changes aren't sent to the backend
  // after start().
  mPhrases.RemoveElementAt(aIndex);
}

/* static */
already_AddRefed<Promise> SpeechRecognition::Available(
    const GlobalObject& aGlobal, const SpeechRecognitionOptions& aOptions,
    ErrorResult& aRv) {
  AssertIsOnMainThread();

  // Step 1: Check if Document is fully active.
  nsCOMPtr<nsPIDOMWindowInner> window =
      do_QueryInterface(aGlobal.GetAsSupports());
  if (!window || !window->IsFullyActive()) {
    aRv.ThrowInvalidStateError("The document is not fully active.");
    return nullptr;
  }

  nsCOMPtr<nsIGlobalObject> global = do_QueryInterface(aGlobal.GetAsSupports());
  if (!global) {
    aRv.Throw(NS_ERROR_FAILURE);
    return nullptr;
  }

  // Step 3: Validate all language tags are valid BCP47.
  for (const nsCString& lang : aOptions.mLangs) {
    if (!ValidateBCP47Language(lang, aRv)) {
      return nullptr;
    }
  }

  RefPtr<Promise> promise = Promise::Create(global, aRv);
  if (aRv.Failed()) {
    return nullptr;
  }

  // Step 4: If processLocally is false, Gecko doesn't support remote
  // recognition.
  if (!aOptions.mProcessLocally) {
    promise->MaybeResolve(AvailabilityStatus::Unavailable);
    return promise.forget();
  }

  // Step 5: processLocally is true.
  // If langs is empty, return unavailable.
  if (aOptions.mLangs.IsEmpty()) {
    promise->MaybeResolve(AvailabilityStatus::Unavailable);
    return promise.forget();
  }

  // Check if any requested language is currently being downloaded.
  // https://bugzilla.mozilla.org/show_bug.cgi?id=2006385
  // The spec requires per-language status checking with a
  // "worst status" algorithm. This is best implemented in the backend.
  for (const nsCString& lang : aOptions.mLangs) {
    if (sDownloadingLanguages.Contains(lang)) {
      promise->MaybeResolve(AvailabilityStatus::Downloading);
      return promise.forget();
    }
  }

  return SpeechRecognitionBackend::Available(global, aOptions.mLangs);
}

class InstallCompletionHandler final : public PromiseNativeHandler {
 public:
  NS_DECL_ISUPPORTS

  explicit InstallCompletionHandler(nsTArray<nsCString>&& aLanguages)
      : mLanguages(std::move(aLanguages)) {}

  void ResolvedCallback(JSContext* aCx, JS::Handle<JS::Value> aValue,
                        ErrorResult& aRv) override {
    for (const nsCString& lang : mLanguages) {
      SpeechRecognition::RemoveDownloadingLanguage(lang,
                                                   DownloadOutcome::Succeeded);
    }
  }

  void RejectedCallback(JSContext* aCx, JS::Handle<JS::Value> aValue,
                        ErrorResult& aRv) override {
    for (const nsCString& lang : mLanguages) {
      SpeechRecognition::RemoveDownloadingLanguage(lang,
                                                   DownloadOutcome::Failed);
    }
  }

 private:
  ~InstallCompletionHandler() = default;

  nsTArray<nsCString> mLanguages;
};

NS_IMPL_ISUPPORTS0(InstallCompletionHandler)

/* static */
void SpeechRecognition::RemoveDownloadingLanguage(const nsCString& aLanguage,
                                                  DownloadOutcome aOutcome) {
  AssertIsOnMainThread();
  sDownloadingLanguages.Remove(aLanguage);
  if (auto entry = sLanguageDownloadPromises.Lookup(aLanguage)) {
    entry.Data()->Resolve(aOutcome == DownloadOutcome::Succeeded, __func__);
    entry.Remove();
  }
}

/* static */
already_AddRefed<GenericNonExclusivePromise>
SpeechRecognition::GetDownloadCompletionPromise(const nsCString& aLanguage) {
  AssertIsOnMainThread();
  auto entry = sLanguageDownloadPromises.Lookup(aLanguage);
  MOZ_ASSERT(entry, "Only call this for a language in sDownloadingLanguages");
  RefPtr<GenericNonExclusivePromise> promise = entry.Data();
  return promise.forget();
}

/* static */
already_AddRefed<Promise> SpeechRecognition::Install(
    const GlobalObject& aGlobal, const SpeechRecognitionOptions& aOptions,
    ErrorResult& aRv) {
  AssertIsOnMainThread();
  nsCOMPtr<nsPIDOMWindowInner> window =
      do_QueryInterface(aGlobal.GetAsSupports());
  if (!window) {
    aRv.ThrowAbortError("No global object for SpeechRecognition::Install");
    return nullptr;
  }

  nsCOMPtr<Document> doc = window->GetExtantDoc();
  if (!doc) {
    aRv.ThrowAbortError("No document for SpeechRecognition::Install");
    return nullptr;
  }

  if (!doc->IsCurrentActiveDocument()) {
    aRv.ThrowInvalidStateError(
        "Document not active for SpeechRecognition::Install");
    return nullptr;
  }

  nsCOMPtr<nsIGlobalObject> global = do_QueryInterface(aGlobal.GetAsSupports());
  if (!global) {
    aRv.Throw(NS_ERROR_FAILURE);
    return nullptr;
  }

  // Not specced yet:
  // https://github.com/WebAudio/web-speech-api/issues/174
  if (aOptions.mLangs.IsEmpty()) {
    aRv.ThrowRangeError("empty lang");
    return nullptr;
  }

  // Validate all language tags according to spec
  for (const nsCString& lang : aOptions.mLangs) {
    if (!ValidateBCP47Language(lang, aRv)) {
      return nullptr;
    }
    if (aRv.Failed()) {
      return nullptr;
    }
  }

  // If a language's download is already in flight, don't produce a second
  // request for it: just create and stash a promise, to be resolved when
  // that download ends (success or failure), and wait on it here instead.
  nsTArray<nsCString> languagesUtf8 =
      ToTArray<nsTArray<nsCString>>(aOptions.mLangs);

  // Check if any language is already downloading
  for (const nsCString& lang : languagesUtf8) {
    if (sDownloadingLanguages.Contains(lang)) {
      LOG("Install: language {} already downloading", lang.get());
      RefPtr<Promise> promise = Promise::Create(global, aRv);
      if (aRv.Failed()) {
        return nullptr;
      }
      promise->MaybeResolve(false);
      return promise.forget();
    }
  }

  // Mark languages as downloading
  for (const nsCString& lang : languagesUtf8) {
    sDownloadingLanguages.Insert(lang);
  }

  RefPtr<Promise> promise =
      SpeechRecognitionBackend::Install(global, aOptions.mLangs);

  RefPtr<InstallCompletionHandler> handler =
      new InstallCompletionHandler(std::move(languagesUtf8));
  promise->AppendNativeHandler(handler);

  return promise.forget();
}

void SpeechRecognition::Start(CallerType aCallerType, ErrorResult& aRv) {
  StartImpl(nullptr, aCallerType, aRv);
}

void SpeechRecognition::Start(MediaStreamTrack& aAudioTrack,
                              CallerType aCallerType, ErrorResult& aRv) {
  StartImpl(&aAudioTrack, aCallerType, aRv);
}

// https://webaudio.github.io/web-speech-api/#start-session-algorithm
void SpeechRecognition::StartImpl(MediaStreamTrack* aAudioTrack,
                                  CallerType aCallerType, ErrorResult& aRv) {
  AssertIsOnMainThread();
  LOG("SpeechRecognition::Start called");

  // Step 1: if the relevant global's associated Document is not fully active,
  // throw an InvalidStateError.
  nsPIDOMWindowInner* win = GetOwnerWindow();
  if (!win || !win->IsFullyActive()) {
    aRv.ThrowInvalidStateError("The document is not fully active.");
    return;
  }

  // Step 2: if [[started]] is true and no error or end event has fired on it,
  // throw an InvalidStateError. mStarted is cleared once error/end fires, so it
  // tracks exactly that condition.
  if (mStarted) {
    aRv.ThrowInvalidStateError("Recognition has already been started");
    return;
  }

  MOZ_ASSERT(!mListener);
  MOZ_ASSERT(!mBackend);

  // Step 3 (phrases-not-supported) does not apply: Gecko supports contextual
  // biasing, so phrases are honoured rather than rejected (see below).
  uint32_t graphRate = 0;
  if (aAudioTrack) {
    graphRate = aAudioTrack->Graph()->GraphRate();
  } else {
    // If using the microphone, it is always at the preferred rate
    graphRate =
        CubebUtils::PreferredSampleRate(/* shouldResistFingerPrinting*/ false);
  }

  // init and start the backend
  // Extract phrase strings from our local copy of SpeechRecognitionPhrase
  // objects. The backend gets these at Start() time; the spec is unclear on
  // dynamic updates
  // https://github.com/WebAudio/web-speech-api/issues/172
  nsTArray<nsString> phrasesForBackend;
  for (const auto& phrase : mPhrases) {
    if (phrase) {
      nsString phraseStr;
      phrase->GetPhrase(phraseStr);
      phrasesForBackend.AppendElement(phraseStr);
    }
  }
  // Validate track if provided
  RefPtr<AudioStreamTrack> audioTrack;
  if (aAudioTrack) {
    audioTrack = aAudioTrack->AsAudioStreamTrack();

    if (!audioTrack) {
      aRv.ThrowInvalidStateError("MediaStreamTrack must be an audio track");
      return;
    }

    if (audioTrack->Ended()) {
      aRv.ThrowInvalidStateError("MediaStreamTrack is ended");
      return;
    }
  }

  // Per spec: if lang is unset, default to the document root element's language
  nsString effectiveLang = mLang;
  if (effectiveLang.IsEmpty()) {
    if (nsCOMPtr<Document> doc = win->GetExtantDoc()) {
      if (Element* root = doc->GetRootElement()) {
        root->GetLang(effectiveLang);
      }
    }
  }

  // Step 4: processLocally is always true here (on-device recognition). If the
  // backend cannot start (local recognition unavailable for this lang), fire a
  // service-not-allowed error and abort. DispatchErrorAndEnd queues the event.
  mBackend = SpeechRecognitionBackend::Create(this, graphRate, effectiveLang,
                                              phrasesForBackend);
  if (!mBackend) {
    LOGE("Failed to create the backend");
    DispatchErrorAndEnd(SpeechRecognitionErrorCode::Service_not_allowed,
                        "Local speech recognition is not available"_ns);
    return;
  }
  mBackend->Start();

  // Step 5: set [[started]] to true.
  mStarted = true;
  mBackendListening = false;
  mStartDispatched = false;

  // Register keep-alive event types. While recognition is active, if script
  // has listeners for these events, the object stays alive even without a
  // direct reference from script.
  for (nsStaticAtom* atom : kKeepAliveEventTypes) {
    KeepAliveIfHasListenersFor(atom);
  }

  // "start" fires once the system is successfully listening (see
  // MaybeDispatchStart()), not here: at this point neither the backend
  // session nor (for the microphone path) the track are ready yet.

  // MediaStreamTrack (argument passed) vs. Microphone (no argument passed)
  if (audioTrack) {
    NotifyTrackAdded(audioTrack);
  } else {
    mListener = new TrackListener(this);
    // Identifies the session this continuation belongs to: mListener is
    // freshly allocated per Start() call, so comparing against the live
    // mListener below detects both "stopped" (mListener now null) and
    // "superseded by a newer session" (mListener now points elsewhere)
    // uniformly, the same way IsCurrentBackend() does for backend callbacks.
    RefPtr<TrackListener> startedListener = mListener;

    MediaStreamConstraints constraints;
    constraints.mAudio.SetAsBoolean() = true;

    AutoNoJSAPI nojsapi;
    RefPtr<SpeechRecognition> self(this);
    MediaManager::Get()
        ->GetUserMedia(GetOwnerWindow(), constraints, aCallerType)
        ->Then(
            GetCurrentSerialEventTarget(), __func__,
            [this, self, startedListener](RefPtr<DOMMediaStream>&& aStream) {
              nsTArray<RefPtr<AudioStreamTrack>> tracks;
              aStream->GetAudioTracks(tracks);
              if (mListener != startedListener) {
                // Recognition was stopped, or superseded by a newer session
                // on this instance. Exit early.
                for (const RefPtr<AudioStreamTrack>& track : tracks) {
                  track->Stop();
                }
                return;
              }
              mStream = std::move(aStream);
              mStream->RegisterTrackListener(mListener);
              // This track came from our own getUserMedia() call, so nobody
              // else will stop it; Reset() must do so on teardown.
              mTrackIsOwned = true;
              for (const RefPtr<AudioStreamTrack>& track : tracks) {
                if (!track->Ended()) {
                  NotifyTrackAdded(track);
                }
              }
            },
            [this, self, startedListener](RefPtr<MediaMgrError>&& error) {
              if (mListener != startedListener) {
                // Recognition was stopped, or superseded by a newer session
                // on this instance. Exit early.
                return;
              }
              SpeechRecognitionErrorCode errorCode;

              if (error->mName == MediaMgrError::Name::NotAllowedError) {
                errorCode = SpeechRecognitionErrorCode::Not_allowed;
              } else {
                errorCode = SpeechRecognitionErrorCode::Audio_capture;
              }
              DispatchErrorAndEnd(errorCode, error->mMessage);
            });
  }
}

void SpeechRecognition::Stop() {
  AssertIsOnMainThread();
  // https://webaudio.github.io/web-speech-api/#dom-speechrecognition-stop
  // "If the stop method is called on an object which is already stopped or
  // being stopped [...] the user agent must ignore the call."
  if (!mStarted || mStopping || !mBackend) {
    return;
  }
  mStopping = true;

  // Same section: "The speech service must attempt to return a recognition
  // result (or a nomatch) based on the audio that it has already collected."
  // So mBackend stays live - late results are wanted here, unlike on the
  // abort path - and "end" waits for OnSessionFinished(). Dispatches soundend
  // (if needed) and audioend via main thread runnables in the meantime.
  mBackend->Stop();
}

void SpeechRecognition::OnSessionFinished(bool aProducedResult) {
  AssertIsOnMainThread();
  LOG("OnSessionFinished: producedResult={}", aProducedResult);
  mBackend = nullptr;

  if (!aProducedResult) {
    DispatchNoMatch();
  }
  PostResetAndEnd();
}

void SpeechRecognition::DispatchNoMatch() {
  AssertIsOnMainThread();
  // https://webaudio.github.io/web-speech-api/#eventdef-speechrecognition-nomatch
  // The event's results "may contain speech recognition results that are below
  // the confidence threshold or may be null"; the engine hands us nothing at
  // all in this case, so the list is empty.
  RootedDictionary<SpeechRecognitionEventInit> init(RootingCx());
  init.mBubbles = true;
  init.mCancelable = false;
  init.mResultIndex = 0;
  init.mResults = new SpeechRecognitionResultList(this);
  init.mInterpretation = JS::NullValue();

  RefPtr<SpeechRecognitionEvent> domEvent =
      SpeechRecognitionEvent::Constructor(this, u"nomatch"_ns, init);
  domEvent->SetTrusted(true);
  DispatchEvent(*domEvent);
}

void SpeechRecognition::Abort() {
  AssertIsOnMainThread();
  // https://webaudio.github.io/web-speech-api/#dom-speechrecognition-abort
  // "If the abort method is called on an object which is already stopped or
  // aborting (that is, start was never called on it, the end or error event
  // has fired on it, or abort was previously called on it), the user agent
  // must ignore the call." Without this, a second abort() would queue a second
  // reset-and-end, firing "end" twice.
  if (!mStarted || mAborting) {
    return;
  }
  mAborting = true;

  if (mBackend) {
    mBackend->Abort(TrailingEvents::Fire);
    // Clear backend after abort since no more results are expected
    mBackend = nullptr;
  }

  // https://webaudio.github.io/web-speech-api/#dom-speechrecognition-abort
  // "The user agent must raise an end event once the speech service is no
  // longer connected."
  PostResetAndEnd();
}

void SpeechRecognition::NotifyTrackAdded(
    const RefPtr<MediaStreamTrack>& aTrack) {
  if (mTrack) {
    return;
  }

  // Stop()/Abort() clear mBackend synchronously but only clear mListener
  // (and thus invalidate the getUserMedia continuation's startedListener
  // check) asynchronously via PostResetAndEnd(). A track can be reported
  // added - via that continuation or via the TrackListener callback - in the
  // gap between the two, when mListener still looks live but there is no
  // backend left to record into.
  if (!mBackend) {
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
  MOZ_ASSERT(NS_IsMainThread(), "DispatchError must be on main thread");

  RefPtr<SpeechRecognitionError> srError =
      new SpeechRecognitionError(nullptr, nullptr, nullptr);

  srError->InitSpeechRecognitionError(u"error"_ns, true, false, aErrorCode,
                                      aMessage);
  srError->SetTrusted(true);

  DispatchEvent(*srError);
}

// https://webaudio.github.io/web-speech-api/#eventdef-speechrecognition-end
// "Fired when the service has disconnected. The event must always be
// generated when the session ends no matter the reason for the end."
void SpeechRecognition::DispatchErrorAndEnd(
    SpeechRecognitionErrorCode aErrorCode, const nsACString& aMessage) {
  AssertIsOnMainThread();
  DispatchError(aErrorCode, aMessage);
  if (!mStarted) {
    // The session never reached [[started]] == true (e.g. the backend
    // failed to start before we got there); nothing to tear down and no
    // "end" event is expected.
    return;
  }
  if (mBackend) {
    mBackend->Abort(TrailingEvents::Skip);
    mBackend = nullptr;
  }
  PostResetAndEnd();
}

void SpeechRecognition::DispatchTrustedEventWithTimestamp(
    const nsAString& aEventName, TimeStamp aTimeStamp) {
  RefPtr<Event> event = NS_NewDOMEvent(this, nullptr, nullptr);
  event->InitEvent(aEventName, false, false);
  if (!aTimeStamp.IsNull()) {
    event->WidgetEventPtr()->mTimeStamp = aTimeStamp;
  }
  event->SetTrusted(true);
  ErrorResult rv;
  DispatchEvent(*event, rv);
}

void SpeechRecognition::HandleRecognitionResultFromBackend(
    const nsCString& aTranscript, bool aIsFinal) {
  MOZ_ASSERT(NS_IsMainThread(), "Must be called on main thread");
  LOG("HandleRecognitionResultFromBackend: {} (final={})", aTranscript.get(),
      aIsFinal);

  // Check if still active
  if (!mBackend) {
    LOG("Ignoring result - backend is gone");
    return;
  }

  // Per spec: when interimResults is false, interim results must not be
  // returned
  if (!aIsFinal && !mInterimResults) {
    LOG("Ignoring interim result - interimResults is false");
    return;
  }

  // NOTE: We don't implement non-continuous mode (mContinuous=false) for now.
  // The spec semantics are unclear with modern local LLM-based recognition.
  // See https://github.com/WebAudio/web-speech-api/issues/176

  RefPtr<SpeechRecognitionResult> result = new SpeechRecognitionResult(this);

  RefPtr<SpeechRecognitionAlternative> alternative =
      new SpeechRecognitionAlternative(this);

  alternative->mTranscript = NS_ConvertUTF8toUTF16(aTranscript);
  // The confidence is for now always 1.0. We have per token confidence score,
  // and we need the spec to define how to compute this number in an
  // engine-independant way, and for text segment and not per token (e.g.
  // average, median, take lowest for a conservative estimate, etc.).
  alternative->mConfidence = 1.0f;

  result->mItems.AppendElement(alternative);

  result->SetFinal(aIsFinal);

  // Streaming backends only emit final results, so prior entries never change.
  MOZ_ASSERT(aIsFinal);
  uint32_t resultIndex = mRecognitionResults.Length();
  mRecognitionResults.AppendElement(result);

  RefPtr<SpeechRecognitionResultList> resultList =
      new SpeechRecognitionResultList(this);
  resultList->mItems.AppendElements(mRecognitionResults);

  RootedDictionary<SpeechRecognitionEventInit> init(RootingCx());
  init.mBubbles = true;
  init.mCancelable = false;
  init.mResultIndex = resultIndex;
  init.mResults = resultList;
  init.mInterpretation = JS::NullValue();

  RefPtr<SpeechRecognitionEvent> domEvent =
      SpeechRecognitionEvent::Constructor(this, u"result"_ns, init);
  domEvent->SetTrusted(true);
  DispatchEvent(*domEvent);
}

void SpeechRecognition::HandleRecognitionErrorFromBackend(
    const nsCString& aError) {
  MOZ_ASSERT(NS_IsMainThread(), "Must be called on main thread");
  LOGE("HandleRecognitionErrorFromBackend: {}", aError.get());

  // Check if we're still active
  if (!mBackend) {
    LOG("Ignoring error - backend is gone");
    return;
  }

  // Map backend errors to appropriate error codes
  SpeechRecognitionErrorCode errorCode = SpeechRecognitionErrorCode::Network;
  if (aError.EqualsLiteral("concurrent-session") ||
      aError.EqualsLiteral("service-not-allowed")) {
    errorCode = SpeechRecognitionErrorCode::Service_not_allowed;
  }

  LOG("Dispatching error DOM event: {}", aError.get());
  DispatchErrorAndEnd(errorCode, aError);
}

}  // namespace mozilla::dom

#undef LOG
#undef LOGV
#undef LOGE
