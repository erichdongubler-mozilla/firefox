/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_setup(async () => {
  await SpecialPowers.pushPrefEnv({
    set: [["sidebar.openTabsPanel.enabled", true]],
  });
});

async function showOpenTabsPanel() {
  await SidebarController.show("viewOpenTabsSidebar");
  const { contentDocument } = SidebarController.browser;
  const component = contentDocument.querySelector("sidebar-opentabs");
  Assert.ok(component, "Open tabs panel is shown.");
  return component;
}

function getTabList(component) {
  return component.shadowRoot.querySelector("sidebar-tab-list");
}

// Mirror the filtering done by OpenTabsController.getTabListItems.
function getVisibleTabCount() {
  return gBrowser.openTabs.filter(tab => !tab.hidden && !tab.closing).length;
}

async function waitForRowCount(tabList, expected) {
  await BrowserTestUtils.waitForMutationCondition(
    tabList.shadowRoot,
    { childList: true, subtree: true },
    () => tabList.rowEls?.length === expected
  );
}

add_task(async function test_opentabs_lists_current_window_tabs() {
  const tab1 = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );
  const tab2 = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );

  const component = await showOpenTabsPanel();
  const tabList = getTabList(component);
  const expected = getVisibleTabCount();
  await waitForRowCount(tabList, expected);

  Assert.equal(
    tabList.rowEls.length,
    expected,
    "Row count matches the number of visible tabs in the window."
  );

  BrowserTestUtils.removeTab(tab1);
  BrowserTestUtils.removeTab(tab2);
  SidebarController.hide();
});

add_task(async function test_clicking_row_selects_tab() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );
  // Select a different tab so clicking the row actually changes selection.
  gBrowser.selectedTab = gBrowser.tabs[0];

  const component = await showOpenTabsPanel();
  const tabList = getTabList(component);
  await waitForRowCount(tabList, getVisibleTabCount());

  const row = [...tabList.rowEls].find(rowEl => rowEl.tabElement === tab);
  Assert.ok(row, "Found the row for the opened tab.");

  const content = SidebarController.browser.contentWindow;
  await content.promiseDocumentFlushed(() => {});

  AccessibilityUtils.setEnv({ focusableRule: false });
  await EventUtils.synthesizeMouseAtCenter(row.mainEl, { button: 0 }, content);
  AccessibilityUtils.resetEnv();

  Assert.equal(
    gBrowser.selectedTab,
    tab,
    "Clicking a row selects the corresponding tab."
  );

  BrowserTestUtils.removeTab(tab);
  SidebarController.hide();
});

add_task(async function test_list_updates_on_open_and_close() {
  const component = await showOpenTabsPanel();
  const tabList = getTabList(component);

  const initialCount = getVisibleTabCount();
  await waitForRowCount(tabList, initialCount);

  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );
  await waitForRowCount(tabList, initialCount + 1);
  Assert.equal(
    tabList.rowEls.length,
    initialCount + 1,
    "Opening a tab adds a row."
  );

  BrowserTestUtils.removeTab(tab);
  await waitForRowCount(tabList, initialCount);
  Assert.equal(
    tabList.rowEls.length,
    initialCount,
    "Closing a tab removes its row."
  );

  SidebarController.hide();
});

add_task(async function test_close_button_closes_tab() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:robots"
  );

  const component = await showOpenTabsPanel();
  const tabList = getTabList(component);
  const initialCount = getVisibleTabCount();

  const row = await TestUtils.waitForCondition(
    () => [...tabList.rowEls].find(rowEl => rowEl.url === "about:robots"),
    "Row for the opened tab should render."
  );

  const content = SidebarController.browser.contentWindow;
  await content.promiseDocumentFlushed(() => {});

  // Hover the row so its close button is interactable, then click it.
  await EventUtils.synthesizeMouseAtCenter(
    row.mainEl,
    { type: "mouseover" },
    content
  );
  const closeButton = await TestUtils.waitForCondition(
    () => row.secondaryButtonEl,
    "Close button should render on the row."
  );
  EventUtils.synthesizeMouseAtCenter(closeButton, {}, content);

  await TestUtils.waitForCondition(
    () => !gBrowser.tabs.includes(tab),
    "Clicking the close button should close the tab."
  );
  await waitForRowCount(tabList, initialCount - 1);

  SidebarController.hide();
});
