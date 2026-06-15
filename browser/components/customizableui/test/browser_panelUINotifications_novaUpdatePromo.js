/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { AppMenuNotifications } = ChromeUtils.importESModule(
  "resource://gre/modules/AppMenuNotifications.sys.mjs"
);

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({ set: [["browser.nova.enabled", true]] });
});

registerCleanupFunction(async function () {
  await SpecialPowers.popPrefEnv();
});

add_task(async function testNovaPromoVisibleForUpdateRestart() {
  AppMenuNotifications.showBadgeOnlyNotification("update-restart");
  await gCUITestUtils.openMainMenu();

  let promo = document.getElementById("appMenu-nova-update-promo");
  ok(!promo.hidden, "Nova update promo should be visible for update-restart");
  ok(
    BrowserTestUtils.isVisible(promo),
    "Nova update promo should be visible for update-restart"
  );

  AppMenuNotifications.removeNotification(/.*/);
  await gCUITestUtils.hideMainMenu();
});

add_task(async function testNovaPromoHiddenWithNoNotification() {
  await gCUITestUtils.openMainMenu();

  let promo = document.getElementById("appMenu-nova-update-promo");
  ok(
    promo.hidden,
    "Nova update promo should be hidden when there is no notification"
  );
  ok(
    !BrowserTestUtils.isVisible(promo),
    "Nova update promo should not be visible when there is no notification"
  );

  await gCUITestUtils.hideMainMenu();
});

add_task(async function testNovaPromoHiddenForOtherNotifications() {
  let promo = document.getElementById("appMenu-nova-update-promo");

  for (let id of [
    "update-available",
    "update-manual",
    "update-downloading",
    "update-unsupported",
  ]) {
    AppMenuNotifications.showBadgeOnlyNotification(id);
    await gCUITestUtils.openMainMenu();

    ok(promo.hidden, `Nova update promo should be hidden for ${id}`);
    ok(
      !BrowserTestUtils.isVisible(promo),
      `Nova update promo should not be visible for ${id}`
    );

    AppMenuNotifications.removeNotification(/.*/);
    await gCUITestUtils.hideMainMenu();
  }
});

add_task(
  async function testBannerItemVisibleForNonRestartNotificationsWithNova() {
    let banner = document.getElementById("appMenu-update-banner");

    for (let id of [
      "update-downloading",
      "update-available",
      "update-manual",
      "update-unsupported",
    ]) {
      AppMenuNotifications.showBadgeOnlyNotification(id);
      await gCUITestUtils.openMainMenu();

      ok(
        !banner.hidden,
        `panel-banner-item should be visible for ${id} when nova is enabled`
      );
      ok(
        BrowserTestUtils.isVisible(banner),
        `panel-banner-item should be visible for ${id} when nova is enabled`
      );

      AppMenuNotifications.removeNotification(/.*/);
      await gCUITestUtils.hideMainMenu();
    }
  }
);

add_task(async function testNovaUpdateLinkCallsMainAction() {
  let mainActionCalled = false;
  let mainAction = {
    callback: () => {
      mainActionCalled = true;
    },
  };

  AppMenuNotifications.showNotification("update-restart", mainAction, null, {
    dismissed: true,
  });

  await gCUITestUtils.openMainMenu();

  let promo = document.getElementById("appMenu-nova-update-promo");
  ok(!promo.hidden, "Nova update promo should be visible");
  ok(BrowserTestUtils.isVisible(promo), "Nova update promo should be visible");

  let link = document.getElementById("appMenu-nova-update-link");
  ok(link, "Nova update link should exist");
  link.click();

  ok(mainActionCalled, "Main action callback was called when link was clicked");

  AppMenuNotifications.removeNotification(/.*/);
  await gCUITestUtils.hideMainMenu();
});
