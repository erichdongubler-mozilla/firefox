/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Load a page that generates cookie warning/info messages. See bug 1622306.

"use strict";
requestLongerTimeout(2);

const TEST_FILE =
  "browser/devtools/client/webconsole/test/browser/test-warning-groups.html";
const COOKIE_GROUP = "Cookie warnings";

pushPref("devtools.webconsole.groupSimilarMessages", true);
pushPref("network.cookie.sameSite.laxByDefaultWarningsForBeta", true);

async function cleanUp() {
  await new Promise(resolve => {
    Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_ALL, () =>
      resolve()
    );
  });
}

add_task(cleanUp);

add_task(async function testSameSiteCookieMessage() {
  const tests = [
    {
      pref: true,
      message1:
        "Cookie “a” has “SameSite” policy set to “Lax” because it is missing a “SameSite” attribute, and “SameSite=Lax” is the default value for this attribute.",
      typeMessage1: ".info",
      message2:
        "Cookie “b” has “SameSite” policy set to “Lax” because it is missing a “SameSite” attribute, and “SameSite=Lax” is the default value for this attribute.",
    },
    {
      pref: false,
      message1:
        "Cookie “a” does not have a proper “SameSite” attribute value. Soon, cookies without the “SameSite” attribute or with an invalid value will be treated as “Lax”. This means that the cookie will no longer be sent in third-party contexts. If your application depends on this cookie being available in such contexts, please add the “SameSite=None“ attribute to it. To know more about the “SameSite“ attribute, read https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Set-Cookie#samesitesamesite-value",
      typeMessage1: ".warn",
      message2:
        "Cookie “b” does not have a proper “SameSite” attribute value. Soon, cookies without the “SameSite” attribute or with an invalid value will be treated as “Lax”. This means that the cookie will no longer be sent in third-party contexts. If your application depends on this cookie being available in such contexts, please add the “SameSite=None“ attribute to it. To know more about the “SameSite“ attribute, read https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Set-Cookie#samesitesamesite-value",
    },
  ];

  for (const test of tests) {
    info("LaxByDefault: " + test.pref);
    await pushPref("network.cookie.sameSite.laxByDefault", test.pref);

    const { hud, tab, win } = await openNewWindowAndConsole(
      "http://example.org/" + TEST_FILE
    );

    info("Test cookie messages");
    const onLaxMissingWarningMessage = waitForMessageByType(
      hud,
      test.message1,
      test.typeMessage1
    );

    SpecialPowers.spawn(tab.linkedBrowser, [], () => {
      content.wrappedJSObject.createCookie("a=1");
    });

    await onLaxMissingWarningMessage;

    ok(true, "The first message was displayed");

    info("Emit a new cookie message to check that it causes a grouping");

    const onCookieSameSiteWarningGroupMessage = waitForMessageByType(
      hud,
      COOKIE_GROUP,
      ".warn"
    );

    SpecialPowers.spawn(tab.linkedBrowser, [], () => {
      content.wrappedJSObject.createCookie("b=1");
    });

    const { node } = await onCookieSameSiteWarningGroupMessage;
    is(
      node.querySelector(".warning-group-badge").textContent,
      "2",
      "The badge has the expected text"
    );

    await checkConsoleOutputForWarningGroup(hud, [`▶︎⚠ ${COOKIE_GROUP} 2`]);

    info("Open the group");
    node.querySelector(".arrow").click();
    await waitFor(() => findWarningMessage(hud, "Cookie"));

    await checkConsoleOutputForWarningGroup(hud, [
      `▼︎⚠ ${COOKIE_GROUP} 2`,
      `| ${test.message1}`,
      `| ${test.message2}`,
    ]);

    await win.close();
  }
});

add_task(cleanUp);

add_task(async function testInvalidSameSiteMessage() {
  await pushPref("network.cookie.sameSite.laxByDefault", true);

  const message1 =
    "Invalid “SameSite“ value for cookie “a”. The supported values are: “Lax“, “Strict“, “None“.";
  const message2 =
    "Cookie “a” has “SameSite” policy set to “Lax” because it is missing a “SameSite” attribute, and “SameSite=Lax” is the default value for this attribute.";

  const { hud, tab, win } = await openNewWindowAndConsole(
    "http://example.org/" + TEST_FILE
  );

  info("Test cookie messages");

  SpecialPowers.spawn(tab.linkedBrowser, [], () => {
    content.wrappedJSObject.createCookie("a=1; sameSite=batman");
  });

  const { node } = await waitForMessageByType(hud, COOKIE_GROUP, ".warn");
  is(
    node.querySelector(".warning-group-badge").textContent,
    "2",
    "The badge has the expected text"
  );

  await checkConsoleOutputForWarningGroup(hud, [`▶︎⚠ ${COOKIE_GROUP} 2`]);

  info("Open the group");
  node.querySelector(".arrow").click();
  await waitFor(() => findWarningMessage(hud, "Cookie"));

  await checkConsoleOutputForWarningGroup(hud, [
    `▼︎⚠ ${COOKIE_GROUP} 2`,
    `| ${message2}`,
    `| ${message1}`,
  ]);

  // Source map are being resolved in background and we might have
  // pending request related to this service if we close the window
  // immeditely. So just wait for these request to finish before proceeding.
  await hud.toolbox.sourceMapURLService.waitForSourcesLoading();

  await win.close();
});

add_task(cleanUp);

add_task(async function testInvalidMaxAgeMessage() {
  const message1 =
    "Invalid “max-age“ value for cookie “a”. The attribute is ignored.";
  const message2 =
    "Invalid “max-age“ value for cookie “b”. The attribute is ignored.";

  const { hud, tab, win } = await openNewWindowAndConsole(
    "http://example.org/" + TEST_FILE
  );

  info("Test cookie messages");

  SpecialPowers.spawn(tab.linkedBrowser, [], () => {
    content.wrappedJSObject.createCookie("a=1; max-age=abc; samesite=lax");
    content.wrappedJSObject.createCookie("b=1; max-age=1,2; samesite=lax");
  });

  const { node } = await waitForMessageByType(hud, COOKIE_GROUP, ".warn");
  is(
    node.querySelector(".warning-group-badge").textContent,
    "2",
    "The badge has the expected text"
  );

  await checkConsoleOutputForWarningGroup(hud, [`▶︎⚠ ${COOKIE_GROUP} 2`]);

  info("Open the group");
  node.querySelector(".arrow").click();
  await waitFor(() => findWarningMessage(hud, "Cookie"));

  await checkConsoleOutputForWarningGroup(hud, [
    `▼︎⚠ ${COOKIE_GROUP} 2`,
    `| ${message1}`,
    `| ${message2}`,
  ]);

  // Source map are being resolved in background and we might have
  // pending request related to this service if we close the window
  // immeditely. So just wait for these request to finish before proceeding.
  await hud.toolbox.sourceMapURLService.waitForSourcesLoading();

  await win.close();
});

add_task(cleanUp);
