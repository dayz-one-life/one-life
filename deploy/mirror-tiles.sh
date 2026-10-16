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
#   ./deploy/mirror-tiles.sh              # first-time mirror of every map in MAPS
#   ./deploy/mirror-tiles.sh              # re-mirror (after a DayZ terrain update) —
#                                          # a bare re-run already fully re-downloads
#                                          # into a fresh staging dir and replaces each
#                                          # map whose staged pyramid is complete, so
#                                          # there is no force flag to reach for here.
#                                          # Any extra args are passed straight through
#                                          # to dzmap-loader (e.g. -p 4 for concurrency).
#
# TILE_DIR overrides the destination (default /var/www/tiles, matching the nginx
# `alias` in deploy/README.md). The tiles there are root-owned, so on the host this
# runs under sudo. ZOOM_LIMIT (default 6, matching MAX_ZOOM in map-canvas.tsx) sets
# the deepest zoom mirrored.
#
# ⚠️ static.xam.nu answers most tile requests from a non-browser client with 403,
# and dzmap-loader reads a 403 as "this tile does not exist" and still reports
# success. On 2026-10-15 that turned complete 5461-tile Chernarus and Livonia
# mirrors into 1144- and 537-tile ones, and a 403 was wrongly taken to mean a
# sea/edge tile that xam.nu doesn't serve: every tile at zoom 0–6 exists. So after
# dzmap-loader runs, every tile still missing from the staged pyramid is fetched
# again with curl (browser User-Agent + xam.nu Referer, 4 at a time), and a map
# replaces the live mirror ONLY if its staged pyramid is complete. A partial result
# leaves the existing tiles untouched. Do not relax that check to "non-empty": that
# is exactly the guard that let the partial mirrors through.
set -euo pipefail

DEST="${TILE_DIR:-/var/www/tiles}"
MAPS=(chernarusplus sakhal enoch nasdara)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/dzmap.yaml"
ZOOM="${ZOOM_LIMIT:-6}"
# A full square pyramid for zoom 0..ZOOM: 1 + 4 + 16 + ... + 4^ZOOM (5461 at zoom 6).
EXPECTED=$(( (4 ** (ZOOM + 1) - 1) / 3 ))
FILL_UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
FILL_REFERER="https://dayz.xam.nu/"

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
( cd "$WORK" && dzmap-loader -c "$CONFIG" "${LIMIT_ARGS[@]}" --tiles-only -z "$ZOOM" "$@" )

# .webp files under $1; 0 when $1 doesn't exist. (A bare `find | wc` aborts the whole
# script there: under pipefail the failing find fails the pipeline, and set -e exits.)
count_tiles() {
  if [[ -d "$1" ]]; then find "$1" -name '*.webp' | wc -l | tr -d ' '; else echo 0; fi
}

# The map's topographic URL template from dzmap.yaml, e.g.
# https://static.xam.nu/dayz/maps/livonia/1.27/topographic/{z}/{x}/{y}.webp
tile_url_template() {
  awk -v m="$1" '$1 == "-" && $2 == "name:" { cur = $3 }
                 cur == m && $1 == "topographic:" { print $2; exit }' "$CONFIG"
}

# Fetch one tile into $root/z/x/y.webp, keeping it only if it really is a WebP.
# Always succeeds: a tile that still fails just stays missing, and the
# completeness check below refuses the map.
fetch_tile() {
  local root=$1 tmpl=$2 z=$3 x=$4 y=$5 url tmp
  url="${tmpl//\{z\}/$z}"; url="${url//\{x\}/$x}"; url="${url//\{y\}/$y}"
  tmp="$(mktemp)"
  if curl -sf --max-time 30 --retry 2 -A "$FILL_UA" -e "$FILL_REFERER" -o "$tmp" "$url" \
     && [[ "$(head -c 4 "$tmp")" == RIFF && "$(dd if="$tmp" bs=1 skip=8 count=4 2>/dev/null)" == WEBP ]]; then
    mkdir -p "$root/$z/$x" && mv "$tmp" "$root/$z/$x/$y.webp"
  else
    rm -f "$tmp"
  fi
  return 0
}
export -f fetch_tile
export FILL_UA FILL_REFERER

# Re-fetch every tile dzmap-loader left out of the staged pyramid (see the ⚠️ above).
fill_gaps() {
  local map=$1 root=$2 tmpl z x y n
  tmpl="$(tile_url_template "$map")"
  [[ -n "$tmpl" ]] || { echo "warning: no topographic URL for $map in $CONFIG" >&2; return 0; }
  mkdir -p "$root"
  for (( z = 0; z <= ZOOM; z++ )); do
    n=$(( 1 << z ))
    for (( x = 0; x < n; x++ )); do
      for (( y = 0; y < n; y++ )); do
        [[ -f "$root/$z/$x/$y.webp" ]] || echo "$z $x $y"
      done
    done
  done | xargs -P 4 -n 3 bash -c 'fetch_tile "$0" "$1" "$2" "$3" "$4"' "$root" "$tmpl"
}

mkdir -p "$DEST" || {
  echo "error: could not create $DEST — check that the parent directory is" >&2
  echo "       writable by the running user, or re-run this script under sudo." >&2
  exit 1
}

OK_MAPS=()
FAILED_MAPS=()
for m in "${MAPS[@]}"; do
  SRC="$WORK/maps/$m/topographic"
  # Also runs when dzmap-loader produced nothing at all for this map (every request
  # 403ed, as Sakhal's did on 2026-10-15): fill_gaps then fetches the whole pyramid.
  LOADER_COUNT="$(count_tiles "$SRC")"
  if [[ "$LOADER_COUNT" -lt "$EXPECTED" ]]; then
    echo "==> $m: dzmap-loader got $LOADER_COUNT/$EXPECTED tiles; fetching the rest ..."
    fill_gaps "$m" "$SRC"
  fi

  # Counted BEFORE touching $DEST at all: the `rm -rf` + `mv` below is the destructive
  # step, so only a COMPLETE staged pyramid may replace the live mirror. Anything short
  # of that (a 403ing source, a wrong map name, a dropped connection) leaves the
  # existing tiles exactly as they were. See the ⚠️ at the top for why "non-empty"
  # is not good enough.
  STAGED_COUNT="$(count_tiles "$SRC")"
  if [[ "$STAGED_COUNT" -ne "$EXPECTED" ]]; then
    echo "warning: $m staged $STAGED_COUNT/$EXPECTED tiles — incomplete, so the existing" >&2
    echo "         mirror at $DEST/$m/topographic is left untouched. Re-run later." >&2
    FAILED_MAPS+=("$m")
    continue
  fi

  # The web app requests /tiles/{map}/topographic/{z}/{x}/{y}.webp verbatim (see
  # apps/web/src/components/life/track-map.tsx) — the same "topographic" name
  # DZMap itself uses, so the mirrored tree lands exactly as DZMap produced it,
  # with no rename step to keep in sync.
  mkdir -p "$DEST/$m"
  rm -rf "$DEST/$m/topographic"
  mv "$SRC" "$DEST/$m/topographic"
  TILE_COUNT="$(count_tiles "$DEST/$m/topographic")"
  echo "==> $m: $TILE_COUNT tiles mirrored"
  OK_MAPS+=("$m")
done

if [[ ${#OK_MAPS[@]} -gt 0 ]]; then
  echo "==> summary: ${#OK_MAPS[@]}/${#MAPS[@]} maps mirrored (${OK_MAPS[*]})"
else
  echo "==> summary: 0/${#MAPS[@]} maps mirrored"
fi
if [[ ${#FAILED_MAPS[@]} -gt 0 ]]; then
  echo "==> failed/empty: ${FAILED_MAPS[*]}" >&2
fi

if [[ ${#OK_MAPS[@]} -eq 0 ]]; then
  echo "error: zero maps were mirrored — this run produced nothing usable." >&2
  exit 1
fi

echo "==> done. Verify a real tile is readable, e.g.:"
echo "    find $DEST/${OK_MAPS[0]} -name '*.webp' | head -1"
echo "    curl -sI https://<host>/tiles/\$(find $DEST/${OK_MAPS[0]} -name '*.webp' | head -1 | sed \"s|^$DEST/||\") | head -1"
