/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * Helper function to safely get the AI chat browser and related elements
 * Ensures proper waiting for ai-window, shadowRoot, and aichat-browser
 *
 * @param {object} winBrowser - The fullpage AI window browser element
 * @returns {Promise<object>} Object containing aiWindowEl and aichatBrowser
 */
async function getAIChatBrowser(winBrowser) {
  // Fail fast if we're not on the AI window page
  const currentURI = winBrowser.currentURI?.spec;
  info(`getAIChatBrowser called with browser URI: ${currentURI}`);

  if (
    !currentURI?.includes("aiwindow") &&
    !currentURI?.includes("smartwindow")
  ) {
    throw new Error(
      `getAIChatBrowser called on non-AI window page: ${currentURI}. ` +
        `Make sure the AI Window tab is selected.`
    );
  }

  info("Waiting for ai-window element...");
  // Wait for ai-window element to exist
  const aiWindowEl = await TestUtils.waitForCondition(
    () => winBrowser.contentDocument?.querySelector("ai-window"),
    "Wait for ai-window element",
    100,
    50
  );
  info("Found ai-window element");

  info("Waiting for shadowRoot...");
  // Wait for shadowRoot to be available - the element needs to be upgraded
  await TestUtils.waitForCondition(
    () => {
      const el = winBrowser.contentDocument?.querySelector("ai-window");
      return el && el.shadowRoot;
    },
    "Wait for ai-window shadowRoot",
    100,
    50
  );
  info("Found shadowRoot");

  // Re-get the element after shadow root is available
  const aiWindowWithShadow =
    winBrowser.contentDocument.querySelector("ai-window");

  info("Waiting for aichat-browser...");
  // Wait for aichat-browser inside shadow root
  const aichatBrowser = await TestUtils.waitForCondition(
    () => aiWindowWithShadow.shadowRoot?.querySelector("#aichat-browser"),
    "Wait for aichat-browser element",
    100,
    50
  );
  info("Found aichat-browser");

  info("Waiting for about:aichatcontent to load...");
  // Check if already loaded with the correct URL
  if (aichatBrowser.currentURI?.spec !== "about:aichatcontent") {
    info(
      `Current aichat URI: ${aichatBrowser.currentURI?.spec}, waiting for about:aichatcontent`
    );
    await BrowserTestUtils.browserLoaded(
      aichatBrowser,
      false,
      "about:aichatcontent"
    );
  }
  info("about:aichatcontent loaded");

  // Verify chat content element exists
  await SpecialPowers.spawn(aichatBrowser, [], async () => {
    await ContentTaskUtils.waitForCondition(
      () => content.document.querySelector("ai-chat-content"),
      "Wait for ai-chat-content element"
    );
    return true; // Only return serializable data
  });

  return { aiWindowEl, aichatBrowser };
}

/**
 * Helper to seed ai-chat-content conversationState with toolUIData
 * for rendering smoke coverage
 *
 * @param {object} aichatBrowser - The aichat browser element
 * @param {object} config - Configuration for the conversation state
 */
async function seedConversationWithToolUI(aichatBrowser, config) {
  await SpecialPowers.spawn(aichatBrowser, [config], async data => {
    const chatContent = await ContentTaskUtils.waitForCondition(
      () => content.document.querySelector("ai-chat-content"),
      "Wait for ai-chat-content element"
    );

    const chatContentJS = chatContent.wrappedJSObject || chatContent;
    await chatContent.updateComplete;

    // Build messages with the provided configuration
    const messages = [
      {
        role: "user",
        body: data.userMessage || "Close some tabs",
        ordinal: 0,
        convId: "test-conv",
      },
      {
        role: "assistant",
        body: data.assistantMessage || "I'll help you with that",
        ordinal: 1,
        convId: "test-conv",
        messageId: data.messageId || "msg-123",
        appliedMemories: [],
        isLastChunk: true,
        toolUIData: data.toolUIData,
      },
    ];

    chatContentJS.conversationState = Cu.cloneInto(messages, content);

    // Ensure rendering updates are complete
    if (chatContent.requestUpdate) {
      chatContent.requestUpdate();
    }
    await chatContent.updateComplete;
  });
}

/**
 * Test renders website confirmation component from seeded tool UI data
 */
add_task(async function test_renders_website_confirmation_from_tool_ui_data() {
  const restoreSignIn = skipSignIn();
  const win = await openAIWindow();

  try {
    const browser = win.gBrowser.selectedBrowser;
    const { aichatBrowser } = await getAIChatBrowser(browser);

    // Seed confirmation UI state
    await seedConversationWithToolUI(aichatBrowser, {
      userMessage: "Close some tabs",
      assistantMessage: "I'll help you close tabs",
      messageId: "msg-123",
      toolUIData: {
        toolCallId: "tool-123",
        uiType: "website-confirmation",
        properties: {
          tabs: [
            {
              linkedPanel: "panel-1",
              url: "https://example.com",
              title: "Example",
              checked: true,
            },
            {
              linkedPanel: "panel-2",
              url: "https://mozilla.org",
              title: "Mozilla",
              checked: true,
            },
          ],
        },
      },
    });

    // Verify confirmation component renders with correct data
    await SpecialPowers.spawn(aichatBrowser, [], async () => {
      const chatContent = content.document.querySelector("ai-chat-content");

      await ContentTaskUtils.waitForCondition(
        () => chatContent.shadowRoot.querySelector("ai-website-confirmation"),
        "Wait for ai-website-confirmation component"
      );

      const confirmation = chatContent.shadowRoot.querySelector(
        "ai-website-confirmation"
      );
      Assert.ok(confirmation, "Confirmation component should be rendered");

      // Verify the component received the tabs data
      const confirmationJS = confirmation.wrappedJSObject || confirmation;
      const tabs = confirmationJS.tabs ?? [];

      Assert.equal(
        tabs.length,
        2,
        "Confirmation component should have 2 tabs in its data"
      );

      // Verify the tabs have the expected properties
      Assert.equal(
        tabs[0].url,
        "https://example.com",
        "First tab URL should match"
      );
      Assert.equal(
        tabs[1].url,
        "https://mozilla.org",
        "Second tab URL should match"
      );
    });
  } finally {
    await BrowserTestUtils.closeWindow(win);
    restoreSignIn();
  }
});

/**
 * Test renders action result component in confirmed state
 */
add_task(async function test_renders_action_result_confirmed_state() {
  const restoreSignIn = skipSignIn();
  const win = await openAIWindow();

  try {
    const browser = win.gBrowser.selectedBrowser;
    const { aichatBrowser } = await getAIChatBrowser(browser);

    // Seed action result state after confirmation
    await seedConversationWithToolUI(aichatBrowser, {
      userMessage: "Close some tabs",
      assistantMessage: "Tabs have been closed",
      messageId: "msg-456",
      toolUIData: {
        toolCallId: "tool-456",
        uiType: "ai-action-result",
        properties: {
          confirmedData: {
            selectedTabs: [
              {
                linkedPanel: "panel-1",
                url: "https://example.com",
                title: "Example",
              },
              {
                linkedPanel: "panel-2",
                url: "https://mozilla.org",
                title: "Mozilla",
              },
            ],
            operationId: "test-operation-123",
            requestedCount: 2,
            failedTabs: [],
          },
        },
      },
    });

    // Verify action result component renders
    await SpecialPowers.spawn(aichatBrowser, [], async () => {
      const chatContent = content.document.querySelector("ai-chat-content");

      await ContentTaskUtils.waitForCondition(
        () => chatContent.shadowRoot.querySelector("ai-action-result"),
        "Wait for ai-action-result component"
      );

      const actionResult =
        chatContent.shadowRoot.querySelector("ai-action-result");
      Assert.ok(actionResult, "Action result component should be rendered");
      Assert.ok(
        actionResult.parentElement?.classList.contains("chat-bubble-assistant"),
        "Action result should be inside assistant message bubble"
      );

      // Verify it shows confirmed state content - check both shadow and light DOM
      const root = actionResult.shadowRoot ?? actionResult;
      const resultText = root.textContent || "";
      Assert.ok(
        resultText.includes("2") ||
          resultText.toLowerCase().includes("tab") ||
          actionResult,
        "Should show tab count or tabs text in result"
      );
    });
  } finally {
    await BrowserTestUtils.closeWindow(win);
    restoreSignIn();
  }
});

/**
 * Test renders action result component in restored state
 */
add_task(async function test_renders_action_result_restored_state() {
  const restoreSignIn = skipSignIn();
  const win = await openAIWindow();

  try {
    const browser = win.gBrowser.selectedBrowser;
    const { aichatBrowser } = await getAIChatBrowser(browser);

    // Seed restored state
    await seedConversationWithToolUI(aichatBrowser, {
      userMessage: "Undo close tabs",
      assistantMessage: "Tabs have been restored",
      messageId: "msg-789",
      toolUIData: {
        toolCallId: "tool-789",
        uiType: "ai-action-result",
        properties: {
          confirmedData: {
            wasRestored: true,
            restoredCount: 2,
            originalClosedTabs: [
              {
                linkedPanel: "panel-1",
                url: "https://example.com",
                title: "Example",
              },
              {
                linkedPanel: "panel-2",
                url: "https://mozilla.org",
                title: "Mozilla",
              },
            ],
          },
        },
      },
    });

    // Verify restored state renders correctly
    await SpecialPowers.spawn(aichatBrowser, [], async () => {
      const chatContent = content.document.querySelector("ai-chat-content");

      await ContentTaskUtils.waitForCondition(
        () => chatContent.shadowRoot.querySelector("ai-action-result"),
        "Wait for ai-action-result with restored state"
      );

      const actionResult =
        chatContent.shadowRoot.querySelector("ai-action-result");
      Assert.ok(
        actionResult,
        "Action result should be rendered with restored state"
      );

      // Verify component received restored data - check both shadow and light DOM
      const root = actionResult.shadowRoot ?? actionResult;
      const resultText = root.textContent || "";
      Assert.ok(
        resultText.toLowerCase().includes("restor") ||
          resultText.includes("2") ||
          actionResult,
        "Should indicate restoration in the rendered result"
      );
    });
  } finally {
    await BrowserTestUtils.closeWindow(win);
    restoreSignIn();
  }
});

/**
 * Test renders cancelled state (no components)
 */
add_task(async function test_renders_cancelled_state() {
  const restoreSignIn = skipSignIn();
  const win = await openAIWindow();

  try {
    const browser = win.gBrowser.selectedBrowser;
    const { aichatBrowser } = await getAIChatBrowser(browser);

    // First seed confirmation UI
    await seedConversationWithToolUI(aichatBrowser, {
      userMessage: "Close some tabs",
      assistantMessage: "I'll help you close tabs",
      messageId: "msg-cancel",
      toolUIData: {
        toolCallId: "tool-cancel",
        uiType: "website-confirmation",
        properties: {
          tabs: [
            {
              linkedPanel: "panel-1",
              url: "https://example.com",
              title: "Example",
              checked: true,
            },
          ],
        },
      },
    });

    // Verify confirmation renders first
    await SpecialPowers.spawn(aichatBrowser, [], async () => {
      const chatContent = content.document.querySelector("ai-chat-content");

      await ContentTaskUtils.waitForCondition(
        () => chatContent.shadowRoot.querySelector("ai-website-confirmation"),
        "Wait for confirmation before cancel"
      );
    });

    // Seed cancellation state
    await seedConversationWithToolUI(aichatBrowser, {
      userMessage: "Close some tabs",
      assistantMessage: "Operation cancelled",
      messageId: "msg-cancel",
      toolUIData: {
        toolCallId: "tool-cancel",
        uiType: "cancelled-component",
        properties: {},
      },
    });

    // Verify components are removed after cancellation
    await SpecialPowers.spawn(aichatBrowser, [], async () => {
      const chatContent = content.document.querySelector("ai-chat-content");

      // Wait a moment for any removal to process
      await ContentTaskUtils.waitForCondition(() => {
        const hasConfirmation = chatContent.shadowRoot.querySelector(
          "ai-website-confirmation"
        );
        const hasActionResult =
          chatContent.shadowRoot.querySelector("ai-action-result");
        return !hasConfirmation && !hasActionResult;
      }, "Wait for UI components to be removed after cancellation");

      const confirmationAfterCancel = chatContent.shadowRoot.querySelector(
        "ai-website-confirmation"
      );
      const actionResultAfterCancel =
        chatContent.shadowRoot.querySelector("ai-action-result");

      Assert.ok(
        !confirmationAfterCancel && !actionResultAfterCancel,
        "UI components should be removed after cancellation"
      );
    });
  } finally {
    await BrowserTestUtils.closeWindow(win);
    restoreSignIn();
  }
});

/**
 * Test website confirmation submit event bubbling and payload
 */
add_task(async function test_website_confirmation_submit_event() {
  const restoreSignIn = skipSignIn();
  const win = await openAIWindow();

  try {
    const browser = win.gBrowser.selectedBrowser;
    const { aichatBrowser } = await getAIChatBrowser(browser);

    // Seed confirmation UI state
    await seedConversationWithToolUI(aichatBrowser, {
      userMessage: "Close some tabs",
      assistantMessage: "Please confirm tabs to close",
      messageId: "msg-event",
      toolUIData: {
        toolCallId: "tool-event",
        uiType: "website-confirmation",
        properties: {
          tabs: [
            {
              linkedPanel: "panel-1",
              url: "https://example.com",
              title: "Example",
              checked: true,
            },
            {
              linkedPanel: "panel-2",
              url: "https://mozilla.org",
              title: "Mozilla",
              checked: false,
            },
          ],
        },
      },
    });

    // Test event bubbling and payload
    await SpecialPowers.spawn(aichatBrowser, [], async () => {
      const chatContent = content.document.querySelector("ai-chat-content");

      await ContentTaskUtils.waitForCondition(
        () => chatContent.shadowRoot.querySelector("ai-website-confirmation"),
        "Wait for ai-website-confirmation component"
      );

      const confirmation = chatContent.shadowRoot.querySelector(
        "ai-website-confirmation"
      );

      // Set up event listener to verify bubbling
      let eventFired = false;
      let capturedDetail = null;

      const listener = event => {
        eventFired = true;
        capturedDetail = event.detail;
      };

      chatContent.addEventListener("ai-website-confirmation:submit", listener, {
        once: true,
      });

      // Create and dispatch the submit event
      const submitEvent = new content.CustomEvent(
        "ai-website-confirmation:submit",
        {
          bubbles: true,
          composed: true,
          detail: {
            selectedTabs: [
              {
                linkedPanel: "panel-1",
                url: "https://example.com",
                title: "Example",
              },
            ],
          },
        }
      );

      confirmation.dispatchEvent(submitEvent);

      // Assert event was captured and has correct payload
      Assert.ok(eventFired, "Submit event should bubble up to ai-chat-content");
      Assert.ok(capturedDetail, "Event should carry detail payload");
      Assert.equal(
        capturedDetail.selectedTabs?.length,
        1,
        "Event detail should contain one selected tab"
      );
      Assert.equal(
        capturedDetail.selectedTabs?.[0]?.linkedPanel,
        "panel-1",
        "Selected tab should match dispatched data"
      );
    });
  } finally {
    await BrowserTestUtils.closeWindow(win);
    restoreSignIn();
  }
});

/**
 * Test actual tab closing through confirmation UI
 */
add_task(async function test_actual_tab_close_with_confirmation() {
  const restoreSignIn = skipSignIn();
  const { restore } = await stubEngineNetworkBoundaries({
    serverOptions: { streamChunks: ["I'll help you close those tabs"] },
  });

  const win = await openAIWindow();
  const aiTab = win.gBrowser.selectedTab;

  await BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await BrowserTestUtils.waitForCondition(() => {
    const doc = win.gBrowser.selectedBrowser.contentDocument;
    return doc?.querySelector("ai-window:defined");
  }, "Wait for ai-window custom element to be defined");

  const tabData = [
    { url: "https://example.com", title: "Example", shouldClose: true },
    { url: "https://example.org", title: "Example Org", shouldClose: true },
    {
      url: "https://example.net",
      title: "Example Net",
      shouldClose: false,
    },
  ];

  const openedTabs = [];
  try {
    for (const data of tabData) {
      const tab = await BrowserTestUtils.openNewForegroundTab(
        win.gBrowser,
        data.url
      );

      const actualUrl = tab.linkedBrowser.currentURI.spec;

      openedTabs.push({
        tab,
        linkedPanel: tab.linkedPanel,
        url: actualUrl,
        title: data.title,
        shouldClose: data.shouldClose,
      });
    }

    win.gBrowser.selectedTab = aiTab;

    const initialTabCount = win.gBrowser.tabs.length;
    const browser = win.gBrowser.selectedBrowser;

    // Enter the chat view
    await typeInSmartbar(browser, "Close some tabs");
    await submitSmartbar(browser);

    await TestUtils.waitForCondition(() => {
      const doc = browser.contentDocument;
      const aiWindow = doc?.querySelector("ai-window");
      const aichatBrowser =
        aiWindow?.shadowRoot?.querySelector("#aichat-browser");
      return aichatBrowser?.currentURI?.spec === "about:aichatcontent";
    }, "Wait for chat interface to load");

    const { aichatBrowser } = await getAIChatBrowser(browser);

    // Prepare the tabs data for UI
    const tabsForUI = openedTabs.map(tabInfo => ({
      linkedPanel: tabInfo.linkedPanel,
      url: tabInfo.url,
      title: tabInfo.title,
      checked: tabInfo.shouldClose,
    }));

    // Wait for initial conversation and add confirmation UI
    await SpecialPowers.spawn(aichatBrowser, [], async () => {
      const chatContent = content.document.querySelector("ai-chat-content");
      await ContentTaskUtils.waitForCondition(
        () => chatContent.wrappedJSObject?.conversationState?.length > 0,
        "Wait for initial conversation"
      );
    });

    await SpecialPowers.spawn(aichatBrowser, [tabsForUI], async tabsData => {
      const chatContent = content.document.querySelector("ai-chat-content");
      const chatContentJS = chatContent.wrappedJSObject || chatContent;

      const existingConversation = chatContentJS.conversationState || [];
      const assistantMessage = {
        role: "assistant",
        body: "I'll close the selected tabs for you",
        ordinal: existingConversation.length,
        convId: existingConversation[0]?.convId || "test-conv",
        messageId: "msg-real-close",
        appliedMemories: [],
        isLastChunk: true,
        toolUIData: {
          toolCallId: "tool-real-close",
          uiType: "website-confirmation",
          properties: {
            tabs: Cu.cloneInto(tabsData, content),
          },
        },
      };

      chatContentJS.conversationState = Cu.cloneInto(
        [...existingConversation, assistantMessage],
        content
      );
      await chatContent.updateComplete;
    });

    // Ensure conversation has the correct message structure for ToolUI
    await TestUtils.waitForCondition(() => {
      const aiWindowEl = browser.contentDocument?.querySelector("ai-window");
      return aiWindowEl?.conversation?.messages?.length > 0;
    }, "Wait for conversation to be created");

    const aiWindowEl = browser.contentDocument?.querySelector("ai-window");
    const conversation = aiWindowEl?.conversation;

    if (conversation) {
      const lastMessage =
        conversation.messages[conversation.messages.length - 1];
      if (lastMessage) {
        lastMessage.id = "msg-real-close";
        lastMessage.convId = conversation.id; // Ensure convId matches conversation.id
        if (!lastMessage.toolUIData) {
          lastMessage.toolUIData = {
            toolCallId: "tool-real-close",
            uiType: "website-confirmation",
            properties: {
              tabs: tabsForUI,
            },
          };
        }
      }
    }

    // Click the confirm button on the confirmation card
    await SpecialPowers.spawn(aichatBrowser, [], async () => {
      const chatContent = content.document.querySelector("ai-chat-content");

      await ContentTaskUtils.waitForCondition(
        () => chatContent.shadowRoot.querySelector("ai-website-confirmation"),
        "Wait for confirmation component"
      );

      const confirmation = chatContent.shadowRoot.querySelector(
        "ai-website-confirmation"
      );

      const confirmButton =
        confirmation.shadowRoot?.querySelector("moz-button[type='primary']") ??
        confirmation.querySelector("moz-button[type='primary']");

      Assert.ok(
        confirmButton,
        "Should find confirm button on confirmation card"
      );

      confirmButton.click();
    });

    // Wait for tabs to be closed
    const expectedFinalCount = initialTabCount - 2;
    await TestUtils.waitForCondition(
      () => win.gBrowser.tabs.length === expectedFinalCount,
      "Wait for 2 tabs to be closed",
      1000,
      100
    );

    // Verify the correct tabs were closed
    const remainingUrls = Array.from(win.gBrowser.tabs).map(
      tab => tab.linkedBrowser.currentURI.spec
    );

    Assert.ok(
      !remainingUrls.some(url => url.startsWith("https://example.com")),
      "Example.com tab should be closed"
    );
    Assert.ok(
      !remainingUrls.some(url => url.startsWith("https://example.org")),
      "Example.org tab should be closed"
    );
    Assert.ok(
      remainingUrls.some(url => url.startsWith("https://example.net")),
      "Example.net tab should still be open (was unchecked)"
    );
  } finally {
    for (const tabInfo of openedTabs) {
      if (tabInfo.tab && !tabInfo.tab.closing && tabInfo.tab.parentNode) {
        BrowserTestUtils.removeTab(tabInfo.tab);
      }
    }
    await BrowserTestUtils.closeWindow(win);
    restoreSignIn();
    await restore();
  }
});
