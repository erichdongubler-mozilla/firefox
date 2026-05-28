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
  }

  get enabled() {
    const prefs = this.store.getState()?.Prefs.values;
    const userValue = !!prefs?.[PREF_SPORTS_ENABLED];
    const systemValue = !!prefs?.[PREF_SYSTEM_SPORTS_ENABLED];
    const experimentValue = !!prefs?.trainhopConfig?.sports?.enabled;
    return userValue && (systemValue || experimentValue);
  }

  async init() {
    this.initialized = true;
    await this.syncState();
    await this.fetchSportsData();
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

  async fetchSportsData() {
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
      this.merino.fetchSportsLive({
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

  async onPrefChangedAction(action) {
    if (
      (action.data.name === PREF_SPORTS_ENABLED ||
        action.data.name === PREF_SYSTEM_SPORTS_ENABLED ||
        action.data.name === "trainhopConfig") &&
      this.enabled &&
      !this.initialized
    ) {
      await this.init();
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
