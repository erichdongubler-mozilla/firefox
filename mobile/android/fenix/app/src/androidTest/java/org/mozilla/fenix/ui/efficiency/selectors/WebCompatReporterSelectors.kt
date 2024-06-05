/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.efficiency.selectors

import mozilla.components.compose.base.R as composeBaseR
import org.mozilla.fenix.R
import org.mozilla.fenix.helpers.DataGenerationHelper.getStringResource
import org.mozilla.fenix.helpers.TestHelper.appName
import org.mozilla.fenix.ui.efficiency.helpers.PageReadinessProfiles
import org.mozilla.fenix.ui.efficiency.helpers.Selector
import org.mozilla.fenix.ui.efficiency.helpers.SelectorContainer
import org.mozilla.fenix.ui.efficiency.helpers.SelectorGroup
import org.mozilla.fenix.ui.efficiency.helpers.SelectorStrategy
import org.mozilla.fenix.ui.efficiency.helpers.SwipeDirection
import org.mozilla.fenix.webcompat.BrokenSiteReporterTestTags

object WebCompatReporterSelectors : SelectorContainer {
    enum class Group : SelectorGroup {
        REPORTER_VIEW_ITEMS,
        REPORTER_FORM,
        REPORTER_FORM_ONLY_ITEMS,
        SOMETHING_ELSE_REASON_FORM,
        EDIT_URLDIALOG,
        BROKEN_SITE_REASONS,
    }

    private fun brokenSiteReason(reasonRes: Int, description: String) =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TAG,
            value = "${BrokenSiteReporterTestTags.BROKEN_SITE_REPORTER_REASON_OPTION}-${getStringResource(reasonRes)}",
            description = description,
            groups = setOf(Group.BROKEN_SITE_REASONS),
            scrollDirection = SwipeDirection.UP,
        )

    val REASON_LOAD = brokenSiteReason(R.string.webcompat_reporter_reason_load, "Broken site reason: site doesn't load")
    val REASON_CHECKOUT =
        brokenSiteReason(
            R.string.webcompat_reporter_reason_checkout,
            "Broken site reason: can't pay, check out or shop",
        )
    val REASON_SLOW = brokenSiteReason(R.string.webcompat_reporter_reason_slow2, "Broken site reason: site is slow")
    val REASON_MEDIA =
        brokenSiteReason(
            R.string.webcompat_reporter_reason_media2,
            "Broken site reason: video isn't playing or loading",
        )
    val REASON_CONTENT =
        brokenSiteReason(R.string.webcompat_reporter_reason_content2, "Broken site reason: missing content")
    val REASON_ACCOUNT =
        brokenSiteReason(R.string.webcompat_reporter_reason_account2, "Broken site reason: can't sign in or register")
    val REASON_TURN_OFF_ADBLOCKER =
        brokenSiteReason(
            R.string.webcompat_reporter_reason_turn_off_adblocker,
            "Broken site reason: site asked to turn off ad blocker",
        )
    val REASON_NOT_SUPPORTED =
        brokenSiteReason(
            R.string.webcompat_reporter_reason_notsupported_2,
            "Broken site reason: browser is blocked or unsupported",
        )
    val REASON_SITE_IS_DECEPTIVE =
        brokenSiteReason(
            R.string.webcompat_reporter_reason_site_is_deceptive,
            "Broken site reason: this site is deceptive",
        )
    val REASON_OTHER = brokenSiteReason(R.string.webcompat_reporter_reason_other, "Broken site reason: something else")

    val URL_LABEL =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TEXT,
            value = getStringResource(R.string.webcompat_reporter_label_url),
            description = "Report broken site URL label",
            groups =
                setOf(
                    Group.REPORTER_VIEW_ITEMS,
                    Group.REPORTER_FORM,
                    Group.SOMETHING_ELSE_REASON_FORM,
                ),
            readiness = PageReadinessProfiles.IDENTITY_ANCHOR,
        )

    val WHATS_BROKEN_LABEL =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TEXT,
            value = getStringResource(R.string.webcompat_reporter_label_whats_broken_3),
            description = "Report broken site \"What's not working?\" label",
            groups =
                setOf(
                    Group.REPORTER_VIEW_ITEMS,
                    Group.REPORTER_FORM,
                    Group.SOMETHING_ELSE_REASON_FORM,
                ),
            readiness = PageReadinessProfiles.READY_CONTENT,
        )

    // The description is a single content-description node built from the body copy, the inlined
    // "Learn more" link text, and the compose-base link affordance suffix — mirroring how the legacy
    // BrowserRobot composed it. Splitting it would not match the node.
    val DESCRIPTION =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_CONTENT_DESCRIPTION,
            value =
                getStringResource(
                    R.string.webcompat_reporter_description_3,
                    appName,
                    getStringResource(R.string.webcompat_reporter_learn_more),
                ) + " " + getStringResource(composeBaseR.string.mozac_compose_base_link_text_links_available),
            description = "Report broken site description",
            groups =
                setOf(
                    Group.REPORTER_VIEW_ITEMS,
                    Group.REPORTER_FORM,
                    Group.SOMETHING_ELSE_REASON_FORM,
                ),
            readiness = PageReadinessProfiles.READY_CONTENT,
            scrollDirection = SwipeDirection.UP,
        )

    @Suppress("FunctionName")
    fun REPORTED_SITE_URL(url: String = "") =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TEXT,
            value = url,
            description = "Report broken site reported URL: $url",
        )

    val BROKEN_SITE_REPORTER_EDIT_URL_BUTTON =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TAG,
            value = BrokenSiteReporterTestTags.BROKEN_SITE_REPORTER_EDIT_URL_BUTTON,
            description = "Report broken site edit url button",
            groups = setOf(Group.REPORTER_VIEW_ITEMS),
        )

    val EDIT_SITE_URL_DIALOG_TEXT_FIELD =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TAG,
            value = BrokenSiteReporterTestTags.BROKEN_SITE_REPORTER_EDIT_URL_DIALOG_TEXT_FIELD,
            description = "Report broken site edit url dialog URL text field",
            groups = setOf(Group.EDIT_URLDIALOG),
        )

    val EDIT_SITE_URL_DIALOG_SAVE_BUTTON =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TAG,
            value = BrokenSiteReporterTestTags.BROKEN_SITE_REPORTER_EDIT_URL_DIALOG_SAVE_BUTTON,
            description = "Report broken site edit url dialog save button",
            groups = setOf(Group.EDIT_URLDIALOG),
        )

    val EDIT_SITE_URL_DIALOG_DISMISS_BUTTON =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TAG,
            value = BrokenSiteReporterTestTags.BROKEN_SITE_REPORTER_EDIT_URL_DIALOG_DISMISS_BUTTON,
            description = "Report broken site edit url dialog dismiss button",
            groups = setOf(Group.EDIT_URLDIALOG),
        )

    @Suppress("FunctionName")
    fun REPORTED_BROKEN_SITE_REASON(reason: String = "") =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TEXT,
            value = reason,
            description = "Report broken site reported reason: $reason",
            groups = setOf(Group.REPORTER_VIEW_ITEMS),
        )

    val CLEAR_SELECTED_REASON_BUTTON =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_CONTENT_DESCRIPTION,
            value = getStringResource(R.string.webcompat_reporter_clear_reason_content_description),
            description = "Report broken site clear selected reason button",
            groups = setOf(Group.REPORTER_FORM),
        )

    val DESCRIBE_PROBLEM_MANDATORY_LABEL =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TEXT,
            value = getStringResource(R.string.webcompat_reporter_label_mandatory_description),
            description = "Report broken site mandatory description label",
            groups = setOf(Group.SOMETHING_ELSE_REASON_FORM),
        )

    val DESCRIBE_PROBLEM_OPTIONAL_LABEL =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TEXT,
            value = getStringResource(R.string.webcompat_reporter_label_optional_description),
            description = "Report broken site optional description label",
            groups = setOf(Group.REPORTER_FORM),
        )

    val DESCRIPTION_INPUT_BOX =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TAG,
            value = BrokenSiteReporterTestTags.BROKEN_SITE_REPORTER_DESCRIPTION_INPUT,
            description = "Report broken site description input box",
            groups = setOf(Group.REPORTER_FORM, Group.REPORTER_FORM_ONLY_ITEMS, Group.SOMETHING_ELSE_REASON_FORM),
            scrollDirection = SwipeDirection.UP,
        )

    val ITEMS_BLOCKED_BY_TRACKING_PROTECTION_DESCRIPTION =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TEXT,
            value = getStringResource(R.string.webcompat_reporter_etp_checkbox_text_2),
            description = "Report broken site items blocked by tracking protection",
            groups = setOf(Group.REPORTER_FORM, Group.SOMETHING_ELSE_REASON_FORM),
            scrollDirection = SwipeDirection.UP,
        )

    val ITEMS_BLOCKED_BY_TRACKING_PROTECTION_CHECKBOX =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TAG,
            value = BrokenSiteReporterTestTags.BROKEN_SITE_REPORTER_INCLUDE_ETP_BLOCKED_URLS_CHECKBOX,
            description = "Report broken site items blocked by tracking protection checkbox",
            groups = setOf(Group.REPORTER_FORM, Group.REPORTER_FORM_ONLY_ITEMS, Group.SOMETHING_ELSE_REASON_FORM),
            scrollDirection = SwipeDirection.UP,
        )

    val PREVIEW_REPORT_BUTTON =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TEXT,
            value = getStringResource(R.string.webcompat_reporter_preview_report),
            description = "Report broken site preview report button",
            groups = setOf(Group.REPORTER_FORM, Group.REPORTER_FORM_ONLY_ITEMS, Group.SOMETHING_ELSE_REASON_FORM),
        )

    val SEND_REPORT_BUTTON =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TAG,
            value = BrokenSiteReporterTestTags.BROKEN_SITE_REPORTER_SEND_BUTTON,
            description = "Report broken site send report button",
            groups = setOf(Group.REPORTER_FORM, Group.REPORTER_FORM_ONLY_ITEMS, Group.SOMETHING_ELSE_REASON_FORM),
        )

    val DESCRIBE_PROBLEM_ERROR_MESSAGE =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TEXT,
            value = getStringResource(R.string.webcompat_reporter_description_error),
            description = "Report broken site description error message",
            groups = setOf(Group.SOMETHING_ELSE_REASON_FORM),
        )

    val REPORT_SENT_SNACK_BAR_MESSAGE =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TEXT,
            value = getStringResource(R.string.crash_reporting_snack_bar_message),
            description = "Report broken site sent snack bar message",
        )

    val CLOSE_REPORT_BUTTON =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_CONTENT_DESCRIPTION,
            value = "Close",
            description = "Report broken site close report button",
            groups = setOf(Group.REPORTER_VIEW_ITEMS, Group.REPORTER_FORM),
        )

    override val scrollTraversalOrder: Map<SelectorGroup, List<Selector>> =
        mapOf(
            Group.BROKEN_SITE_REASONS to
                listOf(
                    REASON_NOT_SUPPORTED,
                    REASON_LOAD,
                    REASON_MEDIA,
                    REASON_SITE_IS_DECEPTIVE,
                    REASON_CONTENT,
                    REASON_SLOW,
                    REASON_CHECKOUT,
                    REASON_ACCOUNT,
                    REASON_TURN_OFF_ADBLOCKER,
                    REASON_OTHER,
                ),
            Group.REPORTER_FORM to
                listOf(
                    DESCRIPTION_INPUT_BOX,
                    ITEMS_BLOCKED_BY_TRACKING_PROTECTION_DESCRIPTION,
                    ITEMS_BLOCKED_BY_TRACKING_PROTECTION_CHECKBOX,
                    DESCRIPTION,
                ),
            Group.REPORTER_FORM_ONLY_ITEMS to
                listOf(
                    DESCRIPTION_INPUT_BOX,
                    ITEMS_BLOCKED_BY_TRACKING_PROTECTION_CHECKBOX,
                ),
            Group.SOMETHING_ELSE_REASON_FORM to
                listOf(
                    DESCRIPTION_INPUT_BOX,
                    ITEMS_BLOCKED_BY_TRACKING_PROTECTION_DESCRIPTION,
                    ITEMS_BLOCKED_BY_TRACKING_PROTECTION_CHECKBOX,
                    DESCRIPTION,
                ),
        )
}
