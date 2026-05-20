/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// eslint-disable-next-line no-unused-vars
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector, batch } from "react-redux";
import { actionCreators as ac, actionTypes as at } from "common/Actions.mjs";
import { useIntersectionObserver } from "../../../lib/utils";
import { SportsMatchRow } from "./SportsMatchRow";
import { WIDGET_REGISTRY, resolveWidgetSize } from "common/WidgetsRegistry.mjs";
import { useLocalizedTeamNames } from "./useLocalizedTeamNames.jsx";

const WIDGET_STATES = {
  INTRO: "sports-intro",
  FOLLOW_TEAMS: "sports-follow-state",
  MATCHES: "sports-matches",
  KEY_DATES: "sports-key-dates",
};

const MATCHES_TABS = {
  RESULTS: "results",
  NOW: "now",
  UPCOMING: "upcoming",
};

function getVisibleMatchesTabs(hasLiveGames, hasPreviousResults) {
  return (
    Object.values(MATCHES_TABS)
      // Only show the Now tab when there are live games.
      .filter(id => id !== MATCHES_TABS.NOW || hasLiveGames)
      .map(id => ({
        id,
        // Disable the Results tab until previous match data is available.
        disabled: id === MATCHES_TABS.RESULTS && !hasPreviousResults,
      }))
  );
}

const USER_ACTION_TYPES = {
  FOLLOW_TEAMS: "follow_teams",
  SAVE_TEAMS: "save_teams",
  VIEW_UPCOMING: "view_upcoming",
  VIEW_RESULTS: "view_results",
  VIEW_MATCHES: "view_matches",
  VIEW_KEY_DATES: "view_key_dates",
  CHANGE_SIZE: "change_size",
  LEARN_MORE: "learn_more",
};

const PREF_NOVA_ENABLED = "nova.enabled";
const PREF_SPORTS_WIDGET_SIZE = "widgets.sportsWidget.size";
const PREF_SPORTS_WIDGET_LIVE_ENABLED = "widgets.sportsWidget.live.enabled";

const SPORTS_WIDGET_REGISTRY_ENTRY = WIDGET_REGISTRY.find(
  widget => widget.id === "sportsWidget"
);

function SportsWidget({ dispatch, handleUserInteraction }) {
  const prefs = useSelector(state => state.Prefs.values);
  const sportsWidgetData = useSelector(state => state.SportsWidget);

  const widgetSize = resolveWidgetSize(SPORTS_WIDGET_REGISTRY_ENTRY, prefs);
  const liveEnabled = prefs[PREF_SPORTS_WIDGET_LIVE_ENABLED];
  const widgetsMayBeMaximized = prefs["widgets.system.maximized"];
  const hasLiveGames = sportsWidgetData?.data?.matches?.current?.length > 0;
  const hasPreviousResults =
    sportsWidgetData?.data?.matches?.previous?.length > 0;
  const tournamentStarted = hasLiveGames || hasPreviousResults;
  const savedWidgetState = sportsWidgetData.widgetState || WIDGET_STATES.INTRO;
  // Once the tournament has started, skip the intro and open on the match schedule.
  const widgetState =
    tournamentStarted && savedWidgetState === WIDGET_STATES.INTRO
      ? WIDGET_STATES.MATCHES
      : savedWidgetState;
  const displaySize =
    widgetState === WIDGET_STATES.FOLLOW_TEAMS ? "large" : widgetSize;
  const selectedTeams = sportsWidgetData.selectedTeams || [];
  const teams = sportsWidgetData?.data?.teams ?? [];
  const { matchesTab } = sportsWidgetData;
  const hasUserSelectedTab = useRef(false);
  const activeTab =
    hasLiveGames && !hasUserSelectedTab.current ? MATCHES_TABS.NOW : matchesTab;
  const impressionFired = useRef(false);
  const sizeSubmenuRef = useRef(null);

  const handleIntersection = useCallback(() => {
    if (impressionFired.current) {
      return;
    }
    impressionFired.current = true;
    dispatch(
      ac.AlsoToMain({
        type: at.WIDGETS_IMPRESSION,
        data: {
          widget_name: "sports_widget",
          widget_size: widgetSize,
        },
      })
    );
  }, [dispatch, widgetSize]);

  const widgetRef = useIntersectionObserver(handleIntersection);

  const handleInteraction = useCallback(
    () => handleUserInteraction("sportsWidget"),
    [handleUserInteraction]
  );

  function handleFollowTeams(widgetSource) {
    dispatch(
      ac.OnlyToMain({
        type: at.WIDGETS_USER_EVENT,
        data: {
          widget_name: "sports_widget",
          widget_source: widgetSource,
          user_action: USER_ACTION_TYPES.FOLLOW_TEAMS,
          widget_size: widgetSize,
        },
      })
    );
    // Tell the backend the widget state changed — it will save it and update the UI.
    dispatch(
      ac.AlsoToMain({
        type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
        data: WIDGET_STATES.FOLLOW_TEAMS,
      })
    );
    handleInteraction();
  }

  function handleViewUpcoming() {
    batch(() => {
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_USER_EVENT,
          data: {
            widget_name: "sports_widget",
            widget_source: "context_menu",
            user_action: USER_ACTION_TYPES.VIEW_UPCOMING,
            widget_size: widgetSize,
          },
        })
      );
      dispatch(
        ac.AlsoToMain({
          type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
          data: WIDGET_STATES.MATCHES,
        })
      );
      dispatch(
        ac.AlsoToMain({
          type: at.WIDGETS_SPORTS_CHANGE_MATCHES_TAB,
          data: MATCHES_TABS.UPCOMING,
        })
      );
    });
    handleInteraction();
  }

  function handleViewResults() {
    batch(() => {
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_USER_EVENT,
          data: {
            widget_name: "sports_widget",
            widget_source: "context_menu",
            user_action: USER_ACTION_TYPES.VIEW_RESULTS,
            widget_size: widgetSize,
          },
        })
      );
      dispatch(
        ac.AlsoToMain({
          type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
          data: WIDGET_STATES.MATCHES,
        })
      );
      dispatch(
        ac.AlsoToMain({
          type: at.WIDGETS_SPORTS_CHANGE_MATCHES_TAB,
          data: MATCHES_TABS.RESULTS,
        })
      );
    });
    handleInteraction();
  }

  function handleViewKeyDates(widgetSource) {
    batch(() => {
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_USER_EVENT,
          data: {
            widget_name: "sports_widget",
            widget_source: widgetSource,
            user_action: USER_ACTION_TYPES.VIEW_KEY_DATES,
            widget_size: widgetSize,
          },
        })
      );
      dispatch(
        ac.AlsoToMain({
          type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
          data: WIDGET_STATES.KEY_DATES,
        })
      );
    });
    handleInteraction();
  }

  function handleSportsWidgetHide() {
    batch(() => {
      dispatch(
        ac.OnlyToMain({
          type: at.SET_PREF,
          data: { name: "widgets.sportsWidget.enabled", value: false },
        })
      );
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_ENABLED,
          data: {
            widget_name: "sports_widget",
            widget_source: "context_menu",
            enabled: false,
            widget_size: widgetSize,
          },
        })
      );
    });
    handleInteraction();
  }

  const handleChangeSize = useCallback(
    size => {
      batch(() => {
        dispatch(
          ac.OnlyToMain({
            type: at.SET_PREF,
            data: { name: PREF_SPORTS_WIDGET_SIZE, value: size },
          })
        );
        dispatch(
          ac.OnlyToMain({
            type: at.WIDGETS_USER_EVENT,
            data: {
              widget_name: "sports_widget",
              widget_source: "context_menu",
              user_action: USER_ACTION_TYPES.CHANGE_SIZE,
              action_value: size,
              widget_size: size,
            },
          })
        );
      });
    },
    [dispatch]
  );

  useEffect(() => {
    const el = sizeSubmenuRef.current;
    if (!el) {
      return undefined;
    }
    const listener = e => {
      const item = e.composedPath().find(node => node.dataset?.size);
      if (item) {
        handleChangeSize(item.dataset.size);
      }
    };
    el.addEventListener("click", listener);
    return () => el.removeEventListener("click", listener);
  }, [handleChangeSize]);

  function handleViewMatches(widgetSource) {
    batch(() => {
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_USER_EVENT,
          data: {
            widget_name: "sports_widget",
            widget_source: widgetSource,
            user_action: USER_ACTION_TYPES.VIEW_MATCHES,
            widget_size: widgetSize,
          },
        })
      );
      dispatch(
        ac.AlsoToMain({
          type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
          data: WIDGET_STATES.MATCHES,
        })
      );
    });
    handleInteraction();
  }

  function handleLearnMore() {
    batch(() => {
      dispatch(
        ac.OnlyToMain({
          type: at.OPEN_LINK,
          data: {
            url: "https://support.mozilla.org/kb/firefox-new-tab-widgets",
          },
        })
      );
      const telemetryData = {
        widget_name: "sports_widget",
        widget_source: "context_menu",
        user_action: USER_ACTION_TYPES.LEARN_MORE,
        widget_size: widgetSize,
      };
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_USER_EVENT,
          data: telemetryData,
        })
      );
    });
  }

  // Discard any team changes and go back to the intro state.
  const handleCancelSelection = useCallback(
    () =>
      dispatch(
        ac.AlsoToMain({
          type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
          data: WIDGET_STATES.INTRO,
        })
      ),
    [dispatch]
  );

  const handleSaveSelection = useCallback(
    newSelectedTeams => {
      if (newSelectedTeams.length) {
        dispatch(
          ac.OnlyToMain({
            type: at.WIDGETS_USER_EVENT,
            data: {
              widget_name: "sports_widget",
              widget_source: "widget",
              user_action: USER_ACTION_TYPES.SAVE_TEAMS,
              action_value: newSelectedTeams.length,
              widget_size: widgetSize,
            },
          })
        );
      }
      dispatch(
        ac.AlsoToMain({
          type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
          data: newSelectedTeams,
        })
      );
      handleCancelSelection();
    },
    [dispatch, widgetSize, handleCancelSelection]
  );

  const handleViewIntro = useCallback(
    () =>
      dispatch(
        ac.AlsoToMain({
          type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
          data: WIDGET_STATES.INTRO,
        })
      ),
    [dispatch]
  );

  const handleMatchesTabChange = useCallback(
    tab => {
      hasUserSelectedTab.current = true;
      dispatch(
        ac.AlsoToMain({
          type: at.WIDGETS_SPORTS_CHANGE_MATCHES_TAB,
          data: tab,
        })
      );
    },
    [dispatch]
  );

  // @nova-cleanup(remove-gate): Remove this guard and PREF_NOVA_ENABLED after Nova ships
  if (!prefs[PREF_NOVA_ENABLED]) {
    return null;
  }

  return (
    <article
      className={`sports widget col-4 ${displaySize}-widget ${widgetState}`}
      ref={el => {
        widgetRef.current = [el];
      }}
    >
      <div className="sports-title-wrapper">
        {/* The empty self-closing div here is used to help center the title, since the context menu also takes up space. */}
        {widgetState === WIDGET_STATES.INTRO && <div />}
        {widgetState === WIDGET_STATES.FOLLOW_TEAMS && (
          <span
            className="sports-follow-teams-title"
            data-l10n-id="newtab-sports-widget-follow-teams-title"
            // If changing this number, also update isMaxSelected in SportsWidgetFollowTeams.
            data-l10n-args={JSON.stringify({ number: 3 })}
          />
        )}
        {widgetState === WIDGET_STATES.MATCHES && (
          <moz-button
            className="sports-back-button"
            type="icon ghost"
            iconsrc="chrome://global/skin/icons/arrow-left.svg"
            data-l10n-id="newtab-sports-widget-back-button"
            onClick={handleViewIntro}
            style={{ visibility: tournamentStarted ? "hidden" : "visible" }}
            aria-hidden={tournamentStarted}
          />
        )}
        {widgetState === WIDGET_STATES.MATCHES && (
          <div className="sports-matches-tabs" role="tablist">
            {getVisibleMatchesTabs(hasLiveGames, hasPreviousResults).map(
              ({ id, disabled }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={activeTab === id}
                  disabled={disabled}
                  className={`sports-matches-tab${activeTab === id ? " is-active" : ""}${disabled ? " is-disabled" : ""}`}
                  onClick={() => handleMatchesTabChange(id)}
                  data-l10n-id={`newtab-sports-widget-${id}`}
                />
              )
            )}
          </div>
        )}
        {widgetState === WIDGET_STATES.KEY_DATES && (
          <>
            <moz-button
              className="sports-back-button"
              type="icon ghost"
              iconsrc="chrome://global/skin/icons/arrow-left.svg"
              data-l10n-id="newtab-sports-widget-back-button"
              onClick={handleViewIntro}
            />
            <h3 data-l10n-id="newtab-sports-widget-key-dates"></h3>
          </>
        )}
        {widgetState === WIDGET_STATES.INTRO && (
          <div className="sports-intro-wrapper">
            <h2
              className="sports-intro-title"
              data-l10n-id="newtab-sports-widget-keep-tabs"
            />
            <p
              className="sports-intro-lede"
              data-l10n-id="newtab-sports-widget-get-updates"
            ></p>
          </div>
        )}
        {widgetState === WIDGET_STATES.FOLLOW_TEAMS ? (
          <button
            className="sports-cancel-button"
            data-l10n-id="newtab-sports-widget-cancel"
            onClick={handleCancelSelection}
          />
        ) : (
          <div className="sports-context-menu-wrapper">
            <moz-button
              className="sports-context-menu-button"
              iconSrc="chrome://global/skin/icons/more.svg"
              menuId="sports-context-menu"
              type="ghost"
            />
            <panel-list id="sports-context-menu">
              <panel-item
                data-l10n-id="newtab-sports-widget-menu-follow-teams"
                onClick={() => handleFollowTeams("context_menu")}
              />
              <panel-item
                data-l10n-id="newtab-sports-widget-menu-view-schedule"
                onClick={() => handleViewKeyDates("context_menu")}
              />
              <panel-item
                data-l10n-id="newtab-sports-widget-menu-view-upcoming"
                onClick={handleViewUpcoming}
              />
              <panel-item
                data-l10n-id="newtab-sports-widget-menu-view-results"
                onClick={handleViewResults}
                disabled={!hasPreviousResults}
              />
              {widgetsMayBeMaximized && (
                <panel-item submenu="sports-size-submenu">
                  <span data-l10n-id="newtab-widget-menu-change-size"></span>
                  <panel-list
                    ref={sizeSubmenuRef}
                    slot="submenu"
                    id="sports-size-submenu"
                  >
                    {["medium", "large"].map(size => (
                      <panel-item
                        key={size}
                        type="checkbox"
                        checked={widgetSize === size || undefined}
                        data-size={size}
                        data-l10n-id={`newtab-widget-size-${size}`}
                      />
                    ))}
                  </panel-list>
                </panel-item>
              )}
              <panel-item
                data-l10n-id="newtab-widget-menu-hide"
                onClick={handleSportsWidgetHide}
              />
              <panel-item
                data-l10n-id="newtab-sports-widget-menu-learn-more"
                onClick={handleLearnMore}
              />
            </panel-list>
          </div>
        )}
      </div>

      <div className="sports-body">
        {widgetState === WIDGET_STATES.FOLLOW_TEAMS && (
          <SportsWidgetFollowTeams
            teams={teams}
            initialSelectedTeams={selectedTeams}
            onSave={handleSaveSelection}
          />
        )}
        {widgetState === WIDGET_STATES.MATCHES && (
          <SportsMatchesView
            matchesTab={activeTab}
            hasLiveGames={hasLiveGames}
            size={widgetSize}
            previous={sportsWidgetData?.data?.matches?.previous ?? []}
            current={sportsWidgetData?.data?.matches?.current ?? []}
            next={sportsWidgetData?.data?.matches?.next ?? []}
          />
        )}
        {widgetState === WIDGET_STATES.KEY_DATES && (
          <SportsWidgetKeyDates handleViewMatches={handleViewMatches} />
        )}
        {widgetState === WIDGET_STATES.INTRO && (
          <>
            <div className="sports-buttons-wrapper">
              <moz-button
                type="primary"
                size={widgetSize === "medium" ? "small" : undefined}
                data-l10n-id="newtab-sports-widget-view-matches"
                className="sports-view-matches"
                onClick={() => handleViewMatches("widget")}
              />
              <moz-button
                type="secondary"
                size={widgetSize === "medium" ? "small" : undefined}
                data-l10n-id="newtab-sports-widget-follow-teams"
                className="sports-follow-teams-btn"
                onClick={() => handleFollowTeams("widget")}
              />
            </div>
            {liveEnabled && sportsWidgetData?.initialized && (
              <div className="sports-live-scores">
                {/* Live scores content */}
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function SportsWidgetFollowTeams({ teams, initialSelectedTeams, onSave }) {
  const [selectedTeams, setSelectedTeams] = useState(initialSelectedTeams);
  const [searchQuery, setSearchQuery] = useState("");
  const localizedNames = useLocalizedTeamNames(teams);
  const isMaxSelected = selectedTeams.length >= 3;

  function handleTeamToggle(teamKey, isChecked) {
    setSelectedTeams(prev =>
      isChecked ? [...prev, teamKey] : prev.filter(key => key !== teamKey)
    );
  }

  const sortedTeams = localizedNames
    ? [...teams].sort((a, b) =>
        localizedNames[a.key].localeCompare(localizedNames[b.key])
      )
    : [];
  const filteredTeams = searchQuery
    ? sortedTeams.filter(team =>
        localizedNames[team.key]
          .toLocaleLowerCase()
          .includes(searchQuery.toLocaleLowerCase())
      )
    : sortedTeams;

  return (
    <div className="sports-follow-teams">
      <moz-input-search
        data-l10n-id="newtab-sports-widget-search-country"
        className="sports-country-search"
        onInput={e => setSearchQuery(e.target.value)}
      />
      <div className="sports-follow-teams-list">
        {/* Wait until names are localized so users in other locales don't see a flicker of content in English. */}
        {localizedNames &&
          filteredTeams.map(team => {
            const isSelected = selectedTeams.includes(team.key);
            const isRowDisabled = !isSelected && isMaxSelected;
            const localizedName = localizedNames[team.key];
            return (
              <div
                key={team.key}
                className={`sports-follow-teams-row${isRowDisabled ? " is-disabled" : ""}`}
                onClick={e => {
                  // The checkbox already handles its own toggle; skip here so we don't toggle twice.
                  if (e.target.localName === "moz-checkbox") {
                    return;
                  }
                  if (isRowDisabled) {
                    return;
                  }
                  handleTeamToggle(team.key, !isSelected);
                }}
              >
                <moz-checkbox
                  checked={isSelected || undefined}
                  disabled={isRowDisabled ? true : undefined}
                  onChange={e => handleTeamToggle(team.key, e.target.checked)}
                  aria-label={localizedName}
                />
                <img
                  className="sports-team-flag"
                  src={team.icon_url}
                  alt=""
                  title={localizedName}
                />
                <span className="sports-team-name">{localizedName}</span>
              </div>
            );
          })}
      </div>
      <moz-button
        className="sports-done-button"
        data-l10n-id="newtab-sports-widget-done-button"
        type="primary"
        size="small"
        onClick={() => onSave(selectedTeams)}
      />
    </div>
  );
}

function SportsMatchesView({
  matchesTab,
  hasLiveGames,
  size,
  previous,
  current,
  next,
}) {
  const [showResultsList, setShowResultsList] = useState(false);
  const [showUpcomingList, setShowUpcomingList] = useState(false);
  const resultsPanelRef = useRef(null);
  const upcomingPanelRef = useRef(null);

  // When the user expands a tab into list mode, move keyboard focus to the
  // first match row in the just-revealed list. Without this, focus stays on
  // the "View all" button, which sits at the bottom of the widget — pressing
  // Tab from there moves focus *out* of the widget instead of into the new
  // content, creating a keyboard trap for screen reader / keyboard users.
  // We don't move focus when collapsing back to highlight view: focus
  // naturally remains on the "Show less" button the user just activated,
  // which is the expected behavior.
  useEffect(() => {
    if (showResultsList) {
      resultsPanelRef.current?.querySelector(".sports-match-row")?.focus();
    }
  }, [showResultsList]);
  useEffect(() => {
    if (showUpcomingList) {
      upcomingPanelRef.current?.querySelector(".sports-match-row")?.focus();
    }
  }, [showUpcomingList]);

  return (
    <div className="sports-matches-view">
      <div
        className="sports-matches-tab-panel"
        hidden={matchesTab !== MATCHES_TABS.RESULTS}
        ref={resultsPanelRef}
      >
        {showResultsList ? (
          <ul className="sports-matches-list">
            {previous.map(match => (
              <li
                key={`${match.home_team.key}-${match.away_team.key}-${match.date}`}
              >
                <SportsMatchRow match={match} variant="results" size="list" />
              </li>
            ))}
          </ul>
        ) : (
          previous[0] && (
            <div className="match-highlight-view">
              <SportsMatchRow
                match={previous[0]}
                variant="results"
                size={size}
              />
            </div>
          )
        )}
        {size === "large" && !!previous.length && (
          <moz-button
            type="secondary"
            data-l10n-id={
              showResultsList
                ? "newtab-sports-widget-show-less"
                : "newtab-sports-widget-view-all"
            }
            onClick={() => setShowResultsList(v => !v)}
          ></moz-button>
        )}
      </div>
      {hasLiveGames && (
        <div
          className="sports-matches-tab-panel"
          hidden={matchesTab !== MATCHES_TABS.NOW}
        >
          {current[0] && (
            <>
              <div className="match-highlight-view">
                <SportsMatchRow match={current[0]} variant="now" size={size} />
              </div>
              {/* TODO: Add onClick handler + play icon when we start implementing Watch dialog UI */}
              <moz-button
                type={size === "medium" ? "icon" : "default"}
                size={size === "medium" ? "small" : undefined}
                iconSrc="chrome://browser/skin/device-tv.svg"
                data-l10n-id={
                  size === "medium"
                    ? "newtab-sports-widget-watch-icon"
                    : "newtab-sports-widget-watch"
                }
              ></moz-button>
            </>
          )}
        </div>
      )}
      <div
        className="sports-matches-tab-panel"
        hidden={matchesTab !== MATCHES_TABS.UPCOMING}
        ref={upcomingPanelRef}
      >
        {showUpcomingList ? (
          <ul className="sports-matches-list">
            {next.map(match => (
              <li
                key={`${match.home_team.key}-${match.away_team.key}-${match.date}`}
              >
                <SportsMatchRow match={match} variant="upcoming" size="list" />
              </li>
            ))}
          </ul>
        ) : (
          next[0] && (
            <div className="match-highlight-view">
              <SportsMatchRow match={next[0]} variant="upcoming" size={size} />
            </div>
          )
        )}
        {!!next.length && (
          <moz-button
            type="secondary"
            size={size === "medium" ? "small" : undefined}
            data-l10n-id={
              showUpcomingList
                ? "newtab-sports-widget-show-less"
                : "newtab-sports-widget-view-all"
            }
            onClick={() => setShowUpcomingList(v => !v)}
          ></moz-button>
        )}
      </div>
    </div>
  );
}

const keyDatesList = [
  {
    stageL10nId: "newtab-sports-widget-group-stage",
    start: "2026-06-11",
    end: "2026-06-27",
  },
  {
    stageL10nId: "newtab-sports-widget-round-32",
    start: "2026-06-28",
    end: "2026-07-03",
  },
  {
    stageL10nId: "newtab-sports-widget-round-16",
    start: "2026-07-04",
    end: "2026-07-07",
  },
  {
    stageL10nId: "newtab-sports-widget-quarter-finals",
    start: "2026-07-09",
    end: "2026-07-11",
  },
  {
    stageL10nId: "newtab-sports-widget-semi-finals",
    start: "2026-07-14",
    end: "2026-07-15",
  },
  {
    stageL10nId: "newtab-sports-widget-bronze-finals",
    date: "2026-07-18",
  },
  {
    stageL10nId: "newtab-sports-widget-final",
    date: "2026-07-19",
  },
];

function SportsWidgetKeyDates({ handleViewMatches }) {
  return (
    <div className="sports-key-dates">
      <ul className="sports-key-dates-list">
        {keyDatesList.map(({ stageL10nId, start, end, date }) => (
          <li key={stageL10nId} className="sports-key-dates-item">
            <span data-l10n-id={stageL10nId} />
            <span
              data-l10n-id={
                date
                  ? "newtab-sports-widget-key-date"
                  : "newtab-sports-widget-key-date-range"
              }
              data-l10n-args={JSON.stringify(
                date
                  ? { date: new Date(date).getTime() }
                  : {
                      start: new Date(start).getTime(),
                      end: new Date(end).getTime(),
                    }
              )}
            />
          </li>
        ))}
      </ul>
      <moz-button
        type="secondary"
        size="small"
        data-l10n-id="newtab-sports-widget-view-matches"
        onClick={() => handleViewMatches("key_dates_state")}
      />
    </div>
  );
}

export { SportsWidget };
