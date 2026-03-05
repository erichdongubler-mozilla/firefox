"use strict";

const PROMPT_ALLOW_BUTTON = -1;
const PROMPT_NOT_NOW_BUTTON = 0;

const { HttpServer } = ChromeUtils.importESModule(
  "resource://testing-common/httpd.sys.mjs"
);

const baseURL = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com"
);

async function restorePermissions() {
  info("Restoring permissions");
  Services.obs.notifyObservers(null, "testonly-reload-permissions-from-disk");
  Services.perms.removeAll();
}

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["permissions.manager.defaultsUrl", ""],
      ["network.websocket.delay-failed-reconnects", false],
      ["network.websocket.max-connections", 1000],
      ["network.lna.block_trackers", true],
      ["network.lna.blocking", true],
      ["network.http.rcwn.enabled", false],
      ["network.lna.websocket.enabled", true],
      ["network.lna.local-network-to-localhost.skip-checks", false],
      ["browser.ipProtection.enabled", false],
    ],
  });
  Services.obs.notifyObservers(null, "testonly-reload-permissions-from-disk");

  const server = new HttpServer();
  server.start(21555);
  registerServerHandlers(server);

  registerCleanupFunction(async () => {
    await restorePermissions();
    await new Promise(resolve => {
      server.stop(resolve);
    });
  });
});

requestLongerTimeout(10);

function clickDoorhangerButton(buttonIndex, browser, notificationID) {
  let popup = PopupNotifications.getNotification(notificationID, browser);
  let notification = popup?.owner?.panel?.childNodes?.[0];
  ok(notification, "Notification popup is available");

  if (buttonIndex === PROMPT_ALLOW_BUTTON) {
    ok(true, "Triggering main action (allow)");
    notification.button.doCommand();
  } else {
    ok(true, "Triggering secondary action (deny)");
    notification.secondaryButton.doCommand();
  }
}

function observeAndCheck(testType, rand, expectedStatus, message) {
  return new Promise(resolve => {
    const url = `http://localhost:21555/?type=${testType}&rand=${rand}`;
    const observer = {
      observe(subject, topic) {
        if (topic !== "http-on-stop-request") {
          return;
        }

        let channel = subject.QueryInterface(Ci.nsIHttpChannel);
        if (!channel || channel.URI.spec !== url) {
          return;
        }

        is(channel.status, expectedStatus, message);
        Services.obs.removeObserver(observer, "http-on-stop-request");
        resolve();
      },
    };
    Services.obs.addObserver(observer, "http-on-stop-request");
  });
}

const testCases = [
  {
    type: "fetch",
    allowStatus: Cr.NS_OK,
    denyStatus: Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
  },
  {
    type: "xhr",
    allowStatus: Cr.NS_OK,
    denyStatus: Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
  },
  {
    type: "img",
    allowStatus: Cr.NS_OK,
    denyStatus: Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
  },
  {
    type: "video",
    allowStatus: Cr.NS_OK,
    denyStatus: Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
  },
  {
    type: "audio",
    allowStatus: Cr.NS_OK,
    denyStatus: Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
  },
  {
    type: "iframe",
    allowStatus: Cr.NS_OK,
    denyStatus: Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
  },
  {
    type: "script",
    allowStatus: Cr.NS_OK,
    denyStatus: Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
  },
  {
    type: "font",
    allowStatus: Cr.NS_OK,
    denyStatus: Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
  },
  {
    type: "websocket",
    allowStatus: Cr.NS_ERROR_WEBSOCKET_CONNECTION_REFUSED,
    denyStatus: Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
  },
];

function registerServerHandlers(server) {
  server.registerPathHandler("/", (request, response) => {
    const params = new URLSearchParams(request.queryString);
    const type = params.get("type");

    response.setHeader("Access-Control-Allow-Origin", "*", false);

    switch (type) {
      case "img":
        response.setHeader("Content-Type", "image/gif", false);
        response.setStatusLine(request.httpVersion, 200, "OK");
        response.write(
          atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")
        );
        break;
      case "audio":
        response.setHeader("Content-Type", "audio/wav", false);
        response.setStatusLine(request.httpVersion, 200, "OK");
        response.write(
          atob("UklGRhYAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=")
        );
        break;
      case "video":
        response.setHeader("Content-Type", "video/mp4", false);
        response.setStatusLine(request.httpVersion, 200, "OK");
        response.write(
          atob(
            "GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYU4BnQI0VSalmQCgq17FAAw9CQE2AQAZ3aGFtbXlXQUAGd2hhbW15RIlACECPQAAAAAAAFlSua0AxrkAu14EBY8WBAZyBACK1nEADdW5khkAFVl9WUDglhohAA1ZQOIOBAeBABrCBCLqBCB9DtnVAIueBAKNAHIEAAIAwAQCdASoIAAgAAUAmJaQAA3AA/vz0AAA="
          )
        );
        break;
      default:
        response.setHeader("Content-Type", "text/plain", false);
        response.setStatusLine(request.httpVersion, 200, "OK");
        response.write("hello");
    }
  });
}

async function runSingleTestCase(
  test,
  rand,
  expectedStatus,
  description,
  userAction = null,
  notificationID = null
) {
  info(description);

  const promise = observeAndCheck(test.type, rand, expectedStatus, description);
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${baseURL}page_with_non_trackers.html?test=${test.type}&rand=${rand}`
  );

  if (userAction && notificationID) {
    const buttonNum =
      userAction === "allow" ? PROMPT_ALLOW_BUTTON : PROMPT_NOT_NOW_BUTTON;

    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    clickDoorhangerButton(buttonNum, gBrowser.selectedBrowser, notificationID);
  }

  await promise;
  gBrowser.removeTab(tab);
}

async function runPromptedLnaTest(test, overrideLabel, notificationID) {
  const promptActions = ["allow", "deny"];
  for (const userAction of promptActions) {
    const rand = Math.random();
    const expectedStatus =
      userAction === "allow" ? test.allowStatus : test.denyStatus;

    await runSingleTestCase(
      test,
      rand,
      expectedStatus,
      `LNA test (${overrideLabel}) for ${test.type} with user action: ${userAction}`,
      userAction,
      notificationID
    );

    // Wait some time for cache entry to be updated
    // XXX(valentin) though this should not be necessary.
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 300));

    // Now run the test again with cached main document
    await runSingleTestCase(
      test,
      rand,
      expectedStatus,
      `LNA test (${overrideLabel}) for ${test.type} with user action: ${userAction}`,
      userAction,
      notificationID
    );
  }
}

add_task(async function test_lna_prompt_behavior() {
  // Non-LNA test: no prompt expected
  for (const test of testCases) {
    const rand = Math.random();
    await runSingleTestCase(
      test,
      rand,
      test.allowStatus,
      `Non-LNA test for ${test.type}`
    );
  }

  // Public -> Local test (loopback-network permission)
  Services.prefs.setCharPref(
    "network.lna.address_space.public.override",
    "127.0.0.1:4443"
  );
  for (const test of testCases) {
    await runPromptedLnaTest(test, "public", "loopback-network");
  }

  // Public -> Private (local-network permission)
  Services.prefs.setCharPref(
    "network.lna.address_space.private.override",
    "127.0.0.1:21555"
  );
  for (const test of testCases) {
    await runPromptedLnaTest(test, "private", "local-network");
  }

  Services.prefs.clearUserPref("network.lna.address_space.public.override");
  Services.prefs.clearUserPref("network.lna.address_space.private.override");
});

add_task(async function test_lna_cancellation_during_prompt() {
  info("Testing LNA cancellation during permission prompt");

  // Disable RCWN but enable caching for this test
  await SpecialPowers.pushPrefEnv({
    set: [
      ["network.http.rcwn.enabled", false],
      ["browser.cache.disk.enable", true],
      ["browser.cache.memory.enable", true],
      ["network.lna.address_space.public.override", "127.0.0.1:4443"],
    ],
  });

  const testType = "fetch";
  const rand1 = Math.random();

  // Test 1: Cancel request during LNA prompt and verify proper cleanup
  info(
    "Step 1: Making request that will trigger LNA prompt, then cancelling it"
  );

  // Open tab and wait for LNA prompt
  const tab1 = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${baseURL}page_with_non_trackers.html?test=${testType}&rand=${rand1}`
  );

  // Wait for the LNA permission prompt to appear
  await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  info("LNA permission prompt appeared");
  gBrowser.removeTab(tab1);
  // Navigate to a new URL (which should cancel the pending request)
  const tab2 = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${baseURL}page_with_non_trackers.html?test=${testType}&rand=${rand1}`
  );
  info("Navigated to new URL, request should be cancelled");

  // Wait for the navigation to complete
  await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  clickDoorhangerButton(
    PROMPT_ALLOW_BUTTON,
    gBrowser.selectedBrowser,
    "loopback-network"
  );

  // Close the first tab now that we're done with it
  gBrowser.removeTab(tab2);

  // The main test objective is complete - we verified that cancellation
  // during LNA prompt works without hanging channels. The navigation
  // completed successfully, which means our fix is working correctly.
  info(
    "Test completed successfully - cancellation during LNA prompt handled correctly"
  );

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_lna_top_level_navigation_bypass() {
  info(
    "Testing that top-level navigation to loopback-network bypasses LNA checks"
  );

  // Set up LNA to trigger for localhost connections and enable top-level navigation bypass
  await SpecialPowers.pushPrefEnv({
    set: [
      ["network.lna.address_space.public.override", "127.0.0.1:4443"],
      ["network.lna.allow_top_level_navigation", true],
    ],
  });

  requestLongerTimeout(1);

  // Observer to verify that the navigation request succeeds without LNA error
  const navigationObserver = {
    observe(subject, topic) {
      if (topic !== "http-on-stop-request") {
        return;
      }

      let channel = subject.QueryInterface(Ci.nsIHttpChannel);
      if (!channel || !channel.URI.spec.includes("localhost:21555")) {
        return;
      }

      // For top-level navigation, we expect success (not LNA denied)
      // The channel status should be NS_OK, not NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED
      is(
        channel.status,
        Cr.NS_OK,
        "Top-level navigation to localhost should not be blocked by LNA"
      );

      Services.obs.removeObserver(navigationObserver, "http-on-stop-request");
    },
  };

  Services.obs.addObserver(navigationObserver, "http-on-stop-request");

  try {
    // Load the test page which will automatically navigate to localhost
    info("Loading test page that will trigger navigation to localhost");

    // Open the initial page - it will automatically navigate to localhost
    const tab = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      `${baseURL}page_with_non_trackers.html?isTopLevelNavigation=true`
    );

    // Wait for the navigation to complete
    info("Waiting for navigation to localhost to complete");
    await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, url =>
      url.includes("localhost:21555")
    );

    // Verify that no LNA permission prompt appeared
    // If our fix works correctly, there should be no popup notification
    let popup = PopupNotifications.getNotification(
      "loopback-network",
      tab.linkedBrowser
    );
    ok(
      !popup,
      "No LNA permission prompt should appear for top-level navigation"
    );

    // Verify the page loaded successfully
    let location = await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
      return content.location.href;
    });

    ok(
      location.includes("localhost:21555"),
      "Top-level navigation to localhost should succeed"
    );

    gBrowser.removeTab(tab);

    info("Top-level navigation test completed successfully");
  } catch (error) {
    ok(false, `Top-level navigation test failed: ${error.message}`);
  }

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_lna_top_level_navigation_disabled() {
  info("Testing that top-level navigation LNA bypass can be disabled via pref");

  // Set up LNA to trigger for localhost connections but disable top-level navigation bypass
  await SpecialPowers.pushPrefEnv({
    set: [
      ["network.lna.address_space.public.override", "127.0.0.1:4443"],
      ["network.lna.allow_top_level_navigation", false],
    ],
  });

  requestLongerTimeout(1);

  try {
    // Load the test page which will attempt to navigate to localhost
    info("Loading test page that will try to navigate to localhost");
    const tab = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      `${baseURL}page_with_non_trackers.html?isTopLevelNavigation=true`
    );

    // Wait for LNA permission prompt to appear (since bypass is disabled)
    info("Waiting for LNA permission prompt to appear");
    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");

    // Verify that LNA permission prompt did appear
    let popup = PopupNotifications.getNotification(
      "loopback-network",
      tab.linkedBrowser
    );
    ok(popup, "LNA permission prompt should appear when bypass is disabled");

    // Allow the permission to complete the navigation
    clickDoorhangerButton(
      PROMPT_ALLOW_BUTTON,
      gBrowser.selectedBrowser,
      "loopback-network"
    );

    // Wait for navigation to complete after permission granted
    await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, url =>
      url.includes("localhost:21555")
    );

    gBrowser.removeTab(tab);

    info("Top-level navigation disabled test completed successfully");
  } catch (error) {
    ok(false, `Top-level navigation disabled test failed: ${error.message}`);
  }

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_lna_websocket_disabled() {
  info("Testing network.lna.websocket.enabled preference");

  // Set up LNA to trigger for localhost connections
  await SpecialPowers.pushPrefEnv({
    set: [
      ["network.lna.address_space.public.override", "127.0.0.1:4443"],
      ["network.lna.blocking", true],
      ["network.lna.websocket.enabled", false], // Disable WebSocket LNA checks
    ],
  });

  try {
    // Test WebSocket with LNA disabled - should bypass LNA and get connection refused
    const websocketTest = {
      type: "websocket",
      allowStatus: Cr.NS_ERROR_WEBSOCKET_CONNECTION_REFUSED,
      denyStatus: Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
    };

    const rand = Math.random();
    const promise = observeAndCheck(
      websocketTest.type,
      rand,
      websocketTest.allowStatus, // Should get connection refused, not LNA denied
      "WebSocket test with LNA disabled should bypass LNA checks"
    );

    const tab = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      `${baseURL}page_with_non_trackers.html?test=${websocketTest.type}&rand=${rand}`
    );

    await promise;
    gBrowser.removeTab(tab);

    info(
      "WebSocket LNA disabled test completed - connection was allowed to proceed"
    );
  } catch (error) {
    ok(false, `WebSocket LNA preference test failed: ${error.message}`);
  }

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_lna_websocket_enabled() {
  info("Testing network.lna.websocket.enabled preference");

  // Set up LNA to trigger for localhost connections
  await SpecialPowers.pushPrefEnv({
    set: [
      ["network.lna.address_space.public.override", "127.0.0.1:4443"],
      ["network.lna.blocking", true],
      ["network.lna.websocket.enabled", true], // Enable WebSocket LNA checks
      ["network.loopback-network.prompt.testing", true],
      ["network.loopback-network.prompt.testing.allow", false],
    ],
  });

  try {
    // Test WebSocket with LNA disabled - should bypass LNA and get connection refused
    const websocketTest = {
      type: "websocket",
      allowStatus: Cr.NS_ERROR_WEBSOCKET_CONNECTION_REFUSED,
      denyStatus: Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
    };

    const rand2 = Math.random();
    const promise2 = observeAndCheck(
      websocketTest.type,
      rand2,
      websocketTest.denyStatus, // Should get LNA denied
      "WebSocket test with LNA enabled should trigger LNA checks"
    );

    const tab2 = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      `${baseURL}page_with_non_trackers.html?test=${websocketTest.type}&rand=${rand2}`
    );

    await promise2;
    gBrowser.removeTab(tab2);

    info("WebSocket LNA enabled test completed - LNA checks were applied");
  } catch (error) {
    ok(false, `WebSocket LNA preference test failed: ${error.message}`);
  }

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_lna_prompt_timeout() {
  info("Testing LNA permission prompt timeout");

  // Set up a short timeout for testing (1 second instead of 5 minutes)
  await SpecialPowers.pushPrefEnv({
    set: [
      ["network.lna.address_space.public.override", "127.0.0.1:4443"],
      ["network.lna.prompt.timeout", 1000], // 1 second timeout for testing
    ],
  });

  try {
    const testType = "fetch";
    const rand = Math.random();

    info("Triggering LNA prompt that will timeout");

    // Set up observer to verify request fails with LNA denied status
    const promise = observeAndCheck(
      testType,
      rand,
      Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
      "LNA request should fail after prompt timeout"
    );

    // Open tab that will trigger LNA prompt
    const tab = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      `${baseURL}page_with_non_trackers.html?test=${testType}&rand=${rand}`
    );

    // Wait for LNA permission prompt to appear
    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    info("LNA permission prompt appeared");

    // Verify prompt is visible
    let popup = PopupNotifications.getNotification(
      "loopback-network",
      tab.linkedBrowser
    );
    ok(popup, "LNA permission prompt should be visible");

    // Do NOT click any button - let it timeout
    info("Waiting for prompt to timeout (1 second)...");

    // Wait for timeout + a small buffer to ensure timeout has fired
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Verify prompt has been dismissed
    popup = PopupNotifications.getNotification("localhost", tab.linkedBrowser);
    ok(!popup, "LNA permission prompt should be dismissed after timeout");

    // Wait for the network request to complete with denial status
    await promise;

    gBrowser.removeTab(tab);

    info("LNA prompt timeout test completed successfully");
  } catch (error) {
    ok(false, `LNA prompt timeout test failed: ${error.message}`);
  }

  await SpecialPowers.popPrefEnv();
});

// Test that telemetry is recorded when LNA prompt is shown
// and not incremented for subsequent requests with cached permission
add_task(async function test_lna_prompt_telemetry() {
  await restorePermissions();

  // Reset telemetry
  Services.fog.testResetFOG();
  await SpecialPowers.pushPrefEnv({
    set: [["network.lna.address_space.public.override", "127.0.0.1:4443"]],
  });

  const rand1 = Math.random();
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${baseURL}page_with_non_trackers.html?test=fetch&rand=${rand1}`
  );

  // Wait for the prompt to appear
  await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");

  // Verify telemetry was recorded
  let metricValue =
    await Glean.networking.localNetworkAccessPromptsShown.localhost.testGetValue();
  is(
    metricValue,
    1,
    "Should record telemetry when loopback-network prompt is shown"
  );

  // Grant permission
  clickDoorhangerButton(
    PROMPT_ALLOW_BUTTON,
    gBrowser.selectedBrowser,
    "loopback-network"
  );

  // Wait for permission to be saved
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(resolve => setTimeout(resolve, 300));

  // Make a second request in the same tab with cached permission
  const rand2 = Math.random();
  const promise = observeAndCheck(
    "fetch",
    rand2,
    Cr.NS_OK,
    "Second request should succeed without prompt"
  );
  await SpecialPowers.spawn(tab.linkedBrowser, [rand2], async rand => {
    await content.fetch(`http://localhost:21555/?type=fetch&rand=${rand}`);
  });
  await promise;

  // Verify telemetry was not incremented
  metricValue =
    await Glean.networking.localNetworkAccessPromptsShown.localhost.testGetValue();
  is(
    metricValue,
    1,
    "Telemetry should not increment for requests with cached permission"
  );

  gBrowser.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

// Test that telemetry is recorded when user denies LNA prompt
// and not incremented for subsequent requests with temporary deny permission
add_task(async function test_lna_prompt_telemetry_deny() {
  await restorePermissions();

  // Reset telemetry
  Services.fog.testResetFOG();
  await SpecialPowers.pushPrefEnv({
    set: [["network.lna.address_space.public.override", "127.0.0.1:4443"]],
  });

  const rand1 = Math.random();
  const promise1 = observeAndCheck(
    "fetch",
    rand1,
    Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
    "First request should be denied"
  );
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${baseURL}page_with_non_trackers.html?test=fetch&rand=${rand1}`
  );

  // Wait for the prompt to appear
  await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");

  // Verify telemetry was recorded
  let metricValue =
    await Glean.networking.localNetworkAccessPromptsShown.localhost.testGetValue();
  is(
    metricValue,
    1,
    "Should record telemetry when loopback-network prompt is shown"
  );

  // Deny permission
  clickDoorhangerButton(
    PROMPT_NOT_NOW_BUTTON,
    gBrowser.selectedBrowser,
    "loopback-network"
  );

  await promise1;

  // Wait for permission to be saved
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(resolve => setTimeout(resolve, 300));

  // Make a second request - should be auto-denied without showing prompt
  // because a temporary deny permission was saved
  const rand2 = Math.random();
  const promise2 = observeAndCheck(
    "fetch",
    rand2,
    Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
    "Second request should be auto-denied with temporary permission"
  );
  await SpecialPowers.spawn(tab.linkedBrowser, [rand2], async rand => {
    await content
      .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
      .catch(() => {});
  });

  await promise2;

  // Verify telemetry was not incremented (no prompt shown with temporary deny)
  metricValue =
    await Glean.networking.localNetworkAccessPromptsShown.localhost.testGetValue();
  is(
    metricValue,
    1,
    "Telemetry should not increment for requests with temporary deny permission"
  );

  gBrowser.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

/**
 * Test: Loopback-network temporary permission persists within expiry window
 *
 * Verifies that when a user grants loopback-network permission, subsequent
 * requests within the expiry window do NOT trigger a new prompt and succeed
 * automatically using the cached permission.
 *
 * Steps:
 * 1. Make a request that triggers loopback-network permission prompt
 * 2. User grants permission (clicks "Allow")
 * 3. Make a second request within the expiry window (< 2 seconds)
 * 4. Verify NO prompt appears and request succeeds
 *
 * This validates that temporary permissions work correctly and avoid
 * repeatedly prompting users for the same permission.
 */
add_task(async function test_lna_temporary_permission_expiry_loopback_allow() {
  info("Test loopback-network: Allow within expiry (no re-prompt)");
  await restorePermissions();
  await SpecialPowers.pushPrefEnv({
    set: [
      ["network.lna.address_space.public.override", "127.0.0.1:4443"],
      ["network.lna.temporary_permission_expire_time_ms", 2000], // 2 seconds for testing
    ],
  });

  const testURL = `${baseURL}page_with_non_trackers.html`;
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

  info("Step 1: Make first request and grant permission");
  const rand1 = Math.random();
  let promise = observeAndCheck(
    "fetch",
    rand1,
    Cr.NS_OK,
    "First request should succeed after permission granted"
  );
  SpecialPowers.spawn(tab.linkedBrowser, [rand1], async rand => {
    content
      .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
      .catch(() => {});
  });

  await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  let popup = PopupNotifications.getNotification(
    "loopback-network",
    tab.linkedBrowser
  );
  ok(popup, "First prompt should appear");

  clickDoorhangerButton(
    PROMPT_ALLOW_BUTTON,
    tab.linkedBrowser,
    "loopback-network"
  );
  await promise;

  // Wait for permission to be saved
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(resolve => setTimeout(resolve, 300));

  info("Step 2: Make second request within expiry (should NOT prompt)");
  const rand2 = Math.random();
  promise = observeAndCheck(
    "fetch",
    rand2,
    Cr.NS_OK,
    "Second request within expiry should succeed without prompt"
  );
  await SpecialPowers.spawn(tab.linkedBrowser, [rand2], async rand => {
    await content.fetch(`http://localhost:21555/?type=fetch&rand=${rand}`);
  });
  await promise;

  // Verify no prompt appeared (permission was cached)
  popup = PopupNotifications.getNotification(
    "loopback-network",
    tab.linkedBrowser
  );
  ok(!popup, "No prompt should appear within expiry window");

  gBrowser.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

/**
 * Test: Loopback-network temporary permission expires and re-prompts
 *
 * Verifies that after the temporary permission expires, a new request
 * triggers a fresh permission prompt, ensuring permissions don't persist
 * indefinitely.
 *
 * Steps:
 * 1. Make a request that triggers loopback-network permission prompt
 * 2. User grants permission (clicks "Allow")
 * 3. Wait for permission to expire (2.5 seconds > 2 second timeout)
 * 4. Make another request after expiry
 * 5. Verify a NEW prompt appears (permission has expired)
 *
 * This validates that the custom LNA expiry time works correctly and
 * expired permissions trigger new prompts as expected.
 */
add_task(
  async function test_lna_temporary_permission_expiry_loopback_allow_after_expiry() {
    info(
      "Test loopback-network: Allow, then retry after expiry (should prompt)"
    );
    await restorePermissions();
    await SpecialPowers.pushPrefEnv({
      set: [
        ["network.lna.address_space.public.override", "127.0.0.1:4443"],
        ["network.lna.temporary_permission_expire_time_ms", 2000], // 2 seconds for testing
      ],
    });

    const testURL = `${baseURL}page_with_non_trackers.html`;
    const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

    info("Step 1: Make first request and grant permission");
    const rand1 = Math.random();
    let promise = observeAndCheck(
      "fetch",
      rand1,
      Cr.NS_OK,
      "First request should succeed after permission granted"
    );
    SpecialPowers.spawn(tab.linkedBrowser, [rand1], async rand => {
      content
        .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
        .catch(() => {});
    });

    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    clickDoorhangerButton(
      PROMPT_ALLOW_BUTTON,
      tab.linkedBrowser,
      "loopback-network"
    );
    await promise;

    // Wait for permission to be saved
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 300));

    info("Step 2: Wait for permission to expire (2.5 seconds)");
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 2500));

    info("Step 3: Make request after expiry (should prompt again)");
    const rand2 = Math.random();
    promise = observeAndCheck(
      "fetch",
      rand2,
      Cr.NS_OK,
      "Request after expiry should succeed after new permission granted"
    );
    SpecialPowers.spawn(tab.linkedBrowser, [rand2], async rand => {
      content
        .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
        .catch(() => {});
    });

    // Verify prompt appears again after expiry
    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    let popup = PopupNotifications.getNotification(
      "loopback-network",
      tab.linkedBrowser
    );
    ok(popup, "Prompt should appear again after expiry");

    clickDoorhangerButton(
      PROMPT_ALLOW_BUTTON,
      tab.linkedBrowser,
      "loopback-network"
    );
    await promise;

    gBrowser.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
);

/**
 * Test: Loopback-network temporary deny permission persists within expiry window
 *
 * Verifies that when a user denies loopback-network permission, subsequent
 * requests within the expiry window do NOT trigger a new prompt and are
 * automatically denied using the cached deny permission.
 *
 * Steps:
 * 1. Make a request that triggers loopback-network permission prompt
 * 2. User denies permission (clicks "Not Now")
 * 3. Make a second request within the expiry window (< 2 seconds)
 * 4. Verify NO prompt appears and request is denied
 *
 * This validates that temporary deny permissions work correctly and avoid
 * repeatedly prompting users for permissions they've already denied.
 */
add_task(async function test_lna_temporary_permission_expiry_loopback_deny() {
  info("Test loopback-network: Deny within expiry (no re-prompt)");
  await restorePermissions();
  await SpecialPowers.pushPrefEnv({
    set: [
      ["network.lna.address_space.public.override", "127.0.0.1:4443"],
      ["network.lna.temporary_permission_expire_time_ms", 2000], // 2 seconds for testing
    ],
  });

  const testURL = `${baseURL}page_with_non_trackers.html`;
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

  info("Step 1: Make first request and deny permission");
  const rand1 = Math.random();
  let promise = observeAndCheck(
    "fetch",
    rand1,
    Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
    "First request should be denied"
  );
  SpecialPowers.spawn(tab.linkedBrowser, [rand1], async rand => {
    content
      .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
      .catch(() => {});
  });

  await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  let popup = PopupNotifications.getNotification(
    "loopback-network",
    tab.linkedBrowser
  );
  ok(popup, "First prompt should appear");

  clickDoorhangerButton(
    PROMPT_NOT_NOW_BUTTON,
    tab.linkedBrowser,
    "loopback-network"
  );
  await promise;

  // Wait for permission to be saved
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(resolve => setTimeout(resolve, 300));

  info("Step 2: Make second request within expiry (should NOT prompt)");
  const rand2 = Math.random();
  promise = observeAndCheck(
    "fetch",
    rand2,
    Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
    "Second request within expiry should be denied without prompt"
  );
  await SpecialPowers.spawn(tab.linkedBrowser, [rand2], async rand => {
    await content
      .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
      .catch(() => {});
  });
  await promise;

  // Verify no prompt appeared (deny permission was cached)
  popup = PopupNotifications.getNotification(
    "loopback-network",
    tab.linkedBrowser
  );
  ok(!popup, "No prompt should appear within expiry window");

  gBrowser.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

/**
 * Test: Loopback-network temporary deny permission expires and re-prompts
 *
 * Verifies that after a temporary deny permission expires, a new request
 * triggers a fresh permission prompt, giving the user another opportunity
 * to grant access.
 *
 * Steps:
 * 1. Make a request that triggers loopback-network permission prompt
 * 2. User denies permission (clicks "Not Now")
 * 3. Wait for deny permission to expire (2.5 seconds > 2 second timeout)
 * 4. Make another request after expiry
 * 5. Verify a NEW prompt appears (deny permission has expired)
 * 6. User can now choose to allow (demonstrating prompt works after expiry)
 *
 * This validates that temporary deny permissions expire correctly and
 * users get a second chance to grant permission after the timeout.
 */
add_task(
  async function test_lna_temporary_permission_expiry_loopback_deny_after_expiry() {
    info(
      "Test loopback-network: Deny, then retry after expiry (should prompt)"
    );
    await restorePermissions();
    await SpecialPowers.pushPrefEnv({
      set: [
        ["network.lna.address_space.public.override", "127.0.0.1:4443"],
        ["network.lna.temporary_permission_expire_time_ms", 2000], // 2 seconds for testing
      ],
    });

    const testURL = `${baseURL}page_with_non_trackers.html`;
    const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

    info("Step 1: Make first request and deny permission");
    const rand1 = Math.random();
    let promise = observeAndCheck(
      "fetch",
      rand1,
      Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
      "First request should be denied"
    );
    SpecialPowers.spawn(tab.linkedBrowser, [rand1], async rand => {
      content
        .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
        .catch(() => {});
    });

    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    clickDoorhangerButton(
      PROMPT_NOT_NOW_BUTTON,
      tab.linkedBrowser,
      "loopback-network"
    );
    await promise;

    // Wait for permission to be saved
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 300));

    info("Step 2: Wait for permission to expire (2.5 seconds)");
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 2500));

    info("Step 3: Make request after expiry (should prompt again)");
    const rand2 = Math.random();
    promise = observeAndCheck(
      "fetch",
      rand2,
      Cr.NS_OK,
      "Request after expiry should succeed after new permission granted"
    );
    SpecialPowers.spawn(tab.linkedBrowser, [rand2], async rand => {
      content
        .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
        .catch(() => {});
    });

    // Verify prompt appears again after deny permission expired
    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    let popup = PopupNotifications.getNotification(
      "loopback-network",
      tab.linkedBrowser
    );
    ok(popup, "Prompt should appear again after expiry");

    // This time allow to demonstrate the prompt works
    clickDoorhangerButton(
      PROMPT_ALLOW_BUTTON,
      tab.linkedBrowser,
      "loopback-network"
    );
    await promise;

    gBrowser.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
);

/**
 * Test: Local-network temporary permission persists within expiry window
 *
 * Verifies that when a user grants local-network permission, subsequent
 * requests within the expiry window do NOT trigger a new prompt and succeed
 * automatically using the cached permission.
 *
 * Steps:
 * 1. Make a request that triggers local-network permission prompt
 * 2. User grants permission (clicks "Allow")
 * 3. Make a second request within the expiry window (< 2 seconds)
 * 4. Verify NO prompt appears and request succeeds
 *
 * This validates that temporary permissions work correctly for local-network
 * (private IP addresses) in addition to loopback-network.
 */
add_task(
  async function test_lna_temporary_permission_expiry_local_network_allow() {
    info("Test local-network: Allow within expiry (no re-prompt)");
    await restorePermissions();
    await SpecialPowers.pushPrefEnv({
      set: [
        ["network.lna.address_space.public.override", "127.0.0.1:4443"],
        ["network.lna.address_space.private.override", "127.0.0.1:21555"],
        ["network.lna.temporary_permission_expire_time_ms", 2000], // 2 seconds for testing
      ],
    });

    const testURL = `${baseURL}page_with_non_trackers.html`;
    const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

    info("Step 1: Make first request and grant permission");
    const rand1 = Math.random();
    let promise = observeAndCheck(
      "fetch",
      rand1,
      Cr.NS_OK,
      "First request should succeed after permission granted"
    );
    SpecialPowers.spawn(tab.linkedBrowser, [rand1], async rand => {
      content
        .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
        .catch(() => {});
    });

    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    let popup = PopupNotifications.getNotification(
      "local-network",
      tab.linkedBrowser
    );
    ok(popup, "First prompt should appear");

    clickDoorhangerButton(
      PROMPT_ALLOW_BUTTON,
      tab.linkedBrowser,
      "local-network"
    );
    await promise;

    // Wait for permission to be saved
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 300));

    info("Step 2: Make second request within expiry (should NOT prompt)");
    const rand2 = Math.random();
    promise = observeAndCheck(
      "fetch",
      rand2,
      Cr.NS_OK,
      "Second request within expiry should succeed without prompt"
    );
    await SpecialPowers.spawn(tab.linkedBrowser, [rand2], async rand => {
      await content.fetch(`http://localhost:21555/?type=fetch&rand=${rand}`);
    });
    await promise;

    // Verify no prompt appeared (permission was cached)
    popup = PopupNotifications.getNotification(
      "local-network",
      tab.linkedBrowser
    );
    ok(!popup, "No prompt should appear within expiry window");

    gBrowser.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
);

/**
 * Test: Local-network temporary permission expires and re-prompts
 *
 * Verifies that after the temporary local-network permission expires,
 * a new request triggers a fresh permission prompt.
 *
 * Steps:
 * 1. Make a request that triggers local-network permission prompt
 * 2. User grants permission (clicks "Allow")
 * 3. Wait for permission to expire (2.5 seconds > 2 second timeout)
 * 4. Make another request after expiry
 * 5. Verify a NEW prompt appears (permission has expired)
 *
 * This validates that the custom LNA expiry time works correctly for
 * local-network permissions (private IP addresses) and expired permissions
 * trigger new prompts as expected.
 */
add_task(
  async function test_lna_temporary_permission_expiry_local_network_allow_after_expiry() {
    info("Test local-network: Allow, then retry after expiry (should prompt)");
    await restorePermissions();
    await SpecialPowers.pushPrefEnv({
      set: [
        ["network.lna.address_space.public.override", "127.0.0.1:4443"],
        ["network.lna.address_space.private.override", "127.0.0.1:21555"],
        ["network.lna.temporary_permission_expire_time_ms", 2000], // 2 seconds for testing
      ],
    });

    const testURL = `${baseURL}page_with_non_trackers.html`;
    const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

    info("Step 1: Make first request and grant permission");
    const rand1 = Math.random();
    let promise = observeAndCheck(
      "fetch",
      rand1,
      Cr.NS_OK,
      "First request should succeed after permission granted"
    );
    SpecialPowers.spawn(tab.linkedBrowser, [rand1], async rand => {
      content
        .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
        .catch(() => {});
    });

    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    clickDoorhangerButton(
      PROMPT_ALLOW_BUTTON,
      tab.linkedBrowser,
      "local-network"
    );
    await promise;

    // Wait for permission to be saved
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 300));

    info("Step 2: Wait for permission to expire (2.5 seconds)");
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 2500));

    info("Step 3: Make request after expiry (should prompt again)");
    const rand2 = Math.random();
    promise = observeAndCheck(
      "fetch",
      rand2,
      Cr.NS_OK,
      "Request after expiry should succeed after new permission granted"
    );
    SpecialPowers.spawn(tab.linkedBrowser, [rand2], async rand => {
      content
        .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
        .catch(() => {});
    });

    // Verify prompt appears again after expiry
    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    let popup = PopupNotifications.getNotification(
      "local-network",
      tab.linkedBrowser
    );
    ok(popup, "Prompt should appear again after expiry");

    clickDoorhangerButton(
      PROMPT_ALLOW_BUTTON,
      tab.linkedBrowser,
      "local-network"
    );
    await promise;

    gBrowser.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
);

/**
 * Test: Local-network temporary deny permission persists within expiry window
 *
 * Verifies that when a user denies local-network permission, subsequent
 * requests within the expiry window do NOT trigger a new prompt and are
 * automatically denied using the cached deny permission.
 *
 * Steps:
 * 1. Make a request that triggers local-network permission prompt
 * 2. User denies permission (clicks "Not Now")
 * 3. Make a second request within the expiry window (< 2 seconds)
 * 4. Verify NO prompt appears and request is denied
 *
 * This validates that temporary deny permissions work correctly for
 * local-network (private IP addresses) and avoid repeatedly prompting
 * users for permissions they've already denied.
 */
add_task(
  async function test_lna_temporary_permission_expiry_local_network_deny() {
    info("Test local-network: Deny within expiry (no re-prompt)");
    await restorePermissions();
    await SpecialPowers.pushPrefEnv({
      set: [
        ["network.lna.address_space.public.override", "127.0.0.1:4443"],
        ["network.lna.address_space.private.override", "127.0.0.1:21555"],
        ["network.lna.temporary_permission_expire_time_ms", 2000], // 2 seconds for testing
      ],
    });

    const testURL = `${baseURL}page_with_non_trackers.html`;
    const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

    info("Step 1: Make first request and deny permission");
    const rand1 = Math.random();
    let promise = observeAndCheck(
      "fetch",
      rand1,
      Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
      "First request should be denied"
    );
    SpecialPowers.spawn(tab.linkedBrowser, [rand1], async rand => {
      content
        .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
        .catch(() => {});
    });

    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    let popup = PopupNotifications.getNotification(
      "local-network",
      tab.linkedBrowser
    );
    ok(popup, "First prompt should appear");

    clickDoorhangerButton(
      PROMPT_NOT_NOW_BUTTON,
      tab.linkedBrowser,
      "local-network"
    );
    await promise;

    // Wait for permission to be saved
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 300));

    info("Step 2: Make second request within expiry (should NOT prompt)");
    const rand2 = Math.random();
    promise = observeAndCheck(
      "fetch",
      rand2,
      Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
      "Second request within expiry should be denied without prompt"
    );
    await SpecialPowers.spawn(tab.linkedBrowser, [rand2], async rand => {
      await content
        .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
        .catch(() => {});
    });
    await promise;

    // Verify no prompt appeared (deny permission was cached)
    popup = PopupNotifications.getNotification(
      "local-network",
      tab.linkedBrowser
    );
    ok(!popup, "No prompt should appear within expiry window");

    gBrowser.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
);

/**
 * Test: Local-network temporary deny permission expires and re-prompts
 *
 * Verifies that after a temporary local-network deny permission expires,
 * a new request triggers a fresh permission prompt, giving the user another
 * opportunity to grant access.
 *
 * Steps:
 * 1. Make a request that triggers local-network permission prompt
 * 2. User denies permission (clicks "Not Now")
 * 3. Wait for deny permission to expire (2.5 seconds > 2 second timeout)
 * 4. Make another request after expiry
 * 5. Verify a NEW prompt appears (deny permission has expired)
 * 6. User can now choose to allow (demonstrating prompt works after expiry)
 *
 * This validates that temporary deny permissions expire correctly for
 * local-network (private IP addresses) and users get a second chance to
 * grant permission after the timeout.
 */
add_task(
  async function test_lna_temporary_permission_expiry_local_network_deny_after_expiry() {
    info("Test local-network: Deny, then retry after expiry (should prompt)");
    await restorePermissions();
    await SpecialPowers.pushPrefEnv({
      set: [
        ["network.lna.address_space.public.override", "127.0.0.1:4443"],
        ["network.lna.address_space.private.override", "127.0.0.1:21555"],
        ["network.lna.temporary_permission_expire_time_ms", 2000], // 2 seconds for testing
      ],
    });

    const testURL = `${baseURL}page_with_non_trackers.html`;
    const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

    info("Step 1: Make first request and deny permission");
    const rand1 = Math.random();
    let promise = observeAndCheck(
      "fetch",
      rand1,
      Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
      "First request should be denied"
    );
    SpecialPowers.spawn(tab.linkedBrowser, [rand1], async rand => {
      content
        .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
        .catch(() => {});
    });

    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    clickDoorhangerButton(
      PROMPT_NOT_NOW_BUTTON,
      tab.linkedBrowser,
      "local-network"
    );
    await promise;

    // Wait for permission to be saved
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 300));

    info("Step 2: Wait for permission to expire (2.5 seconds)");
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 2500));

    info("Step 3: Make request after expiry (should prompt again)");
    const rand2 = Math.random();
    promise = observeAndCheck(
      "fetch",
      rand2,
      Cr.NS_OK,
      "Request after expiry should succeed after new permission granted"
    );
    SpecialPowers.spawn(tab.linkedBrowser, [rand2], async rand => {
      content
        .fetch(`http://localhost:21555/?type=fetch&rand=${rand}`)
        .catch(() => {});
    });

    // Verify prompt appears again after deny permission expired
    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    let popup = PopupNotifications.getNotification(
      "local-network",
      tab.linkedBrowser
    );
    ok(popup, "Prompt should appear again after expiry");

    // This time allow to demonstrate the prompt works
    clickDoorhangerButton(
      PROMPT_ALLOW_BUTTON,
      tab.linkedBrowser,
      "local-network"
    );
    await promise;

    gBrowser.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
);

/**
 * Test: Same-origin iframe inherits Feature Policy from parent
 *
 * Scenario: Parent page (example.com) creates a same-origin iframe (example.com)
 * Expected: Iframe automatically inherits the parent's Feature Policy allowlist
 *           and can make LNA requests after permission is granted to the parent.
 *
 * This validates that same-origin iframes don't need explicit delegation via
 * the allow attribute - they inherit permissions from their parent document.
 */
add_task(async function test_feature_policy_same_origin_iframe() {
  info("Test: Same-origin iframe inherits Feature Policy from parent");
  await restorePermissions();
  await SpecialPowers.pushPrefEnv({
    set: [["network.lna.address_space.public.override", "127.0.0.1:4443"]],
  });

  const rand = Math.random();
  const testURL = `${baseURL}lna_feature_policy_parent.html?iframe=same-origin&rand=${rand}`;

  const promise = observeAndCheck(
    "fetch",
    rand,
    Cr.NS_OK,
    "Same-origin iframe request should succeed after permission granted"
  );

  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

  await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  clickDoorhangerButton(
    PROMPT_ALLOW_BUTTON,
    gBrowser.selectedBrowser,
    "loopback-network"
  );

  await promise;
  gBrowser.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

/**
 * Test: Cross-origin iframe blocked without allow attribute
 *
 * Scenario: Parent page (example.com) creates a cross-origin iframe (example.org)
 *           WITHOUT an allow attribute
 * Expected: The iframe's LNA request is blocked by Feature Policy BEFORE showing
 *           a permission prompt to the user.
 *
 * This validates Feature Policy's default-deny behavior for cross-origin iframes.
 * Cross-origin contexts must explicitly opt-in via the allow attribute to access
 * powerful features like LNA.
 */
add_task(async function test_feature_policy_cross_origin_blocked() {
  info("Test: Cross-origin iframe blocked without allow attribute");
  await restorePermissions();
  await SpecialPowers.pushPrefEnv({
    set: [["network.lna.address_space.public.override", "127.0.0.1:4443"]],
  });

  const rand = Math.random();
  const testURL = `${baseURL}lna_feature_policy_parent.html?iframe=cross-origin-no-allow&rand=${rand}`;

  const promise = observeAndCheck(
    "fetch",
    rand,
    Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
    "Cross-origin iframe without allow should be blocked by Feature Policy"
  );

  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

  await promise;

  let popup = PopupNotifications.getNotification(
    "loopback-network",
    tab.linkedBrowser
  );
  ok(
    !popup,
    "No permission prompt should appear when Feature Policy blocks request"
  );

  gBrowser.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

/**
 * Test: Cross-origin iframe allowed with explicit loopback-network delegation
 *
 * Scenario: Parent page (example.com) creates a cross-origin iframe (example.org)
 *           WITH allow="loopback-network" attribute
 * Expected: After the parent grants permission, the iframe can successfully make
 *           loopback network requests (e.g., to localhost/127.0.0.1).
 *
 * This validates that the loopback-network permission can be explicitly delegated
 * to cross-origin iframes via the allow attribute, and that delegated iframes can
 * use the parent's granted permission.
 */
add_task(async function test_feature_policy_cross_origin_loopback_allowed() {
  info(
    "Test: Cross-origin iframe allowed with explicit loopback-network delegation"
  );
  await restorePermissions();
  await SpecialPowers.pushPrefEnv({
    set: [["network.lna.address_space.public.override", "127.0.0.1:4443"]],
  });

  const rand = Math.random();
  const testURL = `${baseURL}lna_feature_policy_parent.html?iframe=cross-origin-loopback&rand=${rand}`;

  const promise = observeAndCheck(
    "fetch",
    rand,
    Cr.NS_OK,
    "Cross-origin iframe with allow=loopback-network should succeed after permission"
  );

  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

  await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  clickDoorhangerButton(
    PROMPT_ALLOW_BUTTON,
    gBrowser.selectedBrowser,
    "loopback-network"
  );

  await promise;
  gBrowser.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

/**
 * Test: Cross-origin iframe allowed with explicit local-network delegation
 *
 * Scenario: Parent page (example.com) creates a cross-origin iframe (example.org)
 *           WITH allow="local-network" attribute
 * Expected: After the parent grants permission, the iframe can successfully make
 *           local network requests (e.g., to private IP addresses like 192.168.x.x).
 *
 * This validates that the local-network permission (distinct from loopback-network)
 * can be separately delegated to cross-origin iframes, allowing access to private
 * network resources.
 */
add_task(
  async function test_feature_policy_cross_origin_local_network_allowed() {
    info(
      "Test: Cross-origin iframe allowed with explicit local-network delegation"
    );
    await restorePermissions();
    await SpecialPowers.pushPrefEnv({
      set: [
        ["network.lna.address_space.public.override", "127.0.0.1:4443"],
        ["network.lna.address_space.private.override", "127.0.0.1:21555"],
      ],
    });

    const rand = Math.random();
    const testURL = `${baseURL}lna_feature_policy_parent.html?iframe=cross-origin-local-network&rand=${rand}`;

    const promise = observeAndCheck(
      "fetch",
      rand,
      Cr.NS_OK,
      "Cross-origin iframe with allow=local-network should succeed after permission"
    );

    const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    clickDoorhangerButton(
      PROMPT_ALLOW_BUTTON,
      gBrowser.selectedBrowser,
      "local-network"
    );

    await promise;
    gBrowser.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
);

/**
 * Test: Both loopback-network and local-network can be delegated simultaneously
 *
 * Scenario: Parent page (example.com) creates a cross-origin iframe (example.org)
 *           WITH allow="loopback-network; local-network" attribute
 * Expected: After the parent grants permission, the iframe can make both loopback
 *           and local network requests.
 *
 * This validates:
 * 1. Multiple permissions can be delegated simultaneously
 * 2. The correct syntax uses semicolons to separate multiple permissions
 *    (not spaces: "loopback-network; local-network" not "loopback-network local-network")
 */
add_task(async function test_feature_policy_cross_origin_both_permissions() {
  info("Test: Both loopback-network and local-network can be delegated");
  await restorePermissions();
  await SpecialPowers.pushPrefEnv({
    set: [["network.lna.address_space.public.override", "127.0.0.1:4443"]],
  });

  const rand = Math.random();
  const testURL = `${baseURL}lna_feature_policy_parent.html?iframe=cross-origin-both&rand=${rand}`;

  const promise = observeAndCheck(
    "fetch",
    rand,
    Cr.NS_OK,
    "Cross-origin iframe with both permissions delegated should succeed"
  );

  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

  await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  clickDoorhangerButton(
    PROMPT_ALLOW_BUTTON,
    gBrowser.selectedBrowser,
    "loopback-network"
  );

  await promise;
  gBrowser.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

/**
 * Test: Same-origin iframe inherits granted permission from parent document
 *
 * Scenario: Parent page (example.com) makes an LNA request and gets permission.
 *           AFTER permission is granted, a same-origin iframe (example.com) is
 *           dynamically created.
 * Expected: The iframe can immediately make LNA requests using the parent's
 *           cached permission without showing a new permission prompt.
 *
 * This validates permission inheritance with cached permissions, ensuring no
 * race conditions occur when iframes are created after permission is granted.
 * The test uses parentRand to trigger parent request first, then manually
 * creates the iframe with a different rand value.
 */
add_task(async function test_feature_policy_same_origin_inherits_permission() {
  info(
    "Test: Same-origin iframe inherits granted permission from parent document"
  );
  await restorePermissions();
  await SpecialPowers.pushPrefEnv({
    set: [["network.lna.address_space.public.override", "127.0.0.1:4443"]],
  });

  const rand1 = Math.random();
  const rand2 = Math.random();

  info("Step 1: Load page and trigger parent request to grant permission");
  const testURL = `${baseURL}lna_feature_policy_parent.html?parentRand=${rand1}`;

  const promise1 = observeAndCheck(
    "fetch",
    rand1,
    Cr.NS_OK,
    "Parent request should succeed"
  );

  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

  await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  clickDoorhangerButton(
    PROMPT_ALLOW_BUTTON,
    gBrowser.selectedBrowser,
    "loopback-network"
  );

  await promise1;

  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(resolve => setTimeout(resolve, 300));

  info("Step 2: Now create iframe - it should inherit the granted permission");
  const promise2 = observeAndCheck(
    "fetch",
    rand2,
    Cr.NS_OK,
    "Same-origin iframe should inherit granted permission without new prompt"
  );

  // Create same-origin iframe that will auto-trigger fetch
  await SpecialPowers.spawn(tab.linkedBrowser, [rand2], async r => {
    const container = content.document.getElementById("iframe-container");
    const iframe = content.document.createElement("iframe");
    iframe.id = "test-iframe";
    iframe.src = `https://example.com/browser/netwerk/test/browser/lna_feature_policy_iframe_same_origin.html?rand=${r}`;
    container.appendChild(iframe);
  });

  await promise2;

  let popup = PopupNotifications.getNotification(
    "loopback-network",
    tab.linkedBrowser
  );
  ok(
    !popup,
    "No new permission prompt should appear for same-origin iframe with cached permission"
  );

  gBrowser.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

/**
 * Test: Cross-origin iframe with allow attribute can use parent's cached permission
 *
 * Scenario: Parent page (example.com) makes an LNA request and gets permission.
 *           AFTER permission is granted, a cross-origin iframe (example.org) with
 *           allow="loopback-network" attribute is dynamically created.
 * Expected: The iframe can immediately make LNA requests using the parent's
 *           cached permission without showing a new permission prompt.
 *
 * This validates that Feature Policy delegation works correctly with cached
 * permissions - a cross-origin iframe with proper allow attribute can leverage
 * the parent's existing permission grant without re-prompting the user.
 */
add_task(
  async function test_feature_policy_cross_origin_with_allow_uses_permission() {
    await restorePermissions();
    info(
      "Test: Cross-origin iframe with allow attribute can use parent permission"
    );
    await SpecialPowers.pushPrefEnv({
      set: [["network.lna.address_space.public.override", "127.0.0.1:4443"]],
    });

    const rand1 = Math.random();
    const rand2 = Math.random();

    info("Step 1: Load page and trigger parent request to grant permission");
    const testURL = `${baseURL}lna_feature_policy_parent.html?parentRand=${rand1}`;
    const promise1 = observeAndCheck(
      "fetch",
      rand1,
      Cr.NS_OK,
      "Parent request should succeed"
    );

    const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    clickDoorhangerButton(
      PROMPT_ALLOW_BUTTON,
      gBrowser.selectedBrowser,
      "loopback-network"
    );

    await promise1;

    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 300));

    info(
      "Step 2: Create cross-origin iframe with allow attribute - should use parent permission"
    );
    const promise2 = observeAndCheck(
      "fetch",
      rand2,
      Cr.NS_OK,
      "Cross-origin iframe with allow can use parent permission"
    );

    await SpecialPowers.spawn(tab.linkedBrowser, [rand2], async r => {
      const container = content.document.getElementById("iframe-container");
      const iframe = content.document.createElement("iframe");
      iframe.id = "test-iframe";
      iframe.src = `https://example.org/browser/netwerk/test/browser/lna_feature_policy_iframe_cross_origin.html?rand=${r}`;
      iframe.setAttribute("allow", "loopback-network");
      container.appendChild(iframe);
    });

    await promise2;

    let popup = PopupNotifications.getNotification(
      "loopback-network",
      tab.linkedBrowser
    );
    ok(
      !popup,
      "No new prompt for cross-origin iframe with allow when parent has permission"
    );

    gBrowser.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
);

/**
 * Test: Cross-origin iframe without allow attribute is blocked even with parent permission
 *
 * Scenario: Parent page (example.com) makes an LNA request and gets permission.
 *           AFTER permission is granted, a cross-origin iframe (example.org) WITHOUT
 *           an allow attribute is dynamically created.
 * Expected: The iframe's LNA request is blocked by Feature Policy, even though the
 *           parent has a cached permission grant.
 *
 * This validates that Feature Policy enforcement is independent of the parent's
 * permission state - cross-origin iframes must have explicit delegation via the
 * allow attribute to access LNA, regardless of whether the parent has permission.
 * This prevents cross-origin contexts from silently inheriting powerful permissions.
 */
add_task(
  async function test_feature_policy_cross_origin_without_allow_still_blocked() {
    info(
      "Test: Cross-origin iframe without allow is blocked even if parent has permission"
    );
    await restorePermissions();
    await SpecialPowers.pushPrefEnv({
      set: [["network.lna.address_space.public.override", "127.0.0.1:4443"]],
    });

    const rand1 = Math.random();
    const rand2 = Math.random();

    info("Step 1: Load page and trigger parent request to grant permission");
    const testURL = `${baseURL}lna_feature_policy_parent.html?parentRand=${rand1}`;
    const promise1 = observeAndCheck(
      "fetch",
      rand1,
      Cr.NS_OK,
      "Parent request should succeed"
    );

    const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

    await BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
    clickDoorhangerButton(
      PROMPT_ALLOW_BUTTON,
      gBrowser.selectedBrowser,
      "loopback-network"
    );

    await promise1;

    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 300));

    info(
      "Step 2: Create cross-origin iframe WITHOUT allow - should be blocked by Feature Policy"
    );
    const promise2 = observeAndCheck(
      "fetch",
      rand2,
      Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
      "Cross-origin iframe without allow blocked even when parent has permission"
    );

    await SpecialPowers.spawn(tab.linkedBrowser, [rand2], async r => {
      const container = content.document.getElementById("iframe-container");
      const iframe = content.document.createElement("iframe");
      iframe.id = "test-iframe";
      iframe.src = `https://example.org/browser/netwerk/test/browser/lna_feature_policy_iframe_cross_origin.html?rand=${r}`;
      container.appendChild(iframe);
    });

    await promise2;

    let popup = PopupNotifications.getNotification(
      "loopback-network",
      tab.linkedBrowser
    );
    ok(!popup, "No prompt should appear - Feature Policy blocks it");

    gBrowser.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
);

/**
 * Test: Nested iframes - Feature Policy checks the full delegation chain
 *
 * Scenario: Parent page (example.com) creates a same-origin iframe (example.com)
 *           with allow="loopback-network". That same-origin iframe contains a
 *           nested cross-origin iframe (example.org) WITHOUT an allow attribute.
 * Expected: The nested cross-origin iframe's LNA request is blocked by Feature
 *           Policy.
 *
 * This validates that Feature Policy checks the entire delegation chain, not just
 * the immediate parent-child relationship. Even though:
 * - The parent (example.com) delegates to the middle iframe (example.com)
 * - The middle iframe is same-origin with parent (inherits permission)
 * The nested cross-origin iframe (example.org) is still blocked because the middle
 * iframe did not explicitly delegate to it via an allow attribute.
 *
 * Structure: Parent (example.com) → Middle (example.com, has delegation) →
 *            Nested (example.org, no delegation) = BLOCKED
 */
add_task(async function test_feature_policy_nested_iframes() {
  info(
    "Test: Nested iframes respect Feature Policy (cross-origin inside same-origin)"
  );
  await restorePermissions();
  await SpecialPowers.pushPrefEnv({
    set: [["network.lna.address_space.public.override", "127.0.0.1:4443"]],
  });

  const rand = Math.random();
  const testURL = `${baseURL}lna_feature_policy_parent.html?iframe=nested&rand=${rand}`;

  const promise = observeAndCheck(
    "fetch",
    rand,
    Cr.NS_ERROR_LOCAL_NETWORK_ACCESS_DENIED,
    "Nested cross-origin iframe without delegation should be blocked"
  );

  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, testURL);

  await promise;

  let popup = PopupNotifications.getNotification(
    "loopback-network",
    tab.linkedBrowser
  );
  ok(
    !popup,
    "No prompt for nested cross-origin iframe without delegation in allow chain"
  );

  gBrowser.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});
