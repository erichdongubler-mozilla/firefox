# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
import copy

import filters
from base_python_support import BasePythonSupport
from logger.logger import RaptorLogger

LOG = RaptorLogger(component="perftest-nav-bench")

# Phase suffix appended to each site key in the alias.
#   alias = "<site>-load"     -> initial navigation (every site)
#   alias = "<site>-subnav"   -> warm hard-nav (bbc, ddg)
PHASES = ("load", "subnav")

# LoadLine2-style score scaling. score = SCORE_TARGET_MS / SpeedIndex_ms.
SCORE_TARGET_MS = 60000.0


def _parse_alias(alias):
    """Split '<site>-<phase>' into (site, phase). Returns (None, None) if the
    alias does not end with one of the known phase suffixes."""
    if not alias:
        return None, None
    for phase in PHASES:
        suffix = "-" + phase
        if alias.endswith(suffix):
            return alias[: -len(suffix)], phase
    return None, None


class NavBenchSupport(BasePythonSupport):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # (site, phase) -> [SpeedIndex per cycle]
        self._speedindex = {}

    def handle_result(self, bt_result, raw_result, last_result=False, **kwargs):
        """One raw_result per measure.start/stop pair, with alias set in
        raw_result['info']['alias']. visualMetrics is one item per cycle."""
        alias = raw_result.get("info", {}).get("alias")
        site, phase = _parse_alias(alias)
        if not site:
            return

        for vm in raw_result.get("visualMetrics", []):
            si = vm.get("SpeedIndex")
            if not si:
                LOG.warning(
                    f"nav-bench: {site}/{phase} has bad SpeedIndex ({si}); skipping cycle"
                )
                continue
            self._speedindex.setdefault((site, phase), []).append(int(si))

    def _build_score_subtest(self, name, replicates, test):
        return {
            "name": name,
            "lowerIsBetter": False,
            "alertThreshold": float(test.get("alert_threshold", 5.0)),
            "unit": "score",
            "replicates": replicates,
            "value": round(filters.geometric_mean(replicates), 3),
            "shouldAlert": True,
        }

    def summarize_test(self, test, suite, **kwargs):
        """One suite for the whole composite test. One subtest per (site, phase),
        named '<site>-<phase>-score'. Suite value = geomean of all replicates."""
        suite["type"] = "pageload"
        suite["lowerIsBetter"] = False
        suite["unit"] = "score"
        if suite["subtests"] == {}:
            suite["subtests"] = []

        all_replicates = []
        for (site, phase), si_values in sorted(self._speedindex.items()):
            if not si_values:
                LOG.warning(f"nav-bench: {site}/{phase} has no SpeedIndex samples")
                continue
            score_replicates = [round(SCORE_TARGET_MS / si, 3) for si in si_values]
            suite["subtests"].append(
                self._build_score_subtest(
                    f"{site}-{phase}-score", score_replicates, test
                )
            )
            suite["subtests"].append({
                "name": f"{site}-{phase}-speedindex",
                "lowerIsBetter": True,
                "alertThreshold": float(test.get("alert_threshold", 5.0)),
                "unit": "ms",
                "replicates": list(si_values),
                "value": round(filters.geometric_mean(si_values), 3),
                "shouldAlert": False,
            })
            # Minimum SpeedIndex (ms) is the theoretically best estimator of true
            # page performance under one-sided noise (Chen & Revels 2016). Tracked
            # for trend visibility but not alerted on at low cycle counts.
            suite["subtests"].append({
                "name": f"{site}-{phase}-min-si",
                "lowerIsBetter": True,
                "alertThreshold": float(test.get("alert_threshold", 5.0)),
                "unit": "ms",
                "replicates": list(si_values),
                "value": min(si_values),
                "shouldAlert": False,
            })
            all_replicates.extend(score_replicates)

        suite["subtests"].sort(key=lambda subtest: subtest["name"])
        if all_replicates:
            suite["value"] = round(filters.geometric_mean(all_replicates), 3)

    def summarize_suites(self, suites):
        """Synthesize an overall suite aggregating every (site, phase, cycle)
        score into one geomean. The per-test suite stays intact for alerting."""
        if not suites:
            return

        all_subtests = []
        all_replicates = []
        for suite in suites:
            for subtest in suite.get("subtests", []):
                if subtest.get("name", "").endswith("-score"):
                    all_subtests.append(copy.deepcopy(subtest))
                    all_replicates.extend(subtest["replicates"])

        if not all_replicates:
            return

        overall = copy.deepcopy(suites[0])
        overall["name"] = "nav-bench-overall"
        overall["type"] = "pageload"
        overall["lowerIsBetter"] = False
        overall["unit"] = "score"
        overall["subtests"] = all_subtests
        overall["value"] = round(filters.geometric_mean(all_replicates), 3)

        suites.insert(0, overall)
