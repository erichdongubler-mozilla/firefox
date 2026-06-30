#!/usr/bin/python
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

GIT_EXCLUSIONS = [".git", ".gitignore", ".gitattributes"]

import glob
import os
import shutil
import sys
from optparse import OptionParser
from subprocess import check_call

topsrcdir = os.path.dirname(__file__)
if topsrcdir == "":
    topsrcdir = "."


def check_call_noisy(cmd, *args, **kwargs):
    print("Executing command:", cmd)
    check_call(cmd, *args, **kwargs)


def do_git_replace(dir, repository, tag, exclusions, git):
    """
    Replace the contents of dir with the contents of repository checked out at
    tag, except for files matching exclusions.
    """
    fulldir = os.path.join(topsrcdir, dir)
    if os.path.exists(fulldir):
        shutil.rmtree(fulldir)

    assert not os.path.exists(fulldir)
    check_call_noisy([git, "clone", "-b", tag, repository, fulldir])

    for thing in exclusions:
        for excluded in glob.iglob(os.path.join(fulldir, thing)):
            if os.path.isdir(excluded):
                shutil.rmtree(excluded)
            else:
                os.remove(excluded)


def toggle_trailing_blank_line(depname):
    """If the trailing line is empty, then we'll delete it.
    Otherwise we'll add a blank line."""
    lines = open(depname, "rb").readlines()
    if not lines:
        print("unexpected short file", file=sys.stderr)
        return

    if not lines[-1].strip():
        # trailing line is blank, removing it
        open(depname, "wb").writelines(lines[:-1])
    else:
        # adding blank line
        open(depname, "ab").write(b"\n")


def get_trailing_blank_line_state(depname):
    lines = open(depname).readlines()
    if not lines:
        print("unexpected short file", file=sys.stderr)
        return "no blank line"

    if not lines[-1].strip():
        return "has blank line"
    return "no blank line"


def update_nspr_or_nss(tag, depfile, destination, repopath):
    destination = destination.rstrip("/")
    permanent_patch_dir = destination + "/patches"
    temporary_patch_dir = destination + ".patches"
    if os.path.exists(temporary_patch_dir):
        print("please clean up leftover directory " + temporary_patch_dir)
        sys.exit(2)
    warn_if_patch_exists(permanent_patch_dir)
    # protect patch directory from being removed by the replace step
    if os.path.exists(permanent_patch_dir):
        shutil.move(permanent_patch_dir, temporary_patch_dir)
    # now update the destination
    print(f"reverting to checked-in version of {depfile} to get its blank line state")
    check_call_noisy([options.git, "checkout", "--", depfile])
    old_state = get_trailing_blank_line_state(depfile)
    print(f"old state of {depfile} is: {old_state}")
    do_git_replace(destination, repopath, tag, GIT_EXCLUSIONS, options.git)
    new_state = get_trailing_blank_line_state(depfile)
    print(f"new state of {depfile} is: {new_state}")
    if old_state == new_state:
        print("toggling blank line in: ", depfile)
        toggle_trailing_blank_line(depfile)
    tag_file = destination + "/TAG-INFO"
    with open(tag_file, "w") as f:
        f.write(tag)
    # move patch directory back to a subdirectory
    if os.path.exists(temporary_patch_dir):
        shutil.move(temporary_patch_dir, permanent_patch_dir)


def warn_if_patch_exists(path):
    # If the given patch directory exists and contains at least one file,
    # then print warning and wait for the user to acknowledge.
    if os.path.isdir(path) and os.listdir(path):
        print("========================================")
        print("WARNING: At least one patch file exists")
        print("in directory: " + path)
        print("You must manually re-apply all patches")
        print("after this script has completed!")
        print("========================================")
        input("Press Enter to continue...")
        return


o = OptionParser(usage="client.py [options] update_nspr tagname | update_nss tagname")
o.add_option(
    "--skip-mozilla",
    dest="skip_mozilla",
    action="store_true",
    default=False,
    help="Obsolete",
)

o.add_option(
    "--git",
    dest="git",
    default=os.environ.get("GIT", "git"),
    help="The location of the git binary",
)
o.add_option(
    "--repo", dest="repo", help="the repo to update from (default: upstream repo)"
)

try:
    options, args = o.parse_args()
    action = args[0]
except IndexError:
    o.print_help()
    sys.exit(2)

if action in ("checkout", "co"):
    print("Warning: client.py checkout is obsolete.", file=sys.stderr)
    pass
elif action in ("update_nspr"):
    (tag,) = args[1:]
    depfile = "nsprpub/config/prdepend.h"
    if not options.repo:
        options.repo = "https://github.com/mozilla/nspr"
    update_nspr_or_nss(tag, depfile, "nsprpub", options.repo)
elif action in ("update_nss"):
    (tag,) = args[1:]
    depfile = "security/nss/coreconf/coreconf.dep"
    if not options.repo:
        options.repo = "https://github.com/mozilla/nss"
    update_nspr_or_nss(tag, depfile, "security/nss", options.repo)
else:
    o.print_help()
    sys.exit(2)
