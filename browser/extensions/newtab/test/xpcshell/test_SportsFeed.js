/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  actionTypes: "resource://newtab/common/Actions.mjs",
  SearchUIUtils: "moz-src:///browser/components/search/SearchUIUtils.sys.mjs",
  SportsFeed: "resource://newtab/lib/Widgets/SportsFeed.sys.mjs",
  sinon: "resource://testing-common/Sinon.sys.mjs",
});

const PREF_SPORTS_ENABLED = "widgets.sportsWidget.enabled";
const PREF_SYSTEM_SPORTS_ENABLED = "widgets.system.sportsWidget.enabled";

// Stub SearchUIUtils.loadSearch so the openMatchSearch handler tests can
// observe what we asked it to do without requiring a real chrome window,
// browser, or search engine.
let gLoadSearchStub;

add_setup(async () => {
  const sandbox = sinon.createSandbox();
  gLoadSearchStub = sandbox.stub(SearchUIUtils, "loadSearch").resolves();
  registerCleanupFunction(() => sandbox.restore());
});

function makeFeed({ enabled = true, systemEnabled = true } = {}) {
  const feed = new SportsFeed();
  feed.store = {
    getState() {
      return this.state;
    },
    dispatch: sinon.spy(),
    state: {
      Prefs: {
        values: {
          [PREF_SPORTS_ENABLED]: enabled,
          [PREF_SYSTEM_SPORTS_ENABLED]: systemEnabled,
          "discoverystream.endpoints": "https://merino.services.mozilla.com/",
        },
      },
    },
  };
  return feed;
}

add_task(async function test_construction() {
  const feed = makeFeed();

  info("SportsFeed constructor should create initial values");
  Assert.ok(feed, "Could construct a SportsFeed");
  Assert.ok(!feed.initialized, "SportsFeed is not initialized");
});

add_task(async function test_enabled() {
  info(
    "SportsFeed.enabled returns true when both the user pref and the system pref are on"
  );
  Assert.ok(makeFeed({ enabled: true, systemEnabled: true }).enabled);

  info("SportsFeed.enabled returns false when the user pref is off");
  Assert.ok(!makeFeed({ enabled: false, systemEnabled: true }).enabled);

  info(
    "SportsFeed.enabled returns false when the system pref is off and no trainhop experiment is set"
  );
  Assert.ok(!makeFeed({ enabled: true, systemEnabled: false }).enabled);

  info(
    "SportsFeed.enabled returns true when the system pref is off but the trainhop experiment is set"
  );
  const trainhopFeed = makeFeed({ enabled: true, systemEnabled: false });
  trainhopFeed.store.state.Prefs.values.trainhopConfig = {
    sports: { enabled: true },
  };
  Assert.ok(trainhopFeed.enabled);
});

add_task(async function test_onAction_INIT_when_enabled() {
  const feed = makeFeed({ enabled: true });

  info("SportsFeed.onAction INIT should set initialized when enabled");
  await feed.onAction({ type: actionTypes.INIT });

  Assert.ok(feed.initialized, "feed.initialized should be true after INIT");
});

add_task(async function test_onAction_INIT_when_disabled() {
  const feed = makeFeed({ enabled: false });

  info("SportsFeed.onAction INIT should not initialize when disabled");
  await feed.onAction({ type: actionTypes.INIT });

  Assert.ok(!feed.initialized, "feed.initialized should remain false");
});

add_task(async function test_onAction_PREF_CHANGED_initializes() {
  const feed = makeFeed({ enabled: true });

  info("SportsFeed.onAction PREF_CHANGED should initialize when pref turns on");
  await feed.onAction({
    type: actionTypes.PREF_CHANGED,
    data: { name: PREF_SPORTS_ENABLED, value: true },
  });

  Assert.ok(
    feed.initialized,
    "feed.initialized should be true after pref enabled"
  );
});

add_task(
  async function test_onAction_PREF_CHANGED_initializes_on_system_pref() {
    const feed = makeFeed({ enabled: true, systemEnabled: false });
    Assert.ok(!feed.enabled, "feed starts disabled when system pref is off");

    feed.store.state.Prefs.values[PREF_SYSTEM_SPORTS_ENABLED] = true;

    info(
      "SportsFeed.onAction PREF_CHANGED should initialize when the system pref turns on"
    );
    await feed.onAction({
      type: actionTypes.PREF_CHANGED,
      data: { name: PREF_SYSTEM_SPORTS_ENABLED, value: true },
    });

    Assert.ok(
      feed.initialized,
      "feed.initialized should be true after system pref enabled"
    );
  }
);

add_task(async function test_onAction_PREF_CHANGED_initializes_on_trainhop() {
  const feed = makeFeed({ enabled: true, systemEnabled: false });
  Assert.ok(!feed.enabled, "feed starts disabled when system pref is off");

  feed.store.state.Prefs.values.trainhopConfig = {
    sports: { enabled: true },
  };

  info(
    "SportsFeed.onAction PREF_CHANGED should initialize when trainhopConfig turns the experiment on"
  );
  await feed.onAction({
    type: actionTypes.PREF_CHANGED,
    data: { name: "trainhopConfig", value: { sports: { enabled: true } } },
  });

  Assert.ok(
    feed.initialized,
    "feed.initialized should be true after trainhopConfig enabled"
  );
});

add_task(async function test_syncState_broadcasts_widgetState() {
  const feed = makeFeed();
  const getStub = sinon.stub(feed.cache, "get").resolves({
    widgetState: "sports-intro",
  });

  info("syncState should broadcast widgetState from cache to the UI");
  await feed.syncState();

  const [firstCall] = feed.store.dispatch.getCalls();
  Assert.equal(
    firstCall.args[0].type,
    actionTypes.WIDGETS_SPORTS_SET_WIDGET_STATE,
    "dispatches SET_WIDGET_STATE"
  );
  Assert.equal(firstCall.args[0].data, "sports-intro", "with correct state");

  getStub.restore();
});

add_task(async function test_syncState_broadcasts_selectedTeams() {
  const feed = makeFeed();
  const getStub = sinon.stub(feed.cache, "get").resolves({
    selectedTeams: ["CA", "AU"],
  });

  info("syncState should broadcast selectedTeams from cache to the UI");
  await feed.syncState();

  const [firstCall] = feed.store.dispatch.getCalls();
  Assert.equal(
    firstCall.args[0].type,
    actionTypes.WIDGETS_SPORTS_SET_SELECTED_TEAMS,
    "dispatches SET_SELECTED_TEAMS"
  );
  Assert.deepEqual(firstCall.args[0].data, ["CA", "AU"], "with correct teams");

  getStub.restore();
});

add_task(async function test_syncState_broadcasts_cached_teams_and_matches() {
  const feed = makeFeed();
  const cachedTeams = [{ id: "team1", name: "Team 1" }];
  const cachedMatches = {
    previous: [{ id: "match0", query: "team0 vs team1" }],
    current: [{ id: "match1", query: "team1 vs team2" }],
    next: [{ id: "match2", query: "team2 vs team3" }],
  };
  const cachedLive = [{ id: "live1", status_type: "live", query: "a vs b" }];
  const getStub = sinon.stub(feed.cache, "get").resolves({
    sportsData: {
      teams: cachedTeams,
      matches: cachedMatches,
      live: cachedLive,
    },
  });

  info("syncState should broadcast cached teams, matches, and live to the UI");
  await feed.syncState();

  const [firstCall] = feed.store.dispatch.getCalls();
  Assert.equal(
    firstCall.args[0].type,
    actionTypes.WIDGETS_SPORTS_WIDGET_SET,
    "dispatches WIDGETS_SPORTS_WIDGET_SET"
  );
  Assert.deepEqual(
    firstCall.args[0].data.teams,
    cachedTeams,
    "with correct cached teams"
  );
  Assert.deepEqual(
    firstCall.args[0].data.matches,
    cachedMatches,
    "passes cached matches through unchanged"
  );
  Assert.deepEqual(
    firstCall.args[0].data.live,
    cachedLive,
    "passes cached live array through unchanged"
  );

  getStub.restore();
});

add_task(async function test_syncState_dispatches_when_only_live_cached() {
  // A user could land in a state where /matches returned nothing but /live
  // did (e.g. between rounds). syncState should still hydrate the live data.
  const feed = makeFeed();
  const cachedLive = [{ id: "live1", status_type: "live", query: "a vs b" }];
  const getStub = sinon.stub(feed.cache, "get").resolves({
    sportsData: { live: cachedLive },
  });

  await feed.syncState();

  const [firstCall] = feed.store.dispatch.getCalls();
  Assert.equal(
    firstCall.args[0].type,
    actionTypes.WIDGETS_SPORTS_WIDGET_SET,
    "dispatches WIDGETS_SPORTS_WIDGET_SET even with only live cached"
  );
  Assert.deepEqual(
    firstCall.args[0].data.live,
    cachedLive,
    "broadcasts cached live array"
  );

  getStub.restore();
});

add_task(async function test_syncState_empty_cache() {
  const feed = makeFeed();
  const getStub = sinon.stub(feed.cache, "get").resolves({});

  info("syncState should not dispatch when cache is empty");
  await feed.syncState();

  Assert.equal(feed.store.dispatch.callCount, 0, "no dispatch on empty cache");

  getStub.restore();
});

add_task(async function test_CHANGE_WIDGET_STATE_saves_and_broadcasts() {
  const feed = makeFeed();
  const setStub = sinon.stub(feed.cache, "set").resolves();

  info("CHANGE_WIDGET_STATE should save to cache and broadcast to the UI");
  await feed.onAction({
    type: actionTypes.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
    data: "sports-intro",
  });

  Assert.ok(setStub.calledOnce, "cache.set called once");
  Assert.equal(setStub.firstCall.args[0], "widgetState");
  Assert.equal(setStub.firstCall.args[1], "sports-intro");

  const [firstDispatch] = feed.store.dispatch.getCalls();
  Assert.equal(
    firstDispatch.args[0].type,
    actionTypes.WIDGETS_SPORTS_SET_WIDGET_STATE,
    "dispatches SET_WIDGET_STATE"
  );
  Assert.equal(firstDispatch.args[0].data, "sports-intro");

  setStub.restore();
});

add_task(async function test_CHANGE_WIDGET_STATE_follow_state_skips_cache() {
  const feed = makeFeed();
  const setStub = sinon.stub(feed.cache, "set").resolves();

  info(
    "CHANGE_WIDGET_STATE with the follow state should skip saving but still broadcast"
  );
  await feed.onAction({
    type: actionTypes.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
    data: "sports-follow-state",
  });

  Assert.ok(
    setStub.notCalled,
    "cache.set should not be called for follow state"
  );

  const [firstDispatch] = feed.store.dispatch.getCalls();
  Assert.equal(
    firstDispatch.args[0].type,
    actionTypes.WIDGETS_SPORTS_SET_WIDGET_STATE,
    "still dispatches SET_WIDGET_STATE"
  );
  Assert.equal(firstDispatch.args[0].data, "sports-follow-state");

  setStub.restore();
});

add_task(async function test_CHANGE_SELECTED_TEAMS_saves_and_broadcasts() {
  const feed = makeFeed();
  const setStub = sinon.stub(feed.cache, "set").resolves();

  info("CHANGE_SELECTED_TEAMS should save to cache and broadcast to the UI");
  await feed.onAction({
    type: actionTypes.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
    data: ["CA", "AU"],
  });

  Assert.ok(setStub.calledOnce, "cache.set called once");
  Assert.equal(setStub.firstCall.args[0], "selectedTeams");
  Assert.deepEqual(setStub.firstCall.args[1], ["CA", "AU"]);

  const [firstDispatch] = feed.store.dispatch.getCalls();
  Assert.equal(
    firstDispatch.args[0].type,
    actionTypes.WIDGETS_SPORTS_SET_SELECTED_TEAMS,
    "dispatches SET_SELECTED_TEAMS"
  );
  Assert.deepEqual(firstDispatch.args[0].data, ["CA", "AU"]);

  setStub.restore();
});

add_task(async function test_fetchSportsData_dispatches_teams_and_matches() {
  const feed = makeFeed();
  const mockTeamsResponse = { teams: [{ id: "team1", name: "Team 1" }] };
  const mockMatches = {
    previous: [],
    current: [],
    next: [
      { id: "match1", teams: ["team1", "team2"], query: "team1 vs team2" },
    ],
  };
  const mockLive = {
    matches: [{ id: "live1", status_type: "live", query: "team3 vs team4" }],
  };

  sinon.stub(feed.merino, "fetchSportsTeams").resolves(mockTeamsResponse);
  sinon.stub(feed.merino, "fetchSportsMatches").resolves(mockMatches);
  sinon.stub(feed.merino, "fetchSportsLive").resolves(mockLive);

  feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/teams";
  feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/matches";
  feed.store.state.Prefs.values["sports.worldCup.liveEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/live";

  info(
    "fetchSportsData should dispatch WIDGETS_SPORTS_WIDGET_SET with teams, matches, and live"
  );
  await feed.fetchSportsData();

  Assert.ok(feed.store.dispatch.calledOnce, "dispatch called once");
  const [dispatchedAction] = feed.store.dispatch.firstCall.args;
  Assert.equal(
    dispatchedAction.type,
    actionTypes.WIDGETS_SPORTS_WIDGET_SET,
    "dispatches WIDGETS_SPORTS_WIDGET_SET"
  );
  Assert.deepEqual(
    dispatchedAction.data.teams,
    mockTeamsResponse.teams,
    "with correct teams"
  );
  Assert.deepEqual(
    dispatchedAction.data.matches,
    mockMatches,
    "matches are passed through unchanged"
  );
  Assert.deepEqual(
    dispatchedAction.data.live,
    mockLive.matches,
    "live matches surface as the `live` array on data"
  );
});

add_task(async function test_fetchSportsData_reads_endpoint_prefs() {
  const feed = makeFeed();
  const teamsEndpoint = "https://merino.services.mozilla.com/api/v1/wcs/teams";
  const matchesEndpoint =
    "https://merino.services.mozilla.com/api/v1/wcs/matches";
  const liveEndpoint = "https://merino.services.mozilla.com/api/v1/wcs/live";

  feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
    teamsEndpoint;
  feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
    matchesEndpoint;
  feed.store.state.Prefs.values["sports.worldCup.liveEndpoint"] = liveEndpoint;

  const teamsStub = sinon.stub(feed.merino, "fetchSportsTeams").resolves([]);
  const matchesStub = sinon
    .stub(feed.merino, "fetchSportsMatches")
    .resolves([]);
  const liveStub = sinon.stub(feed.merino, "fetchSportsLive").resolves(null);

  info("fetchSportsData should pass the endpoint prefs to the merino client");
  await feed.fetchSportsData();

  Assert.ok(
    teamsStub.calledWith({ source: "newtab", endpointUrl: teamsEndpoint }),
    "fetchSportsTeams called with correct endpoint"
  );
  Assert.ok(
    matchesStub.calledWith({
      source: "newtab",
      endpointUrl: matchesEndpoint,
    }),
    "fetchSportsMatches called with correct endpoint"
  );
  Assert.ok(
    liveStub.calledWith({ source: "newtab", endpointUrl: liveEndpoint }),
    "fetchSportsLive called with correct endpoint"
  );
});

add_task(
  async function test_fetchSportsData_prefers_trainhopConfig_endpoints() {
    const feed = makeFeed();
    const trainhopTeamsEndpoint = "https://trainhop.example.com/teams";
    const trainhopMatchesEndpoint = "https://trainhop.example.com/matches";
    const trainhopLiveEndpoint = "https://trainhop.example.com/live";

    feed.store.state.Prefs.values["discoverystream.endpoints"] =
      "https://merino.services.mozilla.com/,https://trainhop.example.com/";
    feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
      "https://pref.example.com/teams";
    feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
      "https://pref.example.com/matches";
    feed.store.state.Prefs.values["sports.worldCup.liveEndpoint"] =
      "https://pref.example.com/live";
    feed.store.state.Prefs.values.trainhopConfig = {
      sports: {
        teamsEndpoint: trainhopTeamsEndpoint,
        matchesEndpoint: trainhopMatchesEndpoint,
        liveEndpoint: trainhopLiveEndpoint,
      },
    };

    const teamsStub = sinon.stub(feed.merino, "fetchSportsTeams").resolves([]);
    const matchesStub = sinon
      .stub(feed.merino, "fetchSportsMatches")
      .resolves([]);
    const liveStub = sinon.stub(feed.merino, "fetchSportsLive").resolves(null);

    info(
      "fetchSportsData should prefer trainhopConfig endpoints over pref endpoints"
    );
    await feed.fetchSportsData();

    Assert.ok(
      teamsStub.calledWith({
        source: "newtab",
        endpointUrl: trainhopTeamsEndpoint,
      }),
      "fetchSportsTeams called with trainhopConfig endpoint"
    );
    Assert.ok(
      matchesStub.calledWith({
        source: "newtab",
        endpointUrl: trainhopMatchesEndpoint,
      }),
      "fetchSportsMatches called with trainhopConfig endpoint"
    );
    Assert.ok(
      liveStub.calledWith({
        source: "newtab",
        endpointUrl: trainhopLiveEndpoint,
      }),
      "fetchSportsLive called with trainhopConfig endpoint"
    );
  }
);

add_task(async function test_fetchSportsData_handles_null_responses() {
  const feed = makeFeed();

  sinon.stub(feed.merino, "fetchSportsTeams").resolves(null);
  sinon.stub(feed.merino, "fetchSportsMatches").resolves(null);
  sinon.stub(feed.merino, "fetchSportsLive").resolves(null);

  info(
    "fetchSportsData should dispatch empty fallbacks when endpoints return null"
  );
  await feed.fetchSportsData();

  const [dispatchedAction] = feed.store.dispatch.firstCall.args;
  Assert.deepEqual(
    dispatchedAction.data.teams,
    [],
    "teams falls back to empty array"
  );
  Assert.deepEqual(
    dispatchedAction.data.matches,
    { previous: [], current: [], next: [] },
    "matches falls back to an object with empty previous/current/next arrays"
  );
  Assert.deepEqual(
    dispatchedAction.data.live,
    [],
    "live falls back to an empty array"
  );
});

add_task(async function test_fetchSportsData_live_non_array_matches() {
  // Defensive: if the /live response is malformed (e.g. `matches` is missing
  // or not an array), the feed should fall back to an empty live array
  // instead of letting the UI try to iterate a non-iterable.
  const feed = makeFeed();

  sinon.stub(feed.merino, "fetchSportsTeams").resolves(null);
  sinon.stub(feed.merino, "fetchSportsMatches").resolves(null);
  sinon
    .stub(feed.merino, "fetchSportsLive")
    .resolves({ matches: "not-an-array" });

  await feed.fetchSportsData();

  const [dispatchedAction] = feed.store.dispatch.firstCall.args;
  Assert.deepEqual(
    dispatchedAction.data.live,
    [],
    "live falls back to [] when /live.matches isn't an array"
  );
});

add_task(async function test_fetchSportsData_blocks_disallowed_live_endpoint() {
  // The live endpoint must be in the discoverystream allowlist just like
  // teams/matches; otherwise the feed should bail out without dispatching.
  const feed = makeFeed();
  feed.store.state.Prefs.values["discoverystream.endpoints"] =
    "https://merino.services.mozilla.com/";
  feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/teams";
  feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/matches";
  feed.store.state.Prefs.values["sports.worldCup.liveEndpoint"] =
    "https://evil.example.com/live";

  const teamsStub = sinon.stub(feed.merino, "fetchSportsTeams").resolves([]);
  const matchesStub = sinon
    .stub(feed.merino, "fetchSportsMatches")
    .resolves([]);
  const liveStub = sinon.stub(feed.merino, "fetchSportsLive").resolves(null);

  await feed.fetchSportsData();

  Assert.ok(
    teamsStub.notCalled,
    "fetchSportsTeams not called when live endpoint is disallowed"
  );
  Assert.ok(
    matchesStub.notCalled,
    "fetchSportsMatches not called when live endpoint is disallowed"
  );
  Assert.ok(
    liveStub.notCalled,
    "fetchSportsLive not called when live endpoint is disallowed"
  );
  Assert.ok(
    feed.store.dispatch.notCalled,
    "no dispatch when live endpoint is disallowed"
  );
});

add_task(async function test_fetchSportsData_caches_teams_and_matches() {
  const feed = makeFeed();
  const mockTeamsResponse = { teams: [{ id: "team1", name: "Team 1" }] };
  const mockMatches = {
    previous: [],
    current: [],
    next: [{ id: "match1", query: "a vs b" }],
  };
  const mockLive = {
    matches: [{ id: "live1", status_type: "live", query: "x vs y" }],
  };

  sinon.stub(feed.merino, "fetchSportsTeams").resolves(mockTeamsResponse);
  sinon.stub(feed.merino, "fetchSportsMatches").resolves(mockMatches);
  sinon.stub(feed.merino, "fetchSportsLive").resolves(mockLive);

  feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/teams";
  feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/matches";
  feed.store.state.Prefs.values["sports.worldCup.liveEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/live";

  const setStub = sinon.stub(feed.cache, "set").resolves();

  info(
    "fetchSportsData should save fetched teams, matches, and live games to cache"
  );
  await feed.fetchSportsData();

  Assert.ok(
    setStub.calledWith("sportsData", {
      teams: mockTeamsResponse.teams,
      matches: mockMatches,
      live: mockLive.matches,
    }),
    "caches teams, matches, and live together under sportsData key"
  );

  setStub.restore();
});

add_task(async function test_fetchSportsData_blocks_disallowed_endpoints() {
  const feed = makeFeed();
  feed.store.state.Prefs.values["discoverystream.endpoints"] =
    "https://allowed.example.com/";
  feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/teams";
  feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/matches";

  const teamsStub = sinon.stub(feed.merino, "fetchSportsTeams").resolves([]);
  const matchesStub = sinon
    .stub(feed.merino, "fetchSportsMatches")
    .resolves([]);

  info(
    "fetchSportsData should not fetch or dispatch when endpoints are not in the allowlist"
  );
  await feed.fetchSportsData();

  Assert.ok(teamsStub.notCalled, "fetchSportsTeams should not be called");
  Assert.ok(matchesStub.notCalled, "fetchSportsMatches should not be called");
  Assert.ok(
    feed.store.dispatch.notCalled,
    "dispatch should not be called for disallowed endpoints"
  );
});

add_task(async function test_init_calls_syncState_and_fetchSportsData() {
  const feed = makeFeed();
  sinon.stub(feed.cache, "get").resolves({});
  sinon.stub(feed.merino, "fetchSportsTeams").resolves([]);
  sinon.stub(feed.merino, "fetchSportsMatches").resolves([]);

  const syncStateSpy = sinon.spy(feed, "syncState");
  const fetchSportsDataSpy = sinon.spy(feed, "fetchSportsData");

  info("init() should call both syncState and fetchSportsData");
  await feed.init();

  Assert.ok(syncStateSpy.calledOnce, "syncState was called");
  Assert.ok(fetchSportsDataSpy.calledOnce, "fetchSportsData was called");
});
add_task(async function test_syncState_broadcasts_matchesTab() {
  const feed = makeFeed();
  const getStub = sinon.stub(feed.cache, "get").resolves({
    matchesTab: "results",
  });

  info("syncState should broadcast matchesTab from cache to the UI");
  await feed.syncState();

  const [firstCall] = feed.store.dispatch.getCalls();
  Assert.equal(
    firstCall.args[0].type,
    actionTypes.WIDGETS_SPORTS_SET_MATCHES_TAB,
    "dispatches SET_MATCHES_TAB"
  );
  Assert.equal(firstCall.args[0].data, "results", "with correct tab");

  getStub.restore();
});

add_task(async function test_CHANGE_MATCHES_TAB_saves_and_broadcasts() {
  const feed = makeFeed();
  const setStub = sinon.stub(feed.cache, "set").resolves();

  info("CHANGE_MATCHES_TAB should save to cache and broadcast to the UI");
  await feed.onAction({
    type: actionTypes.WIDGETS_SPORTS_CHANGE_MATCHES_TAB,
    data: "results",
  });

  Assert.ok(setStub.calledOnce, "cache.set called once");
  Assert.equal(setStub.firstCall.args[0], "matchesTab");
  Assert.equal(setStub.firstCall.args[1], "results");

  const [firstDispatch] = feed.store.dispatch.getCalls();
  Assert.equal(
    firstDispatch.args[0].type,
    actionTypes.WIDGETS_SPORTS_SET_MATCHES_TAB,
    "dispatches SET_MATCHES_TAB"
  );
  Assert.equal(firstDispatch.args[0].data, "results");

  setStub.restore();
});

add_task(async function test_OPEN_MATCH_SEARCH_calls_loadSearch() {
  const feed = makeFeed();
  gLoadSearchStub.resetHistory();
  // Fake window object — only needs to be non-null; SearchUIUtils.loadSearch
  // is stubbed, so it never reads window properties.
  const fakeWindow = {};

  info(
    "OPEN_MATCH_SEARCH should call SearchUIUtils.loadSearch with the query, " +
      "the source window, and the about_newtab SAP source"
  );
  await feed.onAction({
    type: actionTypes.WIDGETS_SPORTS_OPEN_MATCH_SEARCH,
    data: {
      query: "Brazil vs Argentina",
      eventInfo: { button: 0, shiftKey: false, ctrlKey: false, metaKey: false },
    },
    _target: { window: fakeWindow },
  });

  Assert.ok(gLoadSearchStub.calledOnce, "SearchUIUtils.loadSearch called once");
  const [args] = gLoadSearchStub.firstCall.args;
  Assert.equal(args.window, fakeWindow, "window propagated from action target");
  Assert.equal(
    args.searchText,
    "Brazil vs Argentina",
    "searchText comes from the match's query field"
  );
  Assert.equal(
    args.sapSource,
    "about_newtab",
    "sapSource is about_newtab so telemetry attributes the search to newtab"
  );
  Assert.equal(
    args.where,
    "current",
    "plain left-click (no modifiers) opens the SERP in the current tab"
  );
  Assert.ok(
    args.triggeringPrincipal,
    "triggeringPrincipal is set so loadSearch doesn't throw"
  );
});

add_task(async function test_OPEN_MATCH_SEARCH_translates_modifier_clicks() {
  const feed = makeFeed();
  const fakeWindow = {};

  info(
    "OPEN_MATCH_SEARCH should pass the click's modifier/button state through " +
      "BrowserUtils.whereToOpenLink to pick a new-tab destination"
  );
  gLoadSearchStub.resetHistory();
  await feed.onAction({
    type: actionTypes.WIDGETS_SPORTS_OPEN_MATCH_SEARCH,
    data: {
      query: "Brazil vs Argentina",
      // Middle-click. whereToOpenLink reads `button === 1` and returns "tab".
      eventInfo: { button: 1, shiftKey: false, ctrlKey: false, metaKey: false },
    },
    _target: { window: fakeWindow },
  });
  Assert.equal(
    gLoadSearchStub.lastCall.args[0].where,
    "tab",
    "middle-click opens in a new tab"
  );

  gLoadSearchStub.resetHistory();
  // Shift-click (no meta/ctrl). On both Mac and non-Mac, this is "new window".
  await feed.onAction({
    type: actionTypes.WIDGETS_SPORTS_OPEN_MATCH_SEARCH,
    data: {
      query: "Brazil vs Argentina",
      eventInfo: { button: 0, shiftKey: true, ctrlKey: false, metaKey: false },
    },
    _target: { window: fakeWindow },
  });
  Assert.equal(
    gLoadSearchStub.lastCall.args[0].where,
    "window",
    "shift-click opens in a new window"
  );
});

add_task(async function test_OPEN_MATCH_SEARCH_ignores_missing_query() {
  const feed = makeFeed();
  gLoadSearchStub.resetHistory();

  info("OPEN_MATCH_SEARCH should be a no-op if the match somehow has no query");
  await feed.onAction({
    type: actionTypes.WIDGETS_SPORTS_OPEN_MATCH_SEARCH,
    data: { query: "", eventInfo: { button: 0 } },
    _target: { window: {} },
  });

  Assert.ok(
    gLoadSearchStub.notCalled,
    "loadSearch is not called when there's no query"
  );
});

add_task(async function test_OPEN_MATCH_SEARCH_ignores_missing_target_window() {
  const feed = makeFeed();
  gLoadSearchStub.resetHistory();

  info(
    "OPEN_MATCH_SEARCH should bail out if the action wasn't routed with a " +
      "_target.window — we can't call loadSearch without it"
  );
  await feed.onAction({
    type: actionTypes.WIDGETS_SPORTS_OPEN_MATCH_SEARCH,
    data: { query: "Brazil vs Argentina", eventInfo: { button: 0 } },
  });

  Assert.ok(
    gLoadSearchStub.notCalled,
    "loadSearch is not called without a target window"
  );
});

add_task(async function test_syncState_broadcasts_followedOnly() {
  const feed = makeFeed();
  const getStub = sinon.stub(feed.cache, "get").resolves({
    followedOnly: { results: false, upcoming: true },
  });

  info("syncState should broadcast followedOnly from cache to the UI");
  await feed.syncState();

  const [firstCall] = feed.store.dispatch.getCalls();
  Assert.equal(
    firstCall.args[0].type,
    actionTypes.WIDGETS_SPORTS_SET_FOLLOWED_ONLY,
    "dispatches SET_FOLLOWED_ONLY"
  );
  Assert.deepEqual(
    firstCall.args[0].data,
    { results: false, upcoming: true },
    "with the cached per-tab map"
  );

  getStub.restore();
});

add_task(async function test_CHANGE_FOLLOWED_ONLY_merges_and_broadcasts() {
  // Each tab persists its own pref, but the cache stores a single map
  // {results, upcoming}. The handler must merge a partial change into any
  // pre-existing entry so the other tab's pref isn't lost.
  const feed = makeFeed();
  const getStub = sinon.stub(feed.cache, "get").resolves({
    followedOnly: { results: true, upcoming: true },
  });
  const setStub = sinon.stub(feed.cache, "set").resolves();

  info(
    "CHANGE_FOLLOWED_ONLY should merge the partial update into the cached map and broadcast only the partial update"
  );
  await feed.onAction({
    type: actionTypes.WIDGETS_SPORTS_CHANGE_FOLLOWED_ONLY,
    data: { upcoming: false },
  });

  Assert.ok(setStub.calledOnce, "cache.set called once");
  Assert.equal(setStub.firstCall.args[0], "followedOnly");
  Assert.deepEqual(
    setStub.firstCall.args[1],
    { results: true, upcoming: false },
    "cache.set persists the merged map"
  );

  const [firstDispatch] = feed.store.dispatch.getCalls();
  Assert.equal(
    firstDispatch.args[0].type,
    actionTypes.WIDGETS_SPORTS_SET_FOLLOWED_ONLY,
    "dispatches SET_FOLLOWED_ONLY"
  );
  Assert.deepEqual(
    firstDispatch.args[0].data,
    { upcoming: false },
    "broadcasts only the partial update so the reducer can merge"
  );

  getStub.restore();
  setStub.restore();
});

add_task(async function test_CHANGE_FOLLOWED_ONLY_starts_empty_cache() {
  // First-time toggle: cache.get may return undefined or an object with no
  // followedOnly entry. The handler must still write a complete partial.
  const feed = makeFeed();
  const getStub = sinon.stub(feed.cache, "get").resolves(undefined);
  const setStub = sinon.stub(feed.cache, "set").resolves();

  await feed.onAction({
    type: actionTypes.WIDGETS_SPORTS_CHANGE_FOLLOWED_ONLY,
    data: { results: false },
  });

  Assert.ok(setStub.calledOnce, "cache.set called once");
  Assert.deepEqual(
    setStub.firstCall.args[1],
    { results: false },
    "cache.set writes the partial as the new map when nothing was cached"
  );

  getStub.restore();
  setStub.restore();
});
