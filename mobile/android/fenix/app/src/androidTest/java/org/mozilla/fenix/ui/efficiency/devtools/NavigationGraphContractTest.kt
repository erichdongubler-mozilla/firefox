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
import org.mozilla.fenix.ui.efficiency.navigation.NavigationRegistry
import org.mozilla.fenix.ui.efficiency.navigation.PageCatalog

@RunWith(AndroidJUnit4::class)
class NavigationGraphContractTest : BaseTest() {
    @Test
    fun graphShapeMatchesTheCharacterizedContract() {
        on
        val diagnostics = NavigationRegistry.diagnostics()

        assertEquals(54, diagnostics.pages.size)
        assertEquals(103, diagnostics.edges.size)
        assertTrue(diagnostics.duplicateRegistrations.isEmpty())
        assertEquals(
            setOf(
                "AddToHomeScreenComponent->BrowserPage",
                "AppEntry->HomePage",
                "AppEntry->OnboardingPage",
                "BrowserPage->ToolbarComponent",
                "CustomTabsPage->BrowserPage",
                "HomePage->ToolbarComponent",
                "MainMenuPage->BrowserPage",
            ),
            diagnostics.zeroStepEdges.map { "${it.from}->${it.to}" }.toSet(),
        )
    }

    @Test
    fun pageContextAndGraphMembershipMatchesTheCharacterizedContract() {
        val context = on
        val contextPages = PageCatalog.discoverPages().map { it.getter(context).pageName }.toSet()
        val graphPages = NavigationRegistry.diagnostics().pages

        assertEquals(setOf("AppEntry", "GooglePlayPage"), graphPages - contextPages)
        assertEquals(setOf("CollectionsPage", "MicrosurveysPage", "ShortcutsPage"), contextPages - graphPages)
    }

    @Test
    fun duplicateEdgeRegistrationFailsAtGraphConstruction() {
        NavigationRegistry.register("DuplicateSource", "DuplicateTarget", emptyList())

        val failure = runCatching {
            NavigationRegistry.register("DuplicateSource", "DuplicateTarget", emptyList())
        }
            .exceptionOrNull()

        assertTrue(failure is IllegalStateException)
        assertTrue(failure?.message.orEmpty().contains("DuplicateSource->DuplicateTarget"))
    }

    @Test
    fun routeVariantsAreExplicitAndSelectedDeterministically() {
        on
        val path = NavigationRegistry.findPath("HomePage", "SettingsSavedPasswordsPage")

        assertEquals("direct-main-menu", path?.edges?.single()?.variant)
    }
}
