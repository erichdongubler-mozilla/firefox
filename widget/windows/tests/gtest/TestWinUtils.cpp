/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "gtest/gtest.h"
#include "WinUtils.h"

#include "nsDirectoryServiceDefs.h"
#include "nsIFile.h"
#include "nsNetUtil.h"
#include "nsStreamUtils.h"
#include "mozilla/dom/ReferrerInfo.h"
#include "mozilla/SpinEventLoopUntil.h"

using namespace mozilla;
using namespace mozilla::widget;

static LayoutDeviceIntRegion GetTestRegion() {
  LayoutDeviceIntRegion region;
  region.OrWith(LayoutDeviceIntRect(0, 0, 10, 10));
  region.OrWith(LayoutDeviceIntRect(15, 15, 50, 50));
  return region;
}

TEST(WinUtils, Regions)
{
  auto region = GetTestRegion();
  nsAutoRegion rgn(WinUtils::RegionToHRGN(region));
  ASSERT_NE(rgn, nullptr) << "Conversion should succeed";
  ASSERT_EQ(region, WinUtils::ConvertHRGNToRegion(rgn))
      << "Region should round-trip";
}

/*****************************************************************************/

// https://learn.microsoft.com/en-us/dotnet/api/system.security.securityzone?view=netframework-4.8.1
constexpr uint32_t ZONE_MY_COMPUTER = 0;
constexpr uint32_t ZONE_INTRANET = 1;
constexpr uint32_t ZONE_TRUSTED = 2;
constexpr uint32_t ZONE_INTERNET = 3;
constexpr uint32_t ZONE_RESTRICTED = 4;

// ZoneIdKey overrides applied by MaybeWriteFileZoneId.
constexpr auto kFallbackUrl = "about:internet"_ns;
constexpr auto kFallbackReferrer = ""_ns;

struct FileTestData {
  // Set to Nothing() to indicate no URL written.  Used in private browsing.
  Maybe<nsCString> mSourceUrl;
  // Set to Nothing() to indicate no referrer written (private browsing) or
  // just no referrer.  It is not valid to set the referrer but no URL.
  Maybe<nsCString> mReferrerSpec;
  // Set to Nothing() to check the case for file-does-not-exist.
  Maybe<uint32_t> mExpectedZone;
  // Overrides for the HostUrl / ReferrerUrl values written to the ADS.
  //   Nothing() -> expected equals the input
  //   Some("")  -> the line is expected to be omitted
  //   Some(s)   -> the line is expected to be exactly "<key>=<s>\r\n"
  Maybe<nsCString> mExpectedHostUrl = Nothing();
  Maybe<nsCString> mExpectedReferrer = Nothing();
};

#define TestSuccess(_operation)                                \
  {                                                            \
    nsresult rv = _operation;                                  \
    if (NS_FAILED(rv)) {                                       \
      ADD_FAILURE() << #_operation << " | Failed with result " \
                    << static_cast<uint32_t>(rv) << std::endl; \
      return rv;                                               \
    }                                                          \
  }

// Reads the file's Zone.Identifier ADS and asserts it matches what
// MaybeWriteFileZoneIdSync would have written for the given test data.
static nsresult VerifyZoneIdentifier(nsIFile* aSaveFile,
                                     const FileTestData& aData) {
  nsString savePath;
  TestSuccess(aSaveFile->GetPath(savePath));
  auto isSlash = [](char aCh) { return aCh == '/' || aCh == '\\'; };
  bool isUNC =
      savePath.Length() >= 2 && isSlash(savePath[0]) && isSlash(savePath[1]);
  nsString adsPath = isUNC ? u"\\\\?\\UNC\\"_ns + Substring(savePath, 2)
                           : u"\\\\?\\"_ns + savePath;
  adsPath += u":Zone.Identifier"_ns;

  nsCOMPtr<nsIFile> adsFile;
  TestSuccess(NS_NewLocalFile(adsPath, getter_AddRefs(adsFile)));

  bool expectWritten =
      aData.mExpectedZone && *aData.mExpectedZone >= ZONE_INTERNET;

  nsCOMPtr<nsIInputStream> stream;
  nsresult openRv = NS_NewLocalFileInputStream(getter_AddRefs(stream), adsFile);

  if (!expectWritten) {
    // ADS should not have been written.
    EXPECT_EQ(openRv, NS_ERROR_FILE_NOT_FOUND)
        << "Expected no Zone.Identifier ADS";
    return NS_OK;
  }

  TestSuccess(openRv);

  nsAutoCString actual;
  TestSuccess(NS_ConsumeStream(stream, UINT32_MAX, actual));

  nsCString expectedHost = aData.mExpectedHostUrl.valueOr(aData.mSourceUrl.valueOr(""_ns));
  nsCString expectedReferrer =
      aData.mExpectedReferrer.valueOr(aData.mReferrerSpec.valueOr(""_ns));

  nsAutoCString expected;
  expected.AppendLiteral("[ZoneTransfer]\r\n");
  expected.AppendPrintf("ZoneId=%u\r\n", *aData.mExpectedZone);
  if (!expectedReferrer.IsEmpty()) {
    expected.AppendLiteral("ReferrerUrl=");
    expected.Append(expectedReferrer);
    expected.AppendLiteral("\r\n");
  }
  if (!expectedHost.IsEmpty()) {
    expected.AppendLiteral("HostUrl=");
    expected.Append(expectedHost);
    expected.AppendLiteral("\r\n");
  }

  EXPECT_STREQ(expected.get(), actual.get())
      << "Zone.Identifier contents did not match expected";
  return NS_OK;
}

static nsresult SetAndTestFileZone(const FileTestData& aData) {
  SCOPED_TRACE(testing::Message()
               << "source="
               << (aData.mSourceUrl ? aData.mSourceUrl->get() : "(none)")
               << " referrer="
               << (aData.mReferrerSpec ? aData.mReferrerSpec->get() : "(none)")
               << " expectedZone="
               << (aData.mExpectedZone ? std::to_string(*aData.mExpectedZone)
                                       : std::string("(none)")));

  nsCOMPtr<nsIFile> tmp;
  TestSuccess(NS_GetSpecialDirectory(NS_OS_TEMP_DIR, getter_AddRefs(tmp)));
  MOZ_ASSERT(tmp);

  nsID id = nsID::GenerateUUID();
  TestSuccess(tmp->AppendNative("TestZones-"_ns +
                                nsCString(id.ToString().get()) + ".txt"_ns));
  if (aData.mExpectedZone) {
    TestSuccess(tmp->CreateUnique(nsIFile::NORMAL_FILE_TYPE, 0666));
  } else {
    bool exists;
    TestSuccess(tmp->Exists(&exists));
    EXPECT_FALSE(exists);
  }

  bool done = false;
  WinUtils::MaybeWriteFileZoneId(tmp, aData.mSourceUrl, aData.mReferrerSpec)
      ->Then(
          GetMainThreadSerialEventTarget(), __func__,
          [&done, &aData, tmp](bool aResult) {
            if (!aData.mExpectedZone) {
              // File-doesn't-exist case: MaybeWriteFileZoneIdSync returns
              // Ok(false) (it does not consider that an error).
              EXPECT_FALSE(aResult);
            } else if (*aData.mExpectedZone >= ZONE_INTERNET) {
              EXPECT_TRUE(aResult);
            } else {
              // Below-Internet zones (My Computer, Intranet, Trusted) skip the
              // write per WinUtils::MaybeWriteFileZoneIdSync.
              EXPECT_FALSE(aResult);
            }
            VerifyZoneIdentifier(tmp, aData);
            done = true;
          },
          [&done](nsresult aErr) {
            ADD_FAILURE() << "Unexpected promise rejection: "
                          << static_cast<uint32_t>(aErr);
            done = true;
          });

  SpinEventLoopUntil("write zone test"_ns, [&done]() { return done; });

  // Cleanup.  Skip the file-doesn't-exist rows -- we never created the file.
  if (aData.mExpectedZone) {
    uint32_t dummy;
    TestSuccess(tmp->Remove(false, &dummy));
  }
  return NS_OK;
}

TEST(WinUtils, MaybeWriteFileZoneId)
{
  const FileTestData fileTestDatas[] = {
      // Valid URL, empty referrer (matches the JS code's "" when no referrer).
      {Some("http://www.example.org/"_ns), Some(""_ns), Some(ZONE_INTERNET)},
      {Some("about:blank"_ns), Some(""_ns), Some(ZONE_INTERNET),
       Some(kFallbackUrl)},
      {Some("about:srcdoc"_ns), Some(""_ns), Some(ZONE_INTERNET),
       Some(kFallbackUrl)},
      {Some("data:text/html,foo"_ns), Some(""_ns), Some(ZONE_INTERNET),
       Some(kFallbackUrl)},
      {Some("http://localhost:8080/"_ns), Some(""_ns), Some(ZONE_INTRANET)},
      {Some("http://127.0.0.1/"_ns), Some(""_ns), Some(ZONE_INTERNET)},
      {Some("file://C:/foo"_ns), Some(""_ns), Some(ZONE_MY_COMPUTER),
       Some(kFallbackUrl)},
      {Some("file:///C:/foo"_ns), Some(""_ns), Some(ZONE_MY_COMPUTER),
       Some(kFallbackUrl)},
      {Some("file://server/share/foo"_ns), Some(""_ns), Some(ZONE_INTRANET),
       Some(kFallbackUrl)},
      {Some("file:////server/share/foo"_ns), Some(""_ns), Some(ZONE_INTRANET),
       Some(kFallbackUrl)},

      // Valid URL, Nothing referrer.  (Edge case, not actually used in Gecko.)
      {Some("http://www.example.org/"_ns), Nothing(), Some(ZONE_INTERNET)},
      {Some("about:blank"_ns), Nothing(), Some(ZONE_INTERNET),
       Some(kFallbackUrl)},
      {Some("about:srcdoc"_ns), Nothing(), Some(ZONE_INTERNET),
       Some(kFallbackUrl)},
      {Some("data:text/html,foo"_ns), Nothing(), Some(ZONE_INTERNET),
       Some(kFallbackUrl)},
      {Some("http://localhost:8080/"_ns), Nothing(), Some(ZONE_INTRANET)},
      {Some("http://127.0.0.1/"_ns), Nothing(), Some(ZONE_INTERNET)},
      {Some("file://C:/foo"_ns), Nothing(), Some(ZONE_MY_COMPUTER),
       Some(kFallbackUrl)},
      {Some("file:///C:/foo"_ns), Nothing(), Some(ZONE_MY_COMPUTER),
       Some(kFallbackUrl)},
      {Some("file://server/share/foo"_ns), Nothing(), Some(ZONE_INTRANET),
       Some(kFallbackUrl)},
      {Some("file:////server/share/foo"_ns), Nothing(), Some(ZONE_INTRANET),
       Some(kFallbackUrl)},

      // Valid URL and referrer.
      {Some("http://www.example.org/"_ns), Some("http://www.example.com/"_ns),
       Some(ZONE_INTERNET)},
      {Some("about:blank"_ns), Some("http://www.example.com/"_ns),
       Some(ZONE_INTERNET), Some(kFallbackUrl)},
      {Some("about:srcdoc"_ns), Some("http://www.example.com/"_ns),
       Some(ZONE_INTERNET), Some(kFallbackUrl)},
      {Some("data:text/html,foo"_ns), Some("http://www.example.com/"_ns),
       Some(ZONE_INTERNET), Some(kFallbackUrl)},
      {Some("http://localhost:8080/"_ns), Some("http://www.example.com/"_ns),
       Some(ZONE_INTRANET)},
      {Some("http://127.0.0.1/"_ns), Some("http://www.example.com/"_ns),
       Some(ZONE_INTERNET)},
      {Some("file://C:/foo"_ns), Some("http://www.example.com/"_ns),
       Some(ZONE_MY_COMPUTER), Some(kFallbackUrl)},
      {Some("file:///C:/foo"_ns), Some("http://www.example.com/"_ns),
       Some(ZONE_MY_COMPUTER), Some(kFallbackUrl)},
      {Some("file://server/share/foo"_ns), Some("http://www.example.com/"_ns),
       Some(ZONE_INTRANET), Some(kFallbackUrl)},
      {Some("file:////server/share/foo"_ns), Some("http://www.example.com/"_ns),
       Some(ZONE_INTRANET), Some(kFallbackUrl)},

      // Userpass on the source URL is stripped from URL and referrer.
      {Some("http://user:pw@www.example.org/"_ns), Some(""_ns),
       Some(ZONE_INTERNET), Some("http://www.example.org/"_ns)},
      {Some("http://www.example.org/"_ns),
       Some("http://user:pw@www.example.com/"_ns), Some(ZONE_INTERNET),
       Nothing() /* mExpectedHostUrl */,
       Some("http://www.example.com/"_ns) /* mExpectedReferrer */},

      // Non-permitted scheme on the referrer => ReferrerUrl line omitted.
      {Some("http://www.example.org/"_ns), Some("about:blank"_ns),
       Some(ZONE_INTERNET), Nothing() /* mExpectedHostUrl */,
       Some(kFallbackReferrer) /* mExpectedReferrer */},

      // No URL or referrer (private browsing -- zone=internet).
      {Nothing(), Nothing(), Some(ZONE_INTERNET)},

      // File to set zone for does not exist.
      {Some("http://www.example.org/"_ns), Some("http://www.example.com/"_ns),
       Nothing()},
      {Nothing(), Nothing(), Nothing()},

      // Not expected from nsIFile but included for completeness.
      {Some("\\\\server\\share\\foo"_ns), Some(""_ns), Some(ZONE_INTRANET),
       Some(kFallbackUrl)},
  };

  for (auto& data : fileTestDatas) {
    SetAndTestFileZone(data);
  }
}
