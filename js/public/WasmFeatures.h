/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * vim: set ts=8 sts=2 et sw=2 tw=80:
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef js_WasmFeatures_h
#define js_WasmFeatures_h

// [SMDOC] WebAssembly feature gating
//
// Declarative listing of WebAssembly optional features. This macro is used to
// generate most of the feature gating code in a centralized manner. See
// 'Adding a feature' below for the exact steps needed to add a new feature.
//
// # Adding a feature
//
// 1. Add a configure switch for the feature in js/moz.configure
// 2. Add a WASM_FEATURE_ENABLED #define below
// 3. Add the feature to JS_FOR_WASM_FEATURES
//   a. capitalized name: Used for naming of feature functions, including
//      wasmFeatureEnabled shell function.
//   b. lower case name: Used for naming of feature flag variables, including
//      in wasm::FeatureArgs.
//   c. compile predicate: Set to WASM_FEATURE_ENABLED
//   d. compiler predicate: Expression of compilers that this feature depends
//      on.
//   e. flag predicate: Expression used to predicate enablement of feature
//      flag. Useful for disabling a feature when dependent feature is not
//      enabled or if we are fuzzing.
//   f. preference name: The stem of the browser preference. Will be expanded
//      to `javascript.options.wasm-FEATURE`.
// 4. Add the preference to module/libpref/init/StaticPrefList.yaml
//   a. Set `set_spidermonkey_pref: startup`
//   b. Set value to 'true' for default features, @IS_NIGHTLY_BUILD@ for
//      tentative features, and 'false' for experimental features.
// 5. [fuzzing] Add the feature to gluesmith/src/lib.rs, if wasm-smith has
//    support for it.

#ifdef ENABLE_WASM_RELAXED_SIMD
#  define WASM_RELAXED_SIMD_ENABLED 1
#else
#  define WASM_RELAXED_SIMD_ENABLED 0
#endif
#ifdef ENABLE_WASM_MEMORY_CONTROL
#  define WASM_MEMORY_CONTROL_ENABLED 1
#else
#  define WASM_MEMORY_CONTROL_ENABLED 0
#endif
#ifdef ENABLE_WASM_JSPI
#  define WASM_JSPI_ENABLED 1
#else
#  define WASM_JSPI_ENABLED 0
#endif
#ifdef ENABLE_WASM_MOZ_INTGEMM
#  define WASM_MOZ_INTGEMM_ENABLED 1
#else
#  define WASM_MOZ_INTGEMM_ENABLED 0
#endif
#ifdef ENABLE_WASM_BRANCH_HINTING
#  define WASM_BRANCH_HINTING_ENABLED 1
#else
#  define WASM_BRANCH_HINTING_ENABLED 0
#endif

// clang-format off
#define JS_FOR_WASM_FEATURES(FEATURE)                                   \
  FEATURE(                                                              \
    /* capitalized name   */ RelaxedSimd,                               \
    /* lower case name    */ v128Relaxed,                               \
    /* compile predicate  */ WASM_RELAXED_SIMD_ENABLED,                 \
    /* compiler predicate */ AnyCompilerAvailable(cx),                  \
    /* flag predicate     */ js::jit::JitSupportsWasmSimd(),            \
    /* flag force enable  */ false,                                     \
    /* flag fuzz enable   */ true,                                      \
    /* preference name    */ relaxed_simd)                              \
  FEATURE(                                                              \
    /* capitalized name   */ MemoryControl,                             \
    /* lower case name    */ memoryControl,                             \
    /* compile predicate  */ WASM_MEMORY_CONTROL_ENABLED,               \
    /* compiler predicate */ AnyCompilerAvailable(cx),                  \
    /* flag predicate     */ true,                                      \
    /* flag force enable  */ false,                                     \
    /* flag fuzz enable   */ false,                                     \
    /* preference name    */ memory_control)                            \
  FEATURE(                                                              \
    /* capitalized name   */ JSPromiseIntegration,                      \
    /* lower case name    */ jsPromiseIntegration,                      \
    /* compile predicate  */ WASM_JSPI_ENABLED,                         \
    /* compiler predicate */ IonPlatformSupport(),                      \
    /* flag predicate     */ true,                                      \
    /* flag force enable  */ false,                                     \
    /* flag fuzz enable   */ true,                                      \
    /* preference name    */ js_promise_integration)                    \
  FEATURE(                                                              \
    /* capitalized name   */ MozIntGemm,                                \
    /* lower case name    */ mozIntGemm,                                \
    /* compile predicate  */ WASM_MOZ_INTGEMM_ENABLED,                  \
    /* compiler predicate */ AnyCompilerAvailable(cx),                  \
    /* flag predicate     */ IsPrivilegedContext(cx),                   \
    /* flag force enable  */ false,                                     \
    /* flag fuzz enable   */ false,                                     \
    /* preference name    */ moz_intgemm)                               \
  FEATURE(                                                              \
    /* capitalized name   */ TestSerialization,                         \
    /* lower case name    */ testSerialization,                         \
    /* compile predicate  */ 1,                                         \
    /* compiler predicate */ IonAvailable(cx),                          \
    /* flag predicate     */ true,                                      \
    /* flag force enable  */ false,                                     \
    /* flag fuzz enable   */ false,                                     \
    /* preference name    */ test_serialization)                        \
  FEATURE(                                                              \
    /* capitalized name   */ BranchHinting,                             \
    /* lower case name    */ branchHinting,                             \
    /* compile predicate  */ WASM_BRANCH_HINTING_ENABLED,               \
    /* compiler predicate */ IonAvailable(cx),                          \
    /* flag predicate     */ true,                                      \
    /* flag force enable  */ false,                                     \
    /* flag fuzz enable   */ true,                                      \
    /* preference name    */ branch_hinting)

// clang-format on

#endif  // js_WasmFeatures_h
