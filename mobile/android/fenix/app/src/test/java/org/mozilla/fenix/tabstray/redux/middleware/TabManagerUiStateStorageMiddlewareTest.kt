/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.tabstray.redux.middleware

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import mozilla.components.support.test.middleware.CaptureActionsMiddleware
import org.mozilla.fenix.tabstray.data.TabStorageUpdate
import org.mozilla.fenix.tabstray.data.createTabGroup
import org.mozilla.fenix.tabstray.fakes.FakeTabManagerUiStateRepository
import org.mozilla.fenix.tabstray.redux.action.TabGroupAction
import org.mozilla.fenix.tabstray.redux.action.TabsTrayAction
import org.mozilla.fenix.tabstray.redux.action.TabsTrayAction.PersistedUiStateUpdateReceived
import org.mozilla.fenix.tabstray.redux.state.TabsTrayState
import org.mozilla.fenix.tabstray.redux.store.TabsTrayStore
import org.mozilla.fenix.tabstray.repository.uistate.data.PersistedUIState
import kotlin.test.Test
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class TabManagerUiStateStorageMiddlewareTest {

    private var repository: FakeTabManagerUiStateRepository = FakeTabManagerUiStateRepository()

    private val captureActionsMiddleware = CaptureActionsMiddleware<TabsTrayState, TabsTrayAction>()

    @Test
    fun `GIVEN the user has at least one tab group WHEN tab data is updated THEN the repository records the user as having a tab group`() = runTest {
        val store = createStore()

        store.dispatch(TabsTrayAction.TabDataUpdateReceived(tabStorageUpdate = createTabDataUpdateWithOneGroup()))

        runCurrent()
        advanceUntilIdle()

        assertTrue { repository.uiState.value!!.hasUserEverHadOneTabGroup }
    }

    @Test
    fun `GIVEN the user has no tab groups WHEN tab data is updated THEN the repository's record is updated`() = runTest {
        val store = createStore()

        store.dispatch(TabsTrayAction.TabDataUpdateReceived(tabStorageUpdate = createTabDataUpdateWithZeroGroups()))

        runCurrent()
        advanceUntilIdle()

        assertNull(repository.uiState.value?.hasUserEverHadOneTabGroup)
    }

    @Test
    fun `WHEN the Store is initialized THEN the connection to the repository is established and non-null updates to the repository are dispatched to the Store`() = runTest {
        repository = FakeTabManagerUiStateRepository(initialPersistedUIState = PersistedUIState())
        createStore()

        runCurrent()
        advanceUntilIdle()

        captureActionsMiddleware.assertLastAction(clazz = PersistedUiStateUpdateReceived::class)
    }

    @Test
    fun `WHEN tab group onboarding is dismissed THEN the repo is updated`() = runTest {
        createStore().dispatch(TabGroupAction.OnboardingDismissed)

        runCurrent()
        advanceUntilIdle()

        assertTrue { repository.uiState.value!!.hasUserDismissedTabGroupOnboarding }
    }

    private fun TestScope.createStore(
        initialTabsTrayState: TabsTrayState = TabsTrayState(),
    ) = TabsTrayStore(
        initialState = initialTabsTrayState,
        middlewares = listOf(
            captureActionsMiddleware,
            TabManagerUiStateStorageMiddleware(
                uiStateRepository = repository,
                scope = backgroundScope,
            ),
        ),
    )

    private fun createTabDataUpdateWithOneGroup() = TabStorageUpdate(
        selectedTabId = "",
        normalItems = emptyList(),
        normalTabCount = 0,
        selectedNormalItemIndex = 0,
        inactiveTabs = emptyList(),
        privateTabs = emptyList(),
        selectedPrivateItemIndex = 0,
        tabGroups = listOf(createTabGroup()),
    )

    private fun createTabDataUpdateWithZeroGroups() = TabStorageUpdate(
        selectedTabId = "",
        normalItems = emptyList(),
        normalTabCount = 0,
        selectedNormalItemIndex = 0,
        inactiveTabs = emptyList(),
        privateTabs = emptyList(),
        selectedPrivateItemIndex = 0,
        tabGroups = emptyList(),
    )
}
