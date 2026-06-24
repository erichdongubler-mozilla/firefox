/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { EditCreditCardDialog } from "chrome://formautofill/content/editDialog.mjs";
import { EditCreditCard } from "chrome://formautofill/content/autofillEditForms.mjs";

// The moz-input-text and moz-select fields in this dialog are lazily defined
// and would otherwise only be upgraded at DOMContentLoaded, after this module
// runs. Importing them here and synchronously upgrading the form ensures their
// constructors run before loadRecord() sets field values, otherwise the
// upgrade would reset those values to empty when editing an existing record.
import "chrome://global/content/elements/moz-input-text.mjs";
import "chrome://global/content/elements/moz-select.mjs";

const { record } = window.arguments?.[0] ?? {};

const form = document.getElementById("form");
customElements.upgrade(form);

const fieldContainer = new EditCreditCard(
  {
    form,
  },
  record,
  []
);

new EditCreditCardDialog(
  {
    title: document.querySelector("title"),
    fieldContainer,
    controlsContainer: document.getElementById("controls-container"),
    cancel: document.getElementById("cancel"),
    save: document.getElementById("save"),
  },
  record
);
