/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.utils

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.test.core.app.ApplicationProvider
import mozilla.components.support.ktx.android.content.PreferencesHolder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class RegisteringPreferencesHolderTest {

    private lateinit var sharedPrefs: SharedPreferences

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        sharedPrefs = context.getSharedPreferences("test", Context.MODE_PRIVATE)
        sharedPrefs.edit(commit = true) { clear() }
    }

    private inner class TestHolder : RegisteringPreferencesHolder {
        override val preferenceGetters: MutableMap<String, () -> Any?> = mutableMapOf()
        override val preferences: SharedPreferences = sharedPrefs

        var boolPref by booleanPreference("bool_key", default = true)
        var floatPref by floatPreference("float_key", default = 1.5f)
        var intPref by intPreference("int_key", default = 7)
        var longPref by longPreference("long_key", default = 7L)
        var stringPref by stringPreference("string_key", default = "default")
        var stringSetPref by stringSetPreference("set_key", default = setOf("a"))
    }

    @Test
    fun `GIVEN a registering holder WHEN constructed THEN all preference keys are registered`() {
        val holder = TestHolder()

        assertEquals(
            setOf("bool_key", "float_key", "int_key", "long_key", "string_key", "set_key"),
            holder.preferenceGetters.keys,
        )
    }

    @Test
    fun `GIVEN no persisted values WHEN allPreferences is called THEN defaults are returned`() {
        val holder = TestHolder()

        val all = holder.allPreferences()

        assertEquals(true, all["bool_key"])
        assertEquals(1.5f, all["float_key"])
        assertEquals(7, all["int_key"])
        assertEquals(7L, all["long_key"])
        assertEquals("default", all["string_key"])
        assertEquals(setOf("a"), all["set_key"])
    }

    @Test
    fun `GIVEN lambda-default overloads WHEN allPreferences is called THEN defaults are returned`() {
        val holder = object : RegisteringPreferencesHolder {
            override val preferenceGetters: MutableMap<String, () -> Any?> = mutableMapOf()
            override val preferences: SharedPreferences = sharedPrefs

            var boolPref by booleanPreference("bool_key", default = { true })
            var floatPref by floatPreference("float_key", default = { 1.5f })
            var intPref by intPreference("int_key", default = { 7 })
            var longPref by longPreference("long_key", default = { 7L })
            var stringPref by stringPreference("string_key", default = { "default" })
            var stringSetPref by stringSetPreference("set_key", default = { setOf("a") })
        }

        val all = holder.allPreferences()

        assertEquals(true, all["bool_key"])
        assertEquals(1.5f, all["float_key"])
        assertEquals(7, all["int_key"])
        assertEquals(7L, all["long_key"])
        assertEquals("default", all["string_key"])
        assertEquals(setOf("a"), all["set_key"])
    }

    @Test
    fun `GIVEN a value written via the property WHEN allPreferences is called THEN the persisted value is returned`() {
        val holder = TestHolder()

        holder.boolPref = false
        holder.stringPref = "updated"

        val all = holder.allPreferences()
        assertEquals(false, all["bool_key"])
        assertEquals("updated", all["string_key"])
    }

    @Test
    fun `GIVEN a value written directly to SharedPreferences WHEN allPreferences is called THEN the registry sees it`() {
        val holder = TestHolder()

        sharedPrefs.edit(commit = true) { putInt("int_key", 42) }

        assertEquals(42, holder.allPreferences()["int_key"])
    }

    @Test
    fun `GIVEN a plain PreferencesHolder WHEN using registering delegates THEN they work without a registry`() {
        val holder = object : PreferencesHolder {
            override val preferences: SharedPreferences = sharedPrefs
            var plainPref by booleanPreference("plain_key", default = true)
        }

        assertTrue(holder.plainPref)
        holder.plainPref = false
        assertFalse(holder.plainPref)
    }

    @Test
    fun `GIVEN persistDefaultIfNotExists WHEN read through allPreferences THEN the default is persisted`() {
        val holder = object : RegisteringPreferencesHolder {
            override val preferenceGetters: MutableMap<String, () -> Any?> = mutableMapOf()
            override val preferences: SharedPreferences = sharedPrefs
            var persisted by booleanPreference(
                "persist_key",
                default = true,
                persistDefaultIfNotExists = true,
            )
        }

        assertFalse(sharedPrefs.contains("persist_key"))
        holder.allPreferences()
        assertTrue(sharedPrefs.contains("persist_key"))
    }

    @Test
    fun `GIVEN a lazy default WHEN the holder is constructed THEN the default is not evaluated until read`() {
        var evaluated = false
        val holder = object : RegisteringPreferencesHolder {
            override val preferenceGetters: MutableMap<String, () -> Any?> = mutableMapOf()
            override val preferences: SharedPreferences = sharedPrefs
            var lazyPref by intPreference("lazy_key") {
                evaluated = true
                99
            }
        }

        assertFalse(evaluated)
        assertEquals(99, holder.allPreferences()["lazy_key"])
        assertTrue(evaluated)
    }

    @Test
    fun `GIVEN an unregistered key WHEN allPreferences is called THEN it is absent`() {
        val holder = TestHolder()

        sharedPrefs.edit(commit = true) { putBoolean("unregistered_key", true) }

        assertNull(holder.allPreferences()["unregistered_key"])
        assertFalse("unregistered_key" in holder.allPreferences())
    }
}
