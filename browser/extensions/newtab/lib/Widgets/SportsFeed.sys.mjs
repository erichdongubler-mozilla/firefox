/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
  PersistentCache: "resource://newtab/lib/PersistentCache.sys.mjs",
  SearchUIUtils: "moz-src:///browser/components/search/SearchUIUtils.sys.mjs",
  TemporaryMerinoClientShim:
    "resource://newtab/lib/TemporaryMerinoClientShim.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

import {
  actionTypes as at,
  actionCreators as ac,
} from "resource://newtab/common/Actions.mjs";

const PREF_SPORTS_ENABLED = "widgets.sportsWidget.enabled";
const PREF_SYSTEM_SPORTS_ENABLED = "widgets.system.sportsWidget.enabled";
const FOLLOW_STATE = "sports-follow-state";
const CACHE_KEY = "sports_feed";
const MERINO_CLIENT_KEY = "HNT_SPORTS_FEED";
// SAP source string passed to BrowserSearchTelemetry — must be a key in
// BrowserSearchTelemetry.KNOWN_SEARCH_SOURCES. Today this widget reports under
// the generic newtab source; the search team may ask us to switch to a
// widget-specific source later.
const SEARCH_SAP_SOURCE = "about_newtab";

// Adaptive live-polling prefs and constants
const PREF_SPORTS_LIVE_ENABLED = "widgets.sportsWidget.live.enabled";
const PREF_SPORTS_LIVE_ENDPOINT = "sports.worldCup.liveEndpoint";
const PREF_POLL_IDLE_MS = "widgets.sportsWidget.pollIdleMs";
const PREF_POLL_MATCH_DAY_MS = "widgets.sportsWidget.pollMatchDayMs";
const PREF_POLL_LIVE_MS = "widgets.sportsWidget.pollLiveMs";
const PREF_POLL_PREGAME_LEAD_MS = "widgets.sportsWidget.pollPregameLeadMs";

const POLLING_STATE_IDLE = "IDLE";
const POLLING_STATE_MATCH_DAY = "MATCH_DAY";
const POLLING_STATE_LIVE = "LIVE";

// Exponential-backoff retry cap for failed live fetches.
const MAX_RETRY_DELAY_MS = 300000; // 5 minutes
// Floor for any poll interval, to prevent a 0/negative pref or trainhopConfig
// value from producing a tight network loop. Pregame lead allows 0 (= disabled)
// but no negatives.
const MIN_POLL_INTERVAL_MS = 10000; // 10 seconds
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Manages persistent state for the Sports widget (selected teams and widget
 * state), syncing with PersistentCache so state survives page refreshes.
 * Also fetches teams and match data from the Merino WCS endpoints.
 */
export class SportsFeed {
  constructor() {
    this.initialized = false;
    this.cache = this.PersistentCache(CACHE_KEY, true);
    this.merino = this.MerinoClient(MERINO_CLIENT_KEY);

    // Adaptive live-polling state. Visibility (per-tab IntersectionObserver
    // gating) lands in a follow-up bug — polling here only gates on whether
    // any New Tab is open.
    this.pollTimer = null;
    this.retryTimer = null;
    this.retryCount = 0;
    this.pollingState = POLLING_STATE_IDLE;
    this.openTabCount = 0;
    this.lastLiveUpdated = null;
    this.nextKickoffDeltaMs = null;
    // Reentrancy guard: stops a second tick() from racing the first when
    // fetchNow() is called back-to-back (e.g. NEW_TAB_INIT followed by
    // WIDGETS_SPORTS_LIVE_VISIBLE on a freshly opened tab in LIVE state).
    this.ticking = false;
  }

  get enabled() {
    const prefs = this.store.getState()?.Prefs.values;
    const userValue = !!prefs?.[PREF_SPORTS_ENABLED];
    const systemValue = !!prefs?.[PREF_SYSTEM_SPORTS_ENABLED];
    const experimentValue = !!prefs?.trainhopConfig?.sports?.enabled;
    return userValue && (systemValue || experimentValue);
  }

  // Live polling is a sub-feature of the Sports widget — the widget itself
  // must be enabled first. Tunable independently via raw pref or
  // trainhopConfig.sports.liveEnabled (Nimbus rollout).
  get liveEnabled() {
    if (!this.enabled) {
      return false;
    }
    const prefs = this.store.getState()?.Prefs.values;
    const userValue = !!prefs?.[PREF_SPORTS_LIVE_ENABLED];
    const experimentValue = !!prefs?.trainhopConfig?.sports?.liveEnabled;
    return userValue || experimentValue;
  }

  async init() {
    this.initialized = true;
    await this.syncState();
    await this.fetchSportsData();
    if (this.liveEnabled) {
      this.updatePollingStateFromMatches();
      // Polling only really starts from NEW_TAB_INIT; arming a timer here when
      // no tab is open is wasteful (tick() bails on openTabCount === 0).
      if (this.openTabCount > 0) {
        this.scheduleNext();
      }
    }
  }

  // Handle a click on a match row. Resolves the user's default search engine
  // (or default-private in a private window), builds a submission via
  // SearchUIUtils.loadSearch, navigates to it, and records SAP telemetry.
  // Using loadSearch (rather than a pre-computed href) handles POST-based
  // engines, private windows, and `BrowserSearchTelemetry.recordSearch` all
  // in one call.
  async openMatchSearch(action) {
    const { query, eventInfo } = action.data || {};
    const window = action._target?.window;
    if (!query || !window) {
      return;
    }
    try {
      await lazy.SearchUIUtils.loadSearch({
        window,
        searchText: query,
        // eventInfo is a plain object carrying the click modifiers/button so
        // whereToOpenLink can decide current-tab vs new-tab vs new-window.
        where: lazy.BrowserUtils.whereToOpenLink(eventInfo || null),
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
        sapSource: SEARCH_SAP_SOURCE,
      });
    } catch (e) {
      console.error("Sports widget failed to open match search", e);
    }
  }

  // On startup, read whatever was saved to disk and send it to the UI.
  async syncState() {
    const cachedData = (await this.cache.get()) || {};
    const { widgetState, selectedTeams, sportsData, matchesTab, followedOnly } =
      cachedData;
    const { teams, matches, live } = sportsData || {};

    if (widgetState) {
      this.store.dispatch(
        ac.BroadcastToContent({
          type: at.WIDGETS_SPORTS_SET_WIDGET_STATE,
          data: widgetState,
        })
      );
    }

    if (selectedTeams) {
      this.store.dispatch(
        ac.BroadcastToContent({
          type: at.WIDGETS_SPORTS_SET_SELECTED_TEAMS,
          data: selectedTeams,
        })
      );
    }

    if (matchesTab) {
      this.store.dispatch(
        ac.BroadcastToContent({
          type: at.WIDGETS_SPORTS_SET_MATCHES_TAB,
          data: matchesTab,
        })
      );
    }

    if (followedOnly) {
      this.store.dispatch(
        ac.BroadcastToContent({
          type: at.WIDGETS_SPORTS_SET_FOLLOWED_ONLY,
          data: followedOnly,
        })
      );
    }

    if (teams || matches || live) {
      this.store.dispatch(
        ac.BroadcastToContent({
          type: at.WIDGETS_SPORTS_WIDGET_SET,
          data: {
            teams: teams ?? [],
            matches: matches ?? { previous: [], current: [], next: [] },
            live: live ?? [],
          },
        })
      );
    }
  }

  // `live` lets a caller that already has a fresh /live payload (e.g. the
  // post-match resync from fetchAndDispatch) reuse it instead of triggering
  // a redundant /live fetch.
  async fetchSportsData({ live: prefetchedLive } = {}) {
    const prefs = this.store.getState()?.Prefs.values;
    const teamsEndpoint =
      prefs?.trainhopConfig?.sports?.teamsEndpoint ||
      prefs?.["sports.worldCup.teamsEndpoint"];
    const matchesEndpoint =
      prefs?.trainhopConfig?.sports?.matchesEndpoint ||
      prefs?.["sports.worldCup.matchesEndpoint"];
    const liveEndpoint =
      prefs?.trainhopConfig?.sports?.liveEndpoint ||
      prefs?.["sports.worldCup.liveEndpoint"];

    const allowedEndpoints = (prefs?.["discoverystream.endpoints"] ?? "")
      .split(",")
      .map(item => item.trim())
      .filter(item => item);

    if (
      teamsEndpoint &&
      !allowedEndpoints.some(prefix => teamsEndpoint.startsWith(prefix))
    ) {
      console.error(`Sports teams endpoint not in allowlist: ${teamsEndpoint}`);
      return;
    }
    if (
      matchesEndpoint &&
      !allowedEndpoints.some(prefix => matchesEndpoint.startsWith(prefix))
    ) {
      console.error(
        `Sports matches endpoint not in allowlist: ${matchesEndpoint}`
      );
      return;
    }
    if (
      prefetchedLive === undefined &&
      liveEndpoint &&
      !allowedEndpoints.some(prefix => liveEndpoint.startsWith(prefix))
    ) {
      console.error(`Sports live endpoint not in allowlist: ${liveEndpoint}`);
      return;
    }

    const [teams, matches, live] = await Promise.all([
      this.merino.fetchSportsTeams({
        source: "newtab",
        endpointUrl: teamsEndpoint,
      }),
      this.merino.fetchSportsMatches({
        source: "newtab",
        endpointUrl: matchesEndpoint,
      }),
      prefetchedLive !== undefined
        ? Promise.resolve(prefetchedLive)
        : this.merino.fetchSportsLive({
            source: "newtab",
            endpointUrl: liveEndpoint,
          }),
    ]);

    // The /live endpoint returns `{ matches: [...] }` and is pre-filtered to
    // in-progress games by the backend, so we surface its array directly as
    // `live` alongside `matches`. The "Now" tab reads from `data.live`, while
    // `matches.previous` / `matches.next` continue to drive the Results and
    // Upcoming tabs.
    const liveMatches = Array.isArray(live?.matches) ? live.matches : [];

    if (teams?.teams || matches || live) {
      await this.cache.set("sportsData", {
        teams: teams?.teams,
        matches,
        live: liveMatches,
      });
    }

    this.store.dispatch(
      ac.BroadcastToContent({
        type: at.WIDGETS_SPORTS_WIDGET_SET,
        data: {
          teams: teams?.teams ?? [],
          matches: matches ?? { previous: [], current: [], next: [] },
          live: liveMatches,
        },
      })
    );
  }

  async fetchWatchLive() {
    const prefs = this.store.getState()?.Prefs.values;
    const watchLiveEndpoint =
      prefs?.trainhopConfig?.sports?.watchLiveEndpoint ||
      prefs?.["sports.worldCup.watchLiveEndpoint"];

    const allowedEndpoints = (prefs?.["discoverystream.endpoints"] ?? "")
      .split(",")
      .map(item => item.trim())
      .filter(item => item);

    if (
      watchLiveEndpoint &&
      !allowedEndpoints.some(prefix => watchLiveEndpoint.startsWith(prefix))
    ) {
      console.error(
        `Sports watch-live endpoint not in allowlist: ${watchLiveEndpoint}`
      );
      return;
    }

    const data = await this.merino.fetchWatchLive({
      source: "newtab",
      endpointUrl: watchLiveEndpoint,
      acceptLanguage: Services.locale.appLocaleAsBCP47,
    });

    this.store.dispatch(
      ac.BroadcastToContent({
        type: at.WIDGETS_SPORTS_WATCH_LIVE_SET,
        data,
      })
    );
  }

  // Write the current SportsWidget state to PersistentCache. Used by the
  // LIVE-tick path so live scores survive browser shutdown; fetchSportsData
  // caches directly from the fetched payload before dispatching.
  async persistSportsData() {
    const data = this.store.getState()?.SportsWidget?.data;
    if (data?.teams?.length || data?.matches || data?.live) {
      await this.cache.set("sportsData", {
        teams: data.teams,
        matches: data.matches,
        live: data.live,
      });
    }
  }

  // Resolve the next poll interval from trainhopConfig, then the raw pref,
  // then the hard-coded default. Lets Nimbus retune intervals without a ship.
  resolvePollIntervalMs() {
    const prefs = this.store.getState()?.Prefs.values ?? {};
    const trainhop = prefs.trainhopConfig?.sports ?? {};
    let raw;
    switch (this.pollingState) {
      case POLLING_STATE_LIVE:
        raw = trainhop.pollLiveMs ?? prefs[PREF_POLL_LIVE_MS] ?? 60000;
        break;
      case POLLING_STATE_MATCH_DAY:
        raw =
          trainhop.pollMatchDayMs ?? prefs[PREF_POLL_MATCH_DAY_MS] ?? 1800000;
        break;
      default:
        raw = trainhop.pollIdleMs ?? prefs[PREF_POLL_IDLE_MS] ?? 21600000;
    }
    return Math.max(MIN_POLL_INTERVAL_MS, raw);
  }

  resolvePregameLeadMs() {
    const prefs = this.store.getState()?.Prefs.values ?? {};
    const raw =
      prefs.trainhopConfig?.sports?.pollPregameLeadMs ??
      prefs[PREF_POLL_PREGAME_LEAD_MS] ??
      600000;
    return Math.max(0, raw);
  }

  // Fetch the /wcs/live endpoint. Returns the parsed response, or null on
  // disallowed endpoint / fetch error so the caller can arm a retry.
  async fetchLive() {
    const prefs = this.store.getState()?.Prefs.values;
    const liveEndpoint =
      prefs?.trainhopConfig?.sports?.liveEndpoint ||
      prefs?.[PREF_SPORTS_LIVE_ENDPOINT];

    if (!liveEndpoint) {
      return null;
    }

    const allowedEndpoints = (prefs?.["discoverystream.endpoints"] ?? "")
      .split(",")
      .map(item => item.trim())
      .filter(item => item);

    if (!allowedEndpoints.some(prefix => liveEndpoint.startsWith(prefix))) {
      console.error(`Sports live endpoint not in allowlist: ${liveEndpoint}`);
      return null;
    }

    return this.merino.fetchSportsLive({
      source: "newtab",
      endpointUrl: liveEndpoint,
    });
  }

  // Drive one polling step. In LIVE state hit /wcs/live and merge updates
  // into the current array. In IDLE / MATCH_DAY hit the matches endpoint
  // via fetchSportsData. On empty-live (post-match), do an immediate matches
  // resync to capture finals and the next kickoff.
  // Returns true on success, false if a retry is armed.
  async fetchAndDispatch() {
    if (this.pollingState === POLLING_STATE_LIVE) {
      const response = await this.fetchLive();
      if (response === null) {
        this.scheduleRetry();
        return false;
      }
      const liveEvents = Array.isArray(response.matches)
        ? response.matches
        : [];
      this.lastLiveUpdated = Date.now();

      // Detect matches that crossed the live boundary in EITHER direction
      // since the last poll:
      // - someEnded: was in data.live, no longer in /wcs/live → needs a
      //   matches resync to pull the final into matches.previous.
      // - someStarted: appears in /wcs/live but wasn't in data.live → its
      //   scheduled copy still sits in matches.next[] and needs to be removed.
      // Either case triggers a wholesale matches resync.
      const prevLive = this.store.getState()?.SportsWidget?.data?.live ?? [];
      const prevLiveIds = new Set(prevLive.map(ev => ev.global_event_id));
      const newLiveIds = new Set(liveEvents.map(ev => ev.global_event_id));
      const someEnded = [...prevLiveIds].some(id => !newLiveIds.has(id));
      const someStarted = [...newLiveIds].some(id => !prevLiveIds.has(id));

      this.dispatchLive(liveEvents);
      if (!liveEvents.length || someEnded || someStarted) {
        // Resync: pulls definitive finals, removes new-live events from
        // next[], and refreshes the next kickoff. fetchSportsData persists
        // afterwards, so the cache write here would be redundant. Pass the
        // /live response we just fetched so fetchSportsData skips a second
        // /live call.
        await this.fetchSportsData({ live: response });
      } else {
        // Persist the merged live snapshot so a browser shutdown mid-game
        // doesn't lose the latest scores.
        await this.persistSportsData();
      }
      this.updatePollingStateFromMatches();
      this.retryCount = 0;
      return true;
    }
    // IDLE or MATCH_DAY — a missed tick here is harmless because of the
    // long intervals, so no retry/backoff on this branch.
    await this.fetchSportsData();
    this.updatePollingStateFromMatches();
    this.retryCount = 0;
    return true;
  }

  // Examine the schedule data in Redux state to choose the next polling
  // state. Called after a successful fetch (live or matches). Stashes the
  // delta to the next future kickoff on `this.nextKickoffDeltaMs` so
  // scheduleNext can clamp MATCH_DAY intervals against it.
  updatePollingStateFromMatches() {
    this.nextKickoffDeltaMs = null;
    const data = this.store.getState()?.SportsWidget?.data;
    if ((data?.live ?? []).length) {
      this.pollingState = POLLING_STATE_LIVE;
      return;
    }
    const matches = data?.matches;
    if (!matches) {
      this.pollingState = POLLING_STATE_IDLE;
      return;
    }
    // Backend ordering of matches.next is not guaranteed — pick the earliest
    // future kickoff rather than trusting next[0].
    const now = Date.now();
    const futureDeltas = (matches.next ?? [])
      .map(ev => (ev?.date ? new Date(ev.date).getTime() - now : NaN))
      .filter(delta => Number.isFinite(delta) && delta > 0);
    if (futureDeltas.length) {
      const delta = Math.min(...futureDeltas);
      this.nextKickoffDeltaMs = delta;
      if (delta <= this.resolvePregameLeadMs()) {
        this.pollingState = POLLING_STATE_LIVE;
        return;
      }
      if (delta <= MS_PER_DAY) {
        this.pollingState = POLLING_STATE_MATCH_DAY;
        return;
      }
    }
    this.pollingState = POLLING_STATE_IDLE;
  }

  // Periodic tick. Bails entirely (no rearm) when no New Tab is open or
  // when live is disabled — polling resumes from NEW_TAB_INIT or
  // PREF_CHANGED. Rearming with no tabs would orphan a background wakeup
  // loop with no way to recompute state out of LIVE.
  async tick() {
    // Reentrancy: a second tick() while the first is still awaiting would
    // double-dispatch and race two scheduleNext writes.
    if (this.ticking) {
      return;
    }
    if (!this.liveEnabled || this.openTabCount === 0) {
      return;
    }
    this.ticking = true;
    try {
      let ok;
      try {
        ok = await this.fetchAndDispatch();
      } catch (e) {
        // A throw from fetchSportsData (e.g. `new URL(matchesEndpoint)` with
        // a malformed URL) would otherwise kill the IDLE/MATCH_DAY branch
        // forever — that branch has no retry path of its own.
        console.error("Sports widget poll tick failed", e);
        this.scheduleRetry();
        return;
      }
      if (!ok) {
        // scheduleRetry already armed the retry timer; do not also arm a
        // normal poll timer or we'd double-fire.
        return;
      }
      // Re-check post-await: a PREF_CHANGED → stopLive() that ran during
      // the fetch cleared the timers, and we must not resurrect them by
      // re-arming through scheduleNext().
      if (!this.liveEnabled || this.openTabCount === 0) {
        return;
      }
      this.scheduleNext();
    } finally {
      this.ticking = false;
    }
  }

  scheduleNext() {
    this.clearTimeout(this.pollTimer);
    this.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.pollTimer = this.setTimeout(
      () => this.tick(),
      this.computeNextDelayMs()
    );
  }

  // Pick the actual setTimeout delay. In MATCH_DAY we'd otherwise miss the
  // LIVE-pregame transition by up to one full MATCH_DAY interval (default
  // 30 min) when the kickoff is closer than that; clamp to the moment
  // pregame escalation should kick in.
  computeNextDelayMs() {
    const base = this.resolvePollIntervalMs();
    if (
      this.pollingState === POLLING_STATE_MATCH_DAY &&
      this.nextKickoffDeltaMs !== null
    ) {
      const timeToPregame =
        this.nextKickoffDeltaMs - this.resolvePregameLeadMs();
      if (timeToPregame > 0) {
        return Math.max(MIN_POLL_INTERVAL_MS, Math.min(base, timeToPregame));
      }
    }
    return base;
  }

  scheduleRetry() {
    this.clearTimeout(this.pollTimer);
    this.clearTimeout(this.retryTimer);
    this.pollTimer = null;
    const delay = Math.min(1000 * 2 ** this.retryCount, MAX_RETRY_DELAY_MS);
    this.retryCount++;
    this.retryTimer = this.setTimeout(() => this.tick(), delay);
  }

  // Fetch immediately, cancelling any pending timers. Used when visibility
  // is restored mid-LIVE so users don't have to wait for the next tick.
  // Returns the tick promise so callers (and tests) can await completion.
  fetchNow() {
    this.clearTimeout(this.pollTimer);
    this.clearTimeout(this.retryTimer);
    this.pollTimer = null;
    this.retryTimer = null;
    return this.tick();
  }

  // Tear down live polling without affecting persistent-state behavior.
  stopLive() {
    this.clearTimeout(this.pollTimer);
    this.clearTimeout(this.retryTimer);
    this.pollTimer = null;
    this.retryTimer = null;
    this.retryCount = 0;
    this.pollingState = POLLING_STATE_IDLE;
  }

  dispatchLive(live) {
    this.store.dispatch(
      ac.BroadcastToContent({
        type: at.WIDGETS_SPORTS_LIVE_UPDATE,
        data: {
          live,
          lastLiveUpdated: this.lastLiveUpdated,
        },
      })
    );
  }

  async onPrefChangedAction(action) {
    const { name } = action.data;
    // First-time init when the widget turns on. init() itself will arm the
    // poll timer if liveEnabled, so we return early to avoid double-scheduling.
    if (
      (name === PREF_SPORTS_ENABLED ||
        name === PREF_SYSTEM_SPORTS_ENABLED ||
        name === "trainhopConfig") &&
      this.enabled &&
      !this.initialized
    ) {
      await this.init();
      return;
    }
    // Any pref that can affect liveEnabled or the next poll interval should
    // re-evaluate polling. This includes the parent widget prefs — toggling
    // the widget off then back on must restart polling, not leave it stopped.
    const POLL_RELATED_PREFS = [
      PREF_SPORTS_ENABLED,
      PREF_SYSTEM_SPORTS_ENABLED,
      PREF_SPORTS_LIVE_ENABLED,
      PREF_SPORTS_LIVE_ENDPOINT,
      PREF_POLL_IDLE_MS,
      PREF_POLL_MATCH_DAY_MS,
      PREF_POLL_LIVE_MS,
      PREF_POLL_PREGAME_LEAD_MS,
      "discoverystream.endpoints",
      "trainhopConfig",
    ];
    if (this.initialized && POLL_RELATED_PREFS.includes(name)) {
      if (this.liveEnabled) {
        // fetchNow (rather than just scheduleNext) so the resume path
        // recomputes the time-based polling state from fresh data —
        // stopLive() hard-set pollingState to IDLE, so a bare scheduleNext
        // here would arm a 6h timer even if a match is currently live.
        await this.fetchNow();
      } else {
        this.stopLive();
      }
    }
  }

  async onAction(action) {
    switch (action.type) {
      case at.INIT:
        if (this.enabled) {
          await this.init();
        }
        break;
      case at.PREF_CHANGED:
        await this.onPrefChangedAction(action);
        break;
      // Track open tabs so we can pause polling when no New Tab exists.
      // Visibility (whether the widget is on-screen in any tab) is layered on
      // top in a follow-up bug.
      case at.NEW_TAB_INIT: {
        // 0->1 transition means polling was paused (tick() bails when no
        // tabs are open). Resume by fetching immediately, regardless of the
        // current pollingState — the stored state may be stale.
        const wasEmpty = this.openTabCount === 0;
        this.openTabCount++;
        if (
          this.liveEnabled &&
          (wasEmpty || this.pollingState === POLLING_STATE_LIVE)
        ) {
          await this.fetchNow();
        }
        break;
      }
      case at.NEW_TAB_UNLOAD:
        this.openTabCount = Math.max(0, this.openTabCount - 1);
        break;
      // User clicked a match row — run a search for the match's `query` using
      // their default search engine via SearchUIUtils.loadSearch.
      case at.WIDGETS_SPORTS_OPEN_MATCH_SEARCH:
        await this.openMatchSearch(action);
        break;
      // User changed the widget state — save it and send the updated state to the UI.
      case at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE:
        if (action.data !== FOLLOW_STATE) {
          await this.cache.set("widgetState", action.data);
        }
        this.store.dispatch(
          ac.BroadcastToContent({
            type: at.WIDGETS_SPORTS_SET_WIDGET_STATE,
            data: action.data,
          })
        );
        break;
      // User changed their team selection — save it and send the updated list to the UI.
      case at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS:
        await this.cache.set("selectedTeams", action.data);
        this.store.dispatch(
          ac.BroadcastToContent({
            type: at.WIDGETS_SPORTS_SET_SELECTED_TEAMS,
            data: action.data,
          })
        );
        break;
      // User changed the matches tab — save it and broadcast to the UI.
      case at.WIDGETS_SPORTS_CHANGE_MATCHES_TAB:
        await this.cache.set("matchesTab", action.data);
        this.store.dispatch(
          ac.BroadcastToContent({
            type: at.WIDGETS_SPORTS_SET_MATCHES_TAB,
            data: action.data,
          })
        );
        break;
      // User toggled the "Only followed teams" filter for a tab — merge into
      // the existing followedOnly object and persist.
      case at.WIDGETS_SPORTS_CHANGE_FOLLOWED_ONLY: {
        const cached = (await this.cache.get()) || {};
        const merged = { ...(cached.followedOnly || {}), ...action.data };
        await this.cache.set("followedOnly", merged);
        this.store.dispatch(
          ac.BroadcastToContent({
            type: at.WIDGETS_SPORTS_SET_FOLLOWED_ONLY,
            data: action.data,
          })
        );
        break;
      }
      case at.WIDGETS_SPORTS_WATCH_LIVE_REQUEST:
        await this.fetchWatchLive();
        break;
    }
  }
}

SportsFeed.prototype.PersistentCache = (...args) => {
  return new lazy.PersistentCache(...args);
};

SportsFeed.prototype.MerinoClient = name => {
  return new lazy.TemporaryMerinoClientShim(name);
};

// Attached to the prototype so tests can stub them.
SportsFeed.prototype.setTimeout = (...args) => lazy.setTimeout(...args);
SportsFeed.prototype.clearTimeout = (...args) => lazy.clearTimeout(...args);
