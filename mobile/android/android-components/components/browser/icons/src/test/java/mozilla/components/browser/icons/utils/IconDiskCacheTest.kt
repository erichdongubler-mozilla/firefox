/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.browser.icons.utils

import android.graphics.Bitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import mozilla.components.browser.icons.IconRequest
import mozilla.components.concept.engine.manifest.Size
import mozilla.components.support.test.any
import mozilla.components.support.test.mock
import mozilla.components.support.test.robolectric.testContext
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.anyInt
import org.mockito.Mockito.`when`
import org.robolectric.annotation.Config
import java.io.File
import java.io.OutputStream
import kotlin.test.assertNotNull

@RunWith(AndroidJUnit4::class)
class IconDiskCacheTest {
    @Before
    @After
    fun cleanUp() {
        File(testContext.cacheDir, CACHE_PARENT).deleteRecursively()
    }

    @Test
    fun `Resource cache files are stored under resources directory`() {
        val cache = IconDiskCache()
        val resource = IconRequest.Resource(
            url = "https://www.mozilla.org/icon64.png",
            sizes = listOf(Size(64, 64)),
            mimeType = "image/png",
            type = IconRequest.Resource.Type.FAVICON,
        )
        cache.putResources(testContext, IconRequest("https://www.mozilla.org", resources = listOf(resource)))

        assertTrue("Resource cache should live under cacheDir", File(cacheParent, RESOURCES_DIR).exists())
    }

    @Test
    fun `Icon cache files are stored under icons directory`() {
        val cache = IconDiskCache()
        val resource = IconRequest.Resource(
            url = "https://www.mozilla.org/icon64.png",
            type = IconRequest.Resource.Type.FAVICON,
        )
        val bitmap: Bitmap = mock()

        cache.putIconBitmap(testContext, resource, bitmap)

        assertTrue("Icon cache should live under cacheDir", File(cacheParent, ICONS_DIR).exists())
    }

    @Test
    fun `Writing and reading resources`() {
        val cache = IconDiskCache()

        val resources = listOf(
            IconRequest.Resource(
                url = "https://www.mozilla.org/icon64.png",
                sizes = listOf(Size(64, 64)),
                mimeType = "image/png",
                type = IconRequest.Resource.Type.FAVICON,
            ),
            IconRequest.Resource(
                url = "https://www.mozilla.org/icon128.png",
                sizes = listOf(Size(128, 128)),
                mimeType = "image/png",
                type = IconRequest.Resource.Type.FAVICON,
            ),
            IconRequest.Resource(
                url = "https://www.mozilla.org/icon128.png",
                sizes = listOf(Size(180, 180)),
                type = IconRequest.Resource.Type.APPLE_TOUCH_ICON,
            ),
        )

        val request = IconRequest("https://www.mozilla.org", resources = resources)
        cache.putResources(testContext, request)

        val restoredResources = cache.getResources(testContext, request)
        assertEquals(3, restoredResources.size)
        assertEquals(resources, restoredResources)
    }

    @Test
    @Config(sdk = [28])
    fun `Writing and reading bitmap bytes on SDK 28`() {
        val cache = IconDiskCache()

        val resource = IconRequest.Resource(
            url = "https://www.mozilla.org/icon64.png",
            sizes = listOf(Size(64, 64)),
            mimeType = "image/png",
            type = IconRequest.Resource.Type.FAVICON,
        )

        val bitmap: Bitmap = mock()
        `when`(bitmap.compress(any(), anyInt(), any())).thenAnswer {
            @Suppress("DEPRECATION")
            assertEquals(Bitmap.CompressFormat.WEBP, it.arguments[0] as Bitmap.CompressFormat)
            assertEquals(90, it.arguments[1] as Int) // Quality

            val stream = it.arguments[2] as OutputStream
            stream.write("Hello World".toByteArray())
            true
        }

        cache.putIconBitmap(testContext, resource, bitmap)

        val data = cache.getIconData(testContext, resource)
        assertNotNull(data)
        assertEquals("Hello World", String(data))
    }

    @Test
    fun `Writing and reading bitmap bytes`() {
        val cache = IconDiskCache()

        val resource = IconRequest.Resource(
            url = "https://www.mozilla.org/icon64.png",
            sizes = listOf(Size(64, 64)),
            mimeType = "image/png",
            type = IconRequest.Resource.Type.FAVICON,
        )

        val bitmap: Bitmap = mock()
        `when`(bitmap.compress(any(), anyInt(), any())).thenAnswer {
            assertEquals(Bitmap.CompressFormat.WEBP_LOSSY, it.arguments[0] as Bitmap.CompressFormat)
            assertEquals(90, it.arguments[1] as Int) // Quality

            val stream = it.arguments[2] as OutputStream
            stream.write("Hello World".toByteArray())
            true
        }

        cache.putIconBitmap(testContext, resource, bitmap)

        val data = cache.getIconData(testContext, resource)
        assertNotNull(data)
        assertEquals("Hello World", String(data))
    }

    private val cacheParent
        get() = File(testContext.cacheDir, CACHE_PARENT)

    companion object {
        private const val CACHE_PARENT = "mozac_browser_icons"
        private const val ICONS_DIR = "icons"
        private const val RESOURCES_DIR = "resources"
    }
}
