"use strict";

const { AboutWelcomeDefaults } = ChromeUtils.importESModule(
  "resource:///modules/aboutwelcome/AboutWelcomeDefaults.sys.mjs"
);

function getThemePickerScreen() {
  const { screens } = AboutWelcomeDefaults.getDefaults();
  return screens.find(screen => screen.id === "AW_THEME_PICKER");
}

add_task(async function test_aboutwelcome_theme_picker_screen_displays() {
  // AW_THEME_PICKER is targeted on browser.nova.enabled.
  await pushPrefs(["browser.nova.enabled", true]);
  await setAboutWelcomeMultiStage(JSON.stringify([getThemePickerScreen()]));
  let { cleanup, browser } = await openMRAboutWelcome();

  await test_screen_content(
    browser,
    "theme picker screen renders",
    // Expected selectors:
    ["main.AW_THEME_PICKER", ".main-content", "theme-picker"]
  );

  await SpecialPowers.spawn(browser, [], async () => {
    const themePicker = await ContentTaskUtils.waitForCondition(
      () => content.document.querySelector("theme-picker"),
      "theme-picker element should be present"
    );

    await themePicker.updateComplete;

    await ContentTaskUtils.waitForCondition(
      () =>
        !!themePicker.shadowRoot.querySelectorAll("moz-visual-picker-item")
          .length,
      "theme-picker should render at least one theme button"
    );
  });

  await Services.fog.testFlushAllChildren();
  Services.fog.testResetFOG();

  await SpecialPowers.spawn(browser, [], async () => {
    const themePicker = content.document.querySelector("theme-picker");
    let actorEventCount = 0;
    const countActorEvent = () => actorEventCount++;
    content.document.addEventListener("ThemePickerShown", countActorEvent);

    themePicker.wrappedJSObject.shown();
    themePicker.wrappedJSObject.shown();

    content.document.removeEventListener("ThemePickerShown", countActorEvent);
    Assert.equal(
      actorEventCount,
      2,
      "Both shown calls should be forwarded to the child actor"
    );
  });

  await Services.fog.testFlushAllChildren();
  const events = Glean.themePicker.shown.testGetValue();
  Assert.equal(events?.length, 1, "The child actor should record shown once");
  Assert.equal(
    events?.[0].extra.source,
    "unknown",
    "The default source should be recorded"
  );
  Assert.equal(
    events?.[0].extra.layout,
    "full",
    "The full picker layout should be recorded"
  );

  await cleanup();
  await popPrefs();
});
