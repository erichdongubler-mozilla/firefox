/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

/*
 * Tests for SERPTelemetryActorHelper.extractMatchPatterns.
 */

ChromeUtils.defineESModuleGetters(this, {
  HOST_PLACEHOLDER:
    "moz-src:///browser/components/search/SearchSERPTelemetry.sys.mjs",
  SERPTelemetryActorHelper:
    "moz-src:///browser/components/search/SearchSERPTelemetry.sys.mjs",
});

// The number of Google domains in SearchStaticData. Update this if
// SearchStaticData's Google domain list is updated.
const GOOGLE_DOMAIN_COUNT = 187;

const helper = new SERPTelemetryActorHelper();

add_task(async function test_empty_provider_info() {
  let patterns = helper.extractMatchPatterns([]);
  Assert.deepEqual(patterns, [], "Empty provider info yields no patterns.");
});

add_task(async function test_provider_without_searchPageMatches() {
  let patterns = helper.extractMatchPatterns([
    {
      telemetryId: "example",
      searchPageRegexp: /^https:\/\/example\.org/,
    },
  ]);
  Assert.deepEqual(
    patterns,
    [],
    "Provider without searchPageMatches yields no patterns."
  );
});

add_task(async function test_simple_match_patterns() {
  let patterns = helper.extractMatchPatterns([
    {
      telemetryId: "bing",
      searchPageRegexp: /^https:\/\/www\.bing\.com\/search/,
      searchPageMatches: ["https://www.bing.com/search*"],
    },
  ]);
  Assert.deepEqual(
    patterns,
    ["https://www.bing.com/search*"],
    "Simple match pattern is returned as-is."
  );
});

add_task(async function test_multiple_simple_providers() {
  let patterns = helper.extractMatchPatterns([
    {
      telemetryId: "bing",
      searchPageRegexp: /^https:\/\/www\.bing\.com\/search/,
      searchPageMatches: ["https://www.bing.com/search*"],
    },
    {
      telemetryId: "duckduckgo",
      searchPageRegexp: /^https:\/\/duckduckgo\.com/,
      searchPageMatches: ["https://duckduckgo.com/*"],
    },
  ]);
  Assert.deepEqual(
    patterns,
    ["https://www.bing.com/search*", "https://duckduckgo.com/*"],
    "Multiple simple providers yield all their patterns."
  );
});

add_task(async function test_host_placeholder_expansion() {
  let patterns = helper.extractMatchPatterns([
    {
      telemetryId: "google",
      searchPageRegexp: /^https:\/\/www\.google\./,
      searchPageMatches: [`https://${HOST_PLACEHOLDER}/search*`],
    },
  ]);
  Assert.equal(
    patterns.length,
    GOOGLE_DOMAIN_COUNT,
    `Google's {host} placeholder should expand to ${GOOGLE_DOMAIN_COUNT} patterns.`
  );
  Assert.ok(
    patterns.includes("https://www.google.com/search*"),
    "Expanded patterns should include www.google.com."
  );
  Assert.ok(
    patterns.includes("https://www.google.co.uk/search*"),
    "Expanded patterns should include www.google.co.uk."
  );
});

add_task(
  async function test_unknown_provider_host_placeholder_yields_nothing() {
    let patterns = helper.extractMatchPatterns([
      {
        telemetryId: "unknown-provider",
        searchPageRegexp: /^https:\/\/example\.org/,
        searchPageMatches: [`https://${HOST_PLACEHOLDER}/search*`],
      },
    ]);
    Assert.deepEqual(
      patterns,
      [],
      "Unknown provider with {host} placeholder yields no patterns."
    );
  }
);
