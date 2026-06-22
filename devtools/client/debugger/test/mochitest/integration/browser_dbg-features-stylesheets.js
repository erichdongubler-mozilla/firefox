/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

"use strict";

/**
 * Asserts the features of style sheets in the debugger
 */
const httpServer = createTestHTTPServer();
const BASE_URL = `http://localhost:${httpServer.identity.primaryPort}/`;

httpServer.registerContentType("html", "text/html");
httpServer.registerContentType("js", "application/javascript");

httpServer.registerPathHandler("/index.html", (request, response) => {
  response.setStatusLine(request.httpVersion, 200, "OK");
  response.write(`<html>
      <head>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body></body>
    </html>`);
});

httpServer.registerPathHandler("/style.css", (request, response) => {
  response.setHeader("Content-Type", "text/css");
  response.write("body { background-color: powderblue; }");
});

// This tests that editing style sheets updates the current page.
add_task(async function testEditingStyleSheets() {
  await pushPref("devtools.debugger.features.stylesheets-in-debugger", true);
  const dbg = await initDebuggerWithAbsoluteURL(
    BASE_URL + "index.html",
    "style.css"
  );

  let currentBgColor = await getCurrentPageBackgroundColor();
  is(
    currentBgColor,
    "rgb(176, 224, 230)",
    "The background color is powder blue"
  );

  await selectSourceFromSourceTreeWithIndex(
    dbg,
    "style.css",
    3,
    "Select the style sheet"
  );
  const color = "powderblue";
  is(getEditorContent(dbg), `body { background-color: ${color}; }`);

  info("Change the value of the backgroud color property in the editor");
  getCMEditor(dbg).focus();
  await setEditorCursorAt(dbg, 1, 35);
  let x = color.length;
  while (x > 0) {
    pressKey(dbg, "Backspace");
    x--;
  }
  type(dbg, "green");

  // Wait a bit for the color to change to the final green color
  const bgColorChanged = await waitFor(async () => {
    currentBgColor = await getCurrentPageBackgroundColor();
    return currentBgColor == "rgb(0, 128, 0)";
  });
  ok(bgColorChanged, "The background color is now green");
  is(getEditorContent(dbg), `body { background-color: green; }`);
});

// This asserts that toggling a style sheet on/of updates the current page.
add_task(async function testToggleStyleSheetVisibility() {
  await pushPref("devtools.debugger.features.stylesheets-in-debugger", true);
  const dbg = await initDebuggerWithAbsoluteURL(
    BASE_URL + "index.html",
    "style.css"
  );

  let currentBgColor = await getCurrentPageBackgroundColor();
  is(
    currentBgColor,
    "rgb(176, 224, 230)",
    "The background color is powder blue"
  );

  await selectSourceFromSourceTreeWithIndex(
    dbg,
    "style.css",
    3,
    "Select the style sheet"
  );

  info("Click to disable the stylesheet");
  await toggleStylesheetsVisibility(dbg);

  info("Assert that the styling is no longer applied to the page");
  let bgColorChanged = await waitForBackgroundColorChange(
    dbg,
    "rgba(0, 0, 0, 0)"
  );
  ok(bgColorChanged, "The body background color is removed");

  currentBgColor = await getCurrentPageBackgroundColor();
  is(currentBgColor, "rgba(0, 0, 0, 0)", "The background color is removed");

  info("Click to enable the stylesheet");
  await toggleStylesheetsVisibility(dbg);

  info("Assert that the styling is applied to the page");
  bgColorChanged = await waitForBackgroundColorChange(
    dbg,
    "rgb(176, 224, 230)"
  );
  ok(bgColorChanged, "The body background color is removed");

  currentBgColor = await getCurrentPageBackgroundColor();
  is(
    currentBgColor,
    "rgb(176, 224, 230)",
    "The background color is powder blue"
  );
});

httpServer.registerPathHandler("/pretty.html", (request, response) => {
  response.setStatusLine(request.httpVersion, 200, "OK");
  response.write(`<!DOCTYPE html>
    <html>
      <head>
        <link rel="stylesheet" href="/style.min.css">
      </head>
      <body>
      </body>
    </html>
  `);
});
const MINIFIED_CSS_TEXT =
  "body{background:red;}div{font-size:4em;color:red}span{color:green;@media screen { background: blue; &>.myClass {padding: 1em} }}";
httpServer.registerPathHandler("/style.min.css", (request, response) => {
  response.setHeader("Content-Type", "text/css");
  response.write(MINIFIED_CSS_TEXT);
});

add_task(async function testTogglePreetyPrintedStyleSheetVisibility() {
  await pushPref("devtools.debugger.features.stylesheets-in-debugger", true);
  const dbg = await initDebuggerWithAbsoluteURL(
    BASE_URL + "pretty.html",
    "style.min.css"
  );

  const PRETTIFIED_CSS_TEXT = `
body {
  background:red;
}
div {
  font-size:4em;
  color:red
}
span {
  color:green;
  @media screen {
    background: blue;
    &>.myClass {
      padding: 1em
    }
  }
}
`.trimStart();

  await selectSource(dbg, "style.min.css", 2);

  info("Check that the style sheet is minified");
  is(getEditorContent(dbg), MINIFIED_CSS_TEXT, "minified source is correct");

  info("Check the page has the style sheet applied");
  is(
    await getCurrentPageBackgroundColor(),
    "rgb(255, 0, 0)",
    "The background color is powder blue"
  );

  info(
    "Toggle to disable the style sheet and check the impact on the web page"
  );
  await toggleVisibilityAndAssertTheBackgroundPageColor(
    dbg,
    "rgba(0, 0, 0, 0)"
  );

  info("Pretty print the minified style sheet");
  await togglePrettyPrint(dbg);
  is(
    getEditorContent(dbg),
    PRETTIFIED_CSS_TEXT,
    "minified source has been prettified automatically"
  );

  info("Check the page does not have the style sheet applied");
  is(
    await getCurrentPageBackgroundColor(),
    "rgba(0, 0, 0, 0)",
    "The background color is powder blue"
  );

  info("Toggle to enable the style sheet and check the impact on the web page");
  await toggleVisibilityAndAssertTheBackgroundPageColor(dbg, "rgb(255, 0, 0)");

  info("Undo the pretty print on the minified style sheet");
  await togglePrettyPrint(dbg);
  is(
    getEditorContent(dbg),
    MINIFIED_CSS_TEXT,
    "minified source is still correct"
  );
});

async function toggleVisibilityAndAssertTheBackgroundPageColor(
  dbg,
  expectedPageColor
) {
  const bgColorChanged = waitForBackgroundColorChange(dbg, expectedPageColor);

  info("Click to toggle the stylesheet");
  await toggleStylesheetsVisibility(dbg);
  await bgColorChanged;
  ok(true, "The body background color has changed");

  const currentBgColor = await getCurrentPageBackgroundColor();
  is(currentBgColor, expectedPageColor, "The background color is correct");
}

function waitForBackgroundColorChange(dbg, expectedColor) {
  return waitFor(async () => {
    const currentBgColor = await getCurrentPageBackgroundColor();
    return currentBgColor == expectedColor;
  });
}

function getCurrentPageBackgroundColor() {
  return SpecialPowers.spawn(gBrowser.selectedBrowser, [], function () {
    const bodyStyles = content.getComputedStyle(content.document.body);
    return bodyStyles.backgroundColor;
  });
}

async function toggleStylesheetsVisibility(dbg) {
  const el = findElementWithSelector(
    dbg,
    ".toggleStyleSheetVisibility .dbg-img-eye-opened"
  );
  const buttonUpdated = waitForElementWithSelector(
    dbg,
    `.toggleStyleSheetVisibility .dbg-img-eye-${el ? "closed" : "opened"}`
  );
  clickElement(dbg, "toggleStyleSheetVisibilityButton");
  return buttonUpdated;
}
