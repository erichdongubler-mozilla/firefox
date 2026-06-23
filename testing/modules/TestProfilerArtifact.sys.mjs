/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Single place for test harnesses to save a profile as a CI artifact, shared
// between the mochitest (browser-test.js) and xpcshell (head.js) harnesses.
//
// installProfilerDumpAndQuit() registers an observer for the
// "profiler-dump-and-quit" topic, which Gecko notifies (see
// MOZ_DUMP_PROFILE_OR_CRASH_UNSAFE) when a fatal, test-only condition is hit
// during a profiled run. Rather than crashing and losing the profile, the
// observer reports a failure for the current test, saves the profile, and ends
// the process.

const DUMP_AND_QUIT_TOPIC = "profiler-dump-and-quit";

/**
 * Gather a gzipped profile of all processes, write it as a CI artifact in
 * MOZ_UPLOAD_DIR named after the test, and log (via logger) an unmissable
 * failure naming the artifact, so dashboards can associate the profile with the
 * test failure.
 *
 * Requires MOZ_UPLOAD_DIR to be set and the profiler to be active; callers are
 * expected to check those conditions.
 *
 * @param {string} testName Path or name of the test; only its basename is used.
 * @param {object} logger StructuredLogger used to report the failure.
 */
export async function uploadProfileArtifact(testName, logger) {
  let filename = `profile_${testName.replace(/.*\//, "")}.json`;
  let message;
  try {
    let path = PathUtils.join(Services.env.get("MOZ_UPLOAD_DIR"), filename);
    const { profile } =
      await Services.profiler.getProfileDataAsGzippedArrayBuffer();
    await IOUtils.write(path, new Uint8Array(profile));
    message = `profile uploaded in ${filename}`;
  } catch (e) {
    // If the profile is large, we may encounter out of memory errors.
    message = `failed to upload profile: ${e}`;
  }
  logger.testStatus(testName, null, "FAIL", "PASS", message);
}

async function saveProfileForFatalCondition(testName, logger) {
  if (Services.env.exists("MOZ_UPLOAD_DIR")) {
    await uploadProfileArtifact(testName, logger);
    return;
  }
  // Local --profiler runs save the profile on shutdown to this file instead.
  let shutdownFile = Services.env.get("MOZ_PROFILER_SHUTDOWN");
  if (shutdownFile) {
    await Services.profiler.dumpProfileToFileAsync(shutdownFile);
  }
}

let gDumpingAndQuitting = false;

/**
 * Register the handler for Gecko's "profiler-dump-and-quit" notification. When
 * a fatal test-only condition is hit during a profiled run, the handler reports
 * a failure (tied to the current test) via the harness, saves the profile, and
 * ends the process.
 *
 * @param {function(string): object} reportFatalCondition Harness callback that
 *   logs an unmissable failure for the current test, given the failure reason
 *   (recording a profiler marker captured in the saved profile), and returns
 *   { testName, logger, endTest }. testName names the profile artifact, logger
 *   reports where it was saved, and endTest() ends the test.
 */
export function installProfilerDumpAndQuit(reportFatalCondition) {
  Services.obs.addObserver((subject, topic, data) => {
    // Spinning the event loop below can deliver another notification before we
    // exit; only handle the first one.
    if (gDumpingAndQuitting) {
      return;
    }
    gDumpingAndQuitting = true;

    let { testName, logger, endTest } = reportFatalCondition(
      data || "fatal test-only condition"
    );

    if (Services.profiler.IsActive()) {
      let done = false;
      saveProfileForFatalCondition(testName, logger)
        .catch(e => {
          console.error(`Failed to save profile of the failure: ${e}`);
        })
        .finally(() => {
          done = true;
        });

      // The notification is delivered synchronously on the main thread, so spin
      // the event loop here to let the multi-process gather and the file write
      // complete before we end the process.
      Services.tm.spinEventLoopUntil(
        "TestProfilerArtifact:profiler-dump-and-quit",
        () => done
      );
    }

    // End the test only now: dashboards associate the profile with the test by
    // matching the upload message, which must be logged before the test_end
    // line that endTest() emits.
    endTest();

    Cu.exitIfInAutomation();
  }, DUMP_AND_QUIT_TOPIC);
}
