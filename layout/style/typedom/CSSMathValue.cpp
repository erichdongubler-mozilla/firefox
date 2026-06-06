/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/dom/CSSMathValue.h"

#include "mozilla/Assertions.h"
#include "mozilla/Maybe.h"
#include "mozilla/RefPtr.h"
#include "mozilla/ServoStyleConsts.h"
#include "mozilla/dom/CSSMathClamp.h"
#include "mozilla/dom/CSSMathInvert.h"
#include "mozilla/dom/CSSMathMax.h"
#include "mozilla/dom/CSSMathMin.h"
#include "mozilla/dom/CSSMathNegate.h"
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
    case MathValueType::MathClamp:
      return CSSMathOperator::Clamp;

    case MathValueType::MathMax:
      return CSSMathOperator::Max;

    case MathValueType::MathMin:
      return CSSMathOperator::Min;

    case MathValueType::MathInvert:
      return CSSMathOperator::Invert;

    case MathValueType::MathNegate:
      return CSSMathOperator::Negate;

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

bool CSSMathValue::IsCSSMathNegate() const {
  return mMathValueType == MathValueType::MathNegate;
}

bool CSSMathValue::IsCSSMathInvert() const {
  return mMathValueType == MathValueType::MathInvert;
}

bool CSSMathValue::IsCSSMathMin() const {
  return mMathValueType == MathValueType::MathMin;
}

bool CSSMathValue::IsCSSMathMax() const {
  return mMathValueType == MathValueType::MathMax;
}

bool CSSMathValue::IsCSSMathClamp() const {
  return mMathValueType == MathValueType::MathClamp;
}

void CSSMathValue::ToCssTextWithProperty(const CSSPropertyId& aPropertyId,
                                         bool aNested,
                                         nsACString& aDest) const {
  switch (GetMathValueType()) {
    case MathValueType::MathClamp: {
      const CSSMathClamp& mathClamp = GetAsCSSMathClamp();

      mathClamp.ToCssTextWithProperty(aPropertyId, aNested, aDest);
      break;
    }

    case MathValueType::MathMax: {
      const CSSMathMax& mathMax = GetAsCSSMathMax();

      mathMax.ToCssTextWithProperty(aPropertyId, aNested, aDest);
      break;
    }

    case MathValueType::MathMin: {
      const CSSMathMin& mathMin = GetAsCSSMathMin();

      mathMin.ToCssTextWithProperty(aPropertyId, aNested, aDest);
      break;
    }

    case MathValueType::MathInvert: {
      const CSSMathInvert& mathInvert = GetAsCSSMathInvert();

      mathInvert.ToCssTextWithProperty(aPropertyId, aNested, aDest);
      break;
    }

    case MathValueType::MathNegate: {
      const CSSMathNegate& mathNegate = GetAsCSSMathNegate();

      mathNegate.ToCssTextWithProperty(aPropertyId, aNested, aDest);
      break;
    }

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
    case MathValueType::MathClamp:
      return Nothing();

    case MathValueType::MathMax:
      return Nothing();

    case MathValueType::MathMin:
      return Nothing();

    case MathValueType::MathInvert:
      return Nothing();

    case MathValueType::MathNegate:
      return Nothing();

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
