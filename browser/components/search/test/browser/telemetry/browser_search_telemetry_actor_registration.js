/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/*
 * Tests that the SearchSERPTelemetry window actor is dynamically registered
 * and unregistered based on provider match patterns.
 */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  RemoteSettings: "resource://services-settings/remote-settings.sys.mjs",
  SERPTelemetryActorHelper:
    "moz-src:///browser/components/search/SearchSERPTelemetry.sys.mjs",
  TELEMETRY_SETTINGS_KEY:
    "moz-src:///browser/components/search/SearchSERPTelemetry.sys.mjs",
});

const ACTOR_NAME = "SearchSERPTelemetry";

const BASE_PROVIDER = {
  telemetryId: "example",
  searchPageRegexp:
    /^https:\/\/example.org\/browser\/browser\/components\/search\/test\/browser\/telemetry\/searchTelemetry/,
  queryParamNames: ["s"],
  codeParamName: "abc",
  taggedCodes: ["ff"],
  extraAdServersRegexps: [/^https:\/\/example\.com\/ad2?/],
  components: [
    {
      type: SearchSERPTelemetryUtils.COMPONENTS.AD_LINK,
      default: true,
    },
  ],
};

const PROVIDER_WITH_MATCHES = [
  {
    ...BASE_PROVIDER,
    searchPageMatches: ["https://example.org/*"],
  },
];

const PROVIDER_WITHOUT_MATCHES = [{ ...BASE_PROVIDER }];

const PROVIDER_WITH_DIFFERENT_MATCHES = [
  {
    ...BASE_PROVIDER,
    searchPageMatches: ["https://example.com/*"],
  },
];

// There is no direct API to check if a window actor is registered. The
// idiomatic way is to attempt registration and catch the NotSupportedError
// that is thrown if the actor is already registered.
function isActorRegistered() {
  try {
    ChromeUtils.registerWindowActor(ACTOR_NAME, {});
    // If we get here, it wasn't registered — clean up and return false.
    ChromeUtils.unregisterWindowActor(ACTOR_NAME);
    return false;
  } catch (ex) {
    return ex.name === "NotSupportedError";
  }
}

add_setup(async function () {
  await waitForIdle();

  registerCleanupFunction(async () => {
    SearchSERPTelemetry.overrideSearchTelemetryForTests();
    resetTelemetry();
  });
});

add_task(async function test_actor_registered_after_override() {
  SearchSERPTelemetry.overrideSearchTelemetryForTests(PROVIDER_WITH_MATCHES);
  await waitForIdle();

  Assert.ok(isActorRegistered(), "Actor should be registered after override.");
});

add_task(async function test_actor_registered_with_fallback_when_no_matches() {
  SearchSERPTelemetry.overrideSearchTelemetryForTests(PROVIDER_WITHOUT_MATCHES);
  await waitForIdle();

  Assert.ok(
    isActorRegistered(),
    "Actor should still be registered via fallback when no searchPageMatches."
  );
});

add_task(async function test_actor_fires_on_matching_url() {
  SearchSERPTelemetry.overrideSearchTelemetryForTests(PROVIDER_WITH_MATCHES);
  await waitForIdle();

  let url = getSERPUrl("searchTelemetryAd.html");
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);
  await waitForPageWithAdImpressions();

  let impressions = Glean.serp.impression.testGetValue() ?? [];
  Assert.greater(
    impressions.length,
    0,
    "Actor should fire an impression on a URL matching searchPageMatches."
  );

  await BrowserTestUtils.removeTab(tab);
  resetTelemetry();
});

add_task(async function test_actor_does_not_fire_on_non_matching_url() {
  // Register actor only for example.com, then load an example.org SERP.
  SearchSERPTelemetry.overrideSearchTelemetryForTests(
    PROVIDER_WITH_DIFFERENT_MATCHES
  );
  await waitForIdle();

  let url = getSERPUrl("searchTelemetryAd.html"); // example.org URL
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);
  await waitForIdle();

  let impressions = Glean.serp.impression.testGetValue() ?? [];
  Assert.equal(
    impressions.length,
    0,
    "Actor should not fire an impression on a URL outside searchPageMatches."
  );

  await BrowserTestUtils.removeTab(tab);
  resetTelemetry();
});

add_task(async function test_actor_rereg_on_settings_sync_with_new_patterns() {
  SearchSERPTelemetry.overrideSearchTelemetryForTests(PROVIDER_WITH_MATCHES);
  await waitForIdle();

  // Sync Remote Settings with a provider that has different match patterns.
  let client = RemoteSettings(TELEMETRY_SETTINGS_KEY);
  let synced = TestUtils.topicObserved("search-telemetry-v2-synced");
  await client.emit("sync", {
    data: {
      current: PROVIDER_WITH_DIFFERENT_MATCHES,
      created: [],
      updated: PROVIDER_WITH_DIFFERENT_MATCHES,
      deleted: [],
    },
  });
  await synced;

  // Actor should still be registered (with updated patterns).
  Assert.ok(
    isActorRegistered(),
    "Actor should remain registered after Remote Settings sync."
  );

  // example.org should no longer match since patterns changed to example.com.
  let url = getSERPUrl("searchTelemetryAd.html"); // example.org URL
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);
  await waitForIdle();

  let impressions = Glean.serp.impression.testGetValue() ?? [];
  Assert.equal(
    impressions.length,
    0,
    "After sync, actor should not fire for a URL no longer in searchPageMatches."
  );

  await BrowserTestUtils.removeTab(tab);
  resetTelemetry();
});

add_task(async function test_actor_not_rereg_when_patterns_unchanged() {
  SearchSERPTelemetry.overrideSearchTelemetryForTests(PROVIDER_WITH_MATCHES);
  await waitForIdle();

  // Spy on unregisterWindowActor to verify it's not called unnecessarily.
  let unregisterCalled = false;
  let origUnregister = ChromeUtils.unregisterWindowActor.bind(ChromeUtils);
  ChromeUtils.unregisterWindowActor = name => {
    if (name === ACTOR_NAME) {
      unregisterCalled = true;
    }
    origUnregister(name);
  };

  // Sync with the same patterns.
  let client = RemoteSettings(TELEMETRY_SETTINGS_KEY);
  let synced = TestUtils.topicObserved("search-telemetry-v2-synced");
  await client.emit("sync", {
    data: {
      current: PROVIDER_WITH_MATCHES,
      created: [],
      updated: PROVIDER_WITH_MATCHES,
      deleted: [],
    },
  });
  await synced;

  ChromeUtils.unregisterWindowActor = origUnregister;

  Assert.ok(
    !unregisterCalled,
    "Actor should not be unregistered when match patterns have not changed."
  );
});
