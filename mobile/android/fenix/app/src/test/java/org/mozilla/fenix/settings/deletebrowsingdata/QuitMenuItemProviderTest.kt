/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.settings.deletebrowsingdata

import kotlin.test.assertEquals
import kotlin.test.assertNull
import mozilla.components.compose.base.text.Text
import mozilla.components.compose.menu.data.StandardMenuItem
import mozilla.components.compose.menu.ui.MenuItemIconRes
import mozilla.components.compose.menu.ui.MenuItemState
import mozilla.components.ui.icons.R as iconsR
import org.junit.Test
import org.mozilla.fenix.R
import org.mozilla.fenix.components.menu.store.MenuAction

class QuitMenuItemProviderTest {
    @Test
    fun `GIVEN the user wants their data deleted on quit WHEN providing the item THEN offer quitting`() {
        val provider = QuitMenuItemProvider(appName = APP_NAME, deletesBrowsingDataOnQuit = true)

        assertEquals(
            StandardMenuItem(
                title = Text.Resource(R.string.browser_menu_delete_browsing_data_on_quit, listOf(APP_NAME)),
                icon = MenuItemIconRes(iconsR.drawable.mozac_ic_cross_circle_fill_24),
                onClickEvent = MenuAction.DeleteBrowsingDataAndQuit,
                state = MenuItemState.WARNING,
            ),
            provider.itemFlow.value,
        )
    }

    @Test
    fun `GIVEN the user keeps their data when quitting WHEN providing the item THEN don't show it`() {
        val provider = QuitMenuItemProvider(appName = APP_NAME, deletesBrowsingDataOnQuit = false)

        assertNull(provider.itemFlow.value)
    }

    private companion object {
        const val APP_NAME = "Firefox"
    }
}
