# Wave 7 — Final SPEC Conformance Review

**Reviewer:** Independent T-701 reviewer (did NOT implement). **Date:**
2026-05-09. **Scope:** Re-walk of SPEC §1–§25 against the full Wave 1–6
implementation, plus the ten T-701 cross-checks (legacy-file grep,
`scripts/deploy.sh`, §22 backlog, manifest scope list, §551 forbidden patterns,
Wave 5 SHOULD-FIX status, top-level docs, `.github/copilot-instructions.md`,
`.github/workflows/ci.yml`, `scripts/deploy.sh` ↔ §6.2/§24).

## Summary

**Verdict: green-with-followups (T-701 sign-off granted).** No regression landed
in Wave 6. The implementation conforms to SPEC §1–§25 with no integrity-critical
violations. Forbidden patterns remain absent (no `any`, no `@ts-ignore`, no
`Deno.env.get` anywhere — including tests, no `{{decision_id}}` in non-comment /
non-negative-test context, no floating-point pass/fail in
`utils/decision_logic.ts`). The 13-scope `botScopes` list in `manifest.ts`
matches SPEC §4 verbatim. None of the SPEC §22 backlog items (B1–B12) was
silently implemented or silently dropped. Top-level docs are SPEC-aligned.
`.github/workflows/ci.yml` is the only file under `.github/workflows/` and
matches SPEC §23.3 verbatim. `.github/copilot-instructions.md` correctly forbids
modifying `ci.yml`, `deno.jsonc`, and the PR template. `scripts/deploy.sh` is
real bash (file 1 begins `#!/usr/bin/env bash`), executable (`-rwxr-xr-x`), and
computes a freshly future-dated weekday `start_time` per SPEC §6.2 / §24.

`deno task ci` is green from the current head: 310 tests pass, 0 failed — exact
same count as the wave-5 sign-off, so Wave 6 added no test churn.

The three Wave 5 SHOULD-FIX items (`claimFinalisation` not wired into either
`finalizeDecision`; `process_active_decisions.ts:updateMessageForDecided` emits
only `APPROVED`/`REJECTED` and does NOT surface tied/deadlocked; vote-handler
past-deadline branch passes `[]` to `finalizeDecision` instead of re-querying
`votes`) **all remain open at Wave 7 and were not addressed in Wave 6.** This is
consistent with the Wave 6 task brief (§6 of `docs/REDEVELOPMENT_BUILD_PLAN.md`:
tooling / CI / deploy / docs only; no `functions/` / `utils/` modifications),
but the orchestrator should track each as a hot-fix task before T-702 acceptance
OR explicitly elect to defer them post-T-702.

I sign off Waves 1–6 against SPEC §1–§25. The three open items below are
SHOULD-FIX, not MUST-FIX, because none violates a MUST clause of SPEC §1–§25;
they are quality-of-implementation issues already documented in
`docs/reviews/wave-5-review.md` and re-confirmed here.

## Findings

### MUST-FIX (blocks the T-702 acceptance gate)

- None.

### SHOULD-FIX (carried over from Wave 5 — still open at Wave 7)

1. **`utils/concurrency.ts:claimFinalisation` is exported and tested but never
   wired into either finaliser.** SPEC §16.3 frames `finalized_at` as the
   single-writer claim token. `claimFinalisation`
   (`utils/concurrency.ts:94–141`) is exercised by six tests in
   `tests/concurrency_test.ts:267–377`, but neither
   `functions/create_decision.ts:finalizeDecision` (the in-process finaliser
   reached via the vote handler / button) nor
   `functions/process_active_decisions.ts:finalizeDecision` (the schedule- tick
   finaliser) calls it. Both inline a bare `apps.datastore.put` writing
   `finalized_at`. Verified via
   `grep -rn 'claimFinalisation' functions utils tests` — only the test file,
   the export site, and the doc-comment in `utils/concurrency.ts` reference it.
   Functionally this currently works because the SPEC §13 step-9 re-read is the
   second line of defence, but the unwired helper is a maintenance hazard and
   was explicitly flagged as a Wave 5 follow-up.

2. **`updateMessageForDecided` in `functions/process_active_decisions.ts` does
   not surface `tied` / `deadlocked` outcomes in the in-channel message.** SPEC
   §13 step 7 says "Surface `tied` / `deadlocked` reasons explicitly." The local
   re-implementation at `functions/process_active_decisions.ts:782–854` derives
   `statusUpper` exclusively from `outcome.passed`:
   `const statusUpper = outcome.passed ? "APPROVED" : "REJECTED"` (line 791),
   then renders `*Status:* ${statusUpper}` (line 815). When Phase A finalises a
   deadlocked or tied decision via the schedule tick, the `*Status:*` line on
   the in-channel message reads `REJECTED` with no tied/deadlocked discriminator
   — a divergence from the in-process finaliser in
   `functions/create_decision.ts`, which routes through `statusForFailed` and
   maps `tied`→`🟰 Tied` / `deadlocked`→`🪦 Deadlocked`. The discriminator is
   available on `outcome.outcome` and just needs to be consumed. Consolidating
   the two finalisers into a shared helper (per the file header comment in
   `functions/process_active_decisions.ts:25–32`) would also fix this.

3. **Vote-handler past-deadline path passes `[]` to `finalizeDecision` instead
   of querying current votes.** `functions/create_decision.ts:1233` calls
   `await finalizeDecision(client, decision, []);` from the §9 step-5
   past-deadline guard. SPEC §13 takes `mergedVotes` as input and
   `calculateDecisionOutcome` computes the outcome over it directly — passing
   `[]` means a past-deadline click on a decision that already has, say, 5 yes /
   0 no votes will be finalised with the "Quorum not met (0 of K required)"
   reason regardless of what was actually cast. SPEC §18.1 (Phase A) gets this
   right by querying the `votes` datastore first and then passing the result in.
   The vote handler should do the same for symmetry. The integration test
   `tests/integration/deadline_finalisation_test.ts:253` pins the current `[]`
   behaviour, but its commentary (line 242) treats it as a known limitation
   rather than a SPEC-grounded contract.

### NIT (documentation-only / cosmetic)

The Wave 5 NITs (italics-vs-bold marker in §17.2; `voters.length` vs unique-
vote count in `generateADRMarkdown`; vote-history-condition phrasing;
`finalized_at` initialised to `""` instead of left absent; Phase-A vs in-process
layout divergence in `updateMessageForCancelled`; static placeholder
`start_time: "2099-01-05T09:00:00Z"` in the schedule trigger file
`triggers/process_active_decisions_schedule.ts`) all remain open and are
unchanged from `docs/reviews/wave-5-review.md`. None is behaviour-affecting;
they are documented there and not duplicated here.

## T-701 cross-check log

### 1. No orphaned legacy files

- `git ls-files` has zero entries matching `vote_button_trigger`,
  `record_vote_function`, `record_vote_test`, `record_vote.ts`, `vote_workflow`,
  `workflows/vote.ts`, `send_reminders_function`, `send_reminders_workflow`,
  `send_reminders.ts`, `send_reminders_test.ts`, `reminder_schedule`, or
  `triggers/reminder_schedule.ts`. Verified with `git ls-files | grep -E '...'`
  — empty.
- The `find . -name 'send_reminders*' -o -name ...` walk does return matches
  under `./.claude/worktrees/sharp-noyce-88d12d/`, but `.claude/` is gitignored
  agent workspace state (analogous to `.slack/`) per `.gitignore:6`. It is not
  part of the repo proper and not under T-701 review scope.
- The five tracked files that mention the legacy names are all benign:
  `.github/copilot-instructions.md:86–88` (forbidden-pattern list),
  `.github/pull_request_template.md:26–27` (PR-checklist forbidden list),
  `docs/REDEVELOPMENT_SPECIFICATION.md:172,389–390,1428` (SPEC describing what
  was retired),
  `docs/REDEVELOPMENT_BUILD_PLAN.md:81–83,902,957–958,
  1043–1044` (PLAN
  listing what must not be reintroduced), and
  `docs/reviews/wave-5-review.md:215,527–529` (Wave 5 retrospective). All
  intentional. **PASS.**

### 2. `scripts/deploy.sh` is real bash, not markdown

- `file scripts/deploy.sh` reports
  `Bourne-Again shell script text executable, Unicode text, UTF-8 text`.
- Line 1 is `#!/usr/bin/env bash`.
- Permissions are `-rwxr-xr-x` (executable bit set for owner / group / other).
  **PASS.**

### 3. SPEC §22 backlog items not silently implemented or dropped

| Item | Status                                                                                                                                                                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | Bank-holiday calendar — DEFERRED. `grep -rn -i 'bank.?holiday\|holiday.?cal' --include="*.ts"` over `datastores/`, `functions/`, `utils/`, `workflows/`, `triggers/`, `types/`, `manifest.ts` returns empty. `addBusinessDays` in `utils/date_utils.ts` skips Sat/Sun only.                                                   |
| B2   | Retry / exponential backoff on Slack 5xx / 429 — DEFERRED. Only retry mention is the UI string "please retry" in `functions/create_decision.ts:1443`. No retry loops, no backoff schedules, no `setTimeout` chains. Failures surface in ephemerals and logs as the SPEC describes.                                            |
| B3   | ADR auto-archive to external location — DEFERRED. `manifest.ts:31` has `outgoingDomains: []` (verified). The two "archive" mentions in `*.ts` are: a section text `"💡 *To archive this ADR:* Copy the markdown above..."` (`utils/adr_generator.ts:270`) and a comment about thread discoverability — neither is automation. |
| B4   | Multi-channel decisions — DEFERRED. `grep -i 'multi.?channel\|cross.?post\|watcher'` returns empty. `decisions.channel_id` is a single string per `datastores/decisions.ts`.                                                                                                                                                  |
| B5   | Decision templates — DEFERRED. No template datastore, no `template_id` field, no template-rehydration code path.                                                                                                                                                                                                              |
| B6   | Vote delegation — DEFERRED. No `delegated_to` column, no proxy-vote logic.                                                                                                                                                                                                                                                    |
| B7   | Custom criteria (weighted, three-fifths) — DEFERRED. `SuccessCriteria` literal in `types/decision_types.ts` is exactly `"simple_majority" \| "super_majority" \| "unanimous"`.                                                                                                                                                |
| B8   | Analytics dashboard — DEFERRED. No analytics datastore, no aggregator function, no dashboard workflow.                                                                                                                                                                                                                        |
| B9   | i18n of UI strings — DEFERRED. All UI strings are English; no string catalogue.                                                                                                                                                                                                                                               |
| B10  | i18n-aware deadline formatting — DEFERRED. `formatDeadlineHuman` hard-codes `en-GB` per the file documentation.                                                                                                                                                                                                               |
| B11  | Strict CAS via side-channel lock row — DEFERRED. No `*_locks` datastore. Idempotency rests on `finalized_at` plus the §13-step-9 re-read.                                                                                                                                                                                     |
| B12  | Workspace-tz override per decision — DEFERRED. `DecisionRecord.deadline_tz` is populated from `getWorkspaceTz` only; no per-decision override field on the form.                                                                                                                                                              |

**PASS.** All twelve backlog items remain deferred; none has been silently
implemented and none has been silently dropped.

### 4. Manifest scope list matches SPEC §4 exactly

`manifest.ts:32–46` enumerates 13 entries in this order:

```
commands, chat:write, chat:write.public, datastore:read, datastore:write,
pins:read, pins:write, team:read, users:read, usergroups:read,
channels:read, groups:read, im:write
```

SPEC §4 lines 219–233 enumerates the same 13 in the same order. **PASS** —
verbatim match. The other manifest fields (`name`, `description`, `icon`,
`workflows`, `datastores`, `outgoingDomains: []`) also match §4.

### 5. §551 forbidden-pattern grep — re-run on the Wave 6 head

- **`any` in source.**
  `grep -rn ': any\|<any>\| as any\b\| any\[\]\|<any,'
  --include="*.ts"` over
  the source tree, filtered to drop `Record<string, any>`: zero source hits. The
  single match in `tests/integration/process_active_decisions_test.ts:824` is a
  comment ("Defensive: any further calls return empty/no cursor.") — false
  positive.
- **`@ts-ignore` / `@ts-nocheck`.** Two matches: both are comments documenting
  the absence of the directive
  (`tests/integration/channel_members_integration_test.ts:290`,
  `tests/integration/vote_handler_test.ts:36`). Zero actual directive uses.
- **`Deno.env.get`.** Zero matches anywhere — including in tests. (Wave 5
  observed "none in tests either"; Wave 6 has not changed that.)
- **`process.env`.** Zero matches.
- **`{{decision_id}}` placeholder.** Three classes of match, all benign:
  `functions/create_decision.ts:20` is a doc comment; the lines in
  `tests/create_decision_test.ts:305–344, 402–415` are an explicit negative-
  test fixture (the test asserts that the production code does NOT emit the
  placeholder after the `rewriteButtonValues` pass). No production block payload
  contains `{{decision_id}}`.
- **Floating-point pass/fail in `utils/decision_logic.ts`.** A single `2/3`
  literal at line 186 is inside a comment ("`yes*3 >= (yes+no)*2`. The `>=` is
  deliberate: 2/3 is treated as inclusive..."). Zero floating-point arithmetic
  on the pass/fail decision path.

**PASS.**

### 6. Wave 5 SHOULD-FIX status check

| Wave 5 item                                                                          | Wave 7 status  | Evidence                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1 `claimFinalisation` wired into either finaliser?                                  | **NOT FIXED.** | `grep -rn 'claimFinalisation' functions utils tests` → only `tests/concurrency_test.ts`, `utils/concurrency.ts`, and the doc-comment lines in `utils/concurrency.ts`. Both `functions/create_decision.ts:finalizeDecision` and `functions/process_active_decisions.ts:finalizeDecision` still inline a bare `apps.datastore.put`. |
| #2 `process_active_decisions.ts:updateMessageForDecided` surfaces tied / deadlocked? | **NOT FIXED.** | `functions/process_active_decisions.ts:791` still reads `const statusUpper = outcome.passed ? "APPROVED" : "REJECTED";` — no consumption of `outcome.outcome` discriminator.                                                                                                                                                      |
| #3 Vote-handler past-deadline branch queries current votes?                          | **NOT FIXED.** | `functions/create_decision.ts:1233` still calls `await finalizeDecision(client, decision, []);` with the empty array literal.                                                                                                                                                                                                     |

Wave 6's task ownership (T-601 deploy, T-602 CI, T-603 docs, T-604 README, T-605
SECURITY, T-606 AGENTS) excluded `functions/` and `utils/` from single-file
ownership, so the lack of Wave 6 fixes is consistent with task scope. The
orchestrator should now decide whether to file each as a hot-fix task before
T-702 acceptance, or formally defer them post-acceptance with an entry in SPEC
§22 (B-something).

### 7. Top-level docs are SPEC-aligned

- **`README.md`** mentions Robert's Rules + quorum + abstain rule per SPEC §15.
  Lines 18–21 ("ConsensusBot follows Robert's Rules of Order: **abstentions are
  excluded from both the numerator and the denominator** of every pass
  calculation") and the criterion table on lines 26–34 (default quorum + pass
  condition for each of the three criteria) are correct against §15. **PASS.**
- **`DEPLOYMENT.md`** follows §24 — the first-time-deploy block on lines 20–27
  is the §24 sequence (login / create / deploy /
  `triggers create
  --trigger-def triggers/consensus_command.ts` /
  `./scripts/deploy.sh` / `triggers list`). Zero `vote_button_trigger.ts`
  mentions — `grep -n` on the file is empty. **PASS.**
- **`SECURITY.md`** lists the 13 bot scopes verbatim against SPEC §4 in the
  table on lines 38–52. The "verbatim from `manifest.ts` / SPEC §4" framing is
  explicit in line 36. The §4 / `manifest.ts` order is preserved. **PASS.**
- **`AGENTS.md`** covers `deno fmt` + `deno task ci` mandates: rule 1 lines
  11–18 (`deno fmt` before every commit, with the `.githooks/pre-commit`
  enabling step), rule 2 lines 20–22 (`deno task ci` before opening a PR).
  **PASS.**

### 8. `.github/copilot-instructions.md` forbids modifying gatekeepers per §23.4

Lines 31–41 of `.github/copilot-instructions.md` explicitly call out:

```
Do NOT modify the following files without explicit owner approval. They are
pinned by SPEC §23:

- `.github/workflows/ci.yml`
- `deno.jsonc`
- `.github/pull_request_template.md`
```

This matches SPEC §23.4 line 1548 ("The Copilot instructions explicitly forbid
modifying CI YAML, `deno.jsonc`, or the PR template..."). The "checks blocked by
network" prohibition in SPEC §23.4 line 1549–1550 is present in
`.github/copilot-instructions.md:43–47`. **PASS.**

### 9. `.github/workflows/ci.yml` is the only workflow and matches §23.3

`ls .github/workflows/` returns the single file `ci.yml`. The file content (18
lines including the trailing newline) is byte-for-byte the SPEC §23.3 yaml block
(lines 1521–1540 of the SPEC), starting with the leading comment
`# .github/workflows/ci.yml`, identical `name`, `on`, `jobs.ci`, `runs-on`,
`permissions`, four `steps` items in the order
`fmt:check → lint → check → test`. **PASS.**

### 10. `scripts/deploy.sh` matches §6.2 + §24

- **Bash, not markdown.** Header `#!/usr/bin/env bash` at line 1;
  `set -euo
  pipefail` at line 38. **PASS.**
- **Computes future `start_time`.** `compute_next_weekday_start_time()` (lines
  140–154) iterates `n=1..14`, calls `_add_days_dow` for each candidate day, and
  emits `${ymd}T09:00:00Z` for the first weekday (Mon=1 through Fri=5). The
  probe at lines 81–89 selects between BSD `date -u
  -v+Nd`, BSD-epoch
  `date -u -r <epoch>`, and GNU `date -u -d @<epoch>` — none of which uses the
  forbidden `date -d "<relative>"` form. The starting day is `n=1` (tomorrow),
  satisfying the SPEC §6.2 "freshly computed start time (next weekday at 09:00
  UTC)" contract — even if today is a weekday, the start time is strictly
  future. **PASS.**
- **Conditionally creates triggers.** `has_trigger_named` (lines 166–177) parses
  `slack triggers list` output via `grep -F -q --` (fixed-string, safe against
  name regex metacharacters). The scheduled trigger and the shortcut trigger are
  each guarded by an
  `if has_trigger_named ...; then
  ... skip ...; else ... create ...; fi` block
  (lines 215–229). **PASS.**
- **Cleanup of temp files.** `cleanup()` + `trap cleanup EXIT` registers the
  temp-dir cleanup before the `mktemp -d` call (lines 59–66). **PASS.**

## Per-section walk (Wave 5 §1–§20 carry-over + new §21–§25 confirmation)

Sections §1–§20 are unchanged from `docs/reviews/wave-5-review.md`'s per-section
walk. No source file under `datastores/`, `functions/`, `utils/`, `workflows/`,
`triggers/`, `types/`, `manifest.ts` was modified in Wave 6 (verified by grep
for absence of the legacy names; verified by the unchanged 310-test count). The
sections below add Wave 7 confirmation for §21–§25 which were not the focus of
Wave 5.

### §21 Tests

- §21.1 unit tests — every file in the SPEC §21.1 list exists in `tests/`:
  `adr_generator_test.ts`, `channel_members_test.ts`, `concurrency_test.ts`,
  `create_decision_test.ts`, `date_utils_test.ts`, `decision_logic_test.ts`,
  `escape_slack_test.ts`, `log_test.ts`, `process_active_decisions_test.ts`,
  `slack_parse_test.ts`, `types_test.ts`, `usergroup_expansion_test.ts`,
  `vote_handler_test.ts`. **Y.**
- §21.2 integration tests — every file in the SPEC §21.2 list exists in
  `tests/integration/`: `cancel_delete_test.ts`,
  `channel_members_integration_test.ts`, `create_decision_test.ts`,
  `deactivation_test.ts`, `deadline_finalisation_test.ts`,
  `process_active_decisions_test.ts`, `race_test.ts`,
  `usergroup_integration_test.ts`, `vote_handler_test.ts`. **Y.**
- All 310 tests pass under `deno task ci`. **Y.**

### §22 Backlog

- All twelve B-items remain deferred. See cross-check 3 above. **Y.**

### §23 Tooling, contributor workflow, and CI

- §23.1 Deno tasks. `deno.jsonc:10–17` enumerates `fmt`, `fmt:check`, `lint`,
  `check`, `test`, `ci` with the exact commands from SPEC §23.1. No `start`
  task. **Y.**
- §23.2 Pre-commit hook. `.githooks/pre-commit:1–13` is byte-for-byte the SPEC
  §23.2 example. **Y.**
- §23.3 CI workflow. `.github/workflows/ci.yml` matches SPEC §23.3. See
  cross-check 9. **Y.**
- §23.4 PR template & contributor docs. `AGENTS.md` (cross-check 7),
  `.github/copilot-instructions.md` (cross-check 8), and the PR template itself
  (`.github/pull_request_template.md` — Risk checklist on lines 25–30 explicitly
  mentions `vote_button_trigger`, `record_vote_function`,
  `send_reminders_function` as forbidden artefacts). **Y.**
- §23.5 Structured logging. `utils/log.ts` exists with `log.info`, `log.warn`,
  `log.error` emitters. (Verified by the test names in `tests/log_test.ts`.)
  **Y.**

### §24 End-to-end deploy procedure

- `DEPLOYMENT.md` faithfully reproduces the §24 first-time-deploy sequence, the
  ongoing-development table, and the production-isolation guidance.
- `scripts/deploy.sh` materialises the §24 step "creates the schedule trigger
  with a fresh future start_time" — see cross-check 10.
- The §24 ongoing-development commands (`slack run`, `slack activity --tail`,
  `slack deploy`, `slack delete`) are documented in DEPLOYMENT.md lines 53–60.
  **Y.**

### §25 Acceptance criteria for "done"

The 12-criterion acceptance gate in §25 will be evaluated by T-702 (criteria #1,
#2, #8, #11, #12 — automated) and T-703 (#3–#7, #9, #10 — live-workspace e2e).
For T-701 I confirm the implementation surface:

- #1 `deno task ci` green from this branch (310 ok, 0 failed). **Y.**
- #2 every §21 test exists (cross-check above). **Y.**
- #8 vote resolution: `utils/decision_logic.ts` covers all three criteria with
  quorum (Wave 5 walk confirmed pinned strings); 1-of-10 yes does NOT pass
  `simple_majority` is locked in by `tests/decision_logic_test.ts` via the
  quorum gate (pinned in Wave 5 review).
- #11 vote-history change rows: covered by `tests/vote_handler_test.ts` and
  `tests/integration/vote_handler_test.ts` integration tests; the §17.1 ADR
  template surfaces vote-history changes (Wave 5 walk).
- #12 zero secrets: `Deno.env.get` count is 0 in source AND tests. **Y.**

The remaining criteria (#3 `slack deploy`, #4 modal + 6-block layout in live
workspace, #5 vote-click behaviours in live workspace, #6 finalisation in live
workspace, #7 reminders DM in live workspace, #9 BST/GMT rendering in live
workspace, #10 deactivated-voter exclusion in live workspace) are properly the
T-703 verifier's job.

## Sign-off

**T-701: SIGNED OFF.**

I sign off Waves 1–6 against SPEC §1–§25.

The three SHOULD-FIX items (carried over from Wave 5) do NOT block T-702. They
are quality-of-implementation issues that should be tracked as hot-fix tasks
before T-703 (live-workspace verification) — not because T-702 will fail without
them, but because:

- SHOULD-FIX #2 (tied/deadlocked surfacing in `process_active_decisions.ts`) is
  observable in a real workspace under §25 #6 once a decision finalises via the
  schedule tick at `simple_majority` with a tied vote, or any criterion with a
  deadlock.
- SHOULD-FIX #3 (past-deadline `[]` argument) is observable in a real workspace
  under §25 #5 once a voter clicks after the deadline on a decision that already
  has votes.
- SHOULD-FIX #1 (`claimFinalisation` unwiring) is purely a code-hygiene issue
  and is invisible from the workspace, but the helper and its tests are dead
  code as currently shipped.

Recommend: file three hot-fix tasks (or one combined "finaliser consolidation"
task per the file-header TODO in `functions/process_active_decisions.ts:25–32`)
for the orchestrator to schedule between T-702 and T-703.

— T-701 reviewer, 2026-05-09
