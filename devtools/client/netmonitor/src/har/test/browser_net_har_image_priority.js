"use strict";

/**
 * Tests for saving selected request in HAR file.
 */
add_task(async function () {
  const { monitor, toolbox } = await initNetMonitor(
    HAR_EXAMPLE_URL + "html_har_images-and-text.html",
    {
      requestCount: 5,
    }
  );

  info("Starting test...");
  const { store, windowRequire } = monitor.panelWin;
  const Actions = windowRequire("devtools/client/netmonitor/src/actions/index");

  store.dispatch(Actions.batchEnable(false));

  await disableCacheAndReload(toolbox, true);

  const savedHar = await copyAllAsHARWithContextMenu(monitor);

  // check the saved file content.
  isnot(savedHar.log, null, "The HAR log must exist");

  for (const entry of savedHar.log.entries) {
    if (/1$/.test(entry.request.url)) {
      isnot(
        entry._priority,
        "Low",
        "Above the fold image has auto-promoted priority"
      );
    }
    if (/2$/.test(entry.request.url)) {
      is(entry._priority, "Low", "Below the fold image has low priority");
    }
    if (/3$/.test(entry.request.url)) {
      isnot(
        entry._priority,
        "Low",
        "Below the fold image had priority promoted"
      );
    }
  }

  return teardown(monitor);
});
