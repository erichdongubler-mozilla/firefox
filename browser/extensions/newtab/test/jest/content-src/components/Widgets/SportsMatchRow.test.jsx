/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { render } from "@testing-library/react";
import { SportsMatchRow } from "content-src/components/Widgets/SportsWidget/SportsMatchRow";

const baseMatch = {
  home_team: { key: "ENG", name: "England" },
  away_team: { key: "USA", name: "United States" },
  date: "2026-05-08T14:00:00+00:00",
  status_type: null,
  home_score: 1,
  away_score: 0,
  home_extra: null,
  away_extra: null,
  home_penalty: null,
  away_penalty: null,
};

describe("<SportsMatchRow> upcoming variant", () => {
  it("renders home and away team codes", () => {
    const { container } = render(
      <SportsMatchRow match={baseMatch} variant="upcoming" />
    );
    const codes = container.querySelectorAll(".sports-match-code");
    expect(codes[0].textContent).toBe("ENG");
    expect(codes[1].textContent).toBe("USA");
  });

  it("renders match time element", () => {
    const { container } = render(
      <SportsMatchRow match={baseMatch} variant="upcoming" />
    );
    expect(
      container.querySelector(
        "[data-l10n-id='newtab-sports-widget-match-time']"
      )
    ).toBeInTheDocument();
  });

  it("renders match date when no special status", () => {
    const { container } = render(
      <SportsMatchRow match={baseMatch} variant="upcoming" />
    );
    expect(
      container.querySelector("[data-l10n-id='newtab-sports-widget-key-date']")
    ).toBeInTheDocument();
  });

  it("renders status label instead of date for a special status", () => {
    const { container } = render(
      <SportsMatchRow
        match={{ ...baseMatch, status_type: "postponed" }}
        variant="upcoming"
      />
    );
    expect(
      container.querySelector("[data-l10n-id='newtab-sports-widget-postponed']")
    ).toBeInTheDocument();
    expect(
      container.querySelector("[data-l10n-id='newtab-sports-widget-key-date']")
    ).not.toBeInTheDocument();
  });
});

describe("<SportsMatchRow> now variant", () => {
  it("renders home and away scores including extra time", () => {
    const { container } = render(
      <SportsMatchRow
        match={{
          ...baseMatch,
          home_score: 1,
          away_score: 0,
          home_extra: 1,
          away_extra: 0,
        }}
        variant="now"
      />
    );
    expect(container.querySelector(".sports-score-home").textContent).toBe("2");
    expect(container.querySelector(".sports-score-away").textContent).toBe("0");
  });
});

describe("<SportsMatchRow> results variant", () => {
  it("renders home and away scores including extra time", () => {
    const { container } = render(
      <SportsMatchRow
        match={{
          ...baseMatch,
          home_score: 1,
          away_score: 0,
          home_extra: 1,
          away_extra: 0,
        }}
        variant="results"
      />
    );
    expect(container.querySelector(".sports-score-home").textContent).toBe("2");
    expect(container.querySelector(".sports-score-away").textContent).toBe("0");
  });

  it("renders the Full time footer", () => {
    const { container } = render(
      <SportsMatchRow match={baseMatch} variant="results" />
    );
    expect(
      container.querySelector(
        "[data-l10n-id='newtab-sports-widget-match-full-time']"
      )
    ).toBeInTheDocument();
  });

  it("renders penalty scores and footer text when penalties are present", () => {
    const { container } = render(
      <SportsMatchRow
        match={{ ...baseMatch, home_penalty: 4, away_penalty: 3 }}
        variant="results"
      />
    );
    const penalties = container.querySelectorAll(".sports-score-penalty");
    expect(penalties[0].textContent).toBe("(4)");
    expect(penalties[1].textContent).toBe("(3)");
    expect(
      container.querySelector(
        "[data-l10n-id='newtab-sports-widget-match-penalties']"
      )
    ).toBeInTheDocument();
  });

  it("does not render penalty elements when no penalties", () => {
    const { container } = render(
      <SportsMatchRow match={baseMatch} variant="results" />
    );
    expect(container.querySelectorAll(".sports-score-penalty")).toHaveLength(0);
    expect(
      container.querySelector(
        "[data-l10n-id='newtab-sports-widget-match-penalties']"
      )
    ).not.toBeInTheDocument();
  });
});

describe("<SportsMatchRow> aria-label l10n", () => {
  function getAnchorL10n(container) {
    const anchor = container.querySelector("a.sports-match-row");
    return {
      id: anchor.getAttribute("data-l10n-id"),
      args: JSON.parse(anchor.getAttribute("data-l10n-args")),
    };
  }

  describe("results variant", () => {
    it("uses the results l10n id for a normal full-time result", () => {
      const { container } = render(
        <SportsMatchRow
          match={{ ...baseMatch, home_score: 3, away_score: 2 }}
          variant="results"
        />
      );
      const { id, args } = getAnchorL10n(container);
      expect(id).toBe("newtab-sports-widget-match-aria-label-results");
      expect(args).toEqual({
        homeTeam: "England",
        awayTeam: "United States",
        homeScore: 3,
        awayScore: 2,
      });
    });

    it("uses the results-penalties l10n id and includes penalty scores when the match went to a shootout", () => {
      const { container } = render(
        <SportsMatchRow
          match={{
            ...baseMatch,
            home_score: 3,
            away_score: 3,
            home_penalty: 5,
            away_penalty: 4,
          }}
          variant="results"
        />
      );
      const { id, args } = getAnchorL10n(container);
      expect(id).toBe(
        "newtab-sports-widget-match-aria-label-results-penalties"
      );
      expect(args.homePenalty).toBe(5);
      expect(args.awayPenalty).toBe(4);
    });

    it("adds extra-time goals into the announced scores", () => {
      const { container } = render(
        <SportsMatchRow
          match={{
            ...baseMatch,
            home_score: 2,
            away_score: 1,
            home_extra: 1,
            away_extra: 0,
          }}
          variant="results"
        />
      );
      const { args } = getAnchorL10n(container);
      expect(args.homeScore).toBe(3);
      expect(args.awayScore).toBe(1);
    });

    it("treats home_penalty === 0 as a real shootout value, not a missing one", () => {
      // Guards against a regression where a falsy check on home_penalty
      // would route a 0-goal shootout to the non-penalties ID.
      const { container } = render(
        <SportsMatchRow
          match={{
            ...baseMatch,
            home_score: 1,
            away_score: 1,
            home_penalty: 0,
            away_penalty: 3,
          }}
          variant="results"
        />
      );
      const { id, args } = getAnchorL10n(container);
      expect(id).toBe(
        "newtab-sports-widget-match-aria-label-results-penalties"
      );
      expect(args.homePenalty).toBe(0);
      expect(args.awayPenalty).toBe(3);
    });
  });

  describe("now variant", () => {
    it("uses the now l10n id with the current score", () => {
      const { container } = render(
        <SportsMatchRow
          match={{ ...baseMatch, home_score: 1, away_score: 0 }}
          variant="now"
        />
      );
      const { id, args } = getAnchorL10n(container);
      expect(id).toBe("newtab-sports-widget-match-aria-label-now");
      expect(args).toEqual(
        expect.objectContaining({
          homeTeam: "England",
          awayTeam: "United States",
          homeScore: 1,
          awayScore: 0,
        })
      );
    });
  });

  describe("upcoming variant", () => {
    it("uses the upcoming l10n id and passes the date timestamp for a scheduled match", () => {
      const { container } = render(
        <SportsMatchRow
          match={{ ...baseMatch, status_type: "scheduled" }}
          variant="upcoming"
        />
      );
      const { id, args } = getAnchorL10n(container);
      expect(id).toBe("newtab-sports-widget-match-aria-label-upcoming");
      expect(args.date).toBe(new Date(baseMatch.date).getTime());
    });

    it("falls back to the upcoming (scheduled) l10n id when status_type is missing", () => {
      // Defensive: API can omit status_type; the default scheduled string
      // must still be picked.
      const { container } = render(
        <SportsMatchRow
          match={{ ...baseMatch, status_type: null }}
          variant="upcoming"
        />
      );
      expect(getAnchorL10n(container).id).toBe(
        "newtab-sports-widget-match-aria-label-upcoming"
      );
    });

    it.each([
      ["delayed", "newtab-sports-widget-match-aria-label-upcoming-delayed"],
      ["postponed", "newtab-sports-widget-match-aria-label-upcoming-postponed"],
      ["suspended", "newtab-sports-widget-match-aria-label-upcoming-suspended"],
      ["cancelled", "newtab-sports-widget-match-aria-label-upcoming-cancelled"],
    ])(
      "picks the matching per-status l10n id when status_type is %s",
      (statusType, expectedId) => {
        const { container } = render(
          <SportsMatchRow
            match={{ ...baseMatch, status_type: statusType }}
            variant="upcoming"
          />
        );
        expect(getAnchorL10n(container).id).toBe(expectedId);
      }
    );
  });
});
