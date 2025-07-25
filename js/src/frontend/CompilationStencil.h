/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * vim: set ts=8 sts=2 et sw=2 tw=80:
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef frontend_CompilationStencil_h
#define frontend_CompilationStencil_h

#include "mozilla/AlreadyAddRefed.h"  // already_AddRefed
#include "mozilla/Assertions.h"  // MOZ_ASSERT, MOZ_RELEASE_ASSERT, MOZ_MAKE_COMPILER_ASSUME_IS_UNREACHABLE
#include "mozilla/Atomics.h"     // mozilla::Atomic
#include "mozilla/Attributes.h"  // MOZ_RAII, MOZ_STACK_CLASS
#include "mozilla/HashTable.h"   // mozilla::HashMap, mozilla::DefaultHasher
#include "mozilla/Maybe.h"       // mozilla::Maybe
#include "mozilla/MemoryReporting.h"  // mozilla::MallocSizeOf
#include "mozilla/RefPtr.h"           // RefPtr
#include "mozilla/Span.h"             // mozilla::Span
#include "mozilla/Variant.h"          // mozilla::Variant

#include <algorithm>    // std::swap
#include <stddef.h>     // size_t
#include <stdint.h>     // uint32_t, uintptr_t
#include <type_traits>  // std::is_pointer_v
#include <utility>      // std::forward, std::move

#include "ds/LifoAlloc.h"                 // LifoAlloc, LifoAllocScope
#include "frontend/FrontendContext.h"     // FrontendContext
#include "frontend/FunctionSyntaxKind.h"  // FunctionSyntaxKind
#include "frontend/NameAnalysisTypes.h"   // NameLocation
#include "frontend/ParserAtom.h"  // ParserAtomsTable, ParserAtomIndex, TaggedParserAtomIndex, ParserAtomSpan
#include "frontend/ScopeIndex.h"     // ScopeIndex
#include "frontend/ScriptIndex.h"    // ScriptIndex
#include "frontend/SharedContext.h"  // ThisBinding, InheritThis, Directives
#include "frontend/Stencil.h"  // ScriptStencil, ScriptStencilExtra, ScopeStencil, RegExpStencil, BigIntStencil, ObjLiteralStencil, BaseParserScopeData, StencilModuleMetadata
#include "frontend/TaggedParserAtomIndexHasher.h"  // TaggedParserAtomIndexHasher
#include "frontend/UsedNameTracker.h"              // UsedNameTracker
#include "js/AllocPolicy.h"    // SystemAllocPolicy, ReportOutOfMemory
#include "js/GCVector.h"       // JS::GCVector
#include "js/RefCounted.h"     // AtomicRefCounted
#include "js/RootingAPI.h"     // JS::Handle
#include "js/Transcoding.h"    // JS::TranscodeBuffer, JS::TranscodeRange
#include "js/UniquePtr.h"      // js::UniquePtr
#include "js/Vector.h"         // Vector
#include "js/WasmModule.h"     // JS::WasmModule
#include "vm/FunctionFlags.h"  // FunctionFlags
#include "vm/GlobalObject.h"   // GlobalObject
#include "vm/JSContext.h"      // JSContext
#include "vm/JSFunction.h"     // JSFunction
#include "vm/JSScript.h"       // BaseScript, ScriptSource, SourceExtent
#include "vm/Realm.h"          // JSContext::global
#include "vm/Scope.h"          // Scope, ModuleScope
#include "vm/ScopeKind.h"      // ScopeKind
#include "vm/SharedStencil.h"  // ImmutableScriptFlags, MemberInitializers, SharedImmutableScriptData, RO_IMMUTABLE_SCRIPT_FLAGS

class JSAtom;
class JSFunction;
class JSObject;
class JSString;
class JSTracer;

namespace JS {
class JS_PUBLIC_API ReadOnlyCompileOptions;
}

namespace js {

class AtomSet;
class JSONPrinter;
class ModuleObject;

namespace frontend {

struct InitialStencilAndDelazifications;
struct CompilationInput;
struct CompilationStencil;
struct CompilationGCOutput;
struct PreallocatedCompilationGCOutput;
class ScriptStencilIterable;
struct InputName;
class ScopeBindingCache;
struct ScriptStencilRef;

// When delazifying modules' inner functions, the actual global scope is used.
// However, when doing a delazification the global scope is not available. We
// use this dummy type to be a placeholder to be used as part of the InputScope
// variants to mimic what the Global scope would be used for.
struct FakeStencilGlobalScope {};

// Reference to a Scope within an InitialStencilAndDelazifications.
struct ScopeStencilRef {
  const InitialStencilAndDelazifications& stencils_;
  // Index of the script in the initial stencil of stencils_, where the script
  // holds the scope.
  const ScriptIndex scriptIndex_;
  // Index of the scope in te CompilationStencil (either initial or the
  // delazification) pointed by the stencils_ and scriptIndex_.
  const ScopeIndex scopeIndex_;

  // Lookup the ScopeStencil referenced by this ScopeStencilRef.
  inline const ScopeStencil& scope() const;
  // Reference to the script which owns the scope pointed by this object.
  inline ScriptStencilRef script() const;

  // For a Function scope, return the ScriptExtra information from the initial
  // stencil.
  inline const ScriptStencilExtra& functionScriptExtra() const;

  // CompilationStencil (either initial or delazification) which contains the
  // scope data.
  inline const CompilationStencil* context() const;
};

// Wraps a scope for a CompilationInput. The scope is either as a GC pointer to
// an instantiated scope, or as a reference to a CompilationStencil.
//
// Note: A scope reference may be nullptr/InvalidIndex if there is no such
// scope, such as the enclosingScope at the end of a scope chain. See `isNull`
// helper.
class InputScope {
  using InputScopeStorage =
      mozilla::Variant<Scope*, ScopeStencilRef, FakeStencilGlobalScope>;
  InputScopeStorage scope_;

 public:
  // Create an InputScope given an instantiated scope.
  explicit InputScope(Scope* ptr) : scope_(ptr) {}

  // Create an InputScope for a global.
  explicit InputScope(FakeStencilGlobalScope global) : scope_(global) {}

  // Create an InputScope given a CompilationStencil and the ScopeIndex which is
  // an offset within the same CompilationStencil given as argument.
  InputScope(const InitialStencilAndDelazifications& stencils,
             ScriptIndex scriptIndex, ScopeIndex scopeIndex)
      : scope_(ScopeStencilRef{stencils, scriptIndex, scopeIndex}) {}

  // Returns the variant used by the InputScope. This can be useful for complex
  // cases where the following accessors are not enough.
  const InputScopeStorage& variant() const { return scope_; }
  InputScopeStorage& variant() { return scope_; }

  // This match function will unwrap the variant for each type, and will
  // specialize and call the Matcher given as argument with the type and value
  // of the stored pointer / reference.
  //
  // This is useful for cases where the code is literally identical despite
  // having different specializations. This is achiveable by relying on
  // function overloading when the usage differ between the 2 types.
  //
  // Example:
  //   inputScope.match([](auto& scope) {
  //     // scope is either a `Scope*` or a `ScopeStencilRef`.
  //     for (auto bi = InputBindingIter(scope); bi; bi++) {
  //       InputName name(scope, bi.name());
  //       // ...
  //     }
  //   });
  template <typename Matcher>
  decltype(auto) match(Matcher&& matcher) const& {
    return scope_.match(std::forward<Matcher>(matcher));
  }
  template <typename Matcher>
  decltype(auto) match(Matcher&& matcher) & {
    return scope_.match(std::forward<Matcher>(matcher));
  }

  bool isNull() const {
    return scope_.match(
        [](const Scope* ptr) { return !ptr; },
        [](const ScopeStencilRef& ref) { return !ref.scopeIndex_.isValid(); },
        [](const FakeStencilGlobalScope&) { return false; });
  }

  ScopeKind kind() const {
    return scope_.match(
        [](const Scope* ptr) { return ptr->kind(); },
        [](const ScopeStencilRef& ref) { return ref.scope().kind(); },
        [](const FakeStencilGlobalScope&) { return ScopeKind::Global; });
  };
  bool hasEnvironment() const {
    return scope_.match(
        [](const Scope* ptr) { return ptr->hasEnvironment(); },
        [](const ScopeStencilRef& ref) { return ref.scope().hasEnvironment(); },
        [](const FakeStencilGlobalScope&) {
          // See Scope::hasEnvironment
          return true;
        });
  };
  inline InputScope enclosing() const;
  bool hasOnChain(ScopeKind kind) const {
    return scope_.match([=](const Scope* ptr) { return ptr->hasOnChain(kind); },
                        [=](const ScopeStencilRef& ref) {
                          ScopeStencilRef it = ref;
                          while (true) {
                            const ScopeStencil& scope = it.scope();
                            if (scope.kind() == kind) {
                              return true;
                            }
                            if (scope.kind() == ScopeKind::Module &&
                                kind == ScopeKind::Global) {
                              return true;
                            }
                            if (!scope.hasEnclosing()) {
                              break;
                            }
                            new (&it)
                                ScopeStencilRef{ref.stencils_, ref.scriptIndex_,
                                                scope.enclosing()};
                          }
                          return false;
                        },
                        [=](const FakeStencilGlobalScope&) {
                          return kind == ScopeKind::Global;
                        });
  }
  uint32_t environmentChainLength() const {
    return scope_.match(
        [](const Scope* ptr) { return ptr->environmentChainLength(); },
        [](const ScopeStencilRef& ref) {
          uint32_t length = 0;
          ScopeStencilRef it = ref;
          while (true) {
            const ScopeStencil& scope = it.scope();
            if (scope.hasEnvironment() &&
                scope.kind() != ScopeKind::NonSyntactic) {
              length++;
            }
            if (scope.kind() == ScopeKind::Module) {
              // Stencil do not encode the Global scope, as it used to be
              // assumed to already exists. As moving delazification off-thread,
              // we need to materialize a fake-stencil version of the Global
              // Scope.
              MOZ_ASSERT(!scope.hasEnclosing());
              length += js::ModuleScope::EnclosingEnvironmentChainLength;
            }
            if (!scope.hasEnclosing()) {
              break;
            }
            new (&it) ScopeStencilRef{ref.stencils_, ref.scriptIndex_,
                                      scope.enclosing()};
          }
          return length;
        },
        [=](const FakeStencilGlobalScope&) {
          // Stencil-based delazification needs to calculate
          // environmentChainLength where the global is not available.
          //
          // The FakeStencilGlobalScope is used to represent what the global
          // would be if we had access to it while delazifying.
          return uint32_t(js::ModuleScope::EnclosingEnvironmentChainLength);
        });
  }
  void trace(JSTracer* trc);
  bool isStencil() const { return !scope_.is<Scope*>(); };

  // Various accessors which are valid only when the InputScope is a
  // FunctionScope. Some of these accessors are returning values associated with
  // the canonical function.
 private:
  inline FunctionFlags functionFlags() const;
  inline ImmutableScriptFlags immutableFlags() const;

 public:
  inline MemberInitializers getMemberInitializers() const;
  RO_IMMUTABLE_SCRIPT_FLAGS(immutableFlags())
  bool isArrow() const { return functionFlags().isArrow(); }
  bool allowSuperProperty() const {
    return functionFlags().allowSuperProperty();
  }
  bool isClassConstructor() const {
    return functionFlags().isClassConstructor();
  }
};

// Reference to a Script within an InitialStencilAndDelazifications.
struct ScriptStencilRef {
  const InitialStencilAndDelazifications& stencils_;
  // Index of the script within the initial CompilationStencil of stencils_.
  const ScriptIndex scriptIndex_;

  // Returns a ScriptStencilRef corresponding to the top-level script, which is
  // the first script in the initial stencil.
  inline ScriptStencilRef topLevelScript() const;

  // Returns a ScriptStencilRef which corresponds to the enclosing script of the
  // current script.
  inline ScriptStencilRef enclosingScript() const;

  // scriptData about the current script, held by the enclosing (initial /
  // delazification) stencil.
  //
  // This function is used to get function flags known by the caller, and when
  // looking for scope index in the enclosing stencil.
  inline const ScriptStencil& scriptDataFromEnclosing() const;

  // scriptData about the current script, held by the initial stencil.
  //
  // This function is used to implement gcThingsFromInitial, and also query
  // whether this script is compiled as part of the initial stencil or not.
  inline const ScriptStencil& scriptDataFromInitial() const;

  // Returns whether the script is held by the initial stencil.
  inline bool isEagerlyCompiledInInitial() const;

  // scriptExtra about the current script, held by the initial stencil.
  inline const ScriptStencilExtra& scriptExtra() const;

  // gcThings about the current script, held by the initial stencil. Unless this
  // script is compiled as part of the top-level, it would most likely only
  // contain the list of inner functions.
  inline mozilla::Span<TaggedScriptThingIndex> gcThingsFromInitial() const;

  // Initial or delazification stencil which holds the the compilation result
  // for the current scriptIndex_.
  inline const CompilationStencil* context() const;
  inline const CompilationStencil* maybeContext() const;
};

// Wraps a script for a CompilationInput. The script is either as a BaseScript
// pointer to an instantiated script, or as a reference to a CompilationStencil.
class InputScript {
  using InputScriptStorage = mozilla::Variant<BaseScript*, ScriptStencilRef>;
  InputScriptStorage script_;

 public:
  // Create an InputScript given an instantiated BaseScript pointer.
  explicit InputScript(BaseScript* ptr) : script_(ptr) {}

  // Create an InputScript given a CompilationStencil and the ScriptIndex which
  // is an offset within the same CompilationStencil given as argument.
  InputScript(const InitialStencilAndDelazifications& stencils,
              ScriptIndex scriptIndex)
      : script_(ScriptStencilRef{stencils, scriptIndex}) {}

  const InputScriptStorage& raw() const { return script_; }
  InputScriptStorage& raw() { return script_; }

  SourceExtent extent() const {
    return script_.match(
        [](const BaseScript* ptr) { return ptr->extent(); },
        [](const ScriptStencilRef& ref) { return ref.scriptExtra().extent; });
  }
  ImmutableScriptFlags immutableFlags() const {
    return script_.match(
        [](const BaseScript* ptr) { return ptr->immutableFlags(); },
        [](const ScriptStencilRef& ref) {
          return ref.scriptExtra().immutableFlags;
        });
  }
  RO_IMMUTABLE_SCRIPT_FLAGS(immutableFlags())
  FunctionFlags functionFlags() const {
    return script_.match(
        [](const BaseScript* ptr) { return ptr->function()->flags(); },
        [](const ScriptStencilRef& ref) {
          auto& scriptData = ref.scriptDataFromEnclosing();
          return scriptData.functionFlags;
        });
  }
  bool hasPrivateScriptData() const {
    return script_.match(
        [](const BaseScript* ptr) { return ptr->hasPrivateScriptData(); },
        [](const ScriptStencilRef& ref) {
          // See BaseScript::CreateRawLazy.
          auto& scriptData = ref.scriptDataFromEnclosing();
          return scriptData.hasGCThings() ||
                 ref.scriptExtra().useMemberInitializers();
        });
  }
  InputScope enclosingScope() const {
    return script_.match(
        [](const BaseScript* ptr) {
          return InputScope(ptr->function()->enclosingScope());
        },
        [](const ScriptStencilRef& ref) {
          // The ScriptStencilRef only reference lazy Script, otherwise we
          // should fetch the enclosing scope using the bodyScope field of the
          // immutable data which is a reference to the vector of gc-things.
          auto enclosing = ref.enclosingScript();
          auto& scriptData = ref.scriptDataFromEnclosing();
          MOZ_RELEASE_ASSERT(!scriptData.hasSharedData());
          MOZ_ASSERT(scriptData.hasLazyFunctionEnclosingScopeIndex());
          auto scopeIndex = scriptData.lazyFunctionEnclosingScopeIndex();
          return InputScope(ref.stencils_, enclosing.scriptIndex_, scopeIndex);
        });
  }
  MemberInitializers getMemberInitializers() const {
    return script_.match(
        [](const BaseScript* ptr) { return ptr->getMemberInitializers(); },
        [](const ScriptStencilRef& ref) {
          return ref.scriptExtra().memberInitializers();
        });
  }

  InputName displayAtom() const;
  void trace(JSTracer* trc);
  bool isNull() const {
    return script_.match([](const BaseScript* ptr) { return !ptr; },
                         [](const ScriptStencilRef& ref) { return false; });
  }
  bool isStencil() const {
    return script_.match([](const BaseScript* ptr) { return false; },
                         [](const ScriptStencilRef&) { return true; });
  }

  ScriptSourceObject* sourceObject() const {
    return script_.match(
        [](const BaseScript* ptr) { return ptr->sourceObject(); },
        [](const ScriptStencilRef&) {
          return static_cast<ScriptSourceObject*>(nullptr);
        });
  }
};

// Iterator for walking the scope chain, this is identical to ScopeIter but
// accept an InputScope instead of a Scope pointer.
//
// It may be placed in GC containers; for example:
//
//   for (Rooted<InputScopeIter> si(cx, InputScopeIter(scope)); si; si++) {
//     use(si);
//     SomeMayGCOperation();
//     use(si);
//   }
//
class MOZ_STACK_CLASS InputScopeIter {
  InputScope scope_;

 public:
  explicit InputScopeIter(const InputScope& scope) : scope_(scope) {}

  InputScope& scope() {
    MOZ_ASSERT(!done());
    return scope_;
  }

  const InputScope& scope() const {
    MOZ_ASSERT(!done());
    return scope_;
  }

  bool done() const { return scope_.isNull(); }
  explicit operator bool() const { return !done(); }
  void operator++(int) { scope_ = scope_.enclosing(); }
  ScopeKind kind() const { return scope_.kind(); }

  // Returns whether this scope has a syntactic environment (i.e., an
  // Environment that isn't a non-syntactic With or NonSyntacticVariables)
  // on the environment chain.
  bool hasSyntacticEnvironment() const {
    return scope_.hasEnvironment() && scope_.kind() != ScopeKind::NonSyntactic;
  }

  void trace(JSTracer* trc) { scope_.trace(trc); }
};

// Reference to a Binding Name within an existing CompilationStencil.
// TaggedParserAtomIndex are in some cases indexes in the parserAtomData of the
// CompilationStencil.
struct NameStencilRef {
  const CompilationStencil& context_;
  const TaggedParserAtomIndex atomIndex_;
};

// Wraps a name for a CompilationInput. The name is either as a GC pointer to
// a JSAtom, or a TaggedParserAtomIndex which might reference to a non-included.
//
// The constructor for this class are using an InputScope as argument. This
// InputScope is made to fetch back the CompilationStencil associated with the
// TaggedParserAtomIndex when using a Stencil as input.
struct InputName {
  using InputNameStorage = mozilla::Variant<JSAtom*, NameStencilRef>;
  InputNameStorage variant_;

  InputName(Scope*, JSAtom* ptr) : variant_(ptr) {}
  InputName(const ScopeStencilRef& scope, TaggedParserAtomIndex index)
      : variant_(NameStencilRef{*scope.context(), index}) {}
  InputName(BaseScript*, JSAtom* ptr) : variant_(ptr) {}
  InputName(const ScriptStencilRef& script, TaggedParserAtomIndex index)
      : variant_(NameStencilRef{*script.context(), index}) {}

  // Dummy for empty global.
  InputName(const FakeStencilGlobalScope&, TaggedParserAtomIndex)
      : variant_(static_cast<JSAtom*>(nullptr)) {}

  // The InputName is either from an instantiated name, or from another
  // CompilationStencil. This method interns the current name in the parser atom
  // table of a CompilationState, which has a corresponding CompilationInput.
  TaggedParserAtomIndex internInto(FrontendContext* fc,
                                   ParserAtomsTable& parserAtoms,
                                   CompilationAtomCache& atomCache);

  // Compare an InputName, which is not yet interned, with `other` is either an
  // interned name or a well-known or static string.
  //
  // The `otherCached` argument should be a reference to a JSAtom*, initialized
  // to nullptr, which is used to cache the JSAtom representation of the `other`
  // argument if needed. If a different `other` parameter is provided, the
  // `otherCached` argument should be reset to nullptr.
  bool isEqualTo(FrontendContext* fc, ParserAtomsTable& parserAtoms,
                 CompilationAtomCache& atomCache, TaggedParserAtomIndex other,
                 JSAtom** otherCached) const;

  bool isNull() const {
    return variant_.match(
        [](JSAtom* ptr) { return !ptr; },
        [](const NameStencilRef& ref) { return !ref.atomIndex_; });
  }
};

// ScopeContext holds information derived from the scope and environment chains
// to try to avoid the parser needing to traverse VM structures directly.
struct ScopeContext {
  // Cache: Scope -> (JSAtom/TaggedParserAtomIndex -> NameLocation)
  //
  // This cache maps the scope to a hash table which can lookup a name of the
  // scope to the equivalent NameLocation.
  ScopeBindingCache* scopeCache = nullptr;

  // Generation number of the `scopeCache` collected before filling the cache
  // with enclosing scope information.
  //
  // The generation number, obtained from `scopeCache->getCurrentGeneration()`
  // is incremented each time the GC invalidate the content of the cache. The
  // `scopeCache` can only be used when the generation number collected before
  // filling the cache is identical to the generation number seen when querying
  // the cached content.
  size_t scopeCacheGen = 0;

  // Class field initializer info if we are nested within a class constructor.
  // We may be an combination of arrow and eval context within the constructor.
  mozilla::Maybe<MemberInitializers> memberInitializers = {};

  enum class EnclosingLexicalBindingKind {
    Let,
    Const,
    CatchParameter,
    Synthetic,
    PrivateMethod,
  };

  using EnclosingLexicalBindingCache =
      mozilla::HashMap<TaggedParserAtomIndex, EnclosingLexicalBindingKind,
                       TaggedParserAtomIndexHasher>;

  // Cache of enclosing lexical bindings.
  // Used only for eval.
  mozilla::Maybe<EnclosingLexicalBindingCache> enclosingLexicalBindingCache_;

  // A map of private names to NameLocations used to allow evals to
  // provide correct private name semantics (particularly around early
  // errors and private brand lookup).
  using EffectiveScopePrivateFieldCache =
      mozilla::HashMap<TaggedParserAtomIndex, NameLocation,
                       TaggedParserAtomIndexHasher>;

  // Cache of enclosing class's private fields.
  // Used only for eval.
  mozilla::Maybe<EffectiveScopePrivateFieldCache>
      effectiveScopePrivateFieldCache_;

#ifdef DEBUG
  bool enclosingEnvironmentIsDebugProxy_ = false;
#endif

  // How many hops required to navigate from 'enclosingScope' to effective
  // scope.
  uint32_t effectiveScopeHops = 0;

  uint32_t enclosingScopeEnvironmentChainLength = 0;

  // Eval and arrow scripts also inherit the "this" environment -- used by
  // `super` expressions -- from their enclosing script. We count the number of
  // environment hops needed to get from enclosing scope to the nearest
  // appropriate environment. This value is undefined if the script we are
  // compiling is not an eval or arrow-function.
  uint32_t enclosingThisEnvironmentHops = 0;

  // The kind of enclosing scope.
  ScopeKind enclosingScopeKind = ScopeKind::Global;

  // The type of binding required for `this` of the top level context, as
  // indicated by the enclosing scopes of this parse.
  //
  // NOTE: This is computed based on the effective scope (defined above).
  ThisBinding thisBinding = ThisBinding::Global;

  // Eval and arrow scripts inherit certain syntax allowances from their
  // enclosing scripts.
  bool allowNewTarget = false;
  bool allowSuperProperty = false;
  bool allowSuperCall = false;
  bool allowArguments = true;

  // Indicates there is a 'class' or 'with' scope on enclosing scope chain.
  bool inClass = false;
  bool inWith = false;

  // True if the enclosing scope is for FunctionScope of arrow function.
  bool enclosingScopeIsArrow = false;

  // True if the enclosing scope has environment.
  bool enclosingScopeHasEnvironment = false;

#ifdef DEBUG
  // True if the enclosing scope has non-syntactic scope on chain.
  bool hasNonSyntacticScopeOnChain = false;

  // True if the enclosing scope has function scope where the function needs
  // home object.
  bool hasFunctionNeedsHomeObjectOnChain = false;
#endif

  bool init(FrontendContext* fc, CompilationInput& input,
            ParserAtomsTable& parserAtoms, ScopeBindingCache* scopeCache,
            InheritThis inheritThis, JSObject* enclosingEnv);

  mozilla::Maybe<EnclosingLexicalBindingKind>
  lookupLexicalBindingInEnclosingScope(TaggedParserAtomIndex name);

  NameLocation searchInEnclosingScope(FrontendContext* fc,
                                      CompilationInput& input,
                                      ParserAtomsTable& parserAtoms,
                                      TaggedParserAtomIndex name);

  bool effectiveScopePrivateFieldCacheHas(TaggedParserAtomIndex name);
  mozilla::Maybe<NameLocation> getPrivateFieldLocation(
      TaggedParserAtomIndex name);

 private:
  void computeThisBinding(const InputScope& scope);
  void computeThisEnvironment(const InputScope& enclosingScope);
  void computeInScope(const InputScope& enclosingScope);
  void cacheEnclosingScope(const InputScope& enclosingScope);
  NameLocation searchInEnclosingScopeWithCache(FrontendContext* fc,
                                               CompilationInput& input,
                                               ParserAtomsTable& parserAtoms,
                                               TaggedParserAtomIndex name);
  NameLocation searchInEnclosingScopeNoCache(FrontendContext* fc,
                                             CompilationInput& input,
                                             ParserAtomsTable& parserAtoms,
                                             TaggedParserAtomIndex name);

  InputScope determineEffectiveScope(InputScope& scope, JSObject* environment);

  bool cachePrivateFieldsForEval(FrontendContext* fc, CompilationInput& input,
                                 JSObject* enclosingEnvironment,
                                 const InputScope& effectiveScope,
                                 ParserAtomsTable& parserAtoms);

  bool cacheEnclosingScopeBindingForEval(FrontendContext* fc,
                                         CompilationInput& input,
                                         ParserAtomsTable& parserAtoms);

  bool addToEnclosingLexicalBindingCache(FrontendContext* fc,
                                         ParserAtomsTable& parserAtoms,
                                         CompilationAtomCache& atomCache,
                                         InputName& name,
                                         EnclosingLexicalBindingKind kind);
};

struct CompilationAtomCache {
 public:
  using AtomCacheVector = JS::GCVector<JSString*, 0, js::SystemAllocPolicy>;

 private:
  // Atoms lowered into or converted from CompilationStencil.parserAtomData.
  //
  // This field is here instead of in CompilationGCOutput because atoms lowered
  // from JSAtom is part of input (enclosing scope bindings, lazy function name,
  // etc), and having 2 vectors in both input/output is error prone.
  AtomCacheVector atoms_;

 public:
  JSString* getExistingStringAt(ParserAtomIndex index) const;
  JSString* getExistingStringAt(JSContext* cx,
                                TaggedParserAtomIndex taggedIndex) const;
  JSString* getStringAt(ParserAtomIndex index) const;

  JSAtom* getExistingAtomAt(ParserAtomIndex index) const;
  JSAtom* getExistingAtomAt(JSContext* cx,
                            TaggedParserAtomIndex taggedIndex) const;
  JSAtom* getAtomAt(ParserAtomIndex index) const;

  bool hasAtomAt(ParserAtomIndex index) const;
  bool setAtomAt(FrontendContext* fc, ParserAtomIndex index, JSString* atom);
  bool allocate(FrontendContext* fc, size_t length);

  bool empty() const { return atoms_.empty(); }
  size_t size() const { return atoms_.length(); }

  void stealBuffer(AtomCacheVector& atoms);
  void releaseBuffer(AtomCacheVector& atoms);

  void trace(JSTracer* trc);

  size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    return atoms_.sizeOfExcludingThis(mallocSizeOf);
  }
};

// Information associated with an extra binding provided to a global script.
// See frontend::CompileGlobalScriptWithExtraBindings.
struct ExtraBindingInfo {
  // UTF-8 encoded name of the binding.
  UniqueChars nameChars;

  TaggedParserAtomIndex nameIndex;

  // If the binding conflicts with global variable or global lexical variable,
  // the binding is shadowed.
  bool isShadowed = false;

  ExtraBindingInfo(UniqueChars&& nameChars, bool isShadowed)
      : nameChars(std::move(nameChars)), isShadowed(isShadowed) {}
};

using ExtraBindingInfoVector =
    js::Vector<ExtraBindingInfo, 0, js::SystemAllocPolicy>;

// Input of the compilation, including source and enclosing context.
struct CompilationInput {
  enum class CompilationTarget {
    Global,
    SelfHosting,
    StandaloneFunction,
    StandaloneFunctionInNonSyntacticScope,
    Eval,
    Module,
    Delazification,
  };
  CompilationTarget target = CompilationTarget::Global;

  const JS::ReadOnlyCompileOptions& options;

  CompilationAtomCache atomCache;

 private:
  InputScript lazy_ = InputScript(nullptr);

  // Extra bindings for the global script.
  ExtraBindingInfoVector* maybeExtraBindings_ = nullptr;

 public:
  RefPtr<ScriptSource> source;

  //  * If the target is Global, null.
  //  * If the target is SelfHosting, null. Instantiation code for self-hosting
  //    will ignore this and use the appropriate empty global scope instead.
  //  * If the target is StandaloneFunction, an empty global scope.
  //  * If the target is StandaloneFunctionInNonSyntacticScope, the non-null
  //    enclosing scope of the function
  //  * If the target is Eval, the non-null enclosing scope of the `eval`.
  //  * If the target is Module, null that means empty global scope
  //    (See EmitterScope::checkEnvironmentChainLength)
  //  * If the target is Delazification, the non-null enclosing scope of
  //    the function
  InputScope enclosingScope = InputScope(nullptr);

  explicit CompilationInput(const JS::ReadOnlyCompileOptions& options)
      : options(options) {}

 private:
  bool initScriptSource(FrontendContext* fc);

 public:
  bool initForGlobal(FrontendContext* fc) {
    target = CompilationTarget::Global;
    return initScriptSource(fc);
  }

  bool initForGlobalWithExtraBindings(
      FrontendContext* fc, ExtraBindingInfoVector* maybeExtraBindings) {
    MOZ_ASSERT(maybeExtraBindings);
    target = CompilationTarget::Global;
    maybeExtraBindings_ = maybeExtraBindings;
    return initScriptSource(fc);
  }

  bool initForSelfHostingGlobal(FrontendContext* fc) {
    target = CompilationTarget::SelfHosting;
    return initScriptSource(fc);
  }

  bool initForStandaloneFunction(JSContext* cx, FrontendContext* fc) {
    target = CompilationTarget::StandaloneFunction;
    if (!initScriptSource(fc)) {
      return false;
    }
    enclosingScope = InputScope(&cx->global()->emptyGlobalScope());
    return true;
  }

  bool initForStandaloneFunctionInNonSyntacticScope(
      FrontendContext* fc, JS::Handle<Scope*> functionEnclosingScope);

  bool initForEval(FrontendContext* fc, JS::Handle<Scope*> evalEnclosingScope) {
    target = CompilationTarget::Eval;
    if (!initScriptSource(fc)) {
      return false;
    }
    enclosingScope = InputScope(evalEnclosingScope);
    return true;
  }

  bool initForModule(FrontendContext* fc) {
    target = CompilationTarget::Module;
    if (!initScriptSource(fc)) {
      return false;
    }
    // The `enclosingScope` is the emptyGlobalScope.
    return true;
  }

  void initFromLazy(JSContext* cx, BaseScript* lazyScript, ScriptSource* ss) {
    MOZ_ASSERT(cx->compartment() == lazyScript->compartment());

    // We can only compile functions whose parents have previously been
    // compiled, because compilation requires full information about the
    // function's immediately enclosing scope.
    MOZ_ASSERT(lazyScript->isReadyForDelazification());
    target = CompilationTarget::Delazification;
    lazy_ = InputScript(lazyScript);
    source = ss;
    enclosingScope = lazy_.enclosingScope();
  }

  void initFromStencil(const InitialStencilAndDelazifications& stencils,
                       ScriptIndex scriptIndex, ScriptSource* ss) {
    target = CompilationTarget::Delazification;
    lazy_ = InputScript(stencils, scriptIndex);
    source = ss;
    enclosingScope = lazy_.enclosingScope();
  }

  // Returns true if enclosingScope field is provided to init* function,
  // instead of setting to empty global internally.
  bool hasNonDefaultEnclosingScope() const {
    return target == CompilationTarget::StandaloneFunctionInNonSyntacticScope ||
           target == CompilationTarget::Eval ||
           target == CompilationTarget::Delazification;
  }

  // Returns the enclosing scope provided to init* function.
  // nullptr otherwise.
  InputScope maybeNonDefaultEnclosingScope() const {
    if (hasNonDefaultEnclosingScope()) {
      return enclosingScope;
    }
    return InputScope(nullptr);
  }

  // The BaseScript* is needed when instantiating a lazy function.
  // See InstantiateTopLevel and FunctionsFromExistingLazy.
  InputScript lazyOuterScript() { return lazy_; }
  BaseScript* lazyOuterBaseScript() { return lazy_.raw().as<BaseScript*>(); }

  // The JSFunction* is needed when instantiating a lazy function.
  // See FunctionsFromExistingLazy.
  JSFunction* function() const {
    return lazy_.raw().as<BaseScript*>()->function();
  }

  // When compiling an inner function, we want to know the unique identifier
  // which identify a function. This is computed from the source extend.
  SourceExtent extent() const { return lazy_.extent(); }

  // See `BaseScript::immutableFlags_`.
  ImmutableScriptFlags immutableFlags() const { return lazy_.immutableFlags(); }

  RO_IMMUTABLE_SCRIPT_FLAGS(immutableFlags())

  FunctionFlags functionFlags() const { return lazy_.functionFlags(); }

  // When delazifying, return the kind of function which is defined.
  FunctionSyntaxKind functionSyntaxKind() const;

  bool hasPrivateScriptData() const {
    // This is equivalent to: ngcthings != 0 || useMemberInitializers()
    // See BaseScript::CreateRawLazy.
    return lazy_.hasPrivateScriptData();
  }

  // Whether this CompilationInput is parsing the top-level of a script, or
  // false if we are parsing an inner function.
  bool isInitialStencil() { return lazy_.isNull(); }

  // Whether this CompilationInput is parsing a specific function with already
  // pre-parsed contextual information.
  bool isDelazifying() { return target == CompilationTarget::Delazification; }

  bool hasExtraBindings() const { return !!maybeExtraBindings_; }
  ExtraBindingInfoVector& extraBindings() { return *maybeExtraBindings_; }
  const ExtraBindingInfoVector& extraBindings() const {
    return *maybeExtraBindings_;
  }
  bool internExtraBindings(FrontendContext* fc, ParserAtomsTable& parserAtoms);

  void trace(JSTracer* trc);

  // Size of dynamic data. Note that GC data is counted by GC and not here. We
  // also ignore ScriptSource which is a shared RefPtr.
  size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    return atomCache.sizeOfExcludingThis(mallocSizeOf);
  }
  size_t sizeOfIncludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    return mallocSizeOf(this) + sizeOfExcludingThis(mallocSizeOf);
  }

#if defined(DEBUG) || defined(JS_JITSPEW)
  void dump() const;
  void dump(js::JSONPrinter& json) const;
  void dumpFields(js::JSONPrinter& json) const;
#endif
};

// When compiling a function which was previously Syntaxly Parsed, we generated
// some information which made it possible to skip over some parsing phases,
// such as computing closed over bindings as well as parsing inner functions.
// This class contains all information which is generated by the SyntaxParse and
// reused in the FullParse.
class CompilationSyntaxParseCache {
  // When delazifying, we should prepare an array which contains all
  // stencil-like gc-things such that it can be used by the parser.
  //
  // When compiling from a Stencil, this will alias the existing Stencil.
  mozilla::Span<TaggedScriptThingIndex> cachedGCThings_;

  // When delazifying, we should perpare an array which contains all
  // stencil-like information about scripts, such that it can be used by the
  // parser.
  //
  // When compiling from a Stencil, these will alias the existing Stencil.
  mozilla::Span<ScriptStencil> cachedScriptData_;
  mozilla::Span<ScriptStencilExtra> cachedScriptExtra_;

  // When delazifying, we copy the atom, either from JSAtom, or from another
  // Stencil into TaggedParserAtomIndex which are valid in this current
  // CompilationState.
  mozilla::Span<TaggedParserAtomIndex> closedOverBindings_;

  // Atom of the function being compiled. This atom index is valid in the
  // current CompilationState.
  TaggedParserAtomIndex displayAtom_;

  // Stencil-like data about the function which is being compiled.
  ScriptStencilExtra funExtra_;

#ifdef DEBUG
  // Whether any of these data should be considered or not.
  bool isInitialized = false;
#endif

 public:
  // When doing a full-parse of an incomplete BaseScript*, we have to iterate
  // over functions and closed-over bindings, to avoid costly recursive decent
  // in inner functions. This function will clone the BaseScript* information to
  // make it available as a stencil-like data to the full-parser.
  mozilla::Span<TaggedParserAtomIndex> closedOverBindings() const {
    MOZ_ASSERT(isInitialized);
    return closedOverBindings_;
  }
  const ScriptStencil& scriptData(size_t functionIndex) const {
    return cachedScriptData_[scriptIndex(functionIndex)];
  }
  const ScriptStencilExtra& scriptExtra(size_t functionIndex) const {
    return cachedScriptExtra_[scriptIndex(functionIndex)];
  }

  // Return the name of the function being delazified, if any.
  TaggedParserAtomIndex displayAtom() const {
    MOZ_ASSERT(isInitialized);
    return displayAtom_;
  }

  // Return the extra information about the function being delazified, if any.
  const ScriptStencilExtra& funExtra() const {
    MOZ_ASSERT(isInitialized);
    return funExtra_;
  }

  // Initialize the SynaxParse cache given a LifoAlloc. The JSContext is only
  // used for reporting allocation errors.
  [[nodiscard]] bool init(FrontendContext* fc, LifoAlloc& alloc,
                          ParserAtomsTable& parseAtoms,
                          CompilationAtomCache& atomCache,
                          const InputScript& lazy);

 private:
  // Return the script index of a given inner function.
  //
  // WARNING: The ScriptIndex returned by this function corresponds to the index
  // in the cachedScriptExtra_ and cachedScriptData_ spans. With the
  // cachedGCThings_ span, these might be reference to an actual Stencil from
  // another compilation. Thus, the ScriptIndex returned by this function should
  // not be confused with any ScriptIndex from the CompilationState.
  ScriptIndex scriptIndex(size_t functionIndex) const {
    MOZ_ASSERT(isInitialized);
    auto taggedScriptIndex = cachedGCThings_[functionIndex];
    MOZ_ASSERT(taggedScriptIndex.isFunction());
    return taggedScriptIndex.toFunction();
  }

  [[nodiscard]] bool copyFunctionInfo(FrontendContext* fc,
                                      ParserAtomsTable& parseAtoms,
                                      CompilationAtomCache& atomCache,
                                      const InputScript& lazy);
  [[nodiscard]] bool copyScriptInfo(FrontendContext* fc, LifoAlloc& alloc,
                                    ParserAtomsTable& parseAtoms,
                                    CompilationAtomCache& atomCache,
                                    BaseScript* lazy);
  [[nodiscard]] bool copyScriptInfo(FrontendContext* fc, LifoAlloc& alloc,
                                    ParserAtomsTable& parseAtoms,
                                    CompilationAtomCache& atomCache,
                                    const ScriptStencilRef& lazy);
  [[nodiscard]] bool copyClosedOverBindings(FrontendContext* fc,
                                            LifoAlloc& alloc,
                                            ParserAtomsTable& parseAtoms,
                                            CompilationAtomCache& atomCache,
                                            BaseScript* lazy);
  [[nodiscard]] bool copyClosedOverBindings(FrontendContext* fc,
                                            LifoAlloc& alloc,
                                            ParserAtomsTable& parseAtoms,
                                            CompilationAtomCache& atomCache,
                                            const ScriptStencilRef& lazy);
};

// AsmJS scripts are very rare on-average, so we use a HashMap to associate
// data with a ScriptStencil. The ScriptStencil has a flag to indicate if we
// need to even do this lookup.
using StencilAsmJSMap =
    mozilla::HashMap<ScriptIndex, RefPtr<const JS::WasmModule>,
                     mozilla::DefaultHasher<ScriptIndex>,
                     js::SystemAllocPolicy>;

struct StencilAsmJSContainer
    : public js::AtomicRefCounted<StencilAsmJSContainer> {
  StencilAsmJSMap moduleMap;

  StencilAsmJSContainer() = default;

  size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    return moduleMap.shallowSizeOfExcludingThis(mallocSizeOf);
  }
  size_t sizeOfIncludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    return mallocSizeOf(this) + sizeOfExcludingThis(mallocSizeOf);
  }
};

// Store shared data for non-lazy script.
struct SharedDataContainer {
  // NOTE: While stored, we must hold a ref-count and care must be taken when
  //       updating or clearing the pointer.
  using SingleSharedDataPtr = SharedImmutableScriptData*;

  using SharedDataVector =
      Vector<RefPtr<js::SharedImmutableScriptData>, 0, js::SystemAllocPolicy>;
  using SharedDataVectorPtr = SharedDataVector*;

  using SharedDataMap =
      mozilla::HashMap<ScriptIndex, RefPtr<js::SharedImmutableScriptData>,
                       mozilla::DefaultHasher<ScriptIndex>,
                       js::SystemAllocPolicy>;
  using SharedDataMapPtr = SharedDataMap*;

 private:
  enum {
    SingleTag = 0,
    VectorTag = 1,
    MapTag = 2,
    BorrowTag = 3,

    TagMask = 3,
  };

  uintptr_t data_ = 0;

 public:
  // Defaults to SingleSharedData.
  SharedDataContainer() = default;

  SharedDataContainer(const SharedDataContainer&) = delete;
  SharedDataContainer(SharedDataContainer&& other) noexcept {
    std::swap(data_, other.data_);
    MOZ_ASSERT(other.isEmpty());
  }

  SharedDataContainer& operator=(const SharedDataContainer&) = delete;
  SharedDataContainer& operator=(SharedDataContainer&& other) noexcept {
    std::swap(data_, other.data_);
    MOZ_ASSERT(other.isEmpty());
    return *this;
  }

  ~SharedDataContainer();

  [[nodiscard]] bool initVector(FrontendContext* fc);
  [[nodiscard]] bool initMap(FrontendContext* fc);

 private:
  [[nodiscard]] bool convertFromSingleToMap(FrontendContext* fc);

 public:
  bool isEmpty() const { return (data_) == SingleTag; }
  bool isSingle() const { return (data_ & TagMask) == SingleTag; }
  bool isVector() const { return (data_ & TagMask) == VectorTag; }
  bool isMap() const { return (data_ & TagMask) == MapTag; }
  bool isBorrow() const { return (data_ & TagMask) == BorrowTag; }

  void setSingle(already_AddRefed<SharedImmutableScriptData>&& data) {
    MOZ_ASSERT(isEmpty());
    data_ = reinterpret_cast<uintptr_t>(data.take());
    MOZ_ASSERT(isSingle());
    MOZ_ASSERT(!isEmpty());
  }

  void setBorrow(SharedDataContainer* sharedData) {
    MOZ_ASSERT(isEmpty());
    data_ = reinterpret_cast<uintptr_t>(sharedData) | BorrowTag;
    MOZ_ASSERT(isBorrow());
  }

  SingleSharedDataPtr asSingle() const {
    MOZ_ASSERT(isSingle());
    MOZ_ASSERT(!isEmpty());
    static_assert(SingleTag == 0);
    return reinterpret_cast<SingleSharedDataPtr>(data_);
  }
  SharedDataVectorPtr asVector() const {
    MOZ_ASSERT(isVector());
    return reinterpret_cast<SharedDataVectorPtr>(data_ & ~TagMask);
  }
  SharedDataMapPtr asMap() const {
    MOZ_ASSERT(isMap());
    return reinterpret_cast<SharedDataMapPtr>(data_ & ~TagMask);
  }
  SharedDataContainer* asBorrow() const {
    MOZ_ASSERT(isBorrow());
    return reinterpret_cast<SharedDataContainer*>(data_ & ~TagMask);
  }

  [[nodiscard]] bool prepareStorageFor(FrontendContext* fc,
                                       size_t nonLazyScriptCount,
                                       size_t allScriptCount);
  [[nodiscard]] bool cloneFrom(FrontendContext* fc,
                               const SharedDataContainer& other);

  // Returns index-th script's shared data, or nullptr if it doesn't have.
  js::SharedImmutableScriptData* get(ScriptIndex index) const;

  // Add data for index-th script and share it with VM.
  [[nodiscard]] bool addAndShare(FrontendContext* fc, ScriptIndex index,
                                 js::SharedImmutableScriptData* data);

  // Add data for index-th script without sharing it with VM.
  // The data should already be shared with VM.
  //
  // The data is supposed to be added from delazification.
  [[nodiscard]] bool addExtraWithoutShare(FrontendContext* fc,
                                          ScriptIndex index,
                                          js::SharedImmutableScriptData* data);

  // Dynamic memory associated with this container. Does not include the
  // SharedImmutableScriptData since we are not the unique owner of it.
  size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    if (isVector()) {
      return asVector()->sizeOfIncludingThis(mallocSizeOf);
    }
    if (isMap()) {
      return asMap()->shallowSizeOfIncludingThis(mallocSizeOf);
    }
    MOZ_ASSERT(isSingle() || isBorrow());
    return 0;
  }

#if defined(DEBUG) || defined(JS_JITSPEW)
  void dump() const;
  void dump(js::JSONPrinter& json) const;
  void dumpFields(js::JSONPrinter& json) const;
#endif
};

struct ExtensibleCompilationStencil;

// The top level struct of stencil specialized for non-extensible case.
// Used as the compilation output, and also XDR decode output.
//
// In XDR decode output case, the span and not-owning pointer fields point
// the internal LifoAlloc and the external XDR buffer.
//
// In BorrowingCompilationStencil usage, span and not-owning pointer fields
// point the ExtensibleCompilationStencil and its LifoAlloc.
//
// The dependent XDR buffer or ExtensibleCompilationStencil must be kept
// alive manually.
//
// See SMDOC in Stencil.h for more info.
struct CompilationStencil {
  friend struct ExtensibleCompilationStencil;

  static constexpr ScriptIndex TopLevelIndex = ScriptIndex(0);

  static constexpr size_t LifoAllocChunkSize = 512;

  // The lifetime of this CompilationStencil may be managed by stack allocation,
  // UniquePtr<T>, or RefPtr<T>. If a RefPtr is used, this ref-count will track
  // the lifetime, otherwise it is ignored.
  //
  // NOTE: Internal code and public APIs use a mix of these different allocation
  //       modes.
  //
  // See: JS::StencilAddRef/Release
  mutable mozilla::Atomic<uintptr_t> refCount_{0};

 private:
  // On-heap ExtensibleCompilationStencil that this CompilationStencil owns,
  // and this CompilationStencil borrows each data from.
  UniquePtr<ExtensibleCompilationStencil> ownedBorrowStencil;

 public:
  enum class StorageType {
    // Pointers and spans point LifoAlloc or owned buffer.
    Owned,

    // Pointers and spans point external data, such as XDR buffer, or not-owned
    // ExtensibleCompilationStencil (see BorrowingCompilationStencil).
    Borrowed,

    // Pointers and spans point data owned by ownedBorrowStencil.
    OwnedExtensible,
  };
  StorageType storageType = StorageType::Owned;

  // Value of CanLazilyParse(CompilationInput) on compilation.
  // Used during instantiation, and also queried by
  // InitialStencilAndDelazifications.
  bool canLazilyParse = false;

  // If this stencil is a delazification, this identifies location of the
  // function in the source text.
  using FunctionKey = SourceExtent::FunctionKey;
  FunctionKey functionKey = SourceExtent::NullFunctionKey;

  // This holds allocations that do not require destructors to be run but are
  // live until the stencil is released.
  LifoAlloc alloc;

  // The source text holder for the script. This may be an empty placeholder if
  // the code will fully parsed and options indicate the source will never be
  // needed again.
  RefPtr<ScriptSource> source;

  // Stencil for all function and non-function scripts. The TopLevelIndex is
  // reserved for the top-level script. This top-level may or may not be a
  // function.
  mozilla::Span<ScriptStencil> scriptData;

  // Immutable data computed during initial compilation and never updated during
  // delazification.
  mozilla::Span<ScriptStencilExtra> scriptExtra;

  mozilla::Span<TaggedScriptThingIndex> gcThingData;

  // scopeData and scopeNames have the same size, and i-th scopeNames contains
  // the names for the bindings contained in the slot defined by i-th scopeData.
  mozilla::Span<ScopeStencil> scopeData;
  mozilla::Span<BaseParserScopeData*> scopeNames;

  // Hold onto the RegExpStencil, BigIntStencil, and ObjLiteralStencil that are
  // allocated during parse to ensure correct destruction.
  mozilla::Span<RegExpStencil> regExpData;
  mozilla::Span<BigIntStencil> bigIntData;
  mozilla::Span<ObjLiteralStencil> objLiteralData;

  // List of parser atoms for this compilation. This may contain nullptr entries
  // when round-tripping with XDR if the atom was generated in original parse
  // but not used by stencil.
  ParserAtomSpan parserAtomData;

  // Variable sized container for bytecode and other immutable data. A valid
  // stencil always contains at least an entry for `TopLevelIndex` script.
  SharedDataContainer sharedData;

  // Module metadata if this is a module compile.
  RefPtr<StencilModuleMetadata> moduleMetadata;

  // AsmJS modules generated by parsing. These scripts are never lazy and
  // therefore only generated during initial parse.
  RefPtr<StencilAsmJSContainer> asmJS;

  // End of fields.

  // Construct a CompilationStencil
  explicit CompilationStencil(ScriptSource* source)
      : alloc(LifoAllocChunkSize, js::BackgroundMallocArena), source(source) {}

  // Take the ownership of on-heap ExtensibleCompilationStencil and
  // borrow from it.
  explicit CompilationStencil(
      UniquePtr<ExtensibleCompilationStencil>&& extensibleStencil);

  void AddRef();
  void Release();

 protected:
  void borrowFromExtensibleCompilationStencil(
      ExtensibleCompilationStencil& extensibleStencil);

#ifdef DEBUG
  void assertBorrowingFromExtensibleCompilationStencil(
      const ExtensibleCompilationStencil& extensibleStencil) const;
#endif

 public:
  bool isInitialStencil() const {
    return functionKey == SourceExtent::NullFunctionKey;
  }

  [[nodiscard]] static bool instantiateStencilAfterPreparation(
      JSContext* cx, CompilationInput& input, const CompilationStencil& stencil,
      CompilationGCOutput& gcOutput);

  [[nodiscard]] static bool prepareForInstantiate(
      FrontendContext* fc, CompilationAtomCache& atomCache,
      const CompilationStencil& stencil, CompilationGCOutput& gcOutput);
  [[nodiscard]] static bool prepareForInstantiate(
      FrontendContext* fc, const CompilationStencil& stencil,
      PreallocatedCompilationGCOutput& gcOutput);

  [[nodiscard]] static bool instantiateStencils(
      JSContext* cx, CompilationInput& input, const CompilationStencil& stencil,
      CompilationGCOutput& gcOutput);

  // Decode the special self-hosted stencil
  [[nodiscard]] bool instantiateSelfHostedAtoms(
      JSContext* cx, AtomSet& atomSet, CompilationAtomCache& atomCache) const;
  [[nodiscard]] JSScript* instantiateSelfHostedTopLevelForRealm(
      JSContext* cx, CompilationInput& input);
  [[nodiscard]] JSFunction* instantiateSelfHostedLazyFunction(
      JSContext* cx, CompilationAtomCache& atomCache, ScriptIndex index,
      JS::Handle<JSAtom*> name);
  [[nodiscard]] bool delazifySelfHostedFunction(JSContext* cx,
                                                CompilationAtomCache& atomCache,
                                                ScriptIndexRange range,
                                                Handle<JSAtom*> name,
                                                JS::Handle<JSFunction*> fun);

  // To avoid any misuses, make sure this is neither copyable or assignable.
  CompilationStencil(const CompilationStencil&) = delete;
  CompilationStencil(CompilationStencil&&) = delete;
  CompilationStencil& operator=(const CompilationStencil&) = delete;
  CompilationStencil& operator=(CompilationStencil&&) = delete;
#ifdef DEBUG
  ~CompilationStencil() {
    // We can mix UniquePtr<..> and RefPtr<..>. This asserts that a UniquePtr
    // does not delete a reference-counted stencil.
    MOZ_ASSERT(!refCount_);
  }
#endif

  static inline ScriptStencilIterable functionScriptStencils(
      const CompilationStencil& stencil, CompilationGCOutput& gcOutput);

  void setFunctionKey(BaseScript* lazy) {
    functionKey = lazy->extent().toFunctionKey();
  }

  inline size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const;
  size_t sizeOfIncludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    return mallocSizeOf(this) + sizeOfExcludingThis(mallocSizeOf);
  }

  const ParserAtomSpan& parserAtomsSpan() const { return parserAtomData; }

  bool isModule() const;

  bool hasAsmJS() const;

  bool hasMultipleReference() const { return refCount_ > 1; }

  bool hasOwnedBorrow() const {
    return storageType == StorageType::OwnedExtensible;
  }

  ExtensibleCompilationStencil* takeOwnedBorrow() {
    MOZ_ASSERT(!hasMultipleReference());
    MOZ_ASSERT(hasOwnedBorrow());
    return ownedBorrowStencil.release();
  }

#ifdef DEBUG
  void assertNoExternalDependency() const;
#endif

#if defined(DEBUG) || defined(JS_JITSPEW)
  void dump() const;
  void dump(js::JSONPrinter& json) const;
  void dumpFields(js::JSONPrinter& json) const;

  void dumpAtom(TaggedParserAtomIndex index) const;
#endif
};

// A Map from a function key to the ScriptIndex in the initial stencil.
class FunctionKeyToScriptIndexMap {
  using FunctionKey = SourceExtent::FunctionKey;
  mozilla::HashMap<FunctionKey, ScriptIndex,
                   mozilla::DefaultHasher<FunctionKey>, js::SystemAllocPolicy>
      map_;

  template <typename T>
  [[nodiscard]] bool init(FrontendContext* fc, const T& scriptExtra,
                          size_t scriptExtraSize);

 public:
  FunctionKeyToScriptIndexMap() = default;

  [[nodiscard]] bool init(FrontendContext* fc,
                          const CompilationStencil* initial);
  [[nodiscard]] bool init(FrontendContext* fc,
                          const ExtensibleCompilationStencil* initial);

  mozilla::Maybe<ScriptIndex> get(FunctionKey key) const;

  size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const;
  size_t sizeOfIncludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    return mallocSizeOf(this) + sizeOfExcludingThis(mallocSizeOf);
  }
};

// This structure represents a function script inside a function, using a pair
// of indices which points to the enclosing script and the possibly-local index
// inside the enclosing compilation stencil.
//
// The `enclosingIndexInInitial` represents both the function script index in
// `InitialStencilAndDelazifications::initial_` and the stencil index within
// `InitialStencilAndDelazifications::delazifications_`, unless it is 0, in
// which case it corresponds to the initial stencil.
//
// The `indexInEnclosing` represents the script index in the compilation stencil
// in which the enclosing script would be fully parsed, indexed by
// `enclosingIndexInInitial`, which can either be the initial stencil or a
// delazification stencil.
//
// This structure absorbs the `InitialStencilAndDelazifications` splitted
// representation of having multiple `CompilationStencil`. Among the differences
// we can note the followings special case:
//
// (a) When `enclosingIndexInInitial` points a function which is eagerly
//   compiled in the initial compilation, then the `indexInEnclosing` is also an
//   index in the initial compilation, which points an inner function inside the
//   enclosing function. Thus, `indexInEnclosing > enclosingIndexInInitial`.
//
// (b) When `enclosingIndexInInitial` points a function which is syntax-parsed
//   in the initial compilation, then the `indexInEnclosing` is an index in a
//   delazification compilation. Given that the index 0-th of a delazification
//   compilation is the delazified script. Thus, `indexInEnclosing > 0`, which
//   points an inner function inside the enclosing function.
//
// At the intersection of both cases, the followings should be held:
//
// - `indexInEnclosing != 0`: it cannot point neither of the top-level script,
// or
//   the enclosing function script itself.
struct ScriptIndexes {
  // Index of an enclosing function script within the initial
  // CompilationStencil. This is used also to retrieve the initial stencil or
  // delazification stencil from `InitialStencilAndDelazifications`.
  ScriptIndex enclosingIndexInInitial;

  // Index of a function script within the enclosing `CompilationStencil`. The
  // enclosing `CompilationStencil` contains the fully-parsed content for the
  // `enclosingIndexInInitial` function script. It can either be the initial
  // compilation stencil or the delazitication.
  ScriptIndex indexInEnclosing;
};

struct RelativeIndexes {
  // Number of tasks which are making use of the indexes_ vector.
  ExclusiveData<size_t> consumers_;

  // The consumers_ lock must be held and should have at most a single consumer
  // to write to this value. In the spirit, this should be an RWExclusiveData
  // using the same lock as the consumers_, except that we do not want to hold
  // the lock when we are in a section where the consumer value is positive.
  Vector<ScriptIndexes, 0, js::SystemAllocPolicy> indexes_;

  RelativeIndexes() : consumers_(mutexid::StencilCache), indexes_() {}

  ScriptIndexes& operator[](size_t i) { return indexes_[i]; }
  const ScriptIndexes& operator[](size_t i) const { return indexes_[i]; }
};

// A class to Associate the initial stencil and the delazifications.
//
// This struct is initialized with the initial stencil, with an empty set of
// delazifications.
// The delazifications_ vector is fixed-size, pre-allocated for each script
// stencil, excluding the top-level script.
//
// The delazifications_ vector elements are initialized with nullptr, and
// monotonically populated with each delazification result.
// Only the first delazification for the given function is used.
//
// This struct is supposed to be read/write from multiple threads, and all
// operations, except init, are thread-safe.
struct InitialStencilAndDelazifications {
 private:
  using FunctionKey = SourceExtent::FunctionKey;

  // Shared reference to the initial stencil.
  RefPtr<const CompilationStencil> initial_;

  // Exclusively owning pointers for delazifications.
  //
  // The i-th element is for ScriptIndex(i-1).
  //
  // If the initial stencil is known to be fully-parsed, this vector is
  // 0-sized and unused.
  Vector<mozilla::Atomic<CompilationStencil*>, 0, js::SystemAllocPolicy>
      delazifications_;

  // A Map from a function key to the ScriptIndex in the initial stencil.
  //
  // If the initial stencil is known to be fully-parsed, this map is
  // uninitialized and unused
  FunctionKeyToScriptIndexMap functionKeyToInitialScriptIndex_;

  // Map an initial scriptIndex to its enclosing initial scriptIndex as well as
  // its scriptIndex within the enclosing script stencil.
  //
  // This structure caches information which is only available after some
  // computation in a stencil.
  //
  // For example, the following script:
  // ```js
  // function f1() {
  //   function f2() {
  //     function f3() {}
  //     function f4() {}
  //   }
  //   function f5() {}
  // }
  // ```
  //
  // Would yield a vector such as:
  //
  // relativeIndexes_ = {
  //   /* f1 */ { enclosingIndexInInitial: 0, indexInEnclosing: 1 },
  //   /* f2 */ { enclosingIndexInInitial: 1, indexInEnclosing: 1 },
  //   /* f3 */ { enclosingIndexInInitial: 2, indexInEnclosing: 1 },
  //   /* f4 */ { enclosingIndexInInitial: 2, indexInEnclosing: 2 },
  //   /* f5 */ { enclosingIndexInInitial: 1, indexInEnclosing: 2 },
  // }
  //
  RelativeIndexes relativeIndexes_;

  mutable mozilla::Atomic<uintptr_t> refCount_{0};

 public:
  class RelativeIndexesGuard {
    friend struct InitialStencilAndDelazifications;
    RefPtr<InitialStencilAndDelazifications> stencils_;

    explicit RelativeIndexesGuard(InitialStencilAndDelazifications* stencils)
        : stencils_(stencils) {}

   public:
    RelativeIndexesGuard() : stencils_(nullptr) {}

    RelativeIndexesGuard(RelativeIndexesGuard&& src)
        : stencils_(std::move(src.stencils_)) {}

    ~RelativeIndexesGuard() {
      if (stencils_) {
        stencils_->decrementRelativeIndexesConsumer();
        stencils_ = nullptr;
      }
    };
    explicit operator bool() { return bool(stencils_); }
  };

 private:
  // Initialize relative indexes based on the initial's gcThings.
  void decrementRelativeIndexesConsumer();
  friend class RelativeIndexesGuard;

 public:
  InitialStencilAndDelazifications() = default;
  ~InitialStencilAndDelazifications();

  void AddRef();
  void Release();

  [[nodiscard]] bool init(FrontendContext* fc,
                          const CompilationStencil* initial);

  [[nodiscard]] RelativeIndexesGuard ensureRelativeIndexes(FrontendContext* fc);

  // Get the initial stencil.
  // As long as this instance is initialized, this returns non-null pointer.
  const CompilationStencil* getInitial() const;

  // Returns true if the initial stencil is compiled with
  // CanLazilyParse(CompilationInput).
  //
  // If this returns false:
  //   * the delazifications_ vector is not allocated
  //   * the functionKeyToInitialScriptIndex_ is not initialized
  //   * getDelazificationAt and storeDelazification shouldn't be called
  //   * getMerged shouldn't be called, and getInitial should be used instead
  bool canLazilyParse() const { return initial_->canLazilyParse; }

  // Return the delazification stencil if it's already populated.
  // Returns nullptr otherwise.
  //
  // The functionIndex parameter is the index of the corresponding script
  // stencil (0-indexed, with the index 0 being the top-level script).
  //
  // if the extent is used instead, it calculates functionIndex and returns
  // the delazification stencil if the functionIndex is found and it's already
  // populated.
  // Returns nullptr otherwise.
  const CompilationStencil* getDelazificationAt(size_t functionIndex) const;
  const CompilationStencil* getDelazificationFor(
      const SourceExtent& extent) const;

  // Return the ScriptIndex of a delazification stencil in the initial stencil.
  // This index is retrieved using the SourceExtent.
  ScriptIndex getScriptIndexFor(const CompilationStencil* delazification) const;

  // Return the script indexes to find the enclosing function script's index in
  // the initial stencil as well as the ScriptIndex within the enclosing
  // stencil.
  const ScriptIndexes& getRelativeIndexesAt(ScriptIndex initialIndex) const;

  // Return the initial scriptIndex corresponding to the `enclosedInEnclosing`
  // scriptIndex in the `CompilationStencil` indexed by `enclosingInInitial` in
  // the `InitialStencilAndDelazifications`.
  //
  // Special cases:
  //
  // - For zero-values of `enclosedInEnclosing`, then the `enclosedInEnclosing`
  //   index points at the first script of the `CompilationStencil` indexed by
  //   `enclosingInInitial`. The 0-th script of any `CompilationStencil` is the
  //   top-level or the function it-self. Thus `enclosingInInitial` is returned.
  //
  // - For cases where the script indexed by `enclosingInInitial` is compiled in
  //   the initial stencil, then the index `enclosedInEnclosing` is already a
  //   ScriptIndex in the initial CompilationStencil. Thus this function simply
  //   return `enclosedInEnclosing`.
  //
  // Note:
  //
  // For non-zero values of `enclosedInEnclosing`, this function behaves as the
  // reverse mapping of `getRelativeIndexesAt`.
  ScriptIndex getInitialIndexFor(ScriptIndex enclosingInInitial,
                                 ScriptIndex enclosedInEnclosing) const;

  // Try storing the delazification stencil.
  //
  // The `delazification` stencil should have only one ref count.
  //
  // If the function was not yet delazified and populated, the `delazification`
  // is stored into the vector and the ownership is transferred to the vector,
  // and the same `delazification`'s pointer is returned.
  //
  // If the function was already delazified and stored, the passed
  // `delazification` is discared, and the already delazified stencil's pointer
  // is returned.
  //
  // This function is infallible and never returns nullptr.
  const CompilationStencil* storeDelazification(
      RefPtr<CompilationStencil>&& delazification);

  // Create single CompilationStencil that reflects the initial stencil
  // and the all delazifications.
  //
  // Returns nullptr if any error happens, and sets exception on the
  // FrontendContext.
  CompilationStencil* getMerged(FrontendContext* fc) const;

  bool hasAsmJS() const;

  // Instantiate the initial stencil and all delazifications populated so far.
  [[nodiscard]] static bool instantiateStencils(
      JSContext* cx, CompilationInput& input,
      InitialStencilAndDelazifications& stencils,
      CompilationGCOutput& gcOutput);

  size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const;
  size_t sizeOfIncludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    return mallocSizeOf(this) + sizeOfExcludingThis(mallocSizeOf);
  }

#if defined(DEBUG) || defined(JS_JITSPEW)
  void dump() const;
  void dump(js::JSONPrinter& json) const;
  void dumpFields(js::JSONPrinter& json) const;
#endif
};

// The top level struct of stencil specialized for extensible case.
// Used as the temporary storage during compilation, an the compilation output.
//
// All not-owning pointer fields point the internal LifoAlloc.
//
// See CompilationStencil for each field's description.
//
// Also see SMDOC in Stencil.h for more info.
struct ExtensibleCompilationStencil {
  bool canLazilyParse = false;

  using FunctionKey = SourceExtent::FunctionKey;

  FunctionKey functionKey = SourceExtent::NullFunctionKey;

  // Data pointed by other fields are allocated in this LifoAlloc,
  // and moved to `CompilationStencil.alloc`.
  LifoAlloc alloc;

  RefPtr<ScriptSource> source;

  // NOTE: We reserve a modest amount of inline storage in order to reduce
  //       allocations in the most common delazification cases. These common
  //       cases have one script and scope, as well as a handful of gcthings.
  //       For complex pages this covers about 75% of delazifications.

  Vector<ScriptStencil, 1, js::SystemAllocPolicy> scriptData;
  Vector<ScriptStencilExtra, 0, js::SystemAllocPolicy> scriptExtra;

  Vector<TaggedScriptThingIndex, 8, js::SystemAllocPolicy> gcThingData;

  Vector<ScopeStencil, 1, js::SystemAllocPolicy> scopeData;
  Vector<BaseParserScopeData*, 1, js::SystemAllocPolicy> scopeNames;

  Vector<RegExpStencil, 0, js::SystemAllocPolicy> regExpData;
  BigIntStencilVector bigIntData;
  Vector<ObjLiteralStencil, 0, js::SystemAllocPolicy> objLiteralData;

  // Table of parser atoms for this compilation.
  ParserAtomsTable parserAtoms;

  SharedDataContainer sharedData;

  RefPtr<StencilModuleMetadata> moduleMetadata;

  RefPtr<StencilAsmJSContainer> asmJS;

  explicit ExtensibleCompilationStencil(ScriptSource* source);

  explicit ExtensibleCompilationStencil(CompilationInput& input);
  ExtensibleCompilationStencil(const JS::ReadOnlyCompileOptions& options,
                               RefPtr<ScriptSource> source);

  ExtensibleCompilationStencil(ExtensibleCompilationStencil&& other) noexcept
      : canLazilyParse(other.canLazilyParse),
        functionKey(other.functionKey),
        alloc(CompilationStencil::LifoAllocChunkSize,
              js::BackgroundMallocArena),
        source(std::move(other.source)),
        scriptData(std::move(other.scriptData)),
        scriptExtra(std::move(other.scriptExtra)),
        gcThingData(std::move(other.gcThingData)),
        scopeData(std::move(other.scopeData)),
        scopeNames(std::move(other.scopeNames)),
        regExpData(std::move(other.regExpData)),
        bigIntData(std::move(other.bigIntData)),
        objLiteralData(std::move(other.objLiteralData)),
        parserAtoms(std::move(other.parserAtoms)),
        sharedData(std::move(other.sharedData)),
        moduleMetadata(std::move(other.moduleMetadata)),
        asmJS(std::move(other.asmJS)) {
    alloc.steal(&other.alloc);
    parserAtoms.fixupAlloc(alloc);
  }

  ExtensibleCompilationStencil& operator=(
      ExtensibleCompilationStencil&& other) noexcept {
    MOZ_ASSERT(alloc.isEmpty());

    canLazilyParse = other.canLazilyParse;
    functionKey = other.functionKey;
    source = std::move(other.source);
    scriptData = std::move(other.scriptData);
    scriptExtra = std::move(other.scriptExtra);
    gcThingData = std::move(other.gcThingData);
    scopeData = std::move(other.scopeData);
    scopeNames = std::move(other.scopeNames);
    regExpData = std::move(other.regExpData);
    bigIntData = std::move(other.bigIntData);
    objLiteralData = std::move(other.objLiteralData);
    parserAtoms = std::move(other.parserAtoms);
    sharedData = std::move(other.sharedData);
    moduleMetadata = std::move(other.moduleMetadata);
    asmJS = std::move(other.asmJS);

    alloc.steal(&other.alloc);
    parserAtoms.fixupAlloc(alloc);

    return *this;
  }

  void setFunctionKey(const SourceExtent& extent) {
    functionKey = extent.toFunctionKey();
  }

  bool isInitialStencil() const {
    return functionKey == SourceExtent::NullFunctionKey;
  }

  // Steal CompilationStencil content.
  [[nodiscard]] bool steal(FrontendContext* fc,
                           RefPtr<CompilationStencil>&& other);

  // Clone ExtensibleCompilationStencil content.
  [[nodiscard]] bool cloneFrom(FrontendContext* fc,
                               const CompilationStencil& other);
  [[nodiscard]] bool cloneFrom(FrontendContext* fc,
                               const ExtensibleCompilationStencil& other);

 private:
  template <typename Stencil>
  [[nodiscard]] bool cloneFromImpl(FrontendContext* fc, const Stencil& other);

 public:
  const ParserAtomVector& parserAtomsSpan() const {
    return parserAtoms.entries();
  }

  bool isModule() const;

  bool hasAsmJS() const;

  inline size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const;
  size_t sizeOfIncludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    return mallocSizeOf(this) + sizeOfExcludingThis(mallocSizeOf);
  }

#ifdef DEBUG
  void assertNoExternalDependency() const;
#endif

#if defined(DEBUG) || defined(JS_JITSPEW)
  void dump();
  void dump(js::JSONPrinter& json);
  void dumpFields(js::JSONPrinter& json);

  void dumpAtom(TaggedParserAtomIndex index);
#endif
};

// The internal state of the compilation.
struct MOZ_RAII CompilationState : public ExtensibleCompilationStencil {
  Directives directives;

  ScopeContext scopeContext;

  UsedNameTracker usedNames;

  // LifoAlloc scope used by Parser for allocating AST etc.
  //
  // NOTE: This is not used for ExtensibleCompilationStencil.alloc.
  LifoAllocScope& parserAllocScope;

  CompilationInput& input;
  CompilationSyntaxParseCache previousParseCache;

  // The number of functions that *will* have bytecode.
  // This doesn't count top-level non-function script.
  //
  // This should be counted while parsing, and should be passed to
  // SharedDataContainer.prepareStorageFor *before* start emitting bytecode.
  size_t nonLazyFunctionCount = 0;

  // End of fields.

  CompilationState(FrontendContext* fc, LifoAllocScope& parserAllocScope,
                   CompilationInput& input);

  bool init(FrontendContext* fc, ScopeBindingCache* scopeCache,
            InheritThis inheritThis = InheritThis::No,
            JSObject* enclosingEnv = nullptr) {
    if (!scopeContext.init(fc, input, parserAtoms, scopeCache, inheritThis,
                           enclosingEnv)) {
      return false;
    }

    // gcThings is later used by the full parser initialization.
    if (input.isDelazifying()) {
      InputScript lazy = input.lazyOuterScript();
      auto& atomCache = input.atomCache;
      if (!previousParseCache.init(fc, alloc, parserAtoms, atomCache, lazy)) {
        return false;
      }
    }

    return true;
  }

  // Track the state of key allocations and roll them back as parts of parsing
  // get retried. This ensures iteration during stencil instantiation does not
  // encounter discarded frontend state.
  struct CompilationStatePosition {
    // Temporarily share this token struct with CompilationState.
    size_t scriptDataLength = 0;

    size_t asmJSCount = 0;
  };

  bool prepareSharedDataStorage(FrontendContext* fc);

  CompilationStatePosition getPosition();
  void rewind(const CompilationStatePosition& pos);

  // When parsing arrow function, parameter is parsed twice, and if there are
  // functions inside parameter expression, stencils will be created for them.
  //
  // Those functions exist only for lazy parsing.
  // Mark them "ghost", so that they don't affect other parts.
  //
  // See GHOST_FUNCTION in FunctionFlags.h for more details.
  void markGhost(const CompilationStatePosition& pos);

  // Allocate space for `length` gcthings, and return the address of the
  // first element to `cursor` to initialize on the caller.
  bool allocateGCThingsUninitialized(FrontendContext* fc,
                                     ScriptIndex scriptIndex, size_t length,
                                     TaggedScriptThingIndex** cursor);

  bool appendScriptStencilAndData(FrontendContext* fc);

  bool appendGCThings(FrontendContext* fc, ScriptIndex scriptIndex,
                      mozilla::Span<const TaggedScriptThingIndex> things);
};

// A temporary CompilationStencil instance that borrows
// ExtensibleCompilationStencil data.
// Ensure that this instance does not outlive the ExtensibleCompilationStencil.
class MOZ_STACK_CLASS BorrowingCompilationStencil : public CompilationStencil {
 public:
  explicit BorrowingCompilationStencil(
      ExtensibleCompilationStencil& extensibleStencil);
};

// Size of dynamic data. Ignores Spans (unless their contents are in the
// LifoAlloc) and RefPtrs since we are not the unique owner.
inline size_t CompilationStencil::sizeOfExcludingThis(
    mozilla::MallocSizeOf mallocSizeOf) const {
  if (ownedBorrowStencil) {
    return ownedBorrowStencil->sizeOfIncludingThis(mallocSizeOf);
  }

  size_t moduleMetadataSize =
      moduleMetadata ? moduleMetadata->sizeOfIncludingThis(mallocSizeOf) : 0;
  size_t asmJSSize = asmJS ? asmJS->sizeOfIncludingThis(mallocSizeOf) : 0;

  return alloc.sizeOfExcludingThis(mallocSizeOf) +
         sharedData.sizeOfExcludingThis(mallocSizeOf) + moduleMetadataSize +
         asmJSSize;
}

inline size_t ExtensibleCompilationStencil::sizeOfExcludingThis(
    mozilla::MallocSizeOf mallocSizeOf) const {
  size_t moduleMetadataSize =
      moduleMetadata ? moduleMetadata->sizeOfIncludingThis(mallocSizeOf) : 0;
  size_t asmJSSize = asmJS ? asmJS->sizeOfIncludingThis(mallocSizeOf) : 0;

  return alloc.sizeOfExcludingThis(mallocSizeOf) +
         scriptData.sizeOfExcludingThis(mallocSizeOf) +
         scriptExtra.sizeOfExcludingThis(mallocSizeOf) +
         gcThingData.sizeOfExcludingThis(mallocSizeOf) +
         scopeData.sizeOfExcludingThis(mallocSizeOf) +
         scopeNames.sizeOfExcludingThis(mallocSizeOf) +
         regExpData.sizeOfExcludingThis(mallocSizeOf) +
         bigIntData.sizeOfExcludingThis(mallocSizeOf) +
         objLiteralData.sizeOfExcludingThis(mallocSizeOf) +
         parserAtoms.sizeOfExcludingThis(mallocSizeOf) +
         sharedData.sizeOfExcludingThis(mallocSizeOf) + moduleMetadataSize +
         asmJSSize;
}

// A PreAllocateableGCArray is an array of GC thing pointers.
//
// The array's internal buffer can be allocated ahead of time, possibly off
// main thread.
template <typename T>
struct PreAllocateableGCArray {
 private:
  size_t length_ = 0;

  // Inline element for the case when length_ == 1.
  T inlineElem_;

  // Heap-allocated elements for the case when length_ > 1;
  T* elems_ = nullptr;

 public:
  struct Preallocated {
   private:
    size_t length_ = 0;
    uintptr_t* elems_ = nullptr;

    friend struct PreAllocateableGCArray<T>;

   public:
    Preallocated() = default;
    ~Preallocated();

    bool empty() const { return length_ == 0; }

    size_t length() const { return length_; }

   private:
    bool isInline() const { return length_ == 1; }

   public:
    bool allocate(size_t length);

    size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
      return sizeof(uintptr_t) * length_;
    }
  };

  PreAllocateableGCArray() {
    static_assert(std::is_pointer_v<T>,
                  "PreAllocateableGCArray element must be a pointer");
  }
  ~PreAllocateableGCArray();

  bool empty() const { return length_ == 0; }

  size_t length() const { return length_; }

 private:
  bool isInline() const { return length_ == 1; }

 public:
  bool allocate(size_t length);
  bool allocateWith(T init, size_t length);

  // Steal pre-allocated buffer.
  void steal(Preallocated&& buffer);

  T& operator[](size_t index) {
    MOZ_ASSERT(index < length_);

    if (isInline()) {
      return inlineElem_;
    }

    return elems_[index];
  }
  const T& operator[](size_t index) const {
    MOZ_ASSERT(index < length_);

    if (isInline()) {
      return inlineElem_;
    }

    return elems_[index];
  }

  size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    if (!elems_) {
      return 0;
    }

    return sizeof(T) * length_;
  }

  void trace(JSTracer* trc);
};

struct CompilationGCOutput;

// Pre-allocated storage for CompilationGCOutput.
struct PreallocatedCompilationGCOutput {
 private:
  PreAllocateableGCArray<JSFunction*>::Preallocated functions;
  PreAllocateableGCArray<js::Scope*>::Preallocated scopes;

  friend struct CompilationGCOutput;

 public:
  PreallocatedCompilationGCOutput() = default;

  [[nodiscard]] bool allocate(FrontendContext* fc, size_t scriptDataLength,
                              size_t scopeDataLength) {
    if (!functions.allocate(scriptDataLength)) {
      ReportOutOfMemory(fc);
      return false;
    }
    if (!scopes.allocate(scopeDataLength)) {
      ReportOutOfMemory(fc);
      return false;
    }
    return true;
  }

  size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    return functions.sizeOfExcludingThis(mallocSizeOf) +
           scopes.sizeOfExcludingThis(mallocSizeOf);
  }
};

// The output of GC allocation from stencil.
struct CompilationGCOutput {
  // The resulting outermost script for the compilation powered
  // by this CompilationStencil.
  JSScript* script = nullptr;

  // The resulting module object if there is one.
  ModuleObject* module = nullptr;

  // An array to handle tracing of JSFunction* and Atoms within.
  //
  // If the top level script isn't a function, the item at TopLevelIndex is
  // nullptr.
  PreAllocateableGCArray<JSFunction*> functions;

  // References to scopes are controlled via AbstractScopePtr, which holds onto
  // an index (and CompilationStencil reference).
  PreAllocateableGCArray<js::Scope*> scopes;

  // The result ScriptSourceObject. This is unused in delazifying parses.
  ScriptSourceObject* sourceObject = nullptr;

 private:
  // If we are only instantiating part of a stencil, we can reduce allocations
  // by setting a base index and allocating only the array elements we need.
  // This applies to both the `functions` and `scopes` arrays. These fields are
  // initialized by `ensureAllocatedWithBaseIndex` which also allocates the
  // array appropriately.
  //
  // Note: These are only used for self-hosted delazification currently.
  ScriptIndex functionsBaseIndex{};
  ScopeIndex scopesBaseIndex{};

  // End of fields.

 public:
  CompilationGCOutput() = default;

  // Helper to access the `functions` array. The NoBaseIndex version is used if
  // the caller never uses a base index.
  JSFunction*& getFunction(ScriptIndex index) {
    return functions[index - functionsBaseIndex];
  }
  JSFunction*& getFunctionNoBaseIndex(ScriptIndex index) {
    MOZ_ASSERT(!functionsBaseIndex);
    return functions[index];
  }

  // Helper accessors for the `scopes` array.
  js::Scope*& getScope(ScopeIndex index) {
    return scopes[index - scopesBaseIndex];
  }
  js::Scope*& getScopeNoBaseIndex(ScopeIndex index) {
    MOZ_ASSERT(!scopesBaseIndex);
    return scopes[index];
  }
  js::Scope* getScopeNoBaseIndex(ScopeIndex index) const {
    MOZ_ASSERT(!scopesBaseIndex);
    return scopes[index];
  }

  // Allocate output arrays.
  [[nodiscard]] bool ensureAllocated(FrontendContext* fc,
                                     size_t scriptDataLength,
                                     size_t scopeDataLength) {
    if (functions.empty()) {
      if (!functions.allocate(scriptDataLength)) {
        ReportOutOfMemory(fc);
        return false;
      }
    }
    if (scopes.empty()) {
      if (!scopes.allocate(scopeDataLength)) {
        ReportOutOfMemory(fc);
        return false;
      }
    }
    return true;
  }

  // Steal output arrays' buffer.
  void steal(PreallocatedCompilationGCOutput&& pre) {
    functions.steal(std::move(pre.functions));
    scopes.steal(std::move(pre.scopes));
  }

  // A variant of `ensureAllocated` that sets a base index for the function and
  // scope arrays. This is used when instantiating only a subset of the stencil.
  // Currently this only applies to self-hosted delazification. The ranges
  // include the start index and exclude the limit index.
  [[nodiscard]] bool ensureAllocatedWithBaseIndex(FrontendContext* fc,
                                                  ScriptIndex scriptStart,
                                                  ScriptIndex scriptLimit,
                                                  ScopeIndex scopeStart,
                                                  ScopeIndex scopeLimit) {
    this->functionsBaseIndex = scriptStart;
    this->scopesBaseIndex = scopeStart;

    return ensureAllocated(fc, scriptLimit - scriptStart,
                           scopeLimit - scopeStart);
  }

  // Size of dynamic data. Note that GC data is counted by GC and not here.
  size_t sizeOfExcludingThis(mozilla::MallocSizeOf mallocSizeOf) const {
    return functions.sizeOfExcludingThis(mallocSizeOf) +
           scopes.sizeOfExcludingThis(mallocSizeOf);
  }

  void trace(JSTracer* trc);
};

// Iterator over functions that make up a CompilationStencil. This abstracts
// over the parallel arrays in stencil and gc-output that use the same index
// system.
class ScriptStencilIterable {
 public:
  class ScriptAndFunction {
   public:
    const ScriptStencil& script;
    const ScriptStencilExtra* scriptExtra;
    JSFunction* function;
    ScriptIndex index;

    ScriptAndFunction() = delete;
    ScriptAndFunction(const ScriptStencil& script,
                      const ScriptStencilExtra* scriptExtra,
                      JSFunction* function, ScriptIndex index)
        : script(script),
          scriptExtra(scriptExtra),
          function(function),
          index(index) {}
  };

  class Iterator {
    size_t index_ = 0;
    const CompilationStencil& stencil_;
    CompilationGCOutput& gcOutput_;

    Iterator(const CompilationStencil& stencil, CompilationGCOutput& gcOutput,
             size_t index)
        : index_(index), stencil_(stencil), gcOutput_(gcOutput) {
      MOZ_ASSERT(index == stencil.scriptData.size());
    }

   public:
    explicit Iterator(const CompilationStencil& stencil,
                      CompilationGCOutput& gcOutput)
        : stencil_(stencil), gcOutput_(gcOutput) {
      skipTopLevelNonFunction();
    }

    Iterator operator++() {
      next();
      assertFunction();
      return *this;
    }

    void next() {
      MOZ_ASSERT(index_ < stencil_.scriptData.size());
      index_++;
    }

    void assertFunction() {
      if (index_ < stencil_.scriptData.size()) {
        MOZ_ASSERT(stencil_.scriptData[index_].isFunction());
      }
    }

    void skipTopLevelNonFunction() {
      MOZ_ASSERT(index_ == 0);
      if (stencil_.scriptData.size()) {
        if (!stencil_.scriptData[0].isFunction()) {
          next();
          assertFunction();
        }
      }
    }

    bool operator!=(const Iterator& other) const {
      return index_ != other.index_;
    }

    ScriptAndFunction operator*() {
      ScriptIndex index = ScriptIndex(index_);
      const ScriptStencil& script = stencil_.scriptData[index];
      const ScriptStencilExtra* scriptExtra = nullptr;
      if (stencil_.isInitialStencil()) {
        scriptExtra = &stencil_.scriptExtra[index];
      }
      return ScriptAndFunction(script, scriptExtra,
                               gcOutput_.getFunctionNoBaseIndex(index), index);
    }

    static Iterator end(const CompilationStencil& stencil,
                        CompilationGCOutput& gcOutput) {
      return Iterator(stencil, gcOutput, stencil.scriptData.size());
    }
  };

  const CompilationStencil& stencil_;
  CompilationGCOutput& gcOutput_;

  explicit ScriptStencilIterable(const CompilationStencil& stencil,
                                 CompilationGCOutput& gcOutput)
      : stencil_(stencil), gcOutput_(gcOutput) {}

  Iterator begin() const { return Iterator(stencil_, gcOutput_); }

  Iterator end() const { return Iterator::end(stencil_, gcOutput_); }
};

inline ScriptStencilIterable CompilationStencil::functionScriptStencils(
    const CompilationStencil& stencil, CompilationGCOutput& gcOutput) {
  return ScriptStencilIterable(stencil, gcOutput);
}

// Merge CompilationStencil for delazification into initial
// ExtensibleCompilationStencil.
struct CompilationStencilMerger {
 private:
  using FunctionKey = SourceExtent::FunctionKey;

  // The stencil for the initial compilation.
  // Delazifications are merged into this.
  //
  // If any failure happens during merge operation, this field is reset to
  // nullptr.
  UniquePtr<ExtensibleCompilationStencil> initial_;

  FunctionKeyToScriptIndexMap functionKeyToInitialScriptIndex_;

  ScriptIndex getInitialScriptIndexFor(
      const CompilationStencil& delazification) const;

  // A map from delazification's ParserAtomIndex to
  // initial's TaggedParserAtomIndex
  using AtomIndexMap = Vector<TaggedParserAtomIndex, 0, js::SystemAllocPolicy>;

  [[nodiscard]] bool buildAtomIndexMap(FrontendContext* fc,
                                       const CompilationStencil& delazification,
                                       AtomIndexMap& atomIndexMap);

 public:
  CompilationStencilMerger() = default;

  // Set the initial stencil and prepare for merging.
  [[nodiscard]] bool setInitial(
      FrontendContext* fc, UniquePtr<ExtensibleCompilationStencil>&& initial);

  // Merge the delazification stencil into the initial stencil.
  [[nodiscard]] bool addDelazification(
      FrontendContext* fc, const CompilationStencil& delazification);

  // Merge the delazification stencil into the initial stencil if the
  // delazification stencil can be merged.
  //
  // If the delazification's enclosing function is not yet merged, this does
  // do nothing.
  [[nodiscard]] bool maybeAddDelazification(
      FrontendContext* fc, const CompilationStencil& delazification);

  ExtensibleCompilationStencil& getResult() const { return *initial_; }
  UniquePtr<ExtensibleCompilationStencil> takeResult() {
    return std::move(initial_);
  }
};

ScriptStencilRef ScopeStencilRef::script() const {
  return ScriptStencilRef{stencils_, scriptIndex_};
}

const CompilationStencil* ScopeStencilRef::context() const {
  return script().context();
}

const ScopeStencil& ScopeStencilRef::scope() const {
  return context()->scopeData[scopeIndex_];
}

const ScriptStencilExtra& ScopeStencilRef::functionScriptExtra() const {
  MOZ_ASSERT(scope().isFunction());
  // Extract the `ScriptIndex` from the function's scope. This index is valid in
  // the `CompilationStencil` which has the shared data for `scriptIndex_`.
  ScriptIndex functionIndexInContext = scope().functionIndex();
  // Convert the function's index to an index in the initial stencil.
  ScriptIndex functionIndexInInitial =
      stencils_.getInitialIndexFor(scriptIndex_, functionIndexInContext);
  // Create a ScriptStencilRef from the function index in the initial stencil.
  ScriptStencilRef function{stencils_, functionIndexInInitial};
  return function.scriptExtra();
}

InputScope InputScope::enclosing() const {
  return scope_.match(
      [](const Scope* ptr) {
        // This may return a nullptr Scope pointer.
        return InputScope(ptr->enclosing());
      },
      [](const ScopeStencilRef& ref) {
        auto& scope = ref.scope();
        if (scope.hasEnclosing()) {
#ifdef DEBUG
          // Assert that checking for the same stencil is equivalent to
          // checking for being encoded in the initial stencil.
          if (ref.scriptIndex_ != 0) {
            auto enclosingScript = ref.script().enclosingScript();
            bool same = ref.context() == enclosingScript.context();
            MOZ_ASSERT(same == ref.script().isEagerlyCompiledInInitial());
          }
#endif

          // By default we are walking the scope within the same function.
          ScriptIndex scriptIndex = ref.scriptIndex_;

          // `scope.enclosing()` and `scope` would have the same scriptIndex
          // unless `scope` is the first scope of the script. In which case, the
          // returned enclosing scope index should be returned with the
          // enclosing script index.
          //
          // This can only happen in the initial stencil, as only the initial
          // stencil can have multiple scripts compiled in the same stencil.
          if (ref.script().isEagerlyCompiledInInitial()) {
            auto gcThingsFromContext = ref.script().gcThingsFromInitial();
            if (gcThingsFromContext[0].toScope() == ref.scopeIndex_) {
              scriptIndex = ref.script().enclosingScript().scriptIndex_;
            }
          }

          return InputScope(ref.stencils_, scriptIndex, scope.enclosing());
        }

        // By default the previous condition (scope.hasEnclosing()) should
        // trigger, except when we are at the top-level of a delazification, in
        // which case we have to find the enclosing script in the stencil of the
        // enclosing script, to find the lazyFunctionEnclosingScopeIndex which
        // is valid in the stencil of the enclosing script.
        //
        // Note, at one point the enclosing script would be the initial stencil.
        if (!ref.script().isEagerlyCompiledInInitial()) {
          auto enclosing = ref.script().enclosingScript();
          auto& scriptData = ref.script().scriptDataFromEnclosing();
          MOZ_ASSERT(scriptData.hasLazyFunctionEnclosingScopeIndex());
          return InputScope(ref.stencils_, enclosing.scriptIndex_,
                            scriptData.lazyFunctionEnclosingScopeIndex());
        }

        // The global scope is not known by the Stencil, while parsing inner
        // functions from Stencils where they are known at the execution using
        // the GlobalScope.
        if (ref.scope().kind() == ScopeKind::Module) {
          return InputScope(FakeStencilGlobalScope{});
        }
        return InputScope(nullptr);
      },
      [](const FakeStencilGlobalScope&) { return InputScope(nullptr); });
}

FunctionFlags InputScope::functionFlags() const {
  return scope_.match(
      [](const Scope* ptr) {
        JSFunction* fun = ptr->as<FunctionScope>().canonicalFunction();
        return fun->flags();
      },
      [](const ScopeStencilRef& ref) {
        MOZ_ASSERT(ref.scope().isFunction());
        ScriptIndex functionIndexInContext = ref.scope().functionIndex();
        // Unlike InputScript::functionFlags(), which returns the functionFlags
        // using the ScriptStencilRef::scriptDataFromEnclosing() function,
        // ref.context() is already the CompilationStencil holding the
        // information about the extracted function index. Using the same code
        // as in InputScript::functionFlags() would yield an error for cases
        // where the functionIndexInContext is 0, as we will look for the
        // scriptData in the wrong CompilationStencil.
        ScriptStencil& data = ref.context()->scriptData[functionIndexInContext];
        return data.functionFlags;
      },
      [](const FakeStencilGlobalScope&) -> FunctionFlags {
        MOZ_MAKE_COMPILER_ASSUME_IS_UNREACHABLE("No functionFlags on global.");
      });
}

ImmutableScriptFlags InputScope::immutableFlags() const {
  return scope_.match(
      [](const Scope* ptr) {
        JSFunction* fun = ptr->as<FunctionScope>().canonicalFunction();
        return fun->baseScript()->immutableFlags();
      },
      [](const ScopeStencilRef& ref) {
        return ref.functionScriptExtra().immutableFlags;
      },
      [](const FakeStencilGlobalScope&) -> ImmutableScriptFlags {
        MOZ_MAKE_COMPILER_ASSUME_IS_UNREACHABLE("No immutableFlags on global.");
      });
}

MemberInitializers InputScope::getMemberInitializers() const {
  return scope_.match(
      [](const Scope* ptr) {
        JSFunction* fun = ptr->as<FunctionScope>().canonicalFunction();
        return fun->baseScript()->getMemberInitializers();
      },
      [](const ScopeStencilRef& ref) {
        return ref.functionScriptExtra().memberInitializers();
      },
      [](const FakeStencilGlobalScope&) -> MemberInitializers {
        MOZ_MAKE_COMPILER_ASSUME_IS_UNREACHABLE(
            "No getMemberInitializers on global.");
      });
}

ScriptStencilRef ScriptStencilRef::topLevelScript() const {
  return ScriptStencilRef{stencils_, ScriptIndex(0)};
}

ScriptStencilRef ScriptStencilRef::enclosingScript() const {
  auto indexes = stencils_.getRelativeIndexesAt(scriptIndex_);
  ScriptStencilRef enclosing{stencils_, indexes.enclosingIndexInInitial};
  return enclosing;
}

const ScriptStencil& ScriptStencilRef::scriptDataFromInitial() const {
  return stencils_.getInitial()->scriptData[scriptIndex_];
}

bool ScriptStencilRef::isEagerlyCompiledInInitial() const {
  return scriptDataFromInitial().hasSharedData();
}

const ScriptStencil& ScriptStencilRef::scriptDataFromEnclosing() const {
  // The script data is held by the enclosing script except for the top-level.
  if (scriptIndex_ == 0) {
    return stencils_.getInitial()->scriptData[0];
  }
  // Get the enclosing stencil.
  auto indexes = stencils_.getRelativeIndexesAt(scriptIndex_);
  ScriptStencilRef enclosing{stencils_, indexes.enclosingIndexInInitial};
  return enclosing.context()->scriptData[indexes.indexInEnclosing];
}

mozilla::Span<TaggedScriptThingIndex> ScriptStencilRef::gcThingsFromInitial()
    const {
  return scriptDataFromInitial().gcthings(*stencils_.getInitial());
}

const ScriptStencilExtra& ScriptStencilRef::scriptExtra() const {
  return stencils_.getInitial()->scriptExtra[scriptIndex_];
}

const CompilationStencil* ScriptStencilRef::context() const {
  // The initial stencil might contain more than the top-level script, in which
  // case we should return the initial stencil when it contains the bytecode for
  // the script at the given index.
  if (isEagerlyCompiledInInitial()) {
    return stencils_.getInitial();
  }
  const auto* delazification = stencils_.getDelazificationAt(scriptIndex_);
  MOZ_ASSERT(delazification);
  return delazification;
}

const CompilationStencil* ScriptStencilRef::maybeContext() const {
  // The initial stencil might contain more than the top-level script, in which
  // case we should return the initial stencil when it contains the bytecode for
  // the script at the given index.
  if (isEagerlyCompiledInInitial()) {
    return stencils_.getInitial();
  }
  return stencils_.getDelazificationAt(scriptIndex_);
}

}  // namespace frontend
}  // namespace js

namespace mozilla {
template <>
struct RefPtrTraits<js::frontend::CompilationStencil> {
  static void AddRef(js::frontend::CompilationStencil* stencil) {
    stencil->AddRef();
  }
  static void Release(js::frontend::CompilationStencil* stencil) {
    stencil->Release();
  }
};
}  // namespace mozilla

#endif  // frontend_CompilationStencil_h
