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

    const providerControl = doc.getElementById("aiControlSidebarChatbotSelect");
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

  it("hides Smart Window when preferences not enabled", async () => {
    await SpecialPowers.pushPrefEnv({
      set: [["browser.aiwindow.preferences.enabled", false]],
    });

    await openAiFeaturePanel();

    const aiWindowFeatures = doc.getElementById("aiFeaturesSmartWindowGroup");
    Assert.ok(
      !BrowserTestUtils.isVisible(aiWindowFeatures),
      "smartWindowFeatures is hidden when preferences not enabled"
    );
  });

  it("shows Smart Window activate when preferences enabled and feature not enabled", async () => {
    await SpecialPowers.pushPrefEnv({
      set: [
        ["browser.aiwindow.preferences.enabled", true],
        ["browser.aiwindow.enabled", false],
      ],
    });

    await openAiFeaturePanel();

    const smartWindowActivateLink = doc.getElementById(
      "activateSmartWindowLink"
    );
    Assert.ok(
      BrowserTestUtils.isVisible(smartWindowActivateLink),
      "smartWindowActivateLink is visible when preferences enabled and feature not enabled"
    );
  });

  it("hides Smart Window activate and show personalize button when feature enabled", async () => {
    await SpecialPowers.pushPrefEnv({
      set: [
        ["browser.aiwindow.preferences.enabled", true],
        ["browser.aiwindow.enabled", true],
      ],
    });

    await openAiFeaturePanel();

    const smartWindowActivateLink = doc.getElementById(
      "activateSmartWindowLink"
    );
    const smartWindowPersonalizeButton = doc.getElementById(
      "personalizeSmartWindowButton"
    );
    Assert.ok(
      !BrowserTestUtils.isVisible(smartWindowActivateLink) &&
        BrowserTestUtils.isVisible(smartWindowPersonalizeButton),
      "smartWindowActivateLink is hidden and smartWindowPersonalizeButton is visible when feature enabled"
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
        "aiControlSmartTabGroupsSelect"
      );
    });

    it("disables Link Preview control when pref is locked", async () => {
      await runPolicyTest(
        "Link Preview",
        "browser.ml.linkPreview.optin",
        "aiControlLinkPreviewKeyPointsSelect"
      );
    });

    it("disables Sidebar Chatbot control when pref is locked", async () => {
      await runPolicyTest(
        "Sidebar Chatbot",
        "browser.ml.chat.enabled",
        "aiControlSidebarChatbotSelect"
      );
    });

    it("disables Translations control when pref is locked", async () => {
      await runPolicyTest(
        "Translations",
        "browser.translations.enable",
        "aiControlTranslationsSelect"
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

      const toggle = doc.getElementById("aiControlDefaultToggle");
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
      const toggle = doc.getElementById("aiControlDefaultToggle");
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
      let defaultSetting = win.Preferences.getSetting("aiControlDefaultToggle");
      let translationsSetting = win.Preferences.getSetting(
        "aiControlTranslationsSelect"
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
      let stgSetting = win.Preferences.getSetting(
        "aiControlSmartTabGroupsSelect"
      );
      Assert.equal(
        stgSetting.value,
        "blocked",
        "STG is blocked after global block"
      );
      await waitForAnimationFrame();
      const stgControl = doc.getElementById("aiControlSmartTabGroupsSelect");
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

  describe("AI Controls visibility on General pane", () => {
    it("hides Link Preview setting when globally blocked via AI Controls toggle", async () => {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["browser.ai.control.default", "available"],
          ["browser.ai.control.linkPreviewKeyPoints", "default"],
          ["browser.ml.linkPreview.enabled", true],
        ],
      });

      let aiControlsTab = gBrowser.selectedTab;
      await openAiFeaturePanel();

      await new Promise(resolve => open_preferences(resolve));
      let generalTab = gBrowser.selectedTab;
      let generalDoc = gBrowser.selectedBrowser.contentDocument;
      let generalWin = generalDoc.ownerGlobal;

      let linkPreviewSetting =
        generalWin.Preferences.getSetting("linkPreviewEnabled");
      let linkPreviewControl = generalDoc.getElementById("linkPreviewEnabled");
      Assert.ok(
        BrowserTestUtils.isVisible(linkPreviewControl),
        "Link Preview control is visible"
      );

      gBrowser.selectedTab = aiControlsTab;
      const toggle = doc.getElementById("aiControlDefaultToggle");
      const dialogEl = doc.querySelector("block-ai-confirmation-dialog");
      await dialogEl.updateComplete;
      let dialogShown = BrowserTestUtils.waitForEvent(
        dialogEl.dialog,
        "toggle"
      );
      EventUtils.synthesizeMouseAtCenter(toggle.buttonEl, {}, win);
      await dialogShown;
      Assert.ok(dialogEl.dialog.open, "Dialog is open");
      await waitForSettingChange(linkPreviewSetting, () =>
        EventUtils.synthesizeMouseAtCenter(dialogEl.confirmButton, {}, win)
      );

      gBrowser.selectedTab = generalTab;
      Assert.ok(
        !BrowserTestUtils.isVisible(linkPreviewControl),
        "Link Preview control is hidden after blocking"
      );

      // Explicitly enable Link Preview while globally blocked
      gBrowser.selectedTab = aiControlsTab;
      const linkPreviewSelect = doc.getElementById(
        "aiControlLinkPreviewKeyPointsSelect"
      );
      linkPreviewSelect.scrollIntoView();
      await waitForAnimationFrame();
      linkPreviewSelect.focus();
      let pickerOpened = BrowserTestUtils.waitForSelectPopupShown(
        win.docShell.chromeEventHandler.ownerGlobal
      );
      EventUtils.sendKey("space");
      await pickerOpened;
      await waitForSettingChange(linkPreviewSetting, () => {
        EventUtils.sendKey("up");
        EventUtils.sendKey("return");
      });

      gBrowser.selectedTab = generalTab;
      Assert.ok(
        BrowserTestUtils.isVisible(linkPreviewControl),
        "Link Preview control is visible after explicitly enabling"
      );

      BrowserTestUtils.removeTab(generalTab);
    });

    it("hides Tab Group Suggestions when globally blocked", async () => {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["browser.ai.control.default", "available"],
          ["browser.ai.control.smartTabGroups", "default"],
          ["browser.tabs.groups.enabled", true],
          ["browser.tabs.groups.smart.enabled", true],
          ["browser.tabs.groups.smart.userEnabled", true],
        ],
      });

      // Tab Group Suggestions is only available in en-* locales
      if (!Services.locale.appLocaleAsBCP47.startsWith("en")) {
        Assert.ok(true, "Skipping: locale is not en-*");
        return;
      }

      let aiControlsTab = gBrowser.selectedTab;
      await openAiFeaturePanel();

      await new Promise(resolve => open_preferences(resolve));
      let generalTab = gBrowser.selectedTab;
      let generalDoc = gBrowser.selectedBrowser.contentDocument;
      let generalWin = generalDoc.ownerGlobal;

      let tabGroupSetting = generalWin.Preferences.getSetting(
        "tabGroupSuggestions"
      );
      let tabGroupControl = generalDoc.getElementById("tabGroupSuggestions");
      Assert.ok(
        BrowserTestUtils.isVisible(tabGroupControl),
        "Tab Group Suggestions control is visible"
      );

      gBrowser.selectedTab = aiControlsTab;
      const toggle = doc.getElementById("aiControlDefaultToggle");
      const dialogEl = doc.querySelector("block-ai-confirmation-dialog");
      await dialogEl.updateComplete;
      let dialogShown = BrowserTestUtils.waitForEvent(
        dialogEl.dialog,
        "toggle"
      );
      EventUtils.synthesizeMouseAtCenter(toggle.buttonEl, {}, win);
      await dialogShown;
      Assert.ok(dialogEl.dialog.open, "Dialog is open");
      await waitForSettingChange(tabGroupSetting, () =>
        EventUtils.synthesizeMouseAtCenter(dialogEl.confirmButton, {}, win)
      );

      gBrowser.selectedTab = generalTab;
      Assert.ok(
        !BrowserTestUtils.isVisible(tabGroupControl),
        "Tab Group Suggestions control is hidden after blocking"
      );

      BrowserTestUtils.removeTab(generalTab);
    });

    it("shows settings when unblocked via global toggle", async () => {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["browser.ai.control.default", "blocked"],
          ["browser.ai.control.linkPreviewKeyPoints", "default"],
          ["browser.ml.linkPreview.enabled", true],
          ["extensions.ml.enabled", false],
        ],
      });

      let aiControlsTab = gBrowser.selectedTab;
      await openAiFeaturePanel();

      await new Promise(resolve => open_preferences(resolve));
      let generalTab = gBrowser.selectedTab;
      let generalDoc = gBrowser.selectedBrowser.contentDocument;
      let generalWin = generalDoc.ownerGlobal;

      let linkPreviewSetting =
        generalWin.Preferences.getSetting("linkPreviewEnabled");
      let linkPreviewControl = generalDoc.getElementById("linkPreviewEnabled");
      Assert.ok(
        !BrowserTestUtils.isVisible(linkPreviewControl),
        "Link Preview control is hidden when blocked"
      );

      gBrowser.selectedTab = aiControlsTab;
      const toggle = doc.getElementById("aiControlDefaultToggle");
      Assert.ok(toggle.pressed, "Toggle is pressed (blocked state)");
      await waitForSettingChange(linkPreviewSetting, () =>
        EventUtils.synthesizeMouseAtCenter(toggle.buttonEl, {}, win)
      );

      gBrowser.selectedTab = generalTab;
      Assert.ok(
        BrowserTestUtils.isVisible(linkPreviewControl),
        "Link Preview control is visible after unblocking"
      );

      BrowserTestUtils.removeTab(generalTab);
    });
  });

  describe("Smart Window memories", () => {
    async function openSmartWindowPanel() {
      await openAiFeaturePanel();
      const personalizeButton = doc.getElementById(
        "personalizeSmartWindowButton"
      );
      personalizeButton.scrollIntoView();
      const paneLoaded = waitForPaneChange("personalizeSmartWindow");
      EventUtils.synthesizeMouseAtCenter(personalizeButton, {}, win);
      await paneLoaded;
    }

    async function openManageMemoriesPanel() {
      await openSmartWindowPanel();
      const manageButton = doc.getElementById("manageMemoriesButton");
      manageButton.scrollIntoView();
      const paneLoaded = waitForPaneChange("manageMemories");
      EventUtils.synthesizeMouseAtCenter(manageButton, {}, win);
      await paneLoaded;
    }

    async function populateMemories() {
      const { MemoryStore } = ChromeUtils.importESModule(
        "moz-src:///browser/components/aiwindow/services/MemoryStore.sys.mjs"
      );

      let memoryOne = await MemoryStore.addMemory({
        memory_summary: "Lorem ipsum dolor sit amet 1",
        category: "interests",
        intent: "general",
        score: 5,
      });
      let memoryTwo = await MemoryStore.addMemory({
        memory_summary: "Lorem ipsum dolor sit amet 2",
        category: "habits",
        intent: "general",
        score: 4,
      });

      registerCleanupFunction(async () => {
        for (const { id } of [memoryOne, memoryTwo]) {
          try {
            await MemoryStore.hardDeleteMemory(id);
          } catch (err) {
            console.error("Failed to delete memory:", id, err);
          }
        }
      });

      return { MemoryStore, memories: [memoryOne, memoryTwo] };
    }

    it("shows Personalize Smart Window button when AI Window is enabled", async () => {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["browser.aiwindow.preferences.enabled", true],
          ["browser.aiwindow.enabled", true],
        ],
      });

      await openAiFeaturePanel();

      const personalizeButton = doc.getElementById(
        "personalizeSmartWindowButton"
      );
      Assert.ok(personalizeButton, "Personalize Smart Window button exists");
      Assert.ok(
        BrowserTestUtils.isVisible(personalizeButton),
        "Personalize Smart Window button is visible"
      );
    });

    it("toggles Learn from activity preference", async () => {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["browser.aiwindow.preferences.enabled", true],
          ["browser.aiwindow.enabled", true],
          ["browser.aiwindow.memories", false],
        ],
      });

      await openSmartWindowPanel();

      const learnFromActivity = doc.getElementById("learnFromActivity");
      Assert.ok(!learnFromActivity.checked, "Checkbox is unchecked initially");

      learnFromActivity.scrollIntoView();
      EventUtils.synthesizeMouseAtCenter(learnFromActivity.labelEl, {}, win);
      await learnFromActivity.updateComplete;

      Assert.ok(
        Services.prefs.getBoolPref("browser.aiwindow.memories"),
        "Preference is now true"
      );
      Assert.ok(learnFromActivity.checked, "Checkbox is now checked");
    });

    it("shows empty state when no memories exist", async () => {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["browser.aiwindow.preferences.enabled", true],
          ["browser.aiwindow.enabled", true],
          ["browser.aiwindow.memories", true],
        ],
      });

      await openManageMemoriesPanel();

      const noMemoriesItem = doc.getElementById("no-memories-stored");
      Assert.ok(noMemoriesItem, "No memories item exists");
      Assert.ok(
        BrowserTestUtils.isVisible(noMemoriesItem),
        "No memories item is visible"
      );
    });

    it("shows different empty state when learning is disabled", async () => {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["browser.aiwindow.preferences.enabled", true],
          ["browser.aiwindow.enabled", true],
          ["browser.aiwindow.memories", false],
        ],
      });

      await openManageMemoriesPanel();

      // Force the async setting to refresh after pref change
      const memoriesList = doc.getElementById("memoriesList");
      if (memoriesList?.setting?.config?.asyncSetting) {
        memoriesList.setting.config.asyncSetting.emitChange();
        await new Promise(r => win.requestAnimationFrame(r));
      }

      const noMemoriesItem = doc.getElementById("no-memories-stored");
      Assert.ok(noMemoriesItem, "No memories item exists");

      Assert.equal(
        noMemoriesItem.dataset.l10nId,
        "ai-window-no-memories-learning-off",
        "Shows learning-off empty state l10n ID"
      );
    });

    it("renders memory items when data is present", async () => {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["browser.aiwindow.preferences.enabled", true],
          ["browser.aiwindow.enabled", true],
          ["browser.aiwindow.memories", true],
        ],
      });

      await populateMemories();
      await openManageMemoriesPanel();

      const memoriesList = doc.getElementById("memoriesList");
      await memoriesList.updateComplete;

      const memoryItems = memoriesList.querySelectorAll("[id^='memory-item']");
      Assert.greaterOrEqual(
        memoryItems.length,
        2,
        "At least two memory items are rendered"
      );
    });

    it("can delete an individual memory", async () => {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["browser.aiwindow.preferences.enabled", true],
          ["browser.aiwindow.enabled", true],
          ["browser.aiwindow.memories", true],
        ],
      });

      const { MemoryStore, memories } = await populateMemories();
      const testMemory = memories[0];

      await openManageMemoriesPanel();

      const memoriesList = doc.getElementById("memoriesList");
      await memoriesList.updateComplete;

      const initialMemories = await MemoryStore.getMemories();
      const initialCount = initialMemories.length;

      const deleteButton = memoriesList.querySelector(
        `[memoryId="${testMemory.id}"][action="delete"]`
      );
      Assert.ok(deleteButton, "Delete button exists for the memory");

      EventUtils.synthesizeMouseAtCenter(deleteButton, {}, win);

      await BrowserTestUtils.waitForCondition(async () => {
        const currentMemories = await MemoryStore.getMemories();
        return currentMemories.length < initialCount;
      }, "Waiting for memory to be deleted");

      const remainingMemories = await MemoryStore.getMemories();
      Assert.ok(
        !remainingMemories.find(m => m.id === testMemory.id),
        "Memory was deleted"
      );
    });
  });
});
