/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.trackingprotection

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.tooling.preview.PreviewParameter
import androidx.compose.ui.unit.dp
import mozilla.components.compose.base.BottomSheetHandle
import mozilla.components.feature.protection.dashboard.TrackerProtectionDashboard
import mozilla.components.feature.protection.dashboard.TrackersBlockedCategory
import org.mozilla.fenix.R
import org.mozilla.fenix.theme.FirefoxTheme
import org.mozilla.fenix.theme.PreviewThemeProvider
import org.mozilla.fenix.theme.Theme
import mozilla.components.feature.protection.dashboard.R as dashboardR
import mozilla.components.ui.icons.R as iconsR

/**
 * The trackers protections dashboard styled as a bottom sheet layout.
 *
 * @param trackersBlockedThisWeek List of the trackers blocked this week.
 * @param onDismiss Callback for when the user dismisses this panel
 * (by pressing system back or from interacting with the bottom sheet handle).
 */
@Composable
fun ProtectionsDashboardContent(
    trackersBlockedThisWeek: List<TrackersBlockedCategory>,
    onDismiss: () -> Unit,
) {
    BackHandler {
        onDismiss()
    }

    FirefoxTheme {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(
                    MaterialTheme.shapes.extraLarge.copy(
                        bottomStart = CornerSize(0.dp),
                        bottomEnd = CornerSize(0.dp),
                    ),
                )
                .semantics { isTraversalGroup = true },
        ) {
            TrackerProtectionDashboard(
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { traversalIndex = 0f },
                appName = stringResource(R.string.firefox),
                totalTrackersBlocked = trackersBlockedThisWeek.sumOf { it.count },
                sitesCount = 0, // We don't yet have an API to get this data from.
                dataSavedMB = null, // We don't yet have an API to get this data from.
                trackersBlocked = trackersBlockedThisWeek,
                contentPadding = PaddingValues(
                    top = FirefoxTheme.layout.size.static300, // handle height + its top padding
                ),
            )

            BottomSheetHandle(
                onRequestDismiss = onDismiss,
                contentDescription = "",
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = FirefoxTheme.layout.size.static200)
                    .semantics { traversalIndex = 1f },
            )
        }
    }
}

@Preview
@Composable
private fun ProtectionsDashboardContentPreview(
    @PreviewParameter(PreviewThemeProvider::class) theme: Theme,
) {
    val trackersBlocked = listOf(
        TrackersBlockedCategory(
            icon = iconsR.drawable.mozac_ic_cookies_24,
            name = dashboardR.string.protections_dashboard_category_cookies,
            count = 302,
        ),
        TrackersBlockedCategory(
            icon = iconsR.drawable.mozac_ic_social_tracker_24,
            name = dashboardR.string.protections_dashboard_category_social,
            count = 241,
        ),
        TrackersBlockedCategory(
            icon = iconsR.drawable.mozac_ic_fingerprinter_24,
            name = dashboardR.string.protections_dashboard_category_fingerprinters,
            count = 0,
        ),
        TrackersBlockedCategory(
            icon = iconsR.drawable.mozac_ic_image_24,
            name = dashboardR.string.protections_dashboard_category_tracking_content,
            count = 2234,
        ),
    )

    FirefoxTheme(theme) {
        Surface {
            ProtectionsDashboardContent(
                trackersBlockedThisWeek = trackersBlocked,
            ) {}
        }
    }
}
