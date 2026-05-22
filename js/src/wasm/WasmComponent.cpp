/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

#include "wasm/WasmComponent.h"

#ifdef ENABLE_WASM_COMPONENTS

#  include "js/friend/ErrorMessages.h"  // js::GetErrorMessage, JSMSG_*
#  include "util/Text.h"
#  include "vm/GlobalObject.h"
#  include "wasm/WasmJS.h"

using namespace js;
using namespace js::wasm;

static constexpr mozilla::Span<const char> attributeConstructor =
    mozilla::MakeStringSpan("[constructor]");
static constexpr mozilla::Span<const char> attributeMethod =
    mozilla::MakeStringSpan("[method]");
static constexpr mozilla::Span<const char> attributeStatic =
    mozilla::MakeStringSpan("[static]");

// Component model names are encoded as UTF-8, and in fact an ASCII subset of
// UTF-8, so this is fine.
static inline char LowercaseNameChar(char c) {
  return ('A' <= c && c <= 'Z') ? c + ('a' - 'A') : c;
}

static inline mozilla::Span<const char> TrimAttribute(
    mozilla::Span<const char> name) {
  if (CharsStartsWith(name, attributeConstructor)) {
    return name.Subspan(attributeConstructor.Length());
  }
  if (CharsStartsWith(name, attributeMethod)) {
    return name.Subspan(attributeMethod.Length());
  }
  if (CharsStartsWith(name, attributeStatic)) {
    return name.Subspan(attributeStatic.Length());
  }
  return name;
}

static inline bool NameHasAttribute(mozilla::Span<const char> name) {
  // The name should already be well-formed from parse time.
  return name.Length() == 0 || name.data()[0] == '[';
}

// We hash only the base part of the name, e.g. "foo" for "[constructor]foo".
HashNumber StronglyUniqueNameHasher::hash(const Lookup& aLookup) {
  const Lookup& trimmed = TrimAttribute(aLookup);

  HashNumber hash = 0;
  for (size_t i = 0; i < trimmed.Length(); i++) {
    char c = trimmed.data()[i];
    if (c == '.') {
      break;
    }
    hash = mozilla::AddToHash(hash, LowercaseNameChar(trimmed.data()[i]));
  }
  return hash;
}

bool StronglyUniqueNameHasher::match(const Key& aKey, const Lookup& aLookup) {
  mozilla::Span<const char> newTrimmed = TrimAttribute(aLookup);
  mozilla::Span<const char> existingTrimmed = TrimAttribute(aKey);

  // Rule 1: If one name is l and the other name is [constructor]l (for the
  // same label l), they are strongly-unique.
  bool newIsConstructor = CharsStartsWith(aLookup, attributeConstructor);
  bool existingIsConstructor = CharsStartsWith(aKey, attributeConstructor);
  if (newIsConstructor != existingIsConstructor &&
      newTrimmed == existingTrimmed) {
    return false;
  }

  // Rule 2: If one name is l and the other name is [*]l.l (for the same label l
  // and any annotation * with a dotted l.l name), they are not strongly-unique.
  mozilla::Maybe<mozilla::Span<const char>> plain;
  mozilla::Maybe<mozilla::Span<const char>> dotted;
  if (!NameHasAttribute(aLookup)) {
    plain.emplace(aLookup);
  } else if (!NameHasAttribute(aKey)) {
    plain.emplace(aKey);
  }
  if (CharsStartsWith(aLookup, attributeMethod) ||
      CharsStartsWith(aLookup, attributeStatic)) {
    dotted.emplace(aLookup);
  } else if (CharsStartsWith(aKey, attributeMethod) ||
             CharsStartsWith(aKey, attributeStatic)) {
    dotted.emplace(aKey);
  }
  if (plain.isSome() && dotted.isSome()) {
    mozilla::Span<const char> dottedTrimmed = TrimAttribute(dotted.value());
    size_t indexOfDot = dottedTrimmed.IndexOf('.');
    MOZ_RELEASE_ASSERT(indexOfDot != mozilla::Span<const char>::npos);
    auto [before, after] = dottedTrimmed.SplitAt(indexOfDot);
    after = after.Subspan(1);  // The SplitAt method includes the dot.
    if (plain.value() == after && plain.value() == before) {
      return true;
    }
  }

  // Rule 3: Lowercase the names, trim attributes, and compare directly.
  if (newTrimmed.Length() != existingTrimmed.Length()) {
    return false;
  }
  for (size_t i = 0; i < newTrimmed.Length(); i++) {
    if (LowercaseNameChar(newTrimmed[i]) !=
        LowercaseNameChar(existingTrimmed[i])) {
      return false;
    }
  }
  return true;
}

bool StronglyUniqueNameSet::add(mozilla::Span<const char> name,
                                bool* duplicate) {
  *duplicate = false;

  auto p = data_.lookupForAdd(name);
  if (p) {
    *duplicate = true;
    return true;
  }

  return data_.add(p, std::move(name));
}

/* virtual */
JSObject* Component::createObject(JSContext* cx) const {
  if (!GlobalObject::ensureConstructor(cx, cx->global(), JSProto_WebAssembly)) {
    return nullptr;
  }

  JS::RootedVector<JSString*> parameterStrings(cx);
  JS::RootedVector<Value> parameterArgs(cx);
  bool canCompileStrings = false;
  if (!cx->isRuntimeCodeGenEnabled(JS::RuntimeCode::WASM, nullptr,
                                   JS::CompilationType::Undefined,
                                   parameterStrings, nullptr, parameterArgs,
                                   NullHandleValue, &canCompileStrings)) {
    return nullptr;
  }
  if (!canCompileStrings) {
    JS_ReportErrorNumberASCII(cx, GetErrorMessage, nullptr,
                              JSMSG_CSP_BLOCKED_WASM, "WebAssembly.Component");
    return nullptr;
  }

  RootedObject proto(cx, &cx->global()->getPrototype(JSProto_WasmComponent));
  return WasmComponentObject::create(cx, *this, proto);
}

#endif  // ENABLE_WASM_COMPONENTS
