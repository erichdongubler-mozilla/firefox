"use strict";

const PAGE_PREFS = "about:preferences";
const PAGE_PRIVACY = PAGE_PREFS + "#privacy";
const SELECTORS = {
  savedCreditCardsBtn: "#creditCardAutofill button",
  reauthCheckbox: "#creditCardReauthenticate checkbox",
};

// On mac, this test times out in chaos mode
requestLongerTimeout(2);

add_setup(async function () {
  // Revert head.js change that mocks os auth
  sinon.restore();

  // Load in a few credit cards
  await SpecialPowers.pushPrefEnv({
    set: [["privacy.reduceTimerPrecision", false]],
  });
  await setStorage(TEST_CREDIT_CARD_1, TEST_CREDIT_CARD_2);
});

/*
 * This test ensures that OS auth is enabled in Nightly builds and that the
 * encrypted pref is set correctly.
 */
add_task(async function test_os_auth_enabled_with_checkbox() {
  let finalPrefPaneLoaded = TestUtils.topicObserved("sync-pane-loaded");
  FormAutofillUtils.setOSAuthEnabled(true);
  await BrowserTestUtils.withNewTab(
    { gBrowser, url: PAGE_PRIVACY },
    async function (browser) {
      await finalPrefPaneLoaded;

      await SpecialPowers.spawn(browser, [SELECTORS], async selectors => {
        ok(
          content.document.querySelector(selectors.reauthCheckbox).checked,
          "OSReauth for credit cards should be checked"
        );
      });
      ok(FormAutofillUtils.getOSAuthEnabled(), "OSAuth should be enabled.");
    }
  );
});

/*
 * This test makes sure that calling setOSAuthEnabled correctly sets the
 * checkbox and encryped pref.
 */
add_task(async function test_os_auth_disabled_with_checkbox() {
  let finalPrefPaneLoaded = TestUtils.topicObserved("sync-pane-loaded");
  FormAutofillUtils.setOSAuthEnabled(false);

  await BrowserTestUtils.withNewTab(
    { gBrowser, url: PAGE_PRIVACY },
    async function (browser) {
      await finalPrefPaneLoaded;

      await SpecialPowers.spawn(browser, [SELECTORS], async selectors => {
        is(
          content.document.querySelector(selectors.reauthCheckbox).checked,
          false,
          "OSReauth for credit cards should be unchecked"
        );
      });
      is(
        FormAutofillUtils.getOSAuthEnabled(),
        false,
        "OSAuth should be disabled"
      );
    }
  );
  FormAutofillUtils.setOSAuthEnabled(true);
});

/*
 * This test ensures that there is an OS authentication prompt when OS
 * authentication is enabled.
 */
add_task(async function test_osAuth_enabled_behaviour() {
  let finalPrefPaneLoaded = TestUtils.topicObserved("sync-pane-loaded");
  await SpecialPowers.pushPrefEnv({
    set: [[FormAutofillUtils.AUTOFILL_CREDITCARDS_OS_AUTH_LOCKED_PREF, true]],
  });

  await BrowserTestUtils.withNewTab(
    { gBrowser, url: PAGE_PRIVACY },
    async function (browser) {
      await finalPrefPaneLoaded;
      if (!OSKeyStoreTestUtils.canTestOSKeyStoreLogin()) {
        // The rest of the test uses Edit mode which causes an OS prompt in official builds.
        return;
      }
      let reauthObserved = OSKeyStoreTestUtils.waitForOSKeyStoreLogin(true);
      await SpecialPowers.spawn(browser, [SELECTORS], async selectors => {
        content.document.querySelector(selectors.savedCreditCardsBtn).click();
      });
      let ccManageDialog = await waitForSubDialogLoad(
        content,
        MANAGE_CREDIT_CARDS_DIALOG_URL
      );
      await SpecialPowers.spawn(ccManageDialog, [], async () => {
        let selRecords = content.document.getElementById("credit-cards");
        await EventUtils.synthesizeMouseAtCenter(
          selRecords.children[0],
          [],
          content
        );
        content.document.querySelector("#edit").click();
      });
      await reauthObserved; // If the OS does not popup, this will cause a timeout in the test.
      await waitForSubDialogLoad(content, EDIT_CREDIT_CARD_DIALOG_URL);
    }
  );
});

/*
 * This test checks that no OS authentication prompt is triggered when OS
 * authentication is disabled.
 */
add_task(async function test_osAuth_disabled_behavior() {
  let finalPrefPaneLoaded = TestUtils.topicObserved("sync-pane-loaded");
  FormAutofillUtils.setOSAuthEnabled(false);
  await BrowserTestUtils.withNewTab(
    { gBrowser, url: PAGE_PRIVACY },
    async function (browser) {
      await finalPrefPaneLoaded;
      await SpecialPowers.spawn(
        browser,
        [SELECTORS.savedCreditCardsBtn, SELECTORS.reauthCheckbox],
        async (saveButton, reauthCheckbox) => {
          is(
            content.document.querySelector(reauthCheckbox).checked,
            false,
            "OSReauth for credit cards should NOT be checked"
          );
          content.document.querySelector(saveButton).click();
        }
      );
      let ccManageDialog = await waitForSubDialogLoad(
        content,
        MANAGE_CREDIT_CARDS_DIALOG_URL
      );
      await SpecialPowers.spawn(ccManageDialog, [], async () => {
        let selRecords = content.document.getElementById("credit-cards");
        await EventUtils.synthesizeMouseAtCenter(
          selRecords.children[0],
          [],
          content
        );
        content.document.getElementById("edit").click();
      });
      info("The OS Auth dialog should NOT show up");
      // If OSAuth prompt shows up, the next line would cause a timeout since the edit dialog would not show up.
      await waitForSubDialogLoad(content, EDIT_CREDIT_CARD_DIALOG_URL);
    }
  );
  FormAutofillUtils.setOSAuthEnabled(true);
});
