/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/**
 * @import { ChatConversation } from "moz-src:///browser/components/aiwindow/ui/modules/ChatConversation.sys.mjs"
 */

import { sanitizeUntrustedContent } from "moz-src:///browser/components/aiwindow/models/ChatUtils.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AIWindow:
    "moz-src:///browser/components/aiwindow/ui/modules/AIWindow.sys.mjs",
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  ToolUI: "moz-src:///browser/components/aiwindow/ui/modules/ToolUI.sys.mjs",
  ToolUITelemetry:
    "moz-src:///browser/components/aiwindow/ui/modules/ToolUITelemetry.sys.mjs",
});

export const CLOSE_TABS = "close_tabs";
export const TAB_ACTIONS = [CLOSE_TABS];
const UI_TYPE_BY_ACTION = {
  [CLOSE_TABS]: "website-confirmation",
};

/**
 * Finds tabs in active AI windows whose URLs are in validUrls.
 *
 * @param {Set<string>} validUrls
 * @returns {{ matchedTabs: Array<object>, topAIWin: object|null }}
 */
function findMatchingAIWindowTabs(validUrls) {
  const matchedTabs = [];
  let topAIWin = null;

  for (const win of lazy.BrowserWindowTracker.orderedWindows) {
    if (!lazy.AIWindow.isAIWindowActive(win) || win.closed || !win.gBrowser) {
      continue;
    }
    if (!topAIWin) {
      topAIWin = win;
    }
    for (const tab of win.gBrowser.tabs) {
      const url = tab.linkedBrowser?.currentURI?.spec;
      if (validUrls.has(url)) {
        matchedTabs.push({ tab, win, url, linkedPanel: tab.linkedPanel });
      }
    }
  }

  return { matchedTabs, topAIWin };
}

/**
 * Returns true if the matched tabs require user confirmation before acting
 * (pinned/selected tabs, current tab, all tabs of the top AI window, or
 * untrusted input).
 *
 * @param {Array<object>} tabs - list of tabs to check
 * @param {object} topAIWin - the top active AI window
 * @param {object} securityProperties - The security properties of the conversation.
 * @returns {boolean}
 */
function shouldRequireUserConfirmation(tabs, topAIWin, securityProperties) {
  if (securityProperties?.untrustedInput) {
    return true;
  }
  if (tabs.some(({ tab }) => tab.pinned === true)) {
    return true;
  }
  if (tabs.some(({ tab, win }) => win.gBrowser.selectedTab === tab)) {
    return true;
  }
  if (topAIWin) {
    const topWinTabs = new Set(
      tabs.filter(({ win }) => win === topAIWin).map(({ tab }) => tab)
    );
    if (
      topWinTabs.size &&
      topAIWin.gBrowser.tabs.every(tab => topWinTabs.has(tab))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * @param {{ validUrls: Set<string>, askConfirmation: boolean, baseTelemetryInfo: object, conversation: ChatConversation, toolCallId?: string }} state
 * @param {{ action: string, verb: string, failureError: string, failureMessage: string,
 *           takeUIAction: (gathered: object) => Promise<object>,
 *           getToolResults: (result: object, gathered: object) => object }} handler
 */
async function runManageTabsFlow(state, handler) {
  const gatheredResult = await gatherTabs(
    state.validUrls,
    state.baseTelemetryInfo
  );

  if (gatheredResult.earlyResult) {
    return gatheredResult.earlyResult;
  }

  if (
    state.askConfirmation ||
    shouldRequireUserConfirmation(
      gatheredResult.matchedTabs,
      gatheredResult.topAIWin,
      state.conversation.securityProperties
    )
  ) {
    const uiType = UI_TYPE_BY_ACTION[handler.action];
    if (!uiType) {
      throw new Error(`No UI mapping for action: ${handler.action}`);
    }
    // Keep token -> permanentKey on the chrome side until the user confirms;
    // the map can't ride through the confirmation actor round-trip.
    lazy.ToolUI.registerTabKeys(state.toolCallId, gatheredResult.tabKeyByToken);
    return {
      toolResult: {
        description: `The following tabs were found. User confirmation is required to ${handler.verb} them.`,
        pending: true,
        action: handler.action,
        selectedTabs: gatheredResult.summarizedTabInfo,
      },
      uiData: {
        uiType,
        properties: { tabs: gatheredResult.tabs },
      },
    };
  }

  const result = await handler.takeUIAction(gatheredResult);

  if (!result || !result.operationId) {
    lazy.ToolUITelemetry.recordBrowserActionComplete({
      ...state.baseTelemetryInfo,
      result: "error",
      tabs_affected: 0,
      undo_available: false,
      error: handler.failureError,
    });
    return {
      toolResult: `Error: ${handler.action} action failed`,
      uiData: null,
    };
  }

  const { description, selectedTabs, telemetryValues } = handler.getToolResults(
    result,
    gatheredResult
  );

  lazy.ToolUITelemetry.recordBrowserActionComplete({
    ...state.baseTelemetryInfo,
    result: telemetryValues.telemetryResult,
    tabs_affected: telemetryValues.affectedCount,
    undo_available: telemetryValues.affectedCount > 0,
    error: telemetryValues.failedCount ? handler.failureMessage : "",
  });

  return {
    toolResult: {
      description,
      selectedTabs,
    },
    uiData: {
      uiType: "ai-action-result",
      properties: {
        confirmedData: {
          selectedTabs: gatheredResult.tabs,
          operationId: result.operationId,
          actionTimestamp: Date.now(),
          actionType: handler.action,
        },
      },
    },
  };
}

async function gatherTabs(validUrls, baseTelemetryInfo) {
  const { matchedTabs, topAIWin } = findMatchingAIWindowTabs(validUrls);

  if (!matchedTabs.length) {
    lazy.ToolUITelemetry.recordBrowserActionComplete({
      ...baseTelemetryInfo,
      result: "no_match",
      tabs_affected: 0,
      undo_available: false,
      error: "no_open_tab_match",
    });
    return {
      earlyResult: {
        toolResult: "Error: None of the provided URL tokens match an open tab.",
        uiData: null,
      },
    };
  }

  // Identify each tab by its browser's permanentKey
  const tabKeyByToken = new Map();
  const tabs = matchedTabs.map(({ tab, win, url }) => {
    const token = Services.uuid.generateUUID().toString();
    tabKeyByToken.set(token, tab.permanentKey);
    return {
      token,
      url,
      title: sanitizeUntrustedContent(tab.label),
      userContextId: tab.userContextId,
      pinned: tab.pinned,
      selected: win.gBrowser.selectedTab === tab,
      iconSrc: url ? `page-icon:${url}` : "",
      checked: true,
    };
  });

  const summarizedTabInfo = tabs.map(({ url, title, checked }) => ({
    url,
    title,
    checked,
  }));

  return {
    earlyResult: null,
    summarizedTabInfo,
    tabs,
    matchedTabs,
    topAIWin,
    tabKeyByToken,
  };
}

/**
 * Closes the tabs identified by `validUrls` in the active AI windows.
 */
const closeTabsHandler = {
  action: CLOSE_TABS,
  verb: "close",
  failureError: "close_failed",
  failureMessage: "some_tabs_failed_to_close",

  async takeUIAction(gatheredResult) {
    return await lazy.ToolUI.closeSelectedTabs(
      gatheredResult.tabs,
      gatheredResult.tabKeyByToken,
      gatheredResult.topAIWin
    );
  },

  getToolResults(result, gatheredResult) {
    const failedKeys = new Set(
      (result.failedTabs ?? [])
        .map(failedTab => failedTab.tab?.permanentKey)
        .filter(Boolean)
    );
    const closedTabs = gatheredResult.tabs.map(({ url, title, token }) => ({
      url,
      title,
      closed: !failedKeys.has(gatheredResult.tabKeyByToken.get(token)),
    }));

    const closedCount = closedTabs.filter(tab => tab.closed).length;
    const failedCount = closedTabs.length - closedCount;
    let telemetryResult = "success";
    if (failedCount && closedCount === 0) {
      telemetryResult = "error";
    } else if (failedCount) {
      telemetryResult = "partial_success";
    }

    return {
      description: failedCount
        ? `Some tabs failed to close (${failedCount} of ${closedTabs.length}).`
        : "Tabs were successfully closed.",
      selectedTabs: closedTabs,
      telemetryValues: {
        telemetryResult,
        affectedCount: closedCount,
        failedCount,
      },
    };
  },
};

/**
 * Tab management orchestrator to handle all tab-related actions.
 *
 * @param {{ action: string, validUrls: Set<string>, ask_confirmation: boolean, baseTelemetryInfo: object, toolCallId?: string }} params
 * @param {ChatConversation} conversation
 * @returns {Promise<object>}
 */
export async function manageTabsAction(
  { action, validUrls, ask_confirmation, baseTelemetryInfo, toolCallId },
  conversation
) {
  let handler;
  if (action === CLOSE_TABS) {
    handler = closeTabsHandler;
  } else {
    throw new Error(`Invalid action: ${action}`);
  }

  return runManageTabsFlow(
    {
      validUrls,
      askConfirmation: ask_confirmation,
      baseTelemetryInfo,
      conversation,
      toolCallId,
    },
    handler
  );
}
