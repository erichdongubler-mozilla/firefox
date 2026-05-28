/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DOM_INDEXEDDB_IDBGETALLHELPER_H_
#define DOM_INDEXEDDB_IDBGETALLHELPER_H_

#include "js/TypeDecls.h"
#include "mozilla/ErrorResult.h"
#include "mozilla/Result.h"
#include "mozilla/dom/BindingDeclarations.h"
#include "mozilla/dom/indexedDB/PBackgroundIDBSharedTypes.h"

namespace mozilla::dom {

class IDBTransaction;

Result<indexedDB::GetAllOptions, ErrorResult> GetAllOptionsFromQueryOrOptions(
    JSContext* aCx, JS::Handle<JS::Value> aQueryOrOptions,
    const Optional<uint32_t>& aLimit, IDBTransaction* aTransaction);

}  // namespace mozilla::dom

#endif  //  DOM_INDEXEDDB_IDBGETALLHELPER_H_
