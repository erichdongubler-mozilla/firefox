/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.utils

import mozilla.components.support.ktx.android.content.PreferencesHolder
import kotlin.properties.PropertyDelegateProvider
import kotlin.properties.ReadWriteProperty
import mozilla.components.support.ktx.android.content.booleanPreference as acBooleanPreference
import mozilla.components.support.ktx.android.content.floatPreference as acFloatPreference
import mozilla.components.support.ktx.android.content.intPreference as acIntPreference
import mozilla.components.support.ktx.android.content.longPreference as acLongPreference
import mozilla.components.support.ktx.android.content.stringPreference as acStringPreference
import mozilla.components.support.ktx.android.content.stringSetPreference as acStringSetPreference

/**
 * A [PreferencesHolder] that also collects a getter for every preference declared through the registering delegate
 * factories in this file, keyed by the SharedPreferences key. Getters read through the delegate, so defaults are
 * applied even when no value has been persisted.
 *
 * This was created primarily to automatically expose all settings preferences as Nimbus messaging custom attributes,
 * without each preference having to opt in individually. Other use-cases may emerge, but that is the motivating one.
 */
interface RegisteringPreferencesHolder : PreferencesHolder {

    /**
     * Getters for every registered preference, keyed by the SharedPreferences key. Populated automatically at
     * property binding time when this holder's preference properties are declared with the delegate factories in this
     * file. Should not typically be accessed directly; use [allPreferences].
     */
    val preferenceGetters: MutableMap<String, () -> Any?>

    /**
     * Returns a snapshot of every registered preference, with defaults applied for preferences that have no
     * persisted value.
     *
     * Note that this invokes the getter of each registered preference, which evaluates the default for any unpersisted
     * preference and, for delegates created with `persistDefaultIfNotExists = true`, persists that default.
     */
    fun allPreferences(): Map<String, Any?> = preferenceGetters.mapValues { (_, getter) -> getter() }
}

private fun <T> registering(
    key: String,
    delegate: ReadWriteProperty<PreferencesHolder, T>,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, T>> =
    PropertyDelegateProvider { thisRef, property ->
        if (thisRef is RegisteringPreferencesHolder) {
            thisRef.preferenceGetters[key] = { delegate.getValue(thisRef, property) }
        }
        delegate
    }

/**
 * Property delegate for getting and setting a boolean shared preference. Optionally this will persist the default
 * value if one is not already persisted.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun booleanPreference(
    key: String,
    default: Boolean,
    persistDefaultIfNotExists: Boolean = false,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, Boolean>> =
    registering(key, acBooleanPreference(key, default, persistDefaultIfNotExists))

/**
 * Property delegate for getting and setting a boolean shared preference. Optionally this will persist the default
 * value if one is not already persisted.
 *
 * The default lambda is not called until the property is read for the first time.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun booleanPreference(
    key: String,
    default: () -> Boolean,
    persistDefaultIfNotExists: Boolean = false,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, Boolean>> =
    registering(key, acBooleanPreference(key, default, persistDefaultIfNotExists))

/**
 * Property delegate for getting and setting a float shared preference.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun floatPreference(
    key: String,
    default: Float,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, Float>> =
    registering(key, acFloatPreference(key, default))

/**
 * Property delegate for getting and setting a float shared preference.
 *
 * The default lambda is not called until the property is read for the first time.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun floatPreference(
    key: String,
    default: () -> Float,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, Float>> =
    registering(key, acFloatPreference(key, default))

/**
 * Property delegate for getting and setting an int shared preference.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun intPreference(
    key: String,
    default: Int,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, Int>> =
    registering(key, acIntPreference(key, default))

/**
 * Property delegate for getting and setting an int shared preference.
 *
 * The default lambda is not called until the property is read for the first time.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun intPreference(
    key: String,
    default: () -> Int,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, Int>> =
    registering(key, acIntPreference(key, default))

/**
 * Property delegate for getting and setting a long shared preference.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun longPreference(
    key: String,
    default: Long,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, Long>> =
    registering(key, acLongPreference(key, default))

/**
 * Property delegate for getting and setting a long shared preference.
 *
 * The default lambda is not called until the property is read for the first time.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun longPreference(
    key: String,
    default: () -> Long,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, Long>> =
    registering(key, acLongPreference(key, default))

/**
 * Property delegate for getting and setting a string shared preference. Optionally this will persist the default
 * value if one is not already persisted.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun stringPreference(
    key: String,
    default: String,
    persistDefaultIfNotExists: Boolean = false,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, String>> =
    registering(key, acStringPreference(key, default, persistDefaultIfNotExists))

/**
 * Property delegate for getting and setting a string shared preference. Optionally this will persist the default
 * value if one is not already persisted.
 *
 * The default lambda is not called until the property is read for the first time.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun stringPreference(
    key: String,
    default: () -> String,
    persistDefaultIfNotExists: Boolean = false,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, String>> =
    registering(key, acStringPreference(key, default, persistDefaultIfNotExists))

/**
 * Property delegate for getting and setting a string set shared preference.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun stringSetPreference(
    key: String,
    default: Set<String>,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, Set<String>>> =
    registering(key, acStringSetPreference(key, default))

/**
 * Property delegate for getting and setting a string set shared preference.
 *
 * The default lambda is not called until the property is read for the first time.
 *
 * If the holder is a [RegisteringPreferencesHolder], the preference is also registered in
 * [RegisteringPreferencesHolder.preferenceGetters] at binding time.
 */
fun stringSetPreference(
    key: String,
    default: () -> Set<String>,
): PropertyDelegateProvider<PreferencesHolder, ReadWriteProperty<PreferencesHolder, Set<String>>> =
    registering(key, acStringSetPreference(key, default))
