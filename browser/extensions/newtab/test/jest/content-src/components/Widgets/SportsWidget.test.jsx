/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { render, fireEvent } from "@testing-library/react";
import { INITIAL_STATE } from "common/Reducers.sys.mjs";
import { actionTypes as at } from "common/Actions.mjs";
import { WrapWithProvider } from "test/jest/test-utils";
import { SportsWidget } from "content-src/components/Widgets/SportsWidget/SportsWidget";

const PREF_NOVA_ENABLED = "nova.enabled";
const PREF_SPORTS_WIDGET_SIZE = "widgets.sportsWidget.size";

const defaultProps = {
  dispatch: jest.fn(),
  handleUserInteraction: jest.fn(),
};

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
});

describe("<SportsWidget> follow teams flow", () => {
  let dispatch;
  let handleUserInteraction;

  beforeEach(() => {
    dispatch = jest.fn();
    handleUserInteraction = jest.fn();
  });

  function renderInFollowState(selectedTeams = [], dataOverride) {
    return render(
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
  }

  it("renders the follow teams title and hides the intro wrapper when in the follow state", () => {
    const { container } = renderInFollowState();
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

  it("hides the context menu and shows a cancel button in the follow state", () => {
    const { container } = renderInFollowState();
    expect(
      container.querySelector(".sports-context-menu-wrapper")
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(".sports-cancel-button")
    ).toBeInTheDocument();
  });

  it("dispatches CHANGE_WIDGET_STATE back to intro when Cancel is clicked without saving teams", () => {
    const { container } = renderInFollowState();
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

  it("dispatches CHANGE_SELECTED_TEAMS and navigates to intro when Done is clicked", () => {
    const { container } = renderInFollowState([]);
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

  it("does not dispatch CHANGE_SELECTED_TEAMS when a country is checked without clicking Done", () => {
    const { container } = renderInFollowState([]);
    fireEvent.change(container.querySelector("moz-checkbox"), {
      target: { checked: true },
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS })
    );
  });

  it("saves the team removed from pre-selected teams when Done is clicked", () => {
    const { container } = renderInFollowState(["ALG"]);
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

  it("marks pre-selected teams as checked", () => {
    const { container } = renderInFollowState(["ALG"]);
    const checkboxes = container.querySelectorAll("moz-checkbox");
    expect(checkboxes[0].getAttribute("checked")).not.toBeNull();
    expect(checkboxes[1].getAttribute("checked")).toBeNull();
  });

  it("disables unselected checkboxes when 3 teams are already selected", () => {
    const { container } = renderInFollowState(["CAN", "AUS", "ALG"]);
    const checkboxes = container.querySelectorAll("moz-checkbox");
    const disabled = Array.from(checkboxes).filter(
      c => c.getAttribute("disabled") !== null
    );
    // 4 teams in fixture, 3 selected -> remaining 1 should be disabled
    expect(disabled.length).toBe(1);
  });

  it("expands to large-widget when in follow state even if size pref is medium", () => {
    const { container } = render(
      <WrapWithProvider
        state={makeState(
          { [PREF_SPORTS_WIDGET_SIZE]: "medium" },
          { widgetState: "sports-follow-state" }
        )}
      >
        <SportsWidget
          dispatch={dispatch}
          handleUserInteraction={handleUserInteraction}
        />
      </WrapWithProvider>
    );
    expect(container.querySelector(".sports.large-widget")).toBeInTheDocument();
    expect(
      container.querySelector(".sports.medium-widget")
    ).not.toBeInTheDocument();
  });

  it("filters the team list when a search query is entered", () => {
    const { container } = renderInFollowState();
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

  it("shows all teams when the search query is cleared", () => {
    const { container } = renderInFollowState();
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

  it("renders teams sorted alphabetically by name", () => {
    const { container } = renderInFollowState();
    const names = Array.from(
      container.querySelectorAll(".sports-team-name")
    ).map(el => el.textContent);
    expect(names).toEqual(["Algeria", "Australia", "Canada", "England"]);
  });

  it("renders a flag image for each team with src, empty alt, and a title tooltip", () => {
    const { container } = renderInFollowState();
    const flags = container.querySelectorAll(".sports-team-flag");
    expect(flags.length).toBe(4);
    expect(flags[0].getAttribute("src")).toBe("https://example.test/ALG.svg");
    expect(flags[0].getAttribute("alt")).toBe("");
    expect(flags[0].getAttribute("title")).toBe("Algeria");
  });

  it("sets aria-label on each checkbox to its team name", () => {
    const { container } = renderInFollowState();
    const checkboxes = container.querySelectorAll("moz-checkbox");
    expect(checkboxes[0].getAttribute("aria-label")).toBe("Algeria");
    expect(checkboxes[1].getAttribute("aria-label")).toBe("Australia");
    expect(checkboxes[2].getAttribute("aria-label")).toBe("Canada");
    expect(checkboxes[3].getAttribute("aria-label")).toBe("England");
  });

  it("toggles the checkbox when the flag image is clicked", () => {
    const { container } = renderInFollowState();
    fireEvent.click(container.querySelectorAll(".sports-team-flag")[0]);
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
        data: ["ALG"],
      })
    );
  });

  it("toggles the checkbox when the team name is clicked", () => {
    const { container } = renderInFollowState();
    fireEvent.click(container.querySelectorAll(".sports-team-name")[1]);
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
        data: ["AUS"],
      })
    );
  });

  it("does not toggle when clicking the flag on a row that is disabled by max-selection", () => {
    // 3 teams selected (ALG, AUS, CAN), the 4th (ENG) row is disabled.
    const { container } = renderInFollowState(["ALG", "AUS", "CAN"]);
    fireEvent.click(container.querySelectorAll(".sports-team-flag")[3]);
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_SPORTS_CHANGE_SELECTED_TEAMS,
        data: ["ALG", "AUS", "CAN"],
      })
    );
  });

  it("does not toggle twice when the user clicks the checkbox itself", () => {
    // Mimic a real checkbox click: both a change event AND a click event on the row fire.
    const { container } = renderInFollowState();
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

  it("sorts accented team names using locale-aware comparison", () => {
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
    const names = Array.from(
      container.querySelectorAll(".sports-team-name")
    ).map(el => el.textContent);
    expect(names).toEqual(["Canada", "Côte d'Ivoire", "Curaçao"]);
  });

  it("renders a row without crashing when icon_url is missing", () => {
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
    expect(container.querySelector(".sports-team-name").textContent).toBe(
      "Canada"
    );
    expect(container.querySelectorAll(".sports-team-flag").length).toBe(1);
  });

  it("renders no rows and does not crash when teams data is missing", () => {
    const { container } = renderInFollowState([], { teams: null, matches: [] });
    expect(container.querySelectorAll("moz-checkbox").length).toBe(0);
    expect(container.querySelector(".sports-follow-teams")).toBeInTheDocument();
  });

  it("renders no rows when teams is an empty array", () => {
    const { container } = renderInFollowState([], { teams: [], matches: [] });
    expect(container.querySelectorAll("moz-checkbox").length).toBe(0);
  });

  it("dispatches save_teams telemetry with the team count and widget size when Done is clicked", () => {
    const { container } = renderInFollowState([]);
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

  it("does not dispatch save_teams when the user checks then unchecks a team before Done", () => {
    const { container } = renderInFollowState([]);
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

  it("does not dispatch save_teams telemetry when Done is clicked with no teams selected", () => {
    const { container } = renderInFollowState([]);
    fireEvent.click(container.querySelector(".sports-done-button"));
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: at.WIDGETS_USER_EVENT,
        data: expect.objectContaining({ user_action: "save_teams" }),
      })
    );
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
            data: { current: [], previous: [], upcoming: [] },
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
      data: { current: [{}], previous: [], upcoming: [] },
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
      data: { current: [{}], previous: [], upcoming: [] },
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
      data: { current: [{}], previous: [], upcoming: [] },
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
      data: { current: [], previous: [{}], upcoming: [] },
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

  it("dispatches CHANGE_WIDGET_STATE to matches when the View schedule button is clicked", () => {
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

  it("should dispatch view_schedule telemetry when view-matches is clicked", () => {
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
          user_action: "view_schedule",
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

  it("should dispatch view_schedule telemetry with key_dates_state source when View matches is clicked from key dates", () => {
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
          user_action: "view_schedule",
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
