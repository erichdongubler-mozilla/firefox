/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.usecases

import io.mockk.every
import io.mockk.mockk
import io.mockk.spyk
import io.mockk.verify
import mozilla.components.browser.state.action.ShareResourceAction
import mozilla.components.browser.state.state.BrowserState
import mozilla.components.browser.state.state.createTab
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.concept.engine.prompt.ShareData
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mozilla.fenix.components.usecases.fake.FakeShareSheetLauncher
import org.mozilla.fenix.utils.Settings
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class ShareUseCasesTest {

    private lateinit var shareSheetLauncher: FakeShareSheetLauncher
    private lateinit var settings: Settings
    private lateinit var browserStore: BrowserStore
    private lateinit var shareUseCases: ShareUseCases
    private var navigatedToShareFragment = false

    private val navigateToShareFragment: () -> Unit = { navigatedToShareFragment = true }

    @Before
    fun setUp() {
        shareSheetLauncher = FakeShareSheetLauncher()
        settings = mockk(relaxed = true) {
            every { nativeShareSheetEnabled } returns true
        }
        browserStore = BrowserStore(
            BrowserState(tabs = listOf(createTab(url = "https://mozilla.org", id = "123"))),
        )
        shareUseCases = ShareUseCases(
            browserStore = browserStore,
            shareSheetLauncher = shareSheetLauncher,
            settings = settings,
        )
        navigatedToShareFragment = false
    }

    @Test
    fun `GIVEN current tab is a PDF WHEN shareUrl is called THEN PDF share action is dispatched`() {
        val pdfTab = createTab(url = "https://mozilla.org/file.pdf", id = "pdf").let {
            it.copy(content = it.content.copy(isPdf = true))
        }
        val pdfStore = spyk(BrowserStore(BrowserState(tabs = listOf(pdfTab))))
        shareUseCases = ShareUseCases(pdfStore, shareSheetLauncher, settings)

        shareUseCases.shareUrl(
            id = "pdf",
            url = "https://mozilla.org/file.pdf",
            title = "PDF",
            navigateToShareFragment = navigateToShareFragment,
        )

        verify { pdfStore.dispatch(any<ShareResourceAction.AddShareAction>()) }
        assertTrue(shareSheetLauncher.urlShares.isEmpty())
        assertFalse(navigatedToShareFragment)
    }

    @Config(sdk = [34])
    @Test
    fun `GIVEN a single url WHEN shareUrl is called THEN system share sheet is launched`() {
        shareUseCases.shareUrl(
            id = "123",
            url = "https://mozilla.org",
            title = "Mozilla",
            isPrivate = false,
            isCustomTab = false,
            navigateToShareFragment = navigateToShareFragment,
        )

        assertEquals(
            listOf(
                FakeShareSheetLauncher.UrlShare(
                    id = "123",
                    longUrl = "https://mozilla.org",
                    title = "Mozilla",
                    isPrivate = false,
                    isCustomTab = false,
                ),
            ),
            shareSheetLauncher.urlShares,
        )
        assertFalse(navigatedToShareFragment)
    }

    @Config(sdk = [34])
    @Test
    fun `GIVEN native share sheet is disabled WHEN shareUrl is called THEN navigate to share fragment`() {
        every { settings.nativeShareSheetEnabled } returns false

        shareUseCases.shareUrl(
            id = "123",
            url = "https://mozilla.org",
            title = "Mozilla",
            navigateToShareFragment = navigateToShareFragment,
        )

        assertTrue(shareSheetLauncher.urlShares.isEmpty())
        assertTrue(navigatedToShareFragment)
    }

    @Config(sdk = [33])
    @Test
    fun `GIVEN native share sheet is not supported WHEN shareUrl is called THEN navigate to share fragment`() {
        shareUseCases.shareUrl(
            id = "123",
            url = "https://mozilla.org",
            title = "Mozilla",
            navigateToShareFragment = navigateToShareFragment,
        )

        assertTrue(shareSheetLauncher.urlShares.isEmpty())
        assertTrue(navigatedToShareFragment)
    }

    @Config(sdk = [34])
    @Test
    fun `GIVEN a list of share data and subject WHEN shareItems is called THEN system share sheet is launched`() {
        val items = listOf(ShareData(url = "https://mozilla.org", title = "Mozilla"))

        shareUseCases.shareItems(
            items = items,
            subject = "My collection",
            navigateToShareFragment = navigateToShareFragment,
        )

        assertEquals(
            listOf(
                FakeShareSheetLauncher.ItemsShare(
                    items = items,
                    isPrivate = false,
                    subject = "My collection",
                ),
            ),
            shareSheetLauncher.itemsShares,
        )
    }

    @Config(sdk = [34])
    @Test
    fun `GIVEN native share sheet is disabled WHEN shareItems is called THEN navigate to share fragment`() {
        every { settings.nativeShareSheetEnabled } returns false

        shareUseCases.shareItems(
            items = listOf(ShareData(url = "https://mozilla.org")),
            navigateToShareFragment = navigateToShareFragment,
        )

        assertTrue(shareSheetLauncher.itemsShares.isEmpty())
        assertTrue(navigatedToShareFragment)
    }

    @Config(sdk = [33])
    @Test
    fun `GIVEN native share sheet is not supported WHEN shareItems is called THEN navigate to share fragment`() {
        shareUseCases.shareItems(
            items = listOf(ShareData(url = "https://mozilla.org")),
            navigateToShareFragment = navigateToShareFragment,
        )

        assertTrue(shareSheetLauncher.itemsShares.isEmpty())
        assertTrue(navigatedToShareFragment)
    }
}
