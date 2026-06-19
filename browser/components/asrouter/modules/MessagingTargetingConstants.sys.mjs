/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Commonly reused targeting expressions for Firefox Messaging System messages.
 *
 * These constants standardize targeting strings that are frequently used across
 * in-tree messages and experiments, making them easier to maintain, review, and
 * communicate changes. When a targeting heuristic changes, update the constant
 * here and add a versioned suffix (e.g. _V2) to preserve backward
 * compatibility for any experiments or rollouts still referencing the old
 * version.
 *
 * Modeled after Experimenter's targeting constants:
 * https://github.com/mozilla/experimenter/blob/main/experimenter/experimenter/targeting/constants.py
 */

export const NEED_DEFAULT =
  "'browser.shell.checkDefaultBrowser'|preferenceValue && !isDefaultBrowser";
export const NEED_DEFAULT_AND_PIN = `doesAppNeedPin && ${NEED_DEFAULT}`;

export const EXISTING_USER =
  "(currentDate|date - profileAgeCreated|date) / 86400000 >= 28 && previousSessionEnd";
export const NEW_USER =
  "(currentDate|date - profileAgeCreated|date) / 86400000 < 28";
export const PROFILE_MORE_THAN_3_DAYS =
  "(currentDate|date - profileAgeCreated|date) / 86400000 > 3";

export const NO_COMPETING_UI =
  "!isMajorUpgrade && !activeNotifications && !willShowDefaultPrompt";
export const ON_STARTUP = `source == 'startup' && ${NO_COMPETING_UI}`;
export const ON_NEWTAB = `source == 'newtab' && ${NO_COMPETING_UI}`;

export const NEEDS_IMPORT =
  "!(hasMigratedBookmarks|preferenceValue || hasMigratedCSVPasswords|preferenceValue || hasMigratedHistory|preferenceValue || hasMigratedPasswords|preferenceValue)";

export const CFR_FEATURES_ENABLED =
  "'browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features'|preferenceValue != false";
export const CFR_ADDONS_ENABLED =
  "'browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons'|preferenceValue != false";

export const NOT_ENTERPRISE = "!hasActiveEnterprisePolicies";

export const FXA_NOT_SIGNED_IN = "isFxAEnabled && !isFxASignedIn";

export const TAB_GROUPS_ENABLED =
  "('browser.tabs.groups.enabled'|preferenceValue) && userPrefs.cfrFeatures";

export const EXISTING_USER_ON_STARTUP = `${EXISTING_USER} && ${ON_STARTUP} && ${NOT_ENTERPRISE}`;
export const EXISTING_USER_ON_NEWTAB = `${EXISTING_USER} && ${ON_NEWTAB} && ${NOT_ENTERPRISE}`;
