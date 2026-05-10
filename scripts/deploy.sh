#!/usr/bin/env bash
# ConsensusBot v2.0 — end-to-end deploy script.
#
# SPEC sources of truth (read these BEFORE editing this file):
#   - docs/REDEVELOPMENT_SPECIFICATION.md §6.2 (process_active_decisions_schedule)
#   - docs/REDEVELOPMENT_SPECIFICATION.md §22  (backlog — what this script does NOT do)
#   - docs/REDEVELOPMENT_SPECIFICATION.md §24  (end-to-end deploy procedure)
#   - docs/REDEVELOPMENT_BUILD_PLAN.md     T-601 (this task)
#
# Single-file ownership: T-601 owns ONLY this file.
#
# What this script does
# ---------------------
# 1. Runs `slack deploy` to push the current app build to Slack ROSI, forwarding
#    any arguments passed to this script (for example `./scripts/deploy.sh --force`).
# 2. Computes the next weekday (Mon–Fri) at 09:00:00 UTC as ISO-8601, because
#    Slack rejects scheduled triggers whose `start_time` is in the past with
#    `invalid_start_before_now` (SPEC §6.2). The static `start_time` literal in
#    `triggers/process_active_decisions_schedule.ts` will drift; this script
#    materialises a fresh value at deploy time.
# 3. Writes a temporary JSON trigger definition mirroring
#    `triggers/process_active_decisions_schedule.ts` but with the freshly
#    computed `start_time`, and feeds it to `slack triggers create` — but only
#    if a scheduled trigger named "Process Active Decisions" is not already
#    listed by `slack triggers list`.
# 4. Idempotently creates the slash-command trigger (`Create Consensus
#    Decision`) from `triggers/consensus_command.ts` if it is missing.
# 5. Cleans up the temporary trigger-def file via `trap` on EXIT.
#
# What this script does NOT do (deliberate; see SPEC §22 / §24)
# -------------------------------------------------------------
# - It does not log in (`slack login`) or pick a workspace (`slack create`).
#   Those are first-time-only steps the operator runs before this script.
# - It does not deploy to multiple workspaces; rerun the script with a
#   different `slack` workspace context for production.
# - It does not retry on transient Slack errors (SPEC §22 B2 — deferred).
# - It does not configure `outgoingDomains` or external secrets (B3).

set -euo pipefail

# -----------------------------------------------------------------------------
# Resolve repo root from this script's location so the script works regardless
# of the caller's CWD. The trigger-def file lives at
# `<repo>/triggers/consensus_command.ts`.
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONSENSUS_COMMAND_TRIGGER_DEF="${REPO_ROOT}/triggers/consensus_command.ts"

SCHEDULED_TRIGGER_NAME="Process Active Decisions"
SHORTCUT_TRIGGER_NAME="Create Consensus Decision"

# -----------------------------------------------------------------------------
# Temp-file cleanup: register the trap as early as possible, then mktemp -d.
# We use a temp directory rather than `mktemp <template.json>` because BSD and
# GNU `mktemp` differ in how they handle suffixes after the `XXXXXX` token; a
# directory + a fixed inner filename is portable. The `${TMP_DIR:-}` guard
# keeps `set -u` happy if `mktemp -d` itself failed.
# -----------------------------------------------------------------------------
TMP_DIR=""
TMP_TRIGGER_DEF=""
cleanup() {
  if [[ -n "${TMP_DIR:-}" && -d "${TMP_DIR}" ]]; then
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# `_add_days_ymd <N>` echoes the UTC date N days from today in YYYY-MM-DD form.
# `_add_days_dow <N>` echoes the UTC day-of-week (1=Mon..7=Sun) N days from
# today.
#
# macOS `date` (BSD) and GNU `date` accept different flags. The instruction in
# the build plan is to use a portable loop-and-increment pattern rather than
# `date -d`, but the per-iteration increment itself still needs a flavour. We
# probe once: macOS supports `date -u -v+1d +%s`; GNU does not. If macOS-style
# fails we fall back to epoch arithmetic with `date -u -r <epoch>` (BSD) or
# `date -u -d @<epoch>` (GNU). The probe avoids relying on `date -d <relative>`
# (the explicitly forbidden form per T-601 prompt).
# -----------------------------------------------------------------------------
if date -u -v+0d +%s >/dev/null 2>&1; then
  _DATE_FLAVOUR="bsd"
elif date -u -r 0 +%Y >/dev/null 2>&1; then
  _DATE_FLAVOUR="bsd-epoch"
else
  # GNU `date` accepts `@<epoch>` via `-d`. We use only `-d @<epoch>`, never
  # `-d "<relative>"`, so the increment stays a deterministic arithmetic op.
  _DATE_FLAVOUR="gnu"
fi

_add_days_ymd() {
  local n="$1"
  case "${_DATE_FLAVOUR}" in
    bsd)
      date -u -v+"${n}"d +%Y-%m-%d
      ;;
    bsd-epoch)
      local now_epoch target_epoch
      now_epoch="$(date -u +%s)"
      target_epoch=$((now_epoch + n * 86400))
      date -u -r "${target_epoch}" +%Y-%m-%d
      ;;
    gnu)
      local now_epoch target_epoch
      now_epoch="$(date -u +%s)"
      target_epoch=$((now_epoch + n * 86400))
      date -u -d "@${target_epoch}" +%Y-%m-%d
      ;;
  esac
}

_add_days_dow() {
  local n="$1"
  case "${_DATE_FLAVOUR}" in
    bsd)
      date -u -v+"${n}"d +%u
      ;;
    bsd-epoch)
      local now_epoch target_epoch
      now_epoch="$(date -u +%s)"
      target_epoch=$((now_epoch + n * 86400))
      date -u -r "${target_epoch}" +%u
      ;;
    gnu)
      local now_epoch target_epoch
      now_epoch="$(date -u +%s)"
      target_epoch=$((now_epoch + n * 86400))
      date -u -d "@${target_epoch}" +%u
      ;;
  esac
}

# -----------------------------------------------------------------------------
# Compute the next weekday at 09:00 UTC. Iterate adding 1 day starting from
# tomorrow until the day-of-week is Mon (1) through Fri (5). Tomorrow rather
# than today is the right floor: even if today is a weekday, by the time the
# script finishes deploying we want a strictly future `start_time`, and Slack
# treats the date portion as the first run.
# -----------------------------------------------------------------------------
compute_next_weekday_start_time() {
  local n=1
  local dow ymd
  while [[ "${n}" -le 14 ]]; do
    dow="$(_add_days_dow "${n}")"
    if [[ "${dow}" -ge 1 && "${dow}" -le 5 ]]; then
      ymd="$(_add_days_ymd "${n}")"
      printf '%sT09:00:00Z\n' "${ymd}"
      return 0
    fi
    n=$((n + 1))
  done
  echo "ERROR: could not find a weekday within 14 days; date arithmetic broken." >&2
  return 1
}

# -----------------------------------------------------------------------------
# `has_trigger_named <name>` returns 0 if `slack triggers list` contains a
# trigger whose name matches the argument exactly. We use a fixed-string match
# so names containing regex metacharacters are safe.
#
# `slack triggers list` output format is human-readable; the trigger names are
# printed on their own lines prefixed by whitespace. A simple grep on the
# whole stream is sufficient — false positives would require a different
# trigger to embed the exact name string, which the operator controls.
# -----------------------------------------------------------------------------
has_trigger_named() {
  local name="$1"
  local triggers_list
  if ! triggers_list="$(slack triggers list 2>/dev/null)"; then
    # If `slack triggers list` itself fails (network, auth, no project), bail
    # rather than silently treat as "trigger missing" and try to create a
    # duplicate.
    echo "ERROR: \`slack triggers list\` failed; cannot determine existing triggers." >&2
    return 2
  fi
  printf '%s\n' "${triggers_list}" | grep -F -q -- "${name}"
}

# -----------------------------------------------------------------------------
# Main flow.
# -----------------------------------------------------------------------------

echo "==> ConsensusBot deploy starting (repo: ${REPO_ROOT})"

echo "==> Running \`slack deploy\` (push current build to ROSI; forwarding script args)"
slack deploy "$@"

echo "==> Computing next weekday 09:00 UTC start_time"
START_TIME="$(compute_next_weekday_start_time)"
echo "    start_time = ${START_TIME}"

echo "==> Materialising temporary trigger definition (JSON)"
TMP_DIR="$(mktemp -d -t consensusbot-deploy.XXXXXX 2>/dev/null || mktemp -d)"
TMP_TRIGGER_DEF="${TMP_DIR}/process_active_decisions_schedule.json"
cat >"${TMP_TRIGGER_DEF}" <<JSON
{
  "type": "scheduled",
  "name": "${SCHEDULED_TRIGGER_NAME}",
  "description": "Finalise past-deadline decisions and send voter reminders",
  "workflow": "#/workflows/process_active_decisions_workflow",
  "schedule": {
    "start_time": "${START_TIME}",
    "frequency": {
      "type": "weekly",
      "repeats_every": 1,
      "on_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    },
    "timezone": "UTC"
  },
  "inputs": {}
}
JSON
echo "    wrote ${TMP_TRIGGER_DEF}"

echo "==> Checking for existing scheduled trigger \"${SCHEDULED_TRIGGER_NAME}\""
if has_trigger_named "${SCHEDULED_TRIGGER_NAME}"; then
  echo "    scheduled trigger already exists; skipping create"
else
  echo "    not found; creating via \`slack triggers create\`"
  slack triggers create --trigger-def "${TMP_TRIGGER_DEF}"
fi

echo "==> Checking for existing slash-command trigger \"${SHORTCUT_TRIGGER_NAME}\""
if has_trigger_named "${SHORTCUT_TRIGGER_NAME}"; then
  echo "    slash-command trigger already exists; skipping create"
else
  echo "    not found; creating from ${CONSENSUS_COMMAND_TRIGGER_DEF}"
  slack triggers create --trigger-def "${CONSENSUS_COMMAND_TRIGGER_DEF}"
fi

echo "==> Deploy complete. Run \`slack triggers list\` to verify."
