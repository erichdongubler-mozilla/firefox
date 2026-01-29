/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

describe("settings ai features", () => {
  let doc, win;

  beforeEach(async function setup() {
    await SpecialPowers.pushPrefEnv({
      set: [["browser.preferences.aiControls", true]],
    });
    await openPreferencesViaOpenPreferencesAPI("general", { leaveOpen: true });
    doc = gBrowser.selectedBrowser.contentDocument;
    win = doc.ownerGlobal;
  });

  afterEach(() => {
    BrowserTestUtils.removeTab(gBrowser.selectedTab);
  });

  function waitForAnimationFrame() {
    return new Promise(r => win.requestAnimationFrame(r));
  }

  async function openAiFeaturePanel() {
    const paneLoaded = waitForPaneChange("ai");
    const categoryButton = doc.getElementById("category-ai-features");
    categoryButton.scrollIntoView();
    EventUtils.synthesizeMouseAtCenter(categoryButton, {}, win);
    await paneLoaded;
  }

  it("can change the chatbot provider value", async () => {
    await SpecialPowers.pushPrefEnv({
      set: [["browser.ml.chat.provider", ""]],
    });

    const categoryButton = doc.getElementById("category-ai-features");
    Assert.ok(categoryButton, "category exists");
    Assert.ok(
      BrowserTestUtils.isVisible(categoryButton),
      "category is visible"
    );

    await openAiFeaturePanel();

    const providerControl = doc.getElementById("aiControlSidebarChatbot");
    Assert.ok(providerControl, "control exists");
    Assert.ok(
      BrowserTestUtils.isVisible(providerControl),
      "control is visible"
    );
    Assert.equal(
      Services.prefs.getStringPref("browser.ml.chat.provider"),
      "",
      "Pref is empty"
    );

    Assert.equal(providerControl.value, "available", "No provider set");

    const settingChanged = waitForSettingChange(providerControl.setting);
    providerControl.focus();
    const pickerOpened = BrowserTestUtils.waitForSelectPopupShown(
      win.docShell.chromeEventHandler.ownerGlobal
    );
    EventUtils.sendKey("space");
    await pickerOpened;
    EventUtils.sendKey("down");
    EventUtils.sendKey("return");
    await settingChanged;

    Assert.notEqual(providerControl.value, "available", "Provider changed");
    Assert.notEqual(
      Services.prefs.getStringPref("browser.ml.chat.provider"),
      "available",
      "Pref is not empty"
    );

    await gBrowser.ownerGlobal.SidebarController.hide();
  });

  it("hides AI Window when preferences not enabled", async () => {
    await SpecialPowers.pushPrefEnv({
      set: [["browser.aiwindow.preferences.enabled", false]],
    });

    await openAiFeaturePanel();

    const aiWindowItem = doc.getElementById("AIWindowItem");
    const aiWindowFeatures = doc.getElementById("aiFeaturesAIWindowGroup");

    Assert.ok(
      !BrowserTestUtils.isVisible(aiWindowItem),
      "AIWindowItem is hidden when preferences not enabled"
    );
    Assert.ok(
      !BrowserTestUtils.isVisible(aiWindowFeatures),
      "aiWindowFeatures is hidden when preferences not enabled"
    );
  });

  it("shows AI Window activate when preferences enabled and feature not enabled", async () => {
    await SpecialPowers.pushPrefEnv({
      set: [
        ["browser.aiwindow.preferences.enabled", true],
        ["browser.aiwindow.enabled", false],
      ],
    });

    await openAiFeaturePanel();

    const aiWindowItem = doc.getElementById("AIWindowItem");
    Assert.ok(
      BrowserTestUtils.isVisible(aiWindowItem),
      "AIWindowItem is visible when preferences enabled and feature not enabled"
    );
  });

  it("hides AI Window activate when feature enabled", async () => {
    await SpecialPowers.pushPrefEnv({
      set: [
        ["browser.aiwindow.preferences.enabled", true],
        ["browser.aiwindow.enabled", true],
      ],
    });

    await openAiFeaturePanel();

    const aiWindowItem = doc.getElementById("AIWindowItem");
    Assert.ok(
      !BrowserTestUtils.isVisible(aiWindowItem),
      "AIWindowItem is hidden when feature enabled"
    );
  });

  describe("managed by policy", () => {
    async function runPolicyTest(name, pref, settingId) {
      try {
        Services.prefs.lockPref(pref);

        await openAiFeaturePanel();

        const control = doc.getElementById(settingId);
        Assert.ok(control, `${name} control exists`);
        Assert.ok(
          BrowserTestUtils.isVisible(control),
          `${name} control is visible when locked`
        );
        Assert.ok(
          control.disabled,
          `${name} control is disabled when pref is locked`
        );
      } finally {
        Services.prefs.unlockPref(pref);
      }
    }

    it("disables Smart Tab Groups control when pref is locked", async () => {
      await runPolicyTest(
        "Smart Tab Groups",
        "browser.tabs.groups.smart.userEnabled",
        "aiControlSmartTabGroups"
      );
    });

    it("disables Link Preview control when pref is locked", async () => {
      await runPolicyTest(
        "Link Preview",
        "browser.ml.linkPreview.optin",
        "aiControlLinkPreviewKeyPoints"
      );
    });

    it("disables Sidebar Chatbot control when pref is locked", async () => {
      await runPolicyTest(
        "Sidebar Chatbot",
        "browser.ml.chat.enabled",
        "aiControlSidebarChatbot"
      );
    });

    it("disables Translations control when pref is locked", async () => {
      await runPolicyTest(
        "Translations",
        "browser.translations.enable",
        "aiControlTranslations"
      );
    });
  });

  describe("block AI confirmation dialog", () => {
    it("closes dialog and does nothing on cancel", async () => {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["browser.ai.control.default", "available"],
          ["extensions.ml.enabled", true],
        ],
      });

      await openAiFeaturePanel();

      const toggle = doc.getElementById("aiControlsDefault");
      const dialogEl = doc.querySelector("block-ai-confirmation-dialog");
      await dialogEl.updateComplete;

      let dialogShown = BrowserTestUtils.waitForEvent(
        dialogEl.dialog,
        "toggle"
      );
      EventUtils.synthesizeMouseAtCenter(toggle.buttonEl, {}, win);
      await dialogShown;
      Assert.ok(dialogEl.dialog.open, "Dialog is open");
      Assert.equal(
        Services.prefs.getStringPref("browser.ai.control.default"),
        "available",
        "Pref unchanged after clicking toggle"
      );

      EventUtils.synthesizeMouseAtCenter(dialogEl.cancelButton, {}, win);

      Assert.ok(!dialogEl.dialog.open, "Dialog is closed after cancel");
      Assert.equal(
        Services.prefs.getStringPref("browser.ai.control.default"),
        "available",
        "Pref unchanged after cancel"
      );
      Assert.ok(
        Services.prefs.getBoolPref("extensions.ml.enabled"),
        "ML enabled pref unchanged after cancel"
      );
    });

    it("blocks AI features on confirm, unblocks on toggle off", async () => {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["browser.ai.control.default", "available"],
          ["extensions.ml.enabled", true],
        ],
      });
      Services.fog.testResetFOG();

      await openAiFeaturePanel();

      // Flip the toggle to show confirmation dialog.
      const toggle = doc.getElementById("aiControlsDefault");
      const dialogEl = doc.querySelector("block-ai-confirmation-dialog");
      await dialogEl.updateComplete;
      let dialogShown = BrowserTestUtils.waitForEvent(
        dialogEl.dialog,
        "toggle"
      );
      EventUtils.synthesizeMouseAtCenter(toggle.buttonEl, {}, win);
      await dialogShown;
      Assert.ok(dialogEl.dialog.open, "Dialog is open");
      Assert.ok(!toggle.pressed, "Toggle is unpressed during confirmation");
      Assert.equal(
        Services.prefs.getStringPref("browser.ai.control.default"),
        "available",
        "Pref unchanged after clicking toggle"
      );
      Assert.ok(
        !Glean.browser.globalAiControlToggled.testGetValue(),
        "No telemetry recorded before confirmation"
      );

      // Confirm the dialog to block
      let defaultSetting = win.Preferences.getSetting("aiControlsDefault");
      let translationsSetting = win.Preferences.getSetting(
        "aiControlTranslations"
      );
      Assert.equal(
        translationsSetting.value,
        "available",
        "Translations are enabled"
      );
      await waitForSettingChange(defaultSetting, () =>
        EventUtils.synthesizeMouseAtCenter(dialogEl.confirmButton, {}, win)
      );
      Assert.ok(toggle.pressed, "Toggle is pressed after block");
      Assert.ok(!dialogEl.dialog.open, "Dialog is closed after confirm");
      Assert.equal(
        Services.prefs.getStringPref("browser.ai.control.default"),
        "blocked",
        "Pref set to blocked after confirm"
      );
      Assert.ok(
        !Services.prefs.getBoolPref("extensions.ml.enabled"),
        "ML enabled pref set to false after confirm"
      );
      Assert.equal(
        translationsSetting.value,
        "blocked",
        "Translations are now blocked"
      );
      let telemetryEvents = Glean.browser.globalAiControlToggled.testGetValue();
      Assert.equal(telemetryEvents.length, 1, "One telemetry event recorded");
      Assert.equal(
        telemetryEvents[0].extra.blocked,
        "true",
        "Telemetry recorded blocked=true"
      );

      // Enable STG to confirm it stays enabled on un-block
      let stgSetting = win.Preferences.getSetting("aiControlSmartTabGroups");
      Assert.equal(
        stgSetting.value,
        "blocked",
        "STG is blocked after global block"
      );
      await waitForAnimationFrame();
      const stgControl = doc.getElementById("aiControlSmartTabGroups");
      stgControl.focus();
      let pickerOpened = BrowserTestUtils.waitForSelectPopupShown(
        win.docShell.chromeEventHandler.ownerGlobal
      );
      EventUtils.sendKey("space");
      await pickerOpened;
      await waitForSettingChange(stgSetting, () => {
        EventUtils.sendKey("up");
        EventUtils.sendKey("return");
      });
      Assert.equal(stgSetting.value, "enabled", "STG is now enabled");

      // Unblock to confirm reset to available and STG is still enabled
      toggle.buttonEl.scrollIntoView();
      await waitForAnimationFrame();
      await waitForSettingChange(defaultSetting, () =>
        EventUtils.synthesizeMouseAtCenter(toggle.buttonEl, {}, win)
      );
      Assert.ok(!toggle.pressed, "Toggle is not pressed after unblocking");
      Assert.equal(
        Services.prefs.getStringPref("browser.ai.control.default"),
        "available",
        "Pref set to available after unblocking"
      );
      Assert.ok(
        Services.prefs.getBoolPref("extensions.ml.enabled"),
        "ML enabled pref set to true after unblocking"
      );
      Assert.equal(
        translationsSetting.value,
        "available",
        "Translations are now available"
      );
      Assert.equal(stgSetting.value, "enabled", "STG stayed enabled");
      telemetryEvents = Glean.browser.globalAiControlToggled.testGetValue();
      Assert.equal(telemetryEvents.length, 2, "Two telemetry events recorded");
      Assert.equal(
        telemetryEvents[1].extra.blocked,
        "false",
        "Telemetry recorded blocked=false"
      );
    });
  });
});
