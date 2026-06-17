"use strict";

const MIRROR_PREF = "privacy.trackingprotection.content.mirror.enabled";
const PROT_ENABLED = "privacy.trackingprotection.content.protection.enabled";
const PROT_ENGINES = "privacy.trackingprotection.content.protection.engines";
const PROT_ENGINES_PBM =
  "privacy.trackingprotection.content.protection.engines.pbmode";
const ANNO_ENABLED = "privacy.trackingprotection.content.annotation.enabled";
const ANNO_ENGINES = "privacy.trackingprotection.content.annotation.engines";
const ANNO_ENGINES_PBM =
  "privacy.trackingprotection.content.annotation.engines.pbmode";

// The content prefs the mirror writes. They are included in every pushPrefEnv
// that enables the mirror so popping the environment restores them - the mirror
// changes them out of band while enabled, and pop restores the pre-test state
// regardless of the placeholder values used here.
const CONTENT_PREF_RESET = [
  [PROT_ENABLED, false],
  [PROT_ENGINES, ""],
  [PROT_ENGINES_PBM, ""],
  [ANNO_ENABLED, false],
  [ANNO_ENGINES, ""],
  [ANNO_ENGINES_PBM, ""],
];

// Set to true as a side effect of changing ETP settings (it gates a one-time
// allow-list onboarding infobar; see UrlClassifierExceptionListService). It is
// not a mirror pref, but it gets written while the ETP prefs are toggled, so it
// is pinned once in add_setup() to keep popping from leaking it.
const HAS_INTERACTED_PREF =
  "privacy.trackingprotection.allow_list.hasUserInteractedWithETPSettings";

// All ETP source prefs the mirror reads, defaulted off so each task's
// expected output is fully determined by its overrides.
const ETP_OFF = {
  "privacy.trackingprotection.enabled": false,
  "privacy.trackingprotection.pbmode.enabled": false,
  "privacy.trackingprotection.annotate_channels": false,
  "privacy.annotate_channels.strict_list.enabled": false,
  "privacy.annotate_channels.strict_list.pbmode.enabled": false,
  "privacy.trackingprotection.fingerprinting.enabled": false,
  "privacy.trackingprotection.cryptomining.enabled": false,
  "privacy.trackingprotection.socialtracking.enabled": false,
  "privacy.trackingprotection.emailtracking.enabled": false,
  "privacy.trackingprotection.emailtracking.pbmode.enabled": false,
};

// The mirror coalesces pref changes onto a runnable, so wait a turn of the
// main-thread event loop for the pending Sync() to run before asserting.
function flushMirror() {
  return new Promise(resolve => Services.tm.dispatchToMainThread(resolve));
}

// Push an all-off ETP baseline with the given overrides and enable the mirror,
// then wait for the coalesced Sync(). Because the mirror recomputes from the
// final pref state once per turn, the order prefs are applied within the env
// does not matter.
async function enableMirror(overrides = {}) {
  const etp = { ...ETP_OFF, ...overrides };
  await SpecialPowers.pushPrefEnv({
    set: [...Object.entries(etp), [MIRROR_PREF, true], ...CONTENT_PREF_RESET],
  });
  await flushMirror();
}

// The mirror only initializes from ContentClassifierService::Init, which runs
// lazily on the first real channel classification. Force that here so the
// singleton (and its pref callbacks) are live for every task.
add_setup(async function () {
  // Pin the interaction flag for the whole file; the ETP prefs the tasks toggle
  // would otherwise flip it and leave it changed past the suite.
  await SpecialPowers.pushPrefEnv({ set: [[HAS_INTERACTED_PREF, false]] });

  let tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    TEST_TOP_PAGE
  );
  BrowserTestUtils.removeTab(tab);
});

// With the master pref off (the default), changing an ETP pref must NOT touch
// the content prefs.
add_task(async function test_mirror_off_leaves_content_prefs_untouched() {
  // Make sure the mirror is disabled first.
  await SpecialPowers.pushPrefEnv({ set: [[MIRROR_PREF, false]] });

  // Then flip an ETP pref; with the mirror off it must not touch content prefs.
  await SpecialPowers.pushPrefEnv({
    set: [["privacy.trackingprotection.enabled", true]],
  });
  await flushMirror();

  is(
    Services.prefs.getStringPref(PROT_ENGINES),
    "test_block",
    "protection.engines stays at default"
  );
  is(
    Services.prefs.getBoolPref(PROT_ENABLED),
    false,
    "protection stays disabled"
  );
  is(
    Services.prefs.getStringPref(ANNO_ENGINES),
    "test_annotate",
    "annotation.engines stays at default"
  );
});

// Each ETP feature toggle maps to its content classifier engine in the
// protection (blocking) list.
add_task(async function test_protection_per_feature_mapping() {
  const cases = [
    ["privacy.trackingprotection.enabled", "trackers"],
    ["privacy.trackingprotection.fingerprinting.enabled", "fingerprinters"],
    ["privacy.trackingprotection.cryptomining.enabled", "cryptominers"],
    ["privacy.trackingprotection.socialtracking.enabled", "social-trackers"],
    ["privacy.trackingprotection.emailtracking.enabled", "email-trackers"],
  ];
  for (const [etpPref, engine] of cases) {
    await enableMirror({ [etpPref]: true });
    is(
      Services.prefs.getStringPref(PROT_ENGINES),
      engine,
      `${etpPref} -> protection ${engine}`
    );
    is(
      Services.prefs.getBoolPref(PROT_ENABLED),
      true,
      `${etpPref} enables protection`
    );
    is(
      Services.prefs.getStringPref(ANNO_ENGINES),
      "",
      `${etpPref} leaves annotation empty`
    );
  }
});

// Multiple feature toggles join into one comma-separated list, in the mirror's
// mapping order (trackers, fingerprinters, cryptominers, social, email).
add_task(async function test_protection_multiple_features_joined() {
  await enableMirror({
    "privacy.trackingprotection.enabled": true,
    "privacy.trackingprotection.cryptomining.enabled": true,
    "privacy.trackingprotection.emailtracking.enabled": true,
  });
  is(
    Services.prefs.getStringPref(PROT_ENGINES),
    "trackers,cryptominers,email-trackers",
    "enabled features joined in mapping order"
  );
});

// The private-browsing ETP prefs drive only the .engines.pbmode lists, and the
// normal prefs drive only the non-PBM lists.
add_task(async function test_pbm_prefs_drive_pbmode_list_only() {
  await enableMirror({
    "privacy.trackingprotection.pbmode.enabled": true,
    "privacy.trackingprotection.emailtracking.pbmode.enabled": true,
  });
  is(
    Services.prefs.getStringPref(PROT_ENGINES),
    "",
    "normal protection empty (only PBM prefs on)"
  );
  is(
    Services.prefs.getStringPref(PROT_ENGINES_PBM),
    "trackers,email-trackers",
    "PBM prefs map to pbmode protection list"
  );
  is(
    Services.prefs.getBoolPref(PROT_ENABLED),
    true,
    "protection enabled from PBM list alone"
  );
});

// fingerprinting/cryptomining/socialtracking have no PBM-specific pref, so the
// single toggle applies to both the normal and PBM protection lists.
add_task(async function test_modeless_features_apply_to_both_modes() {
  await enableMirror({
    "privacy.trackingprotection.fingerprinting.enabled": true,
  });
  is(
    Services.prefs.getStringPref(PROT_ENGINES),
    "fingerprinters",
    "normal list has fingerprinters"
  );
  is(
    Services.prefs.getStringPref(PROT_ENGINES_PBM),
    "fingerprinters",
    "pbmode list has fingerprinters too"
  );
});

// annotate_channels drives the annotation list (trackers, fingerprinters,
// cryptominers, social-trackers); it gates both normal and PBM annotation.
// trackers-content is gated separately by the strict-list pref and is absent
// here.
add_task(async function test_annotate_channels_drives_annotation_list() {
  await enableMirror({
    "privacy.trackingprotection.annotate_channels": true,
  });
  is(
    Services.prefs.getStringPref(ANNO_ENGINES),
    "trackers,fingerprinters,cryptominers,social-trackers",
    "annotate_channels maps to annotation engines"
  );
  is(
    Services.prefs.getStringPref(ANNO_ENGINES_PBM),
    "trackers,fingerprinters,cryptominers,social-trackers",
    "annotate_channels gates PBM annotation too"
  );
  is(Services.prefs.getBoolPref(ANNO_ENABLED), true, "annotation enabled");
  is(
    Services.prefs.getStringPref(PROT_ENGINES),
    "",
    "protection list untouched by annotate_channels"
  );
  is(Services.prefs.getBoolPref(PROT_ENABLED), false, "protection disabled");
});

// trackers-content (the level-2 content-tracker annotation) is gated by the
// strict-list prefs, independently of annotate_channels and per mode.
add_task(async function test_strict_list_drives_trackers_content_annotation() {
  await enableMirror({
    "privacy.annotate_channels.strict_list.enabled": true,
  });
  is(
    Services.prefs.getStringPref(ANNO_ENGINES),
    "trackers-content",
    "strict_list.enabled adds trackers-content to normal annotation"
  );
  is(
    Services.prefs.getStringPref(ANNO_ENGINES_PBM),
    "",
    "No PBM annotation when the PBM pref is off"
  );

  await enableMirror({
    "privacy.annotate_channels.strict_list.pbmode.enabled": true,
  });
  is(
    Services.prefs.getStringPref(ANNO_ENGINES),
    "",
    "Switch normal strict-list off will clear the pref for normal annotation"
  );
  is(
    Services.prefs.getStringPref(ANNO_ENGINES_PBM),
    "trackers-content",
    "strict_list.pbmode.enabled adds trackers-content to PBM annotation"
  );
});

// Turning the master pref off leaves the last derived content prefs in place;
// the mirror simply stops updating them.
add_task(async function test_disable_keeps_last_values() {
  await enableMirror({ "privacy.trackingprotection.enabled": true });
  is(
    Services.prefs.getStringPref(PROT_ENGINES),
    "trackers",
    "mirror derived trackers while on"
  );
  is(
    Services.prefs.getBoolPref(PROT_ENABLED),
    true,
    "protection enabled while on"
  );

  // Disable the mirror and verify the content prefs are kept.
  await SpecialPowers.pushPrefEnv({ set: [[MIRROR_PREF, false]] });
  await flushMirror();
  is(
    Services.prefs.getStringPref(PROT_ENGINES),
    "trackers",
    "protection.engines kept after disable"
  );
  is(
    Services.prefs.getBoolPref(PROT_ENABLED),
    true,
    "protection still enabled after mirror off"
  );

  // Further ETP changes while disabled must not update the content prefs.
  await SpecialPowers.pushPrefEnv({
    set: [["privacy.trackingprotection.fingerprinting.enabled", true]],
  });
  await flushMirror();
  is(
    Services.prefs.getStringPref(PROT_ENGINES),
    "trackers",
    "ETP change ignored while mirror off"
  );
});
