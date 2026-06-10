/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const { AIWindowTestUtils, MockEngineManager } = ChromeUtils.importESModule(
  "resource://testing-common/AIWindowTestUtils.sys.mjs"
);
const { toolFns } = ChromeUtils.importESModule(
  "moz-src:///browser/components/aiwindow/models/Tools.sys.mjs"
);

describe("smartwindow history thumbnails", () => {
  let mockEngineMan, win, sandbox, fakeHistoryResults;

  beforeEach(async () => {
    await Services.fog.testFlushAllChildren();

    sandbox = sinon.createSandbox();
    mockEngineMan = new MockEngineManager();
    win = await openAIWindow();

    fakeHistoryResults = getFakeHistoryResults();

    sandbox
      .stub(toolFns, "searchBrowsingHistory")
      .callsFake(getSearchBrowsingHistoryFake(fakeHistoryResults));
  });

  afterEach(async () => {
    if (mockEngineMan) {
      mockEngineMan.cleanupMocks();
    }

    sandbox.restore();

    if (win) {
      await BrowserTestUtils.closeWindow(win);
      win = null;
    }

    Services.fog.testResetFOG();
  });

  describe("when user searches for history results", () => {
    it("displays the history thumbnail grid", async () => {
      const browser = win.gBrowser.selectedBrowser;

      await typeInSmartbar(browser, "show me sites in browsing history");
      await submitSmartbar(browser);

      await mockResponseWithSearchBrowsingHistory(
        mockEngineMan,
        fakeHistoryResults
      );

      const hasAIChatGrid = await checkForElementInChatMessage(
        browser,
        "ai-chat-grid",
        -1
      );

      Assert.ok(
        hasAIChatGrid,
        "Should have a ai-chat-grid in the last message"
      );
    });

    it("renders the right amount of items", async () => {
      const browser = win.gBrowser.selectedBrowser;

      await typeInSmartbar(browser, "show me sites in browsing history");
      await submitSmartbar(browser);

      await mockResponseWithSearchBrowsingHistory(
        mockEngineMan,
        fakeHistoryResults
      );

      info("checking number of items");
      const hasCorrectNumItems = await checkForNumberOfElementsInChatMessage(
        browser,
        ".scroll-area",
        fakeHistoryResults.length
      );

      Assert.ok(
        hasCorrectNumItems,
        "Should have the right number of items in grid"
      );
    });

    it("records a history_displayed event", async () => {
      const browser = win.gBrowser.selectedBrowser;

      await typeInSmartbar(browser, "show me sites in browsing history");
      await submitSmartbar(browser);

      await mockResponseWithSearchBrowsingHistory(
        mockEngineMan,
        fakeHistoryResults
      );

      const hasAIChatGrid = await checkForElementInChatMessage(
        browser,
        "ai-chat-grid",
        -1
      );
      Assert.ok(hasAIChatGrid, "Should have rendered the grid");

      const events = await waitForHistoryTelemetry("historyDisplayed");
      Assert.equal(
        events.length,
        1,
        "Should record one history_displayed event"
      );

      const { extra } = events[0];
      Assert.equal(extra.location, "fullpage", "Should record the location");
      Assert.ok(extra.chat_id, "Should record a chat_id");
      Assert.notStrictEqual(
        extra.message_seq,
        undefined,
        "Should record a message_seq"
      );
      Assert.equal(
        extra.total,
        String(fakeHistoryResults.length),
        "Should record the number of displayed entries"
      );
      Assert.equal(extra.reason, "ask", "Should record the display reason");
    });

    describe("when the results are less than maximum amount", () => {
      beforeEach(async () => {
        fakeHistoryResults = getFakeHistoryResults(5);

        sandbox.restore();
        sandbox
          .stub(toolFns, "searchBrowsingHistory")
          .callsFake(getSearchBrowsingHistoryFake(fakeHistoryResults));
      });

      it("renders 5 items", async () => {
        const browser = win.gBrowser.selectedBrowser;

        await typeInSmartbar(browser, "show me sites in browsing history");
        await submitSmartbar(browser);

        await mockResponseWithSearchBrowsingHistory(
          mockEngineMan,
          fakeHistoryResults
        );

        info("checking number of items");
        const hasCorrectNumItems = await checkForNumberOfElementsInChatMessage(
          browser,
          ".scroll-area",
          5
        );

        Assert.ok(hasCorrectNumItems, "Should have 5 items in grid");
      });
    });

    describe("when the results are more than maximum amount", () => {
      beforeEach(async () => {
        fakeHistoryResults = getFakeHistoryResults(15);

        sandbox.restore();
        sandbox
          .stub(toolFns, "searchBrowsingHistory")
          .callsFake(getSearchBrowsingHistoryFake(fakeHistoryResults));
      });

      it("renders 12 items", async () => {
        const browser = win.gBrowser.selectedBrowser;

        await typeInSmartbar(browser, "show me sites in browsing history");
        await submitSmartbar(browser);

        await mockResponseWithSearchBrowsingHistory(
          mockEngineMan,
          fakeHistoryResults
        );

        info("checking number of items");
        const hasCorrectNumItems = await checkForNumberOfElementsInChatMessage(
          browser,
          ".scroll-area",
          12
        );

        Assert.ok(hasCorrectNumItems, "Should have 12 items in grid");
      });
    });

    describe("when the user clicks on an item", () => {
      let newTab;
      afterEach(async () => {
        if (newTab) {
          BrowserTestUtils.removeTab(newTab);
        }
      });

      it("opens in a new tab", async () => {
        const browser = win.gBrowser.selectedBrowser;

        await typeInSmartbar(browser, "show me sites in browsing history");
        await submitSmartbar(browser);

        await mockResponseWithSearchBrowsingHistory(
          mockEngineMan,
          fakeHistoryResults
        );

        const tabCount = win.gBrowser.tabs.length;
        const newTabPromise = BrowserTestUtils.waitForNewTab(win.gBrowser);

        const clicked = await clickNthGridItem(browser);
        Assert.ok(clicked, "Should have clicked a grid item");
        newTab = await newTabPromise;

        const newTabCount = win.gBrowser.tabs.length;
        Assert.greater(
          newTabCount,
          tabCount,
          `Should have a bigger new tab count (${newTabCount}) than initial tab count (${tabCount})`
        );
      });

      it("records a history_click event", async () => {
        const browser = win.gBrowser.selectedBrowser;

        await typeInSmartbar(browser, "show me sites in browsing history");
        await submitSmartbar(browser);

        await mockResponseWithSearchBrowsingHistory(
          mockEngineMan,
          fakeHistoryResults
        );

        const newTabPromise = BrowserTestUtils.waitForNewTab(win.gBrowser);

        const clicked = await clickNthGridItem(browser, 1);
        Assert.ok(clicked, "Should have clicked a grid item");
        newTab = await newTabPromise;

        const events = await waitForHistoryTelemetry("historyClick");
        Assert.equal(events.length, 1, "Should record one history_click event");

        const { extra } = events[0];
        Assert.equal(extra.location, "fullpage", "Should record the location");
        Assert.ok(extra.chat_id, "Should record a chat_id");
        Assert.notStrictEqual(
          extra.message_seq,
          undefined,
          "Should record a message_seq"
        );
        Assert.equal(
          extra.total,
          String(fakeHistoryResults.length),
          "Should record the total number of entries"
        );
        Assert.equal(
          extra.position,
          "1",
          "Should record the position of the clicked entry"
        );
      });
    });

    describe("when the user clicks on the grid view toggle", () => {
      it("switches from one view to the next", async () => {
        const browser = win.gBrowser.selectedBrowser;

        await typeInSmartbar(browser, "show me sites in browsing history");
        await submitSmartbar(browser);

        await mockResponseWithSearchBrowsingHistory(
          mockEngineMan,
          fakeHistoryResults
        );

        const { showGrid, showList } = await getGridViewMode(browser);

        const toggled = await toggleGridViewMode(browser, showGrid, showList);
        Assert.ok(toggled, "Should toggle the view mode");

        const { showGrid: newShowGrid, showList: newShowList } =
          await getGridViewMode(browser);

        const actual = { showGrid: newShowGrid, showList: newShowList };
        const expected = { showGrid: !showGrid, showList: !showList };
        Assert.deepEqual(actual, expected, "Should flip the view mode flags");
      });
    });
  });
});

// Response to trigger the search_browsing_history tool call
const SEARCH_BROWSING_HISTORY_TOOL_CALL_RESPONSE = [
  {
    text: "",
    tokens: null,
    isPrompt: false,
    toolCalls: [
      {
        id: "call_history_1",
        function: {
          name: "search_browsing_history",
          arguments: JSON.stringify({ searchTerm: "firefox" }),
        },
      },
    ],
  },
];

/**
 * @typedef {{
 *   url: string,
 *   title: string,
 *   favicon: string | null,
 *   thumbnail: string | null,
 *   visitDate: number,
 *   visitCount: number
 * }} HistoryResult
 */

/**
 * Returns an array of browsing history results
 *
 * @param {number} [amount=12] How many to return
 *
 * @returns {Array<HistoryResult>}
 */
function getFakeHistoryResults(amount = 12) {
  return Array.from({ length: amount }, (_, i) => ({
    url: `https://example.com/${i}`,
    title: `Example ${i}`,
    favicon: null,
    thumbnail: null,
    visitDate: Date.now(),
    visitCount: Math.ceil(Math.random() * amount),
  }));
}

/**
 * Returns markdown based on the history results to
 * use in the mocked LLM assistant response
 *
 * @param {HistoryResult} historyResults
 *
 * @returns {string} Markdown representation of history results array
 */
function historyResultsToMarkdown(historyResults) {
  return historyResults
    .map(historyResult => {
      return `- [${historyResult.title}](${historyResult.url})`;
    })
    .join("\n");
}

/**
 * @typedef {{
 *   searchTerm: string,
 *   count: number,
 *   results: Array<HistoryResult>
 * }} SearchBrowsingHistoryToolReturn
 */

/**
 * @typedef {(
 *   toolParams: string,
 *   conversation: ChatConversation
 * ) => Promise<SearchBrowsingHistoryToolReturn>}
 * SearchBrowsingHistoryFunctionFake
 */

/**
 * Returns a stub fake for the search_browsing_history tool call
 * to return a mocked response from the tool call
 *
 * @param {Array<HistoryResult>} fakeResults
 *
 * @returns {SearchBrowsingHistoryFunctionFake}
 */
function getSearchBrowsingHistoryFake(fakeResults) {
  return async (toolParams, conversation) => {
    conversation.addSeenUrls(fakeResults.map(({ url }) => url));
    await conversation.addHistoryResults(fakeResults);
    conversation.securityProperties.setPrivateData();
    return {
      searchTerm: "some search term",
      count: fakeResults.length,
      results: fakeResults,
    };
  };
}

/**
 * Mocks responses from the LLM backend to trigger
 * search_browsing_history tool call and an assistant
 * response with the specified browsing history results
 *
 * @param {MockEngineManager} mockEngineMan
 * @param {Array<HistoryResult>} fakeResults
 *
 * @returns {Promise<void>}
 */
async function mockResponseWithSearchBrowsingHistory(
  mockEngineMan,
  fakeResults
) {
  await mockEngineMan.respondTo({
    purpose: "chat",
    response: SEARCH_BROWSING_HISTORY_TOOL_CALL_RESPONSE,
  });

  await mockEngineMan.respondTo({
    purpose: "chat",
    response: `Here are sites from your history:\n\n${historyResultsToMarkdown(fakeResults)}`,
  });
}

/**
 * Waits for and returns the recorded Glean events for a
 * History Thumbnail grid metric.
 *
 * @param {"historyDisplayed" | "historyClick"} metric
 *
 * @returns {Promise<Array<object>>} The recorded events
 */
async function waitForHistoryTelemetry(metric) {
  let events;
  await TestUtils.waitForCondition(() => {
    events = Glean.smartWindow[metric].testGetValue();
    return events?.length;
  }, `Wait for ${metric} telemetry event`);
  return events;
}

/**
 * Clicks the nth item in the ai-chat-grid items
 *
 * @param {MozBrowser} browser The browser containing the chat area, fullpage or
 *                     sidebar browsers
 * @param {number} [nth=0] Which item index to click
 *
 * @returns {Promise<boolean>} Indicates whether the item was clicked or not
 */
async function clickNthGridItem(browser, nth = 0) {
  const aiWindow = await TestUtils.waitForCondition(
    () => browser.contentDocument?.querySelector("ai-window"),
    "Wait for ai-window element"
  );

  const aiChatBrowser = await TestUtils.waitForCondition(
    () => aiWindow.shadowRoot?.querySelector("#aichat-browser"),
    "Wait for #aichat-browser element"
  );

  return SpecialPowers.spawn(aiChatBrowser, [nth], async nthEl => {
    const contentEl = await ContentTaskUtils.waitForCondition(
      () => content.document.querySelector("ai-chat-content"),
      "Wait for ai-chat-content element"
    );
    await contentEl.updateComplete;
    const messageEls = contentEl.shadowRoot.querySelectorAll("ai-chat-message");

    const messages = Array.from(messageEls);
    const el = messages.at(-1);

    await ContentTaskUtils.waitForMutationCondition(
      el,
      { childList: true, subtree: true },
      () => ContentTaskUtils.querySelectorDeep(content.document, "ai-chat-grid")
    ).catch(() => {});

    const aiChatGrid = ContentTaskUtils.querySelectorDeep(
      content.document,
      "ai-chat-grid"
    );

    const scrollArea = aiChatGrid.shadowRoot.querySelector(".scroll-area");
    const nthElement = scrollArea.children[nthEl];

    info(`nthElement: ${nthElement.outerHTML}`);

    if (nthElement) {
      nthElement.click();
      return true;
    }

    return false;
  });
}

/**
 * @typedef {{
 *   showGrid: boolean,
 *   showList: boolean
 * }} GridViewModeData
 */

/**
 * Gets view mode data for the ai-chat-grid
 *
 * @param {MozBrowser} browser The browser containing the chat area, fullpage or
 *                     sidebar browsers
 *
 * @returns {Promise<GridViewModeData>}
 */
async function getGridViewMode(browser) {
  const aiWindow = await TestUtils.waitForCondition(
    () => browser.contentDocument?.querySelector("ai-window"),
    "Wait for ai-window element"
  );

  const aiChatBrowser = await TestUtils.waitForCondition(
    () => aiWindow.shadowRoot?.querySelector("#aichat-browser"),
    "Wait for #aichat-browser element"
  );

  return SpecialPowers.spawn(aiChatBrowser, [], async () => {
    const contentEl = await ContentTaskUtils.waitForCondition(
      () => content.document.querySelector("ai-chat-content"),
      "Wait for ai-chat-content element"
    );
    await contentEl.updateComplete;
    const messageEls = contentEl.shadowRoot.querySelectorAll("ai-chat-message");

    const messages = Array.from(messageEls);
    const el = messages.at(-1);

    await ContentTaskUtils.waitForMutationCondition(
      el,
      { childList: true, subtree: true },
      () => ContentTaskUtils.querySelectorDeep(content.document, "ai-chat-grid")
    ).catch(() => {});

    const aiChatGrid = ContentTaskUtils.querySelectorDeep(
      content.document,
      "ai-chat-grid"
    );

    const showGrid = aiChatGrid.getAttribute("view") === "grid";
    const showList = aiChatGrid.getAttribute("view") === "list";

    return { showGrid, showList };
  });
}

/**
 * Toggles the ai-chat-grid mode
 *
 * @param {MozBrowser} browser
 * @param {boolean} showGrid
 * @param {boolean} showList
 *
 * @returns {Promise<boolean>} Whether the mode was toggled
 */
async function toggleGridViewMode(browser, showGrid, showList) {
  const aiWindow = await TestUtils.waitForCondition(
    () => browser.contentDocument?.querySelector("ai-window"),
    "Wait for ai-window element"
  );

  const aiChatBrowser = await TestUtils.waitForCondition(
    () => aiWindow.shadowRoot?.querySelector("#aichat-browser"),
    "Wait for #aichat-browser element"
  );

  return SpecialPowers.spawn(
    aiChatBrowser,
    [showGrid, showList],
    async (showingGrid, showingList) => {
      const contentEl = await ContentTaskUtils.waitForCondition(
        () => content.document.querySelector("ai-chat-content"),
        "Wait for ai-chat-content element"
      );
      await contentEl.updateComplete;
      const messageEls =
        contentEl.shadowRoot.querySelectorAll("ai-chat-message");

      const messages = Array.from(messageEls);
      const el = messages.at(-1);

      await ContentTaskUtils.waitForMutationCondition(
        el,
        { childList: true, subtree: true },
        () =>
          ContentTaskUtils.querySelectorDeep(content.document, "ai-chat-grid")
      ).catch(() => {});

      const aiChatGrid = ContentTaskUtils.querySelectorDeep(
        content.document,
        "ai-chat-grid"
      );

      let button;
      switch (true) {
        case showingGrid:
          button = ContentTaskUtils.querySelectorDeep(aiChatGrid, "#list");
          break;

        case showingList:
          button = ContentTaskUtils.querySelectorDeep(aiChatGrid, "#grid");
          break;

        default:
          return false;
      }

      button.click();

      return true;
    }
  );
}
