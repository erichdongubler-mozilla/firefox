/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.tabstray.redux.store

import mozilla.components.lib.state.Middleware
import mozilla.components.lib.state.Store
import org.mozilla.fenix.tabstray.redux.action.TabsTrayAction
import org.mozilla.fenix.tabstray.redux.reducer.TabsTrayReducer
import org.mozilla.fenix.tabstray.redux.state.TabsTrayState

/**
 * A [Store] that holds the [TabsTrayState] for the tabs tray and reduces [TabsTrayAction]s
 * dispatched to the store.
 */
class TabsTrayStore(
    initialState: TabsTrayState = TabsTrayState(),
    middlewares: List<Middleware<TabsTrayState, TabsTrayAction>> = emptyList(),
) : Store<TabsTrayState, TabsTrayAction>(
    initialState,
    TabsTrayReducer::reduce,
    middlewares,
) {
    init {
        dispatch(TabsTrayAction.InitAction)
    }
}
