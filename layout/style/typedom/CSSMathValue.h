/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef LAYOUT_STYLE_TYPEDOM_CSSMATHVALUE_H_
#define LAYOUT_STYLE_TYPEDOM_CSSMATHVALUE_H_

#include "mozilla/dom/CSSMathClampBindingFwd.h"
#include "mozilla/dom/CSSMathMaxBindingFwd.h"
#include "mozilla/dom/CSSMathMinBindingFwd.h"
#include "mozilla/dom/CSSMathSumBindingFwd.h"
#include "mozilla/dom/CSSNumericValue.h"
#include "nsStringFwd.h"

template <class T>
class nsCOMPtr;
class nsISupports;

namespace mozilla {

struct CSSPropertyId;
template <class T>
class Maybe;
struct StyleMathValue;

namespace dom {

enum class CSSMathOperator : uint8_t;

class CSSMathValue : public CSSNumericValue {
 public:
  enum class MathValueType {
    Uninitialized,  // TODO: Remove once the implementation is complete.
    MathSum,
    MathMin,
    MathMax,
    MathClamp,
  };

  explicit CSSMathValue(nsCOMPtr<nsISupports> aParent);

  CSSMathValue(nsCOMPtr<nsISupports> aParent, MathValueType aMathValueType);

  static RefPtr<CSSMathValue> Create(nsCOMPtr<nsISupports> aParent,
                                     const StyleMathValue& aMathValue);

  // start of CSSMathValue Web IDL declarations

  CSSMathOperator Operator() const;

  // end of CSSMathValue Web IDL declarations

  MathValueType GetMathValueType() const { return mMathValueType; }

  bool IsCSSMathSum() const;

  // Defined in CSSMathSum.cpp
  const CSSMathSum& GetAsCSSMathSum() const;

  // Defined in CSSMathSum.cpp
  CSSMathSum& GetAsCSSMathSum();

  bool IsCSSMathMin() const;

  // Defined in CSSMathMin.cpp
  const CSSMathMin& GetAsCSSMathMin() const;

  // Defined in CSSMathMin.cpp
  CSSMathMin& GetAsCSSMathMin();

  bool IsCSSMathMax() const;

  // Defined in CSSMathMax.cpp
  const CSSMathMax& GetAsCSSMathMax() const;

  // Defined in CSSMathMax.cpp
  CSSMathMax& GetAsCSSMathMax();

  bool IsCSSMathClamp() const;

  // Defined in CSSMathClamp.cpp
  const CSSMathClamp& GetAsCSSMathClamp() const;

  // Defined in CSSMathClamp.cpp
  CSSMathClamp& GetAsCSSMathClamp();

  void ToCssTextWithProperty(const CSSPropertyId& aPropertyId, bool aNested,
                             nsACString& aDest) const;

  // TODO: This can be changed to return StyleMathValue directly once the
  // Unitialized type is removed.
  Maybe<StyleMathValue> ToStyleMathValue() const;

 protected:
  virtual ~CSSMathValue() = default;

  // TODO: It might be possible to replace this with CSSMathOperator
  const MathValueType mMathValueType;
};

}  // namespace dom
}  // namespace mozilla

#endif  // LAYOUT_STYLE_TYPEDOM_CSSMATHVALUE_H_
