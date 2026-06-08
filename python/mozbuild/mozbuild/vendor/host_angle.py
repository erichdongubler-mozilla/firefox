# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, # You can obtain one at http://mozilla.org/MPL/2.0/.

import requests

from mozbuild.vendor.host_base import BaseHost


class AngleHost(BaseHost):
    def upstream_commit(self, revision):
        def _chromium_beta_angle_revision() -> str:
            response = requests.get(
                "https://chromiumdash.appspot.com/fetch_releases",
                params={"channel": "Beta", "platform": "Windows", "num": 1},
            )
            response.raise_for_status()
            return response.json()[0]["hashes"]["angle"]

        # If no specific revision specified, use the current ANGLE version used
        # by Chromium's Beta channel.
        if revision == "HEAD":
            revision = _chromium_beta_angle_revision()

        return super().upstream_commit(revision)

    def upstream_snapshot(self, revision):
        raise Exception("Not supported for Angle")
