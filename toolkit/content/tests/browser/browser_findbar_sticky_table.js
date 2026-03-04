/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tests that find-in-page scrolls to text inside a position:sticky table cell
 * even when that cell is stuck in the viewport.
 *
 * Regression test for bug 2016967: the matched text lives in a first-column
 * <td> in <tbody> that has position:sticky applied (both <thead> and first
 * column cells are sticky, as in the original bug report). When the page is
 * pre-scrolled to the bottom, the sticky cell appears stuck at the top of the
 * viewport, but the scroll-into-view logic was incorrectly treating it as
 * already visible and refusing to scroll back up.
 */

add_task(async function test_findbar_scrolls_to_sticky_tbody_cell() {
  let tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    getTestWebBasedURL("file_findbar_sticky_table.html")
  );
  let browser = tab.linkedBrowser;

  // Scroll to the bottom so the row containing our target text is above the
  // viewport.  The target's <td> has position:sticky so it appears stuck at
  // the top of the viewport, but its natural layout position is far above the
  // current scroll offset.
  let scrollYAtBottom = await SpecialPowers.spawn(browser, [], () => {
    content.scrollTo(0, content.document.documentElement.scrollHeight);
    return content.scrollY;
  });

  Assert.greater(
    scrollYAtBottom,
    0,
    "Page should be scrolled to the bottom before find"
  );

  await promiseFindFinished(gBrowser, "StickyTableTarget", false);

  await BrowserTestUtils.waitForCondition(
    () =>
      SpecialPowers.spawn(browser, [scrollYAtBottom], expectedBottom => {
        return content.scrollY < expectedBottom;
      }),
    "Find should have scrolled the page toward the sticky match"
  );

  let finalScrollY = await SpecialPowers.spawn(browser, [], () => {
    return content.scrollY;
  });

  Assert.less(
    finalScrollY,
    scrollYAtBottom,
    "scrollY should be less than the pre-find scroll position"
  );

  await BrowserTestUtils.removeTab(tab);
});
