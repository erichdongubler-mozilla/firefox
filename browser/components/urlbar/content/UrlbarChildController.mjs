/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * @import {UrlbarChild} from "../../../actors/UrlbarChild.sys.mjs"
 * @import {UrlbarInput} from "chrome://browser/content/urlbar/UrlbarInput.mjs"
 * @import {UrlbarParentController} from "moz-src:///browser/components/urlbar/UrlbarParentController.sys.mjs"
 * @import {UrlbarView} from "chrome://browser/content/urlbar/UrlbarView.mjs"
 */

/**
 * The in-process face of the address bar controller. Lives next to the
 * `<moz-urlbar>` custom element and forwards work that has to happen in
 * the parent process to a paired `UrlbarParentController` via the
 * `UrlbarChild`/`UrlbarParent` JSWindowActor pair. The actor owns the
 * per-instance bookkeeping (instance id, lifetime); this wrapper just
 * holds the controller it hands back.
 *
 * Today both chrome `<moz-urlbar>` instances live in the parent process,
 * so the actor pair hands the real `UrlbarParentController` reference
 * back and method calls happen synchronously. The wrapper exists so that
 * a future content-process `<moz-urlbar>` (e.g. on about:newtab) can
 * swap in async/message-passing implementations of the same surface
 * without touching `UrlbarInput`, `UrlbarView`, or other callers.
 */
export class UrlbarChildController {
  /** @type {UrlbarParentController} */
  #parent;

  // Listeners (the view, the event bufferer, the search one-offs) live here,
  // on the input's side, rather than on the parent controller. The parent
  // delegates its notifications to us via setListenerHost(). This keeps
  // dispatch on the side where the listeners are, which is required once
  // `<moz-urlbar>` runs in a content process.
  #listeners = new Set();

  /**
   * @param {object} options
   * @param {UrlbarInput} options.input
   */
  constructor(options) {
    if (!options.input) {
      throw new Error("Missing options: input");
    }
    let actor = /** @type {UrlbarChild} */ (
      /** @type {unknown} */ (
        options.input.window.windowGlobalChild.getActor("Urlbar")
      )
    );
    this.#parent = actor.getOrCreateController(options.input);
    this.#parent.setListenerHost(this);
  }

  get input() {
    return this.#parent.input;
  }
  get browserWindow() {
    return this.#parent.browserWindow;
  }
  get view() {
    return this.#parent.view;
  }
  get engagementEvent() {
    return this.#parent.engagementEvent;
  }
  get NOTIFICATIONS() {
    return this.#parent.NOTIFICATIONS;
  }
  get platform() {
    return this.#parent.platform;
  }
  get _userSelectionBehavior() {
    return this.#parent._userSelectionBehavior;
  }
  set userSelectionBehavior(value) {
    this.#parent.userSelectionBehavior = value;
  }
  get _lastQueryContextWrapper() {
    return this.#parent._lastQueryContextWrapper;
  }

  setView(view) {
    return this.#parent.setView(view);
  }
  getViewTemplate(result) {
    return this.#parent.getViewTemplate(result);
  }
  getViewUpdate(result, idsByName) {
    return this.#parent.getViewUpdate(result, idsByName);
  }
  onBeforeSelection(result, element) {
    return this.#parent.onBeforeSelection(result, element);
  }
  onSelection(result, element) {
    return this.#parent.onSelection(result, element);
  }
  getResultCommands(result, isPrivate) {
    return this.#parent.getResultCommands(result, isPrivate);
  }
  getHeuristicResult(queryContext) {
    return this.#parent.getHeuristicResult(queryContext);
  }
  addListener(listener) {
    if (!listener || typeof listener != "object") {
      throw new TypeError("Expected listener to be an object");
    }
    this.#listeners.add(listener);
  }
  removeListener(listener) {
    this.#listeners.delete(listener);
  }
  notify(notification, ...params) {
    for (let listener of this.#listeners) {
      // Can't use "in" because some tests proxify these.
      if (typeof listener[notification] != "undefined") {
        try {
          listener[notification](...params);
        } catch (ex) {
          console.error(ex);
        }
      }
    }
  }
  startQuery(queryContext) {
    return this.#parent.startQuery(queryContext);
  }
  cancelQuery() {
    return this.#parent.cancelQuery();
  }
  receiveResults(queryContext) {
    return this.#parent.receiveResults(queryContext);
  }
  removeResult(result) {
    return this.#parent.removeResult(result);
  }
  setLastQueryContextCache(queryContext) {
    return this.#parent.setLastQueryContextCache(queryContext);
  }
  clearLastQueryContextCache() {
    return this.#parent.clearLastQueryContextCache();
  }
  handleKeyNavigation(event, executeAction = true) {
    return this.#parent.handleKeyNavigation(event, executeAction);
  }
  keyEventMovesCaret(event) {
    return this.#parent.keyEventMovesCaret(event);
  }
  speculativeConnect(result, context, reason) {
    return this.#parent.speculativeConnect(result, context, reason);
  }
  focusOnUnifiedSearchButton() {
    return this.#parent.focusOnUnifiedSearchButton();
  }
}
