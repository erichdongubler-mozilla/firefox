/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.efficiency.devtools

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters
import org.mozilla.fenix.ui.efficiency.helpers.BaseTest
import org.mozilla.fenix.ui.efficiency.navigation.NavigationRegistry

@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class PageContextLifecycleTest : BaseTest() {
    companion object {
        private var previousGraph: String? = null
    }

    @Test
    fun aRepeatedFacadeAccessKeepsOneContextAndOneGraph() {
        val graph = assertContextAndGraphLifecycle()
        previousGraph = graph
        NavigationRegistry.register("LifecycleSentinel", "LifecycleSentinel", emptyList())
    }

    @Test
    fun bTheNextTestRebuildsRatherThanAppendingTheGraph() {
        previousGraph?.let {
            assertFalse("LifecycleSentinel" in NavigationRegistry.diagnostics().pages)
            assertEquals(it, assertContextAndGraphLifecycle())
        } ?: assertContextAndGraphLifecycle()
    }

    private fun assertContextAndGraphLifecycle(): String {
        val firstContext = on
        val firstGraph = NavigationRegistry.toDot()

        repeat(3) {
            assertSame(firstContext, on)
            assertEquals(firstGraph, NavigationRegistry.toDot())
        }

        return firstGraph
    }
}
