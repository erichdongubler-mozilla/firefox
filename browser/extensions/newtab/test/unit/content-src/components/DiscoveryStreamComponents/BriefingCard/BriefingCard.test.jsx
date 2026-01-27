import React from "react";
import { mount } from "enzyme";
import { Provider } from "react-redux";
import { INITIAL_STATE, reducers } from "common/Reducers.sys.mjs";
import { BriefingCard } from "content-src/components/DiscoveryStreamComponents/BriefingCard/BriefingCard";
import { SafeAnchor } from "content-src/components/DiscoveryStreamComponents/SafeAnchor/SafeAnchor";
import { combineReducers, createStore } from "redux";
import { actionTypes as at } from "common/Actions.mjs";

const DEFAULT_PROPS = {
  sectionClassNames: "col-1-medium",
  headlines: [
    {
      id: "headline-1",
      url: "https://example.com/1",
      title: "First Headline",
      publisher: "Publisher One",
      icon_src: "https://example.com/icon1.png",
    },
    {
      id: "headline-2",
      url: "https://example.com/2",
      title: "Second Headline",
      publisher: "Publisher Two",
      icon_src: "https://example.com/icon2.png",
    },
    {
      id: "headline-3",
      url: "https://example.com/3",
      title: "Third Headline",
      publisher: "Publisher Three",
      icon_src: "https://example.com/icon3.png",
    },
  ],
  lastUpdated: Date.now(),
};

function WrapWithProvider({ children, state = INITIAL_STATE }) {
  let store = createStore(combineReducers(reducers), state);
  return <Provider store={store}>{children}</Provider>;
}

describe("<BriefingCard>", () => {
  let wrapper;
  let sandbox;
  let dispatch;
  let clock;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    dispatch = sandbox.stub();
    wrapper = mount(
      <WrapWithProvider>
        <BriefingCard dispatch={dispatch} {...DEFAULT_PROPS} />
      </WrapWithProvider>
    );
  });

  afterEach(() => {
    sandbox.restore();
    if (clock) {
      clock.restore();
    }
  });

  it("should render with 3 headlines", () => {
    assert.ok(wrapper.exists());
    assert.lengthOf(wrapper.find(".briefing-card-headline"), 3);
  });

  it("should render headline with title, link, publisher, and icon", () => {
    const firstHeadline = wrapper.find(SafeAnchor).at(0);
    assert.equal(firstHeadline.prop("url"), "https://example.com/1");

    const title = firstHeadline.find(".briefing-card-headline-title");
    assert.equal(title.text(), "First Headline");

    const source = firstHeadline.find(".briefing-card-headline-source");
    assert.equal(source.text(), "Publisher One");

    const publisherIcon = firstHeadline.find(".briefing-card-headline-icon");
    assert.equal(publisherIcon.prop("src"), "https://example.com/icon1.png");
  });

  it("should dispatch BLOCK_URL on dismiss", () => {
    const store = createStore(combineReducers(reducers), INITIAL_STATE);
    sandbox.spy(store, "dispatch");

    wrapper = mount(
      <Provider store={store}>
        <BriefingCard {...DEFAULT_PROPS} />
      </Provider>
    );

    wrapper.find("panel-item").simulate("click");

    assert.calledOnce(store.dispatch);
    const action = store.dispatch.getCall(0).firstArg;
    assert.equal(action.type, at.BLOCK_URL);
    assert.lengthOf(action.data, 3);
    assert.equal(action.source, "DAILY_BRIEFING");
  });

  it("should hide card after dismiss", () => {
    assert.lengthOf(wrapper.find(".briefing-card"), 1);

    wrapper.find("panel-item").simulate("click");
    wrapper.update();

    assert.lengthOf(wrapper.find(".briefing-card"), 0);
  });

  it("should apply sectionClassNames to briefing card", () => {
    const card = wrapper.find(".briefing-card");
    assert.isTrue(card.hasClass("col-1-medium"));
  });

  describe("timestamp", () => {
    beforeEach(() => {
      clock = sandbox.useFakeTimers(
        new Date("2024-03-20T10:30:00.000Z").getTime()
      );
    });

    afterEach(() => {
      if (clock) {
        clock.restore();
        clock = null;
      }
    });

    it("should show timestamp within 15 minutes", () => {
      const lastUpdated = new Date("2024-03-20T10:20:00.000Z").getTime();
      wrapper = mount(
        <WrapWithProvider>
          <BriefingCard {...DEFAULT_PROPS} lastUpdated={lastUpdated} />
        </WrapWithProvider>
      );

      assert.lengthOf(wrapper.find(".briefing-card-timestamp"), 1);
    });

    it("should hide timestamp after 15 minutes", () => {
      const lastUpdated = new Date("2024-03-20T10:00:00.000Z").getTime();
      wrapper = mount(
        <WrapWithProvider>
          <BriefingCard {...DEFAULT_PROPS} lastUpdated={lastUpdated} />
        </WrapWithProvider>
      );

      assert.lengthOf(wrapper.find(".briefing-card-timestamp"), 0);
    });
  });
});
