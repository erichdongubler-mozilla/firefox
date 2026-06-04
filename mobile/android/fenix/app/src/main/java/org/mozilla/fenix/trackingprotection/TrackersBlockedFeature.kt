/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.trackingprotection

import androidx.annotation.MainThread
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.withContext
import mozilla.components.browser.state.selector.selectedTab
import mozilla.components.browser.state.state.BrowserState
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.concept.engine.content.blocking.TrackingProtectionEvent
import mozilla.components.concept.engine.content.blocking.TrackingProtectionEvent.Companion.FINGERPRINTERS
import mozilla.components.concept.engine.content.blocking.TrackingProtectionEvent.Companion.SOCIAL
import mozilla.components.concept.engine.content.blocking.TrackingProtectionEvent.Companion.SUSPICIOUS_FINGERPRINTERS
import mozilla.components.concept.engine.content.blocking.TrackingProtectionEvent.Companion.TRACKERS
import mozilla.components.concept.engine.content.blocking.TrackingProtectionEvent.Companion.TRACKING_COOKIES
import mozilla.components.feature.protection.dashboard.TrackersBlockedCategory
import mozilla.components.feature.session.TrackingProtectionUseCases
import mozilla.components.lib.state.helpers.AbstractBinding
import mozilla.components.support.ktx.kotlinx.coroutines.flow.ifAnyChanged
import mozilla.components.support.utils.DefaultDateTimeProvider
import org.mozilla.fenix.R
import org.mozilla.fenix.components.AppStore
import org.mozilla.fenix.components.appstate.AppAction
import java.util.concurrent.TimeUnit
import mozilla.components.ui.icons.R as iconsR

/**
 * View-bound feature that dispatches tracker blocked changes from Gecko's blocked trackers database
 * to the [AppStore].
 *
 * @param browserStore The [BrowserStore] to observe for trackers blocked related events.
 * @param appStore The [AppStore] to dispatch actions to.
 * @param trackingProtectionUseCases Use case to fetch details about blocked trackers.
 * @param ioDispatcher The [CoroutineDispatcher] for database operations. Defaults to [Dispatchers.IO].
 */
class TrackersBlockedFeature(
    browserStore: BrowserStore,
    private val appStore: AppStore,
    private val trackingProtectionUseCases: TrackingProtectionUseCases,
    ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : AbstractBinding<BrowserState>(browserStore, ioDispatcher) {

    override suspend fun onState(flow: Flow<BrowserState>) {
        // The number of blocked trackers can change while a tab is being loaded in background.
        // Re-fetching this data whenever the blocked trackers callback fires (not always accurate)
        // allows for a dynamic update of the trackers blocked numbers.
        flow.mapNotNull { state -> state.selectedTab }
            .ifAnyChanged { tab ->
                arrayOf(tab.trackingProtection.blockedTrackers)
            }
            .collect {
                withContext(Dispatchers.Main) {
                    syncTrackersBlockedDetails()
                }
            }
    }

    @MainThread // the Gecko queries need a Looper. Easiest is to do the queries on the main thread.
    private fun syncTrackersBlockedDetails() {
        syncTotalTrackerBlocked()
        syncTrackingEvents()
    }

    private fun syncTotalTrackerBlocked() {
        trackingProtectionUseCases.fetchTotalTrackersBlocked(
            onSuccess = {
                appStore.dispatch(AppAction.UpdateTrackersBlockedCount(it))
            },
        )
    }

    private fun syncTrackingEvents() {
        val now = DefaultDateTimeProvider().currentTimeMillis()
        val oneWeekAgo = now - TimeUnit.DAYS.toMillis(7)
        trackingProtectionUseCases.fetchTrackingEvents(
            dateFrom = oneWeekAgo,
            dateTo = now,
            onSuccess = {
                appStore.dispatch(AppAction.UpdateTrackersBlockedThisWeek(it.blockedTrackersCategories))
            },
        )
    }

    private val List<TrackingProtectionEvent>?.blockedTrackersCategories: List<TrackersBlockedCategory>
        get() {
            val events = this ?: return emptyList()
            val trackerCategories = listOf(
                Triple(
                    R.string.etp_cookies_title,
                    iconsR.drawable.mozac_ic_cookies_24,
                    setOf(TRACKING_COOKIES),
                ),
                Triple(
                    R.string.etp_social_media_trackers_title,
                    iconsR.drawable.mozac_ic_social_tracker_24,
                    setOf(SOCIAL),
                ),
                Triple(
                    R.string.tracking_dashboard_fingerprinters_category_name,
                    iconsR.drawable.mozac_ic_fingerprinter_24,
                    setOf(FINGERPRINTERS, SUSPICIOUS_FINGERPRINTERS),
                ),
                Triple(
                    R.string.etp_tracking_content_title,
                    iconsR.drawable.mozac_ic_image_24,
                    setOf(TRACKERS),
                ),
            )
            return trackerCategories.map { (trackerNameRes, trackerIconRes, types) ->
                val count = events
                    .filter { it.type in types }
                    .sumOf { it.count }
                TrackersBlockedCategory(trackerIconRes, trackerNameRes, count)
            }
        }
}
