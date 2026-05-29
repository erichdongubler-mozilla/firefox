/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

import { html } from "chrome://global/content/vendor/lit.all.mjs";

import { SidebarPage } from "./sidebar-page.mjs";

ChromeUtils.defineESModuleGetters(lazy, {
  OpenTabsController: "resource:///modules/OpenTabsController.sys.mjs",
  SidebarTreeView:
    "moz-src:///browser/components/sidebar/SidebarTreeView.sys.mjs",
  getTabsTargetForWindow: "resource:///modules/OpenTabs.sys.mjs",
});

export class SidebarOpenTabs extends SidebarPage {
  static properties = {
    tabs: { type: Array },
  };

  constructor() {
    super();
    this.tabs = [];
    this.controller = new lazy.OpenTabsController();
    this.treeView = new lazy.SidebarTreeView(this, { multiSelect: false });
  }

  connectedCallback() {
    super.connectedCallback();
    this.openTabsTarget = lazy.getTabsTargetForWindow(this.topWindow);
    this.openTabsTarget.addEventListener("TabChange", this);
    this.tabs = this.openTabsTarget.getTabsForWindow(this.topWindow);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.openTabsTarget.removeEventListener("TabChange", this);
  }

  handleEvent(e) {
    switch (e.type) {
      case "TabChange":
        this.tabs = this.openTabsTarget.getTabsForWindow(this.topWindow);
        break;
      default:
        super.handleEvent(e);
        break;
    }
  }

  get tabItems() {
    return this.controller.getTabListItems(this.tabs, false).map(item => ({
      ...item,
      secondaryL10nId: "fxviewtabrow-close-tab-button",
      secondaryL10nArgs: JSON.stringify({ tabTitle: item.title }),
    }));
  }

  onPrimaryAction(e) {
    const { tabElement } = e.originalTarget;
    if (!tabElement) {
      return;
    }
    const browserWindow = tabElement.documentGlobal;
    browserWindow.focus();
    browserWindow.gBrowser.selectedTab = tabElement;
  }

  onSecondaryAction(e) {
    const { tabElement } = e.detail.item;
    if (!tabElement) {
      return;
    }
    tabElement.documentGlobal.gBrowser.removeTabs([tabElement]);
  }

  render() {
    return html`
      ${this.stylesheet()}
      <link
        rel="stylesheet"
        href="chrome://browser/content/sidebar/sidebar-opentabs.css"
      />
      <div class="sidebar-panel">
        <sidebar-panel-header
          data-l10n-id="sidebar-menu-open-tabs-header"
          data-l10n-attrs="heading"
          view="viewOpenTabsSidebar"
        ></sidebar-panel-header>
        <div class="sidebar-panel-scrollable-content">
          <sidebar-tab-list
            maxTabsLength="-1"
            secondaryActionClass="dismiss-button"
            .multiSelect=${false}
            .tabItems=${this.tabItems}
            @fxview-tab-list-primary-action=${this.onPrimaryAction}
            @fxview-tab-list-secondary-action=${this.onSecondaryAction}
          ></sidebar-tab-list>
        </div>
      </div>
    `;
  }
}

customElements.define("sidebar-opentabs", SidebarOpenTabs);
