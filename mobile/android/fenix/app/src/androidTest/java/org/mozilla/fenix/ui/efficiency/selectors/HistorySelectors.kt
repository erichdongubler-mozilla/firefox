/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.efficiency.selectors

import org.mozilla.fenix.ui.efficiency.helpers.Selector
import org.mozilla.fenix.ui.efficiency.helpers.SelectorStrategy

object HistorySelectors {
    val TOOLBAR_TITLE = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_TEXT,
        value = "History",
        description = "History Toolbar Title",
        groups = listOf("requiredForPage"),
    )

    val RECENTLY_CLOSED_TABS_BUTTON = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_RES_ID,
        value = "recently_closed_tabs_header",
        description = "Recently closed tabs button",
        groups = listOf("requiredForPage"),
    )

    val EMPTY_HISTORY_VIEW = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_RES_ID,
        value = "history_empty_view",
        description = "Empty history view",
        groups = listOf("emptyHistory"),
    )

    val HISTORY_LIST = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_RES_ID,
        value = "history_list",
        description = "Browsing history list view",
        groups = listOf("browsingHistory"),
    )

    val VISITED_TIME_TITLE = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_TEXT,
        value = "Today",
        description = "Today chronological timeline title",
        groups = listOf("browsingHistory"),
    )

    val HISTORY_ITEM_TITLE = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_RES_ID,
        value = "title",
        description = "History item title",
        groups = listOf("browsingHistory"),
    )

    val HISTORY_ITEM_URL = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_RES_ID,
        value = "url",
        description = "History item URL",
        groups = listOf("browsingHistory"),
    )

    val HISTORY_ITEM_DELETE_BUTTON = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_DESCRIPTION_CONTAINS,
        value = "Delete",
        description = "History item delete button",
        groups = listOf("browsingHistory"),
    )

    val DELETE_ALL_HISTORY_BUTTON = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_RES_ID,
        value = "history_delete",
        description = "Delete all history button",
        groups = listOf("requiredForPage", "browsingHistory"),
    )

    val DELETE_CONFIRMATION_DIALOG_TITLE = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_RES_ID,
        value = "title",
        description = "Delete confirmation dialog title",
        groups = listOf("deleteConfirmation"),
    )

    val DELETE_CONFIRMATION_DIALOG_MESSAGE = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_RES_ID,
        value = "body",
        description = "Delete confirmation dialog message",
        groups = listOf("deleteConfirmation"),
    )

    val DELETE_EVERYTHING_OPTION_BUTTON = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_RES_ID,
        value = "everything_button",
        description = "Everything option button in delete dialog",
        groups = listOf("deleteConfirmation"),
    )

    val DELETE_CONFIRM_BUTTON = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_TEXT,
        value = "Delete",
        description = "Confirm delete button in dialog",
        groups = listOf("deleteConfirmation"),
    )

    val BROWSING_DATA_DELETED_SNACKBAR = Selector(
        strategy = SelectorStrategy.UIAUTOMATOR_WITH_TEXT,
        value = "Browsing data deleted",
        description = "Browsing data deleted snackbar message",
        groups = listOf(),
    )

    val all = listOf(
        TOOLBAR_TITLE,
        RECENTLY_CLOSED_TABS_BUTTON,
        EMPTY_HISTORY_VIEW,
        HISTORY_LIST,
        VISITED_TIME_TITLE,
        HISTORY_ITEM_TITLE,
        HISTORY_ITEM_URL,
        HISTORY_ITEM_DELETE_BUTTON,
        DELETE_ALL_HISTORY_BUTTON,
        DELETE_CONFIRMATION_DIALOG_TITLE,
        DELETE_CONFIRMATION_DIALOG_MESSAGE,
        DELETE_EVERYTHING_OPTION_BUTTON,
        DELETE_CONFIRM_BUTTON,
        BROWSING_DATA_DELETED_SNACKBAR,
    )
}
