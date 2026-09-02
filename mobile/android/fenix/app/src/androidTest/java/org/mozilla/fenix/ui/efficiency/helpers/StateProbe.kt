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

    private val contributors: List<StateContributor> =
        listOf(
            contributor(
                name = "browserStore",
                fields = setOf("tabs", "tabsPrivate", "downloads"),
                captureCost = StateCaptureCost.IN_MEMORY,
            ) {
                mapOf(
                    "tabs" to observe { appContext.components.core.store.state.tabs.size },
                    "tabsPrivate" to
                        observe {
                            appContext.components.core.store.state.tabs.count { it.content.private }
                        },
                    "downloads" to observe { appContext.components.core.store.state.downloads.size },
                )
            },
            contributor(
                name = "places",
                fields = setOf("history", "bookmarks", "topSites"),
                captureCost = StateCaptureCost.STORAGE_IO,
                sensitivity = StateSensitivity.AGGREGATE_ONLY,
            ) {
                mapOf(
                    "history" to
                        observe {
                            runBlocking { PlacesHistoryStorage(appContext.applicationContext).getVisited().size }
                        },
                    "bookmarks" to
                        observe {
                            runBlocking {
                                appContext.components.core.bookmarksStorage
                                    .getTree(BookmarkRoot.Mobile.id)
                                    .getOrNull()
                                    ?.children
                                    ?.size ?: 0
                            }
                        },
                    "topSites" to
                        observe {
                            runBlocking { appContext.components.core.pinnedSiteStorage.getPinnedSites().size }
                        },
                )
            },
            contributor(
                name = "savedUserData",
                fields = setOf("logins", "addresses", "creditCards"),
                captureCost = StateCaptureCost.STORAGE_IO,
                sensitivity = StateSensitivity.AGGREGATE_ONLY,
            ) {
                mapOf(
                    "logins" to
                        observe {
                            runBlocking { appContext.components.core.passwordsStorage.list().size }
                        },
                    "addresses" to
                        observe {
                            runBlocking { appContext.components.core.autofillStorage.getAllAddresses().size }
                        },
                    "creditCards" to
                        observe {
                            runBlocking { appContext.components.core.autofillStorage.getAllCreditCards().size }
                        },
                )
            },
            contributor(
                name = "isolationStorage",
                fields = setOf("sitePermissions", "savedSessions"),
                captureCost = StateCaptureCost.STORAGE_IO,
                sensitivity = StateSensitivity.AGGREGATE_ONLY,
            ) {
                mapOf(
                    "sitePermissions" to
                        observe {
                            runBlocking {
                                appContext.components.core.geckoSitePermissionsStorage.all().size
                            }
                        },
                    "savedSessions" to
                        observe {
                            appContext.components.core.sessionStorage.restore()?.tabs?.size ?: 0
                        },
                )
            },
            contributor(
                name = "appRuntime",
                fields = setOf("searchActive", "voiceInputRequested", "voiceInputResult"),
                captureCost = StateCaptureCost.IN_MEMORY,
            ) {
                mapOf(
                    "searchActive" to observe { appContext.components.appStore.state.searchState.isSearchActive },
                    "voiceInputRequested" to
                        observe {
                            appContext.components.appStore.state.voiceSearchState.isRequestingVoiceInput
                        },
                    "voiceInputResult" to
                        observe {
                            appContext.components.appStore.state.voiceSearchState.voiceInputResult != null
                        },
                )
            },
            contributor(
                name = "launcher",
                fields = setOf("launcherIcon"),
                captureCost = StateCaptureCost.PACKAGE_MANAGER,
            ) {
                mapOf("launcherIcon" to observe(::launcherIconAlias))
            },
            contributor(
                name = "executionIdentity",
                fields = setOf("processId"),
                captureCost = StateCaptureCost.IN_MEMORY,
            ) {
                mapOf("processId" to observe(Process::myPid))
            },
        )

    /** One sample of everything worth watching. Ordered so the diff reads consistently. */
    fun sample(): Map<String, Any?> = snapshot().values

    fun snapshot(): StateSnapshot {
        val contributions = contributors.map { contributor ->
            val captured =
                runCatching(contributor::capture).getOrElse { failure ->
                    contributor.fields.associateWith {
                        "unreadable: ${failure::class.simpleName}"
                    }
                }
            val values =
                contributor.fields.associateWith { field ->
                    if (field in captured) captured[field] else "unreadable: MissingValue"
                }
            StateContribution(
                name = contributor.name,
                schemaVersion = contributor.schemaVersion,
                captureCost = contributor.captureCost,
                sensitivity = contributor.sensitivity,
                values = values,
            )
        }
        val values = contributions.flatMap { it.values.entries }
        check(values.size == values.map { it.key }.toSet().size) {
            "State contributors declare duplicate field ownership"
        }
        return StateSnapshot(
            values = values.associate { it.toPair() },
            contributions = contributions,
        )
    }

    fun descriptors(): List<StateContributor> = contributors.toList()

    /**
     * Emit a sample on the structured stream.
     *
     * Consumers pair lifecycle phases by testId and compute their own transitions so the emitted facts remain stable.
     */
    fun record(phase: String, testId: String): Map<String, Any?> {
        val snapshot = snapshot()
        val state = snapshot.values
        runCatching {
            val reporter = TestLogging.installed()
            reporter.record(
                "state",
                mapOf("phase" to phase, "testId" to testId) + state,
            )
            reporter.record(
                "stateSnapshot",
                mapOf(
                    "schemaVersion" to SNAPSHOT_SCHEMA_VERSION,
                    "phase" to phase,
                    "testId" to testId,
                    "contributors" to snapshot.contributions.map(StateContribution::asRecord),
                ),
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

    private fun contributor(
        name: String,
        fields: Set<String>,
        captureCost: StateCaptureCost,
        sensitivity: StateSensitivity = StateSensitivity.NONE,
        capture: () -> Map<String, Any?>,
    ): StateContributor =
        object : StateContributor {
            override val name = name
            override val schemaVersion = 1
            override val fields = fields
            override val captureCost = captureCost
            override val sensitivity = sensitivity

            override fun capture(): Map<String, Any?> = capture()
        }

    private inline fun observe(read: () -> Any?): Any? =
        runCatching(read).getOrElse { "unreadable: ${it::class.simpleName}" }

    private const val TAG = "StateProbe"
    private const val SNAPSHOT_SCHEMA_VERSION = 1
    private val ZERO_COUNTS =
        listOf(
            "tabs",
            "tabsPrivate",
            "history",
            "bookmarks",
            "logins",
            "addresses",
            "creditCards",
            "sitePermissions",
            "savedSessions",
            "downloads",
        )
    private val FALSE_FLAGS = listOf("searchActive", "voiceInputRequested", "voiceInputResult")
}
