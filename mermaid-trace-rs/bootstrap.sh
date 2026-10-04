#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
checkout="$root/vendor/merman"
revision=f351a6f5826f0089d6682726a47ed430c4b80d45
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
