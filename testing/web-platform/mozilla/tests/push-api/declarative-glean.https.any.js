// META: global=window-module
// META: script=/_mozilla/resources/GleanTest.js
// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: script=/notifications/resources/helpers.js
// META: script=/_mozilla/notifications/resources/MockAlertsService.js

import { encrypt } from "/push-api/resources/helpers.js"

let registration;
let subscription;

promise_setup(async (t) => {
  await trySettingPermission("granted");
  registration = await prepareActiveServiceWorker("push-sw.js");
  subscription = await registration.pushManager.subscribe();
});

let enableDWPPref;

async function pushAndReceiveMessage(t, message) {
  // Enable auto-click so that we can detect when DWP is received.
  await MockAlertsService.register(t);
  await MockAlertsService.enableAutoClick();

  await using _pref = await SpecialPowers.prefEnv({
    set: [["dom.push.declarative.enabled", enableDWPPref]],
  });

  await GleanTest.testResetFOG();

  const result = await encrypt(
    new TextEncoder().encode(message),
    subscription.getKey("p256dh"),
    subscription.getKey("auth")
  );

  const { promise, resolve } = Promise.withResolvers();
  const controller = new AbortController();
  navigator.serviceWorker.addEventListener("message", ev => {
    if (ev.data.data !== message) {
      return;
    }
    controller.abort();
    resolve();
  }, { signal: controller.signal });

  new BroadcastChannel("broadcast-when-opened").addEventListener("message", () => {
    controller.abort();
    resolve();
  }, { signal: controller.signal });


  await fetch(subscription.endpoint, {
    method: "post",
    ...result
  });

  await promise;
  await GleanTest.flush();
}

promise_test(async (t) => {
  await pushAndReceiveMessage(t, "hello");

  const notify = await GleanTest.webPush.apiNotify.testGetValue();
  const dwp = await GleanTest.webPush.declarative.testGetValue();
  const mutable = await GleanTest.webPush.declarativeMutable.testGetValue();

  assert_equals(notify, 1, "notify should always increment for valid push messages");
  assert_equals(dwp, null, "declarative should not increment on non-DWP");
  assert_equals(mutable, null, "declarativeMutable should not increment on non-DWP");
}, "Non-declarative web push");


const TEST_DWP = {
  web_push: 8030,
  notification: {
    title: "test",
    navigate: "/_mozilla/notifications/resources/broadcast-when-opened.html",
  }
};

for (enableDWPPref of [false, true]) {
  promise_test(async (t) => {
    await pushAndReceiveMessage(t, JSON.stringify(TEST_DWP));

    const notify = await GleanTest.webPush.apiNotify.testGetValue();
    const dwp = await GleanTest.webPush.declarative.testGetValue();
    const mutable = await GleanTest.webPush.declarativeMutable.testGetValue();

    assert_equals(notify, 1, "notify should always increment for valid push messages");
    assert_equals(dwp, 1, "declarative should increment on DWP");
    assert_equals(mutable, null, "declarativeMutable should not increment on DWP if mutable is false");
  }, `Declarative web push (dom.push.declarative.enabled = ${enableDWPPref})`);

  promise_test(async (t) => {
    const mutableDwp = structuredClone(TEST_DWP);
    mutableDwp.notification.mutable = true;
    await pushAndReceiveMessage(t, JSON.stringify(mutableDwp));

    const notify = await GleanTest.webPush.apiNotify.testGetValue();
    const dwp = await GleanTest.webPush.declarative.testGetValue();
    const mutable = await GleanTest.webPush.declarativeMutable.testGetValue();

    assert_equals(notify, 1, "notify should always increment for valid push messages");
    assert_equals(dwp, 1, "declarative should increment on mutable DWP");
    assert_equals(mutable, 1, "declarativeMutable should increment on mutable DWP");
  }, `Declarative web push with mutable: true (dom.push.declarative.enabled = ${enableDWPPref})`);
}
