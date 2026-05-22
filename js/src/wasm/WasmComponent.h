/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

#ifndef wasm_component_h
#define wasm_component_h

#ifdef ENABLE_WASM_COMPONENTS

#  include "js/WasmComponent.h"

#  include "mozilla/HashTable.h"
#  include "mozilla/RefPtr.h"
#  include "mozilla/Span.h"
#  include "wasm/WasmModule.h"

namespace js {
namespace wasm {

// A hash policy for StronglyUniqueNameSet that hashes items based on their
// trimmed, lowercased versions, but matches based on the full strongly-unique
// rules.
//
// The full strongly-unique rules are not hash-friendly; we have not yet figured
// out any way to "normalize" the name to a unique key that satisfies the
// strange carve-out rules for constructor and method names. But, we don't want
// to quadratically check each new name against every other name, so we take a
// disappointing halfway approach of hashing only the base part of the name, and
// then running the full strongly-unique logic in `match`. This results in more
// hash collisions and a less-inexpensive `match` method, but at least it keeps
// things from growing quadratically.
struct StronglyUniqueNameHasher {
  using Key = mozilla::Span<const char>;
  using Lookup = mozilla::Span<const char>;

  static HashNumber hash(const Lookup& aLookup);
  static bool match(const Key& aKey, const Lookup& aLookup);
};

// A class which can be used to check if a set of component model names is
// strongly-unique.
class StronglyUniqueNameSet {
  mozilla::HashSet<mozilla::Span<const char>, StronglyUniqueNameHasher,
                   SystemAllocPolicy>
      data_;

 public:
  [[nodiscard]] bool add(mozilla::Span<const char> name, bool* duplicate);
};

class Component : public JS::WasmComponent {
  // JS API and JS::WasmComponent implementation:
  JSObject* createObject(JSContext* cx) const override;

 public:
  // TODO(wasm-cm): These functions are currently correct because components
  // currently have no state, but will need to be updated as we flesh things
  // out.
  size_t gcMallocBytesExcludingCode() const { return 0; }
  size_t tier1CodeMemoryUsed() const { return 0; }
};

using MutableComponent = RefPtr<Component>;
using SharedComponent = RefPtr<const Component>;

}  // namespace wasm
}  // namespace js

#endif  // ENABLE_WASM_COMPONENTS

#endif  // wasm_component_h
