#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
upstream="$root/vendor/merman"
revision=72c024776a4bf2dfb9a769b67910736229355906
patch="$root/patches/sequence-provenance.patch"
if [ ! -d "$upstream/.git" ]; then
  mkdir -p "$root/vendor"
  git clone --no-checkout --depth 1 https://github.com/Latias94/merman.git "$upstream"
  git -C "$upstream" fetch --depth 1 origin "$revision"
  git -C "$upstream" switch --detach "$revision"
fi
if git -C "$upstream" apply --reverse --check "$patch" 2>/dev/null; then
  exit 0
fi
if [ "$(git -C "$upstream" rev-parse HEAD)" != "$revision" ]; then
  echo "Merman source must be pinned to $revision; existing checkout was left untouched." >&2
  exit 1
fi
git -C "$upstream" apply --check "$patch"
git -C "$upstream" apply "$patch"
