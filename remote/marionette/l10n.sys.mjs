/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * An API which allows Marionette to handle localized content.
 *
 * The localization (https://mzl.la/2eUMjyF) of UI elements in Gecko
 * based applications is done via entities and properties. For static
 * values entities are used, which are located in .dtd files. Whereby for
 * dynamically updated content the values come from .property files. Both
 * types of elements can be identifed via a unique id, and the translated
 * content retrieved.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  error: "chrome://remote/content/shared/webdriver/Errors.sys.mjs",
});

/** @namespace */
export const l10n = {};

/**
 * Retrieve the localized string for the specified property id.
 *
 * Example:
 *
 *     localizeProperty(
 *         ["chrome://global/locale/findbar.properties"], "FastFind");
 *
 * @param {Array.<string>} urls
 *     Array of .properties URLs.
 * @param {string} id
 *     The ID of the property to retrieve the localized string for.
 *
 * @returns {string}
 *     The localized string for the requested property.
 */
l10n.localizeProperty = function (urls, id) {
  let property = null;

  for (let url of urls) {
    let bundle = Services.strings.createBundle(url);
    try {
      property = bundle.GetStringFromName(id);
      break;
    } catch (e) {}
  }

  if (property === null) {
    throw new lazy.error.NoSuchElementError(
      `Property with ID '${id}' hasn't been found`
    );
  }

  return property;
};
