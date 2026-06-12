/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.settings.labs.middleware

import mozilla.components.support.test.robolectric.testContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.mozilla.fenix.GleanMetrics.FirefoxLabs
import org.mozilla.fenix.R
import org.mozilla.fenix.helpers.FenixGleanTestRule
import org.mozilla.fenix.settings.labs.LabsItem
import org.mozilla.fenix.settings.labs.LabsItemSlugs
import org.mozilla.fenix.settings.labs.store.LabsAction
import org.mozilla.fenix.settings.labs.store.LabsState
import org.mozilla.fenix.settings.labs.store.LabsStore
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class LabsTelemetryMiddlewareTest {

    @get:Rule
    val gleanTestRule = FenixGleanTestRule(testContext)

    private fun buildStore(
        initialState: LabsState = LabsState.INITIAL,
    ): LabsStore = LabsStore(
        initialState = initialState,
        middleware = listOf(LabsTelemetryMiddleware()),
    )

    private fun homepageItem(enrolled: Boolean = false) = LabsItem(
        slug = LabsItemSlugs.HOMEPAGE_AS_NEW_TAB,
        title = R.string.firefox_labs_homepage_as_a_new_tab,
        description = R.string.firefox_labs_homepage_as_a_new_tab_description,
        enrolled = enrolled,
        requiresRestart = true,
    )

    @Test
    fun `WHEN UpdateLabsItems is dispatched with an empty list THEN empty_state_shown is recorded`() {
        val store = buildStore()

        store.dispatch(LabsAction.UpdateLabsItems(emptyList()))

        assertEquals(1, FirefoxLabs.emptyStateShown.testGetValue()!!.size)
    }

    @Test
    fun `WHEN UpdateLabsItems is dispatched with a non-empty list THEN empty_state_shown is not recorded`() {
        val store = buildStore()

        store.dispatch(LabsAction.UpdateLabsItems(listOf(homepageItem())))

        assertNull(FirefoxLabs.emptyStateShown.testGetValue())
    }

    @Test
    fun `WHEN ShareFeedbackClicked is dispatched THEN share_feedback_opened is recorded`() {
        val item = homepageItem().copy(feedbackUrl = "https://connect.mozilla.org/")
        val store = buildStore()

        store.dispatch(LabsAction.ShareFeedbackClicked(item))

        val extra = FirefoxLabs.shareFeedbackOpened.testGetValue()!!.single().extra
        assertEquals("homepage-as-new-tab", extra?.get("slug_id"))
    }
}
