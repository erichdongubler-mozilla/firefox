/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef jit_JitSpewChannelList_h
#define jit_JitSpewChannelList_h

#define JITSPEW_CHANNEL_LIST(_)                   \
  /* Information during sinking */                \
  _(Prune)                                        \
  /* Information during escape analysis */        \
  _(Escape)                                       \
  /* Information during alias analysis */         \
  _(Alias)                                        \
  /* Information during alias analysis */         \
  _(AliasSummaries)                               \
  /* Information during GVN */                    \
  _(GVN)                                          \
  /* Information during sinking */                \
  _(Sink)                                         \
  /* Information during Range analysis */         \
  _(Range)                                        \
  /* Information during LICM */                   \
  _(LICM)                                         \
  /* Information during Branch Hinting */         \
  _(BranchHint)                                   \
  /* Info about fold linear constants */          \
  _(FLAC)                                         \
  /* Effective address analysis info */           \
  _(EAA)                                          \
  /* Wasm Bounds Check Elimination */             \
  _(WasmBCE)                                      \
  /* Information during regalloc */               \
  _(RegAlloc)                                     \
  /* Information during inlining */               \
  _(Inlining)                                     \
  /* Information during codegen */                \
  _(Codegen)                                      \
  /* Debug info about safepoints */               \
  _(Safepoints)                                   \
  /* Debug info about Pools*/                     \
  _(Pools)                                        \
  /* Profiling-related information */             \
  _(Profiling)                                    \
  /* Debug info about the I$ */                   \
  _(CacheFlush)                                   \
  /* Info about redundant shape guards */         \
  _(RedundantShapeGuards)                         \
  /* Info about redundant GC barriers */          \
  _(RedundantGCBarriers)                          \
  /* Info about loads used as keys */             \
  _(MarkLoadsUsedAsPropertyKeys)                  \
  /* Output a list of MIR expressions */          \
  _(MIRExpressions)                               \
  /* Summary info about loop unrolling */         \
  _(Unroll)                                       \
  /* Detailed info about loop unrolling */        \
  _(UnrollDetails)                                \
  /* Information about stub folding */            \
  _(StubFolding)                                  \
  /* Additional information about stub folding */ \
  _(StubFoldingDetails)                           \
                                                  \
  /* BASELINE COMPILER SPEW */                    \
                                                  \
  /* Aborting Script Compilation. */              \
  _(BaselineAbort)                                \
  /* Script Compilation. */                       \
  _(BaselineScripts)                              \
  /* Detailed op-specific spew. */                \
  _(BaselineOp)                                   \
  /* Inline caches. */                            \
  _(BaselineIC)                                   \
  /* Inline cache fallbacks. */                   \
  _(BaselineICFallback)                           \
  /* OSR from Baseline => Ion. */                 \
  _(BaselineOSR)                                  \
  /* Bailouts. */                                 \
  _(BaselineBailouts)                             \
  /* Debug Mode On Stack Recompile . */           \
  _(BaselineDebugModeOSR)                         \
                                                  \
  /* ION COMPILER SPEW */                         \
                                                  \
  /* Used to abort SSA construction */            \
  _(IonAbort)                                     \
  /* Information about compiled scripts */        \
  _(IonScripts)                                   \
  /* Info about failing to log script */          \
  _(IonSyncLogs)                                  \
  /* Information during MIR building */           \
  _(IonMIR)                                       \
  /* Information during bailouts */               \
  _(IonBailouts)                                  \
  /* Information during OSI */                    \
  _(IonInvalidate)                                \
  /* Debug info about snapshots */                \
  _(IonSnapshots)                                 \
  /* Generated inline cache stubs */              \
  _(IonIC)                                        \
                                                  \
  /* WARP SPEW */                                 \
                                                  \
  /* Generated WarpSnapshots */                   \
  _(WarpSnapshots)                                \
  /* CacheIR transpiler logging */                \
  _(WarpTranspiler)                               \
  /* Trial inlining for Warp */                   \
  _(WarpTrialInlining)

#endif /* jit_JitSpewChannelList_h */
