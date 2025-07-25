/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.tabstray.binding

import androidx.fragment.app.Fragment
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import mozilla.components.lib.state.helpers.AbstractBinding
import mozilla.components.support.ktx.kotlinx.coroutines.flow.ifAnyChanged
import org.mozilla.fenix.ext.removeSecure
import org.mozilla.fenix.ext.secure
import org.mozilla.fenix.tabstray.Page
import org.mozilla.fenix.tabstray.TabsTrayState
import org.mozilla.fenix.tabstray.TabsTrayStore
import org.mozilla.fenix.tabstray.ui.TabManagementFragment
import org.mozilla.fenix.utils.Settings

/**
 * Sets [TabManagementFragment] flags to secure when private tabs list is selected.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SecureTabManagerBinding(
    store: TabsTrayStore,
    private val settings: Settings,
    private val fragment: Fragment,
) : AbstractBinding<TabsTrayState>(store) {

    override suspend fun onState(flow: Flow<TabsTrayState>) {
        flow.map { it }
            .ifAnyChanged { state ->
                arrayOf(
                    state.selectedPage,
                )
            }
            .collect { state ->
                if (state.selectedPage == Page.PrivateTabs &&
                    !settings.allowScreenshotsInPrivateMode
                ) {
                    fragment.secure()
                } else if (!settings.lastKnownMode.isPrivate) {
                    fragment.removeSecure()
                }
            }
    }
}
