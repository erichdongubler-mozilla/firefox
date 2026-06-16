/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

/**
 * Tests for the intl:l10n-sources-changed observer notification fired by
 * L10nRegistry when sources are registered, updated, or removed at runtime
 * (Bug 2046945). Also verifies that Localization::Observe reacts to the
 * topic by invalidating its cached bundles.
 */

"use strict";

const { TestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/TestUtils.sys.mjs"
);

const TOPIC = "intl:l10n-sources-changed";

/**
 * Verifies that mutating the global L10nRegistry fires
 * intl:l10n-sources-changed once per call. Only the global registry
 * broadcasts; freshly-constructed (test-only) registries do not.
 */
add_task(async function test_topic_fires_on_global_registry_mutations() {
  const globalReg = L10nRegistry.getInstance();
  const SOURCE_NAME = "test-l10n-observer";

  const registered = TestUtils.topicObserved(TOPIC);
  globalReg.registerSources([
    new L10nFileSource(
      SOURCE_NAME,
      "test-l10n-observer-metasource",
      ["en-US"],
      "/test-l10n-observer/{locale}/"
    ),
  ]);
  await registered;
  Assert.ok(true, "Topic fired on registerSources");

  const updated = TestUtils.topicObserved(TOPIC);
  globalReg.updateSources([
    new L10nFileSource(
      SOURCE_NAME,
      "test-l10n-observer-metasource",
      ["en-US", "fr"],
      "/test-l10n-observer/{locale}/"
    ),
  ]);
  await updated;
  Assert.ok(true, "Topic fired on updateSources");

  const removed = TestUtils.topicObserved(TOPIC);
  globalReg.removeSources([SOURCE_NAME]);
  await removed;
  Assert.ok(true, "Topic fired on removeSources");
});

/**
 * Verifies that a Localization instance constructed BEFORE a source mutation
 * picks up the new source content on its next format call, because
 * Localization::Observe handles intl:l10n-sources-changed by invalidating
 * the bundle cache.
 *
 * Uses a per-test L10nRegistry (which does NOT auto-broadcast) and fires
 * the topic manually, isolating "does the topic invalidate cached bundles"
 * from "does the registry fire the topic" (covered above).
 */
add_task(async function test_localization_invalidates_on_topic() {
  const testReg = new L10nRegistry();

  testReg.registerSources([
    L10nFileSource.createMock(
      "test",
      "",
      ["en-US"],
      "/data/locales/{locale}/",
      [{ path: "/data/locales/en-US/test.ftl", source: "key = before" }]
    ),
  ]);

  const loc = new Localization(["test.ftl"], true, testReg, ["en-US"]);
  Assert.equal(
    loc.formatValueSync("key"),
    "before",
    "Initial formatValueSync resolves from the originally-registered source"
  );

  testReg.updateSources([
    L10nFileSource.createMock(
      "test",
      "",
      ["en-US"],
      "/data/locales/{locale}/",
      [{ path: "/data/locales/en-US/test.ftl", source: "key = after" }]
    ),
  ]);

  // Without an explicit notification the Localization still holds stale
  // bundles, since the test registry does not auto-broadcast.
  Assert.equal(
    loc.formatValueSync("key"),
    "before",
    "Without notification, Localization still returns cached value"
  );

  // Fire the topic the production registry would have fired, and verify
  // the cache is invalidated.
  Services.obs.notifyObservers(null, TOPIC);

  Assert.equal(
    loc.formatValueSync("key"),
    "after",
    "After intl:l10n-sources-changed, Localization picks up the updated source"
  );

  testReg.clearSources();
});

/**
 * Mutating the registry must NOT fire intl:app-locales-changed when the
 * set of available locales is unchanged. The dedicated
 * intl:l10n-sources-changed topic exists specifically so registry mutations
 * don't wake observers (font list, mozIntl caches, sidebar, tabbrowser, ...)
 * that only care about negotiated-locale changes.
 */
add_task(async function test_topic_separation_from_app_locales_changed() {
  const globalReg = L10nRegistry.getInstance();
  const SOURCE_NAME = "test-l10n-observer-separation";

  let appLocalesChangedFired = false;
  const appLocalesObserver = () => {
    appLocalesChangedFired = true;
  };
  Services.obs.addObserver(appLocalesObserver, "intl:app-locales-changed");

  // Wait for our source-change notification to confirm the mutation
  // completed before we assert on the separate locale-change topic.
  const sourcesChanged = TestUtils.topicObserved(TOPIC);
  globalReg.registerSources([
    new L10nFileSource(
      SOURCE_NAME,
      "test-l10n-observer-separation-metasource",
      // en-US is already in availableLocales, so the union doesn't grow.
      ["en-US"],
      "/test-l10n-observer-separation/{locale}/"
    ),
  ]);
  await sourcesChanged;

  const sourcesChanged2 = TestUtils.topicObserved(TOPIC);
  globalReg.removeSources([SOURCE_NAME]);
  await sourcesChanged2;

  Services.obs.removeObserver(appLocalesObserver, "intl:app-locales-changed");

  Assert.ok(
    !appLocalesChangedFired,
    "intl:app-locales-changed does not fire when availableLocales is unchanged"
  );
});
