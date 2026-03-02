/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.tabstray.redux.middleware

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import mozilla.components.browser.state.state.isActive
import mozilla.components.lib.state.Middleware
import mozilla.components.lib.state.Store
import org.mozilla.fenix.ext.maxActiveTime
import org.mozilla.fenix.tabstray.data.TabData
import org.mozilla.fenix.tabstray.data.TabStorageUpdate
import org.mozilla.fenix.tabstray.data.TabsTrayItem
import org.mozilla.fenix.tabstray.redux.action.TabsTrayAction
import org.mozilla.fenix.tabstray.redux.state.TabsTrayState

/**
 * [Middleware] that reacts to [TabsTrayAction] and performs storage side effects.
 *
 * @param inactiveTabsEnabled Whether the inactive tabs feature is enabled.
 * @param initialTabData The initial emission of [TabData].
 * @param tabDataFlow [StateFlow] used to observe tab data.
 * @param scope The [CoroutineScope] for running the tab data transformation off of the main thread.
 * @param mainScope The [CoroutineScope] used for returning to the main thread.
 **/
class TabStorageMiddleware(
    private val inactiveTabsEnabled: Boolean,
    private val initialTabData: TabData,
    private val tabDataFlow: Flow<TabData>,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.Default),
    private val mainScope: CoroutineScope = CoroutineScope(Dispatchers.Main),
) : Middleware<TabsTrayState, TabsTrayAction> {

    override fun invoke(
        store: Store<TabsTrayState, TabsTrayAction>,
        next: (TabsTrayAction) -> Unit,
        action: TabsTrayAction,
    ) {
        next(action)

        when (action) {
            is TabsTrayAction.TabsStorageAction -> processAction(
                action = action,
                store = store,
            )

            else -> {}
        }
    }

    private fun processAction(
        action: TabsTrayAction.TabsStorageAction,
        store: Store<TabsTrayState, TabsTrayAction>,
    ) {
        when (action) {
            TabsTrayAction.InitAction -> {
                // Read-in and dispatch the initial state
                val initialTabData = transformTabData(tabData = initialTabData)
                store.dispatch(TabsTrayAction.TabDataUpdateReceived(tabStorageUpdate = initialTabData))

                // Set up the Browser store listener
                scope.launch {
                    tabDataFlow
                        .distinctUntilChanged(areEquivalent = ::areStatesEquivalent)
                        .collect { state ->
                            val tabData = transformTabData(tabData = state)
                            mainScope.launch {
                                store.dispatch(TabsTrayAction.TabDataUpdateReceived(tabStorageUpdate = tabData))
                            }
                        }
                }
            }
        }
    }

    internal fun areStatesEquivalent(old: TabData, new: TabData) =
        old.selectedTabId == new.selectedTabId && old.tabs == new.tabs

    private fun transformTabData(tabData: TabData): TabStorageUpdate {
        val normalTabs: MutableList<TabsTrayItem> = mutableListOf()
        val inactiveTabs: MutableList<TabsTrayItem.Tab> = mutableListOf()
        val privateTabs: MutableList<TabsTrayItem> = mutableListOf()

        tabData.tabs.forEach { tab ->
            when {
                tab.content.private -> privateTabs.add(TabsTrayItem.Tab(tabData = tab))
                inactiveTabsEnabled && !tab.isActive(maxActiveTime = maxActiveTime) ->
                    inactiveTabs.add(TabsTrayItem.Tab(tabData = tab))
                else -> normalTabs.add(TabsTrayItem.Tab(tabData = tab))
            }
        }

        return TabStorageUpdate(
            selectedTabId = tabData.selectedTabId,
            normalTabs = normalTabs,
            inactiveTabs = inactiveTabs,
            privateTabs = privateTabs,
        )
    }
}
