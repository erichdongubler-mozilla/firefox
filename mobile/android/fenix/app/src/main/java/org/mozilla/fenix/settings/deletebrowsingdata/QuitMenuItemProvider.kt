/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.settings.deletebrowsingdata

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import mozilla.components.compose.base.text.Text
import mozilla.components.compose.menu.data.MenuItem
import mozilla.components.compose.menu.data.StandardMenuItem
import mozilla.components.compose.menu.ui.MenuItemIconRes
import mozilla.components.compose.menu.ui.MenuItemState
import mozilla.components.ui.icons.R as iconsR
import org.mozilla.fenix.R
import org.mozilla.fenix.components.menu.MenuItemProvider
import org.mozilla.fenix.components.menu.store.MenuAction

/**
 * [MenuItemProvider] for the menu item allowing to delete the browsing data of this session and quit the application.
 *
 * Only shown to users who asked for their data to be deleted when they quit.
 *
 * @param appName The name of the application, which the item offers to quit.
 * @param deletesBrowsingDataOnQuit Whether the user asked for their browsing data to be deleted when quitting.
 */
class QuitMenuItemProvider(
    appName: String,
    deletesBrowsingDataOnQuit: Boolean,
) : MenuItemProvider {
    override val itemFlow: StateFlow<MenuItem?> =
        MutableStateFlow(
            when (deletesBrowsingDataOnQuit) {
                true ->
                    StandardMenuItem(
                        title = Text.Resource(R.string.browser_menu_delete_browsing_data_on_quit, listOf(appName)),
                        icon = MenuItemIconRes(iconsR.drawable.mozac_ic_cross_circle_fill_24),
                        onClickEvent = MenuAction.DeleteBrowsingDataAndQuit,
                        state = MenuItemState.WARNING,
                    )

                else -> null
            }
        )
}
