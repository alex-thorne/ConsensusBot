# Wave 5 — SPEC Conformance Review

**Reviewer:** Independent SPEC review per PLAN §8.
**Date:** 2026-05-09.
**Scope:** SPEC §1–§20 against the merged Wave 1–5 implementation.

## Summary

**Verdict: green-with-followups.** All MUST behaviours land. The implementation
conforms to SPEC §1–§20 with no integrity-critical violations: forbidden
patterns are absent (no `any`, `@ts-ignore`, `Deno.env.get`, legacy artefacts,
or `{{decision_id}}` placeholders), the manifest scope list is verbatim,
rollback ordering, bot filter, UUID-keyed buttons, tz-aware deadlines, the
`finalized_at` token, and the eventual-consistency vote-merge are all wired
correctly. `deno task check`, `deno task lint`, `deno task fmt:check`, and
`deno task test` (310 tests) are green from this branch. Three SHOULD-FIX
items are open — most prominently the unwired `claimFinalisation` helper
(exported and tested, never called by either finaliser) and a divergence
between the two `finalizeDecision` implementations (the local re-implementation
inside `process_active_decisions.ts` does not surface tied/deadlocked outcomes
in the in-channel message). I sign off Waves 1–5 against SPEC §1–§20 with the
caveat that the SHOULD-FIX list be tracked as Wave 6 follow-ups.

## Findings

### MUST-FIX (blocks the wave gate)

- None.

### SHOULD-FIX (open follow-up tasks before Wave 6 closes)

1. **`claimFinalisation` helper is exported but never wired.** SPEC §16.3
   describes `finalized_at` as the idempotency token, written immediately
   before the ADR post. `utils/concurrency.ts` exports `claimFinalisation`
   (lines 94–141), the `tests/concurrency_test.ts` test suite verifies it,
   but neither `functions/create_decision.ts:finalizeDecision` (lines 1009–
   1031) nor `functions/process_active_decisions.ts:finalizeDecision` (lines
   651–671) calls it. Both inline a bare `apps.datastore.put` instead. As the
   SPEC §16.3 / §13 language treats `finalized_at` as a single-writer claim
   token, the two finalisers SHOULD route through `claimFinalisation` for
   uniformity and to keep the "single writer" property visible to readers of
   either function. Functionally this currently works — the §13-step-9
   re-read is the second line of defence — but the unwired helper is a
   maintenance hazard and was explicitly flagged as a Wave 5 follow-up by
   the orchestrator.

2. **`updateMessageForDecided` in `process_active_decisions.ts` does not
   surface `tied` / `deadlocked` outcomes in the in-channel message.** SPEC
   §13 step 7 says "Surface `tied` / `deadlocked` reasons explicitly." The
   `create_decision.ts` finaliser uses `statusForFailed(outcome)` which maps
   `tied`→`🟰 Tied` and `deadlocked`→`🪦 Deadlocked` (lines 600–661), but
   the local re-implementation in `process_active_decisions.ts` (lines 782–
   854) only emits `APPROVED` or `REJECTED` (line 791:
   `const statusUpper = outcome.passed ? "APPROVED" : "REJECTED"`). When
   Phase A finalises a deadlocked or tied decision via the schedule tick,
   the `*Status:*` line on the in-channel message will read `REJECTED` with
   no tied/deadlocked discriminator. The `outcome.outcome` field carries
   the discriminator — both implementations should consume it. Consolidating
   the two finalisers (collapse to a single import per the file header
   comment in `process_active_decisions.ts` lines 25–32) would also fix
   this.

3. **Vote-handler past-deadline path passes `[]` to `finalizeDecision`
   instead of querying current votes.** `create_decision.ts:1233` calls
   `finalizeDecision(client, decision, [])` from the §9 step-5 past-deadline
   guard. SPEC §13 takes `mergedVotes` as input and `calculateDecisionOutcome`
   computes the outcome over it directly — passing `[]` means a
   past-deadline click on a decision that already has, say, 5 yes/0 no
   votes will be finalised with the "Quorum not met (0 of K required)"
   reason regardless of what was actually cast. SPEC §18.1 (Phase A) gets
   this right by querying `votes` first, then passing them in. The vote
   handler should do the same for symmetry. The integration test
   `tests/integration/deadline_finalisation_test.ts:253` pins the current
   `[]` behaviour but its commentary (line 242) treats it as a known
   limitation rather than a SPEC-grounded contract. Recommend: query
   `votes` before calling `finalizeDecision` in the past-deadline branch.

### NIT (documentation-only / cosmetic)

1. **SPEC §17.2 vs implementation: italics vs bold marker.** SPEC §17.2
   line 1242 specifies the first ADR-Slack block text as
   `"📝 _Architecture Decision Record Generated_"` (italics) and the
   third block as `"💡 _To archive this ADR:_ ..."`. The implementation in
   `utils/adr_generator.ts` lines 254 and 270 uses asterisks (bold):
   `"📝 *Architecture Decision Record Generated*"` and `"💡 *To archive
   this ADR:* ..."`. The pinning test in `tests/adr_generator_test.ts:651,
   668` uses the bold form. Either the SPEC §17.2 example is a doc typo or
   the test was written against a wrong example; not a behavioural defect.
   Recommend: align SPEC §17.2 to the bold markers (these are mrkdwn block
   strings, where `*…*` reads as bold in Slack).

2. **`generateADRMarkdown` Total Participants derives from votes, not
   voters.** SPEC §17.1 line 1225 says
   `**Total Participants:** ${voters.length}`. The implementation in
   `utils/adr_generator.ts:147` uses
   `new Set(votes.map(v => v.user_id)).size` because the function
   signature does not include `voters`. The test pins the unique-voter
   count form. Self-documenting in lines 141–146 of the implementation.
   Functionally correct; minor SPEC vs implementation drift.

3. **`generateADRMarkdown` Vote History condition uses `changedEvents.length
   > 0` rather than the SPEC's `voteHistory.length > votes.length`.** SPEC
   §17.1 line 1188 specifies the latter; implementation in
   `utils/adr_generator.ts:108–117` uses the operational equivalent
   (`event_kind === "changed"` filter, then non-empty check). Self-
   documented in the implementation (lines 102–106). Functionally
   equivalent in well-formed data.

4. **`finalized_at` is initialised to `""` rather than left absent.**
   `create_decision.ts:1858` puts `finalized_at: ""` on the new decision
   row; SPEC §5.1 says "nil while `active`". The downstream check
   `typeof live.finalized_at === "string" && live.finalized_at.length > 0`
   correctly treats `""` as unset, so this is benign. Cosmetic.

5. **`process_active_decisions.ts` `updateMessageForCancelled` /
   `postCancelledADRThread` are Phase-A-internal divergences from the
   `create_decision.ts:buildNoVotersBlocks` layout.** SPEC §13 step 3
   describes a single layout for the no-eligible-voters branch; the two
   implementations differ in the blocks they emit (Phase A also posts a
   thread-marker ADR, which the SPEC does not require). Symptom of the
   "T-302 re-implementation" discussed in the file header. Will resolve
   itself when the helper is extracted.

6. **Static `start_time: "2099-01-05T09:00:00Z"` in the schedule trigger
   file.** SPEC §6.2 explicitly says the file is a documentation reference
   and the deploy script computes the real start time. The placeholder is
   future-dated to avoid `invalid_start_before_now` in any path that
   accidentally passes the literal file. Cosmetic / by design.

## Per-section walk

### §1 Mission & Scope
- Conformance: **Y**. The repo's structure and behaviours match the in-scope /
  out-of-scope statements: single-channel single-workspace decisions, three
  criteria with Robert's Rules / quorum semantics, voter sources are individual
  user picker + free-text usergroups + channel members ≤ 500, cancel/delete
  lifecycle, weekday 09:00 UTC tick, ADR markdown posted in-thread, vote
  history retention. No automated push to git/wiki, no multi-channel, no bank
  holidays. Operational guarantees (zero secrets, quorum protection,
  idempotent buttons via `finalized_at`, no zombie decisions, tz-aware
  deadlines, EC vote merge, datastore-write-before-message-post) are all
  present in the implementation.

### §2 Tech Stack
- Conformance: **Y**. `deno.jsonc` pins `deno-slack-sdk@2.15.1`,
  `deno-slack-api@2.8.0`, `@std/assert@^1`. `slack.json` pins
  `deno_slack_hooks@1.5.0`. Strict TypeScript on, JSX (`react`, `h`,
  `Fragment`) configured. `start` task absent. Tasks
  `fmt`/`fmt:check`/`lint`/`check`/`test`/`ci` all present and match SPEC
  §23.1 verbatim. `crypto.randomUUID()` is used in
  `functions/create_decision.ts:1841` without an extra import.

### §3 Project Layout
- Conformance: **Y** (for the files in scope of this review). All ten
  reviewed-input file paths exist with correct names, `tests/integration/`
  contains all nine integration tests listed in §21.2 (plus a `.gitkeep`),
  `tests/mocks/slack_client.ts` exists, the `tests/` unit tests match the
  §21.1 list. The `archive/` directory is excluded from `fmt`/`lint`/`test`
  via `deno.jsonc`. `docs/reviews/` exists (this review lives there).

### §4 Slack App Manifest
- Conformance: **Y**. `manifest.ts` is 47 lines and exports a `Manifest({...})`
  with `name`, `description`, `icon: "assets/icon.png"`, the two workflows,
  the four datastores, `outgoingDomains: []`, and `botScopes` matching SPEC
  verbatim:
  - 13 entries in the order: `commands`, `chat:write`, `chat:write.public`,
    `datastore:read`, `datastore:write`, `pins:read`, `pins:write`,
    `team:read`, `users:read`, `usergroups:read`, `channels:read`,
    `groups:read`, `im:write`. Confirmed against `manifest.ts:32–46`.
  - No extras, no missing entries.

### §5 Data Model
- §5.1 `decisions` — Conformance: **Y**. All 17 attributes present in
  `datastores/decisions.ts`. `id`, `name`, `proposal`, `success_criteria`,
  `quorum`, `required_voters_count`, `deadline`, `deadline_resolved`,
  `deadline_tz`, `channel_id`, `creator_id`, `message_ts`, `status`,
  `outcome_reason`, `finalized_at`, `created_at`, `updated_at`. PK on `id`.
- §5.2 `votes` — Conformance: **Y**. PK `id`, `decision_id`, `user_id`,
  `vote_type`, `voted_at`. Composite key form
  `${decision_id}_${user_id}` is used at the call site
  (`functions/create_decision.ts:1208`).
- §5.3 `voters` — Conformance: **Y**. PK `id`, `decision_id`, `user_id`,
  `is_active` (boolean), `created_at`. Composite key form is enforced at
  the call site.
- §5.4 `vote_history` — Conformance: **Y**. PK `id` (composite), all six
  attributes present. The SPEC's `null` for first-vote `previous_vote_type`
  is encoded as the omitted optional field (TypeScript `previous_vote_type?:
  VoteType` in `types/decision_types.ts:139`); the call site spreads it in
  conditionally (`...(previousVoteType ? {...} : {})`,
  `functions/create_decision.ts:1281`). This satisfies the SPEC because the
  SPEC says "absent on first vote" in §5.4 row 5.
- §5.5 TypeScript types — Conformance: **Y**. `DecisionRecord`,
  `VoteRecord`, `VoterRecord`, `VoteHistoryRecord`, `DecisionItem` alias,
  `VoteType` literal, `SuccessCriteria` literal, `DecisionStatus` literal,
  `VoteHistoryEventKind` literal — all defined in
  `types/decision_types.ts`.

### §6 Triggers
- §6.1 `consensus_command` — Conformance: **Y**. `triggers/consensus_command.ts`
  defines a `Trigger<typeof CreateDecisionWorkflow.definition>` with `type:
  "shortcut"`, name "Create Consensus Decision", workflow-id template, and
  the three input mappings (`interactivity`, `channel_id`, `user_id`)
  exactly per SPEC.
- §6.2 `process_active_decisions_schedule` — Conformance: **Y**. Type
  `scheduled`, frequency `weekly` Mon–Fri, timezone UTC, no inputs. The
  `start_time` is `"2099-01-05T09:00:00Z"` — the file header explicitly
  documents (lines 12–20) that this is a static placeholder and the deploy
  script in T-601 generates the real value.
- §6.3 No vote-button trigger — Conformance: **Y**. `grep -r
  "vote_button_trigger\|RecordVoteFunction\|workflows/vote.ts"` returns
  nothing.

### §7 Workflows
- §7.1 `CreateDecisionWorkflow` — Conformance: **Y**. `callback_id:
  "create_decision_workflow"`. Inputs `interactivity`, `channel_id`,
  `user_id` (all required). Step 1 invokes
  `Schema.slack.functions.OpenForm` with the eight form fields in the
  SPEC's order, the four-element `required` list, and the
  `success_criteria` `enum` + `choices` block matching SPEC §7.1 verbatim
  including the disambiguating description copy. Step 2 binds the form
  outputs 1:1 to `CreateDecisionFunction` plus `channel_id` /
  `creator_id`.
- §7.2 `ProcessActiveDecisionsWorkflow` — Conformance: **Y**. Single
  step invoking `ProcessActiveDecisionsFunction` with `{}` and no inputs.

### §8 The `create_decision` Function
- Conformance: **Y** (with the SHOULD-FIX #3 noted above for the past-
  deadline `[]` argument).
- §8.1 Pre-flight validation — Y. Channel-type guard (`C` or `G`),
  voter-input check, broadcast handles rejected, length guards (200/2500),
  past-dated deadline rejected. Error strings match SPEC verbatim
  (`functions/create_decision.ts:1681, 1696–1698, 1706, 1711, 1715, 1737`).
- §8.2 Voter resolution — Y. Set, individual + usergroup + channel-member
  loops, all three sources go through `isHumanUser` (the bot/USLACKBOT/
  deactivated filter, lines 178–198), `MAX_CHANNEL_VOTERS = 500` enforced,
  empty-set rejection. `usergroups.list` and `usergroups.users.list`
  paginate via cursor (`fetchAllUsergroups`, `fetchUsergroupMembers`).
- §8.3 Deadline & quorum — Y. `getWorkspaceTz`, `resolveDeadline`,
  per-criterion default quorum (`Math.ceil(R/2)`, `Math.ceil(R*2/3)`, `R`),
  `quorum_override` validated `1 ≤ ov ≤ R`.
- §8.4 Persisting state and posting the message — **Y**. Rollback ordering
  is correct verbatim:
  1. `crypto.randomUUID()` → `decisionId` (line 1841)
  2. Build decision record with placeholder `message_ts: ""` (line 1856)
  3. `decisions.put` (line 1864) — return on failure
  4. Voter `put` loop with rollback of `writtenVoterIds` and decision row
     on any failure (lines 1879–1915)
  5. `chat.postMessage` (line 1933) — on failure, rollback voter rows then
     decision row (lines 1944–1957)
  6. `decisions.put` again with real `message_ts` (line 1969) — failure
     logged, no rollback (per SPEC)
  7. `pins.add` (line 1984) — failure logged, cosmetic
- §8.5 Block Kit message layout — Y. `escapeSlackText` applied to name and
  proposal. Six blocks: header (🗳️), proposal section, fields section
  (Success Criteria / Deadline / Required Voters / Status), divider,
  actions block (`block_id: "voting_actions"`) with five buttons in
  `[Yes, No, Abstain, Cancel, Delete]` order with `decisionId` UUID
  values, context with creator+deadline. No `{{decision_id}}` placeholder.
- §8.6 Block-action handlers — Y. Three `addBlockActionsHandler` chains
  (`["vote_yes","vote_no","vote_abstain"]`, `["decision_cancel"]`,
  `["decision_delete"]`) per SPEC.
- §8.7 Workflow lifecycle — Y. Returns `{ completed: false } as const`.

### §9 Vote handler
- Conformance: **Y** (with SHOULD-FIX #3 above).
- All eleven steps executed in order. Decision-not-found ephemeral string
  matches verbatim ("Decision not found." line 1191). Status guard string
  matches ("This decision is no longer active (${status})." line 1202).
  Eligibility ephemeral matches ("You are not listed as an eligible voter
  for this decision." line 1217). Past-deadline ephemeral matches ("⏰
  Voting closed at ${deadlineDisplay}. Finalising now." line 1231). Vote
  put failure ephemeral matches ("❌ Failed to record your vote: ${error}.
  Please try again." line 1265).
- Vote merge: `mergedVotes = [...queriedVotes.filter(u !== userId),
  newVote]` exactly per §16.1 (line 1312).
- `vote_history` event_seq: padded to 4 digits, computed via
  `nextEventSeq(client, decisionId, userId)` (line 1272). `event_kind`
  resolves to `"changed"` if `previous_vote_type` is set, `"cast"`
  otherwise.
- Confirmation ephemeral: `${emoji} Your vote (${UPPER}) has been recorded
  for "${escaped name}"` matches verbatim (line 1366).

### §10 Cancel handler
- Conformance: **Y**.
- Permission: any workspace member (no creator check).
- Re-read-and-bail: `reReadAndCheck` is called and discriminates between
  `not_found` / `predicate_failed` / `api_error` (lines 1420–1447). The
  predicate-failed message reads "This decision was just finalised —
  cannot cancel." with the EM DASH (line 1431).
- `outcome_reason: "cancelled by <@${userId}>"` (line 1453).
- Pin probe + remove via `unpinIfPinned`.
- Cancelled-layout blocks: header `🚫 ${name}`, proposal, fields
  (`*Status:* 🚫 Cancelled`, `*Cancelled by:* <@user>`), context
  `Created by <@creator> | Cancelled at ${nowDisplay}`. Matches SPEC §10
  step 5.
- Confirmation ephemeral: `🚫 Decision "${escaped name}" has been
  cancelled.` (line 1505).

### §11 Delete handler
- Conformance: **Y**.
- Authorisation: `decision.creator_id !== userId` rejected with `⛔ Only
  the creator of this decision can delete it.` (line 1554) — matches SPEC.
- Cascade order: `vote_history` → `votes` → `voters` → `decisions` (lines
  1560–1595) verbatim.
- Pin probe via `unpinIfPinned`.
- `chat.delete` first; on failure, fallback to `chat.update` with
  `_This decision ("${name}") was deleted by <@user>._` (line 1620).
- Confirmation ephemeral: `🗑️ Decision "${escaped name}" has been
  deleted.` (line 1644).

### §12 Finalisation gating — `checkIfShouldFinalize`
- Conformance: **Y**. Four-step gate exactly per SPEC: already-finalised
  guard (returns `false`), past-deadline (returns `true`), all-voted
  (returns `voted >= R`), deadlock (`checkDeadlock` returns `true` on
  unanimity-with-no-vote, simple_majority/super_majority unreachable).

### §13 Finalisation — `finalizeDecision`
- Conformance: **Y** in `functions/create_decision.ts`. **Mostly-Y** in
  `functions/process_active_decisions.ts` (see SHOULD-FIX #2 — tied/
  deadlocked not surfaced in the in-channel message).
- §13 step 1 re-read + active/finalized_at guard: present in both files
  (`create_decision.ts:868–886`, `process_active_decisions.ts:521–551`).
- §13 step 2 voter activity refresh: both implementations call
  `users.info` per is_active voter and `put` `is_active=false` on
  `deleted=true`.
- §13 step 3 R_effective=0 → cancel branch: present in both. Both write
  `outcome_reason: "no eligible voters remain"` verbatim.
- §13 step 4 outcome computation: `calculateDecisionOutcome(mergedVotes,
  success_criteria, R_effective, quorum)`.
- §13 step 5 idempotency token write: present in both.
- §13 step 6 pin probe + remove: `unpinIfPinned` /
  `pinProbeAndRemove`.
- §13 step 7 message update: both use the finalised layout — but the
  Phase A version (`updateMessageForDecided`) does not surface tied /
  deadlocked outcomes (SHOULD-FIX #2).
- §13 step 8 `userMap` build: present in both. The Phase A version uses
  `users.info` directly (`buildUserMap`); the create-decision version uses
  the cache from step 2.
- §13 step 9 double-finalisation re-check: present in both
  (`create_decision.ts:1071–1087`,
  `process_active_decisions.ts:697–716`).
- §13 step 10 ADR post: `chat.postMessage` with `thread_ts = message_ts`
  and `text: "ADR Generated - See thread for details"`. Present in both.

### §14 Slack parsing utilities
- Conformance: **Y**.
- §14.1 `parseUserIds`: tokeniser on `/[\s,]+/`, regex
  `^<@([UW][A-Z0-9]+)(?:\|[^>]*)?>$` capture, raw-id regex
  `^[UW][A-Z0-9]{5,}$`, dedup, `string[]` legacy hatch.
- §14.2 `parseUsergroupInput`: returns `{ ids, handles, broadcasts }`,
  `<!subteam^…>` mention, raw `S…`, `@here|channel|everyone` broadcasts,
  generic `@handle` strip-leading-at, dedup.
- §14.3 `escapeSlackText`: `&` first, then `<`, then `>`, replace-all.
  `neutraliseBackticks` neutralises triple backticks only.

### §15 Decision logic
- Conformance: **Y**, all reason strings literally match SPEC.
- Integer arithmetic only — confirmed `grep -n` for floating-point
  `0.5`/`2/3`/`*0.` returns nothing in `utils/decision_logic.ts` outside
  comments.
- §15.4 simple majority — pinned strings:
  - `"Quorum not met (${votes_cast} of ${quorum} required)"`
  - `"No decisive votes (all abstentions)"`
  - `"Simple majority achieved (${counts.yes} yes of ${decisive}
    decisive)"`
  - `"Tied (${counts.yes} yes, ${counts.no} no)"`
  - `"Simple majority not achieved (${counts.yes} yes of ${decisive}
    decisive)"`
  All present verbatim at lines 137, 146, 156, 165, 173 of
  `utils/decision_logic.ts`.
- §15.5 supermajority — `"Two-thirds majority achieved..."` and
  `"Two-thirds majority not achieved..."` present at lines 220, 229.
- §15.6 unanimity — `"No yes votes cast"`, `"Unanimity not achieved
  (${counts.no} vote(s) against)"`, `"Unanimity achieved (${counts.yes}
  yes, ${counts.abstain} abstention(s))"` present at lines 265, 274,
  283.
- §15.7 default branch — `"Invalid success criteria: ${criteria}"` with
  `error: true`.
- §15.8 deadlock — `"Cannot achieve simple majority even with all
  remaining yes"`, `"Cannot achieve two-thirds majority even with all
  remaining yes"`, `"Unanimity impossible — at least one no vote already
  cast"` (with EM DASH `—`, line 385). Confirmed: the EM DASH character
  is the U+2014 box character, not a hyphen.

### §16 Concurrency, consistency, and idempotency
- Conformance: **Y**. The four mitigations (vote merge §16.1, skip-stale
  query §16.2, `finalized_at` token §16.3, re-read-and-bail §16.4) are all
  present in code.
- §16.1 — confirmed at `functions/create_decision.ts:1306–1315`.
- §16.2 — `checkIfShouldFinalize` consumes `mergedVotes` directly without
  re-querying.
- §16.3 — token written by both finalisers before ADR post (see SHOULD-FIX
  #1 about `claimFinalisation` being unwired).
- §16.4 — `reReadAndCheck` exported from `utils/concurrency.ts:53–71`,
  used by the cancel handler (line 1420), and the helper signature matches
  the SPEC's example shape (with the narrower `reason` union documented in
  the source comments).

### §17 ADR generation
- Conformance: **Y** in markdown body and Slack format — the SPEC §17.2
  italics-vs-bold marker is a NIT (see NIT #1).
- §17.1 markdown template:
  - Front-matter rows with `BR` (`"  \n"` literal) trailing soft breaks at
    `**Status:** … Deadline …` (lines 170–175 of `utils/adr_generator.ts`).
  - `Outcome` row with BR after `**Outcome:** ${outcomeText}` (line 187).
  - Final auto-generated footer with BR after `*This ADR was
    automatically generated by ConsensusBot*` (line 235).
  - Vote breakdown bullets, individual votes, vote history (with N→M at
    timestamp), excluded voters, consequences/implementation/references.
  - `escapeSlackText(neutraliseBackticks(...))` applied to name and
    proposal. Confirmed at lines 58–61.
  - Suggested filename: `${dateOnly}-${slug}-${idPrefix}.md` with
    `idPrefix = decision.id.slice(0, 8)` (line 154–155).
- §17.2 three-block Slack format: section + section (fenced
  `\`\`\`\\n…\\n\`\`\``) + context. Bold markers for the lead-in and
  archive note (NIT #1).

### §18 Process Active Decisions
- Conformance: **Y** (with the SHOULD-FIX #2 about tied/deadlocked
  finalised-message rendering).
- §18.1 Phase A: queries active decisions paginated via cursor (capped at
  50 pages), filters out rows with `finalized_at` set or future deadline,
  invokes `finalizeDecision(client, decision, votes)` per row. Per-row
  `try/catch` ensures the outer loop never breaks
  (`process_active_decisions.ts:155–172`).
- §18.2 Phase B: per still-active decision, refreshes voter activity
  (flips `is_active=false` on `users.info.deleted=true`), queries votes,
  computes set-difference of un-voted active voters, DMs each via
  `chat.postMessage(channel: userId, …)` with the `im:write` scope.
- §18.3 Pagination + 1000-decision cap: `MAX_ACTIVE_DECISIONS_PER_TICK
  = 1000`, exceeding emits a `decisions_cap_exceeded` warn log and slices.
- §18.4 `sendReminderDM`: blocks match SPEC verbatim — section "👋 Hi! You
  have a pending vote on a consensus decision.", section "*Decision:*
  …\\n*Deadline:* …\\n\\nPlease visit <#…>…", context "This is an
  automated reminder from ConsensusBot". Fallback text: `Reminder: You
  have a pending vote for "${escaped name}"`. Returns `result.ok === true`.
- §18.5 outputs: `{ reminders_sent, decisions_finalised }` (both
  integer-typed per the SPEC).

### §19 Date & time utilities
- Conformance: **Y** (DST-aware).
- §19.1 `addBusinessDays`: skips Sat/Sun (`getDay() !== 0 && !== 6`),
  mutates a local clone.
- §19.2 `getDefaultDeadline`: `addBusinessDays(5)` then `formatDateInTz`
  in `en-CA` for `YYYY-MM-DD` (no UTC drift).
- §19.3 `formatDate`: SPEC verbatim (`toISOString().split("T")[0]`).
- §19.4 `resolveDeadline`: DST-aware. Uses `Date.UTC(...)` for the
  tentative wall-clock-as-UTC timestamp, then `getTzOffsetMinutes` (which
  uses `Intl.DateTimeFormat({timeZone: tz})` with `formatToParts` to
  derive the offset that the IANA tz is at on that exact UTC instant),
  then subtracts the offset. London BST and London GMT both resolve
  correctly because the offset is computed for the date in question, not
  a static value. The acceptance row in §25 ("9 May 2026 → London BST")
  is satisfied: 23:59:59.999 BST is 22:59:59.999 UTC, so
  `resolveDeadline("2026-05-09", "Europe/London")` returns
  `iso: "2026-05-09T22:59:59.999Z"` and humanDisplay
  "9 May 2026 at 23:59 BST".
- §19.5 `getWorkspaceTz`: `team.info()` lookup with `Europe/London`
  fallback.
- §19.6 `isDeadlinePassed`: `new Date(deadline_resolved) < new Date()` —
  tz-correct because the offset was already baked in.
- §19.7 `formatDeadlineHuman`: explicit field options
  (`day:numeric, month:long, year:numeric, hour:'2-digit',
  minute:'2-digit', hour12:false, timeZoneName:'short'`) plus a comma →
  " at " normalisation. The implementation comment (lines 124–129)
  documents the deviation from SPEC's `dateStyle/timeStyle/timeZoneName`
  combination, which some V8/ICU builds reject; the chosen explicit form
  is functionally equivalent.

### §20 Slack types
- Conformance: **Y**. `types/slack_types.ts` defines `SlackClient` with
  `apps.datastore.{get,put,query,delete}`,
  `chat.{postMessage, postEphemeral, update, delete}`, `users.info`,
  `conversations.members`, `pins.{list,add,remove}`,
  `usergroups.list` (cursor-paginated),
  `usergroups.users.list` (cursor-paginated), `team.info`. `SlackBlock`,
  `SlackElement`, `SlackTextObject`, `SlackButtonElement`,
  `SlackUsergroupSummary`, `SlackUserInfo` all defined. The
  `MockSlackClient` implements `SlackClient` end-to-end (`tests/mocks/
  slack_client.ts:113`). No `any` in either file.

## Forbidden-pattern grep results

- `any` (excluding comments and `Record<string, any>`): **None.** Verified
  via `grep -rn ": any\\|<any>\\| as any\\b\\| any\\[\\]\\|<any," --include="*.ts"
  datastores/ functions/ workflows/ triggers/ types/ utils/ tests/
  manifest.ts | grep -v "Record<string, any>"`. Only one comment-only
  match in `tests/integration/process_active_decisions_test.ts:824`.
- `@ts-ignore`: **None.** Two matches, both in comments documenting that
  the constraint is honoured (`tests/integration/
  channel_members_integration_test.ts:290`, `tests/integration/
  vote_handler_test.ts:36`).
- `process.env`: **None.**
- `Deno.env.get`: **None** outside tests, **none** in tests either.
- Legacy artefacts (`vote_button_trigger`, `record_vote_function`,
  `vote_workflow`, `send_reminders_function`, `send_reminders_workflow`,
  `reminder_schedule`, `RecordVoteFunction`): **None.** `grep -rn` returns
  empty.
- `{{decision_id}}` placeholder in non-comment context: **None.** Only
  appears in:
  - `functions/create_decision.ts:20` — comment documenting the
    invariant.
  - `tests/create_decision_test.ts:305–344, 402–415` — explicit test
    fixtures asserting that the production code does **not** emit the
    placeholder. The transform test (line 402+) verifies that after the
    `rewriteButtonValues` pass the placeholder is absent.
- Floating-point pass/fail in `utils/decision_logic.ts`: **None.** All
  comparisons use `*`/`>`/`<` on integer-typed counts (e.g. `counts.yes
  * 2 > decisive`, `counts.yes * 3 >= decisive * 2`). The file's header
  comment (lines 7–10) explicitly forbids floating-point in pass/fail
  decisions.

## Sign-off

I sign off Waves 1–5 against SPEC §1–§20.

The three SHOULD-FIX items above (`claimFinalisation` wiring, tied/
deadlocked surfacing in `process_active_decisions.ts`, vote-handler past-
deadline `[]` argument) should be tracked as Wave 6 follow-up tasks but do
not block the Wave 5 gate, as none of them violates a MUST clause of
SPEC §1–§20.
