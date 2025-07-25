/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_dom_HTMLDetailsElement_h
#define mozilla_dom_HTMLDetailsElement_h

#include "mozilla/AsyncEventDispatcher.h"
#include "mozilla/Attributes.h"
#include "nsGenericHTMLElement.h"

namespace mozilla::dom {

class HTMLSummaryElement;

// HTMLDetailsElement implements the <details> tag, which is used as a
// disclosure widget from which the user can obtain additional information or
// controls. Please see the spec for more information.
// https://html.spec.whatwg.org/multipage/forms.html#the-details-element
//
class HTMLDetailsElement final : public nsGenericHTMLElement {
 public:
  using NodeInfo = mozilla::dom::NodeInfo;
  using Element::Command;

  explicit HTMLDetailsElement(already_AddRefed<NodeInfo>&& aNodeInfo);

  NS_IMPL_FROMNODE_HTML_WITH_TAG(HTMLDetailsElement, details)

  HTMLSummaryElement* GetFirstSummary() const;

  nsresult Clone(NodeInfo* aNodeInfo, nsINode** aResult) const override;

  void AfterSetAttr(int32_t aNameSpaceID, nsAtom* aName,
                    const nsAttrValue* aValue, const nsAttrValue* aOldValue,
                    nsIPrincipal* aMaybeScriptedPrincipal,
                    bool aNotify) override;

  nsresult BindToTree(BindContext&, nsINode& aParent) override;

  bool IsInteractiveHTMLContent() const override { return true; }

  // HTMLDetailsElement WebIDL

  void SetName(const nsAString& aName, ErrorResult& aRv) {
    SetHTMLAttr(nsGkAtoms::name, aName, aRv);
  }

  void GetName(nsAString& aName) { GetHTMLAttr(nsGkAtoms::name, aName); }

  bool Open() const { return GetBoolAttr(nsGkAtoms::open); }

  void SetOpen(bool aOpen, ErrorResult& aError) {
    SetHTMLBoolAttr(nsGkAtoms::open, aOpen, aError);
  }

  void ToggleOpen() { SetOpen(!Open(), IgnoreErrors()); }

  void AsyncEventRunning(AsyncEventDispatcher* aEvent) override;

  bool IsValidCommandAction(Command aCommand) const override;
  MOZ_CAN_RUN_SCRIPT bool HandleCommandInternal(Element* aSource,
                                                Command aCommand,
                                                ErrorResult& aRv) override;

 protected:
  virtual ~HTMLDetailsElement();
  void SetupShadowTree();

  // https://html.spec.whatwg.org/#ensure-details-exclusivity-by-closing-the-given-element-if-needed
  void CloseElementIfNeeded();

  // https://html.spec.whatwg.org/#ensure-details-exclusivity-by-closing-other-elements-if-needed
  void CloseOtherElementsIfNeeded();

  JSObject* WrapNode(JSContext* aCx,
                     JS::Handle<JSObject*> aGivenProto) override;

  RefPtr<AsyncEventDispatcher> mToggleEventDispatcher;
};

}  // namespace mozilla::dom

#endif /* mozilla_dom_HTMLDetailsElement_h */
