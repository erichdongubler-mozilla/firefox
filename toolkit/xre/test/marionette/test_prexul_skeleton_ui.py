# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from marionette_harness import MarionetteTestCase


class TestSkeletonUI(MarionetteTestCase):
    def check_skeleton_ui_shown(self, expected):
        with self.marionette.using_context(self.marionette.CONTEXT_CHROME):
            showed = self.marionette.execute_script(
                "return Services.startup.showedPreXULSkeletonUI;"
            )
            self.assertEqual(
                showed,
                expected,
                f"Expected showedPreXULSkeletonUI to be {expected}, got {showed}",
            )

    def test_skeleton_ui(self):
        # Trigger a resize so that the persistence save writes the skeleton
        # UI window dimensions to the registry. On a fresh profile the
        # initial save during startup is too early (before the persistence
        # mask is set in OnChromeLoaded), so we need an explicit resize.
        rect = self.marionette.window_rect
        self.marionette.set_window_rect(width=rect["width"] + 1, height=rect["height"])

        self.marionette.restart(in_app=False)
        self.check_skeleton_ui_shown(True)

        self.marionette.instance.app_args.append("--test-skeleton-not-shown")
        try:
            # in_app=False so Marionette controls the command line and
            # --test-skeleton-not-shown is passed to the new process.
            self.marionette.restart(in_app=False)
            self.check_skeleton_ui_shown(False)
        finally:
            self.marionette.instance.app_args.remove("--test-skeleton-not-shown")
            self.marionette.set_window_rect(width=rect["width"], height=rect["height"])
            # Restore the instance to its original state.
            self.marionette.restart(in_app=False)
