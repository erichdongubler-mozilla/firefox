/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.trackingprotection

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.PreviewLightDark
import androidx.compose.ui.unit.dp
import org.mozilla.fenix.R
import org.mozilla.fenix.theme.FirefoxTheme

private val privacyGradientStart = Color(0xFFAE49EC)
private val privacyGradientEnd = Color(0xFF210340)

/**
 * A card that displays the number of trackers blocked.
 *
 * @param trackersBlockedCount The number of trackers blocked to display.
 * @param modifier Modifier to be applied to the card.
 */
@Composable
fun TrackersBlockedCard(
    trackersBlockedCount: Int,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .background(
                color = FirefoxTheme.colors.layer2,
                shape = RoundedCornerShape(8.dp),
            )
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(
            painter = painterResource(R.drawable.ic_shield_checkmark_gradient),
            contentDescription = null,
            modifier = Modifier.size(16.dp),
        )

        Text(
            text = if (trackersBlockedCount > 0) {
                pluralStringResource(
                    R.plurals.trackers_blocked_count,
                    trackersBlockedCount,
                    trackersBlockedCount,
                )
            } else {
                stringResource(R.string.trackers_blocked_empty)
            },
            style = FirefoxTheme.typography.body2.copy(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        privacyGradientStart,
                        privacyGradientEnd,
                    ),
                ),
            ),
        )
    }
}

@PreviewLightDark
@Composable
private fun TrackersBlockedCardPreview() {
    FirefoxTheme {
        TrackersBlockedCard(trackersBlockedCount = 754)
    }
}

@PreviewLightDark
@Composable
private fun TrackersBlockedCardEmptyPreview() {
    FirefoxTheme {
        TrackersBlockedCard(trackersBlockedCount = 0)
    }
}
