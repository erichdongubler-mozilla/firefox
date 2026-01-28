/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "ipProtectionLocalization", () => {
  return new Localization(["preview/ipProtection.ftl"], true);
});

add_task(async function test_ipprotectionPrompts() {
  function setState(state) {
    IPPProxyManager.dispatchEvent(
      new CustomEvent("IPPProxyManager:StateChanged", {
        bubbles: true,
        composed: true,
        detail: {
          state,
        },
      })
    );
  }

  const [
    pausedTitle,
    pausedBody,
    closeTabsButton,
    continueButton,
    errorTitle,
    errorBody,
  ] = lazy.ipProtectionLocalization.formatMessagesSync([
    { id: "vpn-paused-alert-title" },
    { id: "vpn-paused-alert-body", args: { maxUsage: 150 } },
    { id: "vpn-paused-alert-close-tabs-button" },
    { id: "vpn-paused-alert-continue-wo-vpn-button" },
    { id: "vpn-error-alert-title" },
    { id: "vpn-error-alert-body" },
  ]);

  const localizationMessages = {
    pausedTitle: pausedTitle.value,
    pausedBody: pausedBody.value,
    closeTabsButton: closeTabsButton.value,
    continueButton: continueButton.value,
    errorTitle: errorTitle.value,
    errorBody: errorBody.value,
  };

  setState(IPPProxyStates.PAUSED);

  await TestUtils.waitForCondition(
    () => window.gDialogBox.isOpen,
    "Wait for the dialog to exist"
  );

  Assert.ok(window.gDialogBox.isOpen, "Dialog exists and is open");

  await TestUtils.waitForCondition(
    () =>
      window.gDialogBox.dialog._frame.contentDocument.getElementById(
        "titleContainer"
      ),
    "Wait for the dialog to load"
  );

  let dialogDoc = window.gDialogBox.dialog._frame.contentDocument;

  Assert.equal(
    dialogDoc.getElementById("titleContainer").textContent,
    localizationMessages.pausedTitle,
    "Dialog has paused title"
  );

  Assert.equal(
    dialogDoc.getElementById("infoBody").textContent,
    localizationMessages.pausedBody,
    "Dialog has paused body"
  );

  Assert.equal(
    dialogDoc
      .getElementById("commonDialog")
      .shadowRoot.querySelector("button[dlgtype='accept']").label,
    localizationMessages.continueButton,
    "Dialog has continue button label"
  );

  Assert.equal(
    dialogDoc
      .getElementById("commonDialog")
      .shadowRoot.querySelector("button[dlgtype='cancel']").label,
    localizationMessages.closeTabsButton,
    "Dialog has continue button label"
  );

  setState(IPPProxyStates.ACTIVE);

  await TestUtils.waitForCondition(
    () => !window.gDialogBox.isOpen,
    "Wait for the dialog to not exist"
  );

  Assert.ok(
    !window.gDialogBox.isOpen,
    "Dialog disappears when in active state"
  );

  await TestUtils.waitForTick();

  setState(IPPProxyStates.ERROR);

  await TestUtils.waitForCondition(
    () => window.gDialogBox.isOpen,
    "Wait for the dialog to exist"
  );

  Assert.ok(window.gDialogBox.isOpen, "Dialog exists and is open");

  await TestUtils.waitForCondition(
    () =>
      window.gDialogBox.dialog._frame.contentDocument.getElementById(
        "titleContainer"
      ),
    "Wait for the dialog to load"
  );

  dialogDoc = window.gDialogBox.dialog._frame.contentDocument;

  Assert.equal(
    dialogDoc.getElementById("titleContainer").textContent,
    localizationMessages.errorTitle,
    "Dialog has error title"
  );

  Assert.equal(
    dialogDoc.getElementById("infoBody").textContent,
    localizationMessages.errorBody,
    "Dialog has error body"
  );

  Assert.equal(
    dialogDoc
      .getElementById("commonDialog")
      .shadowRoot.querySelector("button[dlgtype='accept']").label,
    localizationMessages.continueButton,
    "Dialog has continue button label"
  );

  Assert.equal(
    dialogDoc
      .getElementById("commonDialog")
      .shadowRoot.querySelector("button[dlgtype='cancel']").label,
    localizationMessages.closeTabsButton,
    "Dialog has continue button label"
  );
});
