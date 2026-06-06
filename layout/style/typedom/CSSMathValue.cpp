/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/dom/CSSMathValue.h"

#include "mozilla/Assertions.h"
#include "mozilla/Maybe.h"
#include "mozilla/RefPtr.h"
#include "mozilla/ServoStyleConsts.h"
#include "mozilla/dom/CSSMathSum.h"
#include "mozilla/dom/CSSMathValueBinding.h"

namespace mozilla::dom {

CSSMathValue::CSSMathValue(nsCOMPtr<nsISupports> aParent)
    : CSSNumericValue(std::move(aParent), NumericValueType::MathValue),
      mMathValueType(MathValueType::Uninitialized) {}

CSSMathValue::CSSMathValue(nsCOMPtr<nsISupports> aParent,
                           MathValueType aMathValueType)
    : CSSNumericValue(std::move(aParent), NumericValueType::MathValue),
      mMathValueType(aMathValueType) {}

// static
RefPtr<CSSMathValue> CSSMathValue::Create(nsCOMPtr<nsISupports> aParent,
                                          const StyleMathValue& aMathValue) {
  RefPtr<CSSMathValue> mathValue;

  switch (aMathValue.tag) {
    case StyleMathValue::Tag::Sum: {
      const auto& mathSum = aMathValue.AsSum();

      mathValue = CSSMathSum::Create(std::move(aParent), mathSum);
      break;
    }
  }

  return mathValue;
}

// start of CSSMathtValue Web IDL implementation

CSSMathOperator CSSMathValue::Operator() const {
  // TODO: Just return mMathOperator once mMathValueType is replaced with it.

  switch (GetMathValueType()) {
    case MathValueType::MathSum:
      return CSSMathOperator::Sum;

    case MathValueType::Uninitialized:
      // This is only a temporary variant, return Sum for now.
      return CSSMathOperator::Sum;
  }
  MOZ_MAKE_COMPILER_ASSUME_IS_UNREACHABLE("Bad math value type!");
}

// end of CSSMathtValue Web IDL implementation

bool CSSMathValue::IsCSSMathSum() const {
  return mMathValueType == MathValueType::MathSum;
}

void CSSMathValue::ToCssTextWithProperty(const CSSPropertyId& aPropertyId,
                                         bool aNested,
                                         nsACString& aDest) const {
  switch (GetMathValueType()) {
    case MathValueType::MathSum: {
      const CSSMathSum& mathSum = GetAsCSSMathSum();

      mathSum.ToCssTextWithProperty(aPropertyId, aNested, aDest);
      break;
    }

    case MathValueType::Uninitialized:
      break;
  }
}

Maybe<StyleMathValue> CSSMathValue::ToStyleMathValue() const {
  switch (GetMathValueType()) {
    case MathValueType::MathSum: {
      const CSSMathSum& mathSum = GetAsCSSMathSum();

      return Some(StyleMathValue::Sum(mathSum.ToStyleMathSum()));
    }

    case MathValueType::Uninitialized:
      return Nothing();
  }
  MOZ_MAKE_COMPILER_ASSUME_IS_UNREACHABLE("Bad math value type!");
}

const CSSMathValue& CSSNumericValue::GetAsCSSMathValue() const {
  MOZ_DIAGNOSTIC_ASSERT(mNumericValueType == NumericValueType::MathValue);

  return *static_cast<const CSSMathValue*>(this);
}

CSSMathValue& CSSNumericValue::GetAsCSSMathValue() {
  MOZ_DIAGNOSTIC_ASSERT(mNumericValueType == NumericValueType::MathValue);

  return *static_cast<CSSMathValue*>(this);
}

}  // namespace mozilla::dom
