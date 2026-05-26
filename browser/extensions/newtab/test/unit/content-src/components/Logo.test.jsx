/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import React from "react";
import { mount } from "enzyme";
import { Provider } from "react-redux";
import { INITIAL_STATE, reducers } from "common/Reducers.sys.mjs";
import { combineReducers, createStore } from "redux";
import {
  LOGO_VARIATIONS,
  Logo,
  PREF_LOGO_VARIATION,
  pickVariant,
} from "content-src/components/Logo/Logo";
import { LogoSpinSmooth } from "content-src/components/Logo/variants/LogoSpinSmooth";
import { SpinBallSmall } from "content-src/components/Logo/variants/SpinBallSmall";

function buildState(prefOverrides = {}) {
  return {
    ...INITIAL_STATE,
    Prefs: {
      ...INITIAL_STATE.Prefs,
      values: {
        ...INITIAL_STATE.Prefs.values,
        ...prefOverrides,
      },
    },
  };
}

function WrapWithProvider({ children, prefOverrides = {} }) {
  const store = createStore(
    combineReducers(reducers),
    buildState(prefOverrides)
  );
  return <Provider store={store}>{children}</Provider>;
}

function makeMatchMediaMock({ reduceMotion = false } = {}) {
  return query => ({
    matches: query === "(prefers-reduced-motion: reduce)" ? reduceMotion : true,
    addEventListener() {},
    removeEventListener() {},
  });
}

describe("<Logo>", () => {
  let originalMatchMedia;
  let originalDir;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = makeMatchMediaMock();
    originalDir = document.dir;
    document.dir = "ltr";
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.dir = originalDir;
  });

  it("should render the standard logo wrapper", () => {
    const wrapper = mount(
      <WrapWithProvider>
        <Logo />
      </WrapWithProvider>
    );
    assert.ok(wrapper.find("h1.logo-and-wordmark-wrapper").exists());
    assert.ok(wrapper.find("div.logo-and-wordmark").exists());
    assert.ok(wrapper.find("div.wordmark").exists());
  });

  it("should render the default logo when no variation is configured", () => {
    const wrapper = mount(
      <WrapWithProvider>
        <Logo />
      </WrapWithProvider>
    );
    assert.ok(wrapper.find("div.logo").exists());
    assert.isFalse(wrapper.find(SpinBallSmall).exists());
  });

  // @backward-compat { version 153 }
  // The describe block below can be removed after Firefox 153 hits Release.
  describe("logo variation selection", () => {
    it("renders SpinBallSmall when trainhopConfig.logo.variation is set", () => {
      const wrapper = mount(
        <WrapWithProvider
          prefOverrides={{
            trainhopConfig: { logo: { variation: "spin-ball-small" } },
          }}
        >
          <Logo />
        </WrapWithProvider>
      );
      assert.ok(wrapper.find(SpinBallSmall).exists());
      assert.isFalse(wrapper.find("div.logo").exists());
    });

    it("renders SpinBallSmall when PREF_LOGO_VARIATION is set", () => {
      const wrapper = mount(
        <WrapWithProvider
          prefOverrides={{ [PREF_LOGO_VARIATION]: "spin-ball-small" }}
        >
          <Logo />
        </WrapWithProvider>
      );
      assert.ok(wrapper.find(SpinBallSmall).exists());
      assert.isFalse(wrapper.find("div.logo").exists());
    });

    it("renders LogoSpinSmooth when PREF_LOGO_VARIATION is 'logo-spin-smooth'", () => {
      const wrapper = mount(
        <WrapWithProvider
          prefOverrides={{ [PREF_LOGO_VARIATION]: "logo-spin-smooth" }}
        >
          <Logo />
        </WrapWithProvider>
      );
      assert.ok(wrapper.find(LogoSpinSmooth).exists());
      assert.isFalse(wrapper.find("div.logo").exists());
    });

    it("prefers trainhopConfig over PREF_LOGO_VARIATION", () => {
      const wrapper = mount(
        <WrapWithProvider
          prefOverrides={{
            trainhopConfig: { logo: { variation: "spin-ball-small" } },
            [PREF_LOGO_VARIATION]: "this-id-does-not-exist",
          }}
        >
          <Logo />
        </WrapWithProvider>
      );
      assert.ok(wrapper.find(SpinBallSmall).exists());
    });

    it("falls back to the pref when trainhopConfig is empty string", () => {
      const wrapper = mount(
        <WrapWithProvider
          prefOverrides={{
            trainhopConfig: { logo: { variation: "" } },
            [PREF_LOGO_VARIATION]: "spin-ball-small",
          }}
        >
          <Logo />
        </WrapWithProvider>
      );
      assert.ok(wrapper.find(SpinBallSmall).exists());
    });

    it("falls back to default logo when variant ID is unknown", () => {
      const wrapper = mount(
        <WrapWithProvider
          prefOverrides={{ [PREF_LOGO_VARIATION]: "this-id-does-not-exist" }}
        >
          <Logo />
        </WrapWithProvider>
      );
      assert.ok(wrapper.find("div.logo").exists());
      assert.isFalse(wrapper.find(SpinBallSmall).exists());
    });

    it("still renders the variant when prefers-reduced-motion: reduce (motion is suppressed at click time, not in selection)", () => {
      window.matchMedia = makeMatchMediaMock({ reduceMotion: true });
      const wrapper = mount(
        <WrapWithProvider
          prefOverrides={{
            trainhopConfig: { logo: { variation: "spin-ball-small" } },
          }}
        >
          <Logo />
        </WrapWithProvider>
      );
      assert.ok(wrapper.find(SpinBallSmall).exists());
      assert.isFalse(wrapper.find("div.logo").exists());
    });
  });
});

// @backward-compat { version 153 }
// All of the describe blocks below can be removed after Firefox 153 hits
// Release.
describe("pickVariant", () => {
  const env = { viewportWidth: 1920, isLTR: true };

  it("returns null for an empty or null variant ID", () => {
    assert.isNull(pickVariant(null, env));
    assert.isNull(pickVariant("", env));
    assert.isNull(pickVariant(undefined, env));
  });

  it("returns null for an unknown variant ID", () => {
    assert.isNull(pickVariant("this-id-does-not-exist", env));
  });

  it("returns the variant entry when constraints are satisfied", () => {
    const result = pickVariant("spin-ball-small", env);
    assert.strictEqual(result, LOGO_VARIATIONS["spin-ball-small"]);
  });

  describe("constraint gating + fallback chain", () => {
    const TEMP_ID = "test-only-temp-variant";
    const HEAD_ID = "test-only-chain-head";
    const TempComponent = () => null;
    const HeadComponent = () => null;

    afterEach(() => {
      delete LOGO_VARIATIONS[TEMP_ID];
      delete LOGO_VARIATIONS[HEAD_ID];
    });

    it("falls back when the width gate fails", () => {
      LOGO_VARIATIONS[TEMP_ID] = {
        component: TempComponent,
        minViewportWidth: 5000,
        requiresLTR: false,
        fallback: null,
      };
      const result = pickVariant(TEMP_ID, {
        viewportWidth: 1024,
        isLTR: true,
      });
      assert.isNull(result);
    });

    it("falls back when an LTR-required variant is rendered RTL", () => {
      LOGO_VARIATIONS[TEMP_ID] = {
        component: TempComponent,
        minViewportWidth: 0,
        requiresLTR: true,
        fallback: null,
      };
      const result = pickVariant(TEMP_ID, {
        viewportWidth: 1024,
        isLTR: false,
      });
      assert.isNull(result);
    });

    it("walks the fallback chain to a satisfying variant", () => {
      LOGO_VARIATIONS[HEAD_ID] = {
        component: HeadComponent,
        minViewportWidth: 5000,
        requiresLTR: false,
        fallback: "spin-ball-small",
      };
      const result = pickVariant(HEAD_ID, {
        viewportWidth: 1024,
        isLTR: true,
      });
      assert.strictEqual(result, LOGO_VARIATIONS["spin-ball-small"]);
    });

    it("terminates on cycles without infinite-looping", () => {
      LOGO_VARIATIONS[TEMP_ID] = {
        component: TempComponent,
        minViewportWidth: 5000,
        requiresLTR: false,
        fallback: HEAD_ID,
      };
      LOGO_VARIATIONS[HEAD_ID] = {
        component: HeadComponent,
        minViewportWidth: 5000,
        requiresLTR: false,
        fallback: TEMP_ID,
      };
      const result = pickVariant(HEAD_ID, {
        viewportWidth: 1024,
        isLTR: true,
      });
      assert.isNull(result);
    });
  });
});

describe("<SpinBallSmall>", () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = makeMatchMediaMock();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders an aria-hidden SVG with the shared and variant classes", () => {
    const wrapper = mount(<SpinBallSmall />);
    const svg = wrapper.find("svg");
    assert.ok(svg.exists());
    assert.equal(svg.prop("aria-hidden"), "true");
    assert.include(svg.prop("className"), "logo-variation-small");
    assert.include(svg.prop("className"), "spin-ball-small");
  });

  it("plays animations on first click, resetting currentTime to 0", () => {
    const wrapper = mount(<SpinBallSmall />);
    const svg = wrapper.find("svg").getDOMNode();
    const anim = {
      playState: "paused",
      play: sinon.spy(),
      currentTime: 999,
    };
    svg.getAnimations = sinon.stub().returns([anim]);

    wrapper.find("svg").simulate("click");

    assert.equal(anim.currentTime, 0);
    assert.calledOnce(anim.play);
  });

  it("ignores clicks while animations are running", () => {
    const wrapper = mount(<SpinBallSmall />);
    const svg = wrapper.find("svg").getDOMNode();
    const anim = {
      playState: "running",
      play: sinon.spy(),
      currentTime: 1.5,
    };
    svg.getAnimations = sinon.stub().returns([anim]);

    wrapper.find("svg").simulate("click");

    assert.notCalled(anim.play);
    assert.equal(anim.currentTime, 1.5);
  });

  it("restarts animations on click after they finish", () => {
    const wrapper = mount(<SpinBallSmall />);
    const svg = wrapper.find("svg").getDOMNode();
    const anim = {
      playState: "finished",
      play: sinon.spy(),
      currentTime: 5.03,
    };
    svg.getAnimations = sinon.stub().returns([anim]);

    wrapper.find("svg").simulate("click");

    assert.equal(anim.currentTime, 0);
    assert.calledOnce(anim.play);
  });

  it("does nothing when getAnimations returns an empty list", () => {
    const wrapper = mount(<SpinBallSmall />);
    const svg = wrapper.find("svg").getDOMNode();
    svg.getAnimations = sinon.stub().returns([]);

    assert.doesNotThrow(() => wrapper.find("svg").simulate("click"));
  });

  it("does not play animations when prefers-reduced-motion is set, but stays clickable", () => {
    window.matchMedia = makeMatchMediaMock({ reduceMotion: true });
    const wrapper = mount(<SpinBallSmall />);
    const svg = wrapper.find("svg").getDOMNode();
    const anim = {
      playState: "paused",
      play: sinon.spy(),
      currentTime: 0,
    };
    svg.getAnimations = sinon.stub().returns([anim]);

    assert.doesNotThrow(() => wrapper.find("svg").simulate("click"));
    assert.notCalled(anim.play);
  });
});

// @backward-compat { version 153 }
// Can be removed after Firefox 153 hits Release.
describe("<LogoSpinSmooth>", () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = makeMatchMediaMock();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders an aria-hidden SVG with the shared and variant classes", () => {
    const wrapper = mount(<LogoSpinSmooth />);
    const svg = wrapper.find("svg");
    assert.ok(svg.exists());
    assert.equal(svg.prop("aria-hidden"), "true");
    assert.include(svg.prop("className"), "logo-variation-small");
    assert.include(svg.prop("className"), "logo-spin-smooth");
  });

  it("renders an <animateTransform> with begin=indefinite (manual trigger)", () => {
    const wrapper = mount(<LogoSpinSmooth />);
    const anim = wrapper.find("animateTransform");
    assert.ok(anim.exists());
    assert.equal(anim.prop("begin"), "indefinite");
    assert.equal(anim.prop("dur"), "6.67s");
    assert.equal(anim.prop("calcMode"), "discrete");
  });

  it("calls beginElement() on the animation on click", () => {
    const wrapper = mount(<LogoSpinSmooth />);
    const animNode = wrapper.find("animateTransform").getDOMNode();
    animNode.beginElement = sinon.spy();

    wrapper.find("svg").simulate("click");

    assert.calledOnce(animNode.beginElement);
  });

  it("ignores clicks while the animation is running", () => {
    const wrapper = mount(<LogoSpinSmooth />);
    const animNode = wrapper.find("animateTransform").getDOMNode();
    animNode.beginElement = sinon.spy();

    // Simulate the SMIL beginEvent firing (the animation is now "running")
    animNode.dispatchEvent(new Event("beginEvent"));
    wrapper.find("svg").simulate("click");

    assert.notCalled(animNode.beginElement);
  });

  it("allows replay after the animation finishes", () => {
    const wrapper = mount(<LogoSpinSmooth />);
    const animNode = wrapper.find("animateTransform").getDOMNode();
    animNode.beginElement = sinon.spy();

    animNode.dispatchEvent(new Event("beginEvent"));
    animNode.dispatchEvent(new Event("endEvent"));
    wrapper.find("svg").simulate("click");

    assert.calledOnce(animNode.beginElement);
  });

  it("does not begin the animation when prefers-reduced-motion is set, but stays clickable", () => {
    window.matchMedia = makeMatchMediaMock({ reduceMotion: true });
    const wrapper = mount(<LogoSpinSmooth />);
    const animNode = wrapper.find("animateTransform").getDOMNode();
    animNode.beginElement = sinon.spy();

    assert.doesNotThrow(() => wrapper.find("svg").simulate("click"));
    assert.notCalled(animNode.beginElement);
  });
});
