/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { act, render, fireEvent } from "@testing-library/react";
import { INITIAL_STATE } from "common/Reducers.sys.mjs";
import { actionTypes as at } from "common/Actions.mjs";
import { WrapWithProvider } from "test/jest/test-utils";
import { SportsWidget } from "content-src/components/Widgets/SportsWidget/SportsWidget";

const mockTeams = [
  { key: "CAN", name: "Canada" },
  { key: "AUS", name: "Australia" },
  { key: "ALG", name: "Algeria" },
  { key: "IRQ", name: "Iraq" },
  { key: "ITA", name: "Italy" },
  { key: "ESP", name: "Spain" },
  { key: "NGA", name: "Nigeria" },
  { key: "MAR", name: "Morocco" },
  { key: "POR", name: "Portugal" },
  { key: "GER", name: "Germany" },
  { key: "SEN", name: "Senegal" },
];

const emptyMatches = { previous: [], current: [], next: [] };

const mockMatch = {
  home_team: { key: "ENG", name: "England" },
  away_team: { key: "USA", name: "United States" },
  date: "2026-05-08T14:00:00+00:00",
  status_type: "live",
  home_score: 1,
  away_score: 0,
  home_extra: null,
  away_extra: null,
  home_penalty: null,
  away_penalty: null,
  // `query` makes the row focusable (tabIndex=0) so the focus-on-expand
  // assertions below have something to receive focus.
  query: "ENG vs USA",
};

const PREF_NOVA_ENABLED = "nova.enabled";
const PREF_SPORTS_WIDGET_SIZE = "widgets.sportsWidget.size";

const defaultProps = {
  dispatch: jest.fn(),
  handleUserInteraction: jest.fn(),
};

// Default Fluent mock returns the en-US `.label` value for each
// requested team name ID. Individual tests can override `formatMessages`.
function mockDocumentL10n() {
  const fluentLabels = {
    "newtab-sports-widget-team-name-label-bih": "Bosnia and Herzegovina",
    "newtab-sports-widget-team-name-label-civ": "Ivory Coast",
    "newtab-sports-widget-team-name-label-cod": "DR Congo",
    "newtab-sports-widget-team-name-label-eng": "England",
    "newtab-sports-widget-team-name-label-sco": "Scotland",
  };
  document.l10n = {
    formatMessages: jest.fn(async ids =>
      ids.map(({ id }) => ({
        value: null,
        attributes: [{ name: "label", value: fluentLabels[id] }],
      }))
    ),
  };
}

function makeTeams() {
  return [
    {
      key: "CAN",
      global_team_id: 90000966,
      name: "Canada",
      region: "CAN",
      colors: ["#FF0000", "#FFFFFF", "#D52B1E"],
      icon_url: "https://example.test/CAN.svg",
      eliminated: false,
    },
    {
      key: "AUS",
      global_team_id: 90001244,
      name: "Australia",
      region: "AUS",
      colors: ["#012169", "#FFFFFF", "#E4002B"],
      icon_url: "https://example.test/AUS.svg",
      eliminated: false,
    },
    {
      key: "ALG",
      global_team_id: 90001054,
      name: "Algeria",
      region: "ALG",
      colors: ["#006233", "#FFFFFF", "#D21034"],
      icon_url: "https://example.test/ALG.svg",
      eliminated: false,
    },
    {
      key: "ENG",
      global_team_id: 90000858,
      name: "England",
      region: "ENG",
      colors: ["#FFFFFF", "#CE1126"],
      icon_url: "https://example.test/ENG.svg",
      eliminated: false,
    },
  ];
}

function makeState(prefOverrides = {}, sportsWidgetOverrides = {}) {
  return {
    ...INITIAL_STATE,
    Prefs: {
      ...INITIAL_STATE.Prefs,
      values: {
        ...INITIAL_STATE.Prefs.values,
        [PREF_NOVA_ENABLED]: true,
        [PREF_SPORTS_WIDGET_SIZE]: "medium",
        ...prefOverrides,
      },
    },
    SportsWidget: { ...INITIAL_STATE.SportsWidget, ...sportsWidgetOverrides },
  };
}

describe("<SportsWidget>", () => {
  it("should render the sports widget", () => {
    const { container } = render(
      <WrapWithProvider state={makeState()}>
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    expect(container.querySelector(".sports")).toBeInTheDocument();
  });

  it("should return null when nova.enabled is false", () => {
    const { container } = render(
      <WrapWithProvider state={makeState({ [PREF_NOVA_ENABLED]: false })}>
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    expect(container.querySelector(".sports")).not.toBeInTheDocument();
  });

  it("should apply the medium-widget class by default", () => {
    const { container } = render(
      <WrapWithProvider state={makeState()}>
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    expect(
      container.querySelector(".sports.medium-widget")
    ).toBeInTheDocument();
  });

  it("should apply the large-widget class when size pref is large", () => {
    const { container } = render(
      <WrapWithProvider
        state={makeState({ [PREF_SPORTS_WIDGET_SIZE]: "large" })}
      >
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    expect(container.querySelector(".sports.large-widget")).toBeInTheDocument();
  });

  it("falls back to the registry default size (medium) when no size pref is set", () => {
    const { container } = render(
      <WrapWithProvider state={makeState({ [PREF_SPORTS_WIDGET_SIZE]: "" })}>
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    expect(
      container.querySelector(".sports.medium-widget")
    ).toBeInTheDocument();
    expect(
      container.querySelector(".sports.large-widget")
    ).not.toBeInTheDocument();
  });

  it("should always render the intro wrapper", () => {
    const { container } = render(
      <WrapWithProvider state={makeState()}>
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    expect(
      container.querySelector(".sports-intro-wrapper")
    ).toBeInTheDocument();
  });

  it("should show the keep-tabs title", () => {
    const { container } = render(
      <WrapWithProvider state={makeState()}>
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    expect(
      container.querySelector("[data-l10n-id='newtab-sports-widget-keep-tabs']")
    ).toBeInTheDocument();
  });

  it("should render the view-matches button", () => {
    const { container } = render(
      <WrapWithProvider state={makeState()}>
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    expect(
      container.querySelector(
        "[data-l10n-id='newtab-sports-widget-view-matches']"
      )
    ).toBeInTheDocument();
  });

  it("should apply size=small to buttons on medium size", () => {
    const { container } = render(
      <WrapWithProvider state={makeState()}>
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    expect(
      container.querySelector(".sports-view-matches").getAttribute("size")
    ).toBe("small");
    expect(
      container.querySelector(".sports-follow-teams-btn").getAttribute("size")
    ).toBe("small");
  });

  it("should not apply size=small to buttons on large size", () => {
    const { container } = render(
      <WrapWithProvider
        state={makeState({ [PREF_SPORTS_WIDGET_SIZE]: "large" })}
      >
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    expect(
      container.querySelector(".sports-view-matches").getAttribute("size")
    ).toBeNull();
    expect(
      container.querySelector(".sports-follow-teams-btn").getAttribute("size")
    ).toBeNull();
  });

  it("opens on match schedule when the tournament has started", () => {
    const { container } = render(
      <WrapWithProvider
        state={makeState(
          {},
          {
            data: {
              teams: [],
              matches: { current: [mockMatch], previous: [], next: [] },
            },
          }
        )}
      >
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    expect(
      container.querySelector(".sports.sports-matches")
    ).toBeInTheDocument();
    expect(
      container.querySelector(".sports-intro-wrapper")
    ).not.toBeInTheDocument();
  });
});

describe("<SportsWidget> follow teams flow", () => {
  let dispatch;
  let handleUserInteraction;

  beforeEach(() => {
    dispatch = jest.fn();
    handleUserInteraction = jest.fn();
    mockDocumentL10n();
  });

  afterEach(() => {
    delete document.l10n;
  });

  async function renderInFollowState(selectedTeams = [], dataOverride) {
    const result = render(
      <WrapWithProvider
        state={makeState(
          {},
          {
            widgetState: "sports-follow-state",
            selectedTeams,
            data: dataOverride ?? { teams: makeTeams(), matches: [] },
          }
        )}
      >
        <SportsWidget
          dispatch={dispatch}
          handleUserInteraction={handleUserInteraction}
        />
      </WrapWithProvider>
    );
    // Flush the resolveNames effect so localizedNames is populated and
    // rows are rendered before the test queries the DOM.
    await act(async () => {});
    return result;
  }

  it("renders the follow teams title and hides the intro wrapper when in the follow state", async () => {
    const { container } = await renderInFollowState();
    expect(
      container.querySelector(".sports-follow-teams-title")
    ).toBeInTheDocument();
    expect(
      container.querySelector(".sports-intro-wrapper")
    ).not.toBeInTheDocument();
  });

  it("dispatches CHANGE_WIDGET_STATE with the follow state when Follow Teams is clicked", () => {
    const { container } = render(
      <WrapWithProvider state={makeState()}>
        <SportsWidget
          dispatch={dispatch}
          handleUserInteraction={handleUserInteraction}
        />
      </WrapWithProvider>
    );
    fireEvent.click(container.querySelector(".sports-follow-teams-btn"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
        data: "sports-follow-state",
      })
    );
  });

  it("hides the context menu and shows a cancel button in the follow state", async () => {
    const { container } = await renderInFollowState();
    expect(
      container.querySelector(".sports-context-menu-wrapper")
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(".sports-cancel-button")
    ).toBeInTheDocument();
  });

  it("dispatches CHANGE_WIDGET_STATE back to intro when Cancel is clicked without saving teams", async () => {
    const { container } = await renderInFollowState();
    fireEvent.change(container.querySelector("moz-checkbox"), {
      target: { checked: true },
    });
    fireEvent.click(container.querySelector(".sports-cancel-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
        data: "sports-intro",
      })
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS })
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_USER_EVENT,
        data: expect.objectContaining({ user_action: "save_teams" }),
      })
    );
  });

  it("dispatches CHANGE_SELECTED_TEAMS and navigates to intro when Done is clicked", async () => {
    const { container } = await renderInFollowState([]);
    fireEvent.change(container.querySelector("moz-checkbox"), {
      target: { checked: true },
    });
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
        data: ["ALG"],
      })
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
        data: "sports-intro",
      })
    );
  });

  it("does not dispatch CHANGE_SELECTED_TEAMS when a country is checked without clicking Done", async () => {
    const { container } = await renderInFollowState([]);
    fireEvent.change(container.querySelector("moz-checkbox"), {
      target: { checked: true },
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS })
    );
  });

  it("saves the team removed from pre-selected teams when Done is clicked", async () => {
    const { container } = await renderInFollowState(["ALG"]);
    fireEvent.change(container.querySelector("moz-checkbox"), {
      target: { checked: false },
    });
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
        data: [],
      })
    );
  });

  it("marks pre-selected teams as checked", async () => {
    const { container } = await renderInFollowState(["ALG"]);
    const checkboxes = container.querySelectorAll("moz-checkbox");
    expect(checkboxes[0].getAttribute("checked")).not.toBeNull();
    expect(checkboxes[1].getAttribute("checked")).toBeNull();
  });

  it("disables unselected checkboxes when 3 teams are already selected", async () => {
    const { container } = await renderInFollowState(["CAN", "AUS", "ALG"]);
    const checkboxes = container.querySelectorAll("moz-checkbox");
    const disabled = Array.from(checkboxes).filter(
      c => c.getAttribute("disabled") !== null
    );
    // 4 teams in fixture, 3 selected -> remaining 1 should be disabled
    expect(disabled.length).toBe(1);
  });

  it("expands to large-widget when in follow state even if size pref is medium", async () => {
    const { container } = render(
      <WrapWithProvider
        state={makeState(
          { [PREF_SPORTS_WIDGET_SIZE]: "medium" },
          {
            widgetState: "sports-follow-state",
            data: { teams: mockTeams, matches: emptyMatches },
          }
        )}
      >
        <SportsWidget
          dispatch={dispatch}
          handleUserInteraction={handleUserInteraction}
        />
      </WrapWithProvider>
    );
    await act(async () => {});
    expect(container.querySelector(".sports.large-widget")).toBeInTheDocument();
    expect(
      container.querySelector(".sports.medium-widget")
    ).not.toBeInTheDocument();
  });

  it("filters the team list when a search query is entered", async () => {
    const { container } = await renderInFollowState();
    const searchInput = container.querySelector("moz-input-search");
    Object.defineProperty(searchInput, "value", {
      value: "can",
      configurable: true,
    });
    fireEvent.input(searchInput);
    const rows = container.querySelectorAll(".sports-follow-teams-row");
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector(".sports-team-name").textContent).toBe(
      "Canada"
    );
  });

  it("shows all teams when the search query is cleared", async () => {
    const { container } = await renderInFollowState();
    const searchInput = container.querySelector("moz-input-search");
    Object.defineProperty(searchInput, "value", {
      value: "can",
      configurable: true,
    });
    fireEvent.input(searchInput);
    Object.defineProperty(searchInput, "value", {
      value: "",
      configurable: true,
    });
    fireEvent.input(searchInput);
    expect(container.querySelectorAll("moz-checkbox").length).toBe(4);
  });

  it("renders teams sorted alphabetically by name", async () => {
    const { container } = await renderInFollowState();
    const names = Array.from(
      container.querySelectorAll(".sports-team-name")
    ).map(el => el.textContent);
    expect(names).toEqual(["Algeria", "Australia", "Canada", "England"]);
  });

  it("shows eliminated teams as disabled rows with the eliminated l10n id", async () => {
    const teamsWithEliminated = makeTeams().map(team =>
      team.key === "AUS" || team.key === "ENG"
        ? { ...team, eliminated: true }
        : team
    );
    const { container } = await renderInFollowState([], {
      teams: teamsWithEliminated,
      matches: [],
    });
    const rows = Array.from(
      container.querySelectorAll(".sports-follow-teams-row")
    );
    const resolvedNames = rows.map(r => {
      const nameSpan = r.querySelector(".sports-team-name");
      const args = nameSpan.getAttribute("data-l10n-args");
      return args ? JSON.parse(args).teamName : nameSpan.textContent;
    });
    expect(resolvedNames).toEqual([
      "Algeria",
      "Australia",
      "Canada",
      "England",
    ]);
    const eliminatedRows = rows.filter(
      r =>
        r.querySelector(".sports-team-name").getAttribute("data-l10n-id") ===
        "newtab-sports-widget-team-name-eliminated"
    );
    expect(eliminatedRows.length).toBe(2);
    eliminatedRows.forEach(row => {
      expect(row.classList.contains("is-disabled")).toBe(true);
      expect(
        row.querySelector("moz-checkbox").getAttribute("disabled")
      ).not.toBeNull();
      const nameSpan = row.querySelector(".sports-team-name");
      expect(JSON.parse(nameSpan.getAttribute("data-l10n-args"))).toEqual({
        teamName: expect.any(String),
      });
    });
  });

  it("excludes eliminated teams from the saved selection when Done is clicked", async () => {
    // User previously followed CAN, AUS, ENG. AUS gets eliminated after the
    // fact — the saved selection should drop AUS so the user isn't stuck
    // following a team they can no longer toggle off.
    const teamsWithEliminated = makeTeams().map(team =>
      team.key === "AUS" ? { ...team, eliminated: true } : team
    );
    const { container } = await renderInFollowState(["CAN", "AUS", "ENG"], {
      teams: teamsWithEliminated,
      matches: [],
    });
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
        data: ["CAN", "ENG"],
      })
    );
  });

  it("does not count eliminated teams toward the 3-team selection cap", async () => {
    // User has 3 selected (ALG, AUS, CAN) but AUS is eliminated. Only 2 count
    // toward the cap, so ENG (the unselected, non-eliminated team) stays
    // enabled.
    const teamsWithEliminated = makeTeams().map(team =>
      team.key === "AUS" ? { ...team, eliminated: true } : team
    );
    const { container } = await renderInFollowState(["ALG", "AUS", "CAN"], {
      teams: teamsWithEliminated,
      matches: [],
    });
    const rows = Array.from(
      container.querySelectorAll(".sports-follow-teams-row")
    );
    const engRow = rows.find(
      r => r.querySelector(".sports-team-name").textContent === "England"
    );
    expect(engRow.classList.contains("is-disabled")).toBe(false);
  });

  it("sorts follow-teams rows by the resolved localized name, not the Merino source name", async () => {
    document.l10n.formatMessages = jest.fn(async ids =>
      ids.map(({ id }) => ({
        value: null,
        attributes: [
          {
            name: "label",
            value:
              id === "newtab-sports-widget-team-name-label-eng"
                ? "a-England"
                : "unused-fallback",
          },
        ],
      }))
    );
    const { container } = await renderInFollowState();
    const names = Array.from(
      container.querySelectorAll(".sports-team-name")
    ).map(el => el.textContent);
    expect(names).toEqual(["a-England", "Algeria", "Australia", "Canada"]);
  });

  it("renders a flag image for each team with src, empty alt, and a title tooltip", async () => {
    const { container } = await renderInFollowState();
    const flags = container.querySelectorAll(".sports-team-flag");
    expect(flags.length).toBe(4);
    expect(flags[0].getAttribute("src")).toBe("https://example.test/ALG.svg");
    expect(flags[0].getAttribute("alt")).toBe("");
    expect(flags[0].getAttribute("title")).toBe("Algeria");
  });

  it("sets aria-label on each checkbox to its team name", async () => {
    const { container } = await renderInFollowState();
    const checkboxes = container.querySelectorAll("moz-checkbox");
    expect(checkboxes[0].getAttribute("aria-label")).toBe("Algeria");
    expect(checkboxes[1].getAttribute("aria-label")).toBe("Australia");
    expect(checkboxes[2].getAttribute("aria-label")).toBe("Canada");
    expect(checkboxes[3].getAttribute("aria-label")).toBe("England");
  });

  it("toggles the checkbox when the flag image is clicked", async () => {
    const { container } = await renderInFollowState();
    fireEvent.click(container.querySelectorAll(".sports-team-flag")[0]);
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
        data: ["ALG"],
      })
    );
  });

  it("toggles the checkbox when the team name is clicked", async () => {
    const { container } = await renderInFollowState();
    fireEvent.click(container.querySelectorAll(".sports-team-name")[1]);
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
        data: ["AUS"],
      })
    );
  });

  it("does not toggle when clicking the flag on a row that is disabled by max-selection", async () => {
    // 3 teams selected (ALG, AUS, CAN), the 4th (ENG) row is disabled.
    const { container } = await renderInFollowState(["ALG", "AUS", "CAN"]);
    fireEvent.click(container.querySelectorAll(".sports-team-flag")[3]);
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
        data: ["ALG", "AUS", "CAN"],
      })
    );
  });

  it("does not toggle twice when the user clicks the checkbox itself", async () => {
    // Mimic a real checkbox click: both a change event AND a click event on the row fire.
    const { container } = await renderInFollowState();
    const checkbox = container.querySelector("moz-checkbox");
    fireEvent.change(checkbox, { target: { checked: true } });
    fireEvent.click(checkbox);
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
        data: ["ALG"],
      })
    );
  });

  it("sorts accented team names using locale-aware comparison", async () => {
    // Mock "Côte d'Ivoire" for CIV to verify the sort comparator is
    // locale-aware for accented characters.
    document.l10n.formatMessages = jest.fn(async ids =>
      ids.map(() => ({
        value: null,
        attributes: [{ name: "label", value: "Côte d'Ivoire" }],
      }))
    );
    const { container } = render(
      <WrapWithProvider
        state={makeState(
          {},
          {
            widgetState: "sports-follow-state",
            data: {
              teams: [
                { key: "CUW", name: "Curaçao" },
                { key: "CIV", name: "Côte d'Ivoire" },
                { key: "CAN", name: "Canada" },
              ],
              matches: [],
            },
          }
        )}
      >
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    await act(async () => {});
    const names = Array.from(
      container.querySelectorAll(".sports-team-name")
    ).map(el => el.textContent);
    expect(names).toEqual(["Canada", "Côte d'Ivoire", "Curaçao"]);
  });

  it("renders a row without crashing when icon_url is missing", async () => {
    const { container } = render(
      <WrapWithProvider
        state={makeState(
          {},
          {
            widgetState: "sports-follow-state",
            data: {
              teams: [{ key: "CAN", name: "Canada" }],
              matches: [],
            },
          }
        )}
      >
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );
    await act(async () => {});
    expect(container.querySelector(".sports-team-name").textContent).toBe(
      "Canada"
    );
    expect(container.querySelectorAll(".sports-team-flag").length).toBe(1);
  });

  it("renders no rows and does not crash when teams data is missing", async () => {
    const { container } = await renderInFollowState([], {
      teams: null,
      matches: [],
    });
    expect(container.querySelectorAll("moz-checkbox").length).toBe(0);
    expect(container.querySelector(".sports-follow-teams")).toBeInTheDocument();
  });

  it("renders no rows when teams is an empty array", async () => {
    const { container } = await renderInFollowState([], {
      teams: [],
      matches: [],
    });
    expect(container.querySelectorAll("moz-checkbox").length).toBe(0);
  });

  it("dispatches save_teams telemetry with the team count and widget size when Done is clicked", async () => {
    const { container } = await renderInFollowState([]);
    fireEvent.change(container.querySelector("moz-checkbox"), {
      target: { checked: true },
    });
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_USER_EVENT,
        data: expect.objectContaining({
          widget_name: "sports_widget",
          widget_source: "widget",
          user_action: "save_teams",
          action_value: 1,
          widget_size: "medium",
        }),
      })
    );
  });

  it("does not dispatch save_teams when the user checks then unchecks a team before Done", async () => {
    const { container } = await renderInFollowState([]);
    const firstCheckbox = container.querySelector("moz-checkbox");
    fireEvent.change(firstCheckbox, { target: { checked: true } });
    fireEvent.change(firstCheckbox, { target: { checked: false } });
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_USER_EVENT,
        data: expect.objectContaining({ user_action: "save_teams" }),
      })
    );
  });

  it("does not dispatch save_teams telemetry when Done is clicked with no teams selected", async () => {
    const { container } = await renderInFollowState([]);
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_USER_EVENT,
        data: expect.objectContaining({ user_action: "save_teams" }),
      })
    );
  });

  it("filters follow-teams rows by the resolved localized name via the search input", async () => {
    // Override ENG so the localized name differs from the Merino source.
    // Substring "ingl" matches the localized form but not "England".
    document.l10n.formatMessages = jest.fn(async ids =>
      ids.map(({ id }) => ({
        value: null,
        attributes: [
          {
            name: "label",
            value:
              id === "newtab-sports-widget-team-name-label-eng"
                ? "Inglaterra"
                : "unused-fallback",
          },
        ],
      }))
    );
    const { container } = await renderInFollowState();
    const search = container.querySelector("moz-input-search");

    Object.defineProperty(search, "value", {
      value: "ingl",
      configurable: true,
    });
    fireEvent.input(search);
    let names = Array.from(container.querySelectorAll(".sports-team-name")).map(
      el => el.textContent
    );
    expect(names).toEqual(["Inglaterra"]);

    Object.defineProperty(search, "value", {
      value: "england",
      configurable: true,
    });
    fireEvent.input(search);
    names = Array.from(container.querySelectorAll(".sports-team-name")).map(
      el => el.textContent
    );
    expect(names).toEqual([]);
  });

  it("does not render rows until localizedNames is populated", async () => {
    let resolveFn;
    document.l10n = {
      formatMessages: jest.fn(
        () =>
          new Promise(r => {
            resolveFn = r;
          })
      ),
    };
    const { container } = render(
      <WrapWithProvider
        state={makeState(
          {},
          {
            widgetState: "sports-follow-state",
            data: { teams: makeTeams(), matches: [] },
          }
        )}
      >
        <SportsWidget {...defaultProps} />
      </WrapWithProvider>
    );

    expect(container.querySelectorAll(".sports-follow-teams-row")).toHaveLength(
      0
    );

    await act(async () => {
      resolveFn([
        { value: null, attributes: [{ name: "label", value: "England" }] },
      ]);
    });
    expect(
      container.querySelectorAll(".sports-follow-teams-row").length
    ).toBeGreaterThan(0);
  });
});

describe("<SportsWidget> matches view", () => {
  let dispatch;
  let handleUserInteraction;

  beforeEach(() => {
    dispatch = jest.fn();
    handleUserInteraction = jest.fn();
  });

  function renderInMatchesState(overrides = {}) {
    return render(
      <WrapWithProvider
        state={makeState(
          {},
          {
            widgetState: "sports-matches",
            data: { teams: [], matches: emptyMatches },
            ...overrides,
          }
        )}
      >
        <SportsWidget
          dispatch={dispatch}
          handleUserInteraction={handleUserInteraction}
        />
      </WrapWithProvider>
    );
  }

  it("applies sports-matches class, shows tab list, and hides the intro wrapper", () => {
    const { container } = renderInMatchesState();
    expect(
      container.querySelector(".sports.sports-matches")
    ).toBeInTheDocument();
    expect(container.querySelector(".sports-matches-tabs")).toBeInTheDocument();
    expect(
      container.querySelector(".sports-intro-wrapper")
    ).not.toBeInTheDocument();
  });

  it("shows the back button and dispatches CHANGE_WIDGET_STATE to intro when clicked", () => {
    const { container } = renderInMatchesState();
    const backButton = container.querySelector(".sports-back-button");
    expect(backButton.style.visibility).not.toBe("hidden");
    fireEvent.click(backButton);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
        data: "sports-intro",
      })
    );
  });

  it("hides the back button once the tournament has started", () => {
    const { container } = renderInMatchesState({
      data: {
        teams: [],
        matches: { current: [mockMatch], previous: [], next: [] },
      },
    });
    expect(
      container.querySelector(".sports-back-button").style.visibility
    ).toBe("hidden");
  });

  it("shows the Now tab only when there are live games", () => {
    const { container: noLive } = renderInMatchesState();
    expect(
      noLive.querySelector("[data-l10n-id='newtab-sports-widget-now']")
    ).not.toBeInTheDocument();

    const { container: withLive } = renderInMatchesState({
      data: {
        teams: [],
        matches: { current: [mockMatch], previous: [], next: [] },
      },
    });
    expect(
      withLive.querySelector("[data-l10n-id='newtab-sports-widget-now']")
    ).toBeInTheDocument();
  });

  it("marks the active tab based on matchesTab state", () => {
    const { container } = renderInMatchesState({ matchesTab: "results" });
    const activeTab = container.querySelector(".sports-matches-tab.is-active");
    expect(activeTab.getAttribute("data-l10n-id")).toBe(
      "newtab-sports-widget-results"
    );
  });

  it("defaults to Now on load when there are live games", () => {
    const { container } = renderInMatchesState({
      matchesTab: "upcoming",
      data: {
        teams: [],
        matches: { current: [mockMatch], previous: [], next: [] },
      },
    });
    expect(
      container
        .querySelector(".sports-matches-tab.is-active")
        .getAttribute("data-l10n-id")
    ).toBe("newtab-sports-widget-now");
  });

  it("disables the results tab and prevents dispatch when there are no previous results", () => {
    const { container } = renderInMatchesState();
    const resultsTab = container.querySelector(
      "[data-l10n-id='newtab-sports-widget-results']"
    );
    expect(resultsTab.disabled).toBe(true);
    fireEvent.click(resultsTab);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: at.WIDGETS_SPORTS_CHANGE_MATCHES_TAB })
    );
  });

  it("enables the results tab when there are previous results", () => {
    const { container } = renderInMatchesState({
      data: {
        teams: [],
        matches: { current: [], previous: [mockMatch], next: [] },
      },
    });
    expect(
      container.querySelector("[data-l10n-id='newtab-sports-widget-results']")
        .disabled
    ).toBe(false);
  });

  it("dispatches CHANGE_MATCHES_TAB when a tab is clicked", () => {
    const { container } = renderInMatchesState({ matchesTab: "results" });
    fireEvent.click(
      container.querySelector("[data-l10n-id='newtab-sports-widget-upcoming']")
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_MATCHES_TAB,
        data: "upcoming",
      })
    );
  });

  it("dispatches CHANGE_WIDGET_STATE to matches when the View matches button is clicked", () => {
    const { container } = render(
      <WrapWithProvider state={makeState()}>
        <SportsWidget
          dispatch={dispatch}
          handleUserInteraction={handleUserInteraction}
        />
      </WrapWithProvider>
    );
    fireEvent.click(
      container.querySelector(
        "[data-l10n-id='newtab-sports-widget-view-matches']"
      )
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
        data: "sports-matches",
      })
    );
  });
});

describe("<SportsWidget> keyboard accessibility", () => {
  // Without focus management, the "View all" button sits at the bottom of
  // the widget — pressing it leaves keyboard focus at the bottom edge, so a
  // Tab keypress moves focus *out* of the widget instead of into the newly-
  // revealed list. The widget moves focus to the first match row in the new
  // list to avoid this trap.
  function renderWithResults() {
    return render(
      <WrapWithProvider
        state={makeState(
          { [PREF_SPORTS_WIDGET_SIZE]: "large" },
          {
            widgetState: "sports-matches",
            matchesTab: "results",
            data: {
              teams: [],
              matches: {
                previous: [
                  mockMatch,
                  {
                    ...mockMatch,
                    date: "2026-05-09T14:00:00+00:00",
                    home_score: 2,
                  },
                ],
                current: [],
                next: [],
              },
            },
          }
        )}
      >
        <SportsWidget dispatch={jest.fn()} handleUserInteraction={jest.fn()} />
      </WrapWithProvider>
    );
  }

  function renderWithUpcoming() {
    return render(
      <WrapWithProvider
        state={makeState(
          { [PREF_SPORTS_WIDGET_SIZE]: "large" },
          {
            widgetState: "sports-matches",
            matchesTab: "upcoming",
            data: {
              teams: [],
              matches: {
                // A `previous` entry is needed to keep tournamentStarted
                // truthy so the widget stays in the matches view.
                previous: [mockMatch],
                current: [],
                next: [
                  { ...mockMatch, status_type: "scheduled" },
                  {
                    ...mockMatch,
                    date: "2026-05-10T14:00:00+00:00",
                    status_type: "scheduled",
                    home_score: null,
                  },
                ],
              },
            },
          }
        )}
      >
        <SportsWidget dispatch={jest.fn()} handleUserInteraction={jest.fn()} />
      </WrapWithProvider>
    );
  }

  it("moves keyboard focus to the first match row when expanding the Results list", () => {
    const { container } = renderWithResults();
    const resultsPanel = [
      ...container.querySelectorAll(".sports-matches-tab-panel"),
    ].find(p => !p.hasAttribute("hidden"));
    expect(resultsPanel).toBeTruthy();
    // Sanity: before expanding, only the highlight row is rendered.
    expect(resultsPanel.querySelectorAll(".sports-match-row")).toHaveLength(1);

    fireEvent.click(
      resultsPanel.querySelector(
        "[data-l10n-id='newtab-sports-widget-view-all']"
      )
    );

    const rows = resultsPanel.querySelectorAll(".sports-match-row");
    expect(rows).toHaveLength(2);
    expect(document.activeElement).toBe(rows[0]);
  });

  it("moves keyboard focus to the first match row when expanding the Upcoming list", () => {
    const { container } = renderWithUpcoming();
    const upcomingPanel = [
      ...container.querySelectorAll(".sports-matches-tab-panel"),
    ].find(p => !p.hasAttribute("hidden"));
    expect(upcomingPanel).toBeTruthy();

    fireEvent.click(
      upcomingPanel.querySelector(
        "[data-l10n-id='newtab-sports-widget-view-all']"
      )
    );

    const rows = upcomingPanel.querySelectorAll(".sports-match-row");
    expect(rows).toHaveLength(2);
    expect(document.activeElement).toBe(rows[0]);
  });

  it("does not steal focus on initial render when in highlight view", () => {
    // Regression guard: if the focus-on-expand effect ever drops its
    // `if (showResultsList)` guard, it would fire on mount too and yank
    // focus to a match row before any user input.
    const preMountFocus = document.activeElement;
    const { container } = renderWithResults();
    const firstRow = container.querySelector(".sports-match-row");
    expect(document.activeElement).not.toBe(firstRow);
    expect(document.activeElement).toBe(preMountFocus);
  });
});

describe("<SportsWidget> Results tab View all button", () => {
  function renderResultsAtSize(widgetSize, previous = [mockMatch]) {
    return render(
      <WrapWithProvider
        state={makeState(
          { [PREF_SPORTS_WIDGET_SIZE]: widgetSize },
          {
            widgetState: "sports-matches",
            matchesTab: "results",
            data: {
              teams: [],
              matches: { previous, current: [], next: [] },
            },
          }
        )}
      >
        <SportsWidget dispatch={jest.fn()} handleUserInteraction={jest.fn()} />
      </WrapWithProvider>
    );
  }

  function findResultsViewAllButton(container) {
    const resultsPanel = [
      ...container.querySelectorAll(".sports-matches-tab-panel"),
    ].find(panel => !panel.hasAttribute("hidden"));
    return resultsPanel?.querySelector(
      "[data-l10n-id='newtab-sports-widget-view-all']"
    );
  }

  it("renders the View all button on the results tab when widget size is large", () => {
    const { container } = renderResultsAtSize("large");
    const viewAllButton = findResultsViewAllButton(container);
    expect(viewAllButton).toBeInTheDocument();
    expect(viewAllButton.getAttribute("size")).toBeNull();
  });

  it("renders the View all button on the results tab when widget size is medium", () => {
    const { container } = renderResultsAtSize("medium");
    const viewAllButton = findResultsViewAllButton(container);
    expect(viewAllButton).toBeInTheDocument();
    expect(viewAllButton.getAttribute("size")).toBe("small");
  });

  it("does not render the View all button when there are no previous results", () => {
    const { container } = renderResultsAtSize("medium", []);
    expect(findResultsViewAllButton(container)).toBeNull();
  });
});

describe("<SportsWidget> Watch button (live tab)", () => {
  // The Watch button on the live tab swaps between an icon-only variant
  // (medium widget) and a labelled variant (large widget). The two cases
  // also use different Fluent ids because moz-button only renders icon-only
  // when no `.label` attribute is set — see _SportsWidget.scss notes and the
  // separate `newtab-sports-widget-watch-icon` message.
  function renderLive(size) {
    return render(
      <WrapWithProvider
        state={makeState(
          { [PREF_SPORTS_WIDGET_SIZE]: size },
          {
            widgetState: "sports-matches",
            matchesTab: "now",
            data: {
              teams: [],
              matches: { previous: [], current: [mockMatch], next: [] },
            },
          }
        )}
      >
        <SportsWidget dispatch={jest.fn()} handleUserInteraction={jest.fn()} />
      </WrapWithProvider>
    );
  }

  function findWatchButton(container) {
    return [...container.querySelectorAll("moz-button")].find(b => {
      const id = b.getAttribute("data-l10n-id");
      return (
        id === "newtab-sports-widget-watch" ||
        id === "newtab-sports-widget-watch-icon"
      );
    });
  }

  it("renders an icon-only Watch button when the widget is medium", () => {
    const { container } = renderLive("medium");
    const button = findWatchButton(container);
    expect(button).toBeTruthy();
    expect(button.getAttribute("type")).toBe("icon");
    // Uses the no-`.label` variant so moz-button doesn't add the .labelled
    // class — otherwise its CSS would render the visible "Watch" text.
    expect(button.getAttribute("data-l10n-id")).toBe(
      "newtab-sports-widget-watch-icon"
    );
    expect(button.getAttribute("iconSrc")).toBe(
      "chrome://browser/skin/device-tv.svg"
    );
  });

  it("renders a labelled Watch button when the widget is large", () => {
    const { container } = renderLive("large");
    const button = findWatchButton(container);
    expect(button).toBeTruthy();
    expect(button.getAttribute("type")).toBe("default");
    expect(button.getAttribute("data-l10n-id")).toBe(
      "newtab-sports-widget-watch"
    );
  });

  it("does not render the Watch button when there is no live match", () => {
    const { container } = render(
      <WrapWithProvider
        state={makeState(
          { [PREF_SPORTS_WIDGET_SIZE]: "medium" },
          {
            widgetState: "sports-matches",
            matchesTab: "upcoming",
            data: {
              teams: [],
              // Need a previous match so tournamentStarted stays truthy and
              // the widget renders the matches view at all, but no `current`
              // matches means the Now tab + Watch button shouldn't render.
              matches: { previous: [mockMatch], current: [], next: [] },
            },
          }
        )}
      >
        <SportsWidget dispatch={jest.fn()} handleUserInteraction={jest.fn()} />
      </WrapWithProvider>
    );
    expect(findWatchButton(container)).toBeUndefined();
  });
});

describe("<SportsWidget> telemetry", () => {
  let dispatch;
  let handleUserInteraction;

  beforeEach(() => {
    dispatch = jest.fn();
    handleUserInteraction = jest.fn();
  });

  function renderWidget(size = "medium") {
    return render(
      <WrapWithProvider state={makeState({ [PREF_SPORTS_WIDGET_SIZE]: size })}>
        <SportsWidget
          dispatch={dispatch}
          handleUserInteraction={handleUserInteraction}
        />
      </WrapWithProvider>
    );
  }

  it("should dispatch view_matches telemetry when view-matches is clicked", () => {
    const { container } = renderWidget();
    fireEvent.click(
      container.querySelector(
        "[data-l10n-id='newtab-sports-widget-view-matches']"
      )
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_USER_EVENT,
        data: expect.objectContaining({
          widget_source: "widget",
          user_action: "view_matches",
        }),
      })
    );
    expect(handleUserInteraction).toHaveBeenCalledWith("sportsWidget");
  });

  it("should dispatch view_key_dates telemetry with context_menu source when the View schedule menu item is clicked", () => {
    const { container } = renderWidget();
    fireEvent.click(
      container.querySelector(
        "[data-l10n-id='newtab-sports-widget-menu-view-schedule']"
      )
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_USER_EVENT,
        data: expect.objectContaining({
          widget_source: "context_menu",
          user_action: "view_key_dates",
        }),
      })
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_WIDGET_STATE,
        data: "sports-key-dates",
      })
    );
  });

  it("should dispatch view_matches telemetry with key_dates_state source when View matches is clicked from key dates", () => {
    const { container } = render(
      <WrapWithProvider
        state={makeState({}, { widgetState: "sports-key-dates" })}
      >
        <SportsWidget
          dispatch={dispatch}
          handleUserInteraction={handleUserInteraction}
        />
      </WrapWithProvider>
    );
    fireEvent.click(
      container.querySelector(
        ".sports-key-dates [data-l10n-id='newtab-sports-widget-view-matches']"
      )
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_USER_EVENT,
        data: expect.objectContaining({
          widget_source: "key_dates_state",
          user_action: "view_matches",
        }),
      })
    );
    expect(handleUserInteraction).toHaveBeenCalledWith("sportsWidget");
  });

  it("should dispatch follow_teams telemetry when the follow-teams button is clicked", () => {
    const { container } = renderWidget();
    fireEvent.click(container.querySelector(".sports-follow-teams-btn"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_USER_EVENT,
        data: expect.objectContaining({
          widget_source: "widget",
          user_action: "follow_teams",
        }),
      })
    );
    expect(handleUserInteraction).toHaveBeenCalledWith("sportsWidget");
  });
});
