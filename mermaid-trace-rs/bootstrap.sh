#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
checkout="$root/vendor/merman"
revision=d8fa65b11ae224ac2fb231eb618caa5698f45fde
if [ ! -e "$checkout/.git" ]; then
  mkdir -p "$root/vendor"
  git clone --no-checkout --depth 1 https://github.com/Nek/merman.git "$checkout"
  git -C "$checkout" fetch --depth 1 origin "$revision"
  git -C "$checkout" switch --detach "$revision"
fi
if [ "$(git -C "$checkout" rev-parse HEAD)" != "$revision" ] ||
   [ -n "$(git -C "$checkout" status --porcelain)" ]; then
  echo "Merman source must be clean and pinned to $revision; existing checkout was left untouched." >&2
  exit 1
fi
