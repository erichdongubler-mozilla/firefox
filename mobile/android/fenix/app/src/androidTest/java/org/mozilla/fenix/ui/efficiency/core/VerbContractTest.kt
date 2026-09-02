/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.efficiency.core

import androidx.compose.ui.test.SemanticsNodeInteractionCollection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.mozilla.fenix.ui.efficiency.helpers.Selector
import org.mozilla.fenix.ui.efficiency.logging.StepDescriptor
import org.mozilla.fenix.ui.efficiency.logging.StepLogger
import org.mozilla.fenix.ui.efficiency.logging.StepResult
import org.mozilla.fenix.ui.efficiency.logging.TestStatus
import org.mozilla.fenix.ui.efficiency.logging.TimedReporter

class VerbContractTest {
    @Test
    fun anEmptySelectorGroupCannotSucceedVacuously() {
        val logger = RecordingStepLogger()
        val host = FakeVerbHost(TimedReporter(logger))

        val present = host.groupPresent(verb = "verify_group", label = "Page_requiredForPage", selectors = emptyList())

        assertFalse(present)
        assertEquals(0, host.locateCalls)
        assertEquals(Failure.EMPTY_SELECTOR_GROUP, logger.completed.single().args["failure"])
    }

    private class FakeVerbHost(private val timedReporter: TimedReporter) : VerbHost {
        var locateCalls = 0

        override fun reporter() = timedReporter

        override fun locate(selector: Selector, applyPreconditions: Boolean): Any? {
            locateCalls += 1
            return null
        }

        override fun locateAll(selector: Selector): SemanticsNodeInteractionCollection? = null

        override fun dismissOverlays() = false

        override fun dumpFailure(label: String) = Unit

        override fun stepId(prefix: String, description: String) = "$prefix-$description"
    }

    private class RecordingStepLogger : StepLogger {
        val completed = mutableListOf<StepDescriptor>()

        override fun testStart(testId: String, meta: Map<String, Any?>) = Unit

        override fun testEnd(testId: String, status: TestStatus) = Unit

        override fun stepStart(step: StepDescriptor) = Unit

        override fun stepEnd(step: StepDescriptor, result: StepResult) {
            completed += step
        }

        override fun record(type: String, fields: Map<String, Any?>) = Unit
    }
}
