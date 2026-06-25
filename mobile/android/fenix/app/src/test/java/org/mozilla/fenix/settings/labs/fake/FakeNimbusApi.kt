/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.settings.labs.fake

import android.content.Context
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import org.mozilla.experiments.nimbus.internal.FirefoxLabsEnrollStatus
import org.mozilla.experiments.nimbus.internal.FirefoxLabsMetadata
import org.mozilla.experiments.nimbus.internal.FirefoxLabsUnenrollStatus
import org.mozilla.fenix.nimbus.TestNimbusApi

/**
 * A fake [mozilla.components.service.nimbus.NimbusApi] for exercising the Firefox Labs enroll and
 * unenroll flows in tests. It records the slugs it was asked to enroll/unenroll and returns the
 * statuses supplied by the providers.
 */
internal class FakeNimbusApi(
    context: Context,
    private val labsProvider: () -> List<FirefoxLabsMetadata>,
    private val enrolledSlugs: MutableList<String>,
    private val unenrolledSlugs: MutableList<String>,
    private val enrollStatusProvider: () -> FirefoxLabsEnrollStatus,
    private val unenrollStatusProvider: () -> FirefoxLabsUnenrollStatus,
    private val onUnenrollAll: () -> Unit,
) : TestNimbusApi(context) {
    override fun getAvailableFirefoxLabs(): Deferred<List<FirefoxLabsMetadata>> =
        CompletableDeferred(labsProvider())

    override fun enrollInFirefoxLab(slug: String): Deferred<FirefoxLabsEnrollStatus> {
        enrolledSlugs.add(slug)
        return CompletableDeferred(enrollStatusProvider())
    }

    override fun unenrollFromFirefoxLab(slug: String): Deferred<FirefoxLabsUnenrollStatus> {
        unenrolledSlugs.add(slug)
        return CompletableDeferred(unenrollStatusProvider())
    }

    override fun unenrollFromAllFirefoxLabs(): Deferred<Unit> {
        onUnenrollAll()
        return CompletableDeferred(Unit)
    }
}
