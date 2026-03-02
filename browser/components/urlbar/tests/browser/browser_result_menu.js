/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const NativeKeyConstants = {};
Services.scriptloader.loadSubScript(
  "chrome://mochikit/content/tests/SimpleTest/NativeKeyCodes.js",
  NativeKeyConstants
);

add_setup(async function init() {
  registerCleanupFunction(async function () {
    await PlacesUtils.history.clear();
    await UrlbarTestUtils.formHistory.clear();
  });
});

add_task(async function test_history() {
  const TEST_URL = "https://remove.me/from_urlbar/";
  await PlacesTestUtils.addVisits(TEST_URL);

  const resultIndex = 1;
  let result;
  let startQuery = async () => {
    await UrlbarTestUtils.promisePopupClose(window);
    await UrlbarTestUtils.promiseAutocompleteResultPopup({
      window,
      value: "from_urlbar",
    });
    result = await UrlbarTestUtils.getDetailsOfResultAt(window, resultIndex);
    Assert.equal(result.url, TEST_URL, "Found the expected result");
    gURLBar.view.selectedRowIndex = resultIndex;
  };

  await SpecialPowers.pushPrefEnv({
    set: [["browser.urlbar.resultMenu.keyboardAccessible", false]],
  });
  await startQuery();
  EventUtils.synthesizeKey("KEY_Tab");
  isnot(
    UrlbarTestUtils.getSelectedElement(window),
    UrlbarTestUtils.getButtonForResultIndex(window, "result-menu", resultIndex),
    "Tab key skips over menu button with resultMenu.keyboardAccessible pref set to false"
  );
  info(
    "Checking that the mouse can still activate the menu button with resultMenu.keyboardAccessible = false"
  );
  await UrlbarTestUtils.openResultMenu(window, {
    byMouse: true,
    resultIndex,
  });
  gURLBar.view.resultMenu.hidePopup();
  await SpecialPowers.popPrefEnv();
  await startQuery();
  EventUtils.synthesizeKey("KEY_Tab");
  is(
    UrlbarTestUtils.getSelectedElement(window),
    UrlbarTestUtils.getButtonForResultIndex(window, "result-menu", resultIndex),
    "Tab key doesn't skip over menu button with resultMenu.keyboardAccessible pref reset to true"
  );

  info("Checking that Space activates the menu button");
  await startQuery();
  await UrlbarTestUtils.openResultMenu(window, {
    activationKey: " ",
  });
  gURLBar.view.resultMenu.hidePopup();

  info("Selecting Learn more item from the result menu");
  let tabOpenPromise = BrowserTestUtils.waitForNewTab(
    gBrowser,
    Services.urlFormatter.formatURLPref("app.support.baseURL") +
      "awesome-bar-result-menu"
  );
  await UrlbarTestUtils.openResultMenuAndPressAccesskey(window, "L");
  info("Waiting for Learn more link to open in a new tab");
  await tabOpenPromise;
  gBrowser.removeCurrentTab();

  info("Restarting query in order to remove history entry via the menu");
  await startQuery();
  let promiseVisitRemoved = PlacesTestUtils.waitForNotification(
    "page-removed",
    events => events[0].url === TEST_URL
  );
  let expectedResultCount = UrlbarTestUtils.getResultCount(window) - 1;

  await UrlbarTestUtils.openResultMenuAndPressAccesskey(window, "R");
  const removeEvents = await promiseVisitRemoved;
  Assert.ok(
    removeEvents[0].isRemovedFromStore,
    "isRemovedFromStore should be true"
  );
  await TestUtils.waitForCondition(
    () => UrlbarTestUtils.getResultCount(window) == expectedResultCount,
    "Waiting for the result to disappear"
  );
  for (let i = 0; i < expectedResultCount; i++) {
    let details = await UrlbarTestUtils.getDetailsOfResultAt(window, i);
    Assert.notEqual(
      details.url,
      TEST_URL,
      "Should not find the test URL in the remaining results"
    );
  }

  await UrlbarTestUtils.promisePopupClose(window);
  await PlacesUtils.history.clear();
});

add_task(async function test_remove_search_history() {
  let extension = await SearchTestUtils.installSearchExtension(
    {},
    {
      setAsDefault: true,
      skipUnload: true,
    }
  );
  let engine = SearchService.getEngineByName("Example");
  await SearchService.moveEngine(engine, 0);
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.urlbar.suggest.searches", true],
      ["browser.urlbar.maxHistoricalSearchSuggestions", 1],
    ],
  });

  let formHistoryValue = "foobar";
  await UrlbarTestUtils.formHistory.add([formHistoryValue]);

  let formHistory = (
    await UrlbarTestUtils.formHistory.search({
      value: formHistoryValue,
    })
  ).map(entry => entry.value);
  Assert.deepEqual(
    formHistory,
    [formHistoryValue],
    "Should find form history after adding it"
  );

  let promiseRemoved = UrlbarTestUtils.formHistory.promiseChanged("remove");

  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    value: "foo",
  });

  let resultIndex = 1;
  let count = UrlbarTestUtils.getResultCount(window);
  for (; resultIndex < count; resultIndex++) {
    let result = await UrlbarTestUtils.getDetailsOfResultAt(
      window,
      resultIndex
    );
    if (
      result.type == UrlbarUtils.RESULT_TYPE.SEARCH &&
      result.source == UrlbarUtils.RESULT_SOURCE.HISTORY
    ) {
      break;
    }
  }
  Assert.less(resultIndex, count, "Result found");

  await UrlbarTestUtils.openResultMenuAndPressAccesskey(window, "R", {
    resultIndex,
  });
  await promiseRemoved;

  await TestUtils.waitForCondition(
    () => UrlbarTestUtils.getResultCount(window) == count - 1,
    "Waiting for the result to disappear"
  );

  for (let i = 0; i < UrlbarTestUtils.getResultCount(window); i++) {
    let result = await UrlbarTestUtils.getDetailsOfResultAt(window, i);
    Assert.ok(
      result.type != UrlbarUtils.RESULT_TYPE.SEARCH ||
        result.source != UrlbarUtils.RESULT_SOURCE.HISTORY,
      "Should not find the form history result in the remaining results"
    );
  }

  await UrlbarTestUtils.promisePopupClose(window);

  formHistory = (
    await UrlbarTestUtils.formHistory.search({
      value: formHistoryValue,
    })
  ).map(entry => entry.value);
  Assert.deepEqual(
    formHistory,
    [],
    "Should not find form history after removing it"
  );

  await SpecialPowers.popPrefEnv();
  await extension.unload();
});

add_task(async function firefoxSuggest() {
  const url = "https://example.com/hey-there";
  const helpUrl = "https://example.com/help";
  let provider = new UrlbarTestUtils.TestProvider({
    priority: Infinity,
    results: [
      new UrlbarResult({
        type: UrlbarUtils.RESULT_TYPE.URL,
        source: UrlbarUtils.RESULT_SOURCE.OTHER_LOCAL,
        payload: {
          url,
          isBlockable: true,
          helpUrl,
          helpL10n: {
            id: "urlbar-result-menu-learn-more",
          },
        },
      }),
    ],
  });

  // Implement the provider's `onEngagement()` so it removes the result.
  let onEngagementCallCount = 0;
  provider.onEngagement = (queryContext, controller, details) => {
    onEngagementCallCount++;
    controller.removeResult(details.result);
  };

  let providersManager = ProvidersManager.getInstanceForSap("urlbar");
  providersManager.registerProvider(provider);

  async function openResults() {
    await UrlbarTestUtils.promiseAutocompleteResultPopup({
      window,
      value: "test",
    });

    Assert.equal(
      UrlbarTestUtils.getResultCount(window),
      1,
      "There should be one result"
    );

    let row = await UrlbarTestUtils.waitForAutocompleteResultAt(window, 0);
    Assert.equal(
      row.result.payload.url,
      url,
      "The result should be in the first row"
    );
  }

  await openResults();
  let tabOpenPromise = BrowserTestUtils.waitForNewTab(gBrowser, helpUrl);
  await UrlbarTestUtils.openResultMenuAndPressAccesskey(window, "L", {
    resultIndex: 0,
  });
  info("Waiting for help URL to load in a new tab");
  await tabOpenPromise;
  gBrowser.removeCurrentTab();

  await openResults();
  await UrlbarTestUtils.openResultMenuAndPressAccesskey(window, "D", {
    resultIndex: 0,
  });

  Assert.greater(
    onEngagementCallCount,
    0,
    "onEngagement() should have been called"
  );
  Assert.equal(
    UrlbarTestUtils.getResultCount(window),
    0,
    "There should be no results after blocking"
  );

  await UrlbarTestUtils.promisePopupClose(window);
  providersManager.unregisterProvider(provider);
});

add_task(async function space_to_activate_without_input_value() {
  await PlacesTestUtils.addVisits("https://example.com");
  await doSpaceKeyTest({ input: "example", targetRowIndex: 1 });
  await PlacesUtils.history.clear();
});

add_task(async function space_to_activate_with_input_value() {
  let extension = await SearchTestUtils.installSearchExtension(
    {},
    {
      setAsDefault: true,
      skipUnload: true,
    }
  );
  let engine = SearchService.getEngineByName("Example");
  await SearchService.moveEngine(engine, 0);
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.urlbar.suggest.searches", true],
      ["browser.urlbar.maxHistoricalSearchSuggestions", 1],
    ],
  });

  await UrlbarTestUtils.formHistory.add(["foobar"]);
  await doSpaceKeyTest({ input: "foo", targetRowIndex: 1 });
  await extension.unload();
  await UrlbarTestUtils.formHistory.clear();
  await SpecialPowers.popPrefEnv();
});

async function doSpaceKeyTest({ input, targetRowIndex }) {
  if (Services.appinfo.OS == "Linux") {
    // Since we can't send a native event for SPACE key, skip the test.
    return;
  }

  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    value: input,
  });

  // Select the target row.
  gURLBar.view.selectedRowIndex = targetRowIndex;
  // Focus on the resule menu button.
  EventUtils.synthesizeKey("KEY_Tab");

  // Flush pending APZ repaints to keep the APZ focus sequence in sync with
  // the PresShell before sending a native key event. Without this, Windows
  // debug builds may hit an assertion of bug 1867732.
  window.windowUtils.flushApzRepaints();

  // Keep the urlbar value to compare after opening result menu.
  let previousUrlbarValue = gURLBar.value;

  // Open result menu by SPACE key.
  let promiseMenuOpen = BrowserTestUtils.waitForEvent(
    gURLBar.view.resultMenu,
    "popupshown"
  );

  await new Promise(resolve => {
    EventUtils.synthesizeNativeKey(
      EventUtils.KEYBOARD_LAYOUT_EN_US,
      Services.appinfo.OS == "WINNT"
        ? NativeKeyConstants.WIN_VK_SPACE
        : NativeKeyConstants.MAC_VK_Space,
      {},
      " ",
      " ",
      resolve
    );
  });

  await promiseMenuOpen;
  Assert.ok(true, "Menu is opened by space");
  Assert.equal(
    gURLBar.value,
    previousUrlbarValue,
    "The urlbar value should be same"
  );
  gURLBar.view.resultMenu.hidePopup();
}
