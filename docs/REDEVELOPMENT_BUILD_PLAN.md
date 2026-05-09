# ConsensusBot — Re-development Build Plan

**Companion to:** `docs/REDEVELOPMENT_SPECIFICATION.md` (the SPEC).

**Purpose.** A reusable, swarm-executable plan for rebuilding ConsensusBot from
scratch. Each task is a self-contained brief with explicit inputs, deliverables,
dependencies, and verification steps. A coordinator agent reads this plan, the
SPEC, and the dependency graph, then dispatches one or more worker agents per
wave.

**Refactor note (2026-05-08).** This plan was rewritten to match the
audit-corrected SPEC. Major changes from the previous plan:

- New foundation tasks: `vote_history` datastore, `escape_slack`, `log`,
  `concurrency` utilities, tz-aware date helpers.
- `decision_logic` (T-104) completely rewritten for Robert's Rules + quorum.
- `create_decision` (T-301) rewritten for UUID-keyed decisions, rollback
  ordering, mrkdwn escape, tz-resolved deadlines, bot-filtered voters.
- `process_active_decisions` (T-302) replaces the reminder-only function; it now
  finalises past-deadline decisions then sends reminders.
- New integration tasks: `race`, `deactivation`, `deadline_finalisation`.
- Added a 4-PR merge-overlay (§F.5 of the audit).
- Added a `Spec Keeper` role.

**How to use this plan.**

1. A **coordinator** reads §1–§5, parses the YAML in Appendix B, and dispatches
   tasks wave-by-wave (or parallel-within-wave once dependencies are satisfied).
2. Each **worker** receives a task brief from §6, fetches the SPEC sections it
   names, produces only the deliverables it owns, and runs its acceptance
   commands locally before reporting "done".
3. After each wave, the coordinator runs the **wave gate** (§7).
4. A **reviewer** runs §8 between Wave 5 and Wave 7.
5. A **verifier** runs §9 at the end of Wave 7.
6. A **spec keeper** owns SPEC amendments during the build (§1, "Roles").

The SPEC is the source of truth for _what_ to build. This plan is the source of
truth for _who builds what when_.

---

## 1. Roles

| Role            | Who                            | Responsibility                                                                                                                                                            |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Coordinator** | One persistent agent           | Owns the plan. Dispatches workers, runs wave gates, merges branches.                                                                                                      |
| **Spec Keeper** | One persistent agent           | Owns the SPEC during the build. Reviews change requests; if accepted, edits the SPEC and triggers a partial rerun. The SPEC is read-only for everyone else during a wave. |
| **Scaffolder**  | One worker (Wave 0 only)       | Produces the empty repo skeleton.                                                                                                                                         |
| **Implementer** | Many workers (one per task)    | Writes one task's deliverables and unit tests.                                                                                                                            |
| **Integrator**  | One worker per wave            | Runs `deno task ci`, fixes formatting collisions, merges branches.                                                                                                        |
| **Reviewer**    | One worker (Wave 5.5 + Wave 7) | Independent code review against the SPEC. Cannot have implemented.                                                                                                        |
| **Verifier**    | One worker (Wave 7)            | Runs the §25 acceptance suite; gates "done".                                                                                                                              |

A worker SHOULD NOT take on a task whose dependencies have unmerged work.

The Spec Keeper is the only role that may modify
`docs/REDEVELOPMENT_SPECIFICATION.md` after Wave 0. Implementers wishing to
amend the SPEC must open a `spec-amend/...` PR for the Keeper to merge, which
then triggers a partial rerun of the affected waves.

---

## 2. Project invariants

Every worker, on every task, must hold these invariants. The Integrator enforces
them at each wave gate.

1. **Strict TypeScript.** `deno.jsonc` sets `strict: true`. No `any`. No
   `// @ts-ignore`. Use the `SlackClient` interface from `types/slack_types.ts`
   for every Slack client argument.
2. **Format compliance.** Run `deno fmt` before committing and accept its
   line-wrapping.
3. **Lint clean.** `deno lint` passes with zero warnings.
4. **Zero secrets.** No env-var reads, no API keys, no `outgoingDomains`.
5. **No external network at runtime.**
6. **Eventual-consistency safety.** Any code path that writes to a datastore and
   then reads back MUST merge the write into the read.
7. **Idempotent button handlers.** Every block-action handler validates current
   state via `apps.datastore.get` before acting; the finalisation path uses the
   `finalized_at` token (§16.3 of SPEC).
8. **No legacy code.** Do not produce `triggers/vote_button_trigger.ts`,
   `workflows/vote.ts`, `functions/record_vote.ts`, `send_reminders.ts`,
   `triggers/reminder_schedule.ts` (renamed). Retired or never-was.
9. **Single owner per file.** Within a wave, no two tasks write the same file
   path.
10. **Tests live with their code.** Implementation tasks include matching unit
    tests. Integration tests are their own tasks (Wave 5).
11. **All user-supplied text is escaped.** `decision_name` and `proposal` pass
    through `escapeSlackText` before any Slack-API call that renders them. ADR
    backticks are neutralised before code-fence wrap.
12. **Datastore-write-before-message-post ordering.** The `create_decision`
    function MUST persist all rows before posting the Slack message and MUST
    roll back on message-post failure (SPEC §8.4).
13. **UUID-keyed decisions.** `decision_id = crypto.randomUUID()`. No
    "{{decision_id}}" placeholder in button values.
14. **Bot filter is uniform.** Apply `is_bot && !USLACKBOT && !deleted` to
    **all** voter sources (individual, usergroup, channel-members).
15. **Workspace-tz deadlines.** Picked dates resolve to end-of-day in the
    workspace's IANA tz, not midnight UTC.
16. **Quorum-protected vote resolution.** No criterion may pass without
    `votes_cast >= quorum` (SPEC §15).
17. **Vote history on every change.** Every vote write produces a `vote_history`
    row with `event_kind: "cast"` or `"changed"`.
18. **Structured logging.** Every state transition emits a JSON log line via
    `utils/log.ts` with `{ event, decision_id, actor_id, result, ... }`.

Violations are wave-gate blockers, not warnings.

---

## 3. Wave overview

| Wave | Theme                              | Parallelism           | Gate                                                                       |
| ---- | ---------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| 0    | Scaffold                           | 1 worker              | Repo skeleton; `deno task fmt:check` passes empty-handed.                  |
| 1    | Pure foundations + their tests     | Up to 7 workers       | `deno task lint && deno task check && deno test --allow-all tests/` green. |
| 2    | ADR + mocks + remaining unit tests | Up to 4 workers       | Same as Wave 1.                                                            |
| 3    | Slack functions                    | Up to 2 workers       | Type-check + unit tests green.                                             |
| 4    | Workflows + triggers               | Up to 4 workers       | Type-check green.                                                          |
| 5    | Manifest + integration tests       | Up to 10 workers      | Full `deno task ci` green.                                                 |
| 5.5  | Independent code review            | 1 reviewer (blocking) | Reviewer signs off against SPEC §1–§20.                                    |
| 6    | Tooling, CI, deploy, docs          | Up to 6 workers       | `deno task ci` green; `scripts/deploy.sh` shellcheck-clean.                |
| 7    | Verification + e2e                 | 1 verifier            | All §25 acceptance criteria pass.                                          |

### 3.1 Dependency graph (high-level)

```
Wave 0 ── Wave 1 ── Wave 2 ── Wave 3 ── Wave 4 ── Wave 5 ── Wave 5.5 ── Wave 6 ── Wave 7
                                          │            │
                                          └────────────┘ (Wave 6 may run in parallel
                                                          with Wave 5 for tooling/docs.)
```

Per-task dependencies are precise — see Appendix B.

### 3.2 PR-merge overlay (audit §F.5)

Waves are work units. PRs are merge points. Group waves into four PRs so the
main branch stays buildable at PR boundaries:

| PR | Waves | Scope                                                          | Gate                                                                             |
| -- | ----- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1  | 0–1   | Foundation: scaffold, types, datastores, pure utilities.       | All §21.1 unit tests in scope green.                                             |
| 2  | 2     | Vote resolution, ADR, mocks. The semantic core of the rebuild. | §D.1 audit (vote-resolution tests) 100% green.                                   |
| 3  | 3–5   | Functions, workflows, triggers, manifest, integration tests.   | §D.2, §D.3 audit (concurrency / state-machine) green; full `deno task ci` green. |
| 4  | 6–7   | Tooling, deploy, docs, observability, e2e validation.          | §D.4–§D.10 green; manual e2e against live workspace passes.                      |

PRs are squash-merged into `main`. Branches are `build/<task-id>-<slug>` per
task; per-PR integration is the `build/integration-pr-<n>` branch.

---

## 4. Verification grammar

Every task declares an **Acceptance** block. Acceptance is the literal command
the worker runs to prove the task is complete. The wave gate re-runs them.
Acceptance commands MUST:

- Be deterministic.
- Exit non-zero on any failure.
- Not require live Slack credentials (Wave 7 is the only exception).

Standard acceptance subsets:

- `lint`: `deno lint <paths>`
- `fmt`: `deno fmt --check <paths>`
- `check`: `deno check <files>`
- `test`: `deno test --allow-all <test_files>`
- `ci`: `deno task ci`

---

## 5. Branch / merge protocol

- **Branching.** Each task ID is a branch: `build/<task-id>-<slug>`, e.g.
  `build/T-104-decision-logic`.
- **Single-file ownership.** A task owns the files listed in its `deliverables`.
  No other task in the same wave touches them.
- **Cross-task imports.** A task may import only from files produced by a task
  in its `depends_on` set or from `deno.land/x/` SDK paths.
- **Merging.** The Integrator merges in topological order at each wave gate.
  Conflicts are resolved by re-running `deno fmt`.
- **Rebasing.** Workers rebase onto the latest integration branch before
  acceptance.
- **PR boundary.** At the end of each PR's last wave, the integration branch is
  fast-forwarded onto `main` via squash-merge.

---

## 6. Task catalog

Each task brief includes a **prompt template** the Coordinator pastes verbatim
into the worker.

### Wave 0 — Scaffold

#### T-001 — Initialise repo skeleton

- **Wave:** 0
- **Depends on:** —
- **Owner role:** Scaffolder
- **SPEC sections:** §2, §3, §23
- **Deliverables:**
  - `deno.jsonc` (tasks, imports, strict TS, archive exclusions; no `start`
    task)
  - `slack.json` (with `deno_slack_hooks@1.5.0`)
  - `.gitignore`, `.slackignore`
  - `.githooks/pre-commit` (executable)
  - `manifest.ts` **stub** (compiles; empty `workflows`/`datastores`; full bot
    scopes from SPEC §4 including `pins:read` and `team:read`)
  - Empty directory placeholders: `datastores/`, `functions/`, `workflows/`,
    `triggers/`, `types/`, `utils/`, `scripts/`, `tests/`, `tests/integration/`,
    `tests/mocks/`, `docs/reviews/`, `.github/workflows/`
- **Acceptance:**
  - `deno fmt --check`
  - `deno lint`
  - `deno check manifest.ts`
- **Prompt template:**

  > Bootstrap an empty Slack ROSI Deno project. Read SPEC §2 (Tech Stack), §3
  > (Project Layout), §4 (Manifest), and §23 (Tooling). Produce `deno.jsonc`,
  > `slack.json`, `.gitignore`, `.slackignore`, `.githooks/pre-commit`
  > (executable), and a `manifest.ts` stub. The stub must already declare the
  > full 13-scope bot list from §4 (including `pins:read` and `team:read`) but
  > with empty `workflows` and `datastores` arrays. Create the empty directory
  > tree exactly as in §3 (use `.gitkeep` files where needed). Do not implement
  > any module yet. Run
  > `deno fmt --check && deno lint && deno check manifest.ts` and confirm green.

---

### Wave 1 — Pure foundations + their tests

These seven tasks are fully parallel. T-104 depends on T-101.

#### T-101 — Type definitions

- **Depends on:** T-001
- **SPEC sections:** §5.5, §20
- **Deliverables:** `types/decision_types.ts`, `types/slack_types.ts`,
  `tests/types_test.ts`
- **Acceptance:**
  - `deno check types/*.ts`
  - `deno test --allow-read --allow-env tests/types_test.ts`
- **Prompt template:**

  > Implement the type modules per SPEC §5.5 and §20. `decision_types.ts`
  > exports `DecisionRecord` (with the new `quorum`, `required_voters_count`,
  > `deadline_resolved`, `deadline_tz`, `outcome_reason`, `finalized_at`
  > fields), `VoteRecord`, `VoterRecord` (with `is_active`),
  > `VoteHistoryRecord`, and `DecisionItem`. `slack_types.ts` exports
  > `SlackClient` covering the full surface listed in §20 (note `team.info`,
  > `pins.list`, `users.info` returning `deleted`, cursor pagination on
  > `usergroups.*`), plus `SlackBlock`, `SlackElement`, `SlackTextObject`,
  > `SlackButtonElement`, `SlackUsergroupSummary`, `SlackUserInfo`. Then write
  > `tests/types_test.ts` covering all record interfaces, the `success_criteria`
  > and `status` enum domains, and the new fields. No `any`. Run acceptance.

#### T-102 — Date utilities (tz-aware)

- **Depends on:** T-001
- **SPEC sections:** §19
- **Deliverables:** `utils/date_utils.ts`, `tests/date_utils_test.ts`
- **Acceptance:**
  - `deno check utils/date_utils.ts`
  - `deno test --allow-read --allow-env tests/date_utils_test.ts`
- **Prompt template:**

  > Implement `utils/date_utils.ts` per SPEC §19. Exports: `addBusinessDays`,
  > `getDefaultDeadline`, `formatDate`,
  > `resolveDeadline(deadlineDate, workspaceTz)` (returns
  > `{ iso, tz,
  > humanDisplay }` end-of-day in tz, DST-aware),
  > `getWorkspaceTz(client)` (calls `team.info`, falls back to `Europe/London`),
  > `isDeadlinePassed(decision)` (compares `deadline_resolved` to now),
  > `formatDeadlineHuman(iso, tz)`. Use `Intl.DateTimeFormat({ timeZone })` for
  > tz arithmetic. Write `tests/date_utils_test.ts` covering: weekday skipping;
  > default deadline format; formatDate; `resolveDeadline` round-trip for both
  > BST (e.g. `2026-05-09` → `22:59:59.999Z`) and GMT (e.g. `2026-12-09` →
  > `23:59:59.999Z`); `isDeadlinePassed` with a tz-resolved future date;
  > `formatDeadlineHuman` rendering. Run acceptance.

#### T-103 — Slack parsing utilities

- **Depends on:** T-001
- **SPEC sections:** §14
- **Deliverables:** `utils/slack_parse.ts`, `tests/slack_parse_test.ts`
- **Acceptance:**
  - `deno check utils/slack_parse.ts`
  - `deno test --allow-read --allow-env tests/slack_parse_test.ts`
- **Prompt template:**

  > Implement `utils/slack_parse.ts` per SPEC §14.1 and §14.2. Exports:
  > `parseUserIds(input: string | string[]): string[]`,
  > `parseUsergroupInput(input: string | string[]): { ids: string[];
  > handles: string[]; broadcasts: string[] }`.
  > The `broadcasts` field captures `@here`, `@channel`, `@everyone` for the
  > caller to reject. Write `tests/slack_parse_test.ts` covering: each accepted
  > input format; comma/whitespace/newline separation; dedup; legacy-array
  > hatch; empty input; unrecognised tokens; broadcast detection. Run
  > acceptance.

#### T-104 — Decision logic (Robert's Rules + quorum)

- **Depends on:** T-101 (uses `VoteRecord`)
- **SPEC sections:** §15
- **Deliverables:** `utils/decision_logic.ts`, `tests/decision_logic_test.ts`
- **Acceptance:**
  - `deno check utils/decision_logic.ts`
  - `deno test --allow-read --allow-env tests/decision_logic_test.ts`
- **Prompt template:**

  > Implement `utils/decision_logic.ts` per SPEC §15. Pure functions only; no
  > I/O. Exports: `calculateVoteCounts`,
  > `calculateSimpleMajority(c, R,
  > quorum)`,
  > `calculateSupermajority(c, R, quorum)`,
  > `calculateUnanimity(c,
  > R, quorum)`,
  > `calculateDecisionOutcome(votes, criteria, R, quorum)`,
  > `checkDeadlock(votes, criteria, R, quorum)`, plus the interfaces
  > (`VoteCounts`, `DecisionResult` with `outcome` discriminator,
  > `DeadlockResult`). Use INTEGER ARITHMETIC: `yes*2 > yes+no`,
  > `yes*3 >=
  > (yes+no)*2`, etc. Reason strings must match SPEC §15 exactly,
  > including the `tied`/`deadlocked` outcome cases. Write
  > `tests/decision_logic_test.ts` covering at minimum the cases listed in audit
  > §D.1: 1-of-10 fails simple_majority on quorum; 67/33 passes super; 66/34
  > fails super; 5/5 produces `outcome: "tied"`; all-abstain fails with "no
  > decisive votes"; unanimity with abstentions passes; deadlock detection
  > across all three criteria. Run acceptance.

#### T-105 — Datastores (four)

- **Depends on:** T-001
- **SPEC sections:** §5.1, §5.2, §5.3, §5.4
- **Deliverables:** `datastores/decisions.ts`, `datastores/votes.ts`,
  `datastores/voters.ts`, `datastores/vote_history.ts`
- **Acceptance:** `deno check datastores/*.ts`
- **Prompt template:**

  > Implement four datastore definitions per SPEC §5.1–§5.4. Each file uses
  > `DefineDatastore` from `deno-slack-sdk/mod.ts`. Primary key is `id: string`.
  > New fields on `decisions`: `quorum: number`,
  > `required_voters_count: number`, `deadline_resolved: string`,
  > `deadline_tz: string`, `outcome_reason: string` (optional),
  > `finalized_at: string` (optional). New field on `voters`:
  > `is_active:
  > boolean`. New datastore `vote_history` per §5.4.
  > Default-export each.

#### T-106 — Slack-text escape + structured logger

- **Depends on:** T-001
- **SPEC sections:** §14.3, §23.5
- **Deliverables:** `utils/escape_slack.ts`, `utils/log.ts`,
  `tests/escape_slack_test.ts`, `tests/log_test.ts`
- **Acceptance:**
  - `deno check utils/escape_slack.ts utils/log.ts`
  - `deno test --allow-read --allow-env tests/escape_slack_test.ts tests/log_test.ts`
- **Prompt template:**

  > Implement `utils/escape_slack.ts` per SPEC §14.3: `escapeSlackText(input)`
  > replaces `<`/`>`/`&` with their HTML entities, sufficient to neutralise
  > `<@U…>`, `<!channel>`, `<!here>`, `<!everyone>`. Add a
  > `neutraliseBackticks(s)` helper for the ADR code-fence (replaces ``` with
  > `\`\`\``). Implement`utils/log.ts`per
  > SPEC §23.5: thin wrapper around`console.log`that emits one JSON
  > object per line with`level`,`event`, and merged context. Provide
  >`log.info`,`log.warn`,`log.error`.
  > Write tests covering: each escape rule; backtick neutralisation; that log
  > output is valid JSON with the expected shape. Run acceptance.

#### T-107 — Concurrency helpers

- **Depends on:** T-101 (uses `SlackClient`)
- **SPEC sections:** §16.4
- **Deliverables:** `utils/concurrency.ts`, `tests/concurrency_test.ts`
- **Acceptance:**
  - `deno check utils/concurrency.ts`
  - `deno test --allow-read --allow-env tests/concurrency_test.ts`
- **Prompt template:**

  > Implement `utils/concurrency.ts` per SPEC §16.4. Export
  > `reReadAndCheck<T>(client, datastore, id, expect)` which gets the row,
  > applies the `expect` predicate, and returns `{ ok: true; item }` or
  > `{ ok: false; reason }`. Also export `claimFinalisation(client, decision)`
  > which re-reads the decision and returns `false` if `finalized_at` is set,
  > otherwise sets `finalized_at = now` and returns `true` (best-effort
  > idempotency token). Write tests using a minimal in-memory mock that
  > exercise: predicate pass; predicate fail; not-found; `claimFinalisation`
  > first call returns true and second call returns false. Run acceptance.

---

### Wave 2 — ADR, mocks, remaining unit tests

#### T-201 — ADR generator

- **Depends on:** T-101, T-104, T-106 (escape)
- **SPEC sections:** §17
- **Deliverables:** `utils/adr_generator.ts`, `tests/adr_generator_test.ts`
- **Acceptance:**
  - `deno check utils/adr_generator.ts`
  - `deno test --allow-read --allow-env tests/adr_generator_test.ts`
- **Prompt template:**

  > Implement `utils/adr_generator.ts` per SPEC §17. Exports:
  > `generateADRMarkdown(decision, votes, voteHistory, outcome, userMap)` and
  > `formatADRForSlack(adrMarkdown)`. The markdown structure in §17.1 is
  > significant — copy verbatim, including new sections for `Vote
  > History`
  > (when changes occurred), `Excluded Voters` (when any deactivated), and
  > `Quorum`/`Decisive Votes`/`Required Voters
  > (effective)`. The suggested
  > filename includes the first 8 chars of `decision.id` (the UUID) for
  > collision resistance. User-supplied `decision.name` and `decision.proposal`
  > MUST be passed through `escapeSlackText` AND have triple-backticks
  > neutralised before rendering inside the code-fenced block. Write tests
  > covering: approved decision; rejected decision; abstain handling; missing
  > userMap fallback; vote-history rendering when changes occurred;
  > excluded-voters rendering; backticks-in-name do not break the fence;
  > deadlocked outcome reason rendering. Run acceptance.

#### T-202 — Mock Slack client + dependent unit tests

- **Depends on:** T-101
- **SPEC sections:** §20, §21
- **Deliverables:**
  - `tests/mocks/slack_client.ts`
  - `tests/usergroup_expansion_test.ts`
  - `tests/channel_members_test.ts`
- **Acceptance:**
  - `deno check tests/mocks/slack_client.ts`
  - `deno test --allow-all tests/usergroup_expansion_test.ts tests/channel_members_test.ts`
- **Prompt template:**

  > Build a `MockSlackClient` class in `tests/mocks/slack_client.ts` that
  > `implements SlackClient` per SPEC §20. The mock MUST cover the full surface
  > including `team.info`, `pins.list`, `users.info` with `deleted` flag, and
  > cursor-paginated `usergroups.list`, `usergroups.users.list`. Required
  > helpers: `setUsergroupMembers`, `setUsergroupsList`, `setChannelMembers`,
  > `setUserInfo`, `setUserDeleted(userId)`, `setTeamTz(tz)`,
  > `enableChannelMemberPagination`, `enableUsergroupPagination`,
  > `setDatastoreItem`, `setDatastoreQueryResults`,
  > `forceFailure(method, error)`, `getCallsFor`, `clearCalls`. Then write
  > `tests/usergroup_expansion_test.ts` and `tests/channel_members_test.ts` per
  > SPEC §21.1. The usergroup expansion suite MUST include a
  > paginated-`usergroups.list` test and a paginated-`usergroups.users.list`
  > test. The channel members suite MUST exercise the bot, USLACKBOT, and
  > deactivated-user filters. Run acceptance.

#### T-203 — Type-shape unit tests for create_decision

- **Depends on:** T-101
- **SPEC sections:** §21.1 (`create_decision_test.ts`)
- **Deliverables:** `tests/create_decision_test.ts`
- **Acceptance:**
  `deno test --allow-read --allow-env tests/create_decision_test.ts`
- **Note:** Shape tests only; do not import `functions/create_decision.ts`.
- **Prompt template:**

  > Write `tests/create_decision_test.ts` per SPEC §21.1. Exercises the
  > `SlackClient` shape against a minimal local mock (or import from
  > `tests/mocks/slack_client.ts`); `SlackBlock` shapes including the
  > five-button `actions` block; an `actions`-block transform that maps over
  > `elements` and rewrites `value` (UUID-shaped values, no `{{decision_id}}`
  > placeholder). Run acceptance.

#### T-204 — Vote-handler shape unit tests

- **Depends on:** T-101
- **SPEC sections:** §21.1 (`vote_handler_test.ts`)
- **Deliverables:** `tests/vote_handler_test.ts`
- **Acceptance:**
  `deno test --allow-read --allow-env tests/vote_handler_test.ts`
- **Prompt template:**

  > Write `tests/vote_handler_test.ts` covering: vote-type normalisation
  > (`replace(/^vote_/, "")`); `DecisionRecord` and `VoteRecord` shape including
  > the new `finalized_at` field; `VoteHistoryRecord` shape with
  > `event_kind: "cast" | "changed"`; event_seq generation logic (zero-padded
  > 4-digit count). Do not import any function file. Run acceptance.

#### T-205 — Process-active-decisions shape unit tests

- **Depends on:** T-101
- **SPEC sections:** §21.1 (`process_active_decisions_test.ts`)
- **Deliverables:** `tests/process_active_decisions_test.ts`
- **Acceptance:**
  `deno test --allow-read --allow-env tests/process_active_decisions_test.ts`
- **Prompt template:**

  > Write `tests/process_active_decisions_test.ts` covering: missing-voter
  > set-difference logic (excluding `is_active === false`); active-decision
  > filtering by status; deactivated-voter exclusion in the count; type casts on
  > query items. Do not import any function file. Run acceptance.

---

### Wave 3 — Slack functions

#### T-301 — `create_decision` function and handlers

- **Depends on:** T-101–T-107, T-201, T-202
- **SPEC sections:** §8, §9, §10, §11, §12, §13, §14, §16
- **Deliverables:** `functions/create_decision.ts`
- **Acceptance:**
  - `deno check functions/create_decision.ts`
  - `deno lint functions/create_decision.ts`
  - All Wave 1+2 unit tests still green.
- **Prompt template:**

  > Implement `functions/create_decision.ts` per SPEC §8–§13 and §16. Define
  > `CreateDecisionFunction` with the input schema in §8 (note: no
  > `output_parameters` — they are unused by design, §8.7). Required behaviour,
  > in order:
  >
  > 1. Pre-flight validation per §8.1 (channel type, voter input, broadcast
  >    handles, length guards, past-dated deadline).
  > 2. Voter resolution per §8.2 with bot filter applied uniformly to individual
  >    voters, usergroups, and channel members; cursor pagination on
  >    `usergroups.list` and `usergroups.users.list`; cached `users.info` to
  >    avoid duplicate calls.
  > 3. Deadline + quorum resolution per §8.3.
  > 4. Persistence + rollback ordering per §8.4: write decision first, write
  >    voters, post message, update decision with `message_ts`, pin. Roll back
  >    on any pre-message failure.
  > 5. Block Kit message per §8.5 with UUID-keyed buttons (no placeholder), all
  >    user-supplied text passed through `escapeSlackText` first.
  > 6. Three `addBlockActionsHandler` calls in this exact order:
  >    `["vote_yes","vote_no","vote_abstain"]` → vote handler (§9);
  >    `["decision_cancel"]` → cancel handler (§10); `["decision_delete"]` →
  >    delete handler (§11).
  > 7. Vote handler MUST: re-read decision; status guard; eligibility guard
  >    incl. `is_active`; past-deadline → trigger finalise without recording;
  >    persist vote; append `vote_history`; merge for eventual consistency
  >    (§16); update message; ephemeral confirm; maybe finalise.
  > 8. Cancel handler MUST use `reReadAndCheck` (T-107) for the status re-read.
  > 9. Delete handler MUST cascade across `vote_history`, `votes`, `voters`,
  >    `decisions` in that order.
  > 10. `checkIfShouldFinalize` and `finalizeDecision` per §12, §13;
  >     `finalizeDecision` claims the `finalized_at` token via
  >     `claimFinalisation` (T-107) before posting the ADR.
  > 11. Every state transition emits a structured log via `log.info`.
  > 12. The function returns `{ completed: false }` to keep block-action
  >     handlers alive (§8.7). Run `deno check`, `deno lint`, and the full
  >     unit-test suite; all must be green.

#### T-302 — `process_active_decisions` function

- **Depends on:** T-101, T-102, T-105, T-106, T-107
- **SPEC sections:** §18
- **Deliverables:** `functions/process_active_decisions.ts`
- **Acceptance:**
  - `deno check functions/process_active_decisions.ts`
  - `deno lint functions/process_active_decisions.ts`
- **Prompt template:**

  > Implement `functions/process_active_decisions.ts` per SPEC §18. Define
  > `ProcessActiveDecisionsFunction` (callback_id:
  > `process_active_decisions_function`) with no inputs and outputs
  > `{ reminders_sent: number, decisions_finalised: number }`. Two-phase logic
  > in order: (A) finalise every `active` decision whose deadline has passed —
  > call `finalizeDecision` (imported from `functions/create_decision.ts` OR
  > re-implemented locally if cleaner; document the choice); (B) for each
  > remaining active decision, query voters (refresh `is_active` via
  > `users.info(deleted)` as a side effect), compute missing voters, DM each.
  > Paginate the active- decisions query. Cap at 1000 active decisions per tick;
  > log a warning if exceeded. Catch and log per-DM failures without breaking
  > the loop. Run acceptance.

---

### Wave 4 — Workflows + triggers

These four tasks are parallel after Wave 3 lands.

#### T-401 — Create-decision workflow

- **Depends on:** T-301
- **SPEC sections:** §7.1
- **Deliverables:** `workflows/create_decision.ts`
- **Acceptance:** `deno check workflows/create_decision.ts`
- **Prompt template:**

  > Implement `workflows/create_decision.ts` per SPEC §7.1.
  > `callback_id: "create_decision_workflow"`. Step 1 is
  > `Schema.slack.functions.OpenForm` with the EIGHT fields and required list
  > listed in §7.1; the `success_criteria` enum + choices array; the new
  > optional `quorum_override` integer. Step 2 invokes `CreateDecisionFunction`
  > with form outputs + workflow `channel_id` + `user_id` (renamed
  > `creator_id`). Default-export.

#### T-402 — Process-active-decisions workflow

- **Depends on:** T-302
- **SPEC sections:** §7.2
- **Deliverables:** `workflows/process_active_decisions.ts`
- **Acceptance:** `deno check workflows/process_active_decisions.ts`
- **Prompt template:**

  > Implement `workflows/process_active_decisions.ts` per SPEC §7.2.
  > `callback_id: "process_active_decisions_workflow"`. No inputs. Single step:
  > invoke `ProcessActiveDecisionsFunction` with `{}`. Default-export.

#### T-403 — Slash-command trigger

- **Depends on:** T-401
- **SPEC sections:** §6.1
- **Deliverables:** `triggers/consensus_command.ts`
- **Acceptance:** `deno check triggers/consensus_command.ts`
- **Prompt template:**

  > Implement `triggers/consensus_command.ts` per SPEC §6.1. Type: `shortcut`.
  > Inputs map `interactivity`, `channel_id`, `user_id` from `{{data.*}}`.
  > Workflow reference uses the workflow's `callback_id`. Default-export.

#### T-404 — Scheduled trigger

- **Depends on:** T-402
- **SPEC sections:** §6.2
- **Deliverables:** `triggers/process_active_decisions_schedule.ts`
- **Acceptance:** `deno check triggers/process_active_decisions_schedule.ts`
- **Note:** The static `start_time` will drift; the _real_ trigger is created at
  deploy time from `scripts/deploy.sh` (T-601).
- **Prompt template:**

  > Implement `triggers/process_active_decisions_schedule.ts` per SPEC §6.2.
  > Type `scheduled`, weekly cadence Mon–Fri 09:00 UTC. Pick a `start_time`
  > placeholder timestamp far in the future as a documentation reference; the
  > deploy script overrides at deploy time. Default-export.

---

### Wave 5 — Manifest finalisation + integration tests

#### T-501 — Manifest finalisation

- **Depends on:** T-105, T-401, T-402
- **SPEC sections:** §4
- **Deliverables:** `manifest.ts` (final, replacing scaffold stub)
- **Acceptance:** `deno check manifest.ts`
- **Prompt template:**

  > Replace the scaffold `manifest.ts` with the final wiring per SPEC §4. Import
  > all four datastores and both workflows. Register all in their respective
  > arrays. Bot scopes must match the 13-entry list in §4 exactly (note
  > `pins:read`, `team:read`, retain `chat:write.public`).
  > `outgoingDomains: []`. Run `deno check`.

Tasks T-502 through T-510 are parallel after T-301, T-302, T-202 are merged.

#### T-502 — Integration: create_decision (incl. EC + UUID + rollback)

- **Depends on:** T-301, T-202
- **SPEC sections:** §8, §16
- **Deliverables:** `tests/integration/create_decision_test.ts`
- **Acceptance:**
  `deno test --allow-all tests/integration/create_decision_test.ts`
- **Prompt template:**

  > Write `tests/integration/create_decision_test.ts` per SPEC §21.2. Tests MUST
  > include: UUID format on `decision_id`; tz-resolved deadline produces
  > `humanDisplay` with the expected workspace tz; bot filter excludes
  > is_bot/deleted/USLACKBOT uniformly; rollback — forced `apps.datastore.put`
  > failure on the decision row leaves no orphan rows or messages; rollback —
  > forced `chat.postMessage` failure deletes any voter rows already written;
  > the three eventual-consistency cases from SPEC §16 (vote-merge adds missing
  > vote, vote-merge replaces stale row, `checkIfShouldFinalize` skips votes
  > query). Use `MockSlackClient` and its `forceFailure` helper. Run acceptance.

#### T-503 — Integration: vote handler (incl. post-deadline + history)

- **Depends on:** T-301, T-202
- **SPEC sections:** §9, §16
- **Deliverables:** `tests/integration/vote_handler_test.ts`
- **Acceptance:** `deno test --allow-all tests/integration/vote_handler_test.ts`
- **Prompt template:**

  > Write `tests/integration/vote_handler_test.ts` covering: yes/no/ abstain put
  > paired with a `vote_history` `cast` event; vote-update path overwrites votes
  > row AND appends a `vote_history` `changed` event with `previous_vote_type`;
  > post-vote message update; vote query; ephemeral confirm; vote-type
  > normalisation; **vote-after- deadline triggers finalisation without
  > recording the vote**; the eventual-consistency vote merge. Run acceptance.

#### T-504 — Integration: process_active_decisions

- **Depends on:** T-302, T-202
- **SPEC sections:** §18
- **Deliverables:** `tests/integration/process_active_decisions_test.ts`
- **Acceptance:**
  `deno test --allow-all tests/integration/process_active_decisions_test.ts`
- **Prompt template:**

  > Write `tests/integration/process_active_decisions_test.ts` covering: Phase A
  > finalises a past-deadline decision (status flip, ADR posted, `finalized_at`
  > set); Phase A respects the idempotency token (already finalised → skipped);
  > Phase B sends DMs only to active non-voters; deactivated-user side effect —
  > `is_active` flipped to false; rate- limit-failure on one DM does not break
  > the loop; pagination of the active-decisions query; the 1000-decision soft
  > cap logs a warning. Run acceptance.

#### T-505 — Integration: cancel + delete (re-read-and-bail)

- **Depends on:** T-301, T-202, T-107
- **SPEC sections:** §10, §11, §16.4
- **Deliverables:** `tests/integration/cancel_delete_test.ts`
- **Acceptance:**
  `deno test --allow-all tests/integration/cancel_delete_test.ts`
- **Prompt template:**

  > Write `tests/integration/cancel_delete_test.ts` covering: cancel transitions
  > status to `cancelled` atomically (re-read+predicate); cancel rejects when
  > the row has already been finalised between read and put — ephemeral "just
  > finalised — cannot cancel"; pin probe via `pins.list` skips remove when not
  > pinned; delete authorisation rejects non-creator with creator-only
  > ephemeral; cascade delete order is `vote_history` → `votes` → `voters` →
  > `decisions`; chat.delete fallback to chat.update on too-old message;
  > ephemeral confirmations. Run acceptance.

#### T-506 — Integration: channel members

- **Depends on:** T-301, T-202
- **SPEC sections:** §8.2, §21.2
- **Deliverables:** `tests/integration/channel_members_integration_test.ts`
- **Acceptance:**
  `deno test --allow-all tests/integration/channel_members_integration_test.ts`
- **Prompt template:**

  > Write `tests/integration/channel_members_integration_test.ts` covering:
  > channel expansion populates voters; bot/USLACKBOT/deactivated users filtered
  > out uniformly; dedup with individual + usergroup; pagination via
  > `next_cursor`; backward-compat no-op when `include_channel_members=false`;
  > end-to-end combined flow with all three sources. Run acceptance.

#### T-507 — Integration: usergroups

- **Depends on:** T-301, T-202
- **SPEC sections:** §8.2, §14, §21.2
- **Deliverables:** `tests/integration/usergroup_integration_test.ts`
- **Acceptance:**
  `deno test --allow-all tests/integration/usergroup_integration_test.ts`
- **Prompt template:**

  > Write `tests/integration/usergroup_integration_test.ts` covering:
  > multi-group expansion stores all members; overlapping groups dedup;
  > **broadcast handles (`@here`, `@channel`, `@everyone`) rejected at
  > validation**; bot filter applied to usergroup members; paginated
  > `usergroups.list` and `usergroups.users.list`; backward-compat when no
  > usergroups; message mentions render correctly. Run acceptance.

#### T-508 — Integration: deadline finalisation (NEW)

- **Depends on:** T-301, T-302, T-202
- **SPEC sections:** §9 step 5, §13, §18.1
- **Deliverables:** `tests/integration/deadline_finalisation_test.ts`
- **Acceptance:**
  `deno test --allow-all tests/integration/deadline_finalisation_test.ts`
- **Prompt template:**

  > Write `tests/integration/deadline_finalisation_test.ts` covering: a
  > past-deadline `active` decision is finalised by Phase A of the scheduled
  > tick; a vote click after the deadline triggers finalisation, no `votes` row
  > written, no `vote_history` row written; if the scheduled tick and a vote
  > click race, exactly one ADR is posted (`finalized_at` token); a decision
  > finalised without any votes resolves with
  > `outcome_reason: "Quorum not met (0 of K
  > required)"`. Run acceptance.

#### T-509 — Integration: voter deactivation (NEW)

- **Depends on:** T-301, T-302, T-202
- **SPEC sections:** §13, §18.2
- **Deliverables:** `tests/integration/deactivation_test.ts`
- **Acceptance:** `deno test --allow-all tests/integration/deactivation_test.ts`
- **Prompt template:**

  > Write `tests/integration/deactivation_test.ts` covering: a voter deactivated
  > mid-flight (mock returns `deleted: true`) is excluded from `R_effective` at
  > finalisation; the voter row's `is_active` is flipped to `false` during the
  > next reminder run; if all voters deactivate, the decision auto-cancels with
  > `outcome_reason: "no
  > eligible voters remain"` rather than hanging; the
  > ADR's "Excluded Voters" section lists the deactivated users. Run acceptance.

#### T-510 — Integration: race conditions (NEW)

- **Depends on:** T-301, T-202, T-107
- **SPEC sections:** §16
- **Deliverables:** `tests/integration/race_test.ts`
- **Acceptance:** `deno test --allow-all tests/integration/race_test.ts`
- **Prompt template:**

  > Write `tests/integration/race_test.ts` exercising the concurrency model from
  > SPEC §16. Use the mock's call-injection to simulate two simultaneous
  > `vote_yes` clicks on a 2-voter decision; assert exactly one ADR is posted
  > (the second `claimFinalisation` returns false and skips). Simulate
  > cancel-vs-vote-finalise race: the second-arriving write surfaces an explicit
  > "just finalised" or "just cancelled" ephemeral. Same user clicking the same
  > button twice produces exactly one `vote_history` row with
  > `event_kind: "cast"`. Run acceptance.

---

### Wave 5.5 — Independent code review

#### T-551 — SPEC conformance review

- **Wave:** 5.5
- **Depends on:** all Wave 1–5 tasks merged, `deno task ci` green
- **Owner role:** Reviewer (must not have implemented)
- **Deliverables:** `docs/reviews/wave-5-review.md` (findings + fixes required),
  or a sign-off if none
- **Acceptance:** Reviewer signs off OR opens follow-up tasks for the
  Coordinator to schedule before Wave 6.
- **Prompt template:**

  > Independently review the entire Wave 1–5 implementation against
  > `docs/REDEVELOPMENT_SPECIFICATION.md`. For each SPEC section §1–§20,
  > identify any divergence, ambiguity, or missing assertion. Pay particular
  > attention to: literal strings (reason text in §15, ADR template in §17,
  > error messages in §8.1, §9, §11); the eventual-consistency merge AND
  > `finalized_at` token (§16); the manifest scope list (§4); the rollback
  > ordering in `create_decision` §8.4; the bot filter applied uniformly to all
  > three voter sources (§8.2); UUID-keyed buttons (no `{{decision_id}}`
  > placeholder anywhere); tz-aware deadline resolution (§19). Produce
  > `docs/reviews/wave-5-review.md` listing findings as
  > `MUST-FIX |
  > SHOULD-FIX | NIT`. If clean, write a one-line sign-off. Do
  > not modify source.

---

### Wave 6 — Tooling, CI, deploy, docs

These tasks are parallel.

#### T-601 — Real `scripts/deploy.sh`

- **Depends on:** T-403, T-404, T-501
- **SPEC sections:** §6.2, §22, §24
- **Deliverables:** `scripts/deploy.sh` (executable bash, `set -euo pipefail`)
- **Acceptance:**
  - `bash -n scripts/deploy.sh`
  - `shellcheck scripts/deploy.sh` if available
- **Prompt template:**

  > Write `scripts/deploy.sh` (executable, `#!/usr/bin/env bash`,
  > `set
  > -euo pipefail`) that: runs `slack deploy`; computes the next
  > weekday at 09:00 UTC as ISO-8601; writes a temp trigger definition mirroring
  > `triggers/process_active_decisions_schedule.ts` but with the computed
  > `start_time`; calls `slack triggers create --trigger-def
  > <tmpfile>` if
  > no existing scheduled trigger named "Process Active Decisions" is in
  > `slack triggers list`; calls
  > `slack triggers create --trigger-def triggers/consensus_command.ts` if the
  > slash-command trigger is missing; cleans the temp file on exit (`trap`).
  > Echo progress at each step.

#### T-602 — CI workflow

- **Depends on:** T-001
- **SPEC sections:** §23.3
- **Deliverables:** `.github/workflows/ci.yml`
- **Acceptance:** YAML lints clean and the file is the only workflow under
  `.github/workflows/`.
- **Prompt template:**

  > Write a single `.github/workflows/ci.yml` per SPEC §23.3 — checkout,
  > setup-deno (v1.x), then `deno task fmt:check`, `deno task lint`,
  > `deno task check`, `deno task test`. Triggers: push on `main`, all pull
  > requests. `permissions: { contents: read }`. Do not produce any other
  > workflow file.

#### T-603 — Pre-commit hook (final form)

- **Depends on:** T-001
- **SPEC sections:** §23.2
- **Deliverables:** `.githooks/pre-commit`
- **Acceptance:** `bash -n .githooks/pre-commit`
- **Prompt template:**

  > Verify `.githooks/pre-commit` matches SPEC §23.2 verbatim. Ensure executable
  > bit (`chmod +x`).

#### T-604 — Top-level docs

- **Depends on:** all Wave 5 done
- **SPEC sections:** §1, §2, §24
- **Deliverables:** `README.md`, `DEVELOPMENT.md`, `DEPLOYMENT.md`,
  `SECURITY.md`, `AGENTS.md`
- **Acceptance:** `deno fmt --check *.md` and a manual smoke read.
- **Prompt template:**

  > Write the five top-level docs. Source-of-truth: SPEC §1 (mission), §2
  > (stack), §23 (tooling), §24 (deploy). `README.md` covers usage,
  > vote-resolution semantics (Robert's Rules + quorum, abstain rule), and dev
  > quickstart. `DEPLOYMENT.md` follows §24 — do **not** mention
  > `triggers/vote_button_trigger.ts`. `AGENTS.md` documents the contributor
  > workflow. `SECURITY.md` reflects zero-secret design and calls out the
  > `pins:read` and `team:read` scope additions over the previous version. Run
  > `deno fmt --check *.md`.

#### T-605 — Contributor metadata

- **Depends on:** T-001
- **SPEC sections:** §23.4
- **Deliverables:** `.github/copilot-instructions.md`,
  `.github/pull_request_template.md`
- **Acceptance:** `deno fmt --check .github/*.md`
- **Prompt template:**

  > Produce `.github/copilot-instructions.md` and
  > `.github/pull_request_template.md` per SPEC §23.4. The copilot file mandates
  > `deno fmt`, `deno lint`, and `deno task ci` before commits; forbids
  > modifying CI YAML, `deno.jsonc`, or the PR template; forbids "checks blocked
  > by network" excuses. The PR template is a checklist confirming each
  > `deno task` ran clean.

#### T-606 — `docs/` artefacts

- **Depends on:** T-001
- **SPEC sections:** §3
- **Deliverables:**
  - `docs/REDEVELOPMENT_SPECIFICATION.md` (carried forward as-is)
  - `docs/REDEVELOPMENT_BUILD_PLAN.md` (this file)
  - `docs/SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md`
  - `docs/templates/adr-template.md`, `docs/templates/feature-spec-template.md`
  - `docs/adr/0001-use-slack-bolt-framework.md` (historical, marked Azure era)
- **Acceptance:** `deno fmt --check docs/`
- **Prompt template:**

  > Populate `docs/` with the artefacts listed. The architecture re-evaluation
  > and templates can be lifted from the source repo; the SPEC and PLAN are this
  > rebuild's source of truth and must be carried forward verbatim. Mark
  > `0001-use-slack-bolt-framework.md` as a historical (Azure-era) record at the
  > top.

---

### Wave 7 — Verification and e2e

#### T-701 — Final reviewer pass

- **Depends on:** all Wave 6 merged
- **Owner role:** Reviewer
- **Deliverables:** `docs/reviews/wave-7-review.md` or sign-off
- **Acceptance:** Reviewer signs off; any MUST-FIX is escalated to a hot-fix
  task before T-702.
- **Prompt template:**

  > Repeat the SPEC-conformance review against the full repo (now including docs
  > and tooling). Cross-check: no orphaned legacy files
  > (`vote_button_trigger.ts`, `workflows/vote.ts`, `record_vote.ts`,
  > `send_reminders.ts` — the latter renamed to `process_active_decisions.ts`);
  > `scripts/deploy.sh` is bash, not markdown; SPEC §22 backlog items are
  > accurately reflected as deferred (not silently implemented or silently
  > dropped); manifest scope list matches SPEC §4 exactly. Sign off or list
  > MUST-FIX items.

#### T-702 — Acceptance suite (no live workspace)

- **Depends on:** T-701 sign-off
- **SPEC sections:** §25
- **Deliverables:** `docs/reviews/acceptance-report.md`
- **Acceptance:** §25 #1, #2, #8, #11, #12 pass. #3–#7, #9, #10 deferred to
  T-703.
- **Prompt template:**

  > From a fresh clone, run `deno task ci`. Every test in SPEC §21 must pass.
  > Verify SPEC §25 by inspection: #1 (`deno task ci` green); #2 (every §21 test
  > green); #8 (vote resolution holds for all three criteria with quorum;
  > 1-of-10 yes does NOT pass); #11 (vote-history rows produced on change); #12
  > (zero secrets — no `Deno.env.get` in source). Write
  > `docs/reviews/acceptance-report.md` summarising results.

#### T-703 — Live workspace e2e

- **Depends on:** T-702 green
- **Owner role:** Verifier (with workspace credentials)
- **Deliverables:** Append e2e results to `docs/reviews/acceptance-report.md`.
- **Acceptance:** SPEC §25 criteria #3–#7, #9, #10 pass against a real Pro-tier
  workspace.
- **Prompt template:**

  > Deploy to a fresh Slack workspace via
  > `slack create && slack deploy && ./scripts/deploy.sh`. Run the §25 #3–#7,
  > #9, #10 checklist: `/consensus` modal; six-block voting message with
  > UUID-valued buttons; vote behaviours (yes/no/abstain update + ephemeral,
  > vote-after-deadline triggers finalise, cancel, delete); finalisation by
  > deadline tick produces ADR; reminder DMs; tz-resolved deadline rendering on
  > a London-tz workspace (`humanDisplay` shows "BST"/"GMT" appropriately around
  > DST); deactivated-voter exclusion. Append the result to the acceptance
  > report. If any check fails, file a hot-fix task and rerun.

---

## 7. Wave gates (Coordinator runbook)

Between waves, the Coordinator runs:

```bash
git fetch --all
git checkout main
git merge --ff-only build/integration

deno task fmt:check
deno task lint
deno task check
deno task test
```

If any check fails, the Coordinator opens a fix task for the offending worker
and does NOT open the next wave until green.

The `build/integration` branch is the rolling integration target; per- task
branches are merged into it during the wave, then it fast-forwards onto `main`
at the wave gate.

At the end of each PR's last wave (per §3.2), `build/integration` squash-merges
into `main` and the next PR's branch is created.

---

## 8. Reviewer protocol (T-551, T-701)

The Reviewer:

1. Reads only the SPEC + the source tree, not this plan.
2. Walks SPEC §1–§20 in order; for each section, identifies the file(s) that
   should implement it and verifies behaviour.
3. Spot-checks literal strings (error messages, ADR template, reason text)
   against the SPEC. These are pinned by integration tests, but the Reviewer is
   the human in the loop for typos the regex doesn't catch.
4. Greps for forbidden patterns:
   - `\bany\b` in `*.ts` outside comments and `Record<string, any>` (none
     allowed).
   - `// @ts-ignore` (none allowed).
   - `process.env`, `Deno.env.get` (none allowed except in tests).
   - `vote_button_trigger`, `record_vote_function`, `vote_workflow`,
     `send_reminders_function`, `send_reminders_workflow`, `reminder_schedule`
     (all retired or renamed).
   - `{{decision_id}}` in any non-comment context (UUID-keyed buttons only, no
     placeholder).
   - `(yes / total)` or `(yes / requiredVotersCount) * 100` outside the
     `decision_logic.ts` percentage-display path (integer arithmetic only for
     pass/fail).
5. Files findings as `MUST-FIX | SHOULD-FIX | NIT`. MUST-FIX blocks the wave
   gate.

---

## 9. Verifier protocol (T-702, T-703)

T-702 is purely automated:

```bash
git clone <repo> consensusbot && cd consensusbot
deno task ci
```

T-703 requires a Slack workspace on the Pro plan or higher. The Verifier follows
SPEC §24 deploy steps, then walks the §25 #3–#7, #9, #10 checklist manually,
taking screenshots into `docs/reviews/acceptance-report.md`.

---

## 10. Risk register

| Risk                                                                    | Likelihood | Mitigation                                                                                                               |
| ----------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Two workers race on the same file in a wave                             | Low        | Single-file ownership rule (invariant #9). Coordinator validates branch deliverable lists at dispatch.                   |
| `deno fmt` rewrites a worker's output and breaks an assertion           | Low        | Workers run `deno fmt` _before_ writing tests. Acceptance includes `fmt:check`.                                          |
| Eventual-consistency merge logic diverges from `finalized_at` semantics | Medium     | T-301 implements both; T-502, T-510 cross-check; T-551 reviewer spot-checks.                                             |
| SPEC drift during long swarm runs                                       | Medium     | The SPEC is read-only during a wave. Edits route through the Spec Keeper via a `spec-amend/...` PR with a partial rerun. |
| Stale `start_time` blocks reminder trigger creation                     | High       | T-601 explicitly computes a future `start_time` at deploy time. The static file in T-404 is documentation only.          |
| Test/source files lifted verbatim from old repo without adapting        | Medium     | Each task brief tells the worker to _implement per SPEC_, not copy. Reviewer flags any file that looks copied.           |
| Vote-resolution model drift to floating-point comparisons               | Medium     | Reviewer's grep list includes `* 100` as a smell (display only); integer-arithmetic asserts in T-104 tests.              |
| ADR code-fence broken by user-supplied backticks                        | Medium     | T-201 mandates `neutraliseBackticks`; integration tests pass a backtick-laden proposal.                                  |
| Tz resolution wrong for non-Europe/London workspaces                    | Medium     | T-102 tests both BST and GMT plus DST transitions; mock `setTeamTz` covers other zones.                                  |
| Voter-deactivation handling disagrees between reminder and finalisation | Low        | T-509 covers both paths; T-302 and T-301 share the `is_active` semantics.                                                |

---

## 11. Glossary

- **SPEC** — `docs/REDEVELOPMENT_SPECIFICATION.md`. Source of truth for
  behaviour.
- **PLAN** — this file. Source of truth for execution.
- **Wave** — a set of tasks that may run in parallel.
- **Wave gate** — a `deno task ci` checkpoint between waves.
- **PR boundary** — the merge from `build/integration` to `main` at the end of
  each PR's last wave (§3.2).
- **ROSI** — Run on Slack Infrastructure (Slack's managed Deno runtime).
- **Block-action handler** — a handler chained off a `SlackFunction` via
  `addBlockActionsHandler` for incoming `block_actions` events. **The** pattern
  for voting buttons (SPEC §6.3, §8.6).
- **Idempotency token** — `decision.finalized_at`. See SPEC §16.3.
- **Eventual consistency / vote-merge** — see SPEC §16.1, §16.2.
- **Robert's Rules vote model** — abstain excluded from numerator AND
  denominator, with quorum. See SPEC §15.

---

## Appendix A — File → task index

| File                                                                       | Owning task   |
| -------------------------------------------------------------------------- | ------------- |
| `manifest.ts` (stub)                                                       | T-001         |
| `manifest.ts` (final)                                                      | T-501         |
| `deno.jsonc`                                                               | T-001         |
| `slack.json`                                                               | T-001         |
| `.gitignore`, `.slackignore`                                               | T-001         |
| `.githooks/pre-commit`                                                     | T-001 / T-603 |
| `types/decision_types.ts`, `types/slack_types.ts`                          | T-101         |
| `tests/types_test.ts`                                                      | T-101         |
| `utils/date_utils.ts`                                                      | T-102         |
| `tests/date_utils_test.ts`                                                 | T-102         |
| `utils/slack_parse.ts`                                                     | T-103         |
| `tests/slack_parse_test.ts`                                                | T-103         |
| `utils/decision_logic.ts`                                                  | T-104         |
| `tests/decision_logic_test.ts`                                             | T-104         |
| `datastores/decisions.ts`, `votes.ts`, `voters.ts`, `vote_history.ts`      | T-105         |
| `utils/escape_slack.ts`, `utils/log.ts`                                    | T-106         |
| `tests/escape_slack_test.ts`, `tests/log_test.ts`                          | T-106         |
| `utils/concurrency.ts`                                                     | T-107         |
| `tests/concurrency_test.ts`                                                | T-107         |
| `utils/adr_generator.ts`                                                   | T-201         |
| `tests/adr_generator_test.ts`                                              | T-201         |
| `tests/mocks/slack_client.ts`                                              | T-202         |
| `tests/usergroup_expansion_test.ts`                                        | T-202         |
| `tests/channel_members_test.ts`                                            | T-202         |
| `tests/create_decision_test.ts`                                            | T-203         |
| `tests/vote_handler_test.ts`                                               | T-204         |
| `tests/process_active_decisions_test.ts`                                   | T-205         |
| `functions/create_decision.ts`                                             | T-301         |
| `functions/process_active_decisions.ts`                                    | T-302         |
| `workflows/create_decision.ts`                                             | T-401         |
| `workflows/process_active_decisions.ts`                                    | T-402         |
| `triggers/consensus_command.ts`                                            | T-403         |
| `triggers/process_active_decisions_schedule.ts`                            | T-404         |
| `tests/integration/create_decision_test.ts`                                | T-502         |
| `tests/integration/vote_handler_test.ts`                                   | T-503         |
| `tests/integration/process_active_decisions_test.ts`                       | T-504         |
| `tests/integration/cancel_delete_test.ts`                                  | T-505         |
| `tests/integration/channel_members_integration_test.ts`                    | T-506         |
| `tests/integration/usergroup_integration_test.ts`                          | T-507         |
| `tests/integration/deadline_finalisation_test.ts`                          | T-508         |
| `tests/integration/deactivation_test.ts`                                   | T-509         |
| `tests/integration/race_test.ts`                                           | T-510         |
| `scripts/deploy.sh`                                                        | T-601         |
| `.github/workflows/ci.yml`                                                 | T-602         |
| `README.md`, `DEVELOPMENT.md`, `DEPLOYMENT.md`, `SECURITY.md`, `AGENTS.md` | T-604         |
| `.github/copilot-instructions.md`, `.github/pull_request_template.md`      | T-605         |
| `docs/*`                                                                   | T-606         |

---

## Appendix B — Machine-readable task graph

A coordinator can parse this YAML to drive dispatch. Every entry includes `id`,
`wave`, `pr`, `depends_on`, `deliverables`, `accept`. The `pr` field indicates
which of the four PRs from §3.2 the task belongs to.

```yaml
tasks:
  - id: T-001
    wave: 0
    pr: 1
    depends_on: []
    deliverables:
      - deno.jsonc
      - slack.json
      - .gitignore
      - .slackignore
      - .githooks/pre-commit
      - manifest.ts # stub
    accept: ["deno fmt --check", "deno lint", "deno check manifest.ts"]

  - id: T-101
    wave: 1
    pr: 1
    depends_on: [T-001]
    deliverables:
      - types/decision_types.ts
      - types/slack_types.ts
      - tests/types_test.ts
    accept:
      - deno check types/decision_types.ts types/slack_types.ts
      - deno test --allow-read --allow-env tests/types_test.ts

  - id: T-102
    wave: 1
    pr: 1
    depends_on: [T-001]
    deliverables:
      - utils/date_utils.ts
      - tests/date_utils_test.ts
    accept:
      - deno check utils/date_utils.ts
      - deno test --allow-read --allow-env tests/date_utils_test.ts

  - id: T-103
    wave: 1
    pr: 1
    depends_on: [T-001]
    deliverables:
      - utils/slack_parse.ts
      - tests/slack_parse_test.ts
    accept:
      - deno check utils/slack_parse.ts
      - deno test --allow-read --allow-env tests/slack_parse_test.ts

  - id: T-104
    wave: 1
    pr: 1
    depends_on: [T-101]
    deliverables:
      - utils/decision_logic.ts
      - tests/decision_logic_test.ts
    accept:
      - deno check utils/decision_logic.ts
      - deno test --allow-read --allow-env tests/decision_logic_test.ts

  - id: T-105
    wave: 1
    pr: 1
    depends_on: [T-001]
    deliverables:
      - datastores/decisions.ts
      - datastores/votes.ts
      - datastores/voters.ts
      - datastores/vote_history.ts
    accept:
      - deno check datastores/decisions.ts datastores/votes.ts datastores/voters.ts datastores/vote_history.ts

  - id: T-106
    wave: 1
    pr: 1
    depends_on: [T-001]
    deliverables:
      - utils/escape_slack.ts
      - utils/log.ts
      - tests/escape_slack_test.ts
      - tests/log_test.ts
    accept:
      - deno check utils/escape_slack.ts utils/log.ts
      - deno test --allow-read --allow-env tests/escape_slack_test.ts tests/log_test.ts

  - id: T-107
    wave: 1
    pr: 1
    depends_on: [T-101]
    deliverables:
      - utils/concurrency.ts
      - tests/concurrency_test.ts
    accept:
      - deno check utils/concurrency.ts
      - deno test --allow-read --allow-env tests/concurrency_test.ts

  - id: T-201
    wave: 2
    pr: 2
    depends_on: [T-101, T-104, T-106]
    deliverables:
      - utils/adr_generator.ts
      - tests/adr_generator_test.ts
    accept:
      - deno check utils/adr_generator.ts
      - deno test --allow-read --allow-env tests/adr_generator_test.ts

  - id: T-202
    wave: 2
    pr: 2
    depends_on: [T-101]
    deliverables:
      - tests/mocks/slack_client.ts
      - tests/usergroup_expansion_test.ts
      - tests/channel_members_test.ts
    accept:
      - deno check tests/mocks/slack_client.ts
      - deno test --allow-all tests/usergroup_expansion_test.ts tests/channel_members_test.ts

  - id: T-203
    wave: 2
    pr: 2
    depends_on: [T-101]
    deliverables:
      - tests/create_decision_test.ts
    accept:
      - deno test --allow-read --allow-env tests/create_decision_test.ts

  - id: T-204
    wave: 2
    pr: 2
    depends_on: [T-101]
    deliverables:
      - tests/vote_handler_test.ts
    accept:
      - deno test --allow-read --allow-env tests/vote_handler_test.ts

  - id: T-205
    wave: 2
    pr: 2
    depends_on: [T-101]
    deliverables:
      - tests/process_active_decisions_test.ts
    accept:
      - deno test --allow-read --allow-env tests/process_active_decisions_test.ts

  - id: T-301
    wave: 3
    pr: 3
    depends_on: [T-101, T-102, T-103, T-104, T-105, T-106, T-107, T-201, T-202]
    deliverables:
      - functions/create_decision.ts
    accept:
      - deno check functions/create_decision.ts
      - deno lint functions/create_decision.ts
      - deno test --allow-all tests/

  - id: T-302
    wave: 3
    pr: 3
    depends_on: [T-101, T-102, T-105, T-106, T-107]
    deliverables:
      - functions/process_active_decisions.ts
    accept:
      - deno check functions/process_active_decisions.ts
      - deno lint functions/process_active_decisions.ts

  - id: T-401
    wave: 4
    pr: 3
    depends_on: [T-301]
    deliverables: [workflows/create_decision.ts]
    accept: [deno check workflows/create_decision.ts]

  - id: T-402
    wave: 4
    pr: 3
    depends_on: [T-302]
    deliverables: [workflows/process_active_decisions.ts]
    accept: [deno check workflows/process_active_decisions.ts]

  - id: T-403
    wave: 4
    pr: 3
    depends_on: [T-401]
    deliverables: [triggers/consensus_command.ts]
    accept: [deno check triggers/consensus_command.ts]

  - id: T-404
    wave: 4
    pr: 3
    depends_on: [T-402]
    deliverables: [triggers/process_active_decisions_schedule.ts]
    accept: [deno check triggers/process_active_decisions_schedule.ts]

  - id: T-501
    wave: 5
    pr: 3
    depends_on: [T-105, T-401, T-402]
    deliverables: [manifest.ts]
    accept: [deno check manifest.ts]

  - id: T-502
    wave: 5
    pr: 3
    depends_on: [T-301, T-202]
    deliverables: [tests/integration/create_decision_test.ts]
    accept: [deno test --allow-all tests/integration/create_decision_test.ts]

  - id: T-503
    wave: 5
    pr: 3
    depends_on: [T-301, T-202]
    deliverables: [tests/integration/vote_handler_test.ts]
    accept: [deno test --allow-all tests/integration/vote_handler_test.ts]

  - id: T-504
    wave: 5
    pr: 3
    depends_on: [T-302, T-202]
    deliverables: [tests/integration/process_active_decisions_test.ts]
    accept: [
      deno test --allow-all tests/integration/process_active_decisions_test.ts,
    ]

  - id: T-505
    wave: 5
    pr: 3
    depends_on: [T-301, T-202, T-107]
    deliverables: [tests/integration/cancel_delete_test.ts]
    accept: [deno test --allow-all tests/integration/cancel_delete_test.ts]

  - id: T-506
    wave: 5
    pr: 3
    depends_on: [T-301, T-202]
    deliverables: [tests/integration/channel_members_integration_test.ts]
    accept: [
      deno test --allow-all tests/integration/channel_members_integration_test.ts,
    ]

  - id: T-507
    wave: 5
    pr: 3
    depends_on: [T-301, T-202]
    deliverables: [tests/integration/usergroup_integration_test.ts]
    accept: [
      deno test --allow-all tests/integration/usergroup_integration_test.ts,
    ]

  - id: T-508
    wave: 5
    pr: 3
    depends_on: [T-301, T-302, T-202]
    deliverables: [tests/integration/deadline_finalisation_test.ts]
    accept: [
      deno test --allow-all tests/integration/deadline_finalisation_test.ts,
    ]

  - id: T-509
    wave: 5
    pr: 3
    depends_on: [T-301, T-302, T-202]
    deliverables: [tests/integration/deactivation_test.ts]
    accept: [deno test --allow-all tests/integration/deactivation_test.ts]

  - id: T-510
    wave: 5
    pr: 3
    depends_on: [T-301, T-202, T-107]
    deliverables: [tests/integration/race_test.ts]
    accept: [deno test --allow-all tests/integration/race_test.ts]

  - id: T-551
    wave: 5.5
    pr: 3
    role: reviewer
    depends_on:
      [T-501, T-502, T-503, T-504, T-505, T-506, T-507, T-508, T-509, T-510]
    deliverables: [docs/reviews/wave-5-review.md]
    accept: ["reviewer signoff or open MUST-FIX tasks"]

  - id: T-601
    wave: 6
    pr: 4
    depends_on: [T-403, T-404, T-501]
    deliverables: [scripts/deploy.sh]
    accept:
      - bash -n scripts/deploy.sh

  - id: T-602
    wave: 6
    pr: 4
    depends_on: [T-001]
    deliverables: [.github/workflows/ci.yml]
    accept: ["yamllint or manual"]

  - id: T-603
    wave: 6
    pr: 4
    depends_on: [T-001]
    deliverables: [.githooks/pre-commit]
    accept: [bash -n .githooks/pre-commit]

  - id: T-604
    wave: 6
    pr: 4
    depends_on: [T-510]
    deliverables:
      - README.md
      - DEVELOPMENT.md
      - DEPLOYMENT.md
      - SECURITY.md
      - AGENTS.md
    accept: ["deno fmt --check *.md"]

  - id: T-605
    wave: 6
    pr: 4
    depends_on: [T-001]
    deliverables:
      - .github/copilot-instructions.md
      - .github/pull_request_template.md
    accept: ["deno fmt --check .github/*.md"]

  - id: T-606
    wave: 6
    pr: 4
    depends_on: [T-001]
    deliverables:
      - docs/REDEVELOPMENT_SPECIFICATION.md
      - docs/REDEVELOPMENT_BUILD_PLAN.md
      - docs/SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md
      - docs/templates/adr-template.md
      - docs/templates/feature-spec-template.md
      - docs/adr/0001-use-slack-bolt-framework.md
    accept: ["deno fmt --check docs/"]

  - id: T-701
    wave: 7
    pr: 4
    role: reviewer
    depends_on: [T-601, T-602, T-603, T-604, T-605, T-606]
    deliverables: [docs/reviews/wave-7-review.md]
    accept: ["reviewer signoff"]

  - id: T-702
    wave: 7
    pr: 4
    role: verifier
    depends_on: [T-701]
    deliverables: [docs/reviews/acceptance-report.md]
    accept:
      - deno task ci
      - "manual: SPEC §25 #1, #2, #8, #11, #12"

  - id: T-703
    wave: 7
    pr: 4
    role: verifier
    depends_on: [T-702]
    deliverables: [docs/reviews/acceptance-report.md] # appended
    accept:
      - "manual e2e: SPEC §25 #3-#7, #9, #10 against live workspace"
```

---

_End of build plan._
