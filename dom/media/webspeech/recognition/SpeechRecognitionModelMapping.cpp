/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8  et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SpeechRecognitionModelMapping.h"

#include "SpeechRecognitionModels.h"
#include "mozilla/Assertions.h"
#include "mozilla/Preferences.h"
#include "nsFmtString.h"
#include "nsReadableUtils.h"

namespace mozilla::dom {

nsCString SpeechModelIdentifier::ToString() const {
  return nsFmtCString("{}/{}/{}", mModelName.get(), mFileName.get(),
                      mRevision.get());
}

nsCString LanguagesToSpeechModelId(const nsTArray<nsCString>& aLanguages) {
  // Determine the primary-subtag locale prefix (e.g. "en" from "en-US"). This
  // discards script/region subtags, so e.g. zh-Hans and zh-Hant both collapse
  // to zh; proper BCP-47 canonicalization is tracked in bug 2060247.
  nsCString prefix;
  if (!aLanguages.IsEmpty()) {
    prefix = aLanguages[0];
    int32_t dash = prefix.FindChar('-');
    if (dash != kNotFound) {
      prefix.Truncate(dash);
    }
  }

  // A pref may override the default model for a locale prefix:
  // media.webspeech.recognition.model.<prefix> (or .multilingual for the
  // fallback). Empty prefix uses the multilingual fallback.
  nsAutoCString prefKey("media.webspeech.recognition.model.");
  prefKey.Append(prefix.IsEmpty() ? "multilingual"_ns : prefix);
  nsAutoCString prefModelId;
  Preferences::GetCString(prefKey.get(), prefModelId);

  if (!prefModelId.IsEmpty()) {
    for (const auto& m : kSpeechRecognitionModels) {
      if (m.id && prefModelId.Equals(m.id)) {
        return nsCString(m.id);
      }
    }
  }

  // No usable pref: pick the default model whose locale list matches the
  // prefix, falling back to the default fallback model (empty locale list).
  const SpeechRecognitionModelInfo* fallback = nullptr;
  for (const auto& m : kSpeechRecognitionModels) {
    if (!m.id) {
      break;
    }
    if (!m.locales[0]) {
      if (m.is_default && !fallback) {
        fallback = &m;
      }
      continue;
    }
    for (const char* const* l = m.locales; *l; ++l) {
      if (!prefix.IsEmpty() &&
          StringBeginsWith(prefix, nsDependentCString(*l))) {
        if (m.is_default) {
          return nsCString(m.id);
        }
      }
    }
  }

  if (fallback) {
    return nsCString(fallback->id);
  }

  MOZ_ASSERT_UNREACHABLE("No default model found in kSpeechRecognitionModels");
  return {};
}

bool ResolveSpeechModelId(const nsACString& aId, SpeechModelIdentifier& aOut) {
  for (const auto& m : kSpeechRecognitionModels) {
    if (!m.id) {
      break;
    }
    if (aId.Equals(m.id)) {
      aOut = {nsCString(m.repo), nsCString(m.filename), nsCString(m.revision),
              m.size_mb};
      return true;
    }
  }
  return false;
}

uint32_t SpeechModelSizeMB(const nsACString& aModel,
                           const nsACString& aRevision,
                           const nsACString& aFilename) {
  for (const auto& m : kSpeechRecognitionModels) {
    if (!m.id) {
      break;
    }
    if (aModel.Equals(m.repo) && aRevision.Equals(m.revision) &&
        aFilename.Equals(m.filename)) {
      return m.size_mb;
    }
  }
  return 0;
}

}  // namespace mozilla::dom
