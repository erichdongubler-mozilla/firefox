/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

async function checkPrivacyPreferences({
  historyMode,
  privateBrowsingAutoStart,
  alwaysClear,
  rememberHistory,
  rememberForms,
}) {
  await BrowserTestUtils.withNewTab(
    "about:preferences#privacy",
    async browser => {
      let doc = browser.contentDocument;
      let checks = {
        historyMode,
        privateBrowsingAutoStart,
        alwaysClear,
        rememberHistory,
        rememberForms,
      };
      for (let [id, expected] of Object.entries(checks)) {
        if (expected === undefined) {
          continue;
        }
        is(doc.getElementById(id).disabled, expected, `#${id} disabled state`);
      }
    }
  );
}

add_task(async function test_sanitizeOnShutdown_boolean_true() {
  await setupPolicyEngineWithJson({
    policies: {
      SanitizeOnShutdown: true,
    },
  });
  await checkPrivacyPreferences({
    historyMode: true,
    privateBrowsingAutoStart: true,
    alwaysClear: true,
    rememberHistory: false,
    rememberForms: false,
  });
});

add_task(async function test_sanitizeOnShutdown_object_locked_true() {
  await setupPolicyEngineWithJson({
    policies: {
      SanitizeOnShutdown: {
        History: true,
        Locked: true,
      },
    },
  });
  await checkPrivacyPreferences({
    historyMode: true,
    privateBrowsingAutoStart: true,
    alwaysClear: true,
    rememberHistory: false,
    rememberForms: false,
  });
});

add_task(async function test_sanitizeOnShutdown_object_locked_false() {
  await setupPolicyEngineWithJson({
    policies: {
      SanitizeOnShutdown: {
        History: true,
        Locked: false,
      },
    },
  });
  await checkPrivacyPreferences({
    historyMode: false,
    privateBrowsingAutoStart: false,
    alwaysClear: false,
    rememberHistory: false,
    rememberForms: false,
  });
});
