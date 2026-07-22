#!/usr/bin/env bash
#
# deploy/mirror-tiles.sh — one-time (and after a DayZ terrain update) mirror of
# DayZ map tiles for the owner-only life map. Run manually on the host; this is
# NOT part of deploy.sh and NOT in the release path — tiles change with DayZ
# game/map releases, not with our releases. See deploy/README.md for the nginx
# side and the full trade-off this script makes.
#
# Tiles are deliberately NOT in git (hundreds of MB of binary tiles) and NOT in
# Postgres (they would bloat every pg_dump backup with data that is fully
# reproducible by re-running this script — that's the trade being made: no
# backup coverage, in exchange for a one-command rebuild).
#
# Prerequisite: dzmap-loader (https://github.com/WoozyMasta/dzmap) must already
# be installed and on PATH. This script does not install it.
#
# Usage:
#   ./deploy/mirror-tiles.sh              # first-time mirror of all three maps
#   ./deploy/mirror-tiles.sh              # re-mirror (after a DayZ terrain update) —
#                                          # a bare re-run already fully re-downloads
#                                          # into a fresh staging dir and replaces the
#                                          # destination unconditionally, so there is
#                                          # no force flag to reach for here. Any extra
#                                          # args are passed straight through to
#                                          # dzmap-loader.
#
# TILE_DIR overrides the destination (default /var/www/tiles, matching the nginx
# `alias` in deploy/README.md).
set -euo pipefail

DEST="${TILE_DIR:-/var/www/tiles}"
MAPS=(chernarusplus sakhal enoch)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/dzmap.yaml"

command -v dzmap-loader >/dev/null 2>&1 || {
  echo "error: dzmap-loader not found on PATH." >&2
  echo "       Install it first: https://github.com/WoozyMasta/dzmap" >&2
  exit 1
}

[[ -f "$CONFIG" ]] || {
  echo "error: config not found at $CONFIG" >&2
  exit 1
}

# dzmap-loader always writes to ./maps/<name>/<layer>/... relative to its CWD (no
# output-dir flag exists as of the version this was written against) — so we run
# it in a scratch dir and move the result into place ourselves.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

LIMIT_ARGS=()
for m in "${MAPS[@]}"; do LIMIT_ARGS+=(--limit "$m"); done

echo "==> mirroring ${MAPS[*]} into staging dir $WORK ..."
# --tiles-only: we don't consume DZMap's GeoJSON locations output, only the tile
# pyramid itself. Extra args ("$@" — e.g. -f/--force for a post-terrain-update
# re-mirror) are passed straight through to dzmap-loader.
( cd "$WORK" && dzmap-loader -c "$CONFIG" "${LIMIT_ARGS[@]}" --tiles-only "$@" )

mkdir -p "$DEST" || {
  echo "error: could not create $DEST — check that the parent directory is" >&2
  echo "       writable by the running user, or re-run this script under sudo." >&2
  exit 1
}
for m in "${MAPS[@]}"; do
  SRC="$WORK/maps/$m/topographic"
  if [[ ! -d "$SRC" ]]; then
    echo "warning: no tiles produced for $m (source unreachable, or the map name" >&2
    echo "         doesn't match dzmap.yaml) — skipping, existing tiles untouched" >&2
    continue
  fi

  # The web app requests /tiles/{map}/topographic/{z}/{x}/{y}.webp verbatim (see
  # apps/web/src/components/life/track-map.tsx) — the same "topographic" name
  # DZMap itself uses, so the mirrored tree lands exactly as DZMap produced it,
  # with no rename step to keep in sync.
  mkdir -p "$DEST/$m"
  rm -rf "$DEST/$m/topographic"
  mv "$SRC" "$DEST/$m/topographic"
  echo "==> $m: $(find "$DEST/$m/topographic" -name '*.webp' | wc -l | tr -d ' ') tiles mirrored"
done

echo "==> done. Verify one tile is readable:"
echo "    curl -sI https://<host>/tiles/chernarusplus/topographic/3/4/4.webp | head -1"
