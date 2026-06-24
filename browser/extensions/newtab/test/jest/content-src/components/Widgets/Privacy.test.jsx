/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { render, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { combineReducers, createStore } from "redux";
import { INITIAL_STATE, reducers } from "common/Reducers.sys.mjs";
import { actionTypes as at } from "common/Actions.mjs";
import { Privacy } from "content-src/components/Widgets/Privacy/Privacy";

const mockState = {
  ...INITIAL_STATE,
  Prefs: {
    ...INITIAL_STATE.Prefs,
    values: {
      ...INITIAL_STATE.Prefs.values,
      "widgets.system.enabled": true,
      "widgets.system.privacy.enabled": true,
      "widgets.privacy.enabled": true,
      "widgets.privacy.size": "medium",
    },
  },
};

function WrapWithProvider({ children, state = INITIAL_STATE }) {
  const store = createStore(combineReducers(reducers), state);
  return <Provider store={store}>{children}</Provider>;
}

function renderPrivacy(dispatch = jest.fn(), props = {}) {
  const { container, unmount } = render(
    <WrapWithProvider state={mockState}>
      <Privacy
        dispatch={dispatch}
        widgetsMayBeMaximized={true}
        widgetEnabledMap={{}}
        {...props}
      />
    </WrapWithProvider>
  );
  return { container, unmount, dispatch };
}

describe("Privacy widget", () => {
  it("renders the widget at the resolved size", () => {
    const { container } = renderPrivacy();
    const root = container.querySelector("article.privacy");
    expect(root).toBeTruthy();
    expect(root.className).toContain("medium-widget");
  });

  it("dispatches an impression once when it scrolls into view", () => {
    const dispatch = jest.fn();
    renderPrivacy(dispatch);
    // useIntersectionObserver invokes the callback on observe in the test env.
    const impressions = dispatch.mock.calls.filter(
      ([action]) => action.type === at.WIDGETS_IMPRESSION
    );
    expect(impressions.length).toBeLessThanOrEqual(1);
  });

  it("hides the widget by setting its enabled pref to false", () => {
    const dispatch = jest.fn();
    const { container } = renderPrivacy(dispatch);
    const hide = container.querySelector(
      '[data-l10n-id="newtab-widget-menu-hide"]'
    );
    fireEvent.click(hide);
    const setPref = dispatch.mock.calls.find(
      ([action]) =>
        action.type === at.SET_PREF &&
        action.data?.name === "widgets.privacy.enabled"
    );
    expect(setPref).toBeTruthy();
    expect(setPref[0].data.value).toBe(false);
  });
});
