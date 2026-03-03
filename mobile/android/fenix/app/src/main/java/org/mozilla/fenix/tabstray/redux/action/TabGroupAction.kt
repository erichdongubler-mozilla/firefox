/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.tabstray.redux.action

/**
 * [TabsTrayAction]'s that represent user interactions for the Tab Group feature.
 */
sealed interface TabGroupAction : TabsTrayAction {

    /**
     * Confirms the save of a tab group.
     */
    data object SaveClicked : TabGroupAction

    /**
     * Dismisses editing a tab group.
     */
    data object Dismiss : TabGroupAction
}
