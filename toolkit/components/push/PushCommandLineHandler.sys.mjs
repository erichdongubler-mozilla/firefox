/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

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
    cmdLine.handleFlag("receive-push-messages", false);
  }
}
