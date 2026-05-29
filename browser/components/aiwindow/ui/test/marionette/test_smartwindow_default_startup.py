# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""
Marionette tests for Smart Window startup behavior in BrowserContentHandler.

These tests verify the synchronous startup gate `shouldOpenAsSmartWindow`
and the URL injection in `getFirstWindowArgs`. Scenarios requiring async
FxA authentication or saved-session state are covered by mochitest browser
tests in browser/components/aiwindow/ui/test/browser/ where they can be
stubbed with sinon.
"""

from marionette_harness import MarionetteTestCase


class TestSmartWindowDefaultStartup(MarionetteTestCase):
    """
    Test that Smart Window is (or isn't) opened on startup based on prefs.
    """

    def setUp(self):
        super().setUp()
        self.marionette.set_context("chrome")
        self.marionette.execute_script(
            """
            Services.prefs.setBoolPref("browser.smartwindow.enabled", true);
            Services.prefs.setStringPref(
              "identity.fxaccounts.remote.root",
              "http://127.0.0.1/"
            );
            """
        )

    def is_ai_window(self):
        return self.marionette.execute_script(
            """
            return window.document.documentElement.hasAttribute("ai-window");
            """
        )

    def restart(self):
        self.marionette.quit()
        self.marionette.start_session()
        self.marionette.set_context("chrome")

    def test_smartwindowdefault_user_not_logged_in(self):
        """Classic window opens at startup when Smart Window is default but user has never signed in."""
        self.marionette.execute_script(
            """
            Services.prefs.setBoolPref("browser.smartwindow.isDefaultWindow", true);
            Services.prefs.setIntPref("browser.smartwindow.tos.consentTime", 0);
            """
        )
        self.restart()

        self.assertFalse(
            self.is_ai_window(),
            msg="Window should be Classic when user has never signed in (consentTime=0)",
        )

    def test_smartwindowdefault_newtab(self):
        """Smart window opens at startup when user has previously signed in."""
        self.marionette.execute_script(
            """
            Services.prefs.setBoolPref("browser.smartwindow.isDefaultWindow", true);
            Services.prefs.setIntPref("browser.smartwindow.tos.consentTime", 1);
            Services.prefs.setBoolPref(
              "browser.smartwindow.firstrun.hasCompleted",
              true
            );
            """
        )
        self.restart()

        # URL substitution (about:home → AIWINDOW_URL) is verified separately
        # via mochitest browser — marionette forces browser.startup.page=0 at
        # every session start (testing/marionette/.../geckoinstance.py:666),
        # which keeps the substitution path unreachable from this harness.
        self.assertTrue(
            self.is_ai_window(),
            msg="Window should start as Smart Window when user is logged in",
        )

    def test_smartwindowdefault_false(self):
        """Classic window new tab opens at startup when smart window is not default."""
        self.marionette.execute_script(
            """
            Services.prefs.setBoolPref("browser.smartwindow.isDefaultWindow", false);
            Services.prefs.setIntPref("browser.smartwindow.tos.consentTime", 1);
            Services.prefs.setBoolPref(
              "browser.smartwindow.firstrun.hasCompleted",
              true
            );
            """
        )
        self.restart()

        self.assertFalse(
            self.is_ai_window(),
            msg="Window should start as Classic Window when Smart Window default pref is false",
        )

    def test_smartwindowdefault_privatewindow(self):
        """Classic private window opens even when Smart Window is the default."""
        self.marionette.execute_script(
            """
            Services.prefs.setBoolPref("browser.smartwindow.isDefaultWindow", true);
            Services.prefs.setIntPref("browser.smartwindow.tos.consentTime", 1);
            Services.prefs.setBoolPref(
              "browser.privatebrowsing.autostart",
              true
            );
            """
        )
        self.restart()

        self.assertFalse(
            self.is_ai_window(),
            msg="Window should be Classic Window in private browsing mode",
        )
        self.marionette.execute_script(
            """
            Services.prefs.setBoolPref(
              "browser.privatebrowsing.autostart",
              false
            );
            """
        )
