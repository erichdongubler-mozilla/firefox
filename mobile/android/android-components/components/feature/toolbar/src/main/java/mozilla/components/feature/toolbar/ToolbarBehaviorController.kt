/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.toolbar

import androidx.annotation.VisibleForTesting
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.mapNotNull
import mozilla.components.browser.state.action.ContentAction
import mozilla.components.browser.state.selector.findCustomTabOrSelectedTab
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.concept.toolbar.ScrollableToolbar
import mozilla.components.lib.state.ext.flowScoped

/**
 * Controls how a dynamic toolbar should behave based on the current tab state.
 *
 * Responsible to enforce the following:
 * - toolbar should not be scrollable if the page has not finished loading
 */
class ToolbarBehaviorController(
    private val toolbar: ScrollableToolbar,
    private val store: BrowserStore,
    private val customTabId: String? = null,
) {
    @VisibleForTesting
    internal var updatesScope: CoroutineScope? = null

    /**
     * Starts listening for changes in the current tab and updates how the toolbar should behave.
     */
    fun start() {
        updatesScope = store.flowScoped { flow ->
            flow.mapNotNull { state ->
                state.findCustomTabOrSelectedTab(customTabId)
            }.distinctUntilChangedBy {
                arrayOf(it.content.loading, it.content.showToolbarAsExpanded)
            }.collect { state ->
                if (state.content.showToolbarAsExpanded != null) {
                    if (state.content.showToolbarAsExpanded == true) {
                        expandToolbar()
                        store.dispatch(ContentAction.UpdateExpandedToolbarStateAction(state.id, null))
                        return@collect
                    }

                    if (state.content.showToolbarAsExpanded == false) {
                        collapseToolbar()
                        store.dispatch(ContentAction.UpdateExpandedToolbarStateAction(state.id, null))
                        return@collect
                    }
                }

                if (state.content.loading) {
                    expandToolbar()
                    disableScrolling()
                } else if (!state.content.loading) {
                    enableScrolling()
                }
            }
        }
    }

    /**
     * Stop listening for changes in the current tab.
     */
    fun stop() {
        updatesScope?.cancel()
    }

    @VisibleForTesting
    internal fun expandToolbar() {
        toolbar.expand()
    }

    @VisibleForTesting
    internal fun collapseToolbar() {
        toolbar.collapse()
    }

    @VisibleForTesting
    internal fun disableScrolling() {
        toolbar.disableScrolling()
    }

    @VisibleForTesting
    internal fun enableScrolling() {
        toolbar.enableScrolling()
    }
}
