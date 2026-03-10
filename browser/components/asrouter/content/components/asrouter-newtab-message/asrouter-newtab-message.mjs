/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://global/content/elements/moz-button.mjs";

// This component participates in newtab train-hopping, and is packaged into
// the newtab folder at build-time. We can safely disable the
// no-newtab-refs-outside-newtab rule here, since the owner of this component
// will be responsible for maintaining train-hop compatibility.
const DEFAULT_CSS =
  // eslint-disable-next-line mozilla/no-newtab-refs-outside-newtab
  "chrome://newtab/content/data/content/external-components/asrouter-newtab-message/asrouter-newtab-message.css";

export default class ASRouterNewTabMessage extends MozLitElement {
  static properties = {
    messageData: { type: Object },
    cssOverride: { type: String },

    /**
     * These are injected by New Tab's MessageWrapper component, and should
     * be called in order to do message management operations. See the
     * README.md for this component for more details.
     */
    handleDismiss: { type: Function },
    handleClick: { type: Function },
    handleBlock: { type: Function },
    handleClose: { type: Function },
    isIntersecting: { type: Boolean },
  };

  /**
   * Executes a SpecialMessageAction by dispatching an event that will be caught
   * by the ASRouterNewTabMessage JSWindowActor pair and forwarded to
   * SpecialMessageActions.handleAction() in the parent process.
   *
   * @param {object} action - The action object to execute
   * @param {string} action.type - The action type (e.g., "OPEN_URL", "OPEN_SIDEBAR")
   * @param {*} action.data - Action-specific data
   *
   * @example
   * this.specialMessageAction({
   *   type: "OPEN_SIDEBAR",
   *   data: "viewGenaiChatSidebar"
   * });
   */
  specialMessageAction(action) {
    this.dispatchEvent(
      new CustomEvent("ASRouterNewTabMessage:SpecialMessageAction", {
        bubbles: true,
        detail: {
          action,
        },
      })
    );
  }

  #handlePrimaryButton() {
    this.specialMessageAction({
      type: "OPEN_SIDEBAR",
      data: "viewGenaiChatSidebar",
    });
  }

  render() {
    const CSS_HREF = this.cssOverride || DEFAULT_CSS;
    return html`
      <link rel="stylesheet" href=${CSS_HREF} />
      <div class="container">
        <h1
          data-l10n-id="newtab-activation-window-message-values-focus-header"
        ></h1>
        <pre>${JSON.stringify(this.messageData, null, "\t")}</pre>
        <moz-button @click=${this.#handlePrimaryButton}>
          Click me to open the sidebar with a SpecialMessageAction
        </moz-button>
        <moz-button @click=${this.handleClose}>Close</moz-button>
        <moz-button @click=${this.handleBlock}>Block</moz-button>
      </div>
    `;
  }
}

customElements.define("asrouter-newtab-message", ASRouterNewTabMessage);
