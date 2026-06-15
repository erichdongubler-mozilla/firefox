/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

async function openAllTabsMenu(win = window) {
  const allTabsView = win.document.getElementById("allTabsMenu-allTabsView");
  const shown = BrowserTestUtils.waitForEvent(allTabsView, "ViewShown");
  win.document.getElementById("alltabs-button").click();
  await shown;
  return allTabsView;
}

async function closeAllTabsMenu(win = window) {
  const panel = win.document
    .getElementById("allTabsMenu-allTabsView")
    .closest("panel");
  const hidden = BrowserTestUtils.waitForPopupEvent(panel, "hidden");
  panel.hidePopup();
  await hidden;
}

// The "New Container Tab" and "Close Duplicate Tabs" items live inside the
// scrollable tab list as children, so they scroll with the tabs
add_task(async function test_menu_item_order_and_visibility() {
  await SpecialPowers.pushPrefEnv({
    set: [["privacy.userContext.enabled", true]],
  });

  // Create duplicate tabs so "Close Duplicate Tabs" is shown
  const tabA = await addTab("https://example.com/duplicate");
  const tabB = await addTab("https://example.com/duplicate");

  window.gTabsPanel.init();
  await openAllTabsMenu();

  const tabsList = document.getElementById("allTabsMenu-allTabsView-tabs");
  const containerButton = document.getElementById(
    "allTabsMenu-containerTabsButton"
  );
  const closeDuplicateButton = document.getElementById(
    "allTabsMenu-closeDuplicateTabs"
  );

  is(
    tabsList.children[0],
    containerButton,
    "New Container Tab is the first item in the tab list"
  );
  is(
    tabsList.children[1],
    closeDuplicateButton,
    "Close Duplicate Tabs is the second item in the tab list"
  );
  ok(
    BrowserTestUtils.isVisible(containerButton),
    "New Container Tab is visible when containers are enabled"
  );
  ok(
    BrowserTestUtils.isVisible(closeDuplicateButton),
    "Close Duplicate Tabs is visible when duplicate tabs exist"
  );

  const firstTabRow = tabsList.querySelector(".all-tabs-item");
  is(
    tabsList.children[2],
    firstTabRow,
    "The first tab is the third item in the list, after the two action buttons"
  );

  await closeAllTabsMenu();
  BrowserTestUtils.removeTab(tabA);
  BrowserTestUtils.removeTab(tabB);
  await SpecialPowers.popPrefEnv();
});

// "Close Duplicate Tabs" is hidden, not disabled, when there are no
// duplicate tabs
add_task(async function test_close_duplicate_hidden_without_duplicates() {
  window.gTabsPanel.init();
  await openAllTabsMenu();

  const tabsList = document.getElementById("allTabsMenu-allTabsView-tabs");
  const closeDuplicateButton = document.getElementById(
    "allTabsMenu-closeDuplicateTabs"
  );

  ok(
    closeDuplicateButton.hidden,
    "Close Duplicate Tabs is hidden when there are no duplicate tabs"
  );
  is(
    tabsList.children[1],
    closeDuplicateButton,
    "Close Duplicate Tabs keeps its position while hidden"
  );

  await closeAllTabsMenu();
});

// Adding a tab while the menu is open re-renders the tab list. The two action
// buttons must remain its first two children.
add_task(async function test_buttons_persist_after_tab_added() {
  window.gTabsPanel.init();
  await openAllTabsMenu();

  const tabsList = document.getElementById("allTabsMenu-allTabsView-tabs");
  const containerButton = document.getElementById(
    "allTabsMenu-containerTabsButton"
  );
  const closeDuplicateButton = document.getElementById(
    "allTabsMenu-closeDuplicateTabs"
  );

  const newTab = await addTab("https://example.com/persist");
  await BrowserTestUtils.waitForCondition(
    () =>
      [...tabsList.querySelectorAll(".all-tabs-item")].some(
        row => row._tab == newTab
      ),
    "the newly added tab has a row in the list"
  );

  is(
    tabsList.children[0],
    containerButton,
    "New Container Tab is still the first item after a tab is added"
  );
  is(
    tabsList.children[1],
    closeDuplicateButton,
    "Close Duplicate Tabs is still the second item after a tab is added"
  );

  await closeAllTabsMenu();
  BrowserTestUtils.removeTab(newTab);
});
