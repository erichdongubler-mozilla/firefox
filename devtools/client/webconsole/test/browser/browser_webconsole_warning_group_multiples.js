/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Test that warning messages can be grouped, per navigation and category, and that
// interacting with these groups works as expected.

"use strict";
requestLongerTimeout(2);

const TEST_FILE =
  "browser/devtools/client/webconsole/test/browser/test-warning-groups.html";
const TEST_URI = "https://example.org/" + TEST_FILE;

const TRACKER_URL = "https://tracking.example.com/";
const IMG_FILE =
  "browser/devtools/client/webconsole/test/browser/test-image.png";
const CONTENT_BLOCKED_BY_ETP_URL = TRACKER_URL + IMG_FILE;
const STORAGE_BLOCKED_URL = "https://example.com/" + IMG_FILE;

const COOKIE_BEHAVIOR_PREF = "network.cookie.cookieBehavior";
const COOKIE_BEHAVIORS_REJECT_FOREIGN = 1;

const ENHANCED_TRACKING_PROTECTION_GROUP_LABEL =
  "The resource at “<URL>” was blocked because Enhanced Tracking Protection is enabled.";
const STORAGE_BLOCKED_GROUP_LABEL =
  "Request to access cookie or storage on “<URL>” " +
  "was blocked because we are blocking all third-party storage access requests and " +
  "Enhanced Tracking Protection is enabled.";

const { UrlClassifierTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/UrlClassifierTestUtils.sys.mjs"
);
UrlClassifierTestUtils.addTestTrackers();
registerCleanupFunction(function () {
  UrlClassifierTestUtils.cleanupTestTrackers();
});

pushPref("privacy.trackingprotection.enabled", true);
pushPref("devtools.webconsole.groupSimilarMessages", true);

add_task(async function testEnhancedTrackingProtectionMessage() {
  await pushPref(COOKIE_BEHAVIOR_PREF, COOKIE_BEHAVIORS_REJECT_FOREIGN);
  await pushPref("devtools.webconsole.persistlog", true);

  const hud = await openNewTabAndConsole(TEST_URI);

  // Bug 1763367 - Filter out message like:
  //  Cookie “name=value” has been rejected as third-party.
  // that appear in a random order.
  await setFilterState(hud, { text: "-has been rejected" });

  info(
    "Log a tracking protection message to check a single message isn't grouped"
  );
  let onContentBlockedByETPWarningMessage = waitForMessageByType(
    hud,
    CONTENT_BLOCKED_BY_ETP_URL,
    ".warn"
  );
  emitEnhancedTrackingProtectionMessage(hud);
  let { node } = await onContentBlockedByETPWarningMessage;
  is(
    node.querySelector(".warning-indent"),
    null,
    "The message has the expected style"
  );
  is(
    node.getAttribute("data-indent"),
    "0",
    "The message has the expected indent"
  );

  info("Log a simple message");
  await logString(hud, "simple message 1");

  info(
    "Log a second tracking protection message to check that it causes the grouping"
  );
  let onContentBlockedByETPWarningGroupMessage = waitForMessageByType(
    hud,
    ENHANCED_TRACKING_PROTECTION_GROUP_LABEL,
    ".warn"
  );
  emitEnhancedTrackingProtectionMessage(hud);
  const { node: contentBlockedByETPWarningGroupNode } =
    await onContentBlockedByETPWarningGroupMessage;
  is(
    contentBlockedByETPWarningGroupNode.querySelector(".warning-group-badge")
      .textContent,
    "2",
    "The badge has the expected text"
  );

  await checkConsoleOutputForWarningGroup(hud, [
    `▶︎⚠ ${ENHANCED_TRACKING_PROTECTION_GROUP_LABEL}`,
    `simple message 1`,
  ]);

  let onStorageBlockedWarningGroupMessage = waitForMessageByType(
    hud,
    STORAGE_BLOCKED_URL,
    ".warn"
  );

  emitStorageAccessBlockedMessage(hud);
  ({ node } = await onStorageBlockedWarningGroupMessage);
  is(
    node.querySelector(".warning-indent"),
    null,
    "The message has the expected style"
  );
  is(
    node.getAttribute("data-indent"),
    "0",
    "The message has the expected indent"
  );

  info("Log a second simple message");
  await logString(hud, "simple message 2");

  await checkConsoleOutputForWarningGroup(hud, [
    `▶︎⚠ ${ENHANCED_TRACKING_PROTECTION_GROUP_LABEL}`,
    `simple message 1`,
    `${STORAGE_BLOCKED_URL}`,
    `simple message 2`,
  ]);

  info(
    "Log a second storage blocked message to check that it creates another group"
  );
  onStorageBlockedWarningGroupMessage = waitForMessageByType(
    hud,
    STORAGE_BLOCKED_GROUP_LABEL,
    ".warn"
  );
  emitStorageAccessBlockedMessage(hud);
  const { node: storageBlockedWarningGroupNode } =
    await onStorageBlockedWarningGroupMessage;
  is(
    storageBlockedWarningGroupNode.querySelector(".warning-group-badge")
      .textContent,
    "2",
    "The badge has the expected text"
  );

  info("Expand the second warning group");
  storageBlockedWarningGroupNode.querySelector(".arrow").click();
  await waitFor(() => findWarningMessage(hud, STORAGE_BLOCKED_URL));

  await checkConsoleOutputForWarningGroup(hud, [
    `▶︎⚠ ${ENHANCED_TRACKING_PROTECTION_GROUP_LABEL}`,
    `simple message 1`,
    `▼︎⚠ ${STORAGE_BLOCKED_GROUP_LABEL}`,
    `| ${STORAGE_BLOCKED_URL}?3`,
    `| ${STORAGE_BLOCKED_URL}?4`,
    `simple message 2`,
  ]);

  info(
    "Add another storage blocked message to check it does go into the opened group"
  );
  let onStorageBlockedMessage = waitForMessageByType(
    hud,
    STORAGE_BLOCKED_URL,
    ".warn"
  );
  emitStorageAccessBlockedMessage(hud);
  await onStorageBlockedMessage;

  await checkConsoleOutputForWarningGroup(hud, [
    `▶︎⚠ ${ENHANCED_TRACKING_PROTECTION_GROUP_LABEL}`,
    `simple message 1`,
    `▼︎⚠ ${STORAGE_BLOCKED_GROUP_LABEL}`,
    `| ${STORAGE_BLOCKED_URL}?3`,
    `| ${STORAGE_BLOCKED_URL}?4`,
    `| ${STORAGE_BLOCKED_URL}?5`,
    `simple message 2`,
  ]);

  info(
    "Add a message indicating content was blocked by Enhanced Tracking Protection to check the first group badge is updated"
  );
  emitEnhancedTrackingProtectionMessage();
  await waitForBadgeNumber(contentBlockedByETPWarningGroupNode, 3);

  info("Expand the first warning group");
  contentBlockedByETPWarningGroupNode.querySelector(".arrow").click();
  await waitFor(() => findWarningMessage(hud, CONTENT_BLOCKED_BY_ETP_URL));

  await checkConsoleOutputForWarningGroup(hud, [
    `▼︎⚠ ${ENHANCED_TRACKING_PROTECTION_GROUP_LABEL}`,
    `| ${CONTENT_BLOCKED_BY_ETP_URL}?1`,
    `| ${CONTENT_BLOCKED_BY_ETP_URL}?2`,
    `| ${CONTENT_BLOCKED_BY_ETP_URL}?6`,
    `simple message 1`,
    `▼︎⚠ ${STORAGE_BLOCKED_GROUP_LABEL}`,
    `| ${STORAGE_BLOCKED_URL}?3`,
    `| ${STORAGE_BLOCKED_URL}?4`,
    `| ${STORAGE_BLOCKED_URL}?5`,
    `simple message 2`,
  ]);

  info("Reload the page and wait for it to be ready");
  await reloadPage();

  // Also wait for the navigation message to be displayed.
  await waitFor(() =>
    findMessageByType(hud, "Navigated to", ".navigationMarker")
  );

  info("Add a storage blocked message and a content blocked one");
  onStorageBlockedMessage = waitForMessageByType(
    hud,
    STORAGE_BLOCKED_URL,
    ".warn"
  );
  emitStorageAccessBlockedMessage(hud);
  await onStorageBlockedMessage;

  onContentBlockedByETPWarningMessage = waitForMessageByType(
    hud,
    CONTENT_BLOCKED_BY_ETP_URL,
    ".warn"
  );
  emitEnhancedTrackingProtectionMessage(hud);
  await onContentBlockedByETPWarningMessage;

  await checkConsoleOutputForWarningGroup(hud, [
    `▼︎⚠ ${ENHANCED_TRACKING_PROTECTION_GROUP_LABEL}`,
    `| ${CONTENT_BLOCKED_BY_ETP_URL}?1`,
    `| ${CONTENT_BLOCKED_BY_ETP_URL}?2`,
    `| ${CONTENT_BLOCKED_BY_ETP_URL}?6`,
    `simple message 1`,
    `▼︎⚠ ${STORAGE_BLOCKED_GROUP_LABEL}`,
    `| ${STORAGE_BLOCKED_URL}?3`,
    `| ${STORAGE_BLOCKED_URL}?4`,
    `| ${STORAGE_BLOCKED_URL}?5`,
    `simple message 2`,
    `Navigated to`,
    `${STORAGE_BLOCKED_URL}?7`,
    `${CONTENT_BLOCKED_BY_ETP_URL}?8`,
  ]);

  info(
    "Add a storage blocked message and a content blocked one to create warningGroups"
  );
  onStorageBlockedWarningGroupMessage = waitForMessageByType(
    hud,
    STORAGE_BLOCKED_GROUP_LABEL,
    ".warn"
  );
  emitStorageAccessBlockedMessage();
  await onStorageBlockedWarningGroupMessage;

  onContentBlockedByETPWarningGroupMessage = waitForMessageByType(
    hud,
    ENHANCED_TRACKING_PROTECTION_GROUP_LABEL,
    ".warn"
  );
  emitEnhancedTrackingProtectionMessage();
  await onContentBlockedByETPWarningGroupMessage;

  await checkConsoleOutputForWarningGroup(hud, [
    `▼︎⚠ ${ENHANCED_TRACKING_PROTECTION_GROUP_LABEL}`,
    `| ${CONTENT_BLOCKED_BY_ETP_URL}?1`,
    `| ${CONTENT_BLOCKED_BY_ETP_URL}?2`,
    `| ${CONTENT_BLOCKED_BY_ETP_URL}?6`,
    `simple message 1`,
    `▼︎⚠ ${STORAGE_BLOCKED_GROUP_LABEL}`,
    `| ${STORAGE_BLOCKED_URL}?3`,
    `| ${STORAGE_BLOCKED_URL}?4`,
    `| ${STORAGE_BLOCKED_URL}?5`,
    `simple message 2`,
    `Navigated to`,
    `▶︎⚠ ${STORAGE_BLOCKED_GROUP_LABEL}`,
    `▶︎⚠ ${ENHANCED_TRACKING_PROTECTION_GROUP_LABEL}`,
  ]);
});

let cpt = 0;
const now = Date.now();

/**
 * Emit an Enhanced Tracking Protection message. This is done by loading an image from
 * an origin tagged as tracker. The image is loaded with a incremented counter query
 * parameter each time so we can get the warning message.
 */
function emitEnhancedTrackingProtectionMessage() {
  const url = `${CONTENT_BLOCKED_BY_ETP_URL}?${++cpt}-${now}`;
  SpecialPowers.spawn(gBrowser.selectedBrowser, [url], function (innerURL) {
    content.wrappedJSObject.loadImage(innerURL);
  });
}

/**
 * Emit a Storage blocked message. This is done by loading an image from a different
 * origin, with the cookier permission rejecting foreign origin cookie access.
 */
function emitStorageAccessBlockedMessage() {
  const url = `${STORAGE_BLOCKED_URL}?${++cpt}-${now}`;
  SpecialPowers.spawn(gBrowser.selectedBrowser, [url], function (innerURL) {
    content.wrappedJSObject.loadImage(innerURL);
  });
}

/**
 * Log a string from the content page.
 *
 * @param {WebConsole} hud
 * @param {String} str
 */
function logString(hud, str) {
  const onMessage = waitForMessageByType(hud, str, ".console-api");
  SpecialPowers.spawn(gBrowser.selectedBrowser, [str], function (arg) {
    content.console.log(arg);
  });
  return onMessage;
}

function waitForBadgeNumber(messageNode, expectedNumber) {
  return waitFor(
    () =>
      messageNode.querySelector(".warning-group-badge").textContent ==
      expectedNumber
  );
}
