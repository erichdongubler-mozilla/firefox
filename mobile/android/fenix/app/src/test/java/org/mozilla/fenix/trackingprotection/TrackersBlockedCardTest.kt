/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.trackingprotection

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.mozilla.fenix.theme.FirefoxTheme
import org.mozilla.fenix.theme.Theme

@RunWith(AndroidJUnit4::class)
class TrackersBlockedCardTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun `when the longfox entry point is not shown, the fox is not displayed`() {
        composeTestRule.setContent {
            FirefoxTheme(theme = Theme.Light) {
                TrackersBlockedCard(
                    trackersBlockedCount = 3,
                    showLongfoxEntryPoint = false,
                )
            }
        }

        composeTestRule.onNodeWithTag(LONGFOX_FOX_IMAGE_TEST_TAG).assertDoesNotExist()
    }

    @Test
    fun `if the entry point is cleared mid-animation the peek animation still runs to completion`() {
        // The animation is driven by the compose clock, so pause it to step through deterministically.
        composeTestRule.mainClock.autoAdvance = false

        var showLongfoxEntryPoint by mutableStateOf(true)
        composeTestRule.setContent {
            FirefoxTheme(theme = Theme.Light) {
                TrackersBlockedCard(
                    trackersBlockedCount = 3,
                    showLongfoxEntryPoint = showLongfoxEntryPoint,
                )
            }
        }

        // The fox appears as soon as the animation starts, well before the sequence finishes.
        composeTestRule.mainClock.advanceTimeBy(100L)
        composeTestRule.onNodeWithTag(LONGFOX_FOX_IMAGE_TEST_TAG).assertExists()

        // The homepage consumes the entry point and clears the flag while the fox is still peeking.
        showLongfoxEntryPoint = false

        // The animation is latched, so it must keep running rather than being cancelled here.
        composeTestRule.mainClock.advanceTimeBy(20_000L)

        // Once the full peek/dwell/retract sequence ends, the fox is removed.
        composeTestRule.onNodeWithTag(LONGFOX_FOX_IMAGE_TEST_TAG).assertDoesNotExist()
    }
}
