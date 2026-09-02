/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.efficiency.devtools

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mozilla.fenix.ui.efficiency.helpers.BaseTest
import org.mozilla.fenix.ui.efficiency.navigation.NavigationFact
import org.mozilla.fenix.ui.efficiency.navigation.NavigationFacts
import org.mozilla.fenix.ui.efficiency.navigation.NavigationOptions
import org.mozilla.fenix.ui.efficiency.navigation.NavigationRegistry
import org.mozilla.fenix.ui.efficiency.navigation.NavigationRouteTrait
import org.mozilla.fenix.ui.efficiency.navigation.PageCatalog
import org.mozilla.fenix.ui.efficiency.navigation.PageObjectKind

@RunWith(AndroidJUnit4::class)
class NavigationGraphContractTest : BaseTest() {
    @Test
    fun graphShapeMatchesTheCharacterizedContract() {
        on
        val diagnostics = NavigationRegistry.diagnostics()

        assertEquals(54, diagnostics.pages.size)
        assertEquals(102, diagnostics.edges.size)
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
        val pages = PageCatalog.discoverPages()
        val contextPages = pages.map { it.getter(context).pageName }.toSet()
        val navigablePages =
            pages.filter { it.kind == PageObjectKind.NAVIGABLE }.map { it.getter(context).pageName }.toSet()
        val selectorOnlyPages =
            pages.filter { it.kind == PageObjectKind.SELECTOR_ONLY }.map { it.getter(context).pageName }.toSet()
        val graphPages = NavigationRegistry.diagnostics().pages

        assertEquals(setOf("AppEntry", "GooglePlayPage"), graphPages - contextPages)
        assertEquals(setOf("CollectionsPage", "MicrosurveysPage", "ShortcutsPage"), selectorOnlyPages)
        assertEquals(navigablePages, graphPages - setOf("AppEntry", "GooglePlayPage"))
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

    @Test
    fun samePageNavigationUsesTheRegisteredSelfLoop() {
        on

        assertEquals(
            listOf("BrowserPage->BrowserPage"),
            NavigationRegistry.findPath("BrowserPage", "BrowserPage")?.edges?.map { it.id },
        )
    }

    @Test
    fun navigationSelectsTheLeastDestructiveEquallyDirectPath() {
        on
        val path = NavigationRegistry.findPath("BrowserPage", "HistoryPage")

        assertEquals(
            listOf("BrowserPage->MainMenuPage", "MainMenuPage->HistoryPage"),
            path?.edges?.map { it.id },
        )
        assertEquals(2, path?.totalSteps)
    }

    @Test
    fun browserPageIsOnlyUsedAsTransitWhenNoBrowserFreePathExists() {
        on
        NavigationRegistry.register("TransitSource", "BrowserPage", emptyList())
        NavigationRegistry.register("BrowserPage", "TransitTarget", emptyList())
        NavigationRegistry.register("TransitSource", "SafeMiddle", emptyList())
        NavigationRegistry.register("SafeMiddle", "TransitTarget", emptyList())
        NavigationRegistry.register("BrowserPage", "BrowserOnlyTarget", emptyList())

        assertEquals(
            listOf("TransitSource", "SafeMiddle", "TransitTarget"),
            NavigationRegistry.findPath("TransitSource", "TransitTarget")?.pages,
        )
        assertEquals(
            listOf("TransitSource", "BrowserPage"),
            NavigationRegistry.findPath("TransitSource", "BrowserPage")?.pages,
        )
        assertEquals(
            listOf("TransitSource", "BrowserPage", "BrowserOnlyTarget"),
            NavigationRegistry.findPath("TransitSource", "BrowserOnlyTarget")?.pages,
        )
    }

    @Test
    fun navigationOptionsConstrainPagesAndRoutes() {
        NavigationRegistry.register("ConstraintSource", "ConstraintTarget", emptyList())
        NavigationRegistry.register("ConstraintSource", "ConstraintWaypoint", emptyList())
        NavigationRegistry.register("ConstraintWaypoint", "ConstraintTarget", emptyList())

        assertEquals(
            listOf("ConstraintSource", "ConstraintWaypoint", "ConstraintTarget"),
            NavigationRegistry.findPath(
                    from = "ConstraintSource",
                    to = "ConstraintTarget",
                    options = NavigationOptions(via = listOf("ConstraintWaypoint")),
                )
                ?.pages,
        )
        assertEquals(
            listOf("ConstraintSource", "ConstraintWaypoint", "ConstraintTarget"),
            NavigationRegistry.findPath(
                    from = "ConstraintSource",
                    to = "ConstraintTarget",
                    options = NavigationOptions(excludedRoutes = setOf("ConstraintSource->ConstraintTarget")),
                )
                ?.pages,
        )
        assertEquals(
            listOf("ConstraintSource", "ConstraintTarget"),
            NavigationRegistry.findPath(
                    from = "ConstraintSource",
                    to = "ConstraintTarget",
                    options = NavigationOptions(excludedPages = setOf("ConstraintWaypoint")),
                )
                ?.pages,
        )
        assertEquals(
            setOf(1),
            NavigationRegistry.findPath(
                    from = "ConstraintSource",
                    to = "ConstraintTarget",
                    options = NavigationOptions(via = listOf("ConstraintWaypoint")),
                )
                ?.waypointPageIndices,
        )
    }

    @Test
    fun navigationOptionsCanRequireRoutesAndAvoidTraits() {
        val disruptive = NavigationRouteTrait("DISRUPTIVE")
        NavigationRegistry.register(
            from = "PolicySource",
            to = "PolicyRisky",
            steps = emptyList(),
            traits = setOf(disruptive),
        )
        NavigationRegistry.register("PolicyRisky", "PolicyTarget", emptyList())
        NavigationRegistry.register("PolicySource", "PolicySafe", emptyList())
        NavigationRegistry.register("PolicySafe", "PolicyTarget", emptyList())

        assertEquals(
            listOf("PolicySource", "PolicySafe", "PolicyTarget"),
            NavigationRegistry.findPath(
                    from = "PolicySource",
                    to = "PolicyTarget",
                    options = NavigationOptions(avoidTraits = setOf(disruptive)),
                )
                ?.pages,
        )
        assertEquals(
            listOf("PolicySource", "PolicyRisky", "PolicyTarget"),
            NavigationRegistry.findPath(
                    from = "PolicySource",
                    to = "PolicyTarget",
                    options = NavigationOptions(requiredRoutes = setOf("PolicySource->PolicyRisky")),
                )
                ?.pages,
        )
    }

    @Test
    fun searchDistinguishesTheSamePageWithDifferentFacts() {
        val unlocked = NavigationFact("UNLOCKED")
        NavigationRegistry.register("StateSource", "StateJoin", emptyList())
        NavigationRegistry.register(
            from = "StateSource",
            to = "StateProvider",
            steps = emptyList(),
            provides = setOf(unlocked),
        )
        NavigationRegistry.register("StateProvider", "StateJoin", emptyList())
        NavigationRegistry.register(
            from = "StateJoin",
            to = "StateTarget",
            steps = emptyList(),
            requires = setOf(unlocked),
        )

        val path = NavigationRegistry.findPath("StateSource", "StateTarget")

        assertEquals(listOf("StateSource", "StateProvider", "StateJoin", "StateTarget"), path?.pages)
        assertEquals(setOf(unlocked), path?.states?.last()?.facts)
    }

    @Test
    fun navigationFactsSupportGoalRequirementsAndRouteGuards() {
        val authorized = NavigationFact("AUTHORIZED")
        NavigationRegistry.register("FactSource", "FactTarget", emptyList())
        NavigationRegistry.register(
            from = "FactSource",
            to = "FactProvider",
            steps = emptyList(),
            provides = setOf(authorized),
        )
        NavigationRegistry.register("FactProvider", "FactTarget", emptyList())
        NavigationRegistry.register(
            from = "FactProvider",
            to = "ForbiddenTarget",
            steps = emptyList(),
            forbids = setOf(authorized),
        )
        NavigationRegistry.register(
            from = "FactProvider",
            to = "FactRevoker",
            steps = emptyList(),
            invalidates = setOf(authorized),
        )
        NavigationRegistry.register(
            from = "FactRevoker",
            to = "GuardedTarget",
            steps = emptyList(),
            requires = setOf(authorized),
        )

        assertEquals(
            listOf("FactSource", "FactProvider", "FactTarget"),
            NavigationRegistry.findPath(
                    from = "FactSource",
                    to = "FactTarget",
                    options = NavigationOptions(requiredFacts = setOf(authorized)),
                )
                ?.pages,
        )
        assertNull(NavigationRegistry.findPath("FactSource", "ForbiddenTarget"))
        assertNull(NavigationRegistry.findPath("FactSource", "GuardedTarget"))
    }

    @Test
    fun settingsReturnToTheSurfaceThatOpenedThem() {
        on

        assertEquals(
            listOf(
                "SettingsCustomizePage->SettingsPage",
                "SettingsPage->HomePage",
                "HomePage->BrowserPage",
            ),
            NavigationRegistry.findPath(
                    from = "SettingsCustomizePage",
                    to = "BrowserPage",
                    initialFacts = setOf(NavigationFacts.RETURN_SURFACE_HOME),
                )
                ?.edges
                ?.map { it.id },
        )
        assertEquals(
            listOf(
                "SettingsCustomizePage->SettingsPage",
                "SettingsPage->BrowserPage",
            ),
            NavigationRegistry.findPath(
                    from = "SettingsCustomizePage",
                    to = "BrowserPage",
                    initialFacts = setOf(NavigationFacts.RETURN_SURFACE_BROWSER),
                )
                ?.edges
                ?.map { it.id },
        )
    }
}
