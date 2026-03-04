/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "gtest/gtest.h"
#include "mozilla/Preferences.h"
#include "mozilla/SpinEventLoopUntil.h"
#include "nsITimer.h"
#include "nsTArray.h"
#include "nsIObserver.h"
#include "nsThreadUtils.h"
#include "nsWeakReference.h"

using namespace mozilla;

class TestWeakPrefObserver final : public nsIObserver,
                                   public nsSupportsWeakReference {
 public:
  NS_DECL_ISUPPORTS
  NS_IMETHOD Observe(nsISupports* aSubject, const char* aTopic,
                     const char16_t* aData) override {
    mNotifyCount++;
    return NS_OK;
  }
  int mNotifyCount = 0;

 private:
  ~TestWeakPrefObserver() = default;
};

NS_IMPL_ISUPPORTS(TestWeakPrefObserver, nsIObserver, nsISupportsWeakReference)

TEST(PrefsBasics, Errors)
{
  Preferences::SetBool("foo.bool", true, PrefValueKind::Default);
  Preferences::SetBool("foo.bool", false, PrefValueKind::User);
  ASSERT_EQ(Preferences::GetBool("foo.bool", false, PrefValueKind::Default),
            true);
  ASSERT_EQ(Preferences::GetBool("foo.bool", true, PrefValueKind::User), false);

  Preferences::SetInt("foo.int", -66, PrefValueKind::Default);
  Preferences::SetInt("foo.int", -77, PrefValueKind::User);
  ASSERT_EQ(Preferences::GetInt("foo.int", 1, PrefValueKind::Default), -66);
  ASSERT_EQ(Preferences::GetInt("foo.int", 1, PrefValueKind::User), -77);

  Preferences::SetUint("foo.uint", 88, PrefValueKind::Default);
  Preferences::SetUint("foo.uint", 99, PrefValueKind::User);
  ASSERT_EQ(Preferences::GetUint("foo.uint", 1, PrefValueKind::Default), 88U);
  ASSERT_EQ(Preferences::GetUint("foo.uint", 1, PrefValueKind::User), 99U);

  Preferences::SetFloat("foo.float", 3.33f, PrefValueKind::Default);
  Preferences::SetFloat("foo.float", 4.44f, PrefValueKind::User);
  ASSERT_FLOAT_EQ(
      Preferences::GetFloat("foo.float", 1.0f, PrefValueKind::Default), 3.33f);
  ASSERT_FLOAT_EQ(Preferences::GetFloat("foo.float", 1.0f, PrefValueKind::User),
                  4.44f);
}

TEST(PrefsBasics, Serialize)
{
  // Ensure that at least this one preference exists
  Preferences::SetBool("foo.bool", true, PrefValueKind::Default);
  ASSERT_EQ(Preferences::GetBool("foo.bool", false, PrefValueKind::Default),
            true);

  nsCString str;
  Preferences::SerializePreferences(str, true);
  fprintf(stderr, "%s\n", str.Data());
  // Assert that some prefs were not sanitized
  ASSERT_NE(nullptr, strstr(str.Data(), "B--:"));
  ASSERT_NE(nullptr, strstr(str.Data(), "I--:"));
  ASSERT_NE(nullptr, strstr(str.Data(), "S--:"));
  // Assert that something was sanitized
  ASSERT_NE(
      nullptr,
      strstr(
          str.Data(),
          "I-S:56/datareporting.policy.dataSubmissionPolicyAcceptedVersion"));
}

TEST(PrefsBasics, WeakObserverIdleSweep)
{
  // In gtest there is no RefreshDriver to drive idle scheduling and we don't
  // want to wait for the maximum idle delay. A repeating timer provides enough
  // main-thread activity for the idle task machinery to find idle time.
  nsCOMPtr<nsITimer> keepAlive = NS_NewTimer();
  keepAlive->InitWithNamedFuncCallback(
      [](nsITimer*, void*) {}, nullptr, 16, nsITimer::TYPE_REPEATING_SLACK,
      "PrefsBasics.WeakObserverIdleSweep.keepAlive"_ns);

  // Drain any startup-triggered sweep runner before we begin.
  TimeStamp drainDeadline =
      TimeStamp::Now() + TimeDuration::FromMilliseconds(100);
  MOZ_ALWAYS_TRUE(
      SpinEventLoopUntil("PrefsBasics.WeakObserverIdleSweep.drain"_ns,
                         [&] { return TimeStamp::Now() >= drainDeadline; }));
  NS_ProcessPendingEvents(nullptr);

  static const char kPref[] = "test.weak.observer.sweep";
  Preferences::SetBool(kPref, false);

  uint32_t countWithObserver;
  {
    RefPtr<TestWeakPrefObserver> observer = new TestWeakPrefObserver();
    nsresult rv = Preferences::AddWeakObserver(observer, kPref);
    ASSERT_TRUE(NS_SUCCEEDED(rv));
    countWithObserver = Preferences::GetCallbackCount();
  }

  // Observer expired, but no pref change — callback is still in the list.
  EXPECT_EQ(Preferences::GetCallbackCount(), countWithObserver);

  // Changing the pref notifies the expired observer, scheduling an idle sweep.
  Preferences::SetBool(kPref, true);

  // Spin the event loop until the idle sweep runs and removes the callback.
  MOZ_ALWAYS_TRUE(SpinEventLoopUntil(
      "PrefsBasics.WeakObserverIdleSweep"_ns,
      [&] { return Preferences::GetCallbackCount() < countWithObserver; }));

  keepAlive->Cancel();
}

TEST(PrefsBasics, WeakObserverRegistrationSweep)
{
  // In gtest there is no RefreshDriver to drive idle scheduling and we don't
  // want to wait for the maximum idle delay. A repeating timer provides enough
  // main-thread activity for the idle task machinery to find idle time.
  nsCOMPtr<nsITimer> keepAlive = NS_NewTimer();
  keepAlive->InitWithNamedFuncCallback(
      [](nsITimer*, void*) {}, nullptr, 16, nsITimer::TYPE_REPEATING_SLACK,
      "PrefsBasics.WeakObserverRegistrationSweep.keepAlive"_ns);

  // Drain any pending sweep runner before we begin.
  TimeStamp drainDeadline =
      TimeStamp::Now() + TimeDuration::FromMilliseconds(100);
  MOZ_ALWAYS_TRUE(
      SpinEventLoopUntil("PrefsBasics.WeakObserverRegistrationSweep.drain"_ns,
                         [&] { return TimeStamp::Now() >= drainDeadline; }));
  NS_ProcessPendingEvents(nullptr);

  static const char kPref[] = "test.weak.observer.regsweep";
  Preferences::SetBool(kPref, false);

  uint32_t countWithObserver;
  {
    RefPtr<TestWeakPrefObserver> observer = new TestWeakPrefObserver();
    nsresult rv = Preferences::AddWeakObserver(observer, kPref);
    ASSERT_TRUE(NS_SUCCEEDED(rv));
    countWithObserver = Preferences::GetCallbackCount();
  }

  // Observer expired, but callback is still in the list.
  EXPECT_EQ(Preferences::GetCallbackCount(), countWithObserver);

  // Register 512 weak observers to hit the periodic sweep threshold.
  // Keep them alive during registration to avoid address reuse causing
  // duplicate keys in the observer hashtable.
  static constexpr uint32_t kSweepInterval = 512;
  nsTArray<RefPtr<TestWeakPrefObserver>> observers(kSweepInterval);
  for (uint32_t i = 0; i < kSweepInterval; i++) {
    observers.AppendElement(new TestWeakPrefObserver());
    Preferences::AddWeakObserver(observers.LastElement(), kPref);
  }
  EXPECT_EQ(Preferences::GetCallbackCount(),
            countWithObserver + kSweepInterval);

  // Let all observers expire at once.
  observers.Clear();

  // Spin the event loop until the sweep removes all expired callbacks.
  MOZ_ALWAYS_TRUE(SpinEventLoopUntil(
      "PrefsBasics.WeakObserverRegistrationSweep"_ns,
      [&] { return Preferences::GetCallbackCount() < countWithObserver; }));

  keepAlive->Cancel();
}
