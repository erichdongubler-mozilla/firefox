/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8  et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DOM_MEDIA_WEBSPEECH_RECOGNITION_SPEECHRECOGNITIONPARENT_H_
#define DOM_MEDIA_WEBSPEECH_RECOGNITION_SPEECHRECOGNITIONPARENT_H_

#include "WavDumper.h"
#include "mozilla/dom/Promise.h"
#include "mozilla/dom/ipc/IdType.h"
#include "mozilla/hwinference/PSpeechRecognitionParent.h"
#include "nsCOMPtr.h"
#include "nsISupportsImpl.h"
#include "nsStringFwd.h"

namespace mozilla::hwinference {

class SpeechRecognitionParent final : public PSpeechRecognitionParent {
 public:
  NS_INLINE_DECL_REFCOUNTING(SpeechRecognitionParent, override)

  // aContentId is the GeckoChildID the parent process assigned to the content
  // process that created this session. It is never supplied by content, and is
  // forwarded with install requests so the parent can verify the window owner.
  explicit SpeechRecognitionParent(dom::ContentParentId aContentId);

  ipc::IPCResult RecvIsModelAvailable(const nsTArray<nsCString>& aLanguages,
                                      IsModelAvailableResolver&& aResolver);
  void ActorDestroy(ActorDestroyReason aReason) override;

  struct ModelIdentifier {
    nsCString mModelName;
    nsCString mFileName;
    nsCString mRevision = "main"_ns;
    nsCString ToString() const;
  };

  ModelIdentifier LanguagesToModelIdentifier(
      const nsTArray<nsCString>& aLanguages);

 private:
  ~SpeechRecognitionParent();

  const dom::ContentParentId mContentId;
};

}  // namespace mozilla::hwinference

#endif  // DOM_MEDIA_WEBSPEECH_RECOGNITION_SPEECHRECOGNITIONPARENT_H_
