/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8  et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DOM_MEDIA_WEBSPEECH_RECOGNITION_SPEECHRECOGNITIONMODELMAPPING_H_
#define DOM_MEDIA_WEBSPEECH_RECOGNITION_SPEECHRECOGNITIONMODELMAPPING_H_

#include "nsString.h"
#include "nsTArray.h"

namespace mozilla::dom {

// ModelHub engine id and task used for every speech recognition model. Shared
// so the download path in the parent process and the read-only availability
// queries in the utility process agree on them.
inline constexpr auto kSpeechRecognitionEngineId = "parakeet-gguf"_ns;
inline constexpr auto kSpeechRecognitionTask = "speech-recognition"_ns;

// The concrete ModelHub artifact a set of requested languages maps to.
struct SpeechModelIdentifier {
  nsCString mModelName;
  nsCString mFileName;
  nsCString mRevision = "main"_ns;
  uint32_t mSizeMB = 0;
  nsCString ToString() const;
};

// Maps a set of requested BCP-47 languages to a model id (the model table's
// own "id" field, e.g. "english_tdt_ctc_q6_k"), honoring the
// media.webspeech.recognition.model.<prefix> pref override. The id, not the
// artifact itself, is what the utility process sends onward: it can only ever
// select among the ids this function can return, never name a
// model/revision/filename directly. The model table (generated from
// models.yaml) lives only in this translation unit's .cpp.
nsCString LanguagesToSpeechModelId(const nsTArray<nsCString>& aLanguages);

// Expands aId (as returned by LanguagesToSpeechModelId) to the concrete
// ModelHub artifact it names. Returns false if aId is unknown. Used trusted-
// side (see SpeechModelResolver) to validate an id supplied by the utility
// process before it is passed to ModelHub.
bool ResolveSpeechModelId(const nsACString& aId, SpeechModelIdentifier& aOut);

// Approximate download size in MB of the model artifact identified by
// aModel/aRevision/aFilename, for display in the download permission prompt.
// Returns 0 for an unknown artifact. Keyed by the artifact (not languages) so
// the download gate, which only sees the generic model coordinates, can look
// it up. The model table lives only in this translation unit's .cpp.
uint32_t SpeechModelSizeMB(const nsACString& aModel,
                           const nsACString& aRevision,
                           const nsACString& aFilename);

}  // namespace mozilla::dom

#endif  // DOM_MEDIA_WEBSPEECH_RECOGNITION_SPEECHRECOGNITIONMODELMAPPING_H_
