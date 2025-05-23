/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  ActionsProvider,
  ActionsResult,
} from "resource:///modules/ActionsProvider.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  QuickActionsLoaderDefault:
    "resource:///modules/QuickActionsLoaderDefault.sys.mjs",
  UrlbarPrefs: "resource:///modules/UrlbarPrefs.sys.mjs",
});

// These prefs are relative to the `browser.urlbar` branch.
const ENABLED_PREF = "suggest.quickactions";
const MATCH_IN_PHRASE_PREF = "quickactions.matchInPhrase";
const MIN_SEARCH_PREF = "quickactions.minimumSearchString";

/**
 * @typedef QuickActionsDefinition
 * @property {string[]} commands
 *   The possible typed entries that this command will be displayed for.
 * @property {string} icon
 *   The URI of the icon associated with this command.
 * @property {string} label
 *   The id of the label for the result element.
 * @property {() => boolean} [isVisible]
 *   A function to call to check if this action should be visible or not.
 * @property {() => null|{focusContent: boolean}} onPick
 *   The function to call when the quick action is picked. It may return an object
 *   with property focusContent to indicate if the content area should be focussed
 *   after the pick.
 */

/**
 * A provider that matches the urlbar input to built in actions.
 */
class ProviderQuickActions extends ActionsProvider {
  get name() {
    return "ActionsProviderQuickActions";
  }

  isActive(queryContext) {
    return (
      lazy.UrlbarPrefs.get(ENABLED_PREF) &&
      !queryContext.searchMode &&
      queryContext.trimmedSearchString.length < 50 &&
      queryContext.trimmedSearchString.length >=
        lazy.UrlbarPrefs.get(MIN_SEARCH_PREF)
    );
  }

  async queryActions(queryContext) {
    let input = queryContext.trimmedLowerCaseSearchString;
    let results = await this.getActions(input);

    if (lazy.UrlbarPrefs.get(MATCH_IN_PHRASE_PREF)) {
      for (let [keyword, key] of this.#keywords) {
        if (input.includes(keyword)) {
          results.push(key);
        }
      }
    }

    // Remove invisible actions.
    results = results.filter(key => {
      const action = this.#actions.get(key);
      return action.isVisible?.() ?? true;
    });

    if (!results.length) {
      return null;
    }

    return results.map(key => {
      let action = this.#actions.get(key);
      return new ActionsResult({
        key,
        l10nId: action.label,
        icon: action.icon,
        dataset: {
          action: key,
          inputLength: queryContext.trimmedSearchString.length,
        },
        onPick: action.onPick,
      });
    });
  }

  async getActions(prefix) {
    await lazy.QuickActionsLoaderDefault.ensureLoaded();
    return [...(this.#prefixes.get(prefix) ?? [])];
  }

  getAction(key) {
    return this.#actions.get(key);
  }

  pickAction(_queryContext, _controller, element) {
    let action = element.dataset.action;
    let inputLength = Math.min(element.dataset.inputLength, 10);
    Glean.urlbarQuickaction.picked[`${action}-${inputLength}`].add(1);
    let options = this.#actions.get(action).onPick();
    if (options?.focusContent) {
      element.ownerGlobal.gBrowser.selectedBrowser.focus();
    }
  }

  /**
   * Adds a new QuickAction.
   *
   * @param {string} key A key to identify this action.
   * @param {QuickActionsDefinition} definition An object that describes the action.
   */
  addAction(key, definition) {
    this.#actions.set(key, definition);
    definition.commands.forEach(cmd => this.#keywords.set(cmd, key));
    this.#loopOverPrefixes(definition.commands, prefix => {
      let result = this.#prefixes.get(prefix);
      if (result) {
        if (!result.includes(key)) {
          result.push(key);
        }
      } else {
        result = [key];
      }
      this.#prefixes.set(prefix, result);
    });
  }

  /**
   * Removes an action.
   *
   * @param {string} key A key to identify this action.
   */
  removeAction(key) {
    let definition = this.#actions.get(key);
    this.#actions.delete(key);
    definition.commands.forEach(cmd => this.#keywords.delete(cmd));
    this.#loopOverPrefixes(definition.commands, prefix => {
      let result = this.#prefixes.get(prefix);
      if (result) {
        result = result.filter(val => val != key);
      }
      this.#prefixes.set(prefix, result);
    });
  }

  /**
   * A map from keywords to an action.
   *
   * @type {Map<string, string>}
   */
  #keywords = new Map();

  /**
   * A map of all prefixes to an array of actions.
   *
   * @type {Map<string, string[]>}
   */
  #prefixes = new Map();

  /**
   * The actions that have been added.
   *
   * @type {Map<string, QuickActionsDefinition>}
   */
  #actions = new Map();

  #loopOverPrefixes(commands, fun) {
    for (const command of commands) {
      // Loop over all the prefixes of the word, ie
      // "", "w", "wo", "wor", stopping just before the full
      // word itself which will be matched by the whole
      // phrase matching.
      for (let i = 1; i <= command.length; i++) {
        let prefix = command.substring(0, command.length - i);
        fun(prefix);
      }
    }
  }
}

export var ActionsProviderQuickActions = new ProviderQuickActions();
