/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef __SECURITY_SANDBOX_SANDBOXBROKER_H__
#define __SECURITY_SANDBOX_SANDBOXBROKER_H__

#include <stdint.h>
#include <windows.h>

#include "mozilla/ipc/EnvironmentMap.h"
#include "nsCOMPtr.h"
#include "nsXULAppAPI.h"
#include "nsISupportsImpl.h"

#include "mozilla/ipc/UtilityProcessSandboxing.h"
#include "mozilla/ipc/LaunchError.h"
#include "mozilla/Result.h"

namespace sandbox {
class BrokerServices;
class TargetPolicy;
}  // namespace sandbox

namespace mozilla {

enum GMPSandboxKind { Default, Widevine, Clearkey, Fake };

class SandboxBroker {
 public:
  SandboxBroker();

  static void Initialize(sandbox::BrokerServices* aBrokerServices,
                         const nsAString& aBinDir);

  static void EnsureLpacPermsissionsOnDir(const nsString& aDir);

  /**
   * Do initialization that depends on parts of the Gecko machinery having been
   * created first.
   */
  static void GeckoDependentInitialize();

  Result<Ok, mozilla::ipc::LaunchError> LaunchApp(
      const wchar_t* aPath, const wchar_t* aArguments,
      base::EnvironmentMap& aEnvironment, GeckoProcessType aProcessType,
      const bool aEnableLogging, const IMAGE_THUNK_DATA* aCachedNtdllThunk,
      void** aProcessHandle);
  ~SandboxBroker();

  // Security levels for different types of processes
  void SetSecurityLevelForContentProcess(int32_t aSandboxLevel,
                                         bool aIsFileProcess);

  void SetSecurityLevelForGPUProcess(int32_t aSandboxLevel);
  bool SetSecurityLevelForRDDProcess();
  bool SetSecurityLevelForSocketProcess();

  bool SetSecurityLevelForGMPlugin(GMPSandboxKind aGMPSandboxKind);
  bool SetSecurityLevelForUtilityProcess(mozilla::ipc::SandboxingKind aSandbox);

  // File system permissions
  bool AllowReadFile(wchar_t const* file);

  /**
   * Share a HANDLE with the child process. The HANDLE will be made available
   * in the child process at the memory address
   * |reinterpret_cast<uintptr_t>(aHandle)|. It is the caller's responsibility
   * to communicate this address to the child.
   */
  void AddHandleToShare(HANDLE aHandle);

  bool IsWin32kLockedDown();

  // Set up dummy interceptions via the broker, so we can log calls.
  void ApplyLoggingConfig();

 private:
  static bool sRunningFromNetworkDrive;
  std::unique_ptr<sandbox::TargetPolicy> mPolicy;
};

}  // namespace mozilla

#endif
