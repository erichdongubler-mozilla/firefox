/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * Test that we don't show the backup section if backup is disabled
 */
add_task(async function () {
  await openPreferencesViaOpenPreferencesAPI("paneSync", {
    leaveOpen: true,
  });

  await SpecialPowers.pushPrefEnv({
    set: [["browser.backup.archive.enabled", false]],
  });

  let settings = gBrowser.contentDocument.querySelector(
    "setting-group[groupid='backup']"
  );
  ok(
    BrowserTestUtils.isHidden(settings),
    "backup setting-group is not visible"
  );

  // Check that we don't get any results in sync when searching:
  await evaluateSearchResults("backup", "no-results-message");

  BrowserTestUtils.removeTab(gBrowser.selectedTab);
});

/**
 * Test that we don't show the backup section if backup is disabled
 */
add_task(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.backup.archive.enabled", true]],
  });

  await openPreferencesViaOpenPreferencesAPI("paneSync", {
    leaveOpen: true,
  });

  let settings = gBrowser.contentDocument.querySelector(
    "setting-group[groupid='backup']"
  );
  ok(BrowserTestUtils.isVisible(settings), "backup setting-group is visible");

  // Check that we don't get any results in sync when searching:
  await evaluateSearchResults("backup", "backup");

  BrowserTestUtils.removeTab(gBrowser.selectedTab);
});

/**
 * Searching for "backup" must surface the backup section when scheduled
 * backups are ON.
 */
add_task(async function search_with_scheduled_backups_on() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.backup.archive.enabled", true]],
  });

  await openPreferencesViaOpenPreferencesAPI("paneSync", {
    leaveOpen: true,
  });

  let doc = gBrowser.contentDocument;

  let backupSettings = doc.querySelector("backup-settings");
  ok(backupSettings, "backup-settings element exists");

  // Drive the widget into the "scheduled backups ON" state.
  backupSettings.backupServiceState = {
    ...backupSettings.backupServiceState,
    archiveEnabledStatus: true,
    restoreEnabledStatus: true,
    scheduledBackupsEnabled: true,
    encryptionEnabled: true,
    lastBackupDate: Math.floor(Date.now() / 1000),
    lastBackupFileName: "FirefoxBackup_test.html",
    backupDirPath: "/tmp/backups",
  };
  await backupSettings.updateComplete;

  // The "Backup is ON" label lives in the nested moz-box-item shadow root and
  // is populated by Fluent asynchronously; force the translation now so the
  // search sees it.
  let item = backupSettings.shadowRoot.querySelector("#scheduled-backups");
  ok(item, "scheduled-backups moz-box-item exists");
  await doc.l10n.translateElements([item]);
  await item.updateComplete;
  is(item.getAttribute("label"), "Backup is ON", "label is in the ON state");

  // The real search must complete (it used to throw) and show the section.
  await evaluateSearchResults("backup", "backup");

  BrowserTestUtils.removeTab(gBrowser.selectedTab);
});
