/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/
 */

import { ObjectUtils } from "resource://gre/modules/ObjectUtils.sys.mjs";
import { TEST_PAGE_HTML, CONTEXTS, AllObjects } from "resource://testing-common/AllJavascriptTypes.mjs";
import { AddonTestUtils } from "resource://testing-common/AddonTestUtils.sys.mjs"

// Name of the environment variable to set while running the test to update the expected values
const UPDATE_SNAPSHOT_ENV = "UPDATE_SNAPSHOT";

export { CONTEXTS } from "resource://testing-common/AllJavascriptTypes.mjs";

// To avoid totally unrelated exceptions about missing appinfo when running from xpcshell tests
const isXpcshell = Services.env.exists("XPCSHELL_TEST_PROFILE_DIR");
if (isXpcshell) {
  AddonTestUtils.createAppInfo(
    "xpcshell@tests.mozilla.org",
    "XPCShell",
    "42",
    "42"
  );
}

let gTestScope;

/**
 * Initialize the test helper.
 *
 * @param {Object} testScope
 *        XPCShell or mochitest test scope (i.e. the global object of the test currently executed)
 */
function init(testScope) {
  if (!testScope?.gTestPath && !testScope?.Assert) {
    throw new Error("`JSObjectsTestUtils.init()` should be called with the (xpcshell or mochitest) test global object");
  }
  gTestScope = testScope;

  if ("gTestPath" in testScope) {
    AddonTestUtils.initMochitest(testScope);
  } else {
    AddonTestUtils.init(testScope);
  }

  const server = AddonTestUtils.createHttpServer({
    hosts: ["example.com"],
  });

  server.registerPathHandler("/", (request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.write(TEST_PAGE_HTML);
  });

  // Lookup for all preferences to toggle in order to have all the expected objects type functional
  const prefValues = new Map();
  for (const { prefs } of AllObjects) {
    if (!prefs) {
      continue;
    }
    for (const elt of prefs) {
      if (elt.length != 2) {
        throw new Error("Each pref should be an array of two element [prefName, prefValue]. Got: "+elt);
      }
      const [ name, value ] = elt;
      const otherValue = prefValues.get(name);
      if (otherValue && otherValue != value) {
        throw new Error(`Two javascript values in AllJavascriptTypes.mjs are expecting different values for '${name}' preference. (${otherValue} vs ${value})`);
      }
      prefValues.set(name, value);
      if (typeof(value) == "boolean") {
        Services.prefs.setBoolPref(name, value);
        gTestScope.registerCleanupFunction(() => {
          Services.prefs.clearUserPref(name);
        });
      } else {
        throw new Error("Unsupported pref type: "+name+" = "+value);
      }
    }
  }
}

let gExpectedValuesFilePath;
let gCurrentTestFolderUrl;

const chromeRegistry = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(
  Ci.nsIChromeRegistry
);
function loadExpectedValues(expectedValuesFileName) {
  const isUpdate = Services.env.get(UPDATE_SNAPSHOT_ENV) == "true";
  dump(`JS Objects test: ${isUpdate ? "Update" : "Check"} ${expectedValuesFileName}\n`);

  // Depending on the test suite, mochitest will expose `gTextPath` which is a chrome://
  // for the current test file.
  // Otherwise xpcshell will expose `resource://test/` for the current test folder.
  gCurrentTestFolderUrl = "gTestPath" in gTestScope 
      ? gTestScope.gTestPath.substr(0, gTestScope.gTestPath.lastIndexOf("/")) + "/"
      : "resource://test/";

  // Build the URL for the test data file
  const url = gCurrentTestFolderUrl + expectedValuesFileName;

  // Resolve the test data file URL into a file absolute path 
  if (url.startsWith("chrome")) {
    const chromeURL = Services.io.newURI(url);
    gExpectedValuesFilePath = chromeRegistry
      .convertChromeURL(chromeURL)
      .QueryInterface(Ci.nsIFileURL).file.path;
  } else if (url.startsWith("resource")) {
    const resURL = Services.io.newURI(url);
    const resHandler = Services.io.getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler);
    gExpectedValuesFilePath = Services.io.newURI(resHandler.resolveURI(resURL)).QueryInterface(Ci.nsIFileURL).file.path;
  }

  if (!isUpdate) {
    dump(`Loading test data file: ${url}\n`);
    return ChromeUtils.importESModule(url).default;
  }

  return null;
}

async function mayBeSaveExpectedValues(actualValues) {
  if (!actualValues?.length) {
    return;
  }

  const filePath = gExpectedValuesFilePath;
  const assertionValues = [];
  let i = 0;

  for (const objectDescription of AllObjects) {
    if (objectDescription.disabled) {
      continue;
    }

    if (i >= actualValues.length) {
      throw new Error("Unexpected discrepencies between the reported evaled strings and expected values");
    }

    const value = actualValues[i++]

    // Ignore this JS object as the test function did not return any actual value.
    // We assume none of the tests would store "undefined" as a target value.
    if (value == undefined) {
      continue;
    }

    let evaled = objectDescription.expression;
    // Remove any first empty line
    evaled = evaled.replace(/^\s*\n/, "");
    // remove the unnecessary indentation
    const m = evaled.match(/^( +)/);
    if (m && m[1]) {
      const regexp = new RegExp("^"+m[1], "gm");
      evaled = evaled.replace(regexp, "");
    }
    // Ensure prefixing all new lines in the evaled string with "  //"
    // to keep it being in a code comment.
    evaled = evaled.replace(/\r?\n/g, "\n  // ");

    assertionValues.push(
      "  // " + evaled +
        "\n" +
        "  " +
        JSON.stringify(value, null, 2) +
        ","
    );
  }

  if (i != actualValues.length) {
    throw new Error("Unexpected discrepencies between the reported evaled strings and expected values");
  }

  const fileContent = `/* Any copyright is dedicated to the Public Domain.
  http://creativecommons.org/publicdomain/zero/1.0/ */

/*
 * THIS FILE IS AUTOGENERATED. DO NOT MODIFY BY HAND.
 *
 * More info in https://firefox-source-docs.mozilla.org/devtools/tests/js-object-tests.html
 */

export default [
${assertionValues.join("\n\n")}
];`;
  dump("Writing: " + fileContent + " in " + filePath + "\n");
  await IOUtils.write(filePath, new TextEncoder().encode(fileContent));
}

async function testOrUpdateExpectedValues(expectedValuesFileName, actualValues) {
  let expectedValues = loadExpectedValues(expectedValuesFileName);
  if (expectedValues) {
    // Clone the Array as we are going to mutate it via Array.shift().
    expectedValues = [...expectedValues];

    const testPath = "gtestPath" in gTestScope ? gTestScope.gTestPath.replace("chrome://mochitest/content/browser/", "") : "path/to/your/xpcshell/test";
    const failureMessage = `This is a JavaScript value processing test, which includes an automatically generated snapshot file (${expectedValuesFileName}).\n` +
      "You may update this file by running:`\n" +
      `  $ mach test ${testPath} --headless --setenv ${UPDATE_SNAPSHOT_ENV}=true\n` +
      "And then carefuly review if the result is valid regarding your ongoing changes.\n" +
      "`More info in https://firefox-source-docs.mozilla.org/devtools/tests/js-object-tests.html\n";

    let failed = false;
    let i = 0;
    for (const objectDescription of AllObjects) {
      if (objectDescription.disabled) {
        continue;
      }
      const actual = actualValues[i++];
      const expression = objectDescription.expression;

      // Ignore this JS object as the test function did not return any actual value.
      // We assume none of the tests would store "undefined" as a target value.
      if (actual == undefined) {
        continue;
      }

      const expected = expectedValues.shift();

      const isMochitest = "gTestPath" in gTestScope;
      try {
        gTestScope.Assert.deepEqual(actual, expected, `Got expected output for "${expression}"`);
      } catch(e) {
        // deepEqual only throws in case of differences when running in XPCShell tests. Mochitest won't throw and keep running.
        // XPCShell will stop at the first failing assertion, so ensure showing our failure message and ok() will throw and stop the test.
        if (!isMochitest) {
          gTestScope.Assert.ok(false, failureMessage);
        }
        throw e;
      }
      // As mochitest won't throw when calling deepEqual with differences in the objects,
      // we have to recompute the difference in order to know if any of the tests failed.
      if (isMochitest && !failed && !ObjectUtils.deepEqual(actual, expected)) {
        failed = true;
      }
    }

    if (failed) {
      const failMessage = "This is a JavaScript value processing test, which includes an automatically generated snapshot file.\n" +
        "If the change made to that snapshot file makes sense, you may simply update them by running:`\n" +
        `  $ mach test ${testPath} --headless --setenv ${UPDATE_SNAPSHOT_ENV}=true\n` +
        "`More info in devtools/shared/tests/objects/README.md\n";
      gTestScope.Assert.ok(false, failMessage);
    }
  }

  mayBeSaveExpectedValues(actualValues);
}

async function runTest(expectedValuesFileName, testFunction) {
  if (!gTestScope) {
    throw new Error("`JSObjectsTestUtils.init()` should be called before `runTest()`");
  }
  if (typeof (expectedValuesFileName) != "string") {
    throw new Error("`JSObjectsTestUtils.runTest()` first argument should be a data file name");
  }
  if (typeof (testFunction) != "function") {
    throw new Error("`JSObjectsTestUtils.runTest()` second argument should be a test function");
  }

  const actualValues = [];

  if (!gTestScope) {
    throw new Error("`JSObjectsTestUtils.init()` should be called before `runTest()`");
  }

  for (const objectDescription of AllObjects) {
    if (objectDescription.disabled) {
      continue;
    }

    const { context, expression } = objectDescription;
    if (!Object.values(CONTEXTS).includes(context)) {
      throw new Error("Missing, or invalid context in: " + JSON.stringify(objectDescription));
    }

    if (!expression) {
      throw new Error("Missing a value in: " + JSON.stringify(objectDescription));
    }

    const actual = await testFunction({ context, expression });
    actualValues.push(actual);
  }

  testOrUpdateExpectedValues(expectedValuesFileName, actualValues);
}

export const JSObjectsTestUtils = { init, runTest, testOrUpdateExpectedValues };
