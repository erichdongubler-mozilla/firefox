"use strict";

const TEST_DEFAULT_CONTENT = [
  {
    id: "AW_STEP1",
    content: {
      title: "Step 1",
      primary_button: {
        label: "Next",
        action: {
          navigate: true,
        },
      },
      secondary_button: {
        label: "Secondary",
      },
    },
  },
  {
    id: "AW_STEP2",
    targeting: "false",
    content: {
      title: "Step 2",
      primary_button: {
        label: "Next",
        action: {
          navigate: true,
        },
      },
      secondary_button: {
        label: "Secondary",
      },
    },
  },
  {
    id: "AW_STEP3",
    content: {
      title: "Step 3",
      primary_button: {
        label: "Next",
        action: {
          navigate: true,
        },
      },
      secondary_button: {
        label: "Secondary",
      },
    },
  },
];

const TEST_DEFAULT_JSON = JSON.stringify(TEST_DEFAULT_CONTENT);

add_task(async function second_screen_filtered_by_targeting() {
  const sandbox = sinon.createSandbox();
  let browser = await openAboutWelcome(TEST_DEFAULT_JSON);

  await test_screen_content(
    browser,
    "multistage step 1",
    // Expected selectors:
    ["main.AW_STEP1"],
    // Unexpected selectors:
    ["main.AW_STEP2", "main.AW_STEP3"]
  );

  await onButtonClick(browser, "button.primary");

  await test_screen_content(
    browser,
    "multistage step 3",
    // Expected selectors:
    ["main.AW_STEP3"],
    // Unexpected selectors:
    ["main.AW_STEP2", "main.AW_STEP1"]
  );

  sandbox.restore();
  await popPrefs();
});

/**
 * Test MR template easy setup default content - Browser is not pinned
 * and not set as default
 */
add_task(async function test_aboutwelcome_mr_template_easy_setup_default() {
  const sandbox = sinon.createSandbox();
  await pushPrefs(
    ["browser.shell.checkDefaultBrowser", true],
    ["messaging-system-action.showEmbeddedImport", false]
  );
  sandbox.stub(ShellService, "doesAppNeedPin").returns(true);
  sandbox.stub(ShellService, "isDefaultBrowser").returns(false);

  await clearHistoryAndBookmarks();

  const { browser, cleanup } = await openMRAboutWelcome();

  //should render easy setup with all checkboxes (pin, default, import)
  await test_screen_content(
    browser,
    "renders easy setup with pin, default, and import checkboxes",
    //Expected selectors:
    [
      "main.AW_EASY_SETUP",
      "#checkbox-pin",
      "#checkbox-default",
      "#checkbox-import",
    ],
    //Unexpected selectors:
    []
  );

  await cleanup();
  await popPrefs();
  sandbox.restore();
});

/**
 * Test MR template easy setup content - Browser is not pinned
 * and set as default
 */
add_task(async function test_aboutwelcome_mr_template_easy_setup_needs_pin() {
  const sandbox = sinon.createSandbox();
  await pushPrefs(
    ["browser.shell.checkDefaultBrowser", true],
    ["messaging-system-action.showEmbeddedImport", false]
  );
  sandbox.stub(ShellService, "doesAppNeedPin").returns(true);
  sandbox.stub(ShellService, "isDefaultBrowser").returns(true);

  await clearHistoryAndBookmarks();

  const { browser, cleanup } = await openMRAboutWelcome();

  //should render easy setup with only pin checkbox visible
  await test_screen_content(
    browser,
    "renders easy setup with only pin checkbox and import checkbox",
    //Expected selectors:
    ["main.AW_EASY_SETUP", "#checkbox-pin", "#checkbox-import"],
    //Unexpected selectors:
    ["#checkbox-default"]
  );

  await cleanup();
  await popPrefs();
  sandbox.restore();
});

/**
 * Test MR template easy setup content - Browser is pinned and
 * not set as default
 */
add_task(
  async function test_aboutwelcome_mr_template_easy_setup_needs_default() {
    const sandbox = sinon.createSandbox();
    await pushPrefs(
      ["browser.shell.checkDefaultBrowser", true],
      ["messaging-system-action.showEmbeddedImport", false]
    );
    sandbox.stub(ShellService, "doesAppNeedPin").returns(false);
    sandbox.stub(ShellService, "doesAppNeedStartMenuPin").returns(false);
    sandbox.stub(ShellService, "isDefaultBrowser").returns(false);

    await clearHistoryAndBookmarks();

    const { browser, cleanup } = await openMRAboutWelcome();

    //should render easy setup with only default checkbox
    await test_screen_content(
      browser,
      "renders easy setup with only default checkbox and import checkbox",
      //Expected selectors:
      ["main.AW_EASY_SETUP", "#checkbox-default", "#checkbox-import"],
      //Unexpected selectors:
      ["#checkbox-pin"]
    );

    await cleanup();
    await popPrefs();
    sandbox.restore();
  }
);

/**
 * Test MR template easy setup content - Browser is pinned and
 * set as default
 */
add_task(async function test_aboutwelcome_mr_template_easy_setup_only_import() {
  const sandbox = sinon.createSandbox();
  await pushPrefs(
    ["browser.shell.checkDefaultBrowser", true],
    ["messaging-system-action.showEmbeddedImport", false]
  );
  sandbox.stub(ShellService, "doesAppNeedPin").returns(false);
  sandbox.stub(ShellService, "doesAppNeedStartMenuPin").returns(false);
  sandbox.stub(ShellService, "isDefaultBrowser").returns(true);

  await clearHistoryAndBookmarks();

  const { browser, cleanup } = await openMRAboutWelcome();

  //should render easy setup with only import checkbox
  await test_screen_content(
    browser,
    "renders easy setup with only import checkbox",
    //Expected selectors:
    ["main.AW_EASY_SETUP", "#checkbox-import"],
    //Unexpected selectors:
    ["#checkbox-pin", "#checkbox-default"]
  );

  await cleanup();
  await popPrefs();
  sandbox.restore();
});
