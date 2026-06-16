/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#include "mozilla/dom/SpeculationRules.h"

#include "js/friend/ErrorMessages.h"
#include "mozilla/dom/ScriptSettings.h"
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

/* static */ void SpeculationRules::ReportParseError(
    nsIGlobalObject* aGlobal, SpeculationRuleParseError aError) {
  MOZ_ASSERT(aGlobal);
  MOZ_ASSERT(aError != SpeculationRuleParseError::None);
  AutoJSAPI jsapi;
  if (!jsapi.Init(aGlobal)) {
    return;
  }
  JSErrNum errorNumber = JSMSG_SPECULATION_RULES_NOT_A_MAP;
  switch (aError) {
    case SpeculationRuleParseError::TopLevelValueMustBeJsonObject:
      errorNumber = JSMSG_SPECULATION_RULES_NOT_A_MAP;
      break;
    case SpeculationRuleParseError::InvalidTag:
      errorNumber = JSMSG_SPECULATION_RULES_INVALID_TAG;
      break;
    case SpeculationRuleParseError::InvalidBaseUrl:
      errorNumber = JSMSG_SPECULATION_RULES_INVALID_BASE_URL;
      break;
    case SpeculationRuleParseError::None:
      MOZ_ASSERT_UNREACHABLE();
      return;
  }
  JS_ReportErrorNumberASCII(jsapi.cx(), js::GetErrorMessage, nullptr,
                            errorNumber);
}

}  // namespace mozilla::dom
