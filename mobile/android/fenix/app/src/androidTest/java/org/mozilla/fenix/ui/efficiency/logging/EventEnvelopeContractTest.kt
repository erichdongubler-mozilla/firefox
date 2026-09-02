/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.efficiency.logging

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EventEnvelopeContractTest {
    private val identity =
        ExecutionIdentity(
            runId = "run-1",
            shardId = "shard-2",
            dispatchAttemptId = "dispatch-3",
            providerAttemptOrdinal = 2,
            executionPath = "direct_fleet",
            isolation = "app_data",
            source = "dispatcher",
        )

    @Test
    fun everyRecordCarriesOneVersionedExecutionIdentity() {
        var wall = 10L
        var monotonic = 20L
        val envelope =
            EventEnvelope(
                identity = identity,
                processId = 42,
                wallTimeMs = { wall++ },
                monotonicTimeNs = { monotonic++ },
            )

        val event = envelope.enrich(mapOf("type" to "state", "testId" to "testMethod"))

        val typed = event["eventEnvelope"] as Map<*, *>

        assertEquals(EventEnvelope.SCHEMA_VERSION, typed["eventSchemaVersion"])
        assertEquals("run-1", typed["runId"])
        assertEquals("shard-2", typed["shardId"])
        assertEquals("dispatch-3", typed["dispatchAttemptId"])
        assertEquals(2, typed["providerAttemptOrdinal"])
        assertEquals("direct_fleet", typed["executionPath"])
        assertEquals("app_data", typed["isolation"])
        assertEquals("dispatcher", typed["identitySource"])
        assertEquals(42, typed["processId"])
        assertEquals("state", typed["eventType"])
        assertEquals("state", event["type"])
        assertEquals(10L, event["ts"])
        assertEquals(10L, typed["wallTimeMs"])
        assertEquals(20L, typed["monotonicTimeNs"])
        assertTrue(typed["attemptId"].toString().isNotBlank())
    }

    @Test
    fun sequenceAndAttemptIdentityAreScopedToOneTestAttempt() {
        val envelope = EventEnvelope(identity, processId = 42)
        val arrival = envelope.enrich(mapOf("type" to "state", "testId" to "testMethod"))
        val start = envelope.enrich(mapOf("type" to "testStart", "testId" to "testMethod"))
        val step = envelope.enrich(mapOf("type" to "stepEnd"))
        val end = envelope.enrich(mapOf("type" to "testEnd", "testId" to "testMethod"))

        val typed = listOf(arrival, start, step, end).map { it["eventEnvelope"] as Map<*, *> }
        assertEquals(listOf(1L, 2L, 3L, 4L), typed.map { it["sequence"] })
        assertEquals(1, typed.map { it["attemptId"] }.toSet().size)
        assertEquals("testMethod", step["testId"])
    }

    @Test
    fun aRetryOfTheSameTestGetsANewAttemptIdentity() {
        val envelope = EventEnvelope(identity, processId = 42)
        val first = envelope.enrich(mapOf("type" to "testStart", "testId" to "testMethod"))
        envelope.enrich(mapOf("type" to "testEnd", "testId" to "testMethod"))
        val retry = envelope.enrich(mapOf("type" to "state", "testId" to "testMethod", "phase" to "arrival"))

        val firstTyped = first["eventEnvelope"] as Map<*, *>
        val retryTyped = retry["eventEnvelope"] as Map<*, *>
        assertNotEquals(firstTyped["attemptId"], retryTyped["attemptId"])
        assertEquals(1L, retryTyped["sequence"])
    }

    @Test
    fun eventsOutsideATestAreExplicitlyUnscoped() {
        val event = EventEnvelope(identity, processId = 42).enrich(mapOf("type" to "diagnostic"))

        assertEquals(EventEnvelope.UNSCOPED_TEST_ID, event["testId"])
        val typed = event["eventEnvelope"] as Map<*, *>
        assertTrue(typed["attemptId"].toString().isNotBlank())
    }
}
