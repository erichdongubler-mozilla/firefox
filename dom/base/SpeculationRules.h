/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#ifndef mozilla_dom_SpeculationRules_h
#define mozilla_dom_SpeculationRules_h

#include "mozilla/Result.h"
#include "mozilla/ResultVariant.h"
#include "mozilla/UniquePtr.h"
#include "mozilla/dom/speculationrules_ffi_generated.h"
#include "nsStringFwd.h"

class nsIGlobalObject;
class nsIURI;

namespace mozilla {
class ErrorResult;
}

namespace mozilla::dom {

class SpeculationRules final {
 public:
  SpeculationRules() = delete;
  SpeculationRules(SpeculationRules&) = delete;
  SpeculationRules& operator=(const SpeculationRules&) = delete;

  ~SpeculationRules() = default;
  static void operator delete(void* aSpeculationRules);

  static Result<UniquePtr<SpeculationRules>, SpeculationRuleParseError> Parse(
      const nsACString& aSource, nsIURI* aDocumentBaseUri, nsIURI* aBaseUri);

  static void ReportParseError(nsIGlobalObject* aGlobal,
                               SpeculationRuleParseError aError);
};

}  // namespace mozilla::dom

#endif  // mozilla_dom_SpeculationRules_h
