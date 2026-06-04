/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.publicSuffix = class extends ExtensionAPI {
  getAPI() {
    return {
      publicSuffix: {
        isKnownSuffix: function (_hostname) {
          // TODO
        },

        getKnownSuffix: function (_hostname) {
          // TODO
        },

        getDomain: function (_hostname, _options) {
          // TODO
        },
      },
    };
  }
};
