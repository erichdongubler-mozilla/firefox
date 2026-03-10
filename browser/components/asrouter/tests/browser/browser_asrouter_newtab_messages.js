/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { AboutWelcomeTelemetry } = ChromeUtils.importESModule(
  "resource:///modules/aboutwelcome/AboutWelcomeTelemetry.sys.mjs"
);

const { PanelTestProvider } = ChromeUtils.importESModule(
  "resource:///modules/asrouter/PanelTestProvider.sys.mjs"
);

const { SpecialMessageActions } = ChromeUtils.importESModule(
  "resource://messaging-system/lib/SpecialMessageActions.sys.mjs"
);

const TEST_MESSAGE_ID = "TEST_ASROUTER_NEWTAB_MESSAGE";

let gTestNewTabMessage;

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.newtabpage.activity-stream.telemetry", true],
      ["browser.newtab.preload", false],
    ],
  });
  NewTabPagePreloading.removePreloadedBrowser(window);

  Services.fog.testResetFOG();
  registerCleanupFunction(async () => {
    Services.fog.testResetFOG();
    await ASRouter.resetMessageState();
  });

  /**
   * @backward-compat { version 150 }
   *
   * Our test message was added to PanelTestProvider in version 150. This test,
   * however, runs in the newtab train-hop CI jobs, which means that we have
   * to shim the test message until the PanelTestProvider change reaches 150.
   */
  if (Services.vc.compare(AppConstants.MOZ_APP_VERSION, "150.0a1") < 0) {
    gTestNewTabMessage = {
      id: "TEST_ASROUTER_NEWTAB_MESSAGE",
      template: "newtab_message",
      content: {
        messageType: "ASRouterNewTabMessage",
      },
      trigger: {
        id: "newtabMessageCheck",
      },
      groups: [],
    };
  } else {
    gTestNewTabMessage = await PanelTestProvider.getMessages().then(msgs =>
      msgs.find(msg => msg.id === TEST_MESSAGE_ID)
    );
  }
  Assert.ok(gTestNewTabMessage, "Found a test fxa_cta message to use.");
});

/**
 * Tests that registering our test message results it in appearing on newtab,
 * and that we record an impression for it.
 */
add_task(async function test_show_newtab_message() {
  let sandbox = sinon.createSandbox();
  sandbox.spy(ASRouter, "addImpression");
  sandbox.spy(AboutWelcomeTelemetry.prototype, "submitGleanPingForPing");

  await withTestMessage(sandbox, gTestNewTabMessage, async () => {
    await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:newtab");

    await SpecialPowers.spawn(gBrowser.selectedBrowser, [], async () => {
      await ContentTaskUtils.waitForCondition(() => {
        return content.document.querySelector("asrouter-newtab-message");
      }, "Waiting for asrouter-newtab-message");
    });
  });

  // The impression is triggered by an intersection observer, which is not
  // guaranteed to fire before the SpecialPowers.spawn resolves. We work
  // around this by waiting for the addImpression method to be called.
  await TestUtils.waitForCondition(
    () => ASRouter.addImpression.called,
    "Waiting for addImpression to be called"
  );
  Assert.ok(
    ASRouter.addImpression.calledWith(gTestNewTabMessage),
    "The test message had an impression recorded for it."
  );
  Assert.ok(
    AboutWelcomeTelemetry.prototype.submitGleanPingForPing.calledWithMatch(
      sinon.match({
        message_id: gTestNewTabMessage.id,
        event: "IMPRESSION",
        pingType: "newtab_message",
      })
    ),
    "The test message had an impression recorded for it."
  );
  BrowserTestUtils.removeTab(gBrowser.selectedTab);
  sandbox.restore();
});

/**
 * Tests that the message has callbacks assigned to it that allow it to
 * be blocked.
 */
add_task(async function test_block_newtab_message() {
  let sandbox = sinon.createSandbox();
  sandbox.stub(ASRouter, "blockMessageById").returns(Promise.resolve());

  await withTestMessage(sandbox, gTestNewTabMessage, async () => {
    await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:newtab");
    await SpecialPowers.spawn(gBrowser.selectedBrowser, [], async () => {
      await ContentTaskUtils.waitForCondition(() => {
        return content.document.querySelector("asrouter-newtab-message");
      }, "Found asrouter-newtab-message");

      let msgEl = content.document.querySelector("asrouter-newtab-message");
      // Eventually, if this UI component has a block button that exists in
      // every variant it displays, or a common block behaviour, we can trigger
      // that here. For now though, we'll just call the handleBlock method
      // manually.
      Cu.waiveXrays(msgEl).handleBlock();
    });
  });

  Assert.ok(
    ASRouter.blockMessageById.calledWith(TEST_MESSAGE_ID),
    "The test message was blocked."
  );
  BrowserTestUtils.removeTab(gBrowser.selectedTab);
  sandbox.restore();
});

/**
 * Tests that the message has callbacks assigned to it that allow it to
 * be closed without being considered dismissed. This just removes the message
 * from the DOM.
 */
add_task(async function test_close_newtab_message() {
  let sandbox = sinon.createSandbox();
  sandbox.spy(AboutWelcomeTelemetry.prototype, "submitGleanPingForPing");

  await withTestMessage(sandbox, gTestNewTabMessage, async () => {
    await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:newtab");
    await SpecialPowers.spawn(gBrowser.selectedBrowser, [], async () => {
      await ContentTaskUtils.waitForCondition(() => {
        return content.document.querySelector("asrouter-newtab-message");
      }, "Found asrouter-newtab-message");

      let msgEl = content.document.querySelector("asrouter-newtab-message");
      // Eventually, if this UI component has a block button that exists in
      // every variant it displays, or a common block behaviour, we can trigger
      // that here. For now though, we'll just call the handleClose method
      // manually.
      Cu.waiveXrays(msgEl).handleClose();

      await ContentTaskUtils.waitForCondition(() => {
        return !content.document.querySelector("asrouter-newtab-message");
      }, "asrouter-newtab-message removed from DOM");
    });
  });

  BrowserTestUtils.removeTab(gBrowser.selectedTab);
  sandbox.restore();
});

/**
 * Tests that the message has callbacks assigned to it that allow it to
 * be dismissed, which is then recorded in telemetry. This is a superset of
 * the "close" action, which also removes the message from the DOM.
 */
add_task(async function test_dismiss_newtab_message() {
  let sandbox = sinon.createSandbox();
  sandbox.spy(AboutWelcomeTelemetry.prototype, "submitGleanPingForPing");

  await withTestMessage(sandbox, gTestNewTabMessage, async () => {
    await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:newtab");
    await SpecialPowers.spawn(gBrowser.selectedBrowser, [], async () => {
      await ContentTaskUtils.waitForCondition(() => {
        return content.document.querySelector("asrouter-newtab-message");
      }, "Found asrouter-newtab-message");

      let msgEl = content.document.querySelector("asrouter-newtab-message");
      // Eventually, if this UI component has a block button that exists in
      // every variant it displays, or a common block behaviour, we can trigger
      // that here. For now though, we'll just call the handleDismiss method
      // manually.
      Cu.waiveXrays(msgEl).handleDismiss();

      // This should also remove the asrouter-newtab-message from the DOM, since
      // handleDismiss automatically calls handleClose.
      await ContentTaskUtils.waitForCondition(() => {
        return !content.document.querySelector("asrouter-newtab-message");
      }, "asrouter-newtab-message removed from DOM");
    });
  });

  Assert.ok(
    AboutWelcomeTelemetry.prototype.submitGleanPingForPing.calledWithMatch(
      sinon.match({
        message_id: gTestNewTabMessage.id,
        event: "DISMISS",
        pingType: "newtab_message",
      })
    ),
    "The test message had a dismiss recorded for it."
  );
  BrowserTestUtils.removeTab(gBrowser.selectedTab);
  sandbox.restore();
});

/**
 * Tests that the message has callbacks assigned to it that allow it to record
 * a click telemetry event that we expect for newtab messages.
 */
add_task(async function test_click_newtab_message() {
  let sandbox = sinon.createSandbox();
  sandbox.spy(AboutWelcomeTelemetry.prototype, "submitGleanPingForPing");

  await withTestMessage(sandbox, gTestNewTabMessage, async () => {
    await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:newtab");
    await SpecialPowers.spawn(gBrowser.selectedBrowser, [], async () => {
      await ContentTaskUtils.waitForCondition(() => {
        return content.document.querySelector("asrouter-newtab-message");
      }, "Found asrouter-newtab-message");

      let msgEl = content.document.querySelector("asrouter-newtab-message");
      // Eventually, if this UI component has a block button that exists in
      // every variant it displays, or a common block behaviour, we can trigger
      // that here. For now though, we'll just call the handleClick method
      // manually.
      Cu.waiveXrays(msgEl).handleClick();
    });
  });

  Assert.ok(
    AboutWelcomeTelemetry.prototype.submitGleanPingForPing.calledWithMatch(
      sinon.match({
        message_id: gTestNewTabMessage.id,
        event: "CLICK",
        pingType: "newtab_message",
      })
    ),
    "The test message had a click recorded for it."
  );
  BrowserTestUtils.removeTab(gBrowser.selectedTab);
  sandbox.restore();
});

/**
 * Tests that the asrouter-newtab-message component can be used to trigger
 * special message actions.
 */
add_task(async function test_special_message_actions() {
  let sandbox = sinon.createSandbox();
  const TEST_ACTION = { type: "TEST_ACTION", data: { test: 123 } };

  sandbox.stub(SpecialMessageActions, "handleAction");

  await withTestMessage(sandbox, gTestNewTabMessage, async () => {
    await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:newtab");
    await SpecialPowers.spawn(
      gBrowser.selectedBrowser,
      [TEST_ACTION],
      async action => {
        await ContentTaskUtils.waitForCondition(() => {
          return content.document.querySelector("asrouter-newtab-message");
        }, "Found asrouter-newtab-message");

        let msgEl = content.document.querySelector("asrouter-newtab-message");
        Cu.waiveXrays(msgEl).specialMessageAction(
          Cu.cloneInto(action, content)
        );
      }
    );
  });

  Assert.ok(
    SpecialMessageActions.handleAction.calledWithMatch(
      sinon.match(TEST_ACTION),
      gBrowser.selectedBrowser
    ),
    "SpecialMessageActions was callable from the asrouter-newtab-message component."
  );

  BrowserTestUtils.removeTab(gBrowser.selectedTab);
  sandbox.restore();
});
