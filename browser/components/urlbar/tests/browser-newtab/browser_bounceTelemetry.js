/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// A bounce is tracked from the chrome window's selected browser and triggered by
// its tab events, so the newtab search bar, which doesn't have these in the
// content process, records none. See bug 2068488.
//
// Asserting an absence only means something once the moment the event would
// have arrived has passed, which here is `Interactions.interactionUpdatePromise`
// -- where the address bar's bounce lands.

"use strict";

const { Interactions } = ChromeUtils.importESModule(
  "moz-src:///browser/components/places/Interactions.sys.mjs"
);

// The view time below which a navigation away counts as a bounce.
const MAX_VIEW_TIME_SECONDS = 10;

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      [
        "browser.urlbar.events.bounce.maxSecondsFromLastSearch",
        MAX_VIEW_TIME_SECONDS,
      ],
    ],
  });
  await SearchTestUtils.installSearchExtension({}, { setAsDefault: true });

  // A view time under the threshold, so the only thing that can keep the bounce
  // from being recorded is the tracking never having started.
  sinon.stub(Interactions, "getRecentInteractionsForBrowser").callsFake(() => [
    {
      created_at: Date.now(),
      totalViewTime: (MAX_VIEW_TIME_SECONDS / 2) * 1000,
    },
  ]);

  registerCleanupFunction(function () {
    sinon.restore();
  });
});

add_telemetry_task(async function navigateBack(browser) {
  await doSearch(browser);
  await doEnter(browser);
  await assertEngagementTelemetry([{ sap: "newtab_searchbar" }]);

  let onLocationChange = BrowserTestUtils.waitForLocationChange(
    gBrowser,
    "about:newtab"
  );
  gBrowser.goBack();
  await onLocationChange;
  await Interactions.interactionUpdatePromise;

  await assertBounceTelemetry([]);
});

add_telemetry_task(async function closeTab(browser) {
  await doSearch(browser);
  await doEnter(browser);
  await assertEngagementTelemetry([{ sap: "newtab_searchbar" }]);

  BrowserTestUtils.removeTab(gBrowser.getTabForBrowser(browser));
  await Interactions.interactionUpdatePromise;

  await assertBounceTelemetry([]);
});

// The address bar bounces from the very same page, so what the tasks above
// record nothing from is the newtab search bar and not the test's own setup.
add_telemetry_task(async function addressBar(browser) {
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    value: "x",
  });
  let loaded = BrowserTestUtils.browserLoaded(browser);
  EventUtils.synthesizeKey("KEY_Enter");
  await loaded;
  await assertEngagementTelemetry([{ sap: "urlbar_newtab" }]);

  let onLocationChange = BrowserTestUtils.waitForLocationChange(
    gBrowser,
    "about:newtab"
  );
  gBrowser.goBack();
  await onLocationChange;
  await Interactions.interactionUpdatePromise;

  await assertBounceTelemetry([{ sap: "urlbar_newtab" }]);
});
