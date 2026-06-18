/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Central registry describing the data types Form Autofill can detect and
 * classify (address, credit card, ...).
 */
class AutofillDataTypeRegistry {
  // Canonical data-type identifiers. Exposed on the instance below (e.g.
  // `AutofillDataTypes.ADDRESS`) so callers reference a named constant, and
  // used as the descriptor `id`s.
  static ADDRESS = "address";
  static CREDIT_CARD = "creditCard";

  /** @type {Map<string, AutofillDataType>} */
  #byId;

  /**
   * @param {AutofillDataType[]} descriptors
   */
  constructor(descriptors) {
    this.all = Object.freeze(
      descriptors.map(type =>
        Object.freeze({
          ...type,
          // The feature prefs all live under
          // `extensions.formautofill.<prefKey>.*`, so they are derived from
          // prefKey.
          availablePref: `extensions.formautofill.${type.prefKey}.supported`,
          supportedCountriesPref: `extensions.formautofill.${type.prefKey}.supportedCountries`,
          enabledPref: `extensions.formautofill.${type.prefKey}.enabled`,
          experimentPref: `extensions.formautofill.${type.prefKey}.experiments.enabled`,
        })
      )
    );
    this.#byId = new Map(this.all.map(type => [type.id, type]));
    this.ADDRESS = AutofillDataTypeRegistry.ADDRESS;
    this.CREDIT_CARD = AutofillDataTypeRegistry.CREDIT_CARD;
    Object.freeze(this);
  }

  /**
   * @param {string} id
   * @returns {AutofillDataType} The descriptor, or null if `id` is unknown.
   */
  get(id) {
    return this.#byId.get(id) ?? null;
  }
}

export const AutofillDataTypes = new AutofillDataTypeRegistry([
  {
    id: AutofillDataTypeRegistry.ADDRESS,
    prefKey: "addresses",
  },
  {
    id: AutofillDataTypeRegistry.CREDIT_CARD,
    prefKey: "creditCards",
  },
]);
