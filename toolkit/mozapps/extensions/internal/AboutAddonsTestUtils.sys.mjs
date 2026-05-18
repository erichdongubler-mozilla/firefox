/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

import { Assert } from "resource://testing-common/Assert.sys.mjs";

const ASSERT_MESSAGE_EXPECTED_ABOUTADDONS_GLOBAL =
  "Expect window to be an about:addons page global";

function assertIsAboutAddonsWindow(win, assertMessage) {
  // Trigger an explicit failure if `win` isn't an about:addons page global.
  if (win?.document?.documentURI !== "about:addons") {
    Assert.equal(
      win?.document?.documentURI,
      "about:addons",
      assertMessage ?? ASSERT_MESSAGE_EXPECTED_ABOUTADDONS_GLOBAL
    );
  }
}

function assertIsAboutAddonsSidebarButton(button) {
  assertIsAboutAddonsWindow(
    button?.documentGlobal,
    "Expect sidebar button to belong to about:addons page"
  );
  Assert.equal(
    button.localName,
    "moz-page-nav-button",
    "Expect sidebar button to be an instance of moz-page-nav-button"
  );
  Assert.ok(
    button.closest("categories-box"),
    "Expect sidebar button to be found inside categories-box custom element"
  );
}

export const AboutAddonsTestUtils = {
  getAddonCard(win, id) {
    assertIsAboutAddonsWindow(win);
    return win.document.querySelector(`addon-card[addon-id="${id}"]`);
  },

  getAllCategoryButtons(win) {
    assertIsAboutAddonsWindow(win);
    return Array.from(
      win.document.querySelectorAll(`categories-box moz-page-nav-button[view]`)
    );
  },

  getCategoryButton(win, type) {
    assertIsAboutAddonsWindow(win);
    return win.document.querySelector(
      `categories-box moz-page-nav-button[view="${type}"]`
    );
  },

  getCategoryBadgeCount(button) {
    assertIsAboutAddonsSidebarButton(button);
    const badgeEl = button.querySelector(".category-badge");
    return badgeEl ? parseInt(badgeEl.textContent, 10) : 0;
  },

  isCategoryButtonSelected(win, type) {
    assertIsAboutAddonsWindow(win);
    const button = this.getCategoryButton(win, type);
    if (!button) {
      throw Error(`No button found for category ${type}`);
    }
    // NOTE: moz-page-nav selected may also be null.
    return !!button.selected;
  },

  clickCategoryButton(win, type) {
    assertIsAboutAddonsWindow(win);
    const mozPageNavButton = this.getCategoryButton(win, type);
    if (!mozPageNavButton) {
      throw Error(`No button found for category ${type}`);
    }
    // NOTE: calling click on the button element embedded into the
    // moz-page-nav-button shadow DOM, otherwise the tests using
    // this test helpers would hit a failure while running with
    // a11y checks enabled.
    mozPageNavButton.shadowRoot.querySelector("button").click();
  },

  /**
   * Returns a promise that resolves once the categories-box element has
   * finished its current Lit render cycle.  Use this before asserting
   * category visibility in test code that runs synchronously inside addon
   * event callbacks (e.g. onInstalled, onInstallStarted), where the Lit
   * update triggered by the callback has not yet been applied to the DOM.
   */
  async waitForCategoriesUpdate(win) {
    assertIsAboutAddonsWindow(win);
    await win.customElements.whenDefined("categories-box");
    const categoriesBox = win.document.querySelector("categories-box");
    // Make sure categories-box is fully initialized.
    await categoriesBox.promiseRendered;
    // Wait for it to be re-rendered.
    return categoriesBox.updateComplete;
  },
};
