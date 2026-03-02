/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.tabstray.ui.tabitems

import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.PreviewLightDark
import androidx.compose.ui.tooling.preview.PreviewParameter
import androidx.compose.ui.tooling.preview.PreviewParameterProvider
import androidx.compose.ui.unit.dp
import mozilla.components.browser.state.state.createTab
import mozilla.components.compose.base.RadioCheckmark
import mozilla.components.compose.base.RadioCheckmarkColors
import mozilla.components.concept.engine.utils.ABOUT_HOME_URL
import mozilla.components.support.base.utils.MAX_URI_LENGTH
import mozilla.components.support.utils.ext.isLandscape
import org.mozilla.fenix.R
import org.mozilla.fenix.compose.SwipeToDismissBox2
import org.mozilla.fenix.compose.SwipeToDismissState2
import org.mozilla.fenix.compose.TabThumbnail
import org.mozilla.fenix.compose.thumbnailImageData
import org.mozilla.fenix.tabstray.TabsTrayTestTag
import org.mozilla.fenix.tabstray.data.TabsTrayItem
import org.mozilla.fenix.tabstray.ext.toDisplayTitle
import org.mozilla.fenix.tabstray.ui.sharedTabTransition
import org.mozilla.fenix.theme.FirefoxTheme
import mozilla.components.ui.icons.R as iconsR

/**
 * The padding around the thumbnail inside a tab grid item.
 */
val GridItemThumbnailPadding = 4.dp

private val TabContentCardShape = RoundedCornerShape(16.dp)
private val ThumbnailShape = RoundedCornerShape(
    topStart = 4.dp,
    topEnd = 4.dp,
    bottomStart = 12.dp,
    bottomEnd = 12.dp,
)
private val TabHeaderIconTouchTargetSize = 40.dp
private val TabHeaderFaviconSize = 12.dp

/**
 * Tab grid item used to display a tab that supports clicks,
 * long clicks, multiple selection, and media controls.
 *
 * @param tab The given tab to render as a grid item.
 * @param thumbnailSizePx The size of the tab's thumbnail in pixels.
 * @param isSelected Indicates if the item should be rendered as selected.
 * @param multiSelectionEnabled Indicates if the item should be rendered with multi selection options,
 * enabled.
 * @param multiSelectionSelected Indicates if the item should be rendered as multi selection selected
 * option.
 * @param shouldClickListen Whether the item should stop listening to click events.
 * @param swipeState The swipe state of the item.
 * @param onCloseClick Invoked when the close button is clicked.
 * @param onClick Invoked when the item is clicked.
 * @param onLongClick Invoked when the item is long clicked.
 */
@Composable
fun TabGridTabItem(
    tab: TabsTrayItem.Tab,
    thumbnailSizePx: Int = 50,
    isSelected: Boolean = false,
    multiSelectionEnabled: Boolean = false,
    multiSelectionSelected: Boolean = false,
    shouldClickListen: Boolean = true,
    swipeState: SwipeToDismissState2,
    onCloseClick: (TabsTrayItem.Tab) -> Unit,
    onClick: (TabsTrayItem) -> Unit,
    onLongClick: ((TabsTrayItem) -> Unit)? = null,
) {
    SwipeToDismissBox2(
        state = swipeState,
        backgroundContent = {},
        onItemDismiss = {
            onCloseClick(tab)
        },
    ) {
        TabContent(
            tab = tab,
            thumbnailSize = thumbnailSizePx,
            isSelected = isSelected,
            multiSelectionEnabled = multiSelectionEnabled,
            multiSelectionSelected = multiSelectionSelected,
            shouldClickListen = shouldClickListen,
            onCloseClick = onCloseClick,
            onClick = onClick,
            onLongClick = onLongClick,
        )
    }
}

@Composable
private fun TabContent(
    tab: TabsTrayItem.Tab,
    thumbnailSize: Int,
    isSelected: Boolean = false,
    multiSelectionEnabled: Boolean = false,
    multiSelectionSelected: Boolean = false,
    shouldClickListen: Boolean = true,
    onCloseClick: (TabsTrayItem.Tab) -> Unit,
    onClick: (TabsTrayItem) -> Unit,
    onLongClick: ((TabsTrayItem) -> Unit)? = null,
) {
    Box(
        modifier = Modifier
            .wrapContentSize()
            .testTag(TabsTrayTestTag.TAB_ITEM_ROOT),
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .clip(TabContentCardShape)
                .tabItemClickable(
                    tab = tab,
                    enabled = shouldClickListen,
                    onClick = onClick,
                    onLongClick = onLongClick,
                )
                .semantics {
                    selected = isSelected
                },
            shape = TabContentCardShape,
            colors = CardDefaults.cardColors(
                containerColor = if (isSelected) {
                    MaterialTheme.colorScheme.primary
                } else if (multiSelectionSelected) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.surfaceContainerHighest
                },
            ),
        ) {
            Column {
                Header(
                    tab = tab,
                    isSelected = isSelected,
                    multiSelectionEnabled = multiSelectionEnabled,
                    multiSelectionSelected = multiSelectionSelected,
                    onCloseClick = onCloseClick,
                )

                Card(
                    modifier = Modifier
                        .aspectRatio(gridItemAspectRatio)
                        .padding(horizontal = GridItemThumbnailPadding),
                    shape = ThumbnailShape,
                ) {
                    Thumbnail(
                        tab = tab,
                        size = thumbnailSize,
                    )
                }

                Spacer(modifier = Modifier.height(GridItemThumbnailPadding))
            }
        }
    }
}

@Composable
private fun Header(
    tab: TabsTrayItem.Tab,
    isSelected: Boolean,
    multiSelectionEnabled: Boolean,
    multiSelectionSelected: Boolean,
    onCloseClick: (TabsTrayItem.Tab) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .wrapContentHeight(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spacer(modifier = Modifier.width(FirefoxTheme.layout.space.static50 + GridItemThumbnailPadding))

        TabIcon(
            tab = tab,
            isSelected = isSelected,
        )

        Spacer(modifier = Modifier.width(4.dp))

        Text(
            text = tab.tabData.toDisplayTitle().take(MAX_URI_LENGTH),
            modifier = Modifier.weight(1f),
            color = if (isSelected) {
                MaterialTheme.colorScheme.onPrimary
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = FirefoxTheme.typography.caption,
        )

        Spacer(modifier = Modifier.width(FirefoxTheme.layout.space.static50))

        UtilityIcon(
            tab = tab,
            isSelected = isSelected,
            multiSelectionEnabled = multiSelectionEnabled,
            multiSelectionSelected = multiSelectionSelected,
            onCloseClick = onCloseClick,
        )
    }
}

@Composable
private fun TabIcon(
    tab: TabsTrayItem.Tab,
    isSelected: Boolean,
) {
    val icon = tab.tabData.content.icon
    if (icon != null) {
        icon.prepareToDraw()
        Image(
            bitmap = icon.asImageBitmap(),
            contentDescription = null,
            modifier = Modifier.size(TabHeaderFaviconSize),
        )
    } else if (tab.tabData.content.url == ABOUT_HOME_URL) {
        Image(
            painter = painterResource(id = R.drawable.ic_firefox),
            contentDescription = null,
            modifier = Modifier.size(TabHeaderFaviconSize),
        )
    } else {
        Icon(
            painter = painterResource(id = iconsR.drawable.mozac_ic_globe_24),
            contentDescription = null,
            modifier = Modifier.size(TabHeaderFaviconSize),
            tint = if (isSelected) {
                MaterialTheme.colorScheme.onPrimary
            } else {
                MaterialTheme.colorScheme.onSurface
            },
        )
    }
}

@Composable
private fun UtilityIcon(
    tab: TabsTrayItem.Tab,
    isSelected: Boolean,
    multiSelectionEnabled: Boolean,
    multiSelectionSelected: Boolean,
    onCloseClick: (TabsTrayItem.Tab) -> Unit,
) {
    if (!multiSelectionEnabled) {
        CloseButton(
            tab = tab,
            isSelected = isSelected,
            onCloseClick = onCloseClick,
        )
    } else {
        Box(
            modifier = Modifier.size(TabHeaderIconTouchTargetSize),
            contentAlignment = Alignment.Center,
        ) {
            RadioCheckmark(
                isSelected = multiSelectionSelected,
                colors = if (isSelected) {
                    RadioCheckmarkColors.default(
                        backgroundColor = MaterialTheme.colorScheme.onPrimary,
                        checkmarkColor = MaterialTheme.colorScheme.primary,
                        borderColor = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    RadioCheckmarkColors.default()
                },
            )
        }
    }
}

@Composable
private fun CloseButton(
    tab: TabsTrayItem.Tab,
    isSelected: Boolean,
    onCloseClick: (TabsTrayItem.Tab) -> Unit,
) {
    IconButton(
        modifier = Modifier
            .size(TabHeaderIconTouchTargetSize)
            .testTag(TabsTrayTestTag.TAB_ITEM_CLOSE),
        onClick = {
            onCloseClick(tab)
        },
    ) {
        Icon(
            painter = painterResource(id = iconsR.drawable.mozac_ic_cross_20),
            contentDescription = stringResource(
                id = R.string.close_tab_title,
                tab.tabData.toDisplayTitle(),
            ),
            tint = if (isSelected) {
                MaterialTheme.colorScheme.onPrimary
            } else {
                MaterialTheme.colorScheme.onSurface
            },
        )
    }
}

/**
 * The width to height ratio of the tab grid item. In landscape mode, the width to height ratio is
 * 2:1 and in portrait mode, the width to height ratio is 4:5.
 */
val gridItemAspectRatio: Float
    @Composable
    @ReadOnlyComposable
    get() = if (LocalContext.current.isLandscape()) {
        2f
    } else {
        0.8f
    }

/**
 * Thumbnail specific for the [TabGridTabItem], which can be selected.
 *
 * @param tab Tab, containing the thumbnail to be displayed.
 * @param size Size of the thumbnail.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun Thumbnail(
    tab: TabsTrayItem.Tab,
    size: Int,
) {
    TabThumbnail(
        tabThumbnailImageData = tab.tabData.thumbnailImageData(),
        thumbnailSizePx = size,
        modifier = Modifier
            .semantics(mergeDescendants = true) {
                testTag = TabsTrayTestTag.TAB_ITEM_THUMBNAIL
            }
            .sharedTabTransition(tabId = tab.id)
            .fillMaxSize(),
        shape = ThumbnailShape,
    )
}

private data class TabGridItemPreviewState(
    val isSelected: Boolean,
    val multiSelectionEnabled: Boolean,
    val multiSelectionSelected: Boolean,
    val url: String = "www.mozilla.org",
    val title: String = "Mozilla Domain",
)

private class TabGridItemParameterProvider : PreviewParameterProvider<TabGridItemPreviewState> {
    override val values: Sequence<TabGridItemPreviewState>
        get() = sequenceOf(
            TabGridItemPreviewState(
                isSelected = false,
                multiSelectionEnabled = false,
                multiSelectionSelected = false,
            ),
            TabGridItemPreviewState(
                isSelected = true,
                multiSelectionEnabled = false,
                multiSelectionSelected = false,
            ),
            TabGridItemPreviewState(
                isSelected = false,
                multiSelectionEnabled = true,
                multiSelectionSelected = false,
            ),
            TabGridItemPreviewState(
                isSelected = true,
                multiSelectionEnabled = true,
                multiSelectionSelected = false,
            ),
            TabGridItemPreviewState(
                isSelected = false,
                multiSelectionEnabled = true,
                multiSelectionSelected = true,
            ),
            TabGridItemPreviewState(
                isSelected = true,
                multiSelectionEnabled = true,
                multiSelectionSelected = true,
            ),
            TabGridItemPreviewState(
                isSelected = false,
                multiSelectionEnabled = false,
                multiSelectionSelected = false,
                url = "www.google.com/superlongurl",
                title = "Super super super super super super super super long title",
            ),
        )
}

@Composable
@PreviewLightDark
private fun TabGridItemPreview(
    @PreviewParameter(TabGridItemParameterProvider::class) tabGridItemState: TabGridItemPreviewState,
) {
    FirefoxTheme {
        TabContent(
            tab = TabsTrayItem.Tab(
                tabData = createTab(
                    url = tabGridItemState.url,
                    title = tabGridItemState.title,
                ),
            ),
            thumbnailSize = 108,
            isSelected = tabGridItemState.isSelected,
            onCloseClick = {},
            onClick = {},
            multiSelectionEnabled = tabGridItemState.multiSelectionEnabled,
            multiSelectionSelected = tabGridItemState.multiSelectionSelected,
        )
    }
}
