/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsGfxButtonControlFrame.h"

#include "mozilla/PresShell.h"
#include "mozilla/dom/HTMLInputElement.h"
#include "nsContentUtils.h"
#include "nsGkAtoms.h"
#include "nsIFormControl.h"
#include "nsTextNode.h"

using namespace mozilla;

nsGfxButtonControlFrame::nsGfxButtonControlFrame(ComputedStyle* aStyle,
                                                 nsPresContext* aPresContext)
    : nsHTMLButtonControlFrame(aStyle, aPresContext, kClassID) {}

nsContainerFrame* NS_NewGfxButtonControlFrame(PresShell* aPresShell,
                                              ComputedStyle* aStyle) {
  return new (aPresShell)
      nsGfxButtonControlFrame(aStyle, aPresShell->GetPresContext());
}

NS_IMPL_FRAMEARENA_HELPERS(nsGfxButtonControlFrame)

void nsGfxButtonControlFrame::Destroy(DestroyContext& aContext) {
  aContext.AddAnonymousContent(mTextContent.forget());
  nsHTMLButtonControlFrame::Destroy(aContext);
}

#ifdef DEBUG_FRAME_DUMP
nsresult nsGfxButtonControlFrame::GetFrameName(nsAString& aResult) const {
  return MakeFrameName(u"ButtonControl"_ns, aResult);
}
#endif

// Create the text content used as label for the button.
// The frame will be generated by the frame constructor.
nsresult nsGfxButtonControlFrame::CreateAnonymousContent(
    nsTArray<ContentInfo>& aElements) {
  nsAutoString label;
  nsresult rv = GetLabel(label);
  NS_ENSURE_SUCCESS(rv, rv);

  // Add a child text content node for the label
  mTextContent = new (mContent->NodeInfo()->NodeInfoManager())
      nsTextNode(mContent->NodeInfo()->NodeInfoManager());

  // set the value of the text node and add it to the child list
  mTextContent->SetText(label, false);
  aElements.AppendElement(mTextContent);

  return NS_OK;
}

void nsGfxButtonControlFrame::AppendAnonymousContentTo(
    nsTArray<nsIContent*>& aElements, uint32_t aFilter) {
  if (mTextContent) {
    aElements.AppendElement(mTextContent);
  }
}

NS_QUERYFRAME_HEAD(nsGfxButtonControlFrame)
  NS_QUERYFRAME_ENTRY(nsIAnonymousContentCreator)
NS_QUERYFRAME_TAIL_INHERITING(nsHTMLButtonControlFrame)

// Initially we hardcoded the default strings here.
// Next, we used html.css to store the default label for various types
// of buttons. (nsGfxButtonControlFrame::DoNavQuirksReflow rev 1.20)
// However, since html.css is not internationalized, we now grab the default
// label from a string bundle as is done for all other UI strings.
// See bug 16999 for further details.
nsresult nsGfxButtonControlFrame::GetDefaultLabel(nsAString& aString) const {
  const auto* form = nsIFormControl::FromNodeOrNull(mContent);
  NS_ENSURE_TRUE(form, NS_ERROR_UNEXPECTED);

  auto type = form->ControlType();
  const char* prop;
  if (type == FormControlType::InputReset) {
    prop = "Reset";
  } else if (type == FormControlType::InputSubmit) {
    prop = "Submit";
  } else {
    aString.Truncate();
    return NS_OK;
  }

  return nsContentUtils::GetMaybeLocalizedString(
      nsContentUtils::eFORMS_PROPERTIES, prop, mContent->OwnerDoc(), aString);
}

nsresult nsGfxButtonControlFrame::GetLabel(nsString& aLabel) {
  // Get the text from the "value" property on our content if there is
  // one; otherwise set it to a default value (localized).
  auto* elt = dom::HTMLInputElement::FromNode(mContent);
  if (elt && elt->HasAttr(nsGkAtoms::value)) {
    elt->GetValue(aLabel, dom::CallerType::System);
  } else {
    // Generate localized label.
    // We can't make any assumption as to what the default would be
    // because the value is localized for non-english platforms, thus
    // it might not be the string "Reset", "Submit Query", or "Browse..."
    nsresult rv;
    rv = GetDefaultLabel(aLabel);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  // Compress whitespace out of label if needed.
  if (!StyleText()->WhiteSpaceIsSignificant()) {
    aLabel.CompressWhitespace();
  } else if (aLabel.Length() > 2 && aLabel.First() == ' ' &&
             aLabel.CharAt(aLabel.Length() - 1) == ' ') {
    // This is a bit of a hack.  The reason this is here is as follows: we now
    // have default padding on our buttons to make them non-ugly.
    // Unfortunately, IE-windows does not have such padding, so people will
    // stick values like " ok " (with the spaces) in the buttons in an attempt
    // to make them look decent.  Unfortunately, if they do this the button
    // looks way too big in Mozilla.  Worse yet, if they do this _and_ set a
    // fixed width for the button we run into trouble because our focus-rect
    // border/padding and outer border take up 10px of the horizontal button
    // space or so; the result is that the text is misaligned, even with the
    // recentering we do in nsHTMLButtonControlFrame::Reflow.  So to solve
    // this, even if the whitespace is significant, single leading and trailing
    // _spaces_ (and not other whitespace) are removed.  The proper solution,
    // of course, is to not have the focus rect painting taking up 6px of
    // horizontal space. We should do that instead (changing the renderer) and
    // remove this.
    aLabel.Cut(0, 1);
    aLabel.Truncate(aLabel.Length() - 1);
  }

  return NS_OK;
}

nsresult nsGfxButtonControlFrame::AttributeChanged(int32_t aNameSpaceID,
                                                   nsAtom* aAttribute,
                                                   int32_t aModType) {
  nsresult rv = NS_OK;

  // If the value attribute is set, update the text of the label
  if (nsGkAtoms::value == aAttribute) {
    if (mTextContent && mContent) {
      nsAutoString label;
      rv = GetLabel(label);
      NS_ENSURE_SUCCESS(rv, rv);

      mTextContent->SetText(label, true);
    } else {
      rv = NS_ERROR_UNEXPECTED;
    }

    // defer to HTMLButtonControlFrame
  } else {
    rv = nsHTMLButtonControlFrame::AttributeChanged(aNameSpaceID, aAttribute,
                                                    aModType);
  }
  return rv;
}

nsresult nsGfxButtonControlFrame::HandleEvent(nsPresContext* aPresContext,
                                              WidgetGUIEvent* aEvent,
                                              nsEventStatus* aEventStatus) {
  // Override the HandleEvent to prevent the nsIFrame::HandleEvent
  // from being called. The nsIFrame::HandleEvent causes the button label
  // to be selected (Drawn with an XOR rectangle over the label)

  if (IsContentDisabled()) {
    return nsIFrame::HandleEvent(aPresContext, aEvent, aEventStatus);
  }
  return NS_OK;
}
