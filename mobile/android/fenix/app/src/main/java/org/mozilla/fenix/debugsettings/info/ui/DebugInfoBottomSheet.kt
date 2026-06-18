/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.debugsettings.info.ui

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

private const val DEBUG_INFO_ROUTE = "debug_info"

/**
 * The debug info bottom sheet.
 *
 * @param onDismissRequest Invoked when the user dismisses the sheet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DebugInfoBottomSheet(
    onDismissRequest: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        val navController = rememberNavController()

        NavHost(
            navController = navController,
            startDestination = DEBUG_INFO_ROUTE,
        ) {
            composable(route = DEBUG_INFO_ROUTE) {
                DebugInfoContent()
            }
        }
    }
}
