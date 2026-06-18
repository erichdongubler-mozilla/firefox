/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.debugsettings.info

import android.content.res.Resources
import org.mozilla.fenix.R
import org.xmlpull.v1.XmlPullParser

private const val KEY_ATTRIBUTE_NAME = "key"
private const val SWITCH_PREFERENCE_TAG = "SwitchPreferenceCompat"

/**
 * Parses [R.xml.secret_settings_preferences] and returns the list of preference keys for every
 * switch preference declared in the secret settings screen.
 *
 * @param resources [Resources] used to read the preference XML.
 */
internal fun getSecretSettingsPreferenceKeys(resources: Resources): List<String> {
    val keys = mutableListOf<String>()
    val parser = resources.getXml(R.xml.secret_settings_preferences)

    parser.use { parser ->
        var eventType = parser.eventType

        while (eventType != XmlPullParser.END_DOCUMENT) {
            if (eventType == XmlPullParser.START_TAG && parser.name.contains(SWITCH_PREFERENCE_TAG)) {
                for (i in 0 until parser.attributeCount) {
                    if (parser.getAttributeName(i) == KEY_ATTRIBUTE_NAME) {
                        val resourceId = parser.getAttributeResourceValue(i, 0)
                        if (resourceId != 0) {
                            keys += resources.getString(resourceId)
                        }
                    }
                }
            }

            eventType = parser.next()
        }
    }

    return keys
}
