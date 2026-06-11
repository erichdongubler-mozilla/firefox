/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "jit/riscv64/Architecture-riscv64.h"

#include <cstdlib>

#include "jit/FlushICache.h"  // js::jit::FlushICache
#include "jit/RegisterSets.h"
#include "jit/riscv64/Assembler-riscv64.h"
#include "jit/Simulator.h"

#if defined(__linux__) && !defined(JS_SIMULATOR_RISCV64) && \
    __has_include(<asm/hwprobe.h>)
#  define USE_HWPROBE
#endif

#ifdef USE_HWPROBE
#  include <asm/hwprobe.h>
#  include <sys/syscall.h>
#endif

namespace js {
namespace jit {
Registers::Code Registers::FromName(const char* name) {
  for (size_t i = 0; i < Total; i++) {
    if (strcmp(GetName(i), name) == 0) {
      return Code(i);
    }
  }

  return Invalid;
}

FloatRegisters::Code FloatRegisters::FromName(const char* name) {
  for (size_t i = 0; i < Total; i++) {
    if (strcmp(GetName(i), name) == 0) {
      return Code(i);
    }
  }

  return Invalid;
}

FloatRegisterSet FloatRegister::ReduceSetForPush(const FloatRegisterSet& s) {
#ifdef ENABLE_WASM_SIMD
#  error "Needs more careful logic if SIMD is enabled"
#endif

  LiveFloatRegisterSet mod;
  for (FloatRegisterIterator iter(s); iter.more(); ++iter) {
    if ((*iter).isSingle()) {
      // Even for single size registers save complete double register.
      mod.addUnchecked((*iter).doubleOverlay());
    } else {
      mod.addUnchecked(*iter);
    }
  }
  return mod.set();
}

FloatRegister FloatRegister::singleOverlay() const {
  MOZ_ASSERT(!isInvalid());
  if (kind_ == Codes::Double) {
    return FloatRegister(encoding_, Codes::Single);
  }
  return *this;
}

FloatRegister FloatRegister::doubleOverlay() const {
  MOZ_ASSERT(!isInvalid());
  if (kind_ != Codes::Double) {
    return FloatRegister(encoding_, Codes::Double);
  }
  return *this;
}

uint32_t FloatRegister::GetPushSizeInBytes(
    const TypedRegisterSet<FloatRegister>& s) {
#ifdef ENABLE_WASM_SIMD
#  error "Needs more careful logic if SIMD is enabled"
#endif

  return s.size() * sizeof(double);
}
void FlushICache(void* code, size_t size) {
#if defined(JS_SIMULATOR)
  js::jit::SimulatorProcess::FlushICache(code, size);

#elif defined(__linux__) || defined(__OpenBSD__)
#  if defined(__GNUC__)
  intptr_t end = reinterpret_cast<intptr_t>(code) + size;
  __builtin___clear_cache(reinterpret_cast<char*>(code),
                          reinterpret_cast<char*>(end));

#  else
  _flush_cache(reinterpret_cast<char*>(code), size, BCACHE);
#  endif
#else
#  error "Unsupported platform"
#endif
}

// static
void RVFlags::Init() {
  MOZ_ASSERT(!sComputed);
#ifdef USE_HWPROBE
  riscv_hwprobe probe[1] = {{RISCV_HWPROBE_KEY_IMA_EXT_0, 0}};
  if (syscall(__NR_riscv_hwprobe, probe, 1, 0, nullptr, 0) == 0) {
    if (probe[0].value & RISCV_HWPROBE_EXT_ZBA) {
      sZbaExtension = true;
    }
    if (probe[0].value & RISCV_HWPROBE_EXT_ZBB) {
      sZbbExtension = true;
    }
  }
#else
  if (std::getenv("RISCV_EXT_ZBA")) {
    // Force on Zba extension for testing purposes or on non-linux platforms.
    sZbaExtension = true;
  }
  if (std::getenv("RISCV_EXT_ZBB")) {
    // Force on Zbb extension for testing purposes or on non-linux platforms.
    sZbbExtension = true;
  }
#endif

  sComputed = true;
}

bool CPUFlagsHaveBeenComputed() { return RVFlags::FlagsHaveBeenComputed(); }

}  // namespace jit
}  // namespace js

#undef USE_HWPROBE
