/* Any copyright is dedicated to the Public Domain.
http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const RECEIVE_PUSH_MESSAGES_CONTRACT_ID =
  "@mozilla.org/push/receive-push-messages-clh;1";

add_task(async function test_command_line_handler_is_registered() {
  is(
    Services.catMan.getCategoryEntry(
      "command-line-handler",
      "m-push-receive-push-messages"
    ),
    RECEIVE_PUSH_MESSAGES_CONTRACT_ID,
    "The command-line handler is registered"
  );
});

add_task(async function test_argument_is_handled() {
  let cmdLine = Cu.createCommandLine(
    ["--receive-push-messages"],
    null,
    Ci.nsICommandLine.STATE_INITIAL_LAUNCH
  );

  is(
    cmdLine.findFlag("receive-push-messages", false),
    0,
    "The argument is present"
  );

  Cc[RECEIVE_PUSH_MESSAGES_CONTRACT_ID].getService(
    Ci.nsICommandLineHandler
  ).handle(cmdLine);

  is(
    cmdLine.findFlag("receive-push-messages", false),
    -1,
    "The argument is handled"
  );
});

const { CommandLineHandler } = ChromeUtils.importESModule(
  "resource://gre/modules/PushCommandLineHandler.sys.mjs"
);

function pushMessagesAreReceived(commandLineState) {
  let receivePushMessages = sinon
    .stub(CommandLineHandler.prototype, "receivePushMessages")
    .resolves();

  try {
    Cc[RECEIVE_PUSH_MESSAGES_CONTRACT_ID].getService(
      Ci.nsICommandLineHandler
    ).handle(
      Cu.createCommandLine(["--receive-push-messages"], null, commandLineState)
    );
  } finally {
    receivePushMessages.restore();
  }

  return receivePushMessages.called;
}

add_task(async function test_push_messages_received_without_firefox_running() {
  ok(
    pushMessagesAreReceived(Ci.nsICommandLine.STATE_INITIAL_LAUNCH),
    "Push messages are received"
  );
});

add_task(async function test_push_messages_not_received_with_firefox_running() {
  ok(
    !pushMessagesAreReceived(Ci.nsICommandLine.STATE_REMOTE_AUTO),
    "Push messages are not received"
  );
});

function windowIsDisplayed(commandLineState) {
  let cmdLine = Cu.createCommandLine(
    ["--receive-push-messages"],
    null,
    commandLineState
  );

  let receivePushMessages = sinon
    .stub(CommandLineHandler.prototype, "receivePushMessages")
    .resolves();

  try {
    Cc[RECEIVE_PUSH_MESSAGES_CONTRACT_ID].getService(
      Ci.nsICommandLineHandler
    ).handle(cmdLine);
  } finally {
    receivePushMessages.restore();
  }

  return !cmdLine.preventDefault;
}

add_task(async function test_window_not_displayed_if_firefox_is_not_running() {
  ok(
    !windowIsDisplayed(Ci.nsICommandLine.STATE_INITIAL_LAUNCH),
    "No window is displayed"
  );
});

add_task(async function test_window_not_displayed_if_firefox_is_running() {
  ok(
    !windowIsDisplayed(Ci.nsICommandLine.STATE_REMOTE_AUTO),
    "No window is displayed"
  );
});

const BROWSER_GLUE =
  Cc["@mozilla.org/browser/browserglue;1"].getService().wrappedJSObject;

function createsBlankWindow(commandLineArguments) {
  // The blank window is only created if width and height already have a value
  const CHROME_URL = AppConstants.BROWSER_CHROME_URL;
  for (let [attribute, value] of [
    ["width", "1000"],
    ["height", "800"],
  ]) {
    Services.xulStore.setValue(CHROME_URL, "main-window", attribute, value);
    registerCleanupFunction(() =>
      Services.xulStore.removeValue(CHROME_URL, "main-window", attribute)
    );
  }

  // Prevents a real blank window from being created during the test
  const OPEN_WINDOW_CALLED = new Error("Services.ww.openWindow called");
  let openWindow = sinon.stub().throws(OPEN_WINDOW_CALLED);
  let windowWatcher = sinon.stub(Services, "ww").value({ openWindow });

  try {
    BROWSER_GLUE._earlyBlankFirstPaint(
      Cu.createCommandLine(
        commandLineArguments,
        null,
        Ci.nsICommandLine.STATE_INITIAL_LAUNCH
      )
    );
  } catch (e) {
    if (e != OPEN_WINDOW_CALLED) {
      throw e;
    }
  } finally {
    windowWatcher.restore();
  }

  return openWindow.called;
}

add_task(async function test_blank_window_not_displayed_with_the_argument() {
  ok(!createsBlankWindow(["--receive-push-messages"]), "No blank window");
});

add_task(async function test_blank_window_displayed_without_the_argument() {
  ok(createsBlankWindow([]), "The blank window is displayed");
});

async function survivalAreaUsage(commandLineState) {
  let survivalAreaExited = Promise.withResolvers();
  let enterLastWindowClosingSurvivalArea = sinon.stub();
  let exitLastWindowClosingSurvivalArea = sinon
    .stub()
    .callsFake(() => survivalAreaExited.resolve());
  let startup = sinon.stub(Services, "startup").value({
    enterLastWindowClosingSurvivalArea,
    exitLastWindowClosingSurvivalArea,
  });

  try {
    Cc[RECEIVE_PUSH_MESSAGES_CONTRACT_ID].getService(
      Ci.nsICommandLineHandler
    ).handle(
      Cu.createCommandLine(["--receive-push-messages"], null, commandLineState)
    );

    if (enterLastWindowClosingSurvivalArea.called) {
      // Waits until exitLastWindowClosingSurvivalArea is called
      await survivalAreaExited.promise;
    }
  } finally {
    startup.restore();
  }

  return {
    entered: enterLastWindowClosingSurvivalArea.called,
    exited: exitLastWindowClosingSurvivalArea.called,
  };
}

add_task(async function test_kept_alive_if_firefox_is_not_running() {
  Assert.deepEqual(
    await survivalAreaUsage(Ci.nsICommandLine.STATE_INITIAL_LAUNCH),
    { entered: true, exited: true },
    "Firefox is kept alive while receiving push messages"
  );
});

add_task(async function test_not_kept_alive_if_firefox_is_running() {
  Assert.deepEqual(
    await survivalAreaUsage(Ci.nsICommandLine.STATE_REMOTE_AUTO),
    { entered: false, exited: false },
    "Firefox is not kept alive"
  );
});

const PUSH_SERVICE = Cc["@mozilla.org/push/Service;1"].getService(
  Ci.nsIPushService
);

async function startsPushService(pushServiceError) {
  let ensureReady = sinon
    .stub(PUSH_SERVICE.wrappedJSObject, "ensureReady")
    .resolves();
  if (pushServiceError) {
    ensureReady.throws(pushServiceError);
  }

  try {
    return await CommandLineHandler.prototype.ensurePushServiceReady();
  } finally {
    ensureReady.restore();
  }
}

add_task(async function test_push_service_ready() {
  ok(await startsPushService(), "The Push Service is ready");
});

add_task(async function test_push_service_disabled() {
  ok(
    !(await startsPushService(
      Components.Exception("", Cr.NS_ERROR_NOT_AVAILABLE)
    )),
    "The Push Service is disabled"
  );
});

add_task(async function test_push_service_broken() {
  let pushServiceError = new Error("The Push Service is broken");

  await Assert.rejects(
    startsPushService(pushServiceError),
    e => e == pushServiceError,
    "The Push Service is broken"
  );
});
