/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DOM_SMIL_SMILINTEGERTYPE_H_
#define DOM_SMIL_SMILINTEGERTYPE_H_

#include "mozilla/Attributes.h"
#include "mozilla/SMILType.h"

namespace mozilla {

class SMILIntegerType : public SMILType {
 public:
  void InitValue(SMILValue& aValue) const override;
  void DestroyValue(SMILValue& aValue) const override;
  nsresult Assign(SMILValue& aDest, const SMILValue& aSrc) const override;
  bool IsEqual(const SMILValue& aLeft, const SMILValue& aRight) const override;
  nsresult Add(SMILValue& aDest, const SMILValue& aValueToAdd,
               uint32_t aCount) const override;
  nsresult ComputeDistance(const SMILValue& aFrom, const SMILValue& aTo,
                           double& aDistance) const override;
  nsresult Interpolate(const SMILValue& aStartVal, const SMILValue& aEndVal,
                       double aUnitDistance, SMILValue& aResult) const override;

  static SMILIntegerType* Singleton() {
    static SMILIntegerType sSingleton;
    return &sSingleton;
  }

 private:
  constexpr SMILIntegerType() = default;
};

}  // namespace mozilla

#endif  // DOM_SMIL_SMILINTEGERTYPE_H_
