/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const { SiteDataTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/SiteDataTestUtils.sys.mjs"
);
const { PermissionTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/PermissionTestUtils.sys.mjs"
);

const oneHour = 3600000000;

add_task(async function sanitizeWithExceptionsOnShutdown() {
  info(
    "Test that cookies that are marked as allowed from the user do not get \
    cleared when cleaning on shutdown is done"
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.sanitizer.loglevel", "All"],
      ["privacy.sanitize.sanitizeOnShutdown", true],
    ],
  });

  // Clean up before start
  await new Promise(resolve => {
    Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_ALL, resolve);
  });

  let originALLOW = "https://mozilla.org";
  PermissionTestUtils.add(
    originALLOW,
    "persist-data-on-shutdown",
    Services.perms.ALLOW_ACTION
  );

  let originDENY = "https://example123.com";
  PermissionTestUtils.add(
    originDENY,
    "cookie",
    Ci.nsICookiePermission.ACCESS_DENY
  );

  SiteDataTestUtils.addToCookies({ origin: originALLOW });
  ok(
    SiteDataTestUtils.hasCookies(originALLOW),
    "We have cookies for " + originALLOW
  );

  SiteDataTestUtils.addToCookies({ origin: originDENY });
  ok(
    SiteDataTestUtils.hasCookies(originDENY),
    "We have cookies for " + originDENY
  );

  await Sanitizer.runSanitizeOnShutdown();

  ok(
    SiteDataTestUtils.hasCookies(originALLOW),
    "We should have cookies for " + originALLOW
  );

  ok(
    !SiteDataTestUtils.hasCookies(originDENY),
    "We should not have cookies for " + originDENY
  );
});

add_task(async function sanitizeNoExceptionsInTimeRange() {
  info(
    "Test that no exceptions are made when not clearing on shutdown, e.g. clearing within a range"
  );

  // Clean up before start
  await new Promise(resolve => {
    Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_ALL, resolve);
  });

  let originALLOW = "https://mozilla.org";
  PermissionTestUtils.add(
    originALLOW,
    "cookie",
    Ci.nsICookiePermission.ACCESS_ALLOW
  );

  let originDENY = "https://bar123.com";
  PermissionTestUtils.add(
    originDENY,
    "cookie",
    Ci.nsICookiePermission.ACCESS_DENY
  );

  SiteDataTestUtils.addToCookies({ origin: originALLOW });
  ok(
    SiteDataTestUtils.hasCookies(originALLOW),
    "We have cookies for " + originALLOW
  );

  SiteDataTestUtils.addToCookies({ origin: originDENY });
  ok(
    SiteDataTestUtils.hasCookies(originDENY),
    "We have cookies for " + originDENY
  );

  let to = Date.now() * 1000;
  let from = to - oneHour;
  await Sanitizer.sanitize(["cookies"], { range: [from, to] });

  ok(
    !SiteDataTestUtils.hasCookies(originALLOW),
    "We should not have cookies for " + originALLOW
  );

  ok(
    !SiteDataTestUtils.hasCookies(originDENY),
    "We should not have cookies for " + originDENY
  );
});

add_task(async function sanitizeWithExceptionsOnStartup() {
  info(
    "Test that cookies that are marked as allowed from the user do not get \
    cleared when cleaning on startup is done, for example after a crash"
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.sanitizer.loglevel", "All"],
      ["privacy.sanitize.sanitizeOnShutdown", true],
    ],
  });

  // Clean up before start
  await new Promise(resolve => {
    Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_ALL, resolve);
  });

  let originALLOW = "https://mozilla.org";
  PermissionTestUtils.add(
    originALLOW,
    "persist-data-on-shutdown",
    Services.perms.ALLOW_ACTION
  );

  let originDENY = "https://example123.com";
  PermissionTestUtils.add(
    originDENY,
    "cookie",
    Ci.nsICookiePermission.ACCESS_DENY
  );

  SiteDataTestUtils.addToCookies({ origin: originALLOW });
  ok(
    SiteDataTestUtils.hasCookies(originALLOW),
    "We have cookies for " + originALLOW
  );

  SiteDataTestUtils.addToCookies({ origin: originDENY });
  ok(
    SiteDataTestUtils.hasCookies(originDENY),
    "We have cookies for " + originDENY
  );

  let pendingSanitizations = [
    {
      id: "shutdown",
      itemsToClear: ["cookies"],
      options: {},
    },
  ];
  Services.prefs.setBoolPref(Sanitizer.PREF_SANITIZE_ON_SHUTDOWN, true);
  Services.prefs.setStringPref(
    Sanitizer.PREF_PENDING_SANITIZATIONS,
    JSON.stringify(pendingSanitizations)
  );

  await Sanitizer.onStartup();

  ok(
    SiteDataTestUtils.hasCookies(originALLOW),
    "We should have cookies for " + originALLOW
  );

  ok(
    !SiteDataTestUtils.hasCookies(originDENY),
    "We should not have cookies for " + originDENY
  );
});

add_task(async function sanitizeWithSessionExceptionsOnShutdown() {
  info(
    "Test that cookies that are marked as allowed on session is cleared when sanitizeOnShutdown is false"
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.sanitizer.loglevel", "All"],
      ["privacy.sanitize.sanitizeOnShutdown", false],
    ],
  });

  // Clean up before start
  await new Promise(resolve => {
    Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_ALL, resolve);
  });

  let originAllowSession = "https://mozilla.org";
  PermissionTestUtils.add(
    originAllowSession,
    "cookie",
    Ci.nsICookiePermission.ACCESS_SESSION
  );

  SiteDataTestUtils.addToCookies({ origin: originAllowSession });
  ok(
    SiteDataTestUtils.hasCookies(originAllowSession),
    "We have cookies for " + originAllowSession
  );

  await Sanitizer.runSanitizeOnShutdown();

  ok(
    !SiteDataTestUtils.hasCookies(originAllowSession),
    "We should not have cookies for " + originAllowSession
  );
});

add_task(async function sanitizeWithManySessionExceptionsOnShutdown() {
  info(
    "Test that lots of allowed on session exceptions are cleared when sanitizeOnShutdown is false"
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      ["privacy.sanitize.sanitizeOnShutdown", false],
      ["dom.quotaManager.backgroundTask.enabled", true],
    ],
  });

  // Clean up before start
  await new Promise(resolve => {
    Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_ALL, resolve);
  });

  info("Setting cookies");

  const origins = new Array(300)
    .fill(0)
    .map((v, i) => `https://mozilla${i}.org`);

  for (const origin of origins) {
    PermissionTestUtils.add(
      origin,
      "cookie",
      Ci.nsICookiePermission.ACCESS_SESSION
    );
    SiteDataTestUtils.addToCookies({ origin });
  }

  ok(
    origins.every(origin => SiteDataTestUtils.hasCookies(origin)),
    "All origins have cookies"
  );

  info("Running sanitization");

  await Sanitizer.runSanitizeOnShutdown();

  ok(
    origins.every(origin => !SiteDataTestUtils.hasCookies(origin)),
    "All origins lost cookies"
  );
});

// Bug 1767271: a cookie SESSION permission still forces clearing on shutdown
// even when persist-data-on-shutdown ALLOW is also present. SESSION's "clear
// on shutdown" intent is intentionally given priority.
add_task(async function sanitizeWithSessionAndAllowExceptionsOnShutdown() {
  info(
    "Cookie SESSION overrides persist-data-on-shutdown when sanitizeOnShutdown is true"
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.sanitizer.loglevel", "All"],
      ["privacy.sanitize.sanitizeOnShutdown", true],
    ],
  });

  await new Promise(resolve => {
    Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_ALL, resolve);
  });

  let origin = "https://mozilla.org";
  PermissionTestUtils.add(
    origin,
    "cookie",
    Ci.nsICookiePermission.ACCESS_SESSION
  );
  PermissionTestUtils.add(
    origin,
    "persist-data-on-shutdown",
    Services.perms.ALLOW_ACTION
  );

  SiteDataTestUtils.addToCookies({ origin });
  ok(SiteDataTestUtils.hasCookies(origin), "We have cookies for " + origin);

  await Sanitizer.runSanitizeOnShutdown();

  ok(
    !SiteDataTestUtils.hasCookies(origin),
    "Cookie SESSION wins; cookies cleared for " + origin
  );

  PermissionTestUtils.remove(origin, "cookie");
  PermissionTestUtils.remove(origin, "persist-data-on-shutdown");
});

add_task(async function sanitizeWithSessionAndAllowExceptionsNoShutdownPref() {
  info(
    "Cookie SESSION overrides persist-data-on-shutdown when sanitizeOnShutdown is false"
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.sanitizer.loglevel", "All"],
      ["privacy.sanitize.sanitizeOnShutdown", false],
    ],
  });

  await new Promise(resolve => {
    Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_ALL, resolve);
  });

  let origin = "https://mozilla.org";
  PermissionTestUtils.add(
    origin,
    "cookie",
    Ci.nsICookiePermission.ACCESS_SESSION
  );
  PermissionTestUtils.add(
    origin,
    "persist-data-on-shutdown",
    Services.perms.ALLOW_ACTION
  );

  SiteDataTestUtils.addToCookies({ origin });
  ok(SiteDataTestUtils.hasCookies(origin), "We have cookies for " + origin);

  await Sanitizer.runSanitizeOnShutdown();

  ok(
    !SiteDataTestUtils.hasCookies(origin),
    "Cookie SESSION still wins without sanitizeOnShutdown for " + origin
  );

  PermissionTestUtils.remove(origin, "cookie");
  PermissionTestUtils.remove(origin, "persist-data-on-shutdown");
});

// A cookie SESSION on the principal still forces clearing even when an
// exception exists only on a parent base domain (no exception on the exact
// principal). SESSION on the exact principal short-circuits the walk.
add_task(async function cookieSessionWinsOverChainException() {
  info(
    "Cookie SESSION on principal beats a persist-data-on-shutdown exception on a parent domain"
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.sanitizer.loglevel", "All"],
      ["privacy.sanitize.sanitizeOnShutdown", true],
    ],
  });

  await new Promise(resolve => {
    Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_ALL, resolve);
  });

  let parent = "https://mozilla.org";
  let child = "https://sub.mozilla.org";

  PermissionTestUtils.add(
    parent,
    "persist-data-on-shutdown",
    Services.perms.ALLOW_ACTION
  );
  PermissionTestUtils.add(
    child,
    "cookie",
    Ci.nsICookiePermission.ACCESS_SESSION
  );

  SiteDataTestUtils.addToCookies({ origin: child });
  ok(SiteDataTestUtils.hasCookies(child), "We have cookies for " + child);

  await Sanitizer.runSanitizeOnShutdown();

  ok(
    !SiteDataTestUtils.hasCookies(child),
    "Child SESSION wins over parent exception; cookies cleared for " + child
  );

  PermissionTestUtils.remove(parent, "persist-data-on-shutdown");
  PermissionTestUtils.remove(child, "cookie");
});

// An exception on a parent base domain protects subdomain data via the
// permission manager's built-in ancestor walk in testPermissionFromPrincipal.
// This is the natural user flow: type "example.com" in Manage Exceptions and
// expect "www.example.com" data to be preserved.
add_task(async function parentExceptionProtectsSubdomainData() {
  info("Exception on parent base domain protects subdomain data");

  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.sanitizer.loglevel", "All"],
      ["privacy.sanitize.sanitizeOnShutdown", true],
    ],
  });

  await new Promise(resolve => {
    Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_ALL, resolve);
  });

  let parent = "https://mozilla.org";
  let child = "https://www.mozilla.org";

  PermissionTestUtils.add(
    parent,
    "persist-data-on-shutdown",
    Services.perms.ALLOW_ACTION
  );

  SiteDataTestUtils.addToCookies({ origin: child });
  ok(SiteDataTestUtils.hasCookies(child), "We have cookies for " + child);

  await Sanitizer.runSanitizeOnShutdown();

  ok(
    SiteDataTestUtils.hasCookies(child),
    "Parent exception preserves subdomain cookies for " + child
  );

  PermissionTestUtils.remove(parent, "persist-data-on-shutdown");
});

// With privacy.sanitize.sanitizeOnShutdown=false, the user can still mark
// individual sites for session-only cookies via "cookie" SESSION. Those
// sites must be cleared on shutdown; all other sites must be preserved
// because the user has not opted into general clear-on-shutdown.
add_task(
  async function sessionOnlyCookiesClearedWithoutGeneralSanitizeOnShutdown() {
    info(
      "Off-pref + SESSION on one site only clears that site, leaves others alone"
    );

    await SpecialPowers.pushPrefEnv({
      set: [
        ["browser.sanitizer.loglevel", "All"],
        ["privacy.sanitize.sanitizeOnShutdown", false],
      ],
    });

    await new Promise(resolve => {
      Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_ALL, resolve);
    });

    let sessionOrigin = "https://mozilla.org";
    let preservedOrigin = "https://example.com";

    PermissionTestUtils.add(
      sessionOrigin,
      "cookie",
      Ci.nsICookiePermission.ACCESS_SESSION
    );

    SiteDataTestUtils.addToCookies({ origin: sessionOrigin });
    SiteDataTestUtils.addToCookies({ origin: preservedOrigin });

    await Sanitizer.runSanitizeOnShutdown();

    ok(
      !SiteDataTestUtils.hasCookies(sessionOrigin),
      "SESSION-tagged origin is cleared even without general sanitizeOnShutdown"
    );
    ok(
      SiteDataTestUtils.hasCookies(preservedOrigin),
      "Untagged origin is preserved when general sanitizeOnShutdown is off"
    );

    PermissionTestUtils.remove(sessionOrigin, "cookie");
  }
);
