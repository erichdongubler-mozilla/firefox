/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.browser.thumbnails.utils

import android.graphics.Bitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import mozilla.components.concept.base.images.ImageLoadRequest
import mozilla.components.concept.base.images.ImageSaveRequest
import mozilla.components.support.test.any
import mozilla.components.support.test.mock
import mozilla.components.support.test.robolectric.testContext
import org.junit.After
import org.junit.Assert
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.`when`
import java.io.File
import java.io.OutputStream
import kotlin.test.assertNotNull

@RunWith(AndroidJUnit4::class)
class ThumbnailDiskCacheTest {

    @Before
    @After
    fun cleanUp() {
        File(testContext.cacheDir, CACHE_DIR).deleteRecursively()
        File(testContext.noBackupFilesDir, CACHE_DIR).deleteRecursively()
    }

    @Test
    fun `Cache files are stored under noBackupFilesDir, not cacheDir`() {
        val cache = ThumbnailDiskCache()
        val request = ImageLoadRequest("123", 100, false)
        val bitmap: Bitmap = mock()

        cache.putThumbnailBitmap(testContext, ImageSaveRequest(request.id, request.isPrivate), bitmap)

        val newDir = File(File(testContext.noBackupFilesDir, CACHE_DIR), "thumbnails")
        val legacyDir = File(File(testContext.cacheDir, CACHE_DIR), "thumbnails")

        assertTrue("Cache directory should exist under cacheDir", newDir.exists())
        assertFalse("Cache directory must not be created under cacheDir", legacyDir.exists())
    }

    @Test
    fun `Writing and reading bitmap bytes for private cache`() {
        val cache = ThumbnailDiskCache(isPrivate = true)
        val request = ImageLoadRequest("123", 100, true)

        val bitmap: Bitmap = mock()
        `when`(bitmap.compress(any(), ArgumentMatchers.anyInt(), any())).thenAnswer {
            Assert.assertEquals(
                Bitmap.CompressFormat.JPEG,
                it.arguments[0] as Bitmap.CompressFormat,
            )
            Assert.assertEquals(90, it.arguments[1] as Int) // Quality

            val stream = it.arguments[2] as OutputStream
            stream.write("Hello World".toByteArray())
            true
        }

        cache.putThumbnailBitmap(testContext, ImageSaveRequest(request.id, request.isPrivate), bitmap)

        val data = cache.getThumbnailData(testContext, request)
        assertNotNull(data)
        Assert.assertEquals("Hello World", String(data))
    }

    @Test
    fun `Removing bitmap from disk cache`() {
        val cache = ThumbnailDiskCache()
        val request = ImageLoadRequest("123", 100, false)
        val bitmap: Bitmap = mock()

        cache.putThumbnailBitmap(testContext, ImageSaveRequest(request.id, request.isPrivate), bitmap)
        var data = cache.getThumbnailData(testContext, request)
        assertNotNull(data)

        cache.removeThumbnailData(testContext, request.id)
        data = cache.getThumbnailData(testContext, request)
        assertNull(data)
    }

    @Test
    fun `Clearing bitmap from disk cache`() {
        val cache = ThumbnailDiskCache()
        val request = ImageLoadRequest("123", 100, false)
        val bitmap: Bitmap = mock()

        cache.putThumbnailBitmap(testContext, ImageSaveRequest(request.id, request.isPrivate), bitmap)
        var data = cache.getThumbnailData(testContext, request)
        assertNotNull(data)

        cache.clear(testContext)
        data = cache.getThumbnailData(testContext, request)
        assertNull(data)
    }

    companion object {
        private const val CACHE_DIR = "mozac_browser_thumbnails"
    }
}
