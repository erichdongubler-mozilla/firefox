#!/bin/bash

function show_error_msg()
{
  echo "*** ERROR *** $? line $1 $0 did not complete successfully!"
  echo "$ERROR_HELP"
}
ERROR_HELP=""

# Print an Error message if `set -eE` causes the script to exit due to a failed command
trap 'show_error_msg $LINENO' ERR

source dom/media/webrtc/third_party_build/use_config_env.sh
export HGPLAIN=1

# After this point:
# * eE: All commands should succeed.
# * u: All variables should be defined before use.
# * o pipefail: All stages of all pipes should succeed.
set -eEuo pipefail

echo "MOZ_LIBWEBRTC_SRC: $MOZ_LIBWEBRTC_SRC"
echo "MOZ_LIBWEBRTC_BRANCH: $MOZ_LIBWEBRTC_BRANCH"
echo "MOZ_FASTFORWARD_BUG: $MOZ_FASTFORWARD_BUG"

# CURRENT_SHA=`hg id -r . | awk '{ print $1; }'`
# echo "CURRENT_SHA: $CURRENT_SHA"

find_repo_type
echo "repo type: $MOZ_REPO"

# we grab the entire firstline description for convenient logging
if [ "x$MOZ_REPO" == "xgit" ]; then
LAST_PATCHSTACK_UPDATE_COMMIT=`git log --max-count 1 --oneline \
    third_party/libwebrtc/moz-patch-stack/*.patch`
else
# note: we reverse the output and use tail -1 rather than using head -1
# because head fails in this context.
LAST_PATCHSTACK_UPDATE_COMMIT=`hg log -r ::. --template "{node|short} {desc|firstline}\n" \
    --include "third_party/libwebrtc/moz-patch-stack/*.patch" | tail -1`
fi
echo "LAST_PATCHSTACK_UPDATE_COMMIT: $LAST_PATCHSTACK_UPDATE_COMMIT"

LAST_PATCHSTACK_UPDATE_COMMIT_SHA=`echo $LAST_PATCHSTACK_UPDATE_COMMIT \
    | awk '{ print $1; }'`
echo "LAST_PATCHSTACK_UPDATE_COMMIT_SHA: $LAST_PATCHSTACK_UPDATE_COMMIT_SHA"

# grab the oldest, non "Vendor from libwebrtc" line
if [ "x$MOZ_REPO" == "xgit" ]; then
CANDIDATE_COMMITS=`git log --format='%h' --invert-grep \
    --grep="Vendor libwebrtc" c28df994cbbd..HEAD -- third_party/libwebrtc \
    | awk 'BEGIN { ORS=" " }; { print $1; }'`
else
CANDIDATE_COMMITS=`hg log --template "{node|short} {desc|firstline}\n" \
    -r "children($LAST_PATCHSTACK_UPDATE_COMMIT_SHA)::. - desc('re:(Vendor libwebrtc)')" \
    --include "third_party/libwebrtc/" | awk 'BEGIN { ORS=" " }; { print $1; }'`
fi
echo "CANDIDATE_COMMITS:"
echo "$CANDIDATE_COMMITS"

EXTRACT_COMMIT_RANGE="{start-commit-sha}::."
if [ "x$CANDIDATE_COMMITS" != "x" ]; then
  EXTRACT_COMMIT_RANGE="$CANDIDATE_COMMITS"
  echo "EXTRACT_COMMIT_RANGE: $EXTRACT_COMMIT_RANGE"
fi

./mach python $SCRIPT_DIR/vendor-libwebrtc.py \
        --from-local $MOZ_LIBWEBRTC_SRC \
        --commit $MOZ_LIBWEBRTC_BRANCH \
        libwebrtc

# echo "exiting early for testing repo detection"
# exit

if [ "x$MOZ_REPO" == "xgit" ]; then
git restore -q \
    'third_party/libwebrtc/**/moz.build' \
    third_party/libwebrtc/README.mozilla.last-vendor
else
hg revert -q \
   --include "third_party/libwebrtc/**moz.build" \
   --include "third_party/libwebrtc/README.mozilla.last-vendor" \
   third_party/libwebrtc
fi

ERROR_HELP=$"
***
There are changes detected after vendoring libwebrtc from our local copy
of the git repo containing our patch-stack:
$MOZ_LIBWEBRTC_SRC

Typically this is due to changes made in mercurial to files residing
under third_party/libwebrtc that have not been reflected in
moz-libwebrtc git repo's patch-stack.

The following commands should help remedy the situation:
  ./mach python $SCRIPT_DIR/extract-for-git.py $EXTRACT_COMMIT_RANGE
  mv mailbox.patch $MOZ_LIBWEBRTC_SRC
  (cd $MOZ_LIBWEBRTC_SRC && \\
   git am mailbox.patch)

After adding the new changes from mercurial to the moz-libwebrtc
patch stack, you should re-run this command to verify vendoring:
  bash $0
"
if [ "x$MOZ_REPO" == "xgit" ]; then
FILE_CHANGE_CNT=`git status --short third_party/libwebrtc | wc -l | tr -d " "`
else
FILE_CHANGE_CNT=`hg status third_party/libwebrtc | wc -l | tr -d " "`
fi
echo "FILE_CHANGE_CNT: $FILE_CHANGE_CNT"
if [ "x$FILE_CHANGE_CNT" != "x0" ]; then
  echo "$ERROR_HELP"
  exit 1
fi


echo "Done - vendoring has been verified."
