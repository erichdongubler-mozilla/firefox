/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Returns a String value representing the written form of a relative date
 * formatted according to the effective locale and the formatting options
 * of this RelativeTimeFormat object.
 *
 * Spec: ECMAScript 402 API, RelativeTImeFormat, 1.4.3.
 */
function Intl_RelativeTimeFormat_format(value, unit) {
  // Step 1.
  var relativeTimeFormat = this;

  // Step 2.
  if (
    !IsObject(relativeTimeFormat) ||
    (relativeTimeFormat = intl_GuardToRelativeTimeFormat(
      relativeTimeFormat
    )) === null
  ) {
    return callFunction(
      intl_CallRelativeTimeFormatMethodIfWrapped,
      this,
      value,
      unit,
      "Intl_RelativeTimeFormat_format"
    );
  }

  // Step 3.
  var t = TO_NUMBER(value);

  // Step 4.
  var u = ToString(unit);

  // Step 5.
  return intl_FormatRelativeTime(relativeTimeFormat, t, u, false);
}

/**
 * Returns an Array composed of the components of a relative date formatted
 * according to the effective locale and the formatting options of this
 * RelativeTimeFormat object.
 *
 * Spec: ECMAScript 402 API, RelativeTImeFormat, 1.4.4.
 */
function Intl_RelativeTimeFormat_formatToParts(value, unit) {
  // Step 1.
  var relativeTimeFormat = this;

  // Step 2.
  if (
    !IsObject(relativeTimeFormat) ||
    (relativeTimeFormat = intl_GuardToRelativeTimeFormat(
      relativeTimeFormat
    )) === null
  ) {
    return callFunction(
      intl_CallRelativeTimeFormatMethodIfWrapped,
      this,
      value,
      unit,
      "Intl_RelativeTimeFormat_formatToParts"
    );
  }

  // Step 3.
  var t = TO_NUMBER(value);

  // Step 4.
  var u = ToString(unit);

  // Step 5.
  return intl_FormatRelativeTime(relativeTimeFormat, t, u, true);
}
