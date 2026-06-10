/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";

const { AddonManager } = ChromeUtils.importESModule(
  "resource://gre/modules/AddonManager.sys.mjs"
);
const { AddonTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/AddonTestUtils.sys.mjs"
);
const { TestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/TestUtils.sys.mjs"
);

AddonTestUtils.init(this);
AddonTestUtils.overrideCertDB();
AddonTestUtils.appInfo = getAppInfo();
AddonTestUtils.usePrivilegedSignatures = false;
ExtensionTestUtils.init(this);

const server = AddonTestUtils.createHttpServer({ hosts: ["example.com"] });
const BASE_URL = `http://example.com/data`;

let addonID = "policytest2@mozilla.com";
let themeID = "policytheme@mozilla.com";
let policyOnlyID = "policy_installed_only@mozilla.com";

let fileURL;

function waitForAddonInstall(addonId) {
  return new Promise(resolve => {
    let listener = {
      onInstallEnded(install, addon) {
        if (addon.id == addonId) {
          AddonManager.removeInstallListener(listener);
          resolve();
        }
      },
      onDownloadFailed() {
        AddonManager.removeInstallListener(listener);
        resolve();
      },
      onInstallFailed() {
        AddonManager.removeInstallListener(listener);
        resolve();
      },
    };
    AddonManager.addInstallListener(listener);
  });
}

add_setup(async function setup() {
  await AddonTestUtils.promiseStartupManager();

  let webExtensionFile = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      browser_specific_settings: {
        gecko: {
          id: addonID,
        },
      },
    },
  });
  server.registerFile("/data/policy_test.xpi", webExtensionFile);
  fileURL = Services.io
    .newFileURI(webExtensionFile)
    .QueryInterface(Ci.nsIFileURL);

  let policyOnlyExtensionFile = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      name: "Enterprise Policy Only Test Extension",
      browser_specific_settings: {
        gecko: {
          id: policyOnlyID,
          admin_install_only: true,
        },
      },
    },
  });
  server.registerFile(
    "/data/policy_installed_only.xpi",
    policyOnlyExtensionFile
  );

  server.registerFile(
    "/data/amosigned-sha1only.xpi",
    do_get_file("amosigned-sha1only.xpi")
  );
});

add_task(async function test_extensionsettings() {
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "extension1@mozilla.com": {
          blocked_install_message: "Extension1 error message.",
        },
        "*": {
          blocked_install_message: "Generic error message.",
        },
      },
    },
  });

  let extensionSettings = Services.policies.getExtensionSettings(
    "extension1@mozilla.com"
  );
  equal(
    extensionSettings.blocked_install_message,
    "Extension1 error message.",
    "Should have extension specific message."
  );
  extensionSettings = Services.policies.getExtensionSettings(
    "extension2@mozilla.com"
  );
  equal(
    extensionSettings.blocked_install_message,
    "Generic error message.",
    "Should have generic message."
  );
});

add_task(async function test_force_installed_updates_disabled() {
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "force@mozilla.com": {
          installation_mode: "force_installed",
          install_url: "https://example.com/test.xpi",
        },
        "force_explicit@mozilla.com": {
          installation_mode: "force_installed",
          install_url: "https://example.com/test.xpi",
          updates_disabled: true,
        },
        "normal@mozilla.com": {
          installation_mode: "normal_installed",
          install_url: "https://example.com/test.xpi",
        },
      },
    },
  });

  equal(
    Services.policies.getExtensionSettings("force@mozilla.com")
      .updates_disabled,
    false,
    "force_installed with no updates_disabled should default to false"
  );
  equal(
    Services.policies.getExtensionSettings("force_explicit@mozilla.com")
      .updates_disabled,
    true,
    "force_installed with explicit updates_disabled: true should be respected"
  );
  ok(
    !(
      "updates_disabled" in
      Services.policies.getExtensionSettings("normal@mozilla.com")
    ),
    "non-force_installed should not synthesize updates_disabled"
  );
});

add_task(async function test_addon_blocked() {
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "policytest2@mozilla.com": {
          installation_mode: "blocked",
        },
      },
    },
  });

  let install = await AddonManager.getInstallForURL(
    BASE_URL + "/policy_test.xpi"
  );
  await install.install();
  notEqual(install.addon, null, "Addon should not be null");
  equal(install.addon.appDisabled, true, "Addon should be disabled");
  await install.addon.uninstall();
});

add_task(async function test_addon_allowed() {
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "policytest2@mozilla.com": {
          installation_mode: "allowed",
        },
        "*": {
          installation_mode: "blocked",
        },
      },
    },
  });

  let install = await AddonManager.getInstallForURL(
    BASE_URL + "/policy_test.xpi"
  );
  await install.install();
  notEqual(install.addon, null, "Addon should not be null");
  await assertManagementAPIInstallType(install.addon.id, "normal");
  equal(install.addon.appDisabled, false, "Addon should not be disabled");
  equal(
    Services.policies.isAddonRequiredByPolicy(install.addon.id),
    false,
    "Addon should NOT be marked as installed by enterprise policy"
  );

  await install.addon.uninstall();
});

add_task(async function test_addon_uninstalled() {
  let install = await AddonManager.getInstallForURL(
    BASE_URL + "/policy_test.xpi"
  );
  await install.install();
  notEqual(install.addon, null, "Addon should not be null");

  await Promise.all([
    AddonTestUtils.promiseAddonEvent("onUninstalled"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "*": {
            installation_mode: "blocked",
          },
        },
      },
    }),
  ]);
  let addon = await AddonManager.getAddonByID(addonID);
  equal(addon, null, "Addon should be null");
});

add_task(async function test_addon_forceinstalled() {
  await Promise.all([
    AddonTestUtils.promiseInstallEvent("onInstallEnded"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "policytest2@mozilla.com": {
            installation_mode: "force_installed",
            install_url: BASE_URL + "/policy_test.xpi",
          },
        },
      },
    }),
  ]);
  let addon = await AddonManager.getAddonByID(addonID);
  notEqual(addon, null, "Addon should not be null");
  equal(addon.appDisabled, false, "Addon should not be disabled");
  equal(
    addon.permissions & AddonManager.PERM_CAN_UNINSTALL,
    0,
    "Addon should not be able to be uninstalled."
  );
  equal(
    addon.permissions & AddonManager.PERM_CAN_DISABLE,
    0,
    "Addon should not be able to be disabled."
  );
  await assertManagementAPIInstallType(addon.id, "admin");

  await addon.uninstall();
});

add_task(async function test_addon_uninstalled_by_allowed_types() {
  let install = await AddonManager.getInstallForURL(
    BASE_URL + "/policy_test.xpi"
  );
  await install.install();
  notEqual(install.addon, null, "Addon should not be null");

  await Promise.all([
    AddonTestUtils.promiseAddonEvent("onUninstalled"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "*": {
            allowed_types: ["theme"],
          },
        },
      },
    }),
  ]);
  let addon = await AddonManager.getAddonByID(addonID);
  equal(
    addon,
    null,
    "Addon should be uninstalled due to allowed_types restriction"
  );
});

add_task(async function test_addon_allowed_exempted_from_allowed_types() {
  let install = await AddonManager.getInstallForURL(
    BASE_URL + "/policy_test.xpi"
  );
  await install.install();
  notEqual(install.addon, null, "Addon should not be null");

  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        [addonID]: {
          installation_mode: "allowed",
        },
        "*": {
          allowed_types: ["theme"],
        },
      },
    },
  });
  let addon = await AddonManager.getAddonByID(addonID);
  notEqual(
    addon,
    null,
    "Explicitly allowed addon should survive allowed_types restriction"
  );
  await addon.uninstall();
});

add_task(async function test_allowed_types_blocks_new_install() {
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": {
          allowed_types: ["theme"],
        },
      },
    },
  });
  let install = await AddonManager.getInstallForURL(
    BASE_URL + "/policy_test.xpi"
  );
  await install.install();
  notEqual(install.addon, null, "Addon should not be null");
  equal(
    install.addon.appDisabled,
    true,
    "Addon should be disabled due to allowed_types restriction"
  );
  await install.addon.uninstall();
});

add_task(async function test_allowed_type_survives_allowed_types() {
  let themeFile = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      browser_specific_settings: {
        gecko: {
          id: themeID,
        },
      },
      theme: {},
    },
  });
  server.registerFile("/data/policy_theme_survives.xpi", themeFile);

  let install = await AddonManager.getInstallForURL(
    BASE_URL + "/policy_theme_survives.xpi"
  );
  await install.install();
  notEqual(install.addon, null, "Theme should be installed");

  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": {
          allowed_types: ["theme"],
        },
      },
    },
  });
  let addon = await AddonManager.getAddonByID(themeID);
  notEqual(
    addon,
    null,
    "Theme should survive allowed_types: ['theme'] restriction"
  );
  await addon.uninstall();
});

add_task(async function test_addon_normalinstalled() {
  await Promise.all([
    AddonTestUtils.promiseInstallEvent("onInstallEnded"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "policytest2@mozilla.com": {
            installation_mode: "normal_installed",
            install_url: BASE_URL + "/policy_test.xpi",
          },
        },
      },
    }),
  ]);
  let addon = await AddonManager.getAddonByID(addonID);
  notEqual(addon, null, "Addon should not be null");
  equal(addon.appDisabled, false, "Addon should not be disabled");
  equal(
    addon.permissions & AddonManager.PERM_CAN_UNINSTALL,
    0,
    "Addon should not be able to be uninstalled."
  );
  notEqual(
    addon.permissions & AddonManager.PERM_CAN_DISABLE,
    0,
    "Addon should be able to be disabled."
  );
  await assertManagementAPIInstallType(addon.id, "admin");

  await addon.uninstall();
});

add_task(async function test_extensionsettings_string() {
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: '{"*": {"installation_mode": "blocked"}}',
    },
  });

  let extensionSettings = Services.policies.getExtensionSettings("*");
  equal(extensionSettings.installation_mode, "blocked");
});

add_task(async function test_extensionsettings_string() {
  let restrictedDomains = Services.prefs.getCharPref(
    "extensions.webextensions.restrictedDomains"
  );
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings:
        '{"*": {"restricted_domains": ["example.com","example.org"]}}',
    },
  });

  let newRestrictedDomains = Services.prefs.getCharPref(
    "extensions.webextensions.restrictedDomains"
  );
  equal(newRestrictedDomains, restrictedDomains + ",example.com,example.org");
});

add_task(async function test_theme() {
  let themeFile = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      browser_specific_settings: {
        gecko: {
          id: themeID,
        },
      },
      theme: {},
    },
  });

  server.registerFile("/data/policy_theme.xpi", themeFile);

  await Promise.all([
    AddonTestUtils.promiseInstallEvent("onInstallEnded"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "policytheme@mozilla.com": {
            installation_mode: "normal_installed",
            install_url: BASE_URL + "/policy_theme.xpi",
          },
        },
      },
    }),
  ]);
  let currentTheme = Services.prefs.getCharPref("extensions.activeThemeID");
  equal(currentTheme, themeID, "Theme should be active");
  let addon = await AddonManager.getAddonByID(themeID);
  await addon.uninstall();
});

add_task(async function test_addon_normalinstalled_file() {
  await Promise.all([
    AddonTestUtils.promiseInstallEvent("onInstallEnded"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "policytest2@mozilla.com": {
            installation_mode: "normal_installed",
            install_url: fileURL.spec,
          },
        },
      },
    }),
  ]);
  let addon = await AddonManager.getAddonByID(addonID);
  notEqual(addon, null, "Addon should not be null");
  equal(addon.appDisabled, false, "Addon should not be disabled");
  equal(
    addon.permissions & AddonManager.PERM_CAN_UNINSTALL,
    0,
    "Addon should not be able to be uninstalled."
  );
  notEqual(
    addon.permissions & AddonManager.PERM_CAN_DISABLE,
    0,
    "Addon should be able to be disabled."
  );
  await assertManagementAPIInstallType(addon.id, "admin");

  await addon.uninstall();
});

add_task(async function test_allow_weak_signatures() {
  // Make sure weak signatures are restricted.
  const resetWeakSignaturePref =
    AddonTestUtils.setWeakSignatureInstallAllowed(false);

  const id = "amosigned-xpi@tests.mozilla.org";
  const perAddonSettings = {
    installation_mode: "normal_installed",
    install_url: BASE_URL + "/amosigned-sha1only.xpi",
  };

  info(
    "Sanity check: expect install to fail if not allowed through enterprise policy settings"
  );
  await Promise.all([
    AddonTestUtils.promiseInstallEvent("onDownloadFailed"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          [id]: { ...perAddonSettings },
        },
      },
    }),
  ]);
  let addon = await AddonManager.getAddonByID(id);
  equal(addon, null, "Add-on not installed");

  info(
    "Expect install to be allowed through per-addon enterprise policy settings"
  );
  await Promise.all([
    AddonTestUtils.promiseInstallEvent("onInstallEnded"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          [id]: {
            ...perAddonSettings,
            temporarily_allow_weak_signatures: true,
          },
        },
      },
    }),
  ]);
  addon = await AddonManager.getAddonByID(id);
  notEqual(addon, null, "Add-on not installed");
  await addon.uninstall();

  info(
    "Expect install to be allowed through global enterprise policy settings"
  );
  await Promise.all([
    AddonTestUtils.promiseInstallEvent("onInstallEnded"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "*": { temporarily_allow_weak_signatures: true },
          [id]: { ...perAddonSettings },
        },
      },
    }),
  ]);
  addon = await AddonManager.getAddonByID(id);
  notEqual(addon, null, "Add-on installed");
  await addon.uninstall();

  info(
    "Expect install to fail if allowed globally but disallowed by per-addon settings"
  );
  await Promise.all([
    AddonTestUtils.promiseInstallEvent("onDownloadFailed"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "*": { temporarily_allow_weak_signatures: true },
          [id]: {
            ...perAddonSettings,
            temporarily_allow_weak_signatures: false,
          },
        },
      },
    }),
  ]);
  addon = await AddonManager.getAddonByID(id);
  equal(addon, null, "Add-on not installed");

  info(
    "Expect install to be allowed through per addon setting when globally disallowed"
  );
  await Promise.all([
    AddonTestUtils.promiseInstallEvent("onInstallEnded"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "*": { temporarily_allow_weak_signatures: false },
          [id]: {
            ...perAddonSettings,
            temporarily_allow_weak_signatures: true,
          },
        },
      },
    }),
  ]);
  addon = await AddonManager.getAddonByID(id);
  notEqual(addon, null, "Add-on installed");
  await addon.uninstall();

  resetWeakSignaturePref();
});

add_task(async function test_policy_installed_only_addon() {
  const cleanupTestAddon = async () => {
    const addon = await AddonManager.getAddonByID(policyOnlyID);
    if (addon) {
      await addon.uninstall();
    }
  };
  registerCleanupFunction(cleanupTestAddon);

  info(
    "Expect the test addon to install successfully when installed by the policy"
  );
  let installPromise = waitForAddonInstall(policyOnlyID);
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        [policyOnlyID]: {
          install_url: `${BASE_URL}/policy_installed_only.xpi`,
          installation_mode: "force_installed",
          updates_disabled: true,
        },
      },
    },
  });
  await installPromise;
  let addon = await AddonManager.getAddonByID(policyOnlyID);
  Assert.notEqual(addon, null, "Addon expected to be installed successfully.");
  Assert.deepEqual(
    addon.installTelemetryInfo,
    { source: "enterprise-policy" },
    "Got the expected addon.installTelemetryInfo"
  );

  info(
    "Remove the ExtensionSettings and verify the addon becomes appDisabled on XPIDatabase.verifySignatures calls"
  );
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        // NOTE: an empty ExtensionSettings config would not be reflected
        // by data returned by Services.policy.getExtensionSettings calls,
        // on the contrary setting new policy data with an unrelated addon-id
        // forces the ExtensionSettings data to be refreshed.
        "someother-addon@test": { updates_disabled: true },
      },
    },
  });

  {
    const { XPIExports } = ChromeUtils.importESModule(
      "resource://gre/modules/addons/XPIExports.sys.mjs"
    );
    await XPIExports.XPIDatabase.verifySignatures();
  }

  addon = await AddonManager.getAddonByID(policyOnlyID);
  Assert.notEqual(addon, null, "Addon expected to still be installed");
  Assert.equal(addon.appDisabled, true, "Expect the addon to be appDisabled");

  await cleanupTestAddon();
  addon = await AddonManager.getAddonByID(policyOnlyID);
  Assert.equal(addon, null, "Addon expected to not be installed anymore");

  info(
    "Expect the test addon to NOT install successfully when not installed by the policy"
  );
  // Setting back the extension settings with installation_mode set to force_installed
  // will install the extension again, and so we need to wait for that and uninstall
  // it first (otherwise the addon may endup being installed when the test task is
  // completed and trigger an intermittent failure).
  installPromise = waitForAddonInstall(policyOnlyID);
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        [policyOnlyID]: {
          install_url: `${BASE_URL}/policy_installed_only.xpi`,
          installation_mode: "force_installed",
          updates_disabled: true,
        },
      },
    },
  });
  await installPromise;
  await cleanupTestAddon();

  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        // NOTE: an empty ExtensionSettings config would not be reflected
        // by data returned by Services.policy.getExtensionSettings calls,
        // on the contrary setting new policy data with an unrelated addon-id
        // forces the ExtensionSettings data to be refreshed.
        "someother-addon@test": { updates_disabled: true },
      },
    },
  });

  const { messages } = await AddonTestUtils.promiseConsoleOutput(async () => {
    installPromise = waitForAddonInstall(policyOnlyID);
    const install = await AddonManager.getInstallForURL(
      `${BASE_URL}/policy_installed_only.xpi`,
      { telemetryInfo: { source: "not-enterprise-policy" } }
    );
    await Assert.rejects(
      install.install(),
      /Install failed/,
      "Expect the install method to reject"
    );
    await installPromise;

    addon = await AddonManager.getAddonByID(policyOnlyID);
    Assert.equal(addon, null, "Addon expected to not be installed");
  });

  AddonTestUtils.checkMessages(
    messages,
    {
      expected: [
        {
          message:
            /This addon can only be installed through Enterprise Policies/,
        },
      ],
    },
    "Got the expect error logged on installing enterprise only extension"
  );
});

add_task(async function test_private_browsing() {
  async function assertPrivateBrowsingAccess({
    addonId,
    extensionSettings,
    extensionManifest = {},
    expectedPrivateBrowsingAccess,
    message,
  }) {
    await setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          [addonId]: { ...extensionSettings },
        },
      },
    });

    let ext = ExtensionTestUtils.loadExtension({
      manifest: {
        browser_specific_settings: {
          gecko: { id: addonId },
        },
        ...extensionManifest,
      },
      useAddonManager: "temporary",
      background() {
        browser.test.onMessage.addListener(async msg => {
          switch (msg) {
            case "checkPrivateBrowsing": {
              let isAllowed =
                await browser.extension.isAllowedIncognitoAccess();
              browser.test.sendMessage("privateBrowsing", isAllowed);
              break;
            }
          }
        });
      },
    });

    await ext.startup();

    ext.sendMessage("checkPrivateBrowsing");
    let isAllowedIncognitoAccess = await ext.awaitMessage("privateBrowsing");
    Assert.equal(
      isAllowedIncognitoAccess,
      expectedPrivateBrowsingAccess,
      message
    );

    let addon = await AddonManager.getAddonByID(ext.id);
    // Sanity check (to ensure the test extension used in this test are not privileged).
    ok(!addon.isPrivileged, "Addon should not be privileged");

    let expectLocked = typeof extensionSettings?.private_browsing === "boolean";
    Assert.equal(
      !(
        addon.permissions & AddonManager.PERM_CAN_CHANGE_PRIVATEBROWSING_ACCESS
      ),
      expectLocked,
      `Addon should ${expectLocked ? "NOT" : ""} be able to change private browsing setting.`
    );

    await ext.unload();
  }

  await assertPrivateBrowsingAccess({
    addonId: "privatebrowsing-granted-nonprivileged@test",
    extensionSettings: { private_browsing: true },
    expectedPrivateBrowsingAccess: true,
    message:
      "Should have access to private browsing (set to true in policy extension setting)",
  });

  await assertPrivateBrowsingAccess({
    addonId: "privatebrowsing-revoked-nonprivileged@test",
    extensionSettings: { private_browsing: false },
    expectedPrivateBrowsingAccess: false,
    message:
      "Should NOT have access to private browsing (set to false in policy extension setting)",
  });

  await assertPrivateBrowsingAccess({
    addonId: "privatebrowsing-nosetting-nonprivileged@test",
    extensionSettings: {},
    expectedPrivateBrowsingAccess: false,
    message:
      "Should NOT have access to private browsing (NOT set in policy extension setting)",
  });

  await assertPrivateBrowsingAccess({
    addonId: "privatebrowsing-notallowed-nonprivileged@test",
    extensionSettings: { private_browsing: true },
    extensionManifest: {
      incognito: "not_allowed",
    },
    expectedPrivateBrowsingAccess: false,
    message:
      "incognito 'not_allowed' extensions should NOT have access to private browser",
  });
});

add_task(
  {
    // Allow insecure (http) update URLs in this test.
    pref_set: [
      ["extensions.checkUpdateSecurity", false],
      // Fake default url where we expect the background update check requests
      // to be directed to when there isn't an update_url override provided
      // through the enterprise policies settings.
      ["extensions.update.background.url", `${BASE_URL}/default_update.json`],
    ],
  },
  async function test_update_url_policy() {
    const XPI_FROM_DEFAULT_UPDATE_URL = `${BASE_URL}/policy_updating_from_default.xpi`;
    const XPI_FROM_POLICIES_UPDATE_URL = `${BASE_URL}/policy_updating_from_policies.xpi`;

    const defaultFakeUpdates = [
      {
        version: "2.0",
        update_link: XPI_FROM_DEFAULT_UPDATE_URL,
      },
    ];
    const policiesFakeUpdates = [
      {
        version: "2.0",
        update_link: XPI_FROM_POLICIES_UPDATE_URL,
      },
    ];

    let defaultUpdateURLHit = false;
    let policiesUpdateURLHit = false;

    server.registerPathHandler(
      "/data/default_update.json",
      (request, response) => {
        defaultUpdateURLHit = true;
        response.setHeader("Content-Type", "application/json");
        response.write(
          JSON.stringify({
            addons: {
              [addonID]: {
                updates: defaultFakeUpdates,
              },
            },
          })
        );
      }
    );

    server.registerPathHandler(
      "/data/policy_update.json",
      (request, response) => {
        policiesUpdateURLHit = true;
        response.setHeader("Content-Type", "application/json");
        response.write(
          JSON.stringify({
            addons: {
              [addonID]: {
                updates: policiesFakeUpdates,
              },
            },
          })
        );
      }
    );

    const verifyAddonUpdateCheck = async (expected, msg) => {
      defaultUpdateURLHit = false;
      policiesUpdateURLHit = false;

      // Trigger the update check.
      const updateFound = await AddonTestUtils.promiseFindAddonUpdates(addon);

      Assert.ok(
        updateFound?.updateAvailable,
        "Got an add-on update as expected"
      );

      const actual = {
        defaultUpdateURLHit,
        policiesUpdateURLHit,
        update_link: updateFound?.updateAvailable?.sourceURI.spec,
      };
      Assert.deepEqual(actual, expected, msg);
      await updateFound?.updateAvailable?.cancel();
    };

    let install = await AddonManager.getInstallForURL(
      BASE_URL + "/policy_test.xpi"
    );
    await install.install();
    let addon = await AddonManager.getAddonByID(addonID);
    Assert.notEqual(addon, null, "Addon should be installed");

    info(
      "Verify add-on update checks default update url before enterprise policies data is set"
    );
    // Sanity check (the default add-ons update url is used by default).
    await verifyAddonUpdateCheck(
      {
        defaultUpdateURLHit: true,
        policiesUpdateURLHit: false,
        update_link: XPI_FROM_DEFAULT_UPDATE_URL,
      },
      "Expect addon update check to have been initially requested on the default update url"
    );

    info(
      "Verify add-on update checks default update url on invalid update url in enterprise policies data"
    );
    let stopConsoleListener = TestUtils.listenForConsoleMessages();
    await setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          [addonID]: {
            update_url: "not-a-valid-url",
          },
        },
      },
    });
    const messages = await stopConsoleListener();
    const updateURLValidationError = messages.find(
      msg =>
        msg.level == "error" &&
        msg.arguments[0].includes(
          `Ignoring parameter "not-a-valid-url" - scheme (http or https) must be specified`
        )
    );
    Assert.ok(
      updateURLValidationError,
      "Got expected JsonSchemaValidator error for the invalid update_url"
    );

    await verifyAddonUpdateCheck(
      {
        defaultUpdateURLHit: true,
        policiesUpdateURLHit: false,
        update_link: XPI_FROM_DEFAULT_UPDATE_URL,
      },
      "Expect addon update check to be requested on the default update url on invalid policies update_url"
    );

    info(
      "Verify add-on update checks policy overridden update url after enterprise policies data is set"
    );
    await setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          [addonID]: {
            update_url: `${BASE_URL}/policy_update.json`,
          },
        },
      },
    });
    await verifyAddonUpdateCheck(
      {
        defaultUpdateURLHit: false,
        policiesUpdateURLHit: true,
        update_link: XPI_FROM_POLICIES_UPDATE_URL,
      },
      "Expect addon update check hits the custom update url set in the policies data"
    );

    info(
      "Verify add-on update checks default update url after enterprise policies update_url is removed"
    );
    await setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          [addonID]: {
            // Override the addonID setting with a new non-empty object
            // without the update_url set (an empty object would
            // not update the settings loaded in the previous step
            // of this same test).
            installation_mode: "allowed",
          },
        },
      },
    });
    await verifyAddonUpdateCheck(
      {
        defaultUpdateURLHit: true,
        policiesUpdateURLHit: false,
        update_link: XPI_FROM_DEFAULT_UPDATE_URL,
      },
      "Expect addon update check hits the default update url after policies data removal"
    );

    await addon.uninstall();
  }
);
add_task(async function test_blocked_permissions_prevent_manual_install() {
  // 1. Apply enterprise policy (do not include install_url)
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": {
          blocked_permissions: ["history"],
        },
      },
    },
  });

  // 2. Create a local XPI file with a blocked permission
  let xpi = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      applications: { gecko: { id: "blocked@tests.mozilla.org" } },
      name: "Blocked Permission Extension",
      version: "1.0",
      permissions: ["history"], // this is blocked by policy
    },
  });

  // 3. Try to install it manually
  let install = await AddonManager.getInstallForFile(xpi);
  await install.install();

  notEqual(install.addon, null, "Addon should not be null");
  equal(install.addon.appDisabled, true, "Addon should be disabled");
  await install.addon.uninstall();
});

add_task(
  {
    pref_set: [
      ["extensions.webextOptionalPermissionPrompts", false],
      // Required for browser.test.withHandlingUserInput in xpcshell.
      [
        "security.turn_off_all_security_so_that_viruses_can_take_over_this_computer",
        true,
      ],
    ],
  },
  async function test_blocked_permissions_request_rejects_entire_call() {
    await setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "*": {
            blocked_permissions: ["cookies"],
          },
        },
      },
    });

    let extension = ExtensionTestUtils.loadExtension({
      manifest: {
        browser_specific_settings: {
          gecko: { id: "blockedreq@tests.mozilla.org" },
        },
        optional_permissions: ["cookies", "notifications"],
      },
      useAddonManager: "temporary",
      async background() {
        let result;
        browser.test.withHandlingUserInput(() => {
          result = browser.permissions.request({
            permissions: ["cookies", "notifications"],
          });
        });
        await browser.test.assertRejects(
          result,
          /Permissions are blocked by enterprise policy/,
          "permissions.request throws when any requested perm is blocked"
        );
        let granted = await browser.permissions.getAll();
        browser.test.assertFalse(
          granted.permissions.includes("notifications"),
          "non-blocked perm was not granted when another was blocked"
        );
        browser.test.assertFalse(
          granted.permissions.includes("cookies"),
          "blocked perm was not granted"
        );
        browser.test.sendMessage("done");
      },
    });

    await extension.startup();
    await extension.awaitMessage("done");
    await extension.unload();
  }
);

add_task(
  {
    pref_set: [
      ["extensions.webextOptionalPermissionPrompts", false],
      [
        "security.turn_off_all_security_so_that_viruses_can_take_over_this_computer",
        true,
      ],
    ],
  },
  async function test_per_id_blocked_permissions_request_rejects() {
    let id = "peridreq@tests.mozilla.org";
    await setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          [id]: { blocked_permissions: ["cookies"] },
        },
      },
    });

    let extension = ExtensionTestUtils.loadExtension({
      manifest: {
        browser_specific_settings: { gecko: { id } },
        optional_permissions: ["cookies"],
      },
      useAddonManager: "temporary",
      async background() {
        let result;
        browser.test.withHandlingUserInput(() => {
          result = browser.permissions.request({ permissions: ["cookies"] });
        });
        await browser.test.assertRejects(
          result,
          /Permissions are blocked by enterprise policy/,
          "Per-id blocked_permissions rejects permissions.request"
        );
        browser.test.sendMessage("done");
      },
    });

    await extension.startup();
    await extension.awaitMessage("done");
    await extension.unload();
  }
);

add_task(
  async function test_per_id_entry_bypasses_global_blocked_permissions() {
    let id = "peridoverride@tests.mozilla.org";
    await setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "*": { blocked_permissions: ["history"] },
          [id]: {},
        },
      },
    });

    let xpi = AddonTestUtils.createTempWebExtensionFile({
      manifest: {
        applications: { gecko: { id } },
        name: "Per-id override",
        version: "1.0",
        permissions: ["history"],
      },
    });

    let install = await AddonManager.getInstallForFile(xpi);
    await install.install();
    equal(
      install.addon.appDisabled,
      false,
      "Per-id entry should override global blocked_permissions"
    );
    await install.addon.uninstall();
  }
);

add_task(async function test_per_id_blocked_permissions_applies() {
  let id = "peridblocked@tests.mozilla.org";
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        [id]: { blocked_permissions: ["history"] },
      },
    },
  });

  let xpi = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      applications: { gecko: { id } },
      name: "Per-id blocked",
      version: "1.0",
      permissions: ["history"],
    },
  });

  let install = await AddonManager.getInstallForFile(xpi);
  await install.install();
  equal(
    install.addon.appDisabled,
    true,
    "Per-id blocked_permissions should disable this addon"
  );
  await install.addon.uninstall();
});

add_task(async function test_per_id_blocked_permissions_overrides_global() {
  let id = "peridoverridesglobal@tests.mozilla.org";
  // Per-id has its own blocked_permissions; per Chrome, per-id shadows "*"
  // entirely, so the global blocked entry for "tabs" should not apply here.
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": { blocked_permissions: ["tabs"] },
        [id]: { blocked_permissions: ["history"] },
      },
    },
  });

  let xpi = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      applications: { gecko: { id } },
      name: "Per-id overrides global",
      version: "1.0",
      permissions: ["tabs"],
    },
  });

  let install = await AddonManager.getInstallForFile(xpi);
  await install.install();
  equal(
    install.addon.appDisabled,
    false,
    "Per-id blocked_permissions fully shadows global; tabs is not blocked here"
  );
  await install.addon.uninstall();
});

add_task(async function test_per_id_entry_shadows_global_allowed_types() {
  // Verifies the Chrome per-id-shadows-* semantic in mayInstallAddon: an
  // empty per-id entry exempts the addon from the global allowed_types
  // restriction.
  let id = "peridshadowstypes@tests.mozilla.org";
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": { allowed_types: ["theme"] },
        [id]: {},
      },
    },
  });

  let xpi = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      applications: { gecko: { id } },
      name: "Per-id shadows allowed_types",
      version: "1.0",
    },
  });

  let install = await AddonManager.getInstallForFile(xpi);
  await install.install();
  equal(
    install.addon.appDisabled,
    false,
    "Per-id entry shadows global allowed_types restriction"
  );
  await install.addon.uninstall();
});

add_task(async function test_per_id_entry_bypasses_block_all_extensions() {
  let blockedId = "willBeRemoved@tests.mozilla.org";
  let bypassId = "bypassGlobal@tests.mozilla.org";

  await setupPolicyEngineWithJson({
    policies: { ExtensionSettings: { "*": { blocked_permissions: [] } } },
  });

  let blockedXpi = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      applications: { gecko: { id: blockedId } },
      name: "Will be removed",
      version: "1.0",
    },
  });
  let bypassXpi = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      applications: { gecko: { id: bypassId } },
      name: "Bypass global",
      version: "1.0",
    },
  });

  await (await AddonManager.getInstallForFile(blockedXpi)).install();
  await (await AddonManager.getInstallForFile(bypassXpi)).install();

  // blockAll with a per-id override entry for bypassId only.
  await Promise.all([
    AddonTestUtils.promiseAddonEvent("onUninstalled"),
    setupPolicyEngineWithJson({
      policies: {
        ExtensionSettings: {
          "*": { installation_mode: "blocked" },
          [bypassId]: {},
        },
      },
    }),
  ]);

  let blocked = await AddonManager.getAddonByID(blockedId);
  equal(blocked, null, "Addon without per-id entry was uninstalled");

  let bypass = await AddonManager.getAddonByID(bypassId);
  notEqual(bypass, null, "Addon with per-id entry survived blockAllExtensions");
  equal(
    bypass.appDisabled,
    false,
    "Per-id override addon stays enabled under blockAllExtensions"
  );

  await bypass.uninstall();
  // Reset so subsequent tests do not inherit installation_mode:blocked.
  await setupPolicyEngineWithJson({
    policies: { ExtensionSettings: { "*": { blocked_permissions: [] } } },
  });
});

add_task(async function test_blocked_permissions_filters_invalid_entries() {
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": {
          blocked_permissions: [
            "internal:privateBrowsingAllowed",
            "<all_urls>",
            "https://example.com/*",
            "history",
          ],
        },
      },
    },
  });

  let settings = Services.policies.getExtensionSettings("*");
  Assert.deepEqual(
    settings.blocked_permissions,
    ["history"],
    "Only valid permission names are preserved; internal:/host patterns/<all_urls> stripped"
  );
});

add_task(async function test_post_install_block_disables_addon() {
  let id = "postinstallblock@tests.mozilla.org";

  // Install with no policy restricting the permission.
  await setupPolicyEngineWithJson({
    policies: { ExtensionSettings: { "*": { blocked_permissions: [] } } },
  });

  let xpi = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      applications: { gecko: { id } },
      name: "Post-install block",
      version: "1.0",
      permissions: ["history"],
    },
  });
  let install = await AddonManager.getInstallForFile(xpi);
  await install.install();
  equal(
    install.addon.appDisabled,
    false,
    "Addon is enabled before policy is applied"
  );

  // Apply policy that blocks the addon's required permission.
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": { blocked_permissions: ["history"] },
      },
    },
  });

  let addon = await AddonManager.getAddonByID(id);
  notEqual(addon, null, "Addon should still be installed (not uninstalled)");
  equal(
    addon.appDisabled,
    true,
    "Addon should be appDisabled after blocking policy"
  );

  // User tries to re-enable. isUsableAddon re-evaluates via mayInstallAddon,
  // which still returns false, so appDisabled stays true.
  await addon.enable();
  equal(
    addon.appDisabled,
    true,
    "appDisabled remains true after user attempts to re-enable"
  );

  await addon.uninstall();
});

add_task(async function test_post_install_block_revokes_granted_optional() {
  const { ExtensionPermissions } = ChromeUtils.importESModule(
    "resource://gre/modules/ExtensionPermissions.sys.mjs"
  );
  let id = "optionalrevoke@tests.mozilla.org";

  await setupPolicyEngineWithJson({
    policies: { ExtensionSettings: { "*": { blocked_permissions: [] } } },
  });

  let xpi = AddonTestUtils.createTempWebExtensionFile({
    manifest: {
      applications: { gecko: { id } },
      name: "Optional revoke",
      version: "1.0",
      optional_permissions: ["cookies", "notifications"],
    },
  });
  let install = await AddonManager.getInstallForFile(xpi);
  await install.install();

  // Grant the optional permissions directly.
  await ExtensionPermissions.add(id, {
    permissions: ["cookies", "notifications"],
    origins: [],
    data_collection: [],
  });

  let granted = await ExtensionPermissions.get(id);
  ok(
    granted.permissions.includes("cookies"),
    "cookies was granted before policy"
  );

  // Apply a policy that blocks "cookies".
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": { blocked_permissions: ["cookies"] },
      },
    },
  });

  granted = await ExtensionPermissions.get(id);
  ok(
    !granted.permissions.includes("cookies"),
    "blocked optional permission was revoked"
  );
  ok(
    granted.permissions.includes("notifications"),
    "non-blocked optional permission was preserved"
  );

  let addon = await AddonManager.getAddonByID(id);
  equal(
    addon.appDisabled,
    false,
    "Addon stays enabled when only an optional perm was blocked"
  );
  await addon.uninstall();
});

add_task(async function test_runtime_blocked_hosts() {
  const { setEnterpriseGuards } = ChromeUtils.importESModule(
    "resource://gre/modules/ExtensionPermissions.sys.mjs"
  );
  const globalId = "guarded-global@test";
  const perExtId = "guarded-per-ext@test";

  let extGlobal = ExtensionTestUtils.loadExtension({
    manifest: {
      browser_specific_settings: { gecko: { id: globalId } },
      host_permissions: ["<all_urls>"],
    },
    useAddonManager: "temporary",
  });
  let extPerExt = ExtensionTestUtils.loadExtension({
    manifest: {
      browser_specific_settings: { gecko: { id: perExtId } },
      host_permissions: ["<all_urls>"],
    },
    useAddonManager: "temporary",
  });
  await extGlobal.startup();
  await extPerExt.startup();

  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": {
          runtime_blocked_hosts: ["*://*.blocked.example"],
          runtime_allowed_hosts: ["*://allowed.blocked.example"],
        },
        [perExtId]: {
          runtime_blocked_hosts: ["*://*.per-ext.example"],
        },
      },
    },
  });

  let globalPolicy = WebExtensionPolicy.getByID(globalId);
  let perExtPolicy = WebExtensionPolicy.getByID(perExtId);

  equal(globalPolicy.guardSets.length, 1, "global guard applied to extGlobal");
  equal(
    perExtPolicy.guardSets.length,
    1,
    "per-extension guard applied to extPerExt"
  );

  ok(
    !globalPolicy.canAccessURI(
      Services.io.newURI("https://sub.blocked.example/")
    ),
    "global runtime_blocked_hosts denies matching URL"
  );
  ok(
    globalPolicy.canAccessURI(
      Services.io.newURI("https://allowed.blocked.example/")
    ),
    "runtime_allowed_hosts carves out exception"
  );
  ok(
    globalPolicy.canAccessURI(Services.io.newURI("https://other.example/")),
    "global runtime_blocked_hosts does not affect unrelated URL"
  );

  ok(
    !perExtPolicy.canAccessURI(
      Services.io.newURI("https://sub.per-ext.example/")
    ),
    "per-extension runtime_blocked_hosts denies matching URL"
  );
  ok(
    perExtPolicy.canAccessURI(
      Services.io.newURI("https://sub.blocked.example/")
    ),
    "per-extension entry overrides global (global block does not apply)"
  );

  await extGlobal.unload();
  await extPerExt.unload();
  setEnterpriseGuards({});
});

add_task(async function test_runtime_blocked_hosts_all_urls() {
  const { setEnterpriseGuards } = ChromeUtils.importESModule(
    "resource://gre/modules/ExtensionPermissions.sys.mjs"
  );
  const id = "guarded-all-urls@test";
  let ext = ExtensionTestUtils.loadExtension({
    manifest: {
      browser_specific_settings: { gecko: { id } },
      host_permissions: ["<all_urls>"],
    },
    useAddonManager: "temporary",
  });
  await ext.startup();

  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": {
          runtime_blocked_hosts: ["<all_urls>"],
          runtime_allowed_hosts: ["*://carveout.example"],
        },
      },
    },
  });

  let policy = WebExtensionPolicy.getByID(id);
  equal(policy.guardSets.length, 1, "guard applied for <all_urls> deny");
  ok(
    !policy.canAccessURI(Services.io.newURI("https://blocked.example/")),
    "<all_urls> denies arbitrary URL"
  );
  ok(
    policy.canAccessURI(Services.io.newURI("https://carveout.example/")),
    "runtime_allowed_hosts carves out exception from <all_urls>"
  );

  await ext.unload();
  setEnterpriseGuards({});
});

add_task(async function test_runtime_blocked_hosts_invalid_pattern() {
  const { setEnterpriseGuards } = ChromeUtils.importESModule(
    "resource://gre/modules/ExtensionPermissions.sys.mjs"
  );
  const id = "guarded-invalid@test";
  let ext = ExtensionTestUtils.loadExtension({
    manifest: {
      browser_specific_settings: { gecko: { id } },
      host_permissions: ["<all_urls>"],
    },
    useAddonManager: "temporary",
  });
  await ext.startup();

  let stopConsoleListener = TestUtils.listenForConsoleMessages();
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": {
          runtime_blocked_hosts: ["*://*.example.com/*"],
        },
      },
    },
  });
  let messages = await stopConsoleListener();

  let policy = WebExtensionPolicy.getByID(id);
  equal(
    policy.guardSets.length,
    0,
    "guards not applied when policy contains pattern with path"
  );

  ok(
    messages.some(
      m =>
        m.level == "error" &&
        m.arguments[0].includes("Host pattern must not include a path")
    ),
    "Got expected error message for invalid host pattern"
  );

  await ext.unload();
  setEnterpriseGuards({});
});

add_task(async function test_runtime_blocked_hosts_malformed_pattern() {
  const { setEnterpriseGuards } = ChromeUtils.importESModule(
    "resource://gre/modules/ExtensionPermissions.sys.mjs"
  );
  const id = "guarded-malformed@test";
  let ext = ExtensionTestUtils.loadExtension({
    manifest: {
      browser_specific_settings: { gecko: { id } },
      host_permissions: ["<all_urls>"],
    },
    useAddonManager: "temporary",
  });
  await ext.startup();

  let stopConsoleListener = TestUtils.listenForConsoleMessages();
  await setupPolicyEngineWithJson({
    policies: {
      ExtensionSettings: {
        "*": {
          // Passes the no-path regex but the scheme is not permitted,
          // so MatchPatternSet rejects it.
          runtime_blocked_hosts: ["bogus://example.com"],
        },
      },
    },
  });
  let messages = await stopConsoleListener();

  let policy = WebExtensionPolicy.getByID(id);
  equal(
    policy.guardSets.length,
    0,
    "guards not applied when policy contains malformed pattern"
  );

  ok(
    messages.some(
      m =>
        m.level == "error" &&
        m.arguments[0].includes(
          "Invalid runtime_blocked_hosts/runtime_allowed_hosts"
        )
    ),
    "Got expected error message for malformed pattern"
  );

  await ext.unload();
  setEnterpriseGuards({});
});
