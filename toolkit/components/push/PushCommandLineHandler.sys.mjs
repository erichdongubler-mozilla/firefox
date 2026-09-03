/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

XPCOMUtils.defineLazyServiceGetter(
  lazy,
  "PushService",
  "@mozilla.org/push/Service;1",
  Ci.nsIPushService
);

/**
 * Command-line handler for the --receive-push-messages argument.
 */
export class CommandLineHandler {
  static classID = Components.ID("{10fc3d88-c2b2-4e3f-85e2-13dc355d0257}");
  static contractID = "@mozilla.org/push/receive-push-messages-clh;1";

  QueryInterface = ChromeUtils.generateQI([Ci.nsICommandLineHandler]);

  /**
   * Handle the --receive-push-messages argument, which opens Firefox without a
   * window, receives any pending push messages, and then exits.
   *
   * @param {nsICommandLine} cmdLine The command line to handle.
   */
  handle(cmdLine) {
    if (!cmdLine.handleFlag("receive-push-messages", false)) {
      return;
    }

    // Don't display a window
    cmdLine.preventDefault = true;

    // Firefox is already running and receiving push messages
    if (cmdLine.state != Ci.nsICommandLine.STATE_INITIAL_LAUNCH) {
      return;
    }

    // Keep Firefox alive while receiving push messages
    Services.startup.enterLastWindowClosingSurvivalArea();

    this.receivePushMessages()
      .catch(e => {
        console.error("Error receiving push messages:", e);
      })
      .finally(() => {
        Services.startup.exitLastWindowClosingSurvivalArea();
      });
  }

  /**
   * Ensure the Push Service is ready.
   *
   * @returns {Promise<boolean>} Resolves to true if the Push Service is ready.
   */
  async ensurePushServiceReady() {
    try {
      await lazy.PushService.wrappedJSObject.ensureReady();
    } catch (e) {
      if (e.result != Cr.NS_ERROR_NOT_AVAILABLE) {
        throw e;
      }
      return false;
    }

    return true;
  }

  /**
   * Receive push messages.
   *
   * @returns {Promise<void>} Resolves when receiving stops.
   */
  async receivePushMessages() {
    await this.ensurePushServiceReady();
  }
}
