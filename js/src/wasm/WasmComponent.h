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
#  include "mozilla/Maybe.h"
#  include "mozilla/RefPtr.h"
#  include "mozilla/Span.h"
#  include "mozilla/Variant.h"
#  include "mozilla/Vector.h"
#  include "wasm/WasmModule.h"

namespace js {
namespace wasm {

// Every kind of type that can be defined in the component model. Not all types
// are valid in all contexts.
enum class ComponentTypeKind : uint8_t {
  Bool = 0x7f,
  S8 = 0x7e,
  U8 = 0x7d,
  S16 = 0x7c,
  U16 = 0x7b,
  S32 = 0x7a,
  U32 = 0x79,
  S64 = 0x78,
  U64 = 0x77,
  F32 = 0x76,
  F64 = 0x75,
  Char = 0x74,
  String = 0x73,

  Record = 0x72,
  Variant = 0x71,
  List = 0x70,
  Tuple = 0x6f,
  Flags = 0x6e,
  Enum = 0x6d,
  Option = 0x6b,
  Result = 0x6a,
  Own = 0x69,
  Borrow = 0x68,

  Func = 0x40,  // async func types are not a separate kind
  Component = 0x41,
  Instance = 0x42,
  Resource = 0x3f,  // resource types with callbacks are not a separate kind

  // Convenience for ComponentTypeKindIsPrimitive. "First" and "last" refer to
  // the actual byte value.
  FirstPrimitive = String,
  LastPrimitive = Bool,
};

// Checks if the given kind is for a primitive type (`primvaltype`), i.e. one
// that doesn't need to be defined and referenced.
inline bool ComponentTypeKindIsPrimitive(ComponentTypeKind kind) {
  return ComponentTypeKind::FirstPrimitive <= kind &&
         kind <= ComponentTypeKind::LastPrimitive;
}

// Checks if the given kind is for a value type (`valtype`), i.e. one that can
// be used for function parameters.
inline bool ComponentTypeKindIsValueType(ComponentTypeKind kind) {
  return ComponentTypeKindIsPrimitive(kind) ||
         (ComponentTypeKind::Borrow <= kind &&
          kind <= ComponentTypeKind::Record &&
          int(kind) != 0x6c  // the one weird gap in the binary
         );
}

// A value type in the component model, i.e. one that can be used in function
// parameters or other value contexts.
class ComponentValType {
  static constexpr uint32_t TypeIndexFlag = 1 << 31;
  uint32_t bits_;

  explicit ComponentValType(uint32_t bits) : bits_(bits) {}

 public:
  // Creates a ComponentValType for a primitive (i.e. not a type reference).
  static ComponentValType primitive(ComponentTypeKind kind) {
    MOZ_ASSERT(ComponentTypeKindIsPrimitive(kind));
    return ComponentValType(uint32_t(kind));
  }
  // Creates a ComponentValType referencing another type in the component.
  static ComponentValType typeIndex(uint32_t idx) {
    MOZ_ASSERT(!(idx & TypeIndexFlag));
    return ComponentValType(TypeIndexFlag | idx);
  }

  bool isPrimitive() const { return !(bits_ & TypeIndexFlag); }
  bool isTypeIndex() const { return bits_ & TypeIndexFlag; }
  ComponentTypeKind asPrimitive() const {
    MOZ_ASSERT(isPrimitive());
    return ComponentTypeKind(bits_);
  }
  uint32_t asTypeIndex() const {
    MOZ_ASSERT(isTypeIndex());
    return bits_ & ~TypeIndexFlag;
  }
};
using ComponentValTypeVector =
    mozilla::Vector<ComponentValType, 0, SystemAllocPolicy>;

struct ComponentRecordField {
  CacheableName name;
  ComponentValType type;

  ComponentRecordField(CacheableName&& name_, ComponentValType type_)
      : name(std::move(name_)), type(type_) {}
};
using ComponentRecordFieldVector =
    mozilla::Vector<ComponentRecordField, 0, SystemAllocPolicy>;

struct ComponentVariantCase {
  CacheableName name;
  mozilla::Maybe<ComponentValType> type;
};
using ComponentVariantCaseVector =
    mozilla::Vector<ComponentVariantCase, 0, SystemAllocPolicy>;

struct ComponentResultType {
  mozilla::Maybe<ComponentValType> type;
  mozilla::Maybe<ComponentValType> errorType;
};

struct ComponentFuncType {
  ComponentValTypeVector paramTypes;
  CacheableNameVector paramNames;
  mozilla::Maybe<ComponentValType> resultType;
  bool isAsync;
};

// A type defined within a component.
class ComponentDefType {
  ComponentTypeKind kind_;

  // TODO(wasm-cm): Add component types, instance types, resource types?
  using TypeProps = mozilla::Variant<mozilla::Nothing,            // primitive,
                                     ComponentRecordFieldVector,  // record
                                     ComponentVariantCaseVector,  // variant
                                     ComponentValType,        // list, option
                                     ComponentValTypeVector,  // tuple
                                     CacheableNameVector,     // flags, enum
                                     ComponentResultType,     // result
                                     uint32_t,                // own, borrow

                                     ComponentFuncType  // func
                                     >;
  TypeProps props_;

  explicit ComponentDefType(ComponentTypeKind kind)
      : kind_(kind), props_(mozilla::Nothing()) {
    MOZ_ASSERT(ComponentTypeKindIsPrimitive(kind));
  }
  explicit ComponentDefType(ComponentRecordFieldVector&& fields)
      : kind_(ComponentTypeKind::Record), props_(std::move(fields)) {}
  explicit ComponentDefType(ComponentVariantCaseVector&& cases)
      : kind_(ComponentTypeKind::Variant), props_(std::move(cases)) {}
  explicit ComponentDefType(ComponentTypeKind kind, ComponentValType&& type)
      : kind_(kind), props_(std::move(type)) {
    MOZ_ASSERT(kind == ComponentTypeKind::List ||
               kind == ComponentTypeKind::Option);
  }
  explicit ComponentDefType(ComponentValTypeVector&& types)
      : kind_(ComponentTypeKind::Tuple), props_(std::move(types)) {}
  explicit ComponentDefType(ComponentTypeKind kind,
                            CacheableNameVector&& labels)
      : kind_(kind), props_(std::move(labels)) {
    MOZ_ASSERT(kind == ComponentTypeKind::Flags ||
               kind == ComponentTypeKind::Enum);
  }
  explicit ComponentDefType(ComponentResultType&& type)
      : kind_(ComponentTypeKind::Result), props_(std::move(type)) {}
  explicit ComponentDefType(ComponentFuncType&& funcType)
      : kind_(ComponentTypeKind::Func), props_(std::move(funcType)) {}

 public:
  static ComponentDefType primitive(ComponentTypeKind kind) {
    MOZ_ASSERT(ComponentTypeKindIsPrimitive(kind));
    return ComponentDefType(kind);
  }
  static ComponentDefType record(ComponentRecordFieldVector&& fields) {
    return ComponentDefType(std::move(fields));
  }
  static ComponentDefType variant(ComponentVariantCaseVector&& cases) {
    return ComponentDefType(std::move(cases));
  }
  static ComponentDefType list(ComponentValType&& type) {
    return ComponentDefType(ComponentTypeKind::List, std::move(type));
  }
  static ComponentDefType tuple(ComponentValTypeVector&& types) {
    return ComponentDefType(std::move(types));
  }
  static ComponentDefType flags(CacheableNameVector&& labels) {
    return ComponentDefType(ComponentTypeKind::Flags, std::move(labels));
  }
  static ComponentDefType enum_(CacheableNameVector&& labels) {
    return ComponentDefType(ComponentTypeKind::Enum, std::move(labels));
  }
  static ComponentDefType option(ComponentValType&& type) {
    return ComponentDefType(ComponentTypeKind::Option, std::move(type));
  }
  static ComponentDefType result(ComponentResultType&& type) {
    return ComponentDefType(std::move(type));
  }
  static ComponentDefType func(ComponentFuncType&& ft) {
    return ComponentDefType(std::move(ft));
  }

  ComponentTypeKind kind() const { return kind_; }

  const ComponentRecordFieldVector& asRecord() const {
    MOZ_RELEASE_ASSERT(kind() == ComponentTypeKind::Record);
    return props_.as<ComponentRecordFieldVector>();
  }
  const ComponentVariantCaseVector& asVariant() const {
    MOZ_RELEASE_ASSERT(kind() == ComponentTypeKind::Variant);
    return props_.as<ComponentVariantCaseVector>();
  }
  const ComponentValTypeVector& asTuple() const {
    MOZ_RELEASE_ASSERT(kind() == ComponentTypeKind::Tuple);
    return props_.as<ComponentValTypeVector>();
  }
  ComponentValType asOption() const {
    MOZ_RELEASE_ASSERT(kind() == ComponentTypeKind::Option);
    return props_.as<ComponentValType>();
  }
  ComponentResultType asResult() const {
    MOZ_RELEASE_ASSERT(kind() == ComponentTypeKind::Result);
    return props_.as<ComponentResultType>();
  }
  const ComponentFuncType& asFunc() const {
    MOZ_RELEASE_ASSERT(kind() == ComponentTypeKind::Func);
    return props_.as<ComponentFuncType>();
  }
};

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
  using TypeVector = mozilla::Vector<ComponentDefType, 0, SystemAllocPolicy>;

  // JS API and JS::WasmComponent implementation:
  JSObject* createObject(JSContext* cx) const override;

 public:
  TypeVector types;

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
