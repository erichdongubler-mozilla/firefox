/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#include "mozilla/dom/SpeculationRules.h"

#include "nsIURI.h"

namespace mozilla::dom {

/* static */ void SpeculationRules::operator delete(void* aSpeculationRules) {
  speculation_rules_destroy(
      reinterpret_cast<SpeculationRules*>(aSpeculationRules));
}

// https://html.spec.whatwg.org/#parse-a-speculation-rule-set-string
/* static */
Result<UniquePtr<SpeculationRules>, SpeculationRuleParseError>
SpeculationRules::Parse(const nsACString& aSource, nsIURI* aDocumentBaseUri,
                        nsIURI* aBaseUri) {
  MOZ_ASSERT(aDocumentBaseUri && aBaseUri);
  nsAutoCString documentBaseUri;
  aDocumentBaseUri->GetSpec(documentBaseUri);
  nsAutoCString baseUri;
  aBaseUri->GetSpec(baseUri);

  SpeculationRuleParseError parseError = SpeculationRuleParseError::None;
  SpeculationRules* parsedRules = parse_speculation_rules(
      &aSource, &documentBaseUri, &baseUri, &parseError);
  if (!parsedRules) {
    // Steps 2 and 5.1
    return Err(parseError);
  }
  return UniquePtr<SpeculationRules>(parsedRules);
}

}  // namespace mozilla::dom
