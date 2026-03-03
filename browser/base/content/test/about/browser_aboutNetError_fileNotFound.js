/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_fileNotFound_intro_shows_path() {
  const tab = await openErrorPage("file:///this/path/does/not/exist.html");
  const browser = tab.linkedBrowser;

  await ContentTask.spawn(browser, null, async () => {
    await ContentTaskUtils.waitForCondition(
      () => content.document.querySelector("net-error-card"),
      "net-error-card should render"
    );
    const netErrorCard =
      content.document.querySelector("net-error-card").wrappedJSObject;

    Assert.ok(netErrorCard.netErrorIntro, "NetErrorCard has netErrorIntro.");
    Assert.equal(
      netErrorCard.netErrorIntro.dataset.l10nId,
      "neterror-file-not-found-intro",
      "Intro uses the file-not-found l10n id."
    );
    Assert.equal(
      JSON.parse(netErrorCard.netErrorIntro.dataset.l10nArgs).path,
      "/this/path/does/not/exist.html",
      "Intro l10n args contain the correct file path."
    );
    Assert.ok(
      netErrorCard.netErrorTitleText,
      "NetErrorCard has netErrorTitleText."
    );
    Assert.equal(
      netErrorCard.netErrorTitleText.dataset.l10nId,
      "fileNotFound-title",
      "Title uses the fileNotFound l10n id."
    );
    Assert.ok(netErrorCard.whatCanYouDo, "NetErrorCard has whatCanYouDo.");
    Assert.equal(
      netErrorCard.whatCanYouDo.dataset.l10nId,
      "neterror-file-not-found-what-can-you-do",
      "What can you do section uses the file-not-found l10n id."
    );
    Assert.ok(!netErrorCard.tryAgainButton, "Try Again button is absent.");
  });

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_fileNotFound_url_encoded_path() {
  const tab = await openErrorPage(
    "file:///path%20with%20spaces/missing%20file.html"
  );
  const browser = tab.linkedBrowser;

  await ContentTask.spawn(browser, null, async () => {
    await ContentTaskUtils.waitForCondition(
      () => content.document.querySelector("net-error-card"),
      "net-error-card should render"
    );
    const netErrorCard =
      content.document.querySelector("net-error-card").wrappedJSObject;

    Assert.equal(
      netErrorCard.netErrorIntro.dataset.l10nId,
      "neterror-file-not-found-intro",
      "Intro uses the file-not-found l10n id for encoded path."
    );
    Assert.equal(
      JSON.parse(netErrorCard.netErrorIntro.dataset.l10nArgs).path,
      "/path with spaces/missing file.html",
      "URL-encoded path is decoded in the l10n args."
    );
  });

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_fileNotFound_windows_path_normalization() {
  const tab = await openErrorPage("file:///C:/Users/test/nonexistent.html");
  const browser = tab.linkedBrowser;

  await ContentTask.spawn(browser, null, async () => {
    await ContentTaskUtils.waitForCondition(
      () => content.document.querySelector("net-error-card"),
      "net-error-card should render"
    );
    const netErrorCard =
      content.document.querySelector("net-error-card").wrappedJSObject;

    Assert.equal(
      netErrorCard.netErrorIntro.dataset.l10nId,
      "neterror-file-not-found-intro",
      "Intro uses the file-not-found l10n id for Windows path."
    );
    Assert.equal(
      JSON.parse(netErrorCard.netErrorIntro.dataset.l10nArgs).path,
      "C:/Users/test/nonexistent.html",
      "Leading slash is stripped from Windows drive-letter paths."
    );
  });

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_fileNotFound_query_and_fragment_stripped() {
  const tab = await openErrorPage(
    "file:///path/to/file.html?v=2&lang=en#section"
  );
  const browser = tab.linkedBrowser;

  await ContentTask.spawn(browser, null, async () => {
    await ContentTaskUtils.waitForCondition(
      () => content.document.querySelector("net-error-card"),
      "net-error-card should render"
    );
    const netErrorCard =
      content.document.querySelector("net-error-card").wrappedJSObject;

    Assert.equal(
      JSON.parse(netErrorCard.netErrorIntro.dataset.l10nArgs).path,
      "/path/to/file.html",
      "Query string and fragment are stripped from the displayed path."
    );
  });

  BrowserTestUtils.removeTab(tab);
});
