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
