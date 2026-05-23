/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/dom/CSSMatrixComponent.h"

#include "mozilla/AlreadyAddRefed.h"
#include "mozilla/dom/BindingDeclarations.h"
#include "mozilla/dom/CSSMatrixComponentBinding.h"
#include "mozilla/dom/DOMMatrix.h"
#include "nsCOMPtr.h"
#include "nsString.h"

namespace mozilla::dom {

CSSMatrixComponent::CSSMatrixComponent(nsCOMPtr<nsISupports> aParent,
                                       bool aIs2D, RefPtr<DOMMatrix> aMatrix)
    : CSSTransformComponent(std::move(aParent), aIs2D,
                            TransformComponentType::MatrixComponent),
      mMatrix(std::move(aMatrix)) {}

NS_IMPL_ISUPPORTS_CYCLE_COLLECTION_INHERITED_0(CSSMatrixComponent,
                                               CSSTransformComponent)
NS_IMPL_CYCLE_COLLECTION_INHERITED(CSSMatrixComponent, CSSTransformComponent,
                                   mMatrix)

JSObject* CSSMatrixComponent::WrapObject(JSContext* aCx,
                                         JS::Handle<JSObject*> aGivenProto) {
  return CSSMatrixComponent_Binding::Wrap(aCx, this, aGivenProto);
}

// start of CSSMatrixComponent Web IDL implementation

// https://drafts.css-houdini.org/css-typed-om-1/#dom-cssmatrixcomponent-cssmatrixcomponent
//
// XXX This is not yet fully implemented!
//
//  static
already_AddRefed<CSSMatrixComponent> CSSMatrixComponent::Constructor(
    const GlobalObject& aGlobal, DOMMatrixReadOnly& aMatrix,
    const CSSMatrixComponentOptions& aOptions) {
  nsCOMPtr<nsISupports> global = aGlobal.GetAsSupports();

  // TODO: The spec step ordering could be adjusted to better match typical
  // implementations, which usually initialize all slots at once.

  // Step 1-4.
  bool is2D =
      aOptions.mIs2D.WasPassed() ? aOptions.mIs2D.Value() : aMatrix.Is2D();

  auto matrix = MakeRefPtr<DOMMatrix>(global, aMatrix);

  return MakeAndAddRef<CSSMatrixComponent>(std::move(global), is2D,
                                           std::move(matrix));
}

DOMMatrix* CSSMatrixComponent::Matrix() const { return mMatrix; }

void CSSMatrixComponent::SetMatrix(DOMMatrix& aArg) {}

// end of CSSMatrixComponent Web IDL implementation

void CSSMatrixComponent::ToCssTextWithProperty(const CSSPropertyId& aPropertyId,
                                               nsACString& aDest) const {
  nsAutoCString dest;
  IgnoredErrorResult rv;
  mMatrix->Stringify(mIs2D, dest, rv);
  if (rv.Failed()) {
    return;
  }
  aDest.Append(dest);
}

const CSSMatrixComponent& CSSTransformComponent::GetAsCSSMatrixComponent()
    const {
  MOZ_DIAGNOSTIC_ASSERT(mTransformComponentType ==
                        TransformComponentType::MatrixComponent);

  return *static_cast<const CSSMatrixComponent*>(this);
}

CSSMatrixComponent& CSSTransformComponent::GetAsCSSMatrixComponent() {
  MOZ_DIAGNOSTIC_ASSERT(mTransformComponentType ==
                        TransformComponentType::MatrixComponent);

  return *static_cast<CSSMatrixComponent*>(this);
}

}  // namespace mozilla::dom
