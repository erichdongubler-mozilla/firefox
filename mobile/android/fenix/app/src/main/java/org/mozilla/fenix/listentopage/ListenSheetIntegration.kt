/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.listentopage

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.testTag
import androidx.coordinatorlayout.widget.CoordinatorLayout
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import mozilla.components.browser.state.selector.selectedTab
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.feature.listentopage.ListenState
import mozilla.components.feature.listentopage.ListenStore
import mozilla.components.feature.listentopage.ui.ListenSheet
import mozilla.components.lib.state.ext.observeAsComposableState
import mozilla.components.support.base.feature.LifecycleAwareFeature
import org.mozilla.fenix.R
import org.mozilla.fenix.theme.FirefoxTheme

private val ListenState.isArticleReady: Boolean
    get() = tabId != null && languageTag != null

internal const val LISTEN_SHEET_TEST_TAG = "listenSheet"

/**
 * This integration is responsible for adding or removing Listen to page media player and properly anchoring it to the
 * browser.
 */
class ListenSheetIntegration(
    private val container: CoordinatorLayout,
    private val browserStore: BrowserStore,
    private val listenStore: ListenStore,
    private val isAddressBarAtBottom: Boolean,
) : LifecycleAwareFeature {

    private var listenPlayer: ComposeView? = null

    override fun start() {
        if (listenPlayer != null) return
        val view =
            ComposeView(container.context).apply {
                id = R.id.listenSheet
                layoutParams =
                    CoordinatorLayout.LayoutParams(
                            CoordinatorLayout.LayoutParams.MATCH_PARENT,
                            CoordinatorLayout.LayoutParams.WRAP_CONTENT,
                        )
                        .apply { behavior = ListenSheetBehavior(isAddressBarAtBottom = isAddressBarAtBottom) }
                setContent { ListenSheetHost(listenStore) }
            }
        listenPlayer = view

        container.post {
            if (listenPlayer === view) {
                container.addView(view)
            }
        }
    }

    override fun stop() {
        container.removeView(listenPlayer)
        listenPlayer = null
    }

    @Composable
    private fun ListenSheetHost(listenStore: ListenStore) {
        FirefoxTheme {
            ListenSheetContent(listenStore, browserStore)
        }
    }
}

/**
 * Shows ListenSheet - media player controls for ListenToPage feature. ListenSheet is shown when the article audio is
 * ready for playback and when the user is on the tab where ListenToPage was initiated, for as long as that tab stays in
 * reader mode. Leaving reader mode takes it away, since the session is started from the reader view controls.
 */
@Composable
fun ListenSheetContent(listenStore: ListenStore, browserStore: BrowserStore) {
    val state by listenStore.stateFlow.collectAsStateWithLifecycle()

    val selectedTabId by browserStore.observeAsComposableState { it.selectedTabId }
    val isReaderModeActive by browserStore.observeAsComposableState { it.selectedTab?.readerState?.active == true }

    if (state.isArticleReady && state.tabId == selectedTabId && isReaderModeActive) {
        ListenSheet(modifier = Modifier.testTag(LISTEN_SHEET_TEST_TAG))
    }
}
