/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Regression tests for TSAN data races.  Each test spawns concurrent
// readers and writers on the same unprotected members.

#include "gtest/gtest.h"

#include "mozilla/Preferences.h"
#include "mozilla/SpinEventLoopUntil.h"
#include "nsComponentManagerUtils.h"
#include "nsIThread.h"
#include "nsNetUtil.h"
#include "nsServiceManagerUtils.h"
#include "nsThreadUtils.h"

#include "../../protocol/http/nsHttpHandler.h"

using namespace mozilla;
using namespace mozilla::net;

// Bug: nsHttpHandler nsCString members (mHttpAcceptEncodings,
// mHttpsAcceptEncodings, mDictionaryAcceptEncodings) are written on the main
// thread by PrefsChanged() and read on the socket thread via
// IsAcceptableEncoding(). nsCString is not safe for concurrent read+write.

TEST(TestThreadSafetyRaces, nsHttpHandler_AcceptEncoding_Race)
{
  // Ensure nsHttpHandler is initialized
  nsCOMPtr<nsIIOService> ioService = do_GetIOService();
  ASSERT_TRUE(ioService);

  if (!gHttpHandler) {
    nsCOMPtr<nsIProtocolHandler> handler;
    ioService->GetProtocolHandler("http", getter_AddRefs(handler));
  }
  ASSERT_TRUE(gHttpHandler)
  << "nsHttpHandler must be initialized";

  nsCOMPtr<nsIThread> readerThread;
  nsresult rv = NS_NewNamedThread("RaceReader", getter_AddRefs(readerThread));
  ASSERT_NS_SUCCEEDED(rv);

  Atomic<bool> done{false};
  Atomic<bool> readerRunning{false};

  rv = readerThread->Dispatch(
      NS_NewRunnableFunction("AcceptEncodingReader", [&done, &readerRunning]() {
        readerRunning = true;
        while (!done) {
          gHttpHandler->IsAcceptableEncoding("gzip", true);
          gHttpHandler->IsAcceptableEncoding("br", true);
          gHttpHandler->IsAcceptableEncoding("zstd", true);
          gHttpHandler->IsAcceptableEncoding("gzip", false);
          gHttpHandler->IsAcceptableEncoding("deflate", false);
        }
      }));
  ASSERT_NS_SUCCEEDED(rv);

  // Wait until reader thread is actively running
  SpinEventLoopUntil("WaitForReader"_ns, [&]() { return !!readerRunning; });

  for (int i = 0; i < 5000; i++) {
    if (i % 2 == 0) {
      Preferences::SetCString("network.http.accept-encoding",
                              "gzip, deflate"_ns);
      Preferences::SetCString("network.http.accept-encoding.secure",
                              "gzip, deflate, br"_ns);
    } else {
      Preferences::SetCString("network.http.accept-encoding",
                              "gzip, deflate, zstd"_ns);
      Preferences::SetCString("network.http.accept-encoding.secure",
                              "gzip, deflate, br, zstd"_ns);
    }
  }

  done = true;
  readerThread->Shutdown();

  Preferences::ClearUser("network.http.accept-encoding");
  Preferences::ClearUser("network.http.accept-encoding.secure");
}

TEST(TestThreadSafetyRaces, nsHttpHandler_UserAgent_Race)
{
  ASSERT_TRUE(gHttpHandler)
  << "nsHttpHandler must be initialized";

  nsCOMPtr<nsIThread> readerThread;
  nsresult rv = NS_NewNamedThread("RaceReader", getter_AddRefs(readerThread));
  ASSERT_NS_SUCCEEDED(rv);

  Atomic<bool> done{false};
  Atomic<bool> readerRunning{false};

  rv = readerThread->Dispatch(
      NS_NewRunnableFunction("UserAgentReader", [&done, &readerRunning]() {
        readerRunning = true;
        while (!done) {
          const nsCString& ua = gHttpHandler->UserAgent(false);
          (void)ua.Length();
        }
      }));
  ASSERT_NS_SUCCEEDED(rv);

  SpinEventLoopUntil("WaitForReader"_ns, [&]() { return !!readerRunning; });

  for (int i = 0; i < 5000; i++) {
    if (i % 2 == 0) {
      Preferences::SetCString("general.useragent.override", "TestAgent/1.0"_ns);
    } else {
      Preferences::ClearUser("general.useragent.override");
    }
  }

  done = true;
  readerThread->Shutdown();

  Preferences::ClearUser("general.useragent.override");
}
