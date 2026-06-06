/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/dom/CSSMathInvert.h"

#include "mozilla/AlreadyAddRefed.h"
#include "mozilla/Assertions.h"
#include "mozilla/dom/BindingDeclarations.h"
#include "mozilla/dom/CSSMathInvertBinding.h"
#include "mozilla/dom/CSSNumericValue.h"
#include "mozilla/dom/CSSNumericValueBinding.h"
#include "nsString.h"

namespace mozilla::dom {

CSSMathInvert::CSSMathInvert(nsCOMPtr<nsISupports> aParent,
                             RefPtr<CSSNumericValue> aValue)
    : CSSMathValue(std::move(aParent), MathValueType::MathInvert),
      mValue(std::move(aValue)) {}

NS_IMPL_ISUPPORTS_CYCLE_COLLECTION_INHERITED_0(CSSMathInvert, CSSMathValue)
NS_IMPL_CYCLE_COLLECTION_INHERITED(CSSMathInvert, CSSMathValue, mValue)

JSObject* CSSMathInvert::WrapObject(JSContext* aCx,
                                    JS::Handle<JSObject*> aGivenProto) {
  return CSSMathInvert_Binding::Wrap(aCx, this, aGivenProto);
}

// start of CSSMathInvert Web IDL implementation

// https://drafts.css-houdini.org/css-typed-om-1/#dom-cssmathinvert-cssmathinvert
//
// static
already_AddRefed<CSSMathInvert> CSSMathInvert::Constructor(
    const GlobalObject& aGlobal, const CSSNumberish& aArg) {
  nsCOMPtr<nsISupports> global = aGlobal.GetAsSupports();

  // Step 1.
  RefPtr<CSSNumericValue> value = CSSNumericValue::Create(global, aArg);

  // Step 2.
  return MakeAndAddRef<CSSMathInvert>(std::move(global), std::move(value));
}

CSSNumericValue* CSSMathInvert::Value() const { return mValue; }

// end of CSSMathInvert Web IDL implementation

void CSSMathInvert::ToCssTextWithProperty(const CSSPropertyId& aPropertyId,
                                          bool aNested, bool aParenLess,
                                          nsACString& aDest) const {
  if (!aParenLess) {
    aDest.Append(aNested ? "("_ns : "calc("_ns);
  }

  aDest.Append("1 / "_ns);

  mValue->ToCssTextWithProperty(aPropertyId, /* aNested */ true, aDest);

  if (!aParenLess) {
    aDest.Append(")"_ns);
  }
}

const CSSMathInvert& CSSMathValue::GetAsCSSMathInvert() const {
  MOZ_DIAGNOSTIC_ASSERT(mMathValueType == MathValueType::MathInvert);

  return *static_cast<const CSSMathInvert*>(this);
}

CSSMathInvert& CSSMathValue::GetAsCSSMathInvert() {
  MOZ_DIAGNOSTIC_ASSERT(mMathValueType == MathValueType::MathInvert);

  return *static_cast<CSSMathInvert*>(this);
}

}  // namespace mozilla::dom
