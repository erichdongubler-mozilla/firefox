/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

let sessionDismissed = false;

export var RosettaUtils = {
  isRosettaTranslated() {
    return Services.sysinfo.getPropertyAsBool("rosettaStatus");
  },

  maybeWarnAboutRosetta(aWindow) {
    if (!this.isRosettaTranslated() || sessionDismissed) {
      return;
    }

    const box = aWindow.gNotificationBox;
    if (box.getNotificationWithValue("rosetta-translated")) {
      return;
    }

    const mozXulElement = box.stack.ownerGlobal.MozXULElement;
    mozXulElement.insertFTLIfNeeded("toolkit/global/rosettaNotification.ftl");

    box.appendNotification(
      "rosetta-translated",
      {
        label: { "l10n-id": "rosetta-translated-message" },
        priority: box.PRIORITY_INFO_HIGH,
        eventCallback: event => {
          if (event === "dismissed") {
            sessionDismissed = true;
            for (const win of Services.wm.getEnumerator("navigator:browser")) {
              if (win !== aWindow) {
                win.gNotificationBox
                  ?.getNotificationWithValue("rosetta-translated")
                  ?.close();
              }
            }
          }
        },
      },
      [
        {
          "l10n-id": "rosetta-translated-launch-without-rosetta",
          link: Services.urlFormatter.formatURL(
            "https://support.mozilla.org/%LOCALE%/kb/firefox-rosetta-macos"
          ),
        },
      ]
    );
  },
};
