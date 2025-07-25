/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.settings.logins

import android.content.Context
import androidx.navigation.NavController
import androidx.navigation.NavDestination
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import mozilla.appservices.RustComponentsInitializer
import mozilla.components.concept.storage.Login
import mozilla.components.concept.storage.LoginEntry
import mozilla.components.lib.dataprotect.SecureAbove22Preferences
import mozilla.components.service.sync.logins.InvalidRecordException
import mozilla.components.service.sync.logins.SyncableLoginsStorage
import mozilla.components.service.sync.logins.UNDECRYPTABLE_LOGINS_CLEANED_KEY
import mozilla.components.support.test.robolectric.testContext
import mozilla.components.support.test.rule.MainCoroutineRule
import mozilla.components.support.test.rule.runTestOnMain
import mozilla.components.support.utils.ClipboardHandler
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.mozilla.fenix.R
import org.mozilla.fenix.ext.directionsEq
import org.mozilla.fenix.settings.logins.controller.SavedLoginsStorageController
import org.mozilla.fenix.settings.logins.fragment.EditLoginFragmentDirections
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SavedLoginsStorageControllerTest {
    @get:Rule
    val coroutinesTestRule = MainCoroutineRule()
    private val ioDispatcher = coroutinesTestRule.testDispatcher
    private val scope = coroutinesTestRule.scope

    private val passwordsStorage: SyncableLoginsStorage = mockk(relaxed = true)
    private lateinit var controller: SavedLoginsStorageController
    private val navController: NavController = mockk(relaxed = true)
    private val loginsFragmentStore: LoginsFragmentStore = mockk(relaxed = true)
    private val clipboardHandler: ClipboardHandler = mockk(relaxed = true)
    private val loginMock: Login = mockk(relaxed = true)

    @Before
    fun setup() {
        every { navController.currentDestination } returns NavDestination("").apply {
            id = R.id.loginDetailFragment
        }
        coEvery { passwordsStorage.get(any()) } returns loginMock
        every { loginsFragmentStore.dispatch(any()) } returns mockk()

        controller = SavedLoginsStorageController(
            passwordsStorage = passwordsStorage,
            lifecycleScope = scope,
            navController = navController,
            loginsFragmentStore = loginsFragmentStore,
            ioDispatcher = ioDispatcher,
            clipboardHandler = clipboardHandler,
        )
    }

    @Test
    fun `WHEN a login is deleted, THEN navigate back to the previous page`() = runTestOnMain {
        val loginId = "id"
        coEvery { passwordsStorage.delete(any()) } returns true
        controller.delete(loginId)

        coVerify {
            passwordsStorage.delete(loginId)
            loginsFragmentStore.dispatch(LoginsAction.DeleteLogin(loginId))
            navController.popBackStack(R.id.savedLoginsFragment, false)
        }
    }

    @Test
    fun `WHEN fetching the login list, THEN update the state in the store`() = runTestOnMain {
        val login = Login(
            guid = "id",
            origin = "https://www.test.co.gov.org",
            username = "user123",
            password = "securePassword1",
            httpRealm = "httpRealm",
            formActionOrigin = "",
        )
        coEvery { passwordsStorage.get("id") } returns login

        controller.fetchLoginDetails(login.guid)

        val expectedLogin = login.mapToSavedLogin()

        coVerify {
            passwordsStorage.get("id")
            loginsFragmentStore.dispatch(
                LoginsAction.UpdateCurrentLogin(
                    expectedLogin,
                ),
            )
        }
    }

    @Test
    fun `WHEN saving an update to an item, THEN navigate to login detail view`() = runTestOnMain {
        val oldLogin = Login(
            guid = "id",
            origin = "https://www.test.co.gov.org",
            username = "user123",
            password = "securePassword1",
            httpRealm = "httpRealm",
            formActionOrigin = "",
        )
        val newLogin = Login(
            guid = "id",
            origin = "https://www.test.co.gov.org",
            username = "newUsername",
            password = "newPassword",
            httpRealm = "httpRealm",
            formActionOrigin = "",
        )

        coEvery { passwordsStorage.get(any()) } returns oldLogin
        coEvery { passwordsStorage.update(any(), any()) } returns newLogin

        controller.save(oldLogin.guid, "newUsername", "newPassword")

        val directions =
            EditLoginFragmentDirections.actionEditLoginFragmentToLoginDetailFragment(
                oldLogin.guid,
            )

        val expectedNewLogin = newLogin.mapToSavedLogin()

        coVerify {
            passwordsStorage.get(oldLogin.guid)
            passwordsStorage.update(newLogin.guid, newLogin.toEntry())
            loginsFragmentStore.dispatch(
                LoginsAction.UpdateLogin(
                    newLogin.guid,
                    expectedNewLogin,
                ),
            )
            navController.navigate(directionsEq(directions))
        }
    }

    @Test
    fun `WHEN login dupe is found for save, THEN update duplicate in the store`() = runTestOnMain {
        val login = Login(
            guid = "id",
            origin = "https://www.test.co.gov.org",
            username = "user123",
            password = "securePassword1",
            httpRealm = "httpRealm",
            formActionOrigin = null,
        )

        val login2 = Login(
            guid = "id2",
            origin = "https://www.test.co.gov.org",
            username = "user1234",
            password = "securePassword1",
            httpRealm = "httpRealm",
            formActionOrigin = null,
        )

        coEvery { passwordsStorage.get(any()) } returns login
        coEvery {
            passwordsStorage.findLoginToUpdate(any())
        } returns login2

        // Simulate calling findDuplicateForSave after the user set the username field to the login2's username
        controller.findDuplicateForSave(login.guid, login2.username, login.password)

        coVerify {
            passwordsStorage.get(login.guid)
            passwordsStorage.findLoginToUpdate(
                LoginEntry(
                    origin = login.origin,
                    httpRealm = login.httpRealm,
                    formActionOrigin = login.formActionOrigin,
                    username = login2.username,
                    password = login.password,
                ),
            )
            loginsFragmentStore.dispatch(
                LoginsAction.DuplicateLogin(login2.mapToSavedLogin()),
            )
        }
    }

    @Test
    fun `WHEN login dupe is not found for save, THEN update duplicate in the store`() = runTestOnMain {
        val login = Login(
            guid = "id",
            origin = "https://www.test.co.gov.org",
            username = "user123",
            password = "securePassword1",
            httpRealm = "httpRealm",
            formActionOrigin = null,
        )

        coEvery { passwordsStorage.get(any()) } returns login
        coEvery {
            passwordsStorage.findLoginToUpdate(any())
        } returns null

        // Simulate calling findDuplicateForSave after the user set the username field to a new value
        controller.findDuplicateForSave(login.guid, "new-username", login.password)

        coVerify {
            passwordsStorage.get(login.guid)
            passwordsStorage.findLoginToUpdate(
                LoginEntry(
                    origin = login.origin,
                    httpRealm = login.httpRealm,
                    formActionOrigin = login.formActionOrigin,
                    username = "new-username",
                    password = login.password,
                ),
            )
            loginsFragmentStore.dispatch(
                LoginsAction.DuplicateLogin(null),
            )
        }
    }

    @Test
    fun `WHEN login dupe is found for add, THEN update duplicate in the store`() = runTestOnMain {
        val login = Login(
            guid = "id",
            origin = "https://www.test.co.gov.org",
            username = "user1234",
            password = "securePassword1",
            httpRealm = "httpRealm",
            formActionOrigin = null,
        )

        coEvery {
            passwordsStorage.findLoginToUpdate(any())
        } returns login

        // Simulate calling findDuplicateForAdd after the user set the origin/username fields to match login
        controller.findDuplicateForAdd(login.origin, login.username, "new-password")

        coVerify {
            passwordsStorage.findLoginToUpdate(
                LoginEntry(
                    origin = login.origin,
                    httpRealm = login.origin,
                    formActionOrigin = null,
                    username = login.username,
                    password = "new-password",
                ),
            )
            loginsFragmentStore.dispatch(
                LoginsAction.DuplicateLogin(login.mapToSavedLogin()),
            )
        }
    }

    @Test
    fun `WHEN login dupe is not found for add, THEN update duplicate in the store`() = runTestOnMain {
        coEvery {
            passwordsStorage.findLoginToUpdate(any())
        } returns null

        // Simulate calling findDuplicateForAdd after the user set the origin/username field to new values
        val origin = "https://new-origin.example.com"
        controller.findDuplicateForAdd(origin, "username", "password")

        coVerify {
            passwordsStorage.findLoginToUpdate(
                LoginEntry(
                    origin = origin,
                    httpRealm = origin,
                    formActionOrigin = null,
                    username = "username",
                    password = "password",
                ),
            )
            loginsFragmentStore.dispatch(
                LoginsAction.DuplicateLogin(null),
            )
        }
    }

    @Test
    fun `WHEN findLoginToUpdate throws THEN update duplicate in the store`() = runTestOnMain {
        coEvery {
            passwordsStorage.findLoginToUpdate(any())
        } throws InvalidRecordException("InvalidOrigin")

        // Simulate calling findDuplicateForAdd with an invalid origin
        val origin = "https://"
        controller.findDuplicateForAdd(origin, "username", "password")

        coVerify {
            passwordsStorage.findLoginToUpdate(
                LoginEntry(
                    origin = origin,
                    httpRealm = origin,
                    formActionOrigin = null,
                    username = "username",
                    password = "password",
                ),
            )
            loginsFragmentStore.dispatch(
                LoginsAction.DuplicateLogin(null),
            )
        }
    }

    @Test
    fun `WHEN dupe checking THEN always use a non-blank password`() = runTestOnMain {
        // If the user hasn't entered a password yet, we should use a dummy
        // password to send a valid login entry to findLoginToUpdate()

        coEvery {
            passwordsStorage.findLoginToUpdate(any())
        } throws InvalidRecordException("InvalidOrigin")

        // Simulate calling findDuplicateForAdd with an invalid origin
        val origin = "https://example.com/"
        controller.findDuplicateForAdd(origin, "username", "")

        coVerify {
            passwordsStorage.findLoginToUpdate(
                LoginEntry(
                    origin = origin,
                    httpRealm = origin,
                    formActionOrigin = null,
                    username = "username",
                    password = "password",
                ),
            )
        }
    }

    @Test
    fun `VERIFY cleaning undecryptable logins only happens once`() = runTestOnMain {
        RustComponentsInitializer.init()
        val securePrefs = SecureAbove22Preferences(testContext, "logins", forceInsecure = true)
        val testPasswordsStorage = SyncableLoginsStorage(
            testContext,
            lazy { securePrefs },
            coroutinesTestRule.testDispatcher,
        )

        testPasswordsStorage.warmUp()
        coroutinesTestRule.testDispatcher.scheduler.advanceUntilIdle()

        // Assert we've never ran the logins cleanup
        assertTrue(
            testContext
                .getSharedPreferences("sync.logins.prefs", Context.MODE_PRIVATE)
                .getInt(UNDECRYPTABLE_LOGINS_CLEANED_KEY, 0) == 0,
        )

        // Register with the sync manager to "pretend" we're about to sync
        testPasswordsStorage.registerWithSyncManager()
        coroutinesTestRule.testDispatcher.scheduler.advanceUntilIdle()
        // Validate we've ran once and set the pref successfully
        assertTrue(
            testContext
                .getSharedPreferences("sync.logins.prefs", Context.MODE_PRIVATE)
                .getInt(UNDECRYPTABLE_LOGINS_CLEANED_KEY, 0) == 1,
        )

        testPasswordsStorage.registerWithSyncManager()
        coroutinesTestRule.testDispatcher.scheduler.advanceUntilIdle()

        // Subsequent calls should not call the method again
        assertTrue(
            testContext
                .getSharedPreferences("sync.logins.prefs", Context.MODE_PRIVATE)
                .getInt(UNDECRYPTABLE_LOGINS_CLEANED_KEY, 0) == 1,
        )
    }
}
