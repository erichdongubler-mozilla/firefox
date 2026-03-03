/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.share

import androidx.navigation.NavController
import androidx.navigation.NavOptions
import mozilla.components.browser.state.action.ShareResourceAction
import mozilla.components.browser.state.state.content.ShareResourceState
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.concept.engine.prompt.ShareData
import mozilla.components.support.ktx.android.content.share
import mozilla.components.support.ktx.kotlin.isContentUrl
import org.mozilla.fenix.R
import org.mozilla.fenix.components.menu.MenuDialogFragmentDirections
import org.mozilla.fenix.ext.nav

/**
 * Interface for handling share events and launching the appropriate share sheet.
 */
interface ShareSheetLauncher {

    /**
     * Show the custom share sheet for sharing resources within the app.
     * @param id The session id of the tab to share from.
     * @param url The url to share.
     * @param title The title of the page to share.
     * @param isCustomTab Whether the share is being initiated from a custom tab,
     * used to determine the correct destination to pop up to when navigating to the share fragment.
     */
    fun showCustomShareSheet(
        id: String?,
        url: String?,
        title: String?,
        isCustomTab: Boolean = false,
    )

    /**
     * Show the native share sheet for sharing resources outside of the app.
     * @param id The session id of the tab to share from.
     * @param url The url to share.
     * @param title The title of the page to share.
     * @param isCustomTab Whether the share is being initiated from a custom tab,
     * used to determine the correct destination to pop up to when navigating to the share fragment.
     */
    fun showNativeShareSheet(
        id: String?,
        url: String,
        title: String?,
        isCustomTab: Boolean = false,
    )
}

/**
 * Implementation for handling navigating share events, either to the native share sheet or
 * the custom share sheet.
 *
 * @param browserStore [BrowserStore] used to dispatch actions related to the menu state and access
 * the selected tab.
 * @param navController [NavController] used for navigation.
 * @param onDismiss Callback invoked to dismiss the menu dialog.
 */
class ShareSheetLauncherImpl(
    private val browserStore: BrowserStore,
    private val navController: NavController,
    private val onDismiss: () -> Unit,
) : ShareSheetLauncher {

    /**
     * Show the custom share sheet for sharing resources within the app.
     *
     * @param id The session id of the tab to share from.
     * @param url The url to share.
     * @param title The title of the page to share.
     * @param isCustomTab Whether the share is being initiated from a custom tab.
     */
    override fun showCustomShareSheet(
        id: String?,
        url: String?,
        title: String?,
        isCustomTab: Boolean,
    ) {
        if (url?.isContentUrl() == true) {
            browserStore.dispatch(
                ShareResourceAction.AddShareAction(
                    id ?: "",
                    ShareResourceState.LocalResource(url),
                ),
            )
            onDismiss()
        } else {
            dismissMenu(title, url, id, isCustomTab)
        }
    }

    /**
     * Show the native share sheet for sharing resources outside of the app.
     *
     * @param id The session id of the tab to share from.
     * @param url The url to share.
     * @param title The title of the page to share.
     * @param isCustomTab Whether the share is being initiated from a custom tab.
     */
    override fun showNativeShareSheet(
        id: String?,
        url: String,
        title: String?,
        isCustomTab: Boolean,
    ) {
        val context = navController.context
        dismissMenu(title, url, id, isCustomTab)
        context.share(
            text = url,
            subject = title ?: "",
        )
    }

    /**
     * Helper function to handle dismissing the menu and navigating to the share fragment with the
     * provided share data.
     * @param title The title of the page to share.
     * @param url The url to share.
     * @param id The session id of the tab to share from.
     * @param isCustomTab Whether the share is being initiated from a custom tab, used to determine
     * the correct destination to pop up to when navigating to the share fragment.
     */
    private fun dismissMenu(
        title: String?,
        url: String?,
        id: String?,
        isCustomTab: Boolean,
    ) {
        val shareData = ShareData(title = title, url = url)
        val direction =
            MenuDialogFragmentDirections.actionGlobalShareFragment(
                sessionId = id,
                data = arrayOf(shareData),
                showPage = true,
            )

        val popUpToId = if (isCustomTab) {
            R.id.externalAppBrowserFragment
        } else {
            R.id.browserFragment
        }

        navController.nav(
            R.id.menuDialogFragment,
            direction,
            navOptions = NavOptions.Builder()
                .setPopUpTo(popUpToId, false)
                .build(),
        )
    }
}
