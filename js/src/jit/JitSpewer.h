/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef jit_JitSpewer_h
#define jit_JitSpewer_h

#include "mozilla/Assertions.h"
#include "mozilla/Attributes.h"
#include "mozilla/IntegerPrintfMacros.h"

#include <stdarg.h>

#include "jit/GraphSpewer.h"
#include "jit/JitSpewChannelList.h"
#include "js/Printer.h"
#include "js/TypeDecls.h"
#include "wasm/WasmTypeDecls.h"

enum JSValueType : uint8_t;

namespace js {
namespace jit {

enum JitSpewChannel {
#define JITSPEW_CHANNEL(name) JitSpew_##name,
  JITSPEW_CHANNEL_LIST(JITSPEW_CHANNEL)
#undef JITSPEW_CHANNEL
      JitSpew_Terminator
};

class BacktrackingAllocator;
class MDefinition;
class MIRGenerator;
class MIRGraph;
class TempAllocator;

const char* ValTypeToString(JSValueType type);

// The JitSpewer is only available on debug builds.
// None of the global functions have effect on non-debug builds.
#ifdef JS_JITSPEW

// Class made to hold the MIR and LIR graphs of an Wasm / Ion compilation and
// automatically spew them to JITSPEW.
class JitSpewGraphSpewer {
 private:
  MIRGraph* graph_;
  LSprinter jsonPrinter_;
  GraphSpewer graphSpewer_;

 public:
  explicit JitSpewGraphSpewer(TempAllocator* alloc,
                              const wasm::CodeMetadata* wasmCodeMeta = nullptr);

  bool isSpewing() const { return graph_; }
  void init(MIRGraph* graph, JSScript* function);
  void beginFunction(JSScript* function);
  void beginWasmFunction(unsigned funcIndex);
  void spewPass(const char* pass, BacktrackingAllocator* ra = nullptr);
  void endFunction();

  void dump(Fprinter& json);
};

void CheckLogging();
Fprinter& JitSpewPrinter();

class JitSpewIndent {
  JitSpewChannel channel_;

 public:
  explicit JitSpewIndent(JitSpewChannel channel);
  ~JitSpewIndent();
};

void JitSpew(JitSpewChannel channel, const char* fmt, ...)
    MOZ_FORMAT_PRINTF(2, 3);
void JitSpewStart(JitSpewChannel channel, const char* fmt, ...)
    MOZ_FORMAT_PRINTF(2, 3);
void JitSpewCont(JitSpewChannel channel, const char* fmt, ...)
    MOZ_FORMAT_PRINTF(2, 3);
void JitSpewFin(JitSpewChannel channel);
void JitSpewHeader(JitSpewChannel channel);

}  // namespace jit

namespace jitspew::detail {
extern bool LoggingChecked;
extern uint64_t LoggingBits;
extern mozilla::Atomic<uint32_t, mozilla::Relaxed> filteredOutCompilations;
}  // namespace jitspew::detail

namespace jit {

static inline bool JitSpewEnabled(JitSpewChannel channel) {
  MOZ_ASSERT(jitspew::detail::LoggingChecked);
  return (jitspew::detail::LoggingBits & (uint64_t(1) << uint32_t(channel))) &&
         !jitspew::detail::filteredOutCompilations;
}

void JitSpewVA(JitSpewChannel channel, const char* fmt, va_list ap)
    MOZ_FORMAT_PRINTF(2, 0);
void JitSpewStartVA(JitSpewChannel channel, const char* fmt, va_list ap)
    MOZ_FORMAT_PRINTF(2, 0);
void JitSpewContVA(JitSpewChannel channel, const char* fmt, va_list ap)
    MOZ_FORMAT_PRINTF(2, 0);
void JitSpewDef(JitSpewChannel channel, const char* str, MDefinition* def);

void EnableChannel(JitSpewChannel channel);
void DisableChannel(JitSpewChannel channel);
void EnableIonDebugSyncLogging();
void EnableIonDebugAsyncLogging();

#  define JitSpewIfEnabled(channel, fmt, ...) \
    do {                                      \
      if (JitSpewEnabled(channel)) {          \
        JitSpew(channel, fmt, __VA_ARGS__);   \
      }                                       \
    } while (false);

#else

class JitSpewGraphSpewer {
 public:
  explicit JitSpewGraphSpewer(
      TempAllocator* alloc, const wasm::CodeMetadata* wasmCodeMeta = nullptr) {}

  bool isSpewing() { return false; }
  void init(MIRGraph* graph, JSScript* function) {}
  void beginFunction(JSScript* function) {}
  void beginWasmFunction(unsigned funcIndex) {}
  void spewPass(const char* pass, BacktrackingAllocator* ra = nullptr) {}
  void endFunction() {}

  void dump(Fprinter& c1, Fprinter& json) {}
};

static inline void CheckLogging() {}
static inline Fprinter& JitSpewPrinter() {
  MOZ_CRASH("No empty backend for JitSpewPrinter");
}

class JitSpewIndent {
 public:
  explicit JitSpewIndent(JitSpewChannel channel) {}
  ~JitSpewIndent() = default;
};

// The computation of some of the argument of the spewing functions might be
// costly, thus we use variaidic macros to ignore any argument of these
// functions.
static inline void JitSpewCheckArguments(JitSpewChannel channel,
                                         const char* fmt) {}

#  define JitSpewCheckExpandedArgs(channel, fmt, ...) \
    JitSpewCheckArguments(channel, fmt)
#  define JitSpewCheckExpandedArgs_(ArgList) \
    JitSpewCheckExpandedArgs ArgList /* Fix MSVC issue */
#  define JitSpew(...) JitSpewCheckExpandedArgs_((__VA_ARGS__))
#  define JitSpewStart(...) JitSpewCheckExpandedArgs_((__VA_ARGS__))
#  define JitSpewCont(...) JitSpewCheckExpandedArgs_((__VA_ARGS__))

#  define JitSpewIfEnabled(channel, fmt, ...) \
    JitSpewCheckArguments(channel, fmt)

static inline void JitSpewFin(JitSpewChannel channel) {}

static inline void JitSpewHeader(JitSpewChannel channel) {}
static inline bool JitSpewEnabled(JitSpewChannel channel) { return false; }
static inline MOZ_FORMAT_PRINTF(2, 0) void JitSpewVA(JitSpewChannel channel,
                                                     const char* fmt,
                                                     va_list ap) {}
static inline void JitSpewDef(JitSpewChannel channel, const char* str,
                              MDefinition* def) {}

static inline void EnableChannel(JitSpewChannel) {}
static inline void DisableChannel(JitSpewChannel) {}
static inline void EnableIonDebugSyncLogging() {}
static inline void EnableIonDebugAsyncLogging() {}

#endif /* JS_JITSPEW */

}  // namespace jit
}  // namespace js

#endif /* jit_JitSpewer_h */
