const PAGE =
  "https://example.com/browser/dom/media/mediacontrol/tests/browser/file_non_autoplay.html";
const testVideoId = "video";

add_task(async function setupTestingPref() {
  await SpecialPowers.pushPrefEnv({
    set: [["media.mediacontrol.testingevents.enabled", true]],
  });
});

// Resolve once the controller's audible state reaches `audible`, driven by its
// onaudiblechange event (resolving immediately if it is already in that state).
function waitForControllerAudible(controller, audible) {
  return new Promise(resolve => {
    if (controller.isAudible === audible) {
      resolve();
      return;
    }
    controller.addEventListener("audiblechange", function handler() {
      if (controller.isAudible === audible) {
        controller.removeEventListener("audiblechange", handler);
        resolve();
      }
    });
  });
}

/**
 * Muting and unmuting through the MediaController must update its muted state
 * (isMuted) and silence then restore the tab's audio.
 */
add_task(async function testControllerMuteUnmute() {
  info(`open page`);
  const tab = await createLoadedTabWrapper(PAGE);
  const controller = tab.controller;
  ok(!controller.isMuted, "controller starts unmuted");

  info(`start media; the controller should become audible`);
  await Promise.all([
    waitForControllerAudible(controller, true),
    playMedia(tab, testVideoId),
  ]);
  ok(controller.isAudible, "media is audible before muting");

  info(`mute via the controller; it should become inaudible`);
  const inaudible = waitForControllerAudible(controller, false);
  controller.mute();
  ok(controller.isMuted, "controller reports being muted");
  await inaudible;
  ok(!controller.isAudible, "media is inaudible after muting");

  info(`unmute via the controller; it should become audible again`);
  const audibleAgain = waitForControllerAudible(controller, true);
  controller.unmute();
  ok(!controller.isMuted, "controller reports being unmuted");
  await audibleAgain;
  ok(controller.isAudible, "media is audible again after unmuting");

  info(`remove tab`);
  await tab.close();
});
