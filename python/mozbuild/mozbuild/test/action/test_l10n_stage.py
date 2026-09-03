# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import tempfile
import unittest
from pathlib import Path

from mozunit import main

from mozbuild.action.l10n_stage import stage_locale
from mozbuild.frontend.l10n_manifest import (
    MANIFEST_VERSION,
    MOZ_L10N_AB_CD_PLACEHOLDER,
    JarEntry,
    JarSection,
    L10nManifest,
    L10nManifestContextData,
    write_l10n_manifest,
)


def _two_section_manifest():
    def section(name, chrome_packages, sources):
        return JarSection(
            name=name,
            base="",
            relativesrcdir="",
            chrome_manifests=[
                f"locale {package} {MOZ_L10N_AB_CD_PLACEHOLDER} "
                f"%locale/{MOZ_L10N_AB_CD_PLACEHOLDER}/{package}/"
                for package in chrome_packages
            ],
            pp_includes=[],
            entries=[
                JarEntry(
                    source=source,
                    output=f"locale/{MOZ_L10N_AB_CD_PLACEHOLDER}/{name}/{source}",
                    is_locale=True,
                    preprocess=False,
                )
                for source in sources
            ],
        )

    return L10nManifest(
        version=MANIFEST_VERSION,
        moz_app_id="{abcd}",
        moz_app_version="121.0",
        moz_app_displayname="Firefox",
        moz_build_app="browser",
        contexts=[
            L10nManifestContextData(
                relsrcdir="app/locales",
                install_subdir="",
                defines={},
                locale_pp_defines={},
                jar_sections=[
                    section("zeta", ["zulu", "alpha"], ["zulu.properties"]),
                    section("alpha", ["one"], ["one.properties"]),
                ],
            )
        ],
    )


class TestChromeManifestOrdering(unittest.TestCase):
    def _stage(self, tmp, mode="langpack"):
        root = Path(tmp)
        manifest_path = root / "l10n-manifest.json"
        write_l10n_manifest(_two_section_manifest(), manifest_path)
        merge_tree = root / "merge-dir" / "de" / "app"
        merge_tree.mkdir(parents=True, exist_ok=True)
        for name in ("zulu.properties", "one.properties"):
            (merge_tree / name).write_text(f"# {name}\n", encoding="utf-8")
        dest = root / "stage"
        stage_locale(
            locale="de",
            manifest_path=manifest_path,
            merge_tree=root / "merge-dir" / "de",
            dest_xpi_stage=dest,
            topsrcdir=root / "src",
            topobjdir=root / "obj",
            mode=mode,
        )
        return dest

    def test_every_manifest_is_sorted(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._stage(tmp)

            self.assertEqual(
                (dest / "chrome.manifest").read_text(encoding="utf-8").splitlines(),
                ["manifest alpha.manifest", "manifest zeta.manifest"],
            )
            self.assertEqual(
                (dest / "zeta.manifest").read_text(encoding="utf-8").splitlines(),
                [
                    "locale alpha de zeta/locale/de/alpha/",
                    "locale zulu de zeta/locale/de/zulu/",
                ],
            )

    def test_chrome_mode_merges_with_entries_already_on_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._stage(tmp, mode="chrome")
            (dest / "zeta.manifest").write_text(
                "locale zulu fr zeta/locale/fr/zulu/\n", encoding="utf-8"
            )
            self._stage(tmp, mode="chrome")

            self.assertEqual(
                (dest / "zeta.manifest").read_text(encoding="utf-8").splitlines(),
                [
                    "locale alpha de zeta/locale/de/alpha/",
                    "locale zulu de zeta/locale/de/zulu/",
                    "locale zulu fr zeta/locale/fr/zulu/",
                ],
            )


if __name__ == "__main__":
    main()
