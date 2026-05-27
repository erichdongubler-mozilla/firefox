/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/dom/CSSImageValue.h"

#include "mozilla/dom/CSSImageValueBinding.h"

namespace mozilla::dom {

CSSImageValue::CSSImageValue(nsCOMPtr<nsISupports> aParent)
    : CSSStyleValue(std::move(aParent), StyleValueType::ImageValue) {}

JSObject* CSSImageValue::WrapObject(JSContext* aCx,
                                    JS::Handle<JSObject*> aGivenProto) {
  return CSSImageValue_Binding::Wrap(aCx, this, aGivenProto);
}

// start of CSSImageValue Web IDL implementation

// end of CSSImageValue Web IDL implementation

void CSSImageValue::ToCssTextWithProperty(const CSSPropertyId& aPropertyId,
                                          nsACString& aDest) const {}

const CSSImageValue& CSSStyleValue::GetAsCSSImageValue() const {
  MOZ_DIAGNOSTIC_ASSERT(mStyleValueType == StyleValueType::ImageValue);

  return *static_cast<const CSSImageValue*>(this);
}

CSSImageValue& CSSStyleValue::GetAsCSSImageValue() {
  MOZ_DIAGNOSTIC_ASSERT(mStyleValueType == StyleValueType::ImageValue);

  return *static_cast<CSSImageValue*>(this);
}

}  // namespace mozilla::dom
