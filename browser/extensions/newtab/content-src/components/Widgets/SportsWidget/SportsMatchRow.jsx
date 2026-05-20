/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import React from "react";

const STATUS_L10N_MAP = {
  delayed: "newtab-sports-widget-delayed",
  postponed: "newtab-sports-widget-postponed",
  suspended: "newtab-sports-widget-suspended",
  cancelled: "newtab-sports-widget-cancelled",
};

const UPCOMING_STATUS_ARIA_L10N_MAP = {
  delayed: "newtab-sports-widget-match-aria-label-upcoming-delayed",
  postponed: "newtab-sports-widget-match-aria-label-upcoming-postponed",
  suspended: "newtab-sports-widget-match-aria-label-upcoming-suspended",
  cancelled: "newtab-sports-widget-match-aria-label-upcoming-cancelled",
};

function ScorePill({
  homeScore,
  awayScore,
  homePenalty,
  awayPenalty,
  variant,
}) {
  return (
    <div className={`sports-score-pill sports-score-pill-${variant}`}>
      {homePenalty !== null && homePenalty !== undefined && (
        <span className="sports-score-penalty">({homePenalty})</span>
      )}
      <span className="sports-score-home">{homeScore}</span>
      <span aria-hidden="true">-</span>
      <span className="sports-score-away">{awayScore}</span>
      {awayPenalty !== null && awayPenalty !== undefined && (
        <span className="sports-score-penalty">({awayPenalty})</span>
      )}
    </div>
  );
}

function SportsMatchRow({ match, variant, size = "large" }) {
  const {
    home_team,
    away_team,
    date,
    status_type,
    home_score,
    away_score,
    home_extra,
    away_extra,
    home_penalty,
    away_penalty,
  } = match;
  const dateTimestamp = new Date(date).getTime();
  // (developer note): Assumes home_score/away_score exclude extra time goals
  const displayHomeScore = home_score + (home_extra || 0);
  const displayAwayScore = away_score + (away_extra || 0);
  // A match went to a shootout only when both penalty scores are present.
  // Checking both guards against asymmetric/corrupt data where one side is
  // null — which would otherwise pass a `null` into the aria-label args.
  const hasPenalties =
    home_penalty !== null &&
    home_penalty !== undefined &&
    away_penalty !== null &&
    away_penalty !== undefined;

  // Picks the Fluent message + args used to translate the row's aria-label.
  // We pick a separate Fluent ID per sub-case (penalty shootout for results,
  // non-scheduled status for upcoming) instead of using Fluent selectors, so
  // translators see complete sentences and the strings are independently
  // translatable.
  function getAriaLabelL10n() {
    const teams = { homeTeam: home_team.name, awayTeam: away_team.name };
    if (variant === "results") {
      if (hasPenalties) {
        return {
          id: "newtab-sports-widget-match-aria-label-results-penalties",
          args: {
            ...teams,
            homeScore: displayHomeScore,
            awayScore: displayAwayScore,
            homePenalty: home_penalty,
            awayPenalty: away_penalty,
          },
        };
      }
      return {
        id: "newtab-sports-widget-match-aria-label-results",
        args: {
          ...teams,
          homeScore: displayHomeScore,
          awayScore: displayAwayScore,
        },
      };
    }
    if (variant === "now") {
      return {
        id: "newtab-sports-widget-match-aria-label-now",
        args: {
          ...teams,
          homeScore: displayHomeScore,
          awayScore: displayAwayScore,
        },
      };
    }
    // Upcoming. Non-scheduled statuses use a per-status Fluent ID; the
    // default ("scheduled") announces kickoff time/date.
    const upcomingId =
      UPCOMING_STATUS_ARIA_L10N_MAP[status_type] ||
      "newtab-sports-widget-match-aria-label-upcoming";
    return {
      id: upcomingId,
      args: { ...teams, date: dateTimestamp },
    };
  }
  const ariaLabelL10n = getAriaLabelL10n();

  function renderMiddle() {
    switch (variant) {
      case "now":
        return (
          <ScorePill
            homeScore={displayHomeScore}
            awayScore={displayAwayScore}
            variant="now"
          />
        );
      case "results": {
        return (
          <div className="sports-match-result">
            <ScorePill
              homeScore={displayHomeScore}
              awayScore={displayAwayScore}
              homePenalty={home_penalty}
              awayPenalty={away_penalty}
              variant="results"
            />
            <div className="sports-match-result-footer">
              <span data-l10n-id="newtab-sports-widget-match-full-time" />
              {hasPenalties && (
                <>
                  <span aria-hidden="true">•</span>
                  <span data-l10n-id="newtab-sports-widget-match-penalties" />
                </>
              )}
            </div>
          </div>
        );
      }
      // Default is the upcoming variant
      default: {
        const statusL10nId = STATUS_L10N_MAP[status_type];
        const dateArgs = JSON.stringify({ date: dateTimestamp });
        return (
          <div className="sports-match-upcoming">
            <span
              className="sports-match-time"
              data-l10n-id="newtab-sports-widget-match-time"
              data-l10n-args={dateArgs}
            />
            {statusL10nId ? (
              <span
                className="sports-widget-match-status"
                data-l10n-id={statusL10nId}
              />
            ) : (
              <span
                className="sports-match-date"
                data-l10n-id="newtab-sports-widget-key-date"
                data-l10n-args={dateArgs}
              />
            )}
          </div>
        );
      }
    }
  }

  return (
    <a
      className={`sports-match-row sports-match-row-${size}`}
      data-l10n-id={ariaLabelL10n.id}
      data-l10n-args={JSON.stringify(ariaLabelL10n.args)}
      href=""
    >
      {/* (developer note): Replace href with SERP link. */}
      <div className="sports-match-team">
        <img
          className="sports-match-flag"
          src={home_team.icon_url}
          alt={home_team.name}
          title={home_team.name}
        />
        <span className="sports-match-code">{home_team.key}</span>
      </div>
      {renderMiddle()}
      <div className="sports-match-team">
        <img
          className="sports-match-flag"
          src={away_team.icon_url}
          alt={away_team.name}
          title={away_team.name}
        />
        <span className="sports-match-code">{away_team.key}</span>
      </div>
    </a>
  );
}

export { SportsMatchRow };
