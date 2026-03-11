/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

do_get_profile();

const {
  TOOLS,
  toolsConfig,
  RunSearch,
  RUN_SEARCH_VERBATIM_QUERY_DESCRIPTION,
  RUN_SEARCH_GENERATED_QUERY_DESCRIPION,
} = ChromeUtils.importESModule(
  "moz-src:///browser/components/aiwindow/models/Tools.sys.mjs"
);

const { Chat } = ChromeUtils.importESModule(
  "moz-src:///browser/components/aiwindow/models/Chat.sys.mjs"
);

add_task(async function test_run_search_registered_in_toolMap() {
  Assert.strictEqual(
    typeof Chat.toolMap.run_search,
    "function",
    "run_search should be registered in Chat.toolMap"
  );
});

add_task(async function test_run_search_in_TOOLS_array() {
  Assert.ok(
    TOOLS.includes("run_search"),
    "run_search should be in the TOOLS array"
  );
});

add_task(async function test_run_search_tool_config_exists() {
  // Check 1st turn config
  const firstTurnConfig = toolsConfig.find(
    t => t.function?.name === "run_search"
  );
  Assert.ok(
    firstTurnConfig,
    "First turn run_search tool config should exist in toolsConfig"
  );
  Assert.equal(
    firstTurnConfig.type,
    "function",
    "First turn tool type should be 'function'"
  );
  Assert.equal(
    firstTurnConfig.function.description,
    RUN_SEARCH_VERBATIM_QUERY_DESCRIPTION,
    "First turn tool description should be the one for verbatim search queries"
  );
  const firstTurnParams = firstTurnConfig.function.parameters;
  Assert.deepEqual(
    firstTurnParams.properties,
    {},
    "First turn parameters should be an empty object"
  );

  // Check subsequent turn config
  const swappedToolsConfig = RunSearch.setGeneratedSearchQueryDescription(
    structuredClone(toolsConfig)
  );
  const subsequentTurnConfig = swappedToolsConfig.find(
    t => t.function?.name === "run_search"
  );
  Assert.ok(
    subsequentTurnConfig,
    "Subsequent turn run_search tool config should exist in toolsConfig"
  );
  Assert.equal(
    subsequentTurnConfig.type,
    "function",
    "Subsequent turn tool type should be 'function'"
  );
  Assert.equal(
    subsequentTurnConfig.function.description,
    RUN_SEARCH_GENERATED_QUERY_DESCRIPION,
    "Subsequent turn tool description should be the one for generated search queries."
  );
  const subsequentTurnParams = subsequentTurnConfig.function.parameters;
  Assert.ok(
    subsequentTurnParams.properties.query,
    "Should have a query parameter"
  );
  Assert.equal(
    subsequentTurnParams.properties.query.type,
    "string",
    "query should be a string"
  );
  Assert.ok(
    subsequentTurnParams.required.includes("query"),
    "query should be required"
  );
});

add_task(async function test_run_search_empty_query_returns_error() {
  const result = await RunSearch.runSearch({ query: "" });
  Assert.ok(
    result.includes("Error"),
    "Empty query should return an error string"
  );
});

add_task(async function test_run_search_null_query_returns_error() {
  const result = await RunSearch.runSearch({ query: null });
  Assert.ok(
    result.includes("Error"),
    "Null query should return an error string"
  );
});

add_task(async function test_run_search_whitespace_query_returns_error() {
  const result = await RunSearch.runSearch({ query: "   " });
  Assert.ok(
    result.includes("Error"),
    "Whitespace-only query should return an error string"
  );
});

add_task(async function test_run_search_no_browsingContext_returns_error() {
  const result = await RunSearch.runSearch({ query: "test query" });
  Assert.ok(
    result.includes("Error"),
    "No browsingContext should return an error string"
  );
  Assert.ok(
    result.includes("no browsingContext provided"),
    "Error should mention no browsingContext provided"
  );
});

add_task(async function test_run_search_closed_window_returns_error() {
  const result = await RunSearch.runSearch(
    { query: "test query" },
    { browsingContext: { topChromeWindow: { closed: true } } }
  );
  Assert.ok(
    result.includes("Error"),
    "Closed window should return an error string"
  );
  Assert.ok(
    result.includes("not available or closed"),
    "Error should mention window not available or closed"
  );
});

add_task(
  async function test_run_search_uses_context_browsingContext_when_provided() {
    const result = await RunSearch.runSearch(
      { query: "test query" },
      { browsingContext: { topChromeWindow: { closed: true } } }
    );
    Assert.ok(
      result.includes("Error"),
      "Closed window from browsingContext should return an error string"
    );
  }
);
