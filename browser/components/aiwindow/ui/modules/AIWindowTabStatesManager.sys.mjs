/*
 This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AIWINDOW_URL:
    "moz-src:///browser/components/aiwindow/ui/modules/AIWindow.sys.mjs",
  AIWindowUI:
    "moz-src:///browser/components/aiwindow/ui/modules/AIWindowUI.sys.mjs",
  ChatStore:
    "moz-src:///browser/components/aiwindow/ui/modules/ChatStore.sys.mjs",
});

/**
 * @typedef {{
 *   input: string,
 *   mode: string,
 *   pageUrl: URL,
 *   conversationId: string,
 * }} TabState
 */

/**
 * Manages state changes of the tabs in AIWindow to keep both the
 * fullwindow and sidebar chats in sync as tabs are created/selected.
 *
 * @todo Bug 2016599
 * Handle close tab event to manage tabState in case of undo close tab
 */
export class AIWindowTabStatesManager {
  /**
   * The browser window instance that this manager operates on
   */
  #window;
  /**
   * The currently selected browser tab
   *
   * @type {MozTabbrowserTab}
   */
  #selectedTab;
  /**
   * A map of tabs and their states
   *
   * @type {WeakMap<MozTabbrowserTab, TabState>}
   */
  #tabStates;
  /**
   * Global progress listener for all tabs
   */
  #tabsListener;

  constructor(win) {
    this.#init(win);
  }

  /**
   * Adds event listeners needed to manage tab states
   *
   * @todo Bug 2016552
   * Handle classic/smartwindow switches to toggle event listeners
   *
   * @param {ChromeWindow} win
   *
   * @private
   */
  #init(win) {
    this.#window = win;
    this.#tabStates = new WeakMap();

    const tabContainer = this.#window.gBrowser.tabContainer;
    tabContainer.addEventListener("TabOpen", this);
    tabContainer.addEventListener("TabSelect", this);
    tabContainer.addEventListener("TabClose", this);

    this.#tabsListener = this.#getTabsListener();
    this.#window.gBrowser.addTabsProgressListener(this.#tabsListener);

    this.#setUpInitialTabs();
    this.#addWindowEventListeners();
  }

  /**
   * Add event listeners to the window for ai-window:* events
   */
  #addWindowEventListeners() {
    this.#window.addEventListener(
      "ai-window:smartbar-input",
      this.#onSmartbarInput
    );

    this.#window.addEventListener(
      "ai-window:connected",
      this.#onAIWindowConnected
    );

    this.#window.addEventListener(
      "ai-window:opened-conversation",
      this.#onConversationOpened
    );

    this.#window.addEventListener(
      "ai-window:clear-conversation",
      this.#onConversationCleared
    );

    this.#window.addEventListener(
      "ai-window:sidebar-toggle",
      this.#onSidebarToggle
    );
  }

  /**
   * Adds event listeners for any tabs that are present when the window opens.
   * The TabOpen event does not fire for the initial tab of a new window, for example.
   *
   * @private
   */
  #setUpInitialTabs() {
    this.#window.gBrowser.tabs.forEach(tab => {
      if (this.#tabStates.has(tab)) {
        return;
      }

      this.#addTabState(tab);
    });
  }

  /**
   * Handles tab events
   *
   * @param {Event} event
   *
   * @private
   */
  handleEvent(event) {
    switch (event.type) {
      case "TabOpen":
        this.#onTabOpen(event);
        break;

      case "TabSelect":
        this.#onTabSelect(event);
        break;

      case "TabClose":
        this.#onTabClose(event);
        break;
    }
  }

  /**
   * Handles TabOpen events from a new browser tab to add
   * event listeners to it.
   *
   * @param {Event} event
   *
   * @private
   */
  #onTabOpen(event) {
    this.#addTabState(event.target);
  }

  /**
   * Handles TabSelect events from a new browser tab to
   * update the state of the sidebar.
   *
   * @param {Event} event
   *
   * @private
   */
  async #onTabSelect(event) {
    this.#selectedTab = event.target;

    const tabState = this.#getTabState(this.#selectedTab);
    const convId = tabState?.state?.conversationId;
    const tabUrl = this.#selectedTab.linkedBrowser.currentURI.spec;
    const tabNeedsSidebar = tabUrl !== lazy.AIWINDOW_URL;
    // Default computedKeepSidebar based on whether we have a conversation
    // If we have a convId, default to keeping sidebar open; otherwise default to false
    const computedKeepSidebar = tabState?.state?.keepSidebarOpen ?? !!convId;
    const explicitKeepSidebar = tabState?.state?.keepSidebarOpen;

    // If no conversation ID but we should keep sidebar open (cleared conversation case)
    if (!convId && explicitKeepSidebar && tabNeedsSidebar) {
      lazy.AIWindowUI.openSidebar(this.#window);
      return;
    }

    if (!convId && !computedKeepSidebar && !tabNeedsSidebar) {
      lazy.AIWindowUI.closeSidebar(this.#window);
      return;
    }

    // @todo Bug 2016545
    // Track the Ask button clicks to properly detontermine if a sidebar
    // needs to be opened/closed for a tab
    if (tabNeedsSidebar && computedKeepSidebar) {
      const conversation = await lazy.ChatStore.findConversationById(convId);
      lazy.AIWindowUI.openSidebar(this.#window, conversation);
    } else {
      lazy.AIWindowUI.closeSidebar(this.#window);
    }

    // TODO: Bug 2014936
    // Update input
  }

  /**
   * Handles TabClose events from a new browser tab to
   * clean up after the tab is gone.
   *
   * @param {Event} event
   *
   * @private
   */
  #onTabClose(event) {
    this.#removeEventListeners(event.target);
  }

  /**
   * Adds a tab to the state map.
   *
   * @param {MozTabbrowserTab} tab
   *
   * @private
   */
  #addTabState(tab) {
    this.#tabStates.set(tab, { state: null });
  }

  /**
   * Removes necessary event listeners from a tab.
   *
   * @param {MozTabbrowserTab} tab
   *
   * @private
   */
  #removeEventListeners(tab) {
    this.#tabStates.delete(tab);
  }

  /**
   * Listens for ai-window:connected events from ai-window.mjs instances
   *
   * @param {AIWindowStateEvent} event
   *
   * @private
   */
  #onAIWindowConnected = async event => {
    const tabState = this.#getTabState(event.detail.tab, event.detail);
    const { mode, pageUrl, conversationId, input } = tabState;

    const conversation = await lazy.ChatStore.findConversationById(
      conversationId || event.detail.conversationId
    );
    const isAIWindow = pageUrl === lazy.AIWINDOW_URL;

    const needsSidebar =
      this.#selectedTab === event.detail.tab &&
      mode === "fullpage" &&
      !isAIWindow &&
      input &&
      conversation &&
      conversation.messages.length;

    // NOTE: Don't need to fire open/close sidebar from here, the location change
    // event handler is taking care of that logic.
    if (needsSidebar) {
      // TODO: Bug 2014936
      // Update smartbar input
    }
  };

  /**
   * Gets the state for the specified tab. Will update the state
   * if a newState is passed in.
   *
   * @param {*} tab The browser tab to get state for
   * @param {*} [newState=null] New state to update the tab with
   *
   * @returns {TabState}
   *
   * @private
   */
  #getTabState(tab, newState = null) {
    const tabState = this.#tabStates.get(tab) ?? {};

    if (newState) {
      const { input, mode, pageUrl, conversationId } = tabState.state ?? {};
      delete newState.tab;

      tabState.state = {
        input,
        mode,
        pageUrl,
        conversationId,
        ...newState,
      };

      this.#tabStates.set(tab, tabState);
    }

    return tabState;
  }

  /**
   * Handles input events from the Smartbar, updates the state
   * with the latest input
   *
   * @param {TabStateEvent} event
   */
  #onSmartbarInput = event => {
    this.#getTabState(event.detail.tab, event.detail);
  };

  /**
   * Handles ai-window:opened-conversation events from the ai-window.mjs,
   * updates the state with conversation info
   *
   * @param {TabStateEvent} event
   */
  #onConversationOpened = event => {
    const { mode, conversationId, tab } = event.detail;
    const currentTabState = this.#getTabState(tab);

    this.#getTabState(tab, {
      mode,
      conversationId,
      keepSidebarOpen: currentTabState?.state?.keepSidebarOpen ?? true,
    });
  };

  /**
   * Handles ai-window:clear-conversation events from the ai-window.mjs,
   * clears the conversation ID from the tab state but preserves other state
   *
   * @param {TabStateEvent} event
   */
  #onConversationCleared = event => {
    const { tab } = event.detail;
    const currentTabState = this.#getTabState(tab);
    const isSidebarCurrentlyOpen = lazy.AIWindowUI.isSidebarOpen(this.#window);

    // Preserve existing state but clear only the conversationId
    // Set keepSidebarOpen flag if sidebar is currently open
    if (currentTabState?.state) {
      this.#getTabState(tab, {
        ...currentTabState.state,
        conversationId: null,
        keepSidebarOpen: isSidebarCurrentlyOpen,
      });
    }
  };

  /**
   * Handles ai-window:sidebar-toggle events from the AIWindowUI.sys.mjs,
   * updates sidebar state flags based on toggle action
   *
   * @param {TabStateEvent} event
   */
  #onSidebarToggle = event => {
    const { tab, isOpen } = event.detail;
    const currentTabState = this.#getTabState(tab);

    if (currentTabState?.state) {
      this.#getTabState(tab, {
        ...currentTabState.state,
        keepSidebarOpen: isOpen,
      });
    }
  };

  /**
   * Gets a global progress listener for all tabs. The callbacks from
   * addTabsProgressListener prepend a browser argument.
   */
  #getTabsListener() {
    return {
      QueryInterface: ChromeUtils.generateQI([
        "nsIWebProgressListener",
        "nsISupportsWeakReference",
      ]),

      onLocationChange: async (
        _browser,
        webProgress,
        _request,
        locationURI,
        _flags
      ) => {
        if (!webProgress.isTopLevel) {
          return;
        }

        const browser = webProgress.browsingContext?.embedderElement;
        const tab = this.#window.gBrowser.getTabForBrowser(browser);
        const tabState = this.#tabStates.get(tab);

        if (!tabState || !tabState?.state?.conversationId) {
          return;
        }

        const isSidebarOpen = lazy.AIWindowUI.isSidebarOpen(this.#window);
        const convId = tabState.state.conversationId;
        const conversation = await lazy.ChatStore.findConversationById(convId);
        const isAiWindowUrl = locationURI.spec === lazy.AIWINDOW_URL;

        const needsSidebar =
          !isAiWindowUrl &&
          tabState.state.mode === "fullpage" &&
          !isSidebarOpen;

        const needsCloseSidebar =
          isAiWindowUrl && tabState.state.mode === "fullpage" && isSidebarOpen;

        if (needsSidebar) {
          lazy.AIWindowUI.openSidebar(this.#window, conversation);
        } else if (needsCloseSidebar) {
          lazy.AIWindowUI.closeSidebar(this.#window);
        }
      },

      onStateChange() {},
      onProgressChange() {},
      onStatusChange() {},
      onSecurityChange() {},
      onContentBlockingEvent() {},
    };
  }
}
