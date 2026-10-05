#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
checkout="$root/vendor/merman"
revision=e089037007879e6ec0902c7a855501beb605cb7f
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
