# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.


from taskgraph.transforms.base import TransformSequence
from taskgraph.util.copy import deepcopy
from taskgraph.util.schema import Schema, optionally_keyed_by, resolve_keyed_by
from taskgraph.util.treeherder import join_symbol, split_symbol
from voluptuous import Extra, Optional, Required

from gecko_taskgraph.transforms.test import test_description_schema
from gecko_taskgraph.util.perftest import is_external_browser

transforms = TransformSequence()
task_transforms = TransformSequence()

raptor_description_schema = Schema(
    {
        # Raptor specific configs.
        Optional("raptor"): {
            Optional("activity"): optionally_keyed_by("app", str),
            Optional("apps"): optionally_keyed_by("test-platform", "subtest", [str]),
            Optional("binary-path"): optionally_keyed_by("app", str),
            Optional("run-visual-metrics"): optionally_keyed_by(
                "app", "test-platform", bool
            ),
            Optional("subtests"): optionally_keyed_by("app", "test-platform", list),
            Optional("test"): str,
            Optional("test-url-param"): optionally_keyed_by(
                "subtest", "test-platform", str
            ),
            Optional("lull-schedule"): optionally_keyed_by(
                "subtest", "test-platform", str
            ),
            Optional("network-conditions"): optionally_keyed_by("subtest", list),
        },
        # Configs defined in the 'test_description_schema'.
        Optional("max-run-time"): optionally_keyed_by(
            "app", "subtest", "test-platform", test_description_schema["max-run-time"]
        ),
        Optional("run-on-projects"): optionally_keyed_by(
            "app",
            "test-name",
            "raptor.test",
            "subtest",
            "variant",
            test_description_schema["run-on-projects"],
        ),
        Optional("variants"): test_description_schema["variants"],
        Optional("target"): optionally_keyed_by(
            "app", test_description_schema["target"]
        ),
        Optional("tier"): optionally_keyed_by(
            "app", "raptor.test", "subtest", "variant", test_description_schema["tier"]
        ),
        Required("test-name"): test_description_schema["test-name"],
        Required("test-platform"): test_description_schema["test-platform"],
        Required("require-signed-extensions"): test_description_schema[
            "require-signed-extensions"
        ],
        Required("treeherder-symbol"): test_description_schema["treeherder-symbol"],
        # Any unrecognized keys will be validated against the test_description_schema.
        Extra: object,
    }
)

transforms.add_validate(raptor_description_schema)


@transforms.add
def set_defaults(config, tests):
    for test in tests:
        test.setdefault("raptor", {}).setdefault("run-visual-metrics", False)
        yield test


@transforms.add
def split_apps(config, tests):
    app_symbols = {
        "chrome": "ChR",
        "chrome-m": "ChR",
        "fenix": "fenix",
        "refbrow": "refbrow",
        "safari": "Saf",
        "safari-tp": "STP",
        "custom-car": "CaR",
        "cstm-car-m": "CaR",
    }

    for test in tests:
        apps = test["raptor"].pop("apps", None)
        if not apps:
            yield test
            continue

        for app in apps:
            # Ignore variants for non-Firefox or non-mobile applications.
            if app not in [
                "firefox",
                "geckoview",
                "fenix",
                "chrome-m",
                "cstm-car-m",
            ] and test["attributes"].get("unittest_variant"):
                continue

            atest = deepcopy(test)
            suffix = f"-{app}"
            atest["app"] = app
            atest["description"] += f" on {app.capitalize()}"

            name = atest["test-name"] + suffix
            atest["test-name"] = name
            atest["try-name"] = name

            if app in app_symbols:
                group, symbol = split_symbol(atest["treeherder-symbol"])
                group += f"-{app_symbols[app]}"
                atest["treeherder-symbol"] = join_symbol(group, symbol)

            yield atest


@transforms.add
def handle_keyed_by_prereqs(config, tests):
    """
    Only resolve keys for prerequisite fields here since the
    these keyed-by options might have keyed-by fields
    as well.
    """
    for test in tests:
        resolve_keyed_by(test, "raptor.subtests", item_name=test["test-name"])
        yield test


@transforms.add
def split_raptor_subtests(config, tests):
    for test in tests:
        # For tests that have 'subtests' listed, we want to create a separate
        # test job for every subtest (i.e. split out each page-load URL into its own job)
        subtests = test["raptor"].pop("subtests", None)
        if not subtests:
            if all(
                p not in test["test-platform"] for p in ("macosx1400", "macosx1500")
            ):
                yield test
            continue

        for chunk_number, subtest in enumerate(subtests):
            # Create new test job
            chunked = deepcopy(test)
            chunked["chunk-number"] = 1 + chunk_number
            chunked["subtest"] = subtest
            chunked["subtest-symbol"] = subtest
            if isinstance(chunked["subtest"], list):
                chunked["subtest"] = subtest[0]
                chunked["subtest-symbol"] = subtest[1]
            chunked = resolve_keyed_by(
                chunked, "tier", chunked["subtest"], defer=["variant"]
            )
            yield chunked


@transforms.add
def handle_keyed_by(config, tests):
    fields = [
        "raptor.test-url-param",
        "raptor.run-visual-metrics",
        "raptor.activity",
        "raptor.binary-path",
        "raptor.lull-schedule",
        "raptor.network-conditions",
        "limit-platforms",
        "fetches.fetch",
        "max-run-time",
        "run-on-projects",
        "target",
        "tier",
        "mozharness.extra-options",
    ]
    for test in tests:
        for field in fields:
            resolve_keyed_by(
                test, field, item_name=test["test-name"], defer=["variant"]
            )
        yield test


@transforms.add
def handle_network_conditions(config, tests):
    for test in tests:
        conditions = test["raptor"].pop("network-conditions", None)
        if not conditions:
            yield test
            continue

        for condition in conditions:
            new_test = deepcopy(test)
            network_type, packet_loss_rate = condition

            new_test.pop("chunk-number")
            subtest = new_test.pop("subtest")
            new_test["raptor"]["test"] = subtest

            group, _ = split_symbol(new_test["treeherder-symbol"])
            new_group = f"{group}-{network_type}"
            subtest_symbol = f"{new_test['subtest-symbol']}-{packet_loss_rate}"
            new_test["treeherder-symbol"] = join_symbol(new_group, subtest_symbol)

            mozharness = new_test.setdefault("mozharness", {})
            extra_options = mozharness.setdefault("extra-options", [])

            extra_options.extend(
                [
                    f"--browsertime-arg=network_type={network_type}",
                    f"--browsertime-arg=pkt_loss_rate={packet_loss_rate}",
                ]
            )

            new_test["test-name"] += f"-{subtest}-{network_type}-{packet_loss_rate}"
            new_test["try-name"] += f"-{subtest}-{network_type}-{packet_loss_rate}"
            new_test["description"] += (
                f" on {subtest} with {network_type} network type and "
                f" {packet_loss_rate} loss rate"
            )

            yield new_test

        yield test


@transforms.add
def split_page_load_by_url(config, tests):
    for test in tests:
        # `chunk-number` and 'subtest' only exists when the task had a
        # definition for `subtests`
        chunk_number = test.pop("chunk-number", None)
        subtest = test.get(
            "subtest"
        )  # don't pop as some tasks need this value after splitting variants
        subtest_symbol = test.pop("subtest-symbol", None)

        if not chunk_number or not subtest:
            yield test
            continue

        if len(subtest_symbol) > 10 and "ytp" not in subtest_symbol:
            raise Exception(
                "Treeherder symbol %s is larger than 10 char! Please use a different symbol."
                % subtest_symbol
            )

        if test["test-name"].startswith("browsertime-"):
            test["raptor"]["test"] = subtest

            # Remove youtube-playback in the test name to avoid duplication
            test["test-name"] = test["test-name"].replace("youtube-playback-", "")
        else:
            # Use full test name if running on webextension
            test["raptor"]["test"] = "raptor-tp6-" + subtest + "-{}".format(test["app"])

        # Only run the subtest/single URL
        test["test-name"] += f"-{subtest}"
        test["try-name"] += f"-{subtest}"

        # Set treeherder symbol and description
        group, _ = split_symbol(test["treeherder-symbol"])
        test["treeherder-symbol"] = join_symbol(group, subtest_symbol)
        test["description"] += f" on {subtest}"

        yield test


@transforms.add
def modify_extra_options(config, tests):
    for test in tests:
        test_name = test.get("test-name", None)

        if "first-install" in test_name:
            # First-install tests should never use conditioned profiles
            extra_options = test.setdefault("mozharness", {}).setdefault(
                "extra-options", []
            )

            for i, opt in enumerate(extra_options):
                if "conditioned-profile" in opt:
                    if i:
                        extra_options.pop(i)
                    break

        if "-widevine" in test_name:
            extra_options = test.setdefault("mozharness", {}).setdefault(
                "extra-options", []
            )
            for i, opt in enumerate(extra_options):
                if "--conditioned-profile=settled" in opt:
                    if i:
                        extra_options[i] += "-youtube"
                    break

        if "unity-webgl" in test_name:
            # Disable the extra-profiler-run for unity-webgl tests.
            extra_options = test.setdefault("mozharness", {}).setdefault(
                "extra-options", []
            )
            for i, opt in enumerate(extra_options):
                if "extra-profiler-run" in opt:
                    if i:
                        extra_options.pop(i)
                    break

        yield test


@transforms.add
def add_extra_options(config, tests):
    for test in tests:
        mozharness = test.setdefault("mozharness", {})
        if test.get("app", "") == "chrome-m":
            mozharness["tooltool-downloads"] = "internal"

        extra_options = mozharness.setdefault("extra-options", [])

        # Adding device name if we're on android
        test_platform = test["test-platform"]
        if test_platform.startswith("android-hw-a55"):
            extra_options.append("--device-name=a55")
        elif test_platform.startswith("android-hw-p5"):
            extra_options.append("--device-name=p5_aarch64")
        elif test_platform.startswith("android-hw-p6"):
            extra_options.append("--device-name=p6_aarch64")
        elif test_platform.startswith("android-hw-s24"):
            extra_options.append("--device-name=s24_aarch64")

        if test["raptor"].pop("run-visual-metrics", False):
            extra_options.append("--browsertime-video")
            extra_options.append("--browsertime-visualmetrics")
            test["attributes"]["run-visual-metrics"] = True

        if "app" in test:
            extra_options.append(
                "--app={}".format(test["app"])
            )  # don't pop as some tasks need this value after splitting variants

        if "activity" in test["raptor"]:
            extra_options.append("--activity={}".format(test["raptor"].pop("activity")))

        if "binary-path" in test["raptor"]:
            extra_options.append(
                "--binary-path={}".format(test["raptor"].pop("binary-path"))
            )

        if "test" in test["raptor"]:
            extra_options.append("--test={}".format(test["raptor"].pop("test")))

        if test["require-signed-extensions"]:
            extra_options.append("--is-release-build")

        if "test-url-param" in test["raptor"]:
            param = test["raptor"].pop("test-url-param")
            if not param == []:
                extra_options.append(
                    "--test-url-params={}".format(param.replace(" ", ""))
                )

        if (
            ("android-hw-p6" in test_platform or "android-hw-s24" in test_platform)
            and "speedometer-" not in test["test-name"]
            # Bug 1943674 resolve why --power-test causes permafails on certain mobile platforms and browsers
        ) or (
            "android-hw-a55" in test_platform
            and any(t in test["test-name"] for t in ("tp6", "speedometer3"))
            # Bug 1919024 remove tp6 and sp3 restrictions once benchmark parsing is done in the support scripts
        ):
            if "--power-test" not in extra_options:
                extra_options.append("--power-test")
        elif "windows" in test_platform and any(
            t in test["test-name"] for t in ("speedometer3", "tp6")
        ):
            extra_options.append("--power-test")

        extra_options.append("--project={}".format(config.params.get("project")))

        yield test


@transforms.add
def modify_mozharness_configs(config, tests):
    for test in tests:
        if not is_external_browser(test["app"]):
            yield test
            continue

        test_platform = test["test-platform"]
        mozharness = test.setdefault("mozharness", {})
        if "mac" in test_platform:
            mozharness["config"] = ["raptor/mac_external_browser_config.py"]
        elif "windows" in test_platform:
            mozharness["config"] = ["raptor/windows_external_browser_config.py"]
        elif "linux" in test_platform:
            mozharness["config"] = ["raptor/linux_external_browser_config.py"]
        elif "android" in test_platform:
            test["target"] = "target.tar.xz"
            mozharness["config"] = ["raptor/android_hw_external_browser_config.py"]

        yield test


@transforms.add
def handle_lull_schedule(config, tests):
    # Setup lull schedule attribute here since the attributes
    # can't have any keyed by settings
    for test in tests:
        if "lull-schedule" in test["raptor"]:
            lull_schedule = test["raptor"].pop("lull-schedule")
            if lull_schedule:
                test.setdefault("attributes", {})["lull-schedule"] = lull_schedule
        yield test


@transforms.add
def apply_raptor_device_optimization(config, tests):
    # Bug 1919389
    # For now, only change the back stop optimization strategy for A55 devices
    for test in tests:
        if test["test-platform"].startswith("android-hw-a55"):
            test["optimization"] = {"skip-unless-backstop": None}
        yield test


@task_transforms.add
def add_scopes_and_proxy(config, tasks):
    for task in tasks:
        task.setdefault("worker", {})["taskcluster-proxy"] = True
        task.setdefault("scopes", []).append(
            "secrets:get:project/perftest/gecko/level-{level}/perftest-login"
        )
        yield task


@task_transforms.add
def setup_lull_schedule(config, tasks):
    for task in tasks:
        attrs = task.setdefault("attributes", {})
        if attrs.get("lull-schedule", None) is not None:
            # Move the lull schedule attribute into the extras
            # so that it can be accessible through mozci
            lull_schedule = attrs.pop("lull-schedule")
            task.setdefault("extra", {})["lull-schedule"] = lull_schedule
        yield task


@task_transforms.add
def setup_lambdatest_options(config, tasks):
    for task in tasks:
        if task.get("worker", {}).get("os", "") == "linux-lambda":
            commands = task["worker"]["command"]
            modified = []
            for command in commands:
                modified.append(
                    [
                        c
                        for c in command
                        if not c.startswith("--conditioned-profile")
                        and not c.startswith("--power-test")
                    ]
                )
            task["worker"]["command"] = modified
            task["worker"]["env"]["DISABLE_USB_POWER_METER_RESET"] = "1"
        yield task


@task_transforms.add
def setup_internal_artifacts(config, tasks):
    for task in tasks:
        if (
            task["worker"]["os"] == "linux-bitbar"
            or task["worker"]["os"] == "linux-lambda"
        ):
            task["worker"].setdefault("artifacts", []).append(
                {
                    "name": "perftest",
                    "path": "workspace/build/perftest",
                    "type": "directory",
                }
            )
        else:
            task["worker"].setdefault("artifacts", []).append(
                {
                    "name": "perftest",
                    "path": "build/perftest",
                    "type": "directory",
                }
            )
        yield task


@task_transforms.add
def select_tasks_to_lambda(config, tasks):
    """
    all motionmark tests
    unity-webgl test
    all non-power-testing youtube-playback tests
    all vpl (video-playback-latency) tests

    """
    tests_to_run_at_lambdatest = [
        "motionmark-1-3",
        "motionmark-htmlsuite-1-3",
        "unity-webgl",
        "video-playback-latency",
        "youtube-playback-av1-sfr",
        "youtube-playback-hfr",
        "youtube-playback-vp9-sfr",
    ]

    tests_to_run_at_lambdatest.extend(
        [f"{t}-nofis" for t in tests_to_run_at_lambdatest]
    )

    for task in tasks:
        if "android" in task["label"] and "a55" in task["label"]:
            if any([t in task["label"] for t in tests_to_run_at_lambdatest]):
                if task["worker-type"] == "t-bitbar-gw-perf-a55":
                    task["tags"]["os"] = "linux-lambda"
                    task["worker"]["os"] = "linux-lambda"
                    task["worker-type"] = "t-lambda-perf-a55"
                    task["worker"]["env"][
                        "TASKCLUSTER_WORKER_TYPE"
                    ] = "t-lambda-perf-a55"
                    cmds = []
                    for cmd in task["worker"]["command"]:
                        cmds.append(
                            [
                                c.replace(
                                    "/builds/taskcluster/script.py",
                                    "/home/ltuser/taskcluster/script.py",
                                )
                                for c in cmd
                            ]
                        )
                    task["worker"]["command"] = cmds
        yield task
