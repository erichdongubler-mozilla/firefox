/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";
import { OnDeviceModelManager } from "chrome://browser/content/preferences/OnDeviceModelManager.mjs";

/**
 * @import { OnDeviceModelFeaturesEnum } from "chrome://browser/content/preferences/OnDeviceModelManager.mjs"
 */

const XPCOMUtils = ChromeUtils.importESModule(
  "resource://gre/modules/XPCOMUtils.sys.mjs"
).XPCOMUtils;
const lazy = XPCOMUtils.declareLazy({
  GenAI: "resource:///modules/GenAI.sys.mjs",
});

Preferences.addAll([
  { id: "browser.ai.control.default", type: "string" },
  { id: "browser.ai.control.translations", type: "string" },
  { id: "browser.ai.control.pdfjsAltText", type: "string" },
  { id: "browser.ai.control.smartTabGroups", type: "string" },
  { id: "browser.ai.control.linkPreviewKeyPoints", type: "string" },
  { id: "browser.ai.control.sidebarChatbot", type: "string" },
  { id: "browser.ml.chat.provider", type: "string" },
  { id: "browser.aiwindow.enabled", type: "bool" },
  { id: "browser.aiwindow.preferences.enabled", type: "bool" },
]);

Preferences.addSetting({ id: "aiControlsDescription" });
Preferences.addSetting({ id: "blockAiGroup" });
Preferences.addSetting({ id: "blockAiDescription" });
Preferences.addSetting({ id: "onDeviceFieldset" });
Preferences.addSetting({ id: "onDeviceGroup" });
Preferences.addSetting({ id: "aiStatesDescription" });
Preferences.addSetting({ id: "sidebarChatbotFieldset" });

const AiControlStates = Object.freeze({
  default: "default",
  enabled: "enabled",
  blocked: "blocked",
  available: "available",
});

const AiControlGlobalStates = Object.freeze({
  available: "available",
  blocked: "blocked",
});

const AI_CONTROL_OPTIONS = [
  {
    value: AiControlStates.available,
    l10nId: "preferences-ai-controls-state-available",
  },
  {
    value: AiControlStates.enabled,
    l10nId: "preferences-ai-controls-state-enabled",
  },
  {
    value: AiControlStates.blocked,
    l10nId: "preferences-ai-controls-state-blocked",
  },
];

Preferences.addSetting({
  id: "aiControlsDefault",
  pref: "browser.ai.control.default",
  get: prefVal =>
    prefVal in AiControlGlobalStates
      ? prefVal == AiControlGlobalStates.blocked
      : AiControlGlobalStates.available,
  set: inputVal =>
    inputVal ? AiControlGlobalStates.blocked : AiControlGlobalStates.available,
  onUserChange(inputVal) {
    for (let feature of Object.values(OnDeviceModelManager.features)) {
      if (inputVal) {
        // Reset to default (blocked) state unless it was already blocked.
        OnDeviceModelManager.disable(feature);
      } else if (!inputVal && !OnDeviceModelManager.isEnabled(feature)) {
        // Reset to default (available) state unless it was manually enabled.
        OnDeviceModelManager.reset(feature);
      }
    }

    Glean.browser.globalAiControlToggled.record({ blocked: inputVal });
  },
});

/**
 * @param {object} options
 * @param {string} options.id Setting id to create
 * @param {string} options.pref Pref id for the state
 * @param {OnDeviceModelFeaturesEnum} options.feature Feature id for removing models
 * @param {boolean} [options.supportsEnabled] If the feature supports the "enabled" state
 */
function makeAiControlSetting({ id, pref, feature, supportsEnabled = true }) {
  Preferences.addSetting({
    id,
    pref,
    deps: ["aiControlsDefault"],
    setup(emitChange) {
      /**
       * @param {nsISupports} _
       * @param {string} __
       * @param {string} changedFeature
       */
      const featureChange = (_, __, changedFeature) => {
        if (changedFeature == feature) {
          emitChange();
        }
      };
      Services.obs.addObserver(featureChange, "OnDeviceModelManagerChange");
      return () =>
        Services.obs.removeObserver(
          featureChange,
          "OnDeviceModelManagerChange"
        );
    },
    get(prefVal, deps) {
      if (
        prefVal == AiControlStates.blocked ||
        (prefVal == AiControlStates.default &&
          deps.aiControlsDefault.pref.value == AiControlGlobalStates.blocked) ||
        OnDeviceModelManager.isBlocked(feature)
      ) {
        return AiControlStates.blocked;
      }
      if (
        supportsEnabled &&
        (prefVal == AiControlStates.enabled ||
          OnDeviceModelManager.isEnabled(feature))
      ) {
        return AiControlStates.enabled;
      }
      return AiControlStates.available;
    },
    set(prefVal) {
      if (prefVal == AiControlStates.available) {
        OnDeviceModelManager.reset(feature);
      } else if (prefVal == AiControlStates.enabled) {
        OnDeviceModelManager.enable(feature);
      } else if (prefVal == AiControlStates.blocked) {
        OnDeviceModelManager.disable(feature);
      }
      return prefVal;
    },
  });
}
makeAiControlSetting({
  id: "aiControlTranslations",
  pref: "browser.ai.control.translations",
  feature: OnDeviceModelManager.features.Translations,
  supportsEnabled: false,
});
makeAiControlSetting({
  id: "aiControlPdfjsAltText",
  pref: "browser.ai.control.pdfjsAltText",
  feature: OnDeviceModelManager.features.PdfAltText,
});
makeAiControlSetting({
  id: "aiControlSmartTabGroups",
  pref: "browser.ai.control.smartTabGroups",
  feature: OnDeviceModelManager.features.TabGroups,
});
makeAiControlSetting({
  id: "aiControlLinkPreviewKeyPoints",
  pref: "browser.ai.control.linkPreviewKeyPoints",
  feature: OnDeviceModelManager.features.KeyPoints,
});

// sidebar chatbot
Preferences.addSetting({ id: "chatbotProviderItem" });
Preferences.addSetting({
  id: "chatbotProvider",
  pref: "browser.ml.chat.provider",
});
Preferences.addSetting(
  /** @type {{ feature: OnDeviceModelFeaturesEnum } & SettingConfig } */ ({
    id: "aiControlSidebarChatbot",
    pref: "browser.ai.control.sidebarChatbot",
    deps: ["aiControlsDefault", "chatbotProvider"],
    feature: OnDeviceModelManager.features.SidebarChatbot,
    setup(emitChange) {
      lazy.GenAI.init();
      /**
       * @param {nsISupports} _
       * @param {string} __
       * @param {string} changedFeature
       */
      const featureChange = (_, __, changedFeature) => {
        if (changedFeature == this.feature) {
          emitChange();
        }
      };
      Services.obs.addObserver(featureChange, "OnDeviceModelManagerChange");
      return () =>
        Services.obs.removeObserver(
          featureChange,
          "OnDeviceModelManagerChange"
        );
    },
    get(prefVal, deps) {
      if (
        prefVal == AiControlStates.blocked ||
        (prefVal == AiControlStates.default &&
          deps.aiControlsDefault.pref.value == AiControlGlobalStates.blocked) ||
        OnDeviceModelManager.isBlocked(this.feature)
      ) {
        return AiControlStates.blocked;
      }
      if (prefVal == AiControlStates.enabled) {
        return deps.chatbotProvider.value || AiControlStates.available;
      }
      return AiControlStates.available;
    },
    set(inputVal, deps) {
      if (inputVal == AiControlStates.blocked) {
        OnDeviceModelManager.disable(this.feature);
        return inputVal;
      }
      if (inputVal == AiControlStates.available) {
        OnDeviceModelManager.reset(this.feature);
        return inputVal;
      }
      if (inputVal) {
        // Enable the chatbot sidebar so it can be used with this provider.
        deps.chatbotProvider.value = inputVal;
        OnDeviceModelManager.enable(this.feature);
      }
      return AiControlStates.enabled;
    },
    getControlConfig(config, _, setting) {
      let providerUrl = setting.value;
      let options = config.options.slice(0, 3);
      lazy.GenAI.chatProviders.forEach((provider, url) => {
        let isSelected = url == providerUrl;
        // @ts-expect-error provider.hidden isn't in the typing
        if (!isSelected && provider.hidden) {
          return;
        }
        options.push({
          value: url,
          controlAttrs: { label: provider.name },
        });
      });
      if (!options.some(opt => opt.value == providerUrl)) {
        options.push({
          value: providerUrl,
          controlAttrs: { label: providerUrl },
        });
      }
      return {
        ...config,
        options,
      };
    },
  })
);

Preferences.addSetting({
  id: "AIWindowEnabled",
  pref: "browser.aiwindow.enabled",
});

Preferences.addSetting({
  id: "AIWindowPreferencesEnabled",
  pref: "browser.aiwindow.preferences.enabled",
});

// Only show the feature settings if the prefs are allowed to show and the
// feature isn't enabled.
Preferences.addSetting({
  id: "aiWindowFieldset",
  deps: ["AIWindowEnabled", "AIWindowPreferencesEnabled"],
  visible: deps => {
    return deps.AIWindowPreferencesEnabled.value && !deps.AIWindowEnabled.value;
  },
});

Preferences.addSetting({ id: "AIWindowItem" });
Preferences.addSetting({ id: "AIWindowHeader" });
Preferences.addSetting({ id: "AIWindowActivateLink" });

// Only show the AI Window features if the prefs are allowed to show and the
// feature is enabled.
// TODO: Enable when Model and Insight options are added
Preferences.addSetting({
  id: "aiFeaturesAIWindowGroup",
  deps: ["AIWindowEnabled", "AIWindowPreferencesEnabled"],
  visible: deps => {
    return deps.AIWindowPreferencesEnabled.value && deps.AIWindowEnabled.value;
  },
});

SettingGroupManager.registerGroups({
  aiControlsDescription: {
    card: "never",
    items: [
      {
        id: "aiControlsDescription",
        control: "moz-card",
        controlAttrs: {
          class: "ai-controls-description",
        },
        options: [
          {
            control: "p",
            options: [
              {
                control: "span",
                l10nId: "preferences-ai-controls-description",
              },
              {
                control: "span",
                controlAttrs: {
                  ".textContent": " ",
                },
              },
              {
                control: "a",
                controlAttrs: {
                  is: "moz-support-link",
                  "support-page": "firefox-ai-controls",
                },
              },
            ],
          },
          {
            control: "img",
            controlAttrs: {
              src: "chrome://browser/skin/preferences/fox-ai.svg",
            },
          },
        ],
      },
    ],
  },
  aiStatesDescription: {
    card: "never",
    items: [
      {
        id: "aiStatesDescription",
        control: "footer",
        controlAttrs: {
          class: "text-deemphasized",
        },
        options: [
          {
            control: "span",
            l10nId: "preferences-ai-controls-state-description-before",
          },
          {
            control: "ul",
            options: [
              {
                control: "li",
                l10nId: "preferences-ai-controls-state-description-available",
              },
              {
                control: "li",
                l10nId: "preferences-ai-controls-state-description-enabled",
              },
              {
                control: "li",
                l10nId: "preferences-ai-controls-state-description-blocked",
              },
            ],
          },
        ],
      },
    ],
  },
  aiFeatures: {
    card: "always",
    items: [
      {
        id: "blockAiGroup",
        control: "moz-box-item",
        items: [
          {
            id: "aiControlsDefault",
            l10nId: "preferences-ai-controls-block-ai",
            control: "moz-toggle",
            controlAttrs: {
              headinglevel: 2,
            },
            options: [
              {
                l10nId: "preferences-ai-controls-block-ai-description",
                control: "span",
                slot: "description",
                options: [
                  {
                    control: "a",
                    controlAttrs: {
                      "data-l10n-name": "link",
                      "support-page": "firefox-ai-controls",
                      is: "moz-support-link",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "onDeviceFieldset",
        l10nId: "preferences-ai-controls-on-device-group",
        supportPage: "on-device-models",
        control: "moz-fieldset",
        controlAttrs: {
          headinglevel: 2,
          iconsrc: "chrome://browser/skin/device-desktop.svg",
        },
        items: [
          {
            id: "onDeviceGroup",
            control: "moz-box-group",
            options: [
              {
                control: "moz-box-item",
                items: [
                  {
                    id: "aiControlTranslations",
                    l10nId: "preferences-ai-controls-translations-control",
                    control: "moz-select",
                    options: [
                      ...AI_CONTROL_OPTIONS.filter(
                        opt => opt.value != AiControlStates.enabled
                      ),
                      {
                        control: "a",
                        l10nId:
                          "preferences-ai-controls-translations-more-link",
                        slot: "support-link",
                        controlAttrs: {
                          href: "#general-translations",
                        },
                      },
                    ],
                  },
                ],
              },
              {
                control: "moz-box-item",
                items: [
                  {
                    id: "aiControlPdfjsAltText",
                    l10nId: "preferences-ai-controls-pdfjs-control",
                    control: "moz-select",
                    supportPage: "pdf-alt-text",
                    options: [...AI_CONTROL_OPTIONS],
                  },
                ],
              },
              {
                control: "moz-box-item",
                items: [
                  {
                    id: "aiControlSmartTabGroups",
                    l10nId:
                      "preferences-ai-controls-tab-group-suggestions-control",
                    control: "moz-select",
                    supportPage: "how-use-ai-enhanced-tab-groups",
                    options: [...AI_CONTROL_OPTIONS],
                  },
                ],
              },
              {
                control: "moz-box-item",
                items: [
                  {
                    id: "aiControlLinkPreviewKeyPoints",
                    l10nId: "preferences-ai-controls-key-points-control",
                    control: "moz-select",
                    supportPage: "use-link-previews-firefox",
                    options: [...AI_CONTROL_OPTIONS],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "aiWindowFieldset",
        control: "moz-fieldset",
        items: [
          {
            id: "AIWindowItem",
            control: "moz-box-group",
            items: [
              {
                id: "AIWindowHeader",
                l10nId: "try-ai-features-ai-window",
                control: "moz-box-item",
              },
              {
                id: "AIWindowActivateLink",
                l10nId: "try-ai-features-ai-window-activate-link",
                control: "moz-box-link",
              },
            ],
          },
        ],
      },
      {
        id: "sidebarChatbotFieldset",
        control: "moz-fieldset",
        l10nId: "preferences-ai-controls-sidebar-chatbot-group",
        supportPage: "ai-chatbot",
        controlAttrs: {
          headinglevel: 2,
          iconsrc: "chrome://browser/skin/sidebars.svg",
        },
        items: [
          {
            id: "chatbotProviderItem",
            control: "moz-box-item",
            items: [
              {
                id: "aiControlSidebarChatbot",
                l10nId: "preferences-ai-controls-sidebar-chatbot-control",
                control: "moz-select",
                options: [
                  {
                    l10nId: "preferences-ai-controls-state-available",
                    value: AiControlStates.available,
                  },
                  {
                    l10nId: "preferences-ai-controls-state-blocked",
                    value: AiControlStates.blocked,
                  },
                  { control: "hr" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  aiWindowFeatures: {
    l10nId: "ai-window-features-group",
    headingLevel: 2,
    items: [
      {
        id: "aiFeaturesAIWindowGroup",
        control: "moz-box-group",
        // TODO: Add Model and Insight list
        // options: [
        // ],
      },
    ],
  },
});
