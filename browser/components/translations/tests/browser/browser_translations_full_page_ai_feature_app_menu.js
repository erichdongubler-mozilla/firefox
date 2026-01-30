/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * This test case ensures that the Application Menu Translate item responds to the
 * Translations feature becoming enabled, and then disabled again.
 */
add_task(async function test_app_menu_ai_feature_toggle_from_disabled() {
  const { cleanup, runInPage } = await loadTestPage({
    page: SPANISH_PAGE_URL,
    languagePairs: LANGUAGE_PAIRS,
    prefs: [
      ["browser.translations.enable", false],
      ["browser.ai.control.default", "blocked"],
      ["browser.ai.control.translations", "blocked"],
    ],
  });

  await FullPageTranslationsTestUtils.assertPageIsNotTranslated(runInPage);
  await FullPageTranslationsTestUtils.assertAppMenuTranslateItemVisibility(
    { visible: false },
    "The app-menu translate button is hidden when the page loads with Translations feature disabled."
  );

  await TranslationsParent.AIFeature.enable();
  await FullPageTranslationsTestUtils.assertAppMenuTranslateItemVisibility(
    { visible: true },
    "The app-menu translate button is visible when the Translations feature is enabled."
  );

  await TranslationsParent.AIFeature.disable();
  await FullPageTranslationsTestUtils.assertAppMenuTranslateItemVisibility(
    { visible: false },
    "The app-menu translate button is hidden after disabling the Translations feature."
  );

  await cleanup();
});

/**
 * This test case ensures that the Application Menu Translate item responds to the
 * Translations feature becoming disabled, and then enabled again.
 */
add_task(async function test_app_menu_ai_feature_toggle_from_enabled() {
  const { cleanup, runInPage } = await loadTestPage({
    page: SPANISH_PAGE_URL,
    languagePairs: LANGUAGE_PAIRS,
    prefs: [
      ["browser.ai.control.default", "available"],
      ["browser.ai.control.translations", "default"],
    ],
  });

  await FullPageTranslationsTestUtils.assertPageIsNotTranslated(runInPage);

  await TranslationsParent.AIFeature.enable();
  await FullPageTranslationsTestUtils.assertAppMenuTranslateItemVisibility(
    { visible: true },
    "The app-menu translate button is visible when the Translations feature is enabled."
  );

  await TranslationsParent.AIFeature.disable();
  await FullPageTranslationsTestUtils.assertAppMenuTranslateItemVisibility(
    { visible: false },
    "The app-menu translate button is hidden when the Translations feature is disabled."
  );

  await TranslationsParent.AIFeature.enable();
  await FullPageTranslationsTestUtils.assertAppMenuTranslateItemVisibility(
    { visible: true },
    "The app-menu translate button is visible after enabling the Translations feature."
  );

  await cleanup();
});
