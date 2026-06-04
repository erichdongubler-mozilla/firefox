/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.trackingprotection

import android.app.Dialog
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.unit.dp
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat.Type.systemBars
import androidx.fragment.compose.content
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import mozilla.components.compose.base.BottomSheetHandle
import mozilla.components.feature.protection.dashboard.TrackerProtectionDashboard
import mozilla.components.lib.state.ext.observeAsComposableState
import mozilla.components.support.base.feature.ViewBoundFeatureWrapper
import org.mozilla.fenix.R
import org.mozilla.fenix.ext.requireComponents
import org.mozilla.fenix.ext.runIfFragmentIsAttached
import org.mozilla.fenix.theme.FirefoxTheme
import com.google.android.material.R as materialR

/**
 * [BottomSheetDialog] showing the global protections dashboard.
 */
class ProtectionsDashboard : BottomSheetDialogFragment() {
    private val trackersBlockedFeature = ViewBoundFeatureWrapper<TrackersBlockedFeature>()

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog =
        (super.onCreateDialog(savedInstanceState) as BottomSheetDialog).apply {
            setOnShowListener {
                runIfFragmentIsAttached {
                    val bottomSheet = findViewById<FrameLayout>(materialR.id.design_bottom_sheet)
                    bottomSheet?.let {
                        ViewCompat.setOnApplyWindowInsetsListener(it) { view, insets ->
                            val systemBarInsets = insets.getInsets(systemBars())
                            view.setPadding(0, systemBarInsets.top, 0, systemBarInsets.bottom)
                            insets
                        }
                    }
                    bottomSheet?.setBackgroundResource(R.drawable.bottom_sheet_with_top_rounded_corners)

                    behavior.peekHeight = context.resources.displayMetrics.heightPixels
                    behavior.state = BottomSheetBehavior.STATE_EXPANDED
                }
            }
        }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ) = content {
        val appStore = requireComponents.appStore
        val trackerBlockedThisWeek by appStore.observeAsComposableState { state ->
            state.trackersBlockedThisWeek
        }

        FirefoxTheme {
            BackHandler {
                dismiss()
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(
                        MaterialTheme.shapes.extraLarge.copy(
                            bottomStart = CornerSize(0.dp),
                            bottomEnd = CornerSize(0.dp),
                        ),
                    )
                    .semantics { isTraversalGroup = true },
            ) {
                TrackerProtectionDashboard(
                    modifier = Modifier
                        .fillMaxWidth()
                        .semantics { traversalIndex = 0f },
                    appName = stringResource(R.string.firefox),
                    totalTrackersBlocked = trackerBlockedThisWeek.sumOf { it.count },
                    sitesCount = 0, // We don't yet have an API to get this data from.
                    dataSavedMB = null, // We don't yet have an API to get this data from.
                    trackersBlocked = trackerBlockedThisWeek,
                    contentPadding = PaddingValues(
                        top = FirefoxTheme.layout.size.static300, // handle height + its top padding
                    ),
                )

                BottomSheetHandle(
                    onRequestDismiss = ::dismiss,
                    contentDescription = "",
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = FirefoxTheme.layout.size.static200)
                        .semantics { traversalIndex = 1f },
                )
            }
        }
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        trackersBlockedFeature.set(
            feature = TrackersBlockedFeature(
                browserStore = requireComponents.core.store,
                appStore = requireComponents.appStore,
                trackingProtectionUseCases = requireComponents.useCases.trackingProtectionUseCases,
            ),
            owner = viewLifecycleOwner,
            view = view,
        )
    }
}
