/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PREF_NAME = "browser.backup.enabled_on.profiles";

add_task(async function test_upgrade_object_to_array() {
  const { ProfileDataUpgrader } = ChromeUtils.importESModule(
    "moz-src:///browser/components/ProfileDataUpgrader.sys.mjs"
  );

  Services.prefs.setStringPref(
    PREF_NAME,
    JSON.stringify({ "profile-1": true, "profile-2": true })
  );

  ProfileDataUpgrader.upgrade(172, 173);

  let value = JSON.parse(Services.prefs.getStringPref(PREF_NAME, "[]"));
  Assert.ok(Array.isArray(value), "Pref should be an array");
  Assert.ok(value.includes("profile-1"), "profile-1 should be in array");
  Assert.ok(value.includes("profile-2"), "profile-2 should be in array");
  Assert.equal(value.length, 2, "Should have 2 profiles");

  Services.prefs.clearUserPref(PREF_NAME);
});

add_task(async function test_upgrade_already_array_does_nothing() {
  const { ProfileDataUpgrader } = ChromeUtils.importESModule(
    "moz-src:///browser/components/ProfileDataUpgrader.sys.mjs"
  );

  const original = ["profile-a", "profile-b"];
  Services.prefs.setStringPref(PREF_NAME, JSON.stringify(original));

  ProfileDataUpgrader.upgrade(172, 173);

  let value = JSON.parse(Services.prefs.getStringPref(PREF_NAME, "[]"));
  Assert.deepEqual(value, original, "Array should be unchanged");

  Services.prefs.clearUserPref(PREF_NAME);
});

add_task(async function test_upgrade_empty_pref_does_nothing() {
  const { ProfileDataUpgrader } = ChromeUtils.importESModule(
    "moz-src:///browser/components/ProfileDataUpgrader.sys.mjs"
  );

  Services.prefs.clearUserPref(PREF_NAME);

  ProfileDataUpgrader.upgrade(172, 173);

  Assert.ok(!Services.prefs.prefHasUserValue(PREF_NAME), "No pref created");
});
