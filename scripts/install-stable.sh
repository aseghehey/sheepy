#!/bin/sh
# The stable Sheepy: built from a committed revision (default: HEAD) in a
# clean checkout, so work in progress in this repo can't reach it, and
# installed as /Applications/Sheepy.app. The development build (npm run
# app:dev) is "Sheepy Dev", a separate app with its own settings.
#
#   npm run app:stable            # HEAD
#   npm run app:stable -- v0.2.0  # a tag, branch or commit
set -eu
ref=${1:-HEAD}
repo=$(cd "$(dirname "$0")/.." && pwd)
rev=$(git -C "$repo" rev-parse --short "$ref")
if [ "$ref" = HEAD ] && [ -n "$(git -C "$repo" status --porcelain)" ]; then
  echo "Note: uncommitted changes are left out; building $rev as committed."
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/sheepy-stable.XXXXXX")
cleanup() { git -C "$repo" worktree remove --force "$work" >/dev/null 2>&1 || rm -rf "$work"; }
trap cleanup EXIT INT TERM
git -C "$repo" worktree add --detach -q "$work" "$rev"
cd "$work"

# The same dependencies as this repo's when its lockfile matches; else a clean install.
if [ -d "$repo/node_modules" ] && cmp -s "$repo/package-lock.json" package-lock.json; then
  cp -R "$repo/node_modules" node_modules
else
  npm ci --no-audit --no-fund
fi

# Its own build folder, so it doesn't rebuild the development one's.
target="$repo/src-tauri/target/stable"
CARGO_TARGET_DIR="$target" npx tauri build --bundles app
built="$target/release/bundle/macos/Sheepy.app"
[ -d "$built" ] || { echo "no app was built at $built" >&2; exit 1; }

# Swapped in whole, so a failed copy leaves the old one.
dest=/Applications/Sheepy.app
rm -rf "$dest.new"
cp -R "$built" "$dest.new"
rm -rf "$dest"
mv "$dest.new" "$dest"
echo "Installed Sheepy ($rev) at $dest. Quit and reopen it if it's running."
