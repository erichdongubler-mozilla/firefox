/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "ChildIterator.h"

#include "mozilla/dom/Document.h"
#include "mozilla/dom/HTMLSlotElement.h"
#include "mozilla/dom/ShadowRoot.h"
#include "nsContentUtils.h"
#include "nsIAnonymousContentCreator.h"
#include "nsIContentInlines.h"
#include "nsIFrame.h"
#include "nsLayoutUtils.h"

namespace mozilla::dom {

#define NS_INSTANTIATE_CHILD_ITERATOR_METHOD(aResult, aMethod, ...)            \
  template aResult ChildIteratorBase<ChildIterFor::DOM>::aMethod(__VA_ARGS__); \
  template aResult ChildIteratorBase<ChildIterFor::FlatForSelection>::aMethod( \
      __VA_ARGS__);                                                            \
  template aResult ChildIteratorBase<ChildIterFor::Flat>::aMethod(__VA_ARGS__);

#define NS_INSTANTIATE_CHILD_ITERATOR_CONST_METHOD(aResult, aMethod, ...)      \
  template aResult ChildIteratorBase<ChildIterFor::DOM>::aMethod(__VA_ARGS__)  \
      const;                                                                   \
  template aResult ChildIteratorBase<ChildIterFor::FlatForSelection>::aMethod( \
      __VA_ARGS__) const;                                                      \
  template aResult ChildIteratorBase<ChildIterFor::Flat>::aMethod(__VA_ARGS__) \
      const;

NS_INSTANTIATE_CHILD_ITERATOR_METHOD(, ChildIteratorBase, const nsINode*, bool);

template <ChildIterFor aFor>
ChildIteratorBase<aFor>::ChildIteratorBase(const nsINode* aParentNode,
                                           bool aStartAtBeginning)
    : mParentNode(aParentNode),
      mOriginalParentNode(aParentNode),
      mIsFirst(aStartAtBeginning) {
  if constexpr (aFor == ChildIterFor::DOM) {
    return;
  }

  if (!mParentNode->IsElement()) {
    return;
  }

  if (const ShadowRoot* const shadowRoot =
          IgnoresNonContentShadow()
              ? mParentNode->AsElement()->GetShadowRootForSelection()
              : mParentNode->AsElement()->GetShadowRoot()) {
    mParentNode = shadowRoot;
    mShadowDOMInvolved = true;
    return;
  }

  if (const auto* const slot =
          IgnoresNonContentShadow()
              ? mParentNode->GetAsHTMLSlotElementIfFilledForSelection()
              : mParentNode->GetAsHTMLSlotElementIfFilled()) {
    MOZ_ASSERT(!slot->AssignedNodes().IsEmpty());
    mParentNodeAsSlot = slot;
    if (!aStartAtBeginning) {
      mIndexInInserted = slot->AssignedNodes().Length();
    }
    mShadowDOMInvolved = true;
  }
}

NS_INSTANTIATE_CHILD_ITERATOR_METHOD(uint32_t, GetLength, const nsINode*);

// static
template <ChildIterFor aFor>
uint32_t ChildIteratorBase<aFor>::GetLength(const nsINode* aParent) {
  if (!aParent->IsContainerNode()) {
    return aParent->Length();
  }
  MOZ_ASSERT(!aParent->IsCharacterData());
  if constexpr (aFor != ChildIterFor::DOM) {
    if (const auto* slot =
            IgnoresNonContentShadow()
                ? aParent->GetAsHTMLSlotElementIfFilledForSelection()
                : aParent->GetAsHTMLSlotElementIfFilled()) {
      if (uint32_t len = slot->AssignedNodes().Length()) {
        return len;
      }
    }
    if (const ShadowRoot* const shadowRoot =
            IgnoresNonContentShadow() ? aParent->GetShadowRootForSelection()
                                      : aParent->GetShadowRoot()) {
      return shadowRoot->GetChildCount();
    }
  }
  return aParent->GetChildCount();
}

NS_INSTANTIATE_CHILD_ITERATOR_METHOD(Maybe<uint32_t>, GetIndexOf,
                                     const nsINode*, const nsINode*);

// static
template <ChildIterFor aFor>
Maybe<uint32_t> ChildIteratorBase<aFor>::GetIndexOf(
    const nsINode* aParent, const nsINode* aPossibleChild) {
  if constexpr (aFor != ChildIterFor::DOM) {
    if (const auto* slot =
            IgnoresNonContentShadow()
                ? aParent->GetAsHTMLSlotElementIfFilledForSelection()
                : aParent->GetAsHTMLSlotElementIfFilled()) {
      const Span assigned = slot->AssignedNodes();
      MOZ_ASSERT(!assigned.IsEmpty());
      const auto index = assigned.IndexOf(aPossibleChild);
      if (index == decltype(assigned)::npos) {
        return Nothing();
      }
      return Some(index);
    }
    if (const ShadowRoot* const shadowRoot =
            IgnoresNonContentShadow() ? aParent->GetShadowRootForSelection()
                                      : aParent->GetShadowRoot()) {
      return shadowRoot->ComputeIndexOf(aPossibleChild);
    }
  }
  return aParent->ComputeIndexOf(aPossibleChild);
}

NS_INSTANTIATE_CHILD_ITERATOR_METHOD(nsIContent*, GetChildAt, const nsINode*,
                                     uint32_t);

// static
template <ChildIterFor aFor>
nsIContent* ChildIteratorBase<aFor>::GetChildAt(const nsINode* aParent,
                                                uint32_t aIndex) {
  if (!aParent->IsContainerNode()) {
    return nullptr;
  }
  MOZ_ASSERT(!aParent->IsCharacterData());
  if constexpr (aFor != ChildIterFor::DOM) {
    if (const auto* slot =
            IgnoresNonContentShadow()
                ? aParent->GetAsHTMLSlotElementIfFilledForSelection()
                : aParent->GetAsHTMLSlotElementIfFilled()) {
      const Span assigned = slot->AssignedNodes();
      MOZ_ASSERT(!assigned.IsEmpty());
      if (assigned.Length() <= aIndex) {
        return nullptr;
      }
      nsIContent* const child = nsIContent::FromNode(assigned[aIndex]);
      MOZ_ASSERT(child);
      return child;
    }
    if (const ShadowRoot* const shadowRoot =
            IgnoresNonContentShadow() ? aParent->GetShadowRootForSelection()
                                      : aParent->GetShadowRoot()) {
      return shadowRoot->GetChildAt_Deprecated(aIndex);
    }
  }
  return aParent->GetChildAt_Deprecated(aIndex);
}

NS_INSTANTIATE_CHILD_ITERATOR_METHOD(nsIContent*, GetNextChild);

template <ChildIterFor aFor>
nsIContent* ChildIteratorBase<aFor>::GetNextChild() {
  // If we're already in the inserted-children array, look there first
  if (mParentNodeAsSlot) {
    const Span assignedNodes = mParentNodeAsSlot->AssignedNodes();
    if (mIsFirst) {
      mIsFirst = false;
      MOZ_ASSERT(mIndexInInserted == 0);
      mChild = assignedNodes[0]->AsContent();
      return mChild;
    }
    MOZ_ASSERT(mIndexInInserted <= assignedNodes.Length());
    if (mIndexInInserted + 1 >= assignedNodes.Length()) {
      mIndexInInserted = assignedNodes.Length();
      return nullptr;
    }
    mChild = assignedNodes[++mIndexInInserted]->AsContent();
    return mChild;
  }

  if (mIsFirst) {  // at the beginning of the child list
    mChild = mParentNode->GetFirstChild();
    mIsFirst = false;
  } else if (mChild) {  // in the middle of the child list
    mChild = mChild->GetNextSibling();
  }

  return mChild;
}

NS_INSTANTIATE_CHILD_ITERATOR_METHOD(bool, Seek, const nsIContent*);

template <ChildIterFor aFor>
bool ChildIteratorBase<aFor>::Seek(const nsIContent* aChildToFind) {
  if (!mParentNodeAsSlot && aChildToFind->GetParentNode() == mParentNode &&
      !aChildToFind->IsRootOfNativeAnonymousSubtree()) {
    // Fast path: just point ourselves to aChildToFind, which is a
    // normal DOM child of ours.
    mChild = const_cast<nsIContent*>(aChildToFind);
    mIndexInInserted = 0;
    mIsFirst = false;
    return true;
  }

  // Can we add more fast paths here based on whether the parent of aChildToFind
  // is a This version can take shortcuts that the two-argument version
  // can't, so can be faster (and in fact shadow insertion point or content
  // insertion point?

  // It would be nice to assert that we find aChildToFind, but bz thinks that
  // we might not find aChildToFind when called from ContentInserted
  // if first-letter frames are about.
  while (nsIContent* child = GetNextChild()) {
    if (child == aChildToFind) {
      return true;
    }
  }

  return false;
}

NS_INSTANTIATE_CHILD_ITERATOR_METHOD(nsIContent*, GetPreviousChild);

template <ChildIterFor aFor>
nsIContent* ChildIteratorBase<aFor>::GetPreviousChild() {
  if (mIsFirst) {  // at the beginning of the child list
    return nullptr;
  }
  if (mParentNodeAsSlot) {
    const Span assignedNodes = mParentNodeAsSlot->AssignedNodes();
    MOZ_ASSERT(mIndexInInserted <= assignedNodes.Length());
    if (mIndexInInserted == 0) {
      mIsFirst = true;
      return nullptr;
    }
    mChild = assignedNodes[--mIndexInInserted]->AsContent();
    return mChild;
  }
  if (mChild) {  // in the middle of the child list
    mChild = mChild->GetPreviousSibling();
  } else {  // at the end of the child list
    mChild = mParentNode->GetLastChild();
  }
  if (!mChild) {
    mIsFirst = true;
  }

  return mChild;
}

NS_INSTANTIATE_CHILD_ITERATOR_METHOD(nsINode*, GetParentNodeOf,
                                     const nsIContent&);

// static
template <ChildIterFor aFor>
nsINode* ChildIteratorBase<aFor>::GetParentNodeOf(const nsIContent& aChild) {
  if constexpr (aFor == ChildIterFor::DOM) {
    return aChild.GetParentNode();
  }
  // FYI: Don't return ShadowRoot as parent of aChild. If the parent node of
  // aChild is a ShadowRoot, return the host instead.  Otherwise, if this is
  // called with the result of a previous call of this and the result is a
  // ShadowRoot, this will return nullptr and the caller cannot climb up the
  // tree. For example, callers may want to do:
  //
  //  while (child != limiter) {
  //    auto* parent = ChildIteratorBase<aFor>::GetParentNodeOf(child);
  //    MOZ_ASSERT(parent); // Fails if child is a ShadowRoot
  //    ChildIteratorBase<aFor> iter(parent);
  //    MOZ_ALWAYS_TRUE(iter.Seek(child));
  //    child = parent;
  //  }
  else if constexpr (aFor == ChildIterFor::FlatForSelection) {
    HTMLSlotElement* const assignedSlot = aChild.GetAssignedSlotForSelection();
    nsINode* const parentNode = aChild.GetParentNode();
    // If the parent node is a shadow host and aChild is a child of the host and
    // not assigned to any <slot>, ChildIteratorBase<ChildIterFor::DOM> should
    // be used instead because ChildIteratorBase<ChildIterFor::FlatForSelection>
    // will handle the children of the ShadowRoot so that Seek() will fail if
    // searching aChild with it.
    // FYI: GetFlattenedTreeParentNodeForSelection() may return ShadowRoot.
    // Therefore, we need to handle it here. We should fix it in bug 2014622
    // later.
    if (MOZ_UNLIKELY(
            !parentNode ||
            (!assignedSlot && parentNode->GetShadowRootForSelection()))) {
      return nullptr;
    }
    return aChild.GetFlattenedTreeParentNodeForSelection();
  } else if constexpr (aFor == ChildIterFor::Flat) {
    HTMLSlotElement* const assignedSlot = aChild.GetAssignedSlot();
    nsINode* const parentNode = aChild.GetParentNode();
    // If the parent node is a shadow host and aChild is a child of the host and
    // not assigned to any <slot>, ChildIteratorBase<ChildIterFor::DOM> should
    // be used instead because ChildIteratorBase<ChildIterFor::Flat> will handle
    // the children of the ShadowRoot so that Seek() will fail if searching
    // aChild with it.
    // FYI: GetFlattenedTreeParentNode() won't return ShadowRoot. However, this
    // will be merged to the above block with using new template API. Therefore,
    // this block does the same thing for now to make it clearer that the patch
    // does not change the behavior.
    if (MOZ_UNLIKELY(!parentNode ||
                     (!assignedSlot && parentNode->GetShadowRoot()))) {
      return nullptr;
    }
    return aChild.GetFlattenedTreeParentNode();
  } else {
    MOZ_MAKE_COMPILER_ASSUME_IS_UNREACHABLE(
        "Handle the new ChildIterFor value!");
  }
}

#undef NS_INSTANTIATE_CHILD_ITERATOR_METHOD
#undef NS_INSTANTIATE_CHILD_ITERATOR_CONST_METHOD

nsIContent* AllChildrenIterator::Get() const {
  switch (mPhase) {
    case Phase::AtBackdropKid: {
      Element* backdrop = nsLayoutUtils::GetBackdropPseudo(Parent());
      MOZ_ASSERT(backdrop, "No content marker frame at AtBackdropKid phase");
      return backdrop;
    }

    case Phase::AtMarkerKid: {
      Element* marker = nsLayoutUtils::GetMarkerPseudo(Parent());
      MOZ_ASSERT(marker, "No content marker frame at AtMarkerKid phase");
      return marker;
    }

    case Phase::AtBeforeKid: {
      Element* before = nsLayoutUtils::GetBeforePseudo(Parent());
      MOZ_ASSERT(before, "No content before frame at AtBeforeKid phase");
      return before;
    }

    case Phase::AtFlatTreeKids:
      return FlattenedChildIterator::Get();

    case Phase::AtAnonKids:
      return mAnonKids[mAnonKidsIdx];

    case Phase::AtAfterKid: {
      Element* after = nsLayoutUtils::GetAfterPseudo(Parent());
      MOZ_ASSERT(after, "No content after frame at AtAfterKid phase");
      return after;
    }

    default:
      return nullptr;
  }
}

bool AllChildrenIterator::Seek(const nsIContent* aChildToFind) {
  while (mPhase != Phase::AtEnd) {
    if (mPhase == Phase::AtFlatTreeKids) {
      if (FlattenedChildIterator::Seek(aChildToFind)) {
        return true;
      }
      mPhase = Phase::AtAnonKids;
    }
    if (GetNextChild() == aChildToFind) {
      return true;
    }
  }
  return false;
}

void AllChildrenIterator::AppendNativeAnonymousChildren() {
  nsContentUtils::AppendNativeAnonymousChildren(Parent(), mAnonKids, mFlags);
}

nsIContent* AllChildrenIterator::GetNextChild() {
  switch (mPhase) {
    case Phase::AtBegin:
      if (Element* backdropPseudo =
              nsLayoutUtils::GetBackdropPseudo(Parent())) {
        mPhase = Phase::AtBackdropKid;
        return backdropPseudo;
      }
      [[fallthrough]];
    case Phase::AtBackdropKid:
      if (Element* markerContent = nsLayoutUtils::GetMarkerPseudo(Parent())) {
        mPhase = Phase::AtMarkerKid;
        return markerContent;
      }
      [[fallthrough]];
    case Phase::AtMarkerKid:
      if (Element* beforeContent = nsLayoutUtils::GetBeforePseudo(Parent())) {
        mPhase = Phase::AtBeforeKid;
        return beforeContent;
      }
      [[fallthrough]];
    case Phase::AtBeforeKid:
      [[fallthrough]];
    case Phase::AtFlatTreeKids:
      if (nsIContent* kid = FlattenedChildIterator::GetNextChild()) {
        mPhase = Phase::AtFlatTreeKids;
        return kid;
      }
      [[fallthrough]];
    case Phase::AtAnonKids:
      if (mAnonKids.IsEmpty()) {
        MOZ_ASSERT(mAnonKidsIdx == UINT32_MAX);
        AppendNativeAnonymousChildren();
        mAnonKidsIdx = 0;
      } else if (mAnonKidsIdx == UINT32_MAX) {
        mAnonKidsIdx = 0;
      } else {
        mAnonKidsIdx++;
      }
      if (mAnonKidsIdx < mAnonKids.Length()) {
        mPhase = Phase::AtAnonKids;
        return mAnonKids[mAnonKidsIdx];
      }
      if (Element* afterContent = nsLayoutUtils::GetAfterPseudo(Parent())) {
        mPhase = Phase::AtAfterKid;
        return afterContent;
      }
      [[fallthrough]];
    case Phase::AtAfterKid:
    case Phase::AtEnd:
      break;
  }

  mPhase = Phase::AtEnd;
  return nullptr;
}

nsIContent* AllChildrenIterator::GetPreviousChild() {
  switch (mPhase) {
    case Phase::AtEnd:
      if (Element* afterContent = nsLayoutUtils::GetAfterPseudo(Parent())) {
        mPhase = Phase::AtAfterKid;
        return afterContent;
      }
      [[fallthrough]];
    case Phase::AtAfterKid:
      MOZ_ASSERT(mAnonKidsIdx == mAnonKids.Length());
      [[fallthrough]];
    case Phase::AtAnonKids:
      if (mAnonKids.IsEmpty()) {
        AppendNativeAnonymousChildren();
        mAnonKidsIdx = mAnonKids.Length();
      }
      // If 0 then it turns into UINT32_MAX, which indicates the iterator is
      // before the anonymous children.
      --mAnonKidsIdx;
      if (mAnonKidsIdx < mAnonKids.Length()) {
        mPhase = Phase::AtAnonKids;
        return mAnonKids[mAnonKidsIdx];
      }
      [[fallthrough]];
    case Phase::AtFlatTreeKids:
      if (nsIContent* kid = FlattenedChildIterator::GetPreviousChild()) {
        mPhase = Phase::AtFlatTreeKids;
        return kid;
      }
      if (Element* beforeContent = nsLayoutUtils::GetBeforePseudo(Parent())) {
        mPhase = Phase::AtBeforeKid;
        return beforeContent;
      }
      [[fallthrough]];
    case Phase::AtBeforeKid:
      if (Element* markerContent = nsLayoutUtils::GetMarkerPseudo(Parent())) {
        mPhase = Phase::AtMarkerKid;
        return markerContent;
      }
      [[fallthrough]];
    case Phase::AtMarkerKid:
      if (Element* backdrop = nsLayoutUtils::GetBackdropPseudo(Parent())) {
        mPhase = Phase::AtBackdropKid;
        return backdrop;
      }
      [[fallthrough]];
    case Phase::AtBackdropKid:
    case Phase::AtBegin:
      break;
  }

  mPhase = Phase::AtBegin;
  return nullptr;
}

// static
nsINode* StyleChildrenIterator::GetParentNodeOf(const nsIContent& aChild) {
  return aChild.GetFlattenedTreeParentNodeForStyle();
}

}  // namespace mozilla::dom
