/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.efficiency.helpers

import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.Process
import android.util.Log
import kotlinx.coroutines.runBlocking
import mozilla.appservices.places.BookmarkRoot
import mozilla.components.browser.storage.sync.PlacesHistoryStorage
import org.mozilla.fenix.ext.components
import org.mozilla.fenix.helpers.TestHelper.appContext
import org.mozilla.fenix.ui.efficiency.logging.TestLogging

/**
 * What the app actually holds, sampled before and after a test.
 *
 * Two questions this answers that a screenshot cannot.
 *
 * **Did this test arrive dirty, and did cleanup establish the contract?** Arrival is sampled before cleanup as
 * evidence. The enforced before-cleanup and after-cleanup samples answer whether the harness actually established and
 * restored its declared state boundary.
 *
 * **Is a UI failure actually a UI failure?** If history has three entries and the history screen shows none, that is a
 * specific and reportable bug in the path from the store to the UI. If the store is empty too, the test never created
 * the data and the UI is innocent. Today both look identical: "element not found".
 *
 * Sampling is deliberately cheap and count-based. Reading every row of every store on both sides of every test would
 * cost more than the information is worth, and counts plus a diff answer both questions above. An unreadable value is
 * retained as evidence and fails an enforced isolation boundary because silence would make that boundary unverifiable.
 */
object StateProbe {

    /** One sample of everything worth watching. Ordered so the diff reads consistently. */
    fun sample(): Map<String, Any?> {
        val out = linkedMapOf<String, Any?>()

        probe(out, "tabs") { appContext.components.core.store.state.tabs.size }
        probe(out, "tabsPrivate") {
            appContext.components.core.store.state.tabs.count { it.content.private }
        }
        probe(out, "history") {
            runBlocking { PlacesHistoryStorage(appContext.applicationContext).getVisited().size }
        }
        probe(out, "bookmarks") {
            runBlocking {
                appContext.components.core.bookmarksStorage.getTree(BookmarkRoot.Mobile.id).getOrNull()?.children?.size
                    ?: 0
            }
        }
        probe(out, "logins") {
            runBlocking { appContext.components.core.passwordsStorage.list().size }
        }
        probe(out, "addresses") {
            runBlocking { appContext.components.core.autofillStorage.getAllAddresses().size }
        }
        probe(out, "creditCards") {
            runBlocking { appContext.components.core.autofillStorage.getAllCreditCards().size }
        }
        probe(out, "topSites") {
            runBlocking { appContext.components.core.pinnedSiteStorage.getPinnedSites().size }
        }
        probe(out, "downloads") { appContext.components.core.store.state.downloads.size }
        probe(out, "processId") { Process.myPid() }
        probe(out, "searchActive") { appContext.components.appStore.state.searchState.isSearchActive }
        probe(out, "voiceInputRequested") {
            appContext.components.appStore.state.voiceSearchState.isRequestingVoiceInput
        }
        probe(out, "voiceInputResult") {
            appContext.components.appStore.state.voiceSearchState.voiceInputResult != null
        }
        // Not app data, so `pm clear` never resets it. This is the one that actually leaked.
        probe(out, "launcherIcon") { launcherIconAlias() }

        return out
    }

    /**
     * Emit a sample on the structured stream.
     *
     * Consumers pair lifecycle phases by testId and compute their own transitions so the emitted facts remain stable.
     */
    fun record(phase: String, testId: String): Map<String, Any?> {
        val state = sample()
        runCatching {
            TestLogging.installed()
                .record(
                    "state",
                    mapOf("phase" to phase, "testId" to testId) + state,
                )
        }
            .onFailure { Log.i(TAG, "state probe failed at $phase: ${it.message}") }
        return state
    }

    fun assertIsolated(phase: String, testId: String) {
        val state = record(phase, testId)
        val violations = buildList {
            ZERO_COUNTS.forEach { key ->
                if (state[key] != 0) add("$key=${state[key]}")
            }
            FALSE_FLAGS.forEach { key ->
                if (state[key] != false) add("$key=${state[key]}")
            }
            if (state["launcherIcon"] != "default") {
                add("launcherIcon=${state["launcherIcon"]}")
            }
        }
        runCatching {
            TestLogging.installed()
                .record(
                    "isolation",
                    mapOf(
                        "phase" to phase,
                        "testId" to testId,
                        "verified" to violations.isEmpty(),
                        "violations" to violations.joinToString(","),
                    ),
                )
        }
        check(violations.isEmpty()) {
            "Harness state was not isolated at $phase for $testId: ${violations.joinToString()}"
        }
    }

    /** Which launcher alias is enabled, by name, or "default" when none has been overridden. */
    private fun launcherIconAlias(): String {
        val pm = appContext.packageManager
        val pkg = appContext.packageName
        val info =
            pm.getPackageInfo(
                pkg,
                PackageManager.GET_ACTIVITIES or PackageManager.MATCH_DISABLED_COMPONENTS,
            )
        val enabled =
            info.activities
                .orEmpty()
                .map { it.name }
                .filter { it.startsWith("$pkg.App") || it == "$pkg.AlternativeApp" }
                .filter {
                    pm.getComponentEnabledSetting(ComponentName(pkg, it)) ==
                        PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                }
        return enabled.firstOrNull()?.removePrefix("$pkg.") ?: "default"
    }

    /** Record a value, or the reason it could not be read. Never throws. */
    private inline fun probe(into: MutableMap<String, Any?>, key: String, read: () -> Any?) {
        into[key] = runCatching(read).getOrElse { "unreadable: ${it::class.simpleName}" }
    }

    private const val TAG = "StateProbe"
    private val ZERO_COUNTS =
        listOf("tabs", "tabsPrivate", "history", "bookmarks", "logins", "addresses", "creditCards", "downloads")
    private val FALSE_FLAGS = listOf("searchActive", "voiceInputRequested", "voiceInputResult")
}
