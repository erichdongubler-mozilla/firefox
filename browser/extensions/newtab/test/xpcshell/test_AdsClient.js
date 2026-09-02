/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AdsClient: "resource://newtab/lib/AdsClient.sys.mjs",
  _AdsClient: "resource://newtab/lib/AdsClient.sys.mjs",
  TestUtils: "resource://testing-common/TestUtils.sys.mjs",
  sinon: "resource://testing-common/Sinon.sys.mjs",
  BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
});

const PREF_UNIFIED_ADS_ADSCLIENT_ENABLED = "unifiedAds.adsClient.enabled";

// These consts are copied from the update timer manager test. See
// `initUpdateTimerManager()`.
const PREF_APP_UPDATE_TIMERMINIMUMDELAY = "app.update.timerMinimumDelay";
const PREF_APP_UPDATE_TIMERFIRSTINTERVAL = "app.update.timerFirstInterval";
const MAIN_TIMER_INTERVAL = 1000; // milliseconds
const CATEGORY_UPDATE_TIMER = "update-timer";

/**
 * Sets up the update timer manager for testing: makes it fire more often,
 * removes all existing timers, and initializes it for testing. The body of this
 * function is copied from:
 * https://searchfox.org/firefox-main/source/toolkit/components/timermanager/tests/unit/consumerNotifications.js
 */
function initUpdateTimerManager() {
  // Set the timer to fire every second
  Services.prefs.setIntPref(
    PREF_APP_UPDATE_TIMERMINIMUMDELAY,
    MAIN_TIMER_INTERVAL / 1000
  );
  Services.prefs.setIntPref(
    PREF_APP_UPDATE_TIMERFIRSTINTERVAL,
    MAIN_TIMER_INTERVAL
  );

  // Remove existing update timers to prevent them from being notified
  for (let { data: entry } of Services.catMan.enumerateCategory(
    CATEGORY_UPDATE_TIMER
  )) {
    Services.catMan.deleteCategoryEntry(CATEGORY_UPDATE_TIMER, entry, false);
  }

  Cc["@mozilla.org/updates/timer-manager;1"]
    .getService(Ci.nsIUpdateTimerManager)
    .QueryInterface(Ci.nsIObserver)
    .observe(null, "utm-test-init", "");
}

let gSandbox;
add_setup(() => {
  gSandbox = lazy.sinon.createSandbox();
  initUpdateTimerManager();
  Services.prefs.setBoolPref(PREF_UNIFIED_ADS_ADSCLIENT_ENABLED, true);
  registerCleanupFunction(() => {
    Services.prefs.clearUserPref(PREF_UNIFIED_ADS_ADSCLIENT_ENABLED);
    gSandbox.restore();
  });
});

add_setup(function test_setup_fog() {
  do_get_profile();
  Services.fog.initializeFOG();
});

add_task(function test_isEnabled() {
  Assert.strictEqual(
    lazy.AdsClient.isEnabled({}),
    false,
    "Gated off by default (no pref, no trainhopConfig)"
  );

  Assert.strictEqual(
    lazy.AdsClient.isEnabled(undefined),
    false,
    "Gated off when prefs are missing"
  );

  Assert.strictEqual(
    lazy.AdsClient.isEnabled({ [PREF_UNIFIED_ADS_ADSCLIENT_ENABLED]: true }),
    true,
    "Enabled by the local about:config pref"
  );

  Assert.strictEqual(
    lazy.AdsClient.isEnabled({
      trainhopConfig: { adsClient: { enabled: true } },
    }),
    true,
    "Enabled by trainhopConfig.adsClient.enabled"
  );

  Assert.strictEqual(
    lazy.AdsClient.isEnabled({
      trainhopConfig: { adsClient: { enabled: false } },
    }),
    false,
    "Disabled when trainhopConfig.adsClient.enabled is false"
  );
});

add_task(function test_getClient_singleton() {
  const adsClient = new lazy._AdsClient();

  const client = adsClient.getClient();
  Assert.ok(client, "getClient builds and returns a MozAdsClient");

  const sameClient = adsClient.getClient();
  Assert.strictEqual(
    sameClient,
    client,
    "getClient returns the same cached singleton"
  );
});

add_task(async function test_getClient_opensCacheDatabase() {
  const adsClient = new lazy._AdsClient();
  Assert.ok(adsClient.getClient(), "getClient built a MozAdsClient");

  Assert.ok(
    await IOUtils.exists(adsClient.cacheConfig.dbPath),
    "Building the client opened the SQLite HTTP cache in the profile"
  );
});

add_task(function test_buildTelemetry_recordsToGlean() {
  Services.fog.testResetFOG();

  const telemetry = new lazy._AdsClient().buildTelemetry();

  telemetry.recordBuildCacheError("empty_db_path", "the db path is empty");
  Assert.equal(
    Glean.adsClient.buildCacheError.empty_db_path.testGetValue(),
    "the db path is empty",
    "recordBuildCacheError sets ads_client.build_cache_error"
  );

  telemetry.recordClientError("request_ads", "network error");
  Assert.equal(
    Glean.adsClient.clientError.request_ads.testGetValue(),
    "network error",
    "recordClientError sets ads_client.client_error"
  );

  telemetry.recordClientOperationTotal("request_ads");
  telemetry.recordClientOperationTotal("request_ads");
  Assert.equal(
    Glean.adsClient.clientOperationTotal.request_ads.testGetValue(),
    2,
    "recordClientOperationTotal increments ads_client.client_operation_total"
  );

  telemetry.recordDeserializationError("invalid_ad_item", "expected an object");
  Assert.equal(
    Glean.adsClient.deserializationError.invalid_ad_item.testGetValue(),
    "expected an object",
    "recordDeserializationError sets ads_client.deserialization_error"
  );

  telemetry.recordHttpCacheOutcome("hit", "");
  Assert.equal(
    Glean.adsClient.httpCacheOutcome.hit.testGetValue(),
    "",
    "recordHttpCacheOutcome sets ads_client.http_cache_outcome"
  );

  // trim_failed is emitted by MozAdsTelemetryWrapper but was missing from the
  // component's own label list, so make sure it does not land in __other__.
  telemetry.recordHttpCacheOutcome("trim_failed", "trim boom");
  Assert.equal(
    Glean.adsClient.httpCacheOutcome.trim_failed.testGetValue(),
    "trim boom",
    "trim_failed is a declared label"
  );
  Assert.equal(
    Glean.adsClient.httpCacheOutcome.__other__.testGetValue(),
    null,
    "no label overflowed into __other__"
  );
});

// A trainhopped New Tab can run on a Firefox whose libxul predates these
// metrics, and the runtime registration that backfills them is not awaited.
add_task(function test_buildTelemetry_survivesMissingMetrics() {
  Services.fog.testResetFOG();

  const telemetry = new lazy._AdsClient().buildTelemetry(() => undefined);

  telemetry.recordBuildCacheError("empty_db_path", "boom");
  telemetry.recordClientError("request_ads", "boom");
  telemetry.recordClientOperationTotal("request_ads");
  telemetry.recordDeserializationError("invalid_ad_item", "boom");
  telemetry.recordHttpCacheOutcome("hit", "");

  // Reaching here means nothing threw. Also check nothing fell back to the
  // real category behind our back.
  Assert.equal(
    Glean.adsClient.clientError.request_ads.testGetValue(),
    null,
    "no string metric recorded when ads_client is not registered"
  );
  Assert.equal(
    Glean.adsClient.clientOperationTotal.request_ads.testGetValue(),
    null,
    "no counter incremented when ads_client is not registered"
  );
});

// The category is resolved per recording, so metrics registered after the
// client was built are still picked up.
add_task(function test_buildTelemetry_resolvesMetricsLate() {
  Services.fog.testResetFOG();

  let category;
  const telemetry = new lazy._AdsClient().buildTelemetry(() => category);

  telemetry.recordClientError("report_ad", "dropped while unregistered");
  Assert.equal(
    Glean.adsClient.clientError.report_ad.testGetValue(),
    null,
    "recordings before registration are dropped"
  );

  category = Glean.adsClient;
  telemetry.recordClientError("report_ad", "recorded once available");

  Assert.equal(
    Glean.adsClient.clientError.report_ad.testGetValue(),
    "recorded once available",
    "the late-registered category is used without rebuilding the client"
  );
});

add_task(async function test_shutdown_blocker() {
  Services.prefs.setBoolPref(PREF_UNIFIED_ADS_ADSCLIENT_ENABLED, true);

  const adsClient = new lazy._AdsClient();
  Assert.ok(
    !adsClient.uninitialized,
    "adsClient should not be uninitialized yet"
  );

  const client = adsClient.getClient();
  Assert.ok(client, "getClient builds and returns a MozAdsClient");

  await lazy.TestUtils.waitForTick();
  gSandbox.spy(lazy.AdsClient, "uninit");

  // Simulate shutdown.
  await lazy.BrowserUtils.callModulesFromCategory(
    { categoryName: "browser-quit-application-granted" },
    null
  );
  await lazy.TestUtils.waitForCondition(
    () => lazy.AdsClient.uninit.calledOnce,
    "The `uninit` function should be called on shutdown"
  );
  Assert.ok(adsClient.uninitialized, "adsClient should now be uninitialized");

  Services.prefs.clearUserPref(PREF_UNIFIED_ADS_ADSCLIENT_ENABLED);
  adsClient._reset_shutdown_happened();
  gSandbox.restore();
});

add_task(async function test_dont_register_blocker_if_in_shutdown() {
  // Test a corner case: the AdsClient is initialized during shutdown.
  //
  // In this case it shouldn't register a shutdown blocker, because it's too late to do that.
  // Instead, it should just immediately uninitialize itself.
  //
  // See adjacent bug for ContextRelevancyManager https://bugzilla.mozilla.org/show_bug.cgi?id=1990569
  Services.prefs.setBoolPref(PREF_UNIFIED_ADS_ADSCLIENT_ENABLED, true);
  await lazy.TestUtils.waitForTick();

  // Create static version of adsClient.
  const adsClient = new lazy._AdsClient();
  Assert.ok(
    !adsClient.uninitialized,
    "adsClient should not be uninitialized yet"
  );

  // Fire event and ensure method runs before creating an adsClient instance. `uninit` method will be called on the static `AdsClient`
  gSandbox.spy(lazy.AdsClient, "uninit");
  await lazy.BrowserUtils.callModulesFromCategory(
    { categoryName: "browser-quit-application-granted" },
    null
  );
  await lazy.TestUtils.waitForCondition(
    () => lazy.AdsClient.uninit.calledOnce,
    "The `uninit` function should be called statically"
  );
  Assert.ok(
    adsClient.uninitialized,
    "adsClient should have uninitialized itself"
  );

  // Now create instance and ensure uninitialization is not reset.
  // `uninit` function will get called again, but this time on instance `adsClient` (because it is called within #build)
  gSandbox.spy(adsClient, "uninit");
  adsClient.getClient();
  await lazy.TestUtils.waitForCondition(
    () => adsClient.uninit.calledOnce,
    "The `uninit` function should be called immediately on startup if already uninitialized"
  );
  Assert.ok(adsClient.uninitialized, "adsClient should remain uninitialized");

  Services.prefs.clearUserPref(PREF_UNIFIED_ADS_ADSCLIENT_ENABLED);
  adsClient._reset_shutdown_happened();
  gSandbox.restore();
});
