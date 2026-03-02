/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.tabstray.redux.middleware

import androidx.test.ext.junit.runners.AndroidJUnit4
import junit.framework.TestCase.assertEquals
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import mozilla.components.browser.state.state.createTab
import mozilla.components.support.test.middleware.CaptureActionsMiddleware
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mozilla.fenix.tabstray.data.TabData
import org.mozilla.fenix.tabstray.redux.action.TabsTrayAction
import org.mozilla.fenix.tabstray.redux.state.TabsTrayState
import org.mozilla.fenix.tabstray.redux.store.TabsTrayStore

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
class TabStorageMiddlewareTest {

    @Test
    fun `WHEN initialized THEN the initial tab state is dispatched`() = runTest {
        val expectedTabID = "12345"
        val initialTabData = TabData(
            selectedTabId = expectedTabID,
            tabs = listOf(createTab(id = expectedTabID, url = "")),
        )
        val middleware = TabStorageMiddleware(
            inactiveTabsEnabled = false,
            initialTabData = initialTabData,
            tabDataFlow = flowOf(initialTabData),
            scope = backgroundScope,
            mainScope = this,
        )
        val captureMiddleware = CaptureActionsMiddleware<TabsTrayState, TabsTrayAction>()
        TabsTrayStore(middlewares = listOf(captureMiddleware, middleware))

        yield()
        advanceUntilIdle()

        captureMiddleware.assertFirstAction(TabsTrayAction.TabDataUpdateReceived::class) { action ->
            assertEquals(expectedTabID, action.tabStorageUpdate.selectedTabId)
        }
    }

    @Test
    fun `WHEN the selected tab ID has changed THEN proceed with a state change`() {
        val statesAreEquivalent = TabStorageMiddleware(
            inactiveTabsEnabled = false,
            initialTabData = TabData(),
            tabDataFlow = MutableStateFlow(TabData()),
        ).areStatesEquivalent(
            old = TabData(
                selectedTabId = null,
            ),
            new = TabData(
                selectedTabId = "1",
            ),
        )

        assertFalse(statesAreEquivalent)
    }

    @Test
    fun `WHEN the tab data has changed THEN proceed with a state change`() {
        val statesAreEquivalent = TabStorageMiddleware(
            inactiveTabsEnabled = false,
            initialTabData = TabData(),
            tabDataFlow = MutableStateFlow(TabData()),
        ).areStatesEquivalent(
            old = TabData(tabs = listOf()),
            new = TabData(tabs = listOf(createTab(url = "url"))),
        )

        assertFalse(statesAreEquivalent)
    }

    @Test
    fun `WHEN neither the selected tab ID nor the tab data has changed THEN do not proceed with a state change`() {
        val unchangedTabData = TabData(selectedTabId = "1", tabs = listOf(createTab(url = "url")))
        val statesAreEquivalent = TabStorageMiddleware(
            inactiveTabsEnabled = false,
            initialTabData = unchangedTabData,
            tabDataFlow = MutableStateFlow(TabData()),
        ).areStatesEquivalent(
            old = unchangedTabData,
            new = unchangedTabData,
        )

        assertTrue(statesAreEquivalent)
    }

    @Test
    fun `WHEN the selected tab ID is updated THEN transform the data and dispatch an update`() = runTest {
        val expectedTabId = "1"
        val initialState = TabData(
            selectedTabId = null,
            tabs = listOf(createTab(id = expectedTabId, url = "")),
        )
        val tabFlow = MutableStateFlow(initialState)
        val store = TabsTrayStore(
            middlewares = listOf(
                TabStorageMiddleware(
                    inactiveTabsEnabled = false,
                    initialTabData = tabFlow.value,
                    tabDataFlow = tabFlow,
                    scope = backgroundScope,
                    mainScope = this,
                ),
            ),
        )

        tabFlow.emit(initialState.copy(selectedTabId = expectedTabId))

        yield()
        advanceUntilIdle()

        assertEquals(expectedTabId, store.state.selectedTabId)
        assertEquals(1, store.state.normalTabs.size)
        assertEquals(0, store.state.privateTabs.size)
        assertEquals(0, store.state.inactiveTabs.size)
    }

    @Test
    fun `WHEN normal tabs has updated THEN transform the data and dispatch an update`() = runTest {
        val expectedTab = createTab("test1")
        val initialState = TabData()
        val tabFlow = MutableStateFlow(initialState)
        val store = TabsTrayStore(
            middlewares = listOf(
                TabStorageMiddleware(
                    inactiveTabsEnabled = false,
                    initialTabData = tabFlow.value,
                    tabDataFlow = tabFlow,
                    scope = backgroundScope,
                    mainScope = this,
                ),
            ),
        )

        tabFlow.emit(initialState.copy(selectedTabId = expectedTab.id, tabs = initialState.tabs + expectedTab))

        yield()
        advanceUntilIdle()

        assertEquals(expectedTab.id, store.state.selectedTabId)
        assertEquals(1, store.state.normalTabs.size)
        assertEquals(0, store.state.privateTabs.size)
        assertEquals(0, store.state.inactiveTabs.size)
    }

    @Test
    fun `WHEN inactive tabs has updated THEN transform the data and dispatch an update`() = runTest {
        val expectedTab = createTab("test1", lastAccess = 0L, createdAt = 0L)
        val initialState = TabData()
        val tabFlow = MutableStateFlow(initialState)
        val store = TabsTrayStore(
            middlewares = listOf(
                TabStorageMiddleware(
                    inactiveTabsEnabled = true,
                    initialTabData = tabFlow.value,
                    tabDataFlow = tabFlow,
                    scope = backgroundScope,
                    mainScope = this,
                ),
            ),
        )

        tabFlow.emit(initialState.copy(selectedTabId = expectedTab.id, tabs = initialState.tabs + expectedTab))

        yield()
        advanceUntilIdle()

        assertEquals(expectedTab.id, store.state.selectedTabId)
        assertEquals(0, store.state.normalTabs.size)
        assertEquals(0, store.state.privateTabs.size)
        assertEquals(1, store.state.inactiveTabs.size)
    }

    @Test
    fun `WHEN private tabs has updated THEN transform the data and dispatch an update`() = runTest {
        val expectedTab = createTab("test1", private = true)
        val initialState = TabData()
        val tabFlow = MutableStateFlow(initialState)
        val store = TabsTrayStore(
            middlewares = listOf(
                TabStorageMiddleware(
                    inactiveTabsEnabled = false,
                    initialTabData = tabFlow.value,
                    tabDataFlow = tabFlow,
                    scope = backgroundScope,
                    mainScope = this,
                ),
            ),
        )

        tabFlow.emit(initialState.copy(selectedTabId = expectedTab.id, tabs = initialState.tabs + expectedTab))

        yield()
        advanceUntilIdle()

        assertEquals(expectedTab.id, store.state.selectedTabId)
        assertEquals(0, store.state.normalTabs.size)
        assertEquals(1, store.state.privateTabs.size)
        assertEquals(0, store.state.inactiveTabs.size)
    }
}
