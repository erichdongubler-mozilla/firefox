/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.efficiency.devtools

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mozilla.fenix.ui.efficiency.helpers.BaseTest
import org.mozilla.fenix.ui.efficiency.helpers.StateProbe

@RunWith(AndroidJUnit4::class)
class StateContributorContractTest : BaseTest() {
    @Test
    fun contributorIdentityAndFieldOwnershipAreUnambiguous() {
        val descriptors = StateProbe.descriptors()
        val fields = descriptors.flatMap { it.fields }

        assertEquals(descriptors.size, descriptors.map { it.name }.toSet().size)
        assertEquals(fields.size, fields.toSet().size)
        assertTrue(descriptors.all { it.schemaVersion > 0 && it.fields.isNotEmpty() })
    }

    @Test
    fun snapshotMatchesTheDeclaredContributorContract() {
        val descriptors = StateProbe.descriptors()
        val snapshot = StateProbe.snapshot()

        assertEquals(descriptors.map { it.name }, snapshot.contributions.map { it.name })
        assertEquals(descriptors.flatMap { it.fields }.toSet(), snapshot.values.keys)
        snapshot.contributions.forEach { contribution ->
            val descriptor = descriptors.single { it.name == contribution.name }
            assertEquals(descriptor.fields, contribution.values.keys)
            assertEquals(descriptor.captureCost, contribution.captureCost)
            assertEquals(descriptor.sensitivity, contribution.sensitivity)
        }
    }
}
