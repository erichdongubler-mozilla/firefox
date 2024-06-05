/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.debugsettings.listentopage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.PreviewLightDark
import java.util.Locale
import mozilla.components.compose.base.button.FilledButton
import mozilla.components.compose.base.textfield.TextField
import mozilla.components.feature.listentopage.ListenAction
import mozilla.components.feature.listentopage.ListenState
import mozilla.components.feature.listentopage.ListenStore
import mozilla.components.feature.listentopage.PlaybackState
import mozilla.components.feature.listentopage.listenReducer
import mozilla.components.feature.listentopage.ui.VoiceSelection
import org.mozilla.fenix.theme.FirefoxTheme

private const val MILLIS_PER_SECOND = 1000

/** Tools for listen to page. */
@Composable
fun ListenToPageTools(listenStore: ListenStore) {
    val listenState by listenStore.stateFlow.collectAsState()
    var voicesExpanded by remember { mutableStateOf(false) }
    var languageTag by remember { mutableStateOf(Locale.getDefault().toLanguageTag()) }

    Surface {
        Column(
            modifier = Modifier.padding(all = FirefoxTheme.layout.space.static200),
            verticalArrangement = Arrangement.spacedBy(FirefoxTheme.layout.space.static100),
        ) {
            Text(text = listenState.playbackState.describe())
            TextField(
                value = languageTag,
                onValueChange = { languageTag = it },
                placeholder = "en-US",
                errorText = "",
                modifier = Modifier.fillMaxWidth(),
                label = "Article language tag",
            )

            FilledButton(text = "Load voices for this language") {
                listenStore.dispatch(ListenAction.Session.StopRequested)
                listenStore.dispatch(ListenAction.Content.ContentReady(languageTag))
            }

            Text(
                text =
                    "Loaded ${listenState.voiceState.availableVoices.size} voice(s) for " +
                        "${listenState.languageTag ?: "nothing"}, ${listenState.voiceState.loadState}",
                style = FirefoxTheme.typography.caption,
            )

            FilledButton(text = "Open voice selection") {
                voicesExpanded = !voicesExpanded
            }
            VoiceSelection(
                expanded = voicesExpanded,
                availableVoices = listenState.voiceState.availableVoices,
                selectedVoice = listenState.voiceState.selectedVoice,
                onVoiceClick = { listenStore.dispatch(ListenAction.Voices.VoiceSelected(it)) },
                onDismissRequest = { voicesExpanded = !voicesExpanded },
            )
        }
    }
}

private fun PlaybackState.describe(): String {
    val duration = chunk.durationMs?.let { "${it / MILLIS_PER_SECOND}s" } ?: "unknown"

    return "${phase.name}, chunk ${chunk.index} at ${positionMs / MILLIS_PER_SECOND}s of $duration"
}

@PreviewLightDark
@Composable
private fun PreviewListenToPageTools() {
    FirefoxTheme {
        ListenToPageTools(listenStore = ListenStore(initialState = ListenState(), ::listenReducer))
    }
}
