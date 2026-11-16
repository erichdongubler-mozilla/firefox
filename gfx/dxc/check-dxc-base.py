#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""
Check that an upstream DXC revision is an ancestor of the fork revision that
the `dxc-src` fetch task builds from.

`mach vendor gfx/dxc/moz.yaml` runs this with the upstream revision it is
about to record. Run it without arguments to check the revision already
recorded in `moz.yaml`.
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

SCRIPT_DIR = Path(__file__).resolve().parent
TOPSRCDIR = SCRIPT_DIR.parent.parent
MOZ_YAML = SCRIPT_DIR / "moz.yaml"
TOOLCHAINS_YML = TOPSRCDIR / "taskcluster" / "kinds" / "fetch" / "toolchains.yml"
FETCH_NAME = "dxc-src"


def git(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=False
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "upstream_revision",
        nargs="?",
        help="Upstream DXC revision to check; defaults to `origin.revision` in `moz.yaml`.",
    )
    args = parser.parse_args()

    upstream_revision = args.upstream_revision
    if upstream_revision is None:
        upstream_revision = yaml.safe_load(MOZ_YAML.read_text())["origin"]["revision"]

    fetch = yaml.safe_load(TOOLCHAINS_YML.read_text())[FETCH_NAME]["fetch"]
    fork_repo = fetch["repo"]
    fork_revision = fetch["revision"]

    print(
        f"Checking that upstream `{upstream_revision}` is an ancestor of "
        f"`{fork_revision}` from `{fork_repo}`…"
    )

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        git("init", "--quiet", cwd=tmp).check_returncode()
        fetched = git(
            "fetch", "--quiet", "--filter=tree:0", fork_repo, fork_revision, cwd=tmp
        )
        if fetched.returncode != 0:
            print(fetched.stderr, file=sys.stderr)
            print(f"error: failed to fetch `{fork_revision}`", file=sys.stderr)
            return 1

        # Fetching the fork revision brings its whole history along, so an
        # upstream revision that isn't present locally can't be an ancestor.
        is_ancestor = (
            git("cat-file", "-e", f"{upstream_revision}^{{commit}}", cwd=tmp).returncode
            == 0
            and git(
                "merge-base",
                "--is-ancestor",
                upstream_revision,
                fork_revision,
                cwd=tmp,
            ).returncode
            == 0
        )

    if not is_ancestor:
        print(
            f"error: upstream `{upstream_revision}` is not an ancestor of the "
            f"`{FETCH_NAME}` fetch's `{fork_revision}`; rebase the fork onto it, "
            f"and update `{TOOLCHAINS_YML.relative_to(TOPSRCDIR)}`.",
            file=sys.stderr,
        )
        return 1

    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
