/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.downloads.listscreen

import androidx.annotation.VisibleForTesting
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.tooling.preview.PreviewParameter
import mozilla.components.compose.base.button.TextButton
import org.mozilla.fenix.R
import org.mozilla.fenix.theme.FirefoxTheme
import org.mozilla.fenix.theme.Theme
import org.mozilla.fenix.theme.ThemeProvider
import java.io.File

/**
* This dialog is used to prompt the user to rename the downloaded file.
* It provides options to confirm or cancel the rename.
*
* @param originalFileName The original download file name to be renamed.
* @param onConfirmSave Callback invoked when the user confirms the rename.
* @param onCancel Callback invoked when the user cancels.
*/
@Composable
fun DownloadRenameDialog(
    originalFileName: String,
    onConfirmSave: (String) -> Unit,
    onCancel: () -> Unit,
) {
    var fileNameState by remember(originalFileName) {
        val end = File(originalFileName).nameWithoutExtension.length
        mutableStateOf(
            TextFieldValue(
                text = originalFileName,
                selection = TextRange(0, end),
            ),
        )
    }

    AlertDialog(
        onDismissRequest = onCancel,
        title = {
            Text(
                text = stringResource(
                    R.string.download_rename_dialog_title,
                ),
                style = FirefoxTheme.typography.headline5,
            )
        },
        text = {
            OutlinedTextField(
                value = fileNameState,
                onValueChange = { fileNameState = it },
                label = {
                    Text(
                        text = stringResource(
                            id = R.string.download_rename_dialog_label,
                        ),
                    )
                },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(DownloadsListTestTag.RENAME_DIALOG_TEXT_FIELD),
            )
        },
        confirmButton = {
            TextButton(
                text = stringResource(id = R.string.download_rename_dialog_confirm_button),
                enabled = enableConfirmButton(originalFileName, fileNameState.text.trim()),
                onClick = { onConfirmSave(fileNameState.text.trim()) },
                modifier = Modifier.testTag(
                    DownloadsListTestTag.RENAME_DIALOG_CONFIRM_BUTTON,
                ),
            )
        },
        dismissButton = {
            TextButton(
                text = stringResource(id = R.string.download_rename_dialog_cancel_button),
                onClick = { onCancel() },
                modifier = Modifier.testTag(
                    DownloadsListTestTag.RENAME_DIALOG_CANCEL_BUTTON,
                ),
            )
        },
    )
}

/**
 * This determines whether to enable the confirmation button based on if
 * the new file name differs and if the new base file name is not blank.
 *
 * @param originalFileName The original download file name to be renamed.
 * @param newFileName The proposed new file name.
 */
@VisibleForTesting
internal fun enableConfirmButton(
    originalFileName: String,
    newFileName: String,
): Boolean {
    val base = File(newFileName).nameWithoutExtension
    return base.isNotBlank() && newFileName != originalFileName
}

@Preview
@Composable
private fun RenameDownloadFileDialogPreview(
    @PreviewParameter(ThemeProvider::class) theme: Theme,
) {
    FirefoxTheme(theme) {
        DownloadRenameDialog(
            originalFileName = "README.md",
            onConfirmSave = {},
            onCancel = {},
        )
    }
}

@Preview
@Composable
private fun RenameDownloadFileDialogMultipleExtensionsPreview(
    @PreviewParameter(ThemeProvider::class) theme: Theme,
) {
    FirefoxTheme(theme) {
        DownloadRenameDialog(
            originalFileName = "original.test.name.jpg",
            onConfirmSave = {},
            onCancel = {},
        )
    }
}
