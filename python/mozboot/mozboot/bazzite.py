# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import subprocess
import sys
from pathlib import Path
from typing import Optional

from mozfile import which

from mozboot.base import BaseBootstrapper
from mozboot.linux_common import LinuxBootstrapper

# Bazzite ships Homebrew, but only wires it into POSIX shells' `$PATH`, so
# `brew` may be missing from the environment `mach` runs in.
HOMEBREW_BIN_DIR = "/home/linuxbrew/.linuxbrew/bin"

NO_BREW_INSTALLED = f"""
Could not find Homebrew, which bootstrapping relies on to install the packages
that Bazzite's base image doesn't provide.

Bazzite installs Homebrew by default. If it is missing, install it with
`ujust install-brew`; if it is installed but not in `$PATH`, add
`{HOMEBREW_BIN_DIR}` to `$PATH`. Then rerun `./mach bootstrap`.
"""

BREW_NOT_ON_PATH = f"""
WARNING: Homebrew was found at {{brew}}, but `brew` is not in `$PATH`.

Bootstrapping installs build-time dependencies with Homebrew, so builds will
fail to find them unless `{HOMEBREW_BIN_DIR}` is in `$PATH`. Bazzite only
sets this up for POSIX shells; other shells (e.g. Nushell) need it configured
by hand.
"""


class BazziteBootstrapper(LinuxBootstrapper, BaseBootstrapper):
    """Bazzite experimental bootstrapper.

    Bazzite is an immutable Fedora Atomic image, so packages that are missing
    from the base image are installed with Homebrew rather than layered onto
    the OS image with `rpm-ostree`.
    """

    def __init__(self, version, dist_id, **kwargs):
        print("Using an experimental bootstrapper for Bazzite.", file=sys.stderr)
        BaseBootstrapper.__init__(self, **kwargs)
        self.brew = None

    def _find_brew(self) -> Optional[Path]:
        if self.brew is None:
            brew = which("brew", extra_search_dirs=[HOMEBREW_BIN_DIR])
            if brew is not None:
                self.brew = Path(brew)

        return self.brew

    def _ensure_brew(self) -> Path:
        brew = self._find_brew()
        if brew is None:
            print(NO_BREW_INSTALLED, file=sys.stderr)
            sys.exit(1)

        return brew

    def _brew(self, *args):
        subprocess.check_call([str(self._ensure_brew()), *args])

    def _brew_output(self, *args) -> set[str]:
        return set(
            subprocess.check_output(
                [str(self._ensure_brew()), *args], universal_newlines=True
            ).split()
        )

    def validate_environment(self):
        # Warn rather than fail, so that `--no-system-changes` bootstraps still
        # work when Homebrew is missing entirely.
        brew = self._find_brew()
        if brew is None:
            print(NO_BREW_INSTALLED, file=sys.stderr)
        elif which("brew") is None:
            print(BREW_NOT_ON_PATH.format(brew=brew), file=sys.stderr)

    def install_packages(self, packages):
        # `brew install` only warns about already-installed packages, and won't
        # upgrade the outdated ones, so sort the two cases out up front.
        installed = self._brew_output("list", "--formula")
        outdated = self._brew_output("outdated", "--quiet", "--formula")

        to_install = [p for p in packages if p not in installed]
        to_upgrade = [p for p in packages if p in outdated]

        if to_install:
            self._brew("install", *to_install)
        if to_upgrade:
            self._brew("upgrade", *to_upgrade)

    def _update_package_manager(self):
        self._brew("update")

    def upgrade_mercurial(self, current):
        self.install_packages(["mercurial"])

    def install_system_packages(self):
        # Everything else `LinuxBootstrapper` installs is already part of the
        # Bazzite base image, but GNU patch is not.
        self.install_packages(["gpatch"])

        # Optional packages
        try:
            self.install_packages(["watchman"])
        except subprocess.CalledProcessError:
            pass
