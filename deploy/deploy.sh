#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# One Life — production deploy script
#
# Deploys the latest semver release tag to this host: checks out the tag, builds,
# backs up Postgres, applies migrations, restarts the systemd fleet, and health-
# checks. See deploy/README.md for the topology and the manual rebuild runbook.
#
#   ./deploy/deploy.sh              deploy latest tag (code + additive migrations)
#   ./deploy/deploy.sh --rebuild    ALSO truncate+re-fold projections from the
#                                   event log (for releases whose migrations
#                                   change projection-table shape, e.g. v0.3.0)
#   ./deploy/deploy.sh --help
#
# NOTE on Postgres vs. the one-life-bot's SQLite deploy: a Postgres migration is
# forward-only and cannot be undone by restoring a file. So rollback reverts the
# *code* only when it fails BEFORE migrate; once migrate succeeds we keep the new
# code running and point you at the pg_dump for a manual restore if the release
# is bad. Take that seriously — the auto-rollback is not symmetric with the bot.
# ─────────────────────────────────────────────────────────────────────────────

# ─── Paths ───────────────────────────────────────────────────────────────────
# This script lives in deploy/; the repo root is one level up.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# All ten units, in a safe stop order (consumers/HTTP first, projector last).
# Start order is the reverse, so the projector leads and re-folds ASAP.
SERVICES=(web api verifier enforcer granter rebooter newsdesk notifier ingest projector)

WEB_URL="http://127.0.0.1:3010/"        # onelife-web (nginx's only upstream)
API_URL="http://127.0.0.1:3011/"        # onelife-api (liveness only; no /health route)
BACKUP_DIR="${ONELIFE_BACKUP_DIR:-$HOME}"

# ─── Args ────────────────────────────────────────────────────────────────────
DO_REBUILD=0
for arg in "$@"; do
  case "$arg" in
    --rebuild) DO_REBUILD=1 ;;
    -h|--help)
      sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

# ─── Output helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD_WHITE='\033[1;37m'; RESET='\033[0m'
log_phase()   { echo -e "\n${BOLD_WHITE}━━━  $1  ━━━${RESET}"; }
log_info()    { echo -e "  $1"; }
log_success() { echo -e "  ${GREEN}✓ $1${RESET}"; }
log_warn()    { echo -e "  ${YELLOW}! $1${RESET}"; }
log_error()   { echo -e "  ${RED}✗ $1${RESET}" >&2; }

# ─── State ───────────────────────────────────────────────────────────────────
CURRENT_PHASE="init"
START_TIME=$(date +%s)
ROLLBACK_TAG=""
LATEST_TAG=""
DB_BACKUP=""
SERVICES_STOPPED=0
MIGRATED=0
DATABASE_URL=""

# ─── pnpm / DB URL discovery ─────────────────────────────────────────────────
PNPM="$(command -v pnpm || echo /home/acab/.local/bin/pnpm)"

read_database_url() {
  # DATABASE_URL=... in .env; strip an optional surrounding quote pair.
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$REPO_DIR/.env" | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')"
}

# ─── Service helpers ─────────────────────────────────────────────────────────
stop_services()  { sudo systemctl stop   "${SERVICES[@]/#/onelife-}"; }
start_services() {  # projector first → reverse of the stop order
  local ordered=(); for ((i=${#SERVICES[@]}-1; i>=0; i--)); do ordered+=("onelife-${SERVICES[$i]}"); done
  sudo systemctl start "${ordered[@]}"
}

# ─── Rollback ────────────────────────────────────────────────────────────────
rollback() {
  trap - ERR
  set +e
  log_error ""
  log_error "Deploy failed in phase: $CURRENT_PHASE"

  if [[ "$MIGRATED" == "1" ]]; then
    # Migrations already applied — the schema is on the NEW version. Reverting
    # code to the old tag would mismatch it, so we do NOT. Bring the fleet up on
    # the new code and hand off to a human.
    log_warn "Migrations were already applied — NOT reverting code (schema is new)."
    log_warn "Full-DB checkpoint for manual restore if this release is bad:"
    log_warn "    $DB_BACKUP"
    log_info "Restarting services on the current (new) code ..."
    start_services || true
    log_error "Deploy left partially applied; investigate before retrying."
    exit 1
  fi

  # Failure was before migrate → safe to revert code.
  if [[ -z "$ROLLBACK_TAG" ]]; then
    log_error "ROLLBACK_TAG unset — cannot roll back automatically."
    exit 1
  fi
  log_error "Rolling back code to $ROLLBACK_TAG ..."
  cd "$REPO_DIR"
  git checkout "$ROLLBACK_TAG" 2>/dev/null || git checkout - 2>/dev/null || true
  "$PNPM" install --frozen-lockfile --silent || true
  "$PNPM" --filter @onelife/web build >/dev/null 2>&1 || true
  if [[ "$SERVICES_STOPPED" == "1" ]]; then
    start_services || true
    log_warn "Services restarted on rollback target $ROLLBACK_TAG"
  fi
  exit 1
}
trap 'rollback' ERR

# ─── Phase 1: Preflight ──────────────────────────────────────────────────────
CURRENT_PHASE="preflight"
log_phase "PREFLIGHT"
cd "$REPO_DIR"

# Only tracked changes block a deploy; untracked scratch (.claude/worktrees, etc.)
# is fine.
if ! git diff --quiet || ! git diff --staged --quiet; then
  log_error "Working tree has uncommitted tracked changes — commit or discard first."
  exit 1
fi
[[ -f .env ]]            || { log_error ".env not found in $REPO_DIR"; exit 1; }
command -v "$PNPM" >/dev/null || { log_error "pnpm not found ($PNPM)"; exit 1; }
command -v pg_dump >/dev/null || { log_error "pg_dump not found"; exit 1; }
command -v psql    >/dev/null || { log_error "psql not found"; exit 1; }
for s in "${SERVICES[@]}"; do
  systemctl cat "onelife-$s" >/dev/null 2>&1 || { log_error "unit onelife-$s not installed"; exit 1; }
done
read_database_url
[[ -n "$DATABASE_URL" ]] || { log_error "DATABASE_URL missing from .env"; exit 1; }
psql "$DATABASE_URL" -tAc 'SELECT 1' >/dev/null 2>&1 || { log_error "cannot reach Postgres via DATABASE_URL"; exit 1; }
[[ -d "$BACKUP_DIR" && -w "$BACKUP_DIR" ]] || { log_error "backup dir not writable: $BACKUP_DIR"; exit 1; }

ROLLBACK_TAG=$(git describe --tags --exact-match 2>/dev/null || git rev-parse HEAD)
log_info "Rollback point: $ROLLBACK_TAG"
log_success "Preflight checks passed"

# ─── Phase 2: Fetch ──────────────────────────────────────────────────────────
CURRENT_PHASE="fetch"
log_phase "FETCH"
git fetch --tags --prune origin

# Strict semver tags only (vMAJOR.MINOR.PATCH) — ignore marker/pre-release tags.
LATEST_TAG=$(git tag -l 'v[0-9]*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)
[[ -n "$LATEST_TAG" ]] || { log_error "no semver release tags found"; exit 1; }

log_info "Current: $ROLLBACK_TAG   Latest: $LATEST_TAG"
if [[ "$ROLLBACK_TAG" == "$LATEST_TAG" ]]; then
  log_success "Already on $LATEST_TAG — nothing to deploy."
  exit 0
fi
git checkout "$LATEST_TAG"
log_success "Checked out $LATEST_TAG"

# ─── Phase 3: Build ──────────────────────────────────────────────────────────
# Runs while the OLD fleet is still serving (running processes hold their code in
# memory; changing files on disk doesn't disturb them until restart).
CURRENT_PHASE="build"
log_phase "BUILD"
"$PNPM" install --frozen-lockfile
log_success "Workspace dependencies installed"
"$PNPM" --filter @onelife/web build
log_success "Web built"

# ─── Phase 4: Stop ───────────────────────────────────────────────────────────
# Freeze all writers before touching the schema so no old-code process races the
# migration.
CURRENT_PHASE="stop"
log_phase "STOP"
stop_services
SERVICES_STOPPED=1
sleep 1
log_success "Fleet stopped"

# ─── Phase 5: Backup ─────────────────────────────────────────────────────────
CURRENT_PHASE="backup"
log_phase "BACKUP"
DB_BACKUP="$BACKUP_DIR/onelife-pre-${LATEST_TAG}-full.sql"
pg_dump "$DATABASE_URL" > "$DB_BACKUP"
log_success "Full-DB checkpoint: $DB_BACKUP ($(du -h "$DB_BACKUP" | cut -f1))"

# ─── Phase 6: Rebuild (optional) ─────────────────────────────────────────────
# Truncates the derived projection tables + resets the projector cursor so the
# projector re-folds from the event log after migrate. Needed only when a release
# changes projection-table shape. MUST use `run rebuild` — bare `pnpm ... rebuild`
# is pnpm's built-in native-module rebuild and silently does nothing.
if [[ "$DO_REBUILD" == "1" ]]; then
  CURRENT_PHASE="rebuild"
  log_phase "REBUILD (--rebuild)"
  # Same unexported-variable hazard as the MIGRATE phase below — see the note there. This one
  # never had a fallback masking it at all: apps/projector/src/config.ts declares DATABASE_URL
  # as a required zod field, tsx loads no .env, and this phase runs AFTER the fleet is stopped.
  DATABASE_URL="$DATABASE_URL" "$PNPM" --filter @onelife/projector run rebuild
  log_success "Projections truncated + cursor reset to 0"
fi

# ─── Phase 7: Migrate ────────────────────────────────────────────────────────
# drizzle-kit applies pending migrations; each runs in its own transaction, so a
# failure rolls that migration back cleanly (no partial schema). If a migration
# aborts on a projection-table constraint, re-run with --rebuild.
CURRENT_PHASE="migrate"
log_phase "MIGRATE"
# ⚠️ DATABASE_URL must be passed EXPLICITLY. It is a plain shell variable here (read out of
# .env at the top of this script), never exported, so a bare `pnpm run db:migrate` child does
# not inherit it — and drizzle-kit's bundled dotenv loads from its own cwd (packages/db/), not
# the repo root, so it does not find the .env this script read either. Until this line existed,
# what actually supplied the connection string on the host was a hardcoded localhost:5432
# fallback in drizzle.config.ts that happened to match production. That fallback is now a hard
# error (it silently migrated the wrong database in dev), which would abort this phase — and
# phase order is backup → STOP SERVICES → migrate, so the abort lands with the fleet down.
DATABASE_URL="$DATABASE_URL" "$PNPM" --filter @onelife/db run db:migrate
MIGRATED=1
log_success "Migrations applied"

# ─── Phase 8: Start ──────────────────────────────────────────────────────────
CURRENT_PHASE="start"
log_phase "START"
start_services
sleep 2
log_success "Fleet started"

# ─── Phase 9: Health ─────────────────────────────────────────────────────────
CURRENT_PHASE="health"
log_phase "HEALTH"
HEALTH_ATTEMPTS=30
HEALTH_INTERVAL=2

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$1" 2>/dev/null || echo 000; }

health_check() {
  for ((i = 1; i <= HEALTH_ATTEMPTS; i++)); do
    local bad=0
    for s in "${SERVICES[@]}"; do
      systemctl is-active --quiet "onelife-$s" || { log_error "onelife-$s not active (crash on start?)"; return 1; }
    done
    # web must serve 200; api just needs to answer (no /health route → any HTTP
    # status, i.e. not 000/connection-refused, means it's up).
    local web api; web=$(http_code "$WEB_URL"); api=$(http_code "$API_URL")
    [[ "$web" == "200" ]] || bad=1
    [[ "$api" != "000" ]] || bad=1
    if [[ "$bad" == "0" ]]; then
      log_success "All services active; web=$web api=$api"
      return 0
    fi
    log_info "Health attempt $i/$HEALTH_ATTEMPTS (web=$web api=$api) ..."
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}
if ! health_check; then
  log_error "Fleet did not become healthy within $((HEALTH_ATTEMPTS * HEALTH_INTERVAL))s"
  exit 1
fi

# After a --rebuild the projector must re-fold the whole event log; wait until its
# cursor catches up to the newest event so we don't report success mid-fold.
if [[ "$DO_REBUILD" == "1" ]]; then
  log_info "Waiting for projector to re-fold the event log ..."
  for ((i = 1; i <= 150; i++)); do   # up to ~10 min
    max=$(psql "$DATABASE_URL" -tAc 'SELECT coalesce(max(id),0) FROM events;' 2>/dev/null || echo 0)
    cur=$(psql "$DATABASE_URL" -tAc "SELECT coalesce(last_event_id,0) FROM consumer_cursors WHERE consumer_name='projector';" 2>/dev/null || echo 0)
    if [[ -n "$max" && "$cur" == "$max" && "$max" != "0" ]]; then
      players=$(psql "$DATABASE_URL" -tAc 'SELECT count(*) FROM players;' 2>/dev/null || echo '?')
      log_success "Projector caught up (cursor=$cur, players=$players)"
      break
    fi
    [[ $((i % 5)) -eq 0 ]] && log_info "  re-folding: cursor=$cur / $max"
    sleep 4
  done
fi

# ─── Phase 10: Cleanup ───────────────────────────────────────────────────────
# Past the point of no rollback — detach the trap so a declined prompt can't undo
# a healthy deploy.
CURRENT_PHASE="cleanup"
trap - ERR
set +e
log_phase "CLEANUP"

STALE=()
while IFS= read -r b; do
  [[ -z "$b" || "$b" == "$DB_BACKUP" ]] && continue
  STALE+=("$b")
done < <(ls -1t "$BACKUP_DIR"/onelife-pre-*-full.sql 2>/dev/null)

if [[ ${#STALE[@]} -eq 0 ]]; then
  log_info "No stale backups to clean up."
elif [[ ! -t 0 ]]; then
  log_warn "${#STALE[@]} stale backup(s) present; skipping cleanup (non-interactive)."
else
  log_warn "Found ${#STALE[@]} stale backup(s) (keeping this run's $DB_BACKUP):"
  for b in "${STALE[@]}"; do log_info "  $b ($(du -h "$b" 2>/dev/null | cut -f1))"; done
  printf "  ${YELLOW}Remove these %d stale backup(s)? [y/N] ${RESET}" "${#STALE[@]}"
  read -r REPLY
  if [[ "$REPLY" =~ ^[Yy]$ ]]; then rm -f "${STALE[@]}"; log_success "Removed."; else log_info "Left in place."; fi
fi

# ─── Phase 11: Done ──────────────────────────────────────────────────────────
ELAPSED=$(( $(date +%s) - START_TIME ))
log_phase "DONE"
echo -e "\n  ${GREEN}Deployed $LATEST_TAG in ${ELAPSED}s${RESET}\n"
