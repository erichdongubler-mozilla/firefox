# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""This script is intended to be called through fzf as a preview formatter."""


import argparse
import os
import sys

here = os.path.abspath(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(here), "util"))


def process_args():
    """Process preview arguments."""
    argparser = argparse.ArgumentParser()
    argparser.add_argument(
        "-t",
        "--tasklist",
        type=str,
        default=None,
        help="Path to temporary file containing the selected tasks",
    )
    return argparser.parse_args()


def plain_display(taskfile):
    """Original preview window display."""
    with open(taskfile) as f:
        tasklist = [line.strip() for line in f]
    print("\n".join(sorted(tasklist)))


if __name__ == "__main__":
    args = process_args()
    plain_display(args.tasklist)
