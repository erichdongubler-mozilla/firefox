/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

#ifndef wasm_component_h
#define wasm_component_h

#ifdef ENABLE_WASM_COMPONENTS

#  include "js/WasmComponent.h"

#  include "mozilla/RefPtr.h"
#  include "wasm/WasmModule.h"

namespace js {
namespace wasm {

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
