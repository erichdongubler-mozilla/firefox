# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import sys

from mozboot.base import BaseBootstrapper
from mozboot.linux_common import LinuxBootstrapper


class BazziteBootstrapper(LinuxBootstrapper, BaseBootstrapper):
    """Bazzite experimental bootstrapper."""

    def __init__(self, version, dist_id, **kwargs):
        print("Using an experimental bootstrapper for Bazzite.", file=sys.stderr)
        BaseBootstrapper.__init__(self, **kwargs)

    def install_packages(self, packages):
        # TODO: `brew upgrade $packages`
        # brew upgrade gpatch
        pass

    def upgrade_mercurial(self, current):
        # TODO: `brew upgrade mercurial`
        pass

    def _update_package_manager(self):
        # TODO: `brew update`
        pass

    def ensure_sccache_packages(self):
        self.install_packages(["sccache"])
        pass

    def install_system_packages(self):
        # Optional packages
        try:
            self.install_packages(["watchman"])
        except Exception:
            pass

    def install_browser_packages(self, mozconfig_builder, artifact_mode=False):
        pass

    def install_browser_artifact_mode_packages(self, mozconfig_builder):
        pass
