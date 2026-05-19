# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from taskgraph.parameters import Parameters

from gecko_taskgraph.actions.registry import register_callback_action
from gecko_taskgraph.decision import taskgraph_decision


@register_callback_action(
    name="os-integration",
    title="Run OS Integration Tests",
    symbol="osint",
    description=(
        "Manually trigger the OS integration test suite, equivalent to the weekly "
        "Monday cron job. On non-try repositories, hardware tasks (macOS, Android HW) "
        "are excluded, matching the cron job's behaviour."
    ),
    order=500,
    context=[],
    schema={
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
)
def run_os_integration_action(parameters, graph_config, input, task_group_id, task_id):
    parameters = dict(parameters)
    parameters["target_tasks_method"] = "os-integration"
    parameters["optimize_target_tasks"] = True
    parameters = Parameters(**parameters)
    taskgraph_decision({"root": graph_config.root_dir}, parameters=parameters)
