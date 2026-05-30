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

// When a caller already has a fresh /live payload (post-match resync from
// fetchAndDispatch), passing { live } reuses it and skips the second /live
// fetch (and the live-endpoint allowlist check that gates it).
add_task(
  async function test_fetchSportsData_skips_live_fetch_with_prefetched() {
    const feed = makeFeed();
    feed.store.state.Prefs.values["discoverystream.endpoints"] =
      "https://merino.services.mozilla.com/";
    feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
      "https://merino.services.mozilla.com/api/v1/wcs/teams";
    feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
      "https://merino.services.mozilla.com/api/v1/wcs/matches";
    // Disallowed live endpoint — would normally cause a bail-out, but the
    // prefetched payload bypasses the allowlist check.
    feed.store.state.Prefs.values["sports.worldCup.liveEndpoint"] =
      "https://evil.example.com/live";

    const teamsStub = sinon
      .stub(feed.merino, "fetchSportsTeams")
      .resolves({ teams: [] });
    const matchesStub = sinon.stub(feed.merino, "fetchSportsMatches").resolves({
      previous: [],
      current: [],
      next: [],
    });
    const liveStub = sinon.stub(feed.merino, "fetchSportsLive");

    const prefetched = { matches: [{ global_event_id: 1 }] };
    await feed.fetchSportsData({ live: prefetched });

    Assert.ok(teamsStub.calledOnce, "teams still fetched");
    Assert.ok(matchesStub.calledOnce, "matches still fetched");
    Assert.ok(
      liveStub.notCalled,
      "fetchSportsLive skipped when live prefetched"
    );

    const dispatched = feed.store.dispatch
      .getCalls()
      .map(c => c.args[0])
      .find(a => a.type === actionTypes.WIDGETS_SPORTS_WIDGET_SET);
    Assert.ok(dispatched, "WIDGETS_SPORTS_WIDGET_SET dispatched");
    Assert.deepEqual(
      dispatched.data.live,
      prefetched.matches,
      "prefetched live payload was dispatched"
    );
  }
);

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
  sinon.stub(feed.merino, "fetchSportsLive").resolves(null);

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

// =============================================================================
// Adaptive live-polling
// =============================================================================

const PREF_SPORTS_LIVE_ENABLED = "widgets.sportsWidget.live.enabled";
const PREF_SPORTS_LIVE_ENDPOINT = "sports.worldCup.liveEndpoint";
const PREF_POLL_LIVE_MS = "widgets.sportsWidget.pollLiveMs";
const PREF_POLL_PREGAME_LEAD_MS = "widgets.sportsWidget.pollPregameLeadMs";

const LIVE_ENDPOINT = "https://merino.services.mozilla.com/api/v1/wcs/live";

// Stub setTimeout/clearTimeout on a feed so timers never actually fire and we
// can inspect what would have been scheduled. Returns the stubs for assertions.
function stubTimers(feed) {
  const setTimeoutStub = sinon.stub(feed, "setTimeout").returns(123);
  const clearTimeoutStub = sinon.stub(feed, "clearTimeout");
  return { setTimeoutStub, clearTimeoutStub };
}

function makeLiveFeed({ liveEnabled = true, openTab = true } = {}) {
  const feed = makeFeed();
  feed.store.state.Prefs.values[PREF_SPORTS_LIVE_ENABLED] = liveEnabled;
  feed.store.state.Prefs.values[PREF_SPORTS_LIVE_ENDPOINT] = LIVE_ENDPOINT;
  feed.store.state.SportsWidget = {
    data: { matches: { previous: [], current: [], next: [] } },
  };
  // Wire the selector so updatePollingStateFromMatches can read live data.
  feed.store.getState = function () {
    return this.state;
  };
  if (openTab) {
    feed.openTabCount = 1;
  }
  return feed;
}

add_task(async function test_liveEnabled_requires_widget_and_live_pref() {
  info("liveEnabled is true with both widget and live prefs on");
  const onFeed = makeLiveFeed();
  Assert.ok(onFeed.liveEnabled, "liveEnabled true when both prefs on");

  info(
    "liveEnabled is false when the widget is disabled, regardless of live pref"
  );
  const widgetOffFeed = makeLiveFeed();
  widgetOffFeed.store.state.Prefs.values[PREF_SPORTS_ENABLED] = false;
  Assert.ok(!widgetOffFeed.liveEnabled);

  info("liveEnabled is false when live pref is off and no trainhopConfig");
  const liveOffFeed = makeLiveFeed({ liveEnabled: false });
  Assert.ok(!liveOffFeed.liveEnabled);

  info("liveEnabled is true via trainhopConfig.sports.liveEnabled");
  const trainhopFeed = makeLiveFeed({ liveEnabled: false });
  trainhopFeed.store.state.Prefs.values.trainhopConfig = {
    sports: { liveEnabled: true },
  };
  Assert.ok(trainhopFeed.liveEnabled);
});

add_task(async function test_resolvePollIntervalMs_per_state_and_trainhop() {
  const feed = makeLiveFeed();

  info("Defaults: IDLE = 6h, MATCH_DAY = 30min, LIVE = 60s");
  feed.pollingState = "IDLE";
  Assert.equal(feed.resolvePollIntervalMs(), 21600000);
  feed.pollingState = "MATCH_DAY";
  Assert.equal(feed.resolvePollIntervalMs(), 1800000);
  feed.pollingState = "LIVE";
  Assert.equal(feed.resolvePollIntervalMs(), 60000);

  info("Raw prefs override defaults");
  feed.store.state.Prefs.values[PREF_POLL_LIVE_MS] = 45000;
  Assert.equal(feed.resolvePollIntervalMs(), 45000);

  info("trainhopConfig overrides raw prefs");
  feed.store.state.Prefs.values.trainhopConfig = {
    sports: { pollLiveMs: 30000 },
  };
  Assert.equal(feed.resolvePollIntervalMs(), 30000);

  info("resolvePregameLeadMs follows the same precedence");
  feed.store.state.Prefs.values[PREF_POLL_PREGAME_LEAD_MS] = 700000;
  Assert.equal(feed.resolvePregameLeadMs(), 700000);
  feed.store.state.Prefs.values.trainhopConfig.sports.pollPregameLeadMs = 120000;
  Assert.equal(feed.resolvePregameLeadMs(), 120000);
});

add_task(async function test_fetchLive_returns_null_without_endpoint() {
  const feed = makeLiveFeed();
  feed.store.state.Prefs.values[PREF_SPORTS_LIVE_ENDPOINT] = "";
  const stub = sinon.stub(feed.merino, "fetchSportsLive").resolves({});

  info(
    "fetchLive returns null and does not call the shim when no endpoint is set"
  );
  const result = await feed.fetchLive();
  Assert.equal(result, null);
  Assert.ok(stub.notCalled);

  stub.restore();
});

add_task(async function test_fetchLive_blocks_disallowed_endpoint() {
  const feed = makeLiveFeed();
  feed.store.state.Prefs.values["discoverystream.endpoints"] =
    "https://allowed.example.com/";
  const stub = sinon.stub(feed.merino, "fetchSportsLive").resolves({});

  info("fetchLive bails when liveEndpoint is not in the allowlist");
  const result = await feed.fetchLive();
  Assert.equal(result, null);
  Assert.ok(stub.notCalled);

  stub.restore();
});

add_task(async function test_fetchLive_calls_shim_with_endpoint() {
  const feed = makeLiveFeed();
  const stub = sinon
    .stub(feed.merino, "fetchSportsLive")
    .resolves({ current: [] });

  await feed.fetchLive();

  Assert.ok(
    stub.calledWith({ source: "newtab", endpointUrl: LIVE_ENDPOINT }),
    "shim called with correct endpoint"
  );

  stub.restore();
});

add_task(async function test_updatePollingStateFromMatches() {
  const feed = makeLiveFeed();
  const now = Date.now();

  info("Live event in data.live → LIVE");
  feed.store.state.SportsWidget.data.live = [{ global_event_id: 1 }];
  feed.store.state.SportsWidget.data.matches = {
    previous: [],
    current: [],
    next: [],
  };
  feed.updatePollingStateFromMatches();
  Assert.equal(feed.pollingState, "LIVE");

  info("Next kickoff within pregame lead → LIVE");
  feed.store.state.SportsWidget.data.live = [];
  feed.store.state.SportsWidget.data.matches = {
    previous: [],
    current: [],
    next: [
      {
        status_type: "scheduled",
        date: new Date(now + 5 * 60 * 1000).toISOString(),
      },
    ],
  };
  feed.updatePollingStateFromMatches();
  Assert.equal(feed.pollingState, "LIVE");

  info("Next kickoff within 24h but outside pregame → MATCH_DAY");
  feed.store.state.SportsWidget.data.live = [];
  feed.store.state.SportsWidget.data.matches = {
    previous: [],
    current: [],
    next: [
      {
        status_type: "scheduled",
        date: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      },
    ],
  };
  feed.updatePollingStateFromMatches();
  Assert.equal(feed.pollingState, "MATCH_DAY");

  info("No live and next kickoff far away → IDLE");
  feed.store.state.SportsWidget.data.live = [];
  feed.store.state.SportsWidget.data.matches = {
    previous: [],
    current: [],
    next: [
      {
        status_type: "scheduled",
        date: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  };
  feed.updatePollingStateFromMatches();
  Assert.equal(feed.pollingState, "IDLE");

  info("No matches at all → IDLE");
  feed.store.state.SportsWidget.data.live = [];
  feed.store.state.SportsWidget.data.matches = null;
  feed.updatePollingStateFromMatches();
  Assert.equal(feed.pollingState, "IDLE");
});

add_task(
  async function test_fetchAndDispatch_live_dispatches_and_resets_retry() {
    const feed = makeLiveFeed();
    feed.pollingState = "LIVE";
    feed.retryCount = 3;
    const liveResponse = {
      matches: [{ status_type: "live", global_event_id: 42 }],
    };
    sinon.stub(feed.merino, "fetchSportsLive").resolves(liveResponse);

    const ok = await feed.fetchAndDispatch();

    Assert.ok(ok, "fetchAndDispatch returned true");
    const dispatchedAction = feed.store.dispatch
      .getCalls()
      .map(c => c.args[0])
      .find(a => a.type === actionTypes.WIDGETS_SPORTS_LIVE_UPDATE);
    Assert.ok(dispatchedAction, "WIDGETS_SPORTS_LIVE_UPDATE was dispatched");
    Assert.deepEqual(dispatchedAction.data.live, liveResponse.matches);
    Assert.equal(typeof dispatchedAction.data.lastLiveUpdated, "number");
    Assert.equal(feed.retryCount, 0, "retryCount resets on success");
  }
);

add_task(
  async function test_fetchAndDispatch_live_empty_triggers_post_match_resync() {
    const feed = makeLiveFeed();
    feed.pollingState = "LIVE";
    feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
      "https://merino.services.mozilla.com/api/v1/wcs/teams";
    feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
      "https://merino.services.mozilla.com/api/v1/wcs/matches";
    const liveResponse = { matches: [] };
    const fetchLiveStub = sinon
      .stub(feed.merino, "fetchSportsLive")
      .resolves(liveResponse);
    const fetchSportsDataSpy = sinon.spy(feed, "fetchSportsData");
    sinon.stub(feed.merino, "fetchSportsTeams").resolves({ teams: [] });
    sinon.stub(feed.merino, "fetchSportsMatches").resolves({
      previous: [{ status_type: "past", global_event_id: 7 }],
      current: [],
      next: [],
    });

    await feed.fetchAndDispatch();

    Assert.ok(
      fetchSportsDataSpy.calledOnce,
      "fetchSportsData called for the post-match resync"
    );
    Assert.deepEqual(
      fetchSportsDataSpy.firstCall.args[0],
      { live: liveResponse },
      "resync reused the already-fetched live payload"
    );
    Assert.ok(
      fetchLiveStub.calledOnce,
      "fetchSportsLive called only once (no redundant resync fetch)"
    );
  }
);

add_task(async function test_fetchAndDispatch_live_failure_arms_retry() {
  const feed = makeLiveFeed();
  feed.pollingState = "LIVE";
  const { setTimeoutStub } = stubTimers(feed);
  sinon.stub(feed.merino, "fetchSportsLive").resolves(null);

  const ok = await feed.fetchAndDispatch();

  Assert.ok(!ok, "fetchAndDispatch returned false on failure");
  Assert.equal(feed.retryCount, 1, "retryCount incremented");
  Assert.ok(setTimeoutStub.called, "retry timer armed via setTimeout");
});

add_task(async function test_scheduleRetry_exponential_backoff_and_cap() {
  const feed = makeLiveFeed();
  const { setTimeoutStub } = stubTimers(feed);

  feed.retryCount = 0;
  feed.scheduleRetry();
  Assert.equal(setTimeoutStub.lastCall.args[1], 1000, "first retry: 1s");

  feed.scheduleRetry();
  Assert.equal(setTimeoutStub.lastCall.args[1], 2000, "second retry: 2s");

  feed.scheduleRetry();
  Assert.equal(setTimeoutStub.lastCall.args[1], 4000, "third retry: 4s");

  // Push retryCount high to hit the cap.
  feed.retryCount = 20;
  feed.scheduleRetry();
  Assert.equal(
    setTimeoutStub.lastCall.args[1],
    300000,
    "retry delay caps at 5 minutes"
  );
});

add_task(async function test_fetchAndDispatch_idle_calls_fetchSportsData() {
  const feed = makeLiveFeed();
  feed.pollingState = "IDLE";
  feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/teams";
  feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/matches";
  sinon.stub(feed.merino, "fetchSportsLive").resolves({ matches: [] });
  const teamsStub = sinon
    .stub(feed.merino, "fetchSportsTeams")
    .resolves({ teams: [] });
  const matchesStub = sinon.stub(feed.merino, "fetchSportsMatches").resolves({
    previous: [],
    current: [],
    next: [],
  });

  await feed.fetchAndDispatch();

  Assert.ok(
    teamsStub.calledOnce && matchesStub.calledOnce,
    "IDLE state goes through fetchSportsData (which fetches teams + matches)"
  );
});

add_task(async function test_tick_bails_when_no_open_tab() {
  // With no tabs open, tick must bail completely — no fetch AND no rearm.
  // Rearming would orphan a background wakeup loop with no way to recompute
  // out of LIVE state.
  const feed = makeLiveFeed({ openTab: false });
  feed.pollingState = "LIVE";
  const { setTimeoutStub } = stubTimers(feed);
  const fetchLiveStub = sinon.stub(feed.merino, "fetchSportsLive").resolves({
    matches: [],
  });

  await feed.tick();

  Assert.ok(fetchLiveStub.notCalled, "no fetch when openTabCount == 0");
  Assert.ok(
    setTimeoutStub.notCalled,
    "no timer rearmed — polling resumes from NEW_TAB_INIT"
  );
});

add_task(async function test_tick_no_op_when_live_disabled() {
  const feed = makeLiveFeed({ liveEnabled: false });
  feed.pollingState = "LIVE";
  const { setTimeoutStub } = stubTimers(feed);
  const fetchLiveStub = sinon.stub(feed.merino, "fetchSportsLive").resolves({});

  await feed.tick();

  Assert.ok(fetchLiveStub.notCalled);
  Assert.ok(setTimeoutStub.notCalled, "no timer when liveEnabled is false");
});

add_task(async function test_scheduleNext_arms_timer_with_resolved_interval() {
  const feed = makeLiveFeed();
  feed.pollingState = "LIVE";
  const { setTimeoutStub } = stubTimers(feed);

  feed.scheduleNext();

  Assert.equal(setTimeoutStub.callCount, 1);
  Assert.equal(setTimeoutStub.firstCall.args[1], 60000, "LIVE default 60s");
  Assert.equal(typeof setTimeoutStub.firstCall.args[0], "function");
});

// 0->1 transition resumes polling regardless of pollingState — the stored
// state may be stale (e.g. set to IDLE by stopLive while a match is live),
// and tick() bails entirely when no tabs are open, so nothing else would
// restart polling.
add_task(
  async function test_onAction_NEW_TAB_INIT_resumes_polling_on_zero_to_one() {
    for (const state of ["IDLE", "MATCH_DAY", "LIVE"]) {
      const feed = makeLiveFeed();
      feed.openTabCount = 0;
      feed.pollingState = state;
      stubTimers(feed);
      const fetchNowStub = sinon.stub(feed, "fetchNow");

      await feed.onAction({ type: actionTypes.NEW_TAB_INIT });

      Assert.equal(feed.openTabCount, 1, `openTabCount went 0->1 in ${state}`);
      Assert.ok(
        fetchNowStub.calledOnce,
        `fetchNow called on 0->1 transition in ${state} state`
      );
    }
  }
);

// When polling is already running (openTabCount > 0), subsequent
// NEW_TAB_INIT actions should only kick a fresh fetch during LIVE — IDLE /
// MATCH_DAY intervals are long enough that the existing scheduled tick is
// fine.
add_task(
  async function test_onAction_NEW_TAB_INIT_no_fetch_during_idle_with_existing_tabs() {
    const feed = makeLiveFeed();
    feed.openTabCount = 1;
    feed.pollingState = "IDLE";
    stubTimers(feed);
    const fetchNowStub = sinon.stub(feed, "fetchNow");

    await feed.onAction({ type: actionTypes.NEW_TAB_INIT });

    Assert.equal(feed.openTabCount, 2);
    Assert.ok(
      fetchNowStub.notCalled,
      "no fetchNow in IDLE when tabs were already open"
    );
  }
);

add_task(
  async function test_onAction_NEW_TAB_INIT_fetches_when_LIVE_with_existing_tabs() {
    const feed = makeLiveFeed();
    feed.openTabCount = 1;
    feed.pollingState = "LIVE";
    stubTimers(feed);
    const fetchNowStub = sinon.stub(feed, "fetchNow");

    await feed.onAction({ type: actionTypes.NEW_TAB_INIT });

    Assert.equal(feed.openTabCount, 2);
    Assert.ok(
      fetchNowStub.calledOnce,
      "fetchNow called for the freshly-opened tab during LIVE state"
    );
  }
);

add_task(async function test_onAction_NEW_TAB_UNLOAD_clamps_openTabCount() {
  const feed = makeLiveFeed();
  feed.openTabCount = 0;

  await feed.onAction({ type: actionTypes.NEW_TAB_UNLOAD });

  Assert.equal(feed.openTabCount, 0, "openTabCount clamped at 0");
});

add_task(async function test_stopLive_clears_timers_and_resets() {
  const feed = makeLiveFeed();
  const { clearTimeoutStub } = stubTimers(feed);
  feed.pollTimer = 1;
  feed.retryTimer = 2;
  feed.retryCount = 5;
  feed.pollingState = "LIVE";

  feed.stopLive();

  Assert.equal(clearTimeoutStub.callCount, 2, "both timers cleared");
  Assert.equal(feed.pollTimer, null);
  Assert.equal(feed.retryTimer, null);
  Assert.equal(feed.retryCount, 0);
  Assert.equal(feed.pollingState, "IDLE");
});

add_task(async function test_init_starts_polling_when_liveEnabled() {
  const feed = makeLiveFeed();
  feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/teams";
  feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/matches";
  sinon.stub(feed.cache, "get").resolves({});
  sinon.stub(feed.merino, "fetchSportsTeams").resolves({ teams: [] });
  sinon.stub(feed.merino, "fetchSportsMatches").resolves({
    previous: [],
    current: [],
    next: [],
  });
  sinon.stub(feed.merino, "fetchSportsLive").resolves({ matches: [] });
  const { setTimeoutStub } = stubTimers(feed);

  await feed.init();

  Assert.ok(setTimeoutStub.calledOnce, "init scheduled the first tick");
});

// init() runs before any NEW_TAB_INIT — openTabCount is 0 at that point. The
// pre-NEW_TAB_INIT scheduleNext timer would either be cancelled by fetchNow()
// on NEW_TAB_INIT or fire once and bail in tick() (openTabCount === 0), so
// arming it is wasteful.
add_task(async function test_init_does_not_arm_timer_when_no_tab_open() {
  const feed = makeLiveFeed({ openTab: false });
  feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/teams";
  feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/matches";
  sinon.stub(feed.cache, "get").resolves({});
  sinon.stub(feed.merino, "fetchSportsTeams").resolves({ teams: [] });
  sinon.stub(feed.merino, "fetchSportsMatches").resolves({
    previous: [],
    current: [],
    next: [],
  });
  sinon.stub(feed.merino, "fetchSportsLive").resolves({ matches: [] });
  const { setTimeoutStub } = stubTimers(feed);

  await feed.init();

  Assert.ok(
    setTimeoutStub.notCalled,
    "no timer armed at init when openTabCount === 0"
  );
});

add_task(async function test_init_does_not_start_polling_when_live_off() {
  const feed = makeLiveFeed({ liveEnabled: false });
  feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/teams";
  feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/matches";
  sinon.stub(feed.cache, "get").resolves({});
  sinon.stub(feed.merino, "fetchSportsTeams").resolves({ teams: [] });
  sinon.stub(feed.merino, "fetchSportsMatches").resolves({
    previous: [],
    current: [],
    next: [],
  });
  sinon.stub(feed.merino, "fetchSportsLive").resolves({ matches: [] });
  const { setTimeoutStub } = stubTimers(feed);

  await feed.init();

  Assert.ok(setTimeoutStub.notCalled, "no timer when liveEnabled is false");
});

add_task(
  async function test_PREF_CHANGED_starts_polling_when_live_pref_flips() {
    const feed = makeLiveFeed({ liveEnabled: false });
    feed.initialized = true;
    stubTimers(feed);
    // Stub fetchNow so the resume call doesn't drive tick -> real network.
    const fetchNowStub = sinon.stub(feed, "fetchNow");

    // Flip the pref on, then dispatch the PREF_CHANGED action.
    feed.store.state.Prefs.values[PREF_SPORTS_LIVE_ENABLED] = true;
    await feed.onAction({
      type: actionTypes.PREF_CHANGED,
      data: { name: PREF_SPORTS_LIVE_ENABLED, value: true },
    });

    Assert.ok(
      fetchNowStub.calledOnce,
      "fetchNow called when live pref flips on — recomputes state from fresh data"
    );
  }
);

// Regression: when stopLive() resets pollingState to IDLE while a match is
// actually in progress, re-enabling must NOT just arm a 6h IDLE-interval
// timer. Going through fetchNow ensures the state machine is recomputed
// against fresh data on resume.
add_task(async function test_PREF_CHANGED_resume_does_not_arm_stale_interval() {
  const feed = makeLiveFeed({ liveEnabled: false });
  feed.initialized = true;
  // Simulate: stopLive() previously reset pollingState to IDLE while a
  // match is actually live in Redux state.
  feed.pollingState = "IDLE";
  feed.store.state.SportsWidget = {
    data: {
      matches: { previous: [], current: [], next: [] },
      live: [{ global_event_id: 99 }],
    },
  };
  const { setTimeoutStub } = stubTimers(feed);
  const fetchNowStub = sinon.stub(feed, "fetchNow");

  feed.store.state.Prefs.values[PREF_SPORTS_LIVE_ENABLED] = true;
  await feed.onAction({
    type: actionTypes.PREF_CHANGED,
    data: { name: PREF_SPORTS_LIVE_ENABLED, value: true },
  });

  Assert.ok(
    fetchNowStub.calledOnce,
    "resume goes through fetchNow rather than bare scheduleNext"
  );
  Assert.ok(
    setTimeoutStub.notCalled,
    "no IDLE-interval timer was armed before fetch could recompute state"
  );
});

add_task(
  async function test_PREF_CHANGED_stops_polling_when_live_pref_flips_off() {
    const feed = makeLiveFeed();
    feed.initialized = true;
    feed.pollTimer = 1;
    feed.retryTimer = 2;
    const { clearTimeoutStub } = stubTimers(feed);

    feed.store.state.Prefs.values[PREF_SPORTS_LIVE_ENABLED] = false;
    await feed.onAction({
      type: actionTypes.PREF_CHANGED,
      data: { name: PREF_SPORTS_LIVE_ENABLED, value: false },
    });

    Assert.ok(
      clearTimeoutStub.called,
      "stopLive cleared timers when live pref turned off"
    );
  }
);

// Regression: toggling the parent widget pref off should stop polling, and
// toggling it back on while live.enabled is still true should restart polling.
// onPrefChangedAction must watch PREF_SPORTS_ENABLED / PREF_SYSTEM_SPORTS_ENABLED,
// not just the live-specific prefs.
add_task(async function test_PREF_CHANGED_widget_toggle_restarts_polling() {
  const feed = makeLiveFeed();
  feed.initialized = true;
  const { clearTimeoutStub } = stubTimers(feed);
  const fetchNowStub = sinon.stub(feed, "fetchNow");

  info("Toggling the widget off should stop live polling");
  feed.store.state.Prefs.values[PREF_SPORTS_ENABLED] = false;
  await feed.onAction({
    type: actionTypes.PREF_CHANGED,
    data: { name: PREF_SPORTS_ENABLED, value: false },
  });
  Assert.ok(clearTimeoutStub.called, "timers cleared when widget turned off");

  info("Toggling the widget back on should restart live polling");
  fetchNowStub.resetHistory();
  feed.store.state.Prefs.values[PREF_SPORTS_ENABLED] = true;
  await feed.onAction({
    type: actionTypes.PREF_CHANGED,
    data: { name: PREF_SPORTS_ENABLED, value: true },
  });
  Assert.ok(
    fetchNowStub.called,
    "fetchNow was called when the widget was re-enabled"
  );
});

// Regression: if a live match ends while another remains live, /wcs/live
// will return just the still-live event. The reducer alone can't tell the
// difference between "I'm only sending you what's still live" and "I lost a
// match in transit", so the feed must trigger a matches resync whenever a
// previously-live event disappears from the response.
add_task(async function test_fetchAndDispatch_resyncs_when_a_live_event_ends() {
  const feed = makeLiveFeed();
  feed.pollingState = "LIVE";
  feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/teams";
  feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/matches";
  // Two live events on record; the live response only returns one of them.
  feed.store.state.SportsWidget.data.live = [
    { global_event_id: 1 },
    { global_event_id: 2 },
  ];
  feed.store.state.SportsWidget.data.matches = {
    previous: [],
    current: [],
    next: [],
  };
  sinon.stub(feed.merino, "fetchSportsLive").resolves({
    matches: [{ global_event_id: 1 }],
  });
  sinon.stub(feed.merino, "fetchSportsTeams").resolves({ teams: [] });
  sinon.stub(feed.merino, "fetchSportsMatches").resolves({
    previous: [{ global_event_id: 2, status_type: "past" }],
    current: [{ global_event_id: 1, status_type: "live" }],
    next: [],
  });
  const fetchSportsDataSpy = sinon.spy(feed, "fetchSportsData");

  await feed.fetchAndDispatch();

  Assert.ok(
    fetchSportsDataSpy.calledOnce,
    "matches endpoint was re-fetched after a live event disappeared"
  );
});

// If the live response contains the same events as before, no resync is
// triggered — only the live-update broadcast.
add_task(
  async function test_fetchAndDispatch_no_resync_when_live_set_unchanged() {
    const feed = makeLiveFeed();
    feed.pollingState = "LIVE";
    feed.store.state.SportsWidget.data.live = [
      { global_event_id: 1, home_score: 0 },
    ];
    feed.store.state.SportsWidget.data.matches = {
      previous: [],
      current: [],
      next: [],
    };
    sinon.stub(feed.merino, "fetchSportsLive").resolves({
      matches: [{ global_event_id: 1, home_score: 1 }],
    });
    const fetchSportsDataSpy = sinon.spy(feed, "fetchSportsData");

    await feed.fetchAndDispatch();

    Assert.ok(
      fetchSportsDataSpy.notCalled,
      "no matches resync when the live set is unchanged"
    );
  }
);

// =============================================================================
// Stage-2 hardening regressions
// =============================================================================

// #9: a 0 (or negative) interval pref / trainhopConfig override must not
// produce a setTimeout(0) tight loop. resolvePollIntervalMs clamps to a
// MIN_POLL_INTERVAL_MS floor; pregame lead clamps to 0 minimum.
add_task(async function test_resolvePollIntervalMs_clamps_to_minimum() {
  const feed = makeLiveFeed();
  feed.pollingState = "LIVE";
  feed.store.state.Prefs.values[PREF_POLL_LIVE_MS] = 0;
  Assert.equal(
    feed.resolvePollIntervalMs(),
    10000,
    "pollLiveMs=0 is clamped to MIN_POLL_INTERVAL_MS"
  );
  feed.store.state.Prefs.values[PREF_POLL_LIVE_MS] = -5000;
  Assert.equal(feed.resolvePollIntervalMs(), 10000, "negatives clamp too");
  feed.store.state.Prefs.values[PREF_POLL_PREGAME_LEAD_MS] = -1;
  Assert.equal(feed.resolvePregameLeadMs(), 0, "negative pregame lead clamps");
});

// #14: matches.next ordering isn't guaranteed by the backend. Pick the
// earliest future kickoff rather than trusting next[0].
add_task(async function test_updatePollingStateFromMatches_picks_earliest() {
  const feed = makeLiveFeed();
  const now = Date.now();
  feed.store.state.SportsWidget.data.matches = {
    previous: [],
    current: [],
    next: [
      // Out of order: a far-future match listed before a near-future one.
      {
        status_type: "scheduled",
        date: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        status_type: "scheduled",
        date: new Date(now + 5 * 60 * 1000).toISOString(),
      },
    ],
  };
  feed.updatePollingStateFromMatches();
  Assert.equal(
    feed.pollingState,
    "LIVE",
    "earliest match drives the state machine"
  );
  Assert.lessOrEqual(
    feed.nextKickoffDeltaMs,
    5 * 60 * 1000,
    "nextKickoffDeltaMs reflects the earliest kickoff"
  );
});

// #11: retryCount is reset on the IDLE/MATCH_DAY success branch (not only
// on LIVE-success) so a transient live failure followed by a state
// transition doesn't preserve a stale backoff counter.
add_task(async function test_fetchAndDispatch_idle_resets_retryCount() {
  const feed = makeLiveFeed();
  feed.pollingState = "IDLE";
  feed.retryCount = 4;
  feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/teams";
  feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
    "https://merino.services.mozilla.com/api/v1/wcs/matches";
  sinon.stub(feed.cache, "set").resolves();
  sinon.stub(feed.merino, "fetchSportsTeams").resolves({ teams: [] });
  sinon.stub(feed.merino, "fetchSportsMatches").resolves({
    previous: [],
    current: [],
    next: [],
  });
  sinon.stub(feed.merino, "fetchSportsLive").resolves({ matches: [] });

  await feed.fetchAndDispatch();

  Assert.equal(feed.retryCount, 0, "retryCount reset on IDLE success");
});

// #13: discoverystream.endpoints is in POLL_RELATED_PREFS so flipping the
// allowlist re-evaluates polling. Without this fix a stuck retry loop
// couldn't be broken out of via pref push.
add_task(
  async function test_PREF_CHANGED_discoverystream_endpoints_reevaluates() {
    const feed = makeLiveFeed();
    feed.initialized = true;
    stubTimers(feed);
    const fetchNowStub = sinon.stub(feed, "fetchNow");

    await feed.onAction({
      type: actionTypes.PREF_CHANGED,
      data: {
        name: "discoverystream.endpoints",
        value: "https://merino.services.mozilla.com/",
      },
    });

    Assert.ok(
      fetchNowStub.calledOnce,
      "discoverystream.endpoints triggers a re-eval"
    );
  }
);

// #7: MATCH_DAY interval is clamped to time-to-pregame so we don't miss
// the LIVE-pregame transition when kickoff is closer than the MATCH_DAY
// interval (default 30 min).
add_task(async function test_computeNextDelayMs_clamps_MATCH_DAY_to_pregame() {
  const feed = makeLiveFeed();
  feed.pollingState = "MATCH_DAY";
  // Kickoff in 20 min; pregame lead 10 min. We should wake at the pregame
  // boundary (10 min) rather than the full MATCH_DAY interval (30 min).
  feed.nextKickoffDeltaMs = 20 * 60 * 1000;
  feed.store.state.Prefs.values[PREF_POLL_PREGAME_LEAD_MS] = 10 * 60 * 1000;
  Assert.equal(
    feed.computeNextDelayMs(),
    10 * 60 * 1000,
    "clamped to delta - pregameLead"
  );

  // If kickoff is already inside pregame, no clamp (base interval).
  feed.nextKickoffDeltaMs = 5 * 60 * 1000;
  Assert.equal(
    feed.computeNextDelayMs(),
    1800000,
    "no clamp when timeToPregame <= 0"
  );
});

// #5+#6: a scheduled match that flips to live triggers a fetchSportsData
// resync, so it doesn't end up duplicated in both current[] and next[].
add_task(
  async function test_fetchAndDispatch_resyncs_when_a_new_event_goes_live() {
    const feed = makeLiveFeed();
    feed.pollingState = "LIVE";
    feed.store.state.Prefs.values["sports.worldCup.teamsEndpoint"] =
      "https://merino.services.mozilla.com/api/v1/wcs/teams";
    feed.store.state.Prefs.values["sports.worldCup.matchesEndpoint"] =
      "https://merino.services.mozilla.com/api/v1/wcs/matches";
    // No previously-live events; the response contains a brand-new live event.
    feed.store.state.SportsWidget.data.live = [];
    feed.store.state.SportsWidget.data.matches = {
      previous: [],
      current: [],
      next: [{ global_event_id: 7, status_type: "scheduled" }],
    };
    const liveResponse = { matches: [{ global_event_id: 7 }] };
    const fetchLiveStub = sinon
      .stub(feed.merino, "fetchSportsLive")
      .resolves(liveResponse);
    sinon.stub(feed.cache, "set").resolves();
    sinon.stub(feed.merino, "fetchSportsTeams").resolves({ teams: [] });
    sinon.stub(feed.merino, "fetchSportsMatches").resolves({
      previous: [],
      current: [{ global_event_id: 7, status_type: "live" }],
      next: [],
    });
    const fetchSportsDataSpy = sinon.spy(feed, "fetchSportsData");

    await feed.fetchAndDispatch();

    Assert.ok(
      fetchSportsDataSpy.calledOnce,
      "matches endpoint refetched on scheduled→live transition"
    );
    Assert.deepEqual(
      fetchSportsDataSpy.firstCall.args[0],
      { live: liveResponse },
      "resync reused the already-fetched live payload"
    );
    Assert.ok(
      fetchLiveStub.calledOnce,
      "fetchSportsLive called only once (no redundant resync fetch)"
    );
  }
);

// #3: live updates are persisted to PersistentCache so a browser shutdown
// mid-game doesn't lose scores. Steady-state ticks (no resync) write the
// merged snapshot directly.
add_task(async function test_persistSportsData_called_after_live_update() {
  const feed = makeLiveFeed();
  feed.pollingState = "LIVE";
  feed.store.state.SportsWidget.data = {
    teams: [{ key: "ENG" }],
    matches: { previous: [], current: [], next: [] },
    live: [{ global_event_id: 1, home_score: 1 }],
  };
  sinon.stub(feed.merino, "fetchSportsLive").resolves({
    matches: [{ global_event_id: 1, home_score: 2 }],
  });
  const setStub = sinon.stub(feed.cache, "set").resolves();
  const persistSpy = sinon.spy(feed, "persistSportsData");

  await feed.fetchAndDispatch();

  Assert.ok(persistSpy.calledOnce, "persistSportsData called");
  Assert.ok(setStub.calledOnce, "cache.set called once");
  Assert.equal(setStub.firstCall.args[0], "sportsData");
});

// #10: reentrancy guard — two back-to-back fetchNow() calls (e.g.
// NEW_TAB_INIT then WIDGETS_SPORTS_LIVE_VISIBLE for a fresh tab) must not
// stack parallel tick()s issuing duplicate /wcs/live requests.
add_task(async function test_tick_reentrancy_guard() {
  const feed = makeLiveFeed();
  feed.pollingState = "LIVE";
  stubTimers(feed);
  sinon.stub(feed.cache, "set").resolves();
  // Stub the post-tick resync so this test isolates the reentrancy guard
  // from the empty-live-array resync path.
  sinon.stub(feed, "fetchSportsData").resolves();

  // A live response that doesn't resolve until we tell it to, so we can
  // observe what happens if a second tick fires while the first is in flight.
  let resolveLive;
  sinon.stub(feed.merino, "fetchSportsLive").returns(
    new Promise(r => {
      resolveLive = r;
    })
  );

  const first = feed.tick();
  const second = feed.tick();
  resolveLive({ matches: [] });
  await first;
  await second;

  Assert.ok(
    feed.merino.fetchSportsLive.calledOnce,
    "second tick was suppressed by the reentrancy guard"
  );
});

// #2: an in-flight tick that races stopLive() must NOT re-arm pollTimer
// via scheduleNext when the await resolves.
add_task(
  async function test_tick_does_not_rearm_when_live_disabled_mid_fetch() {
    const feed = makeLiveFeed();
    feed.pollingState = "LIVE";
    const { setTimeoutStub } = stubTimers(feed);
    sinon.stub(feed.cache, "set").resolves();
    // The empty-live-array path triggers a fetchSportsData() resync — stub
    // it out so this test isolates the scheduleNext rearm-suppression logic.
    sinon.stub(feed, "fetchSportsData").resolves();

    let resolveLive;
    sinon.stub(feed.merino, "fetchSportsLive").returns(
      new Promise(r => {
        resolveLive = r;
      })
    );

    const inflight = feed.tick();
    // Simulate stopLive() landing during the await.
    feed.store.state.Prefs.values[PREF_SPORTS_LIVE_ENABLED] = false;
    resolveLive({ matches: [] });
    await inflight;

    Assert.ok(
      setTimeoutStub.notCalled,
      "scheduleNext did NOT re-arm pollTimer after live was disabled"
    );
  }
);

// #1: a throw from fetchSportsData must not kill the polling loop. The
// IDLE branch normally has no retry path; the try/catch in tick() reroutes
// to scheduleRetry so we recover from a transient failure.
add_task(async function test_tick_handles_throw_via_scheduleRetry() {
  const feed = makeLiveFeed();
  feed.pollingState = "IDLE";
  const { setTimeoutStub } = stubTimers(feed);
  sinon
    .stub(feed, "fetchSportsData")
    .rejects(new TypeError("Invalid URL: bogus"));

  await feed.tick();

  Assert.ok(
    setTimeoutStub.called,
    "retry timer armed even though IDLE branch threw"
  );
});
