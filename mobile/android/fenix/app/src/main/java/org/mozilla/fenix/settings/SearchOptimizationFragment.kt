/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.settings

import android.os.Bundle
import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat
import androidx.preference.SwitchPreference
import org.mozilla.fenix.R
import org.mozilla.fenix.ext.settings
import org.mozilla.fenix.ext.showToolbar

/**
 * Settings related to the Search Optimization feature
 */
class SearchOptimizationFragment : PreferenceFragmentCompat() {
    override fun onResume() {
        super.onResume()
        showToolbar(getString(R.string.preferences_debug_settings_search_optimization))
    }

    override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
        setPreferencesFromResource(R.xml.search_optimization_preferences, rootKey)

        val settings = requireContext().settings()
        val isFeatureEnabled = settings.isSearchOptimizationEnabled
        val childPreferences = listOf(
            ChildPreferenceConfig(
                preference = R.string.pref_key_search_optimization_stocks,
                isChecked = settings.shouldShowSearchOptimizationStockCard,
                onDisable = { settings.shouldShowSearchOptimizationStockCard = false },
            ),
            ChildPreferenceConfig(
                preference = R.string.pref_key_search_optimization_sports,
                isChecked = settings.shouldShowSearchOptimizationSportCard,
                onDisable = { settings.shouldShowSearchOptimizationSportCard = false },
            ),
        )

        requirePreference<SwitchPreference>(R.string.pref_key_search_optimization_feature).apply {
            isChecked = isFeatureEnabled
            onPreferenceChangeListener = Preference.OnPreferenceChangeListener { _, newValue ->
                (newValue as? Boolean)?.let { newOption ->
                    settings.isSearchOptimizationEnabled = newOption
                    childPreferences.forEach { config ->
                        updateChildPreference(config.preference, newOption, config.onDisable)
                    }
                }
                true
            }
        }

        childPreferences.forEach { config ->
            setupChildPreference(config.preference, isFeatureEnabled, config.isChecked)
        }
    }

    private fun updateChildPreference(
        preference: Int,
        isFeatureEnabled: Boolean,
        onDisable: () -> Unit,
    ) {
        requirePreference<SwitchPreference>(preference).apply {
            isEnabled = isFeatureEnabled
            summary = when (isFeatureEnabled) {
                true -> null
                false -> getString(R.string.preferences_debug_settings_search_optimization_card_summary)
            }
            if (!isFeatureEnabled && isChecked) {
                isChecked = false
                onDisable()
            }
        }
    }

    private fun setupChildPreference(
        preference: Int,
        isFeatureEnabled: Boolean,
        isChecked: Boolean,
    ) {
        requirePreference<SwitchPreference>(preference).apply {
            isEnabled = isFeatureEnabled
            this.isChecked = isChecked
            summary = when (isFeatureEnabled) {
                true -> null
                false -> getString(R.string.preferences_debug_settings_search_optimization_card_summary)
            }
            onPreferenceChangeListener = SharedPreferenceUpdater()
        }
    }

    private data class ChildPreferenceConfig(
        val preference: Int,
        val isChecked: Boolean,
        val onDisable: () -> Unit,
    )
}
