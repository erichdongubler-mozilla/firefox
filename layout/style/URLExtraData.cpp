/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* thread-safe container of information for resolving url values */

#include "mozilla/URLExtraData.h"

#include "ReferrerInfo.h"
#include "mozilla/NullPrincipal.h"
#include "nsAboutProtocolUtils.h"

namespace mozilla {

StaticRefPtr<URLExtraData> URLExtraData::sDummy;
StaticRefPtr<URLExtraData> URLExtraData::sDummyChrome;

/* static */
void URLExtraData::Init() {
  RefPtr<nsIURI> baseURI = NullPrincipal::CreateURI();
  nsCOMPtr<nsIReferrerInfo> referrerInfo = new dom::ReferrerInfo(nullptr);
  sDummy = new URLExtraData(do_AddRef(baseURI), do_AddRef(referrerInfo),
                            NullPrincipal::CreateWithoutOriginAttributes());

  sDummyChrome =
      new URLExtraData(baseURI.forget(), referrerInfo.forget(),
                       NullPrincipal::CreateWithoutOriginAttributes());
  sDummyChrome->mChromeRulesEnabled = true;
}

bool URLExtraData::ChromeRulesEnabled(nsIURI* aURI) {
  if (!aURI) {
    return false;
  }
  return aURI->SchemeIs("chrome") || aURI->SchemeIs("resource") ||
         (aURI->SchemeIs("about") && !NS_IsContentAccessibleAboutURI(aURI));
}

/* static */
void URLExtraData::Shutdown() {
  sDummy = nullptr;
  sDummyChrome = nullptr;
}

URLExtraData::~URLExtraData() = default;

StaticRefPtr<URLExtraData>
    URLExtraData::sShared[size_t(BuiltInStyleSheet::Count)];

}  // namespace mozilla
