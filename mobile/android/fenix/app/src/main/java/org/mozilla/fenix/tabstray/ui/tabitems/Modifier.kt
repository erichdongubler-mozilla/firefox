/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.tabstray.ui.tabitems

import androidx.compose.foundation.Indication
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import mozilla.components.ui.colors.PhotonColors
import org.mozilla.fenix.tabstray.data.TabsTrayItem

/**
 * Configure a node to handle clicks for a [TabsTrayItem.Tab] and render a custom click indication.
 *
 * @param tab The [TabsTrayItem.Tab] to be relayed back when this node is clicked.
 * @param enabled Whether clicks are enabled.
 * @param onClick Invoked when the user clicks this node.
 * @param onLongClick Invoked when the user long clicks this node.
 */
internal fun Modifier.tabItemClickable(
    tab: TabsTrayItem.Tab,
    enabled: Boolean,
    onClick: (TabsTrayItem) -> Unit,
    onLongClick: ((TabsTrayItem) -> Unit)? = null,
) = composed {
    val interactionSource = remember { MutableInteractionSource() }

    if (onLongClick == null) {
        Modifier.clickable(
            interactionSource = interactionSource,
            indication = clickRipple,
            enabled = enabled,
            onClick = { onClick(tab) },
        )
    } else {
        Modifier.combinedClickable(
            interactionSource = interactionSource,
            indication = clickRipple,
            enabled = enabled,
            onLongClick = { onLongClick(tab) },
            onClick = { onClick(tab) },
        )
    }
}

private val clickRipple: Indication
@Composable get() = ripple(
    color = when (isSystemInDarkTheme()) {
        true -> PhotonColors.White
        false -> PhotonColors.Black
    },
)
