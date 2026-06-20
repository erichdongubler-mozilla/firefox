/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * @import {UrlbarParent} from "./UrlbarParent.sys.mjs"
 * @import {UrlbarParentController} from "moz-src:///browser/components/urlbar/UrlbarParentController.sys.mjs"
 */

/**
 * Child-process counterpart of `UrlbarParent`. Each `UrlbarChildController`
 * created by a `<moz-urlbar>` instance asks this actor for the
 * `UrlbarParentController` that runs the query lifecycle and parent-only
 * telemetry on its behalf.
 *
 * For chrome `<moz-urlbar>` instances both actors live in the parent
 * process, so we hand the real `UrlbarParentController` reference back to
 * the child controller and methods are invoked synchronously in-process.
 * A future content-process consumer (e.g. about:newtab) will replace this
 * direct hand-off with message passing via `sendQuery` / `sendAsyncMessage`.
 */
export class UrlbarChild extends JSWindowActorChild {
  /**
   * Returns the `UrlbarParentController` that backs a given `<moz-urlbar>`
   * input, creating it on demand. Reconnecting the same element returns the
   * existing controller.
   *
   * @param {object} input
   *   The `UrlbarInput`/`SmartbarInput` that owns the child controller.
   *   In-process only.
   * @returns {UrlbarParentController}
   */
  getOrCreateController(input) {
    let parentActor = this.#parentActor;
    if (!parentActor) {
      throw new Error(
        "UrlbarChild: cross-process moz-urlbar is not yet supported"
      );
    }
    return parentActor.getOrCreateController(input);
  }

  /**
   * In the parent process: the parent actor
   * In a child process: undefined
   *
   * @type {UrlbarParent | undefined}
   */
  get #parentActor() {
    return this.manager.parentActor?.getActor("Urlbar");
  }
}
