/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.experiments

import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.navigation.NavController
import org.mozilla.fenix.IntentReceiverActivity
import org.mozilla.fenix.R
import org.mozilla.fenix.ext.components
import org.mozilla.fenix.home.HomeFragmentDirections
import mozilla.components.ui.icons.R as iconsR

/**
 * Manager class responsible for creating the uninstall survey app shortcut
 * and handling its navigation routing.
 */
class UninstallSurveyManager(private val context: Context) {

    private val shortcutIntent = Intent(context, IntentReceiverActivity::class.java).apply {
        action = ACTION_UNINSTALL_SURVEY
    }

    /**
     * Programmatically registers or updates the dynamic shortcut on the device home screen.
     */
    fun updateUninstallSurveyShortcut() {
        if (context.components.settings.uninstallSurveyFeatureFlagEnabled) {
            val shortcut = ShortcutInfoCompat.Builder(context, SHORTCUT_ID)
                .setShortLabel(context.getString(R.string.home_screen_shortcut_uninstall_survey))
                .setIcon(IconCompat.createWithResource(context, iconsR.drawable.mozac_ic_delete_black_24))
                .setIntent(shortcutIntent)
                .build()

            ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
        } else {
            ShortcutManagerCompat.removeDynamicShortcuts(context, listOf(SHORTCUT_ID))
        }
    }

    /**
     * Navigates to the survey dialog from the shortcut intent, preventing duplicate views and routing loops.
     */
    fun showUninstallSurvey(currentIntent: Intent?, navController: NavController) {
        if (currentIntent?.action == ACTION_UNINSTALL_SURVEY) {
            val isAlreadyShowing = navController.currentDestination?.id == R.id.uninstallSurveyBottomSheetFragment

            if (!isAlreadyShowing) {
                navController.navigate(
                    HomeFragmentDirections.actionGlobalUninstallSurveyDialog(UNINSTALL_SURVEY_ARG),
                )
            }
            currentIntent.action = null
        }
    }

    companion object {
        const val ACTION_UNINSTALL_SURVEY = "org.mozilla.fenix.ACTION_UNINSTALL_SURVEY"
        private const val SHORTCUT_ID = "uninstall_survey_shortcut"
        private const val UNINSTALL_SURVEY_ARG = "uninstall_survey_arg"
    }
}
