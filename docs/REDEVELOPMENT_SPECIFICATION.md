# ConsensusBot — Re-development Specification

**Purpose.** A prescriptive, self-contained specification of the _target_
ConsensusBot, intended to drive agentic (or human) re-development from scratch.
An implementer should be able to read this document end-to-end and produce the
system without referring to the existing source tree.

**Source-of-truth date.** Captured from `main` at commit `a5b5642` (2026-05-08),
then refactored on the same date to address the findings in
`Specification Audit & Refactor Input` (2026-05-08).

**Convention used in this document.**

- _MUST_ / _MUST NOT_ — non-negotiable. Acceptance tests pin these.
- _SHOULD_ — strong default; deviating requires a documented reason.
- _MAY_ — at the implementer's discretion.

---

## 1. Mission & Scope

ConsensusBot is a Slack-native application that lets a team turn a proposal into
a structured, time-boxed, audited vote. A user runs `/consensus` in any channel;
a modal collects a proposal, voter list, success criterion, and deadline; the
app posts an interactive voting message with Yes / No / Abstain buttons plus
management buttons, records each vote in Slack Datastores, sends weekday DM
reminders to voters who haven't voted, and on finalization writes a formatted
Architecture Decision Record (ADR) into the message thread for a human to copy
into their wiki.

The entire system runs on **Run on Slack Infrastructure (ROSI)** — Slack's
managed Deno runtime — with no external services and no secrets to rotate. State
lives in Slack-managed Datastores (DynamoDB-backed).

### In scope

- Single-channel, single-workspace decisions.
- Three success criteria — **simple majority**, **two-thirds (super) majority**,
  **unanimity** — all with quorum enforcement and abstain-excluded
  numerator/denominator (Robert's Rules-aligned; see §15).
- Voter selection by individual user picker, free-text usergroup mentions / IDs
  / handles, and an "all non-bot channel members" checkbox (max 500).
- Cancel (any user) and Delete (creator-only) lifecycle controls.
- Weekday 09:00 UTC scheduled tick: finalises past-deadline decisions, then
  sends DM reminders for still-active ones.
- ADR generation as a formatted markdown block posted in-thread.
- Vote history retention (append-only event log) so vote changes are surfaced in
  the ADR.

### Out of scope (deliberately)

- Automated push of ADRs to Git / Wiki / DevOps. ADRs are emitted as markdown
  for a human to copy. (Background: see
  `docs/SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md`.)
- Multi-channel, cross-channel, or multi-workspace decisions.
- Decision templates, vote delegation, custom criteria, analytics dashboards.
- Bank-holiday-aware business-day arithmetic. (`addBusinessDays` only skips
  weekends; this is acceptable for a v1 and listed in §22.)
- Automated deployment from CI (the CI gates code quality only).

### Operational guarantees the spec preserves

- **Zero secrets.** Auth is Slack-managed OAuth; the app must hold no API tokens
  of its own.
- **Quorum-protected vote resolution.** No criterion can pass without a defined
  minimum participation (§15).
- **Idempotent button handling.** Voting, cancelling, and deleting are safe to
  repeat: the app validates current state on every click and uses a
  `finalized_at` token to prevent double-finalisation (§16).
- **No zombie decisions.** Past-deadline `active` decisions are auto-finalised
  by the daily tick; manual cancel is no longer required (§18).
- **Deadline interpreted in workspace timezone.** A picked date resolves to
  end-of-day (23:59:59) in the workspace's `tz`, not midnight UTC. The resolved
  local time is shown in the message (§19).
- **Vote-history audit trail.** Every vote and vote-change is appended to
  `vote_history`; the ADR surfaces revisions (§5.4, §17).
- **Eventual-consistency safety.** Datastore queries are not strongly
  consistent; the just-written vote is always merged into query results before
  any UI/finalisation decision is taken (§16).
- **Bounded blast radius on failure.** Datastore rows are written before the
  Slack message is posted, with rollback on failure (§8.4); orphan messages are
  not produced.

---

## 2. Tech Stack & Versions

| Component             | Version / Identifier                                          |
| --------------------- | ------------------------------------------------------------- |
| Runtime               | Deno (Slack ROSI hosted; local development uses Deno ≥ 1.37). |
| Language              | TypeScript, strict mode.                                      |
| Slack SDK             | `https://deno.land/x/deno_slack_sdk@2.15.1/`                  |
| Slack API client      | `https://deno.land/x/deno_slack_api@2.8.0/`                   |
| Assertions (test)     | `jsr:@std/assert@^1`                                          |
| Slack hooks (CLI)     | `https://deno.land/x/deno_slack_hooks@1.5.0/mod.ts`           |
| CLI                   | Slack CLI (`slack`), Deno (`deno`).                           |
| Plan tier requirement | Slack Pro or higher (Datastores require a paid plan).         |

`crypto.randomUUID()` is a Deno-builtin and is used to generate `decision_id`.
No additional import is required.

`deno.jsonc` declares strict TypeScript, JSX (`react`, factory `h`, fragment
`Fragment`), and tasks `fmt`, `fmt:check`, `lint`, `check`, `test`, `ci`. The
`start` task is removed (it pointed at a non-existent `dev.ts`); local execution
is `slack run`.

---

## 3. Project Layout

The implementer SHOULD produce this structure verbatim.

```
.
├── manifest.ts                       # Slack app manifest
├── deno.jsonc                        # Deno tasks, imports, compiler options
├── slack.json                        # Slack CLI hook wiring
├── README.md
├── DEVELOPMENT.md
├── DEPLOYMENT.md
├── SECURITY.md
├── AGENTS.md                         # Contributor workflow
├── .gitignore
├── .slackignore
├── .githooks/
│   └── pre-commit                    # Auto-fmt, lint, type-check
├── .github/
│   ├── copilot-instructions.md
│   ├── pull_request_template.md
│   └── workflows/
│       └── ci.yml                    # The single canonical CI workflow
├── datastores/
│   ├── decisions.ts
│   ├── votes.ts                      # Latest-state vote per user
│   ├── voters.ts                     # Required voters snapshot (with active flag)
│   └── vote_history.ts               # Append-only event log of every vote click
├── functions/
│   ├── create_decision.ts            # Slack function + block action handlers
│   └── process_active_decisions.ts   # Renamed from send_reminders: finalises past
│                                     # deadlines, then sends DM reminders
├── workflows/
│   ├── create_decision.ts
│   └── process_active_decisions.ts   # Renamed
├── triggers/
│   ├── consensus_command.ts          # /consensus shortcut
│   └── process_active_decisions_schedule.ts  # Mon–Fri 09:00 UTC
├── types/
│   ├── decision_types.ts
│   └── slack_types.ts
├── utils/
│   ├── adr_generator.ts
│   ├── concurrency.ts                # Re-read-and-bail helpers, finalized_at guard
│   ├── date_utils.ts                 # Tz-aware deadline resolution + business days
│   ├── decision_logic.ts             # Vote resolution (§15)
│   ├── escape_slack.ts               # Mrkdwn injection escape (proposal/name)
│   ├── log.ts                        # Structured JSON logger
│   └── slack_parse.ts
├── scripts/
│   └── deploy.sh                     # Real bash; computes future start_time
├── tests/
│   ├── adr_generator_test.ts
│   ├── channel_members_test.ts
│   ├── concurrency_test.ts
│   ├── create_decision_test.ts       # Type/shape tests
│   ├── date_utils_test.ts
│   ├── decision_logic_test.ts        # Robert's Rules + quorum coverage
│   ├── escape_slack_test.ts
│   ├── log_test.ts
│   ├── slack_parse_test.ts
│   ├── types_test.ts
│   ├── usergroup_expansion_test.ts
│   ├── vote_handler_test.ts          # Renamed from record_vote_test.ts
│   ├── process_active_decisions_test.ts
│   ├── integration/
│   │   ├── cancel_delete_test.ts
│   │   ├── channel_members_integration_test.ts
│   │   ├── create_decision_test.ts
│   │   ├── deactivation_test.ts
│   │   ├── deadline_finalisation_test.ts
│   │   ├── process_active_decisions_test.ts
│   │   ├── race_test.ts
│   │   ├── usergroup_integration_test.ts
│   │   └── vote_handler_test.ts
│   └── mocks/
│       └── slack_client.ts
└── docs/
    ├── adr/0001-use-slack-bolt-framework.md   # Historical (Azure era)
    ├── reviews/                              # Populated during the build
    ├── templates/{adr-template.md, feature-spec-template.md}
    ├── SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md
    ├── REDEVELOPMENT_SPECIFICATION.md         # this document
    └── REDEVELOPMENT_BUILD_PLAN.md
```

The `archive/` directory (Azure-era artefacts) is excluded from `deno fmt`,
`deno lint`, and `deno test` via `deno.jsonc`. It is also blocked from
deployment via `.slackignore`.

---

## 4. Slack App Manifest

`manifest.ts` exports a `Manifest({...})`. Required fields:

```ts
{
  name: "ConsensusBot",
  description:
    "Facilitate team decision-making through collaborative consensus building",
  icon: "assets/icon.png",                                    // optional
  workflows: [CreateDecisionWorkflow, ProcessActiveDecisionsWorkflow],
  datastores: [
    DecisionDatastore,
    VoteDatastore,
    VoterDatastore,
    VoteHistoryDatastore,
  ],
  outgoingDomains: [],
  botScopes: [
    "commands",            // /consensus slash command
    "chat:write",          // post / update messages
    "chat:write.public",   // post in channels the bot isn't a member of
    "datastore:read",      // query datastores
    "datastore:write",     // put / delete datastore items
    "pins:read",           // probe before unpinning
    "pins:write",          // pin / unpin decision messages
    "team:read",           // resolve workspace tz for deadline resolution
    "users:read",          // resolve names + bot/deactivated flags
    "usergroups:read",     // list / expand user groups
    "channels:read",       // resolve channel members (public)
    "groups:read",         // resolve channel members (private)
    "im:write",            // DM voters with reminders
  ],
}
```

The slash-command shortcut trigger in `triggers/consensus_command.ts` provides
the user-visible `/consensus`; no separate slash-command definition is needed in
the manifest.

`pins:read` is added so the cancel/delete handlers can check `pins.list` before
calling `pins.remove` (avoids benign error log spam). `team:read` is added for
the workspace-tz lookup driving deadline resolution (§19). `chat:write.public`
is retained so users can run `/consensus` in any channel without first inviting
the bot.

---

## 5. Data Model (Slack Datastores)

All four datastores use a single string `id` as the primary key. Slack
Datastores are DynamoDB-backed and **eventually consistent** for queries (§16).

### 5.1 `decisions`

| Attribute               | Type      | Required | Notes                                                                                                                             |
| ----------------------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | string PK | yes      | `crypto.randomUUID()` generated server-side. **Decoupled from `message_ts`.**                                                     |
| `name`                  | string    | yes      | User-supplied, escaped on render.                                                                                                 |
| `proposal`              | string    | yes      | User-supplied, escaped on render.                                                                                                 |
| `success_criteria`      | string    | yes      | One of `"simple_majority" \| "super_majority" \| "unanimous"`.                                                                    |
| `quorum`                | number    | yes      | Effective quorum at create time; see §15.                                                                                         |
| `required_voters_count` | number    | yes      | Snapshot at create time; denormalised so the vote handler doesn't requery.                                                        |
| `deadline`              | string    | yes      | The picked `YYYY-MM-DD` (raw input, retained for audit).                                                                          |
| `deadline_resolved`     | string    | yes      | The resolved end-of-day timestamp in workspace tz, ISO-8601 with offset.                                                          |
| `deadline_tz`           | string    | yes      | The IANA tz name used to resolve (e.g. `Europe/London`).                                                                          |
| `channel_id`            | string    | yes      | Where the voting message was posted.                                                                                              |
| `creator_id`            | string    | yes      | Slack user ID of the person who ran `/consensus`.                                                                                 |
| `message_ts`            | string    | yes      | Slack `message.ts` of the voting message. Updated post-create.                                                                    |
| `status`                | string    | yes      | `"active" \| "approved" \| "rejected" \| "cancelled"`.                                                                            |
| `outcome_reason`        | string    | no       | Human-readable reason set on finalisation (includes `"tied"`, `"deadlocked"`, `"quorum not met"`, etc.).                          |
| `finalized_at`          | string    | no       | ISO-8601 timestamp set immediately before the ADR post; nil while `active`. **Idempotency token** preventing double-finalisation. |
| `created_at`            | string    | yes      | `new Date().toISOString()` at create time.                                                                                        |
| `updated_at`            | string    | yes      | Updated on every status transition.                                                                                               |

`"deleted"` is **not** a status; deletion removes the row and its dependents
(§11).

### 5.2 `votes` — latest state

| Attribute     | Type      | Required | Notes                                                             |
| ------------- | --------- | -------- | ----------------------------------------------------------------- |
| `id`          | string PK | yes      | `${decision_id}_${user_id}`. Re-voting overwrites by primary key. |
| `decision_id` | string    | yes      | Foreign key to `decisions.id`.                                    |
| `user_id`     | string    | yes      | Slack user ID of the voter.                                       |
| `vote_type`   | string    | yes      | `"yes" \| "no" \| "abstain"`. Stored without any `vote_` prefix.  |
| `voted_at`    | string    | yes      | ISO-8601 timestamp of the most recent vote.                       |

A user can change their vote at any time before finalisation; the row is
overwritten in place. Every change is also appended to `vote_history`.

### 5.3 `voters`

| Attribute     | Type      | Required | Notes                                                                                                  |
| ------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `id`          | string PK | yes      | `${decision_id}_${user_id}`.                                                                           |
| `decision_id` | string    | yes      | Foreign key.                                                                                           |
| `user_id`     | string    | yes      | Slack user ID of a required voter.                                                                     |
| `is_active`   | boolean   | yes      | `true` at create. Set `false` when `users.info` later reports `deleted: true` (deactivation, see §18). |
| `created_at`  | string    | yes      | ISO-8601 timestamp.                                                                                    |

The voters list is a **point-in-time snapshot** taken at decision creation;
membership of usergroups/channels is not re-evaluated. Deactivated users are
excluded from `requiredVotersCount` and `quorum` at finalisation time (§13).

### 5.4 `vote_history` — append-only event log

| Attribute            | Type      | Required | Notes                                                                        |
| -------------------- | --------- | -------- | ---------------------------------------------------------------------------- |
| `id`                 | string PK | yes      | `${decision_id}_${user_id}_${event_seq}` — event_seq is a zero-padded count. |
| `decision_id`        | string    | yes      | Foreign key.                                                                 |
| `user_id`            | string    | yes      | Slack user ID.                                                               |
| `vote_type`          | string    | yes      | `"yes" \| "no" \| "abstain"`.                                                |
| `previous_vote_type` | string    | no       | The prior `vote_type`; `null` on first vote.                                 |
| `event_kind`         | string    | yes      | `"cast"` (first vote) or `"changed"` (overwrite).                            |
| `voted_at`           | string    | yes      | ISO-8601.                                                                    |

The ADR surfaces this so a viewer can see "Alice voted yes at 12:01, changed to
no at 14:32".

### 5.5 TypeScript record types

`types/decision_types.ts` exposes `DecisionRecord`, `VoteRecord`, `VoterRecord`,
`VoteHistoryRecord`, plus `DecisionItem` as an alias of `DecisionRecord` for
backward compatibility. `vote_type` is typed as the literal union
`"yes" | "no" | "abstain"`.

---

## 6. Triggers

### 6.1 `consensus_command` — slash-command shortcut

```ts
{
  type: "shortcut",
  name: "Create Consensus Decision",
  description: "Start a new consensus decision",
  workflow: `#/workflows/${CreateDecisionWorkflow.definition.callback_id}`,
  inputs: {
    interactivity: { value: "{{data.interactivity}}" },
    channel_id:    { value: "{{data.channel_id}}" },
    user_id:       { value: "{{data.user_id}}" },
  },
}
```

The user-facing `/consensus` is bound to this shortcut at trigger-creation time
via `slack triggers create`.

### 6.2 `process_active_decisions_schedule` — weekly cron

```ts
{
  type: "scheduled",
  name: "Process Active Decisions",
  description: "Finalise past-deadline decisions and send voter reminders",
  workflow:
    `#/workflows/${ProcessActiveDecisionsWorkflow.definition.callback_id}`,
  schedule: {
    start_time: "<future ISO-8601 timestamp at 09:00:00Z on a weekday>",
    frequency: {
      type: "weekly",
      repeats_every: 1,
      on_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
    timezone: "UTC",
  },
  inputs: {},
}
```

`start_time` defines time-of-day for weekly recurrences (the date drives the
first run; `frequency.on_days` filters subsequent runs). 09:00 UTC was chosen to
land before UK working hours (10:00 BST / 09:00 GMT).

**Critical implementation detail.** Slack rejects scheduled triggers whose
`start_time` is in the past with `invalid_start_before_now`. The static date in
the source file will drift; therefore `scripts/deploy.sh` MUST generate a
temporary trigger definition with a freshly computed start time (next weekday at
09:00 UTC) and feed that to `slack triggers create`. The static file is a
documentation reference, not a deploy artefact.

### 6.3 No vote-button trigger

Voting buttons MUST NOT use a separate event/workflow trigger. They are handled
by `.addBlockActionsHandler(...)` chained off the `CreateDecisionFunction` in
the same Deno process. ROSI does not support `slack#/events/block_actions` as an
event-trigger type, and an earlier `triggers/vote_button_trigger.ts` /
`workflows/vote.ts` / `RecordVoteFunction` chain has been retired.
Re-development must not reintroduce them.

---

## 7. Workflows

### 7.1 `CreateDecisionWorkflow` (`callback_id: create_decision_workflow`)

**Inputs.** `interactivity`, `channel_id`, `user_id` (all from the slash-command
trigger).

**Step 1 — `Schema.slack.functions.OpenForm`**

| Field name                | Type                                | Required | Notes                                                                                                   |
| ------------------------- | ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `decision_name`           | `string`                            | yes      | Title (≤ 200 chars, validated).                                                                         |
| `proposal`                | `string` (`long: true`)             | yes      | Multi-line (≤ 2500 chars, validated to fit Slack block limits).                                         |
| `required_voters`         | `array<Schema.slack.types.user_id>` | yes      | Native user picker.                                                                                     |
| `required_usergroups`     | `string` (`long: true`)             | no       | Free-text mentions/IDs/handles. Slack OpenForm does not support a usergroup picker; use string.         |
| `include_channel_members` | `boolean`                           | no       | "Include all channel members" checkbox.                                                                 |
| `success_criteria`        | `string` enum                       | yes      | `enum: ["simple_majority","super_majority","unanimous"]` with friendly choices.                         |
| `deadline`                | `Schema.slack.types.date`           | no       | Defaults to 5 business days from today when blank.                                                      |
| `quorum_override`         | `number`                            | no       | Optional. If supplied, replaces the per-criterion default quorum; `1 ≤ override ≤ requiredVotersCount`. |

The `required` list is exactly
`["decision_name","proposal","required_voters","success_criteria"]`.

`success_criteria` choices (label-rendered enum):

```ts
choices: [
  {
    value: "simple_majority",
    title: "Simple Majority",
    description:
      "More yes than no votes; abstentions excluded; ≥50% participation required.",
  },
  {
    value: "super_majority",
    title: "Two-Thirds Majority",
    description:
      "Yes votes ≥ 2/3 of decisive (yes+no) votes; abstentions excluded; ≥66% participation required.",
  },
  {
    value: "unanimous",
    title: "Unanimity",
    description:
      "All decisive votes are yes; abstentions allowed; full participation required.",
  },
];
```

The label / description copy MUST disambiguate the abstain semantics — too many
users assume "abstain ≡ no" by default.

**Step 2 — `CreateDecisionFunction`**

Form outputs are mapped 1:1 to the function inputs, plus `channel_id` and
`creator_id` from the workflow inputs.

### 7.2 `ProcessActiveDecisionsWorkflow` (`callback_id: process_active_decisions_workflow`)

Single step: invoke `ProcessActiveDecisionsFunction` with `{}`. No
interactivity.

---

## 8. The `create_decision` Function

`callback_id: "create_decision_function"`. Input parameters mirror the form plus
`channel_id` and `creator_id`. Output parameters are **none** — the function
does not return outputs by design (§8.5).

The function executes in the order below. Crucially, **all datastore rows are
written before the message is posted**; on a write failure no orphan message is
left in the channel.

### 8.1 Pre-flight validation

1. **Channel type guard.** Reject if `channel_id` does not start with `C`
   (public) or `G` (private). Return
   `{ error: "ConsensusBot must be used
   in a channel, not a DM." }`.
2. **Voter input.** Filter falsy values from `required_voters`. If
   `parsedVoterIds.length === 0` AND `include_channel_members !== true` AND
   `required_usergroups` is empty/whitespace, return
   `{ error: "No voters
   selected. Please pick at least one voter, usergroup, or check 'Include
   all channel members'." }`.
3. **Broadcast handles.** If `required_usergroups` parsing surfaces `@here`,
   `@channel`, or `@everyone` (§14), reject with
   `{ error: "Broadcast handles (@here, @channel, @everyone) are not
   supported as voter sources." }`.
4. **Length guards.** Reject `decision_name` > 200 chars, `proposal` > 2500
   chars (Slack `section.text` limit is 3000; we leave headroom for formatting).
5. **Past-dated deadline.** Resolve the deadline (§19) and reject if the
   resolved timestamp is in the past:
   `{ error: "Deadline must be in the future." }`.

### 8.2 Voter resolution algorithm

Maintain `allVoters: Set<string>`.

1. **Individual voters.** Add every ID in `parsedVoterIds`.
2. **Usergroups.**
   - Parse `required_usergroups` with `parseUsergroupInput` (§14).
   - For each handle, fetch `client.usergroups.list` (paginated) and find a
     group with a matching `handle`; resolve to its `id`. Skip and `log.warn` on
     unresolved handles. Tolerate API failure: `log.error` and continue.
   - For every resolved usergroup ID, call
     `client.usergroups.users.list({ usergroup })` (paginated for large groups
     via `cursor`) and add every member to `allVoters`. Tolerate per-group
     failures with `log.error` and continue.
3. **Bot filter** (applies uniformly to usergroups and channel members below).
   Before adding a member to `allVoters`, call `client.users.info({
   user })`
   and include only users where `is_bot !== true`, `deleted !==
   true`, AND
   `id !== "USLACKBOT"`. (USLACKBOT does not always carry `is_bot=true`.) Cache
   `users.info` responses in-function to avoid re-fetching across the usergroup
   and channel loops.
4. **Channel members** (only if `include_channel_members === true`).
   - Page through `client.conversations.members({ channel, cursor? })`
     accumulating IDs into a flat array.
   - Enforce a hard cap: `MAX_CHANNEL_VOTERS = 500`. If the channel exceeds it,
     return
     `{ error: "Channel has too many members (N).
     Maximum allowed is 500 voters. Please use individual user selection
     or user groups instead." }`.
   - Apply the bot filter (§8.2.3) to each member.
5. **Final validation.** If `allVoters.size === 0` after all expansions, return
   `{ error: "No eligible voters found after expansion. All
   candidates were bots or deactivated." }`.
6. Convert to array: `finalVoters = Array.from(allVoters)`.

Deduplication is implicit because `allVoters` is a `Set`. A voter who appears as
an individual selection, a usergroup member, **and** a channel member is counted
once.

### 8.3 Deadline & quorum resolution

1. **Resolve deadline.** Call `resolveDeadline(deadline_input,
   workspace_tz)`
   (§19). Stores `deadline` (raw `YYYY-MM-DD`), `deadline_resolved` (ISO-8601
   with offset), `deadline_tz` (IANA name).
2. **Compute quorum.** From `success_criteria` and `R =
   finalVoters.length`:

   ```
   quorum_default = {
     simple_majority: ceil(R / 2),
     super_majority:  ceil(R * 2 / 3),
     unanimous:       R,
   }
   ```

   If `quorum_override` is supplied AND `1 ≤ override ≤ R`, use it; else reject
   `quorum_override` out-of-range with an explicit error and proceed with the
   default.

### 8.4 Persisting state and posting the message

Order is intentional. **Datastore rows MUST be written before the Slack message
is posted.** This eliminates the orphan-message failure mode (audit §A.5).

1. Generate `decision_id = crypto.randomUUID()`.
2. Build the `decisions` record with `status: "active"`, `message_ts: ""`
   (placeholder, updated below), `finalized_at` unset, `quorum`,
   `required_voters_count: R`, `deadline`, `deadline_resolved`, `deadline_tz`,
   `created_at = updated_at = now`.
3. `apps.datastore.put` the decision. On failure, return `{ error }` — nothing
   further is attempted.
4. For each voter in `finalVoters`, `apps.datastore.put` a `voters` row
   (`is_active: true`). On any failure: `apps.datastore.delete` the decision row
   and any voter rows already written, return
   `{ error:
   "Failed to register voter ${id}. Decision aborted." }`.
   (Best-effort rollback; idempotent re-runs by the user are fine.)
5. **Post the message** (see §8.5 for the block layout). On failure: delete
   every row written above, return `{ error }`.
6. `apps.datastore.put` the decision again with the real `message_ts`. On
   failure, log but do not roll back — the message is live and the row is
   recoverable manually.
7. `pins.add({ channel, timestamp: message_ts })`. On failure, log and continue
   (cosmetic).

### 8.5 Block Kit message layout

All user-supplied text (`decision_name`, `proposal`) is escaped via
`escapeSlackText` (§14.3) before rendering. Mentions and broadcasts are rendered
as plain text.

`criteriaDisplay = success_criteria.replace(/_/g, " ").replace(/\b\w/g, l =>
l.toUpperCase())`.

`deadlineDisplay = formatDeadlineHuman(deadline_resolved, deadline_tz)` → e.g.
`"9 May 2026 at 23:59 GMT"` (§19).

Post `chat.postMessage` with `text: \`New Decision: ${escaped name}\``
(fallback) and these blocks, in order:

1. **Header** `🗳️ ${escaped name}`.
2. **Section (mrkdwn)** `*Proposal:*\n${escaped proposal}`.
3. **Section (fields, four mrkdwn)** Success Criteria, Deadline (with tz),
   Required Voters (mention all `finalVoters` as `<@id>` separated by `,`),
   Status (`🟢 Active — quorum ${quorum} of ${R}`).
4. **Divider.**
5. **Actions block (`block_id: "voting_actions"`)** with five buttons in this
   order. **Buttons carry the real `decision_id` (UUID) directly — no
   placeholder-and-update dance** since the ID is generated server-side before
   the post.

   | text         | action_id         | style     |
   | ------------ | ----------------- | --------- |
   | "✅ Yes"     | `vote_yes`        | `primary` |
   | "❌ No"      | `vote_no`         | `danger`  |
   | "⚪ Abstain" | `vote_abstain`    | (none)    |
   | "🚫 Cancel"  | `decision_cancel` | (none)    |
   | "🗑️ Delete"  | `decision_delete` | (none)    |

6. **Context (mrkdwn)**
   `Created by <@${creator_id}> | Vote by
   ${deadlineDisplay}`.

### 8.6 Block-action handlers

`SlackFunction(...).addBlockActionsHandler([action_ids], handler)` is chained
three times:

1. `["vote_yes", "vote_no", "vote_abstain"]` → vote handler (§9).
2. `["decision_cancel"]` → cancel handler (§10).
3. `["decision_delete"]` → delete handler (§11).

Handler context exposes `action`, `body`, `client`. Extract:

- `decision_id = action.value`
- `vote_type = action.action_id.replace(/^vote_/, "")` (vote handler only)
- `user_id = body.user.id`
- `channel_id = body.container.channel_id`
- `message_ts = body.container.message_ts`

The `decision_id` is the UUID, never a placeholder.

### 8.7 Workflow lifecycle

The function returns `{ completed: false }` at the end of its initial execution.
This keeps the workflow run alive so the chained block-action handlers continue
to receive button clicks. The function declares no output parameters — by
design.

---

## 9. Vote handler (Yes / No / Abstain)

For each click:

1. **Log** `vote_clicked` with `decision_id`, `user_id`, `vote_type` (§22).
2. **Load decision** via
   `apps.datastore.get({ datastore: "decisions", id:
   decision_id })`. On
   miss, post ephemeral `"Decision not found."` and return.
3. **Status guard.** If `decision.status !== "active"`, post ephemeral
   `"This decision is no longer active (${status})."` and return.
4. **Eligibility guard.**
   `apps.datastore.get({ datastore: "voters", id:
   "${decision_id}_${user_id}" })`.
   On miss OR `is_active === false`, post ephemeral
   `"You are not listed as an eligible voter for this
   decision."` and return.
5. **Past-deadline guard.** If `isDeadlinePassed(decision)` (§19), post
   ephemeral `"⏰ Voting closed at ${deadlineDisplay}. Finalising now."`, then
   proceed directly to `checkIfShouldFinalize` (§12) without recording the vote.
   **The vote is not recorded**; the click serves only to trigger finalisation.
6. **Persist vote.** Read the existing vote (if any) for `previous_vote_type`.
   `apps.datastore.put({ datastore: "votes", item: { id, decision_id,
   user_id, vote_type, voted_at: now } })`.
   On failure, post ephemeral
   `"❌ Failed to record your vote: ${error}. Please try again."` and return.
7. **Append vote_history.**
   `apps.datastore.put({ datastore:
   "vote_history", item: { id: "${decision_id}_${user_id}_${event_seq}",
   decision_id, user_id, vote_type, previous_vote_type, event_kind:
   previous_vote_type ? "changed" : "cast", voted_at: now } })`.
   The `event_seq` is determined by querying existing rows and using `count + 1`
   zero-padded to 4 digits. Best-effort: history failures are logged but do not
   block the vote.
8. **Eventually-consistent read.** Query `votes` for this `decision_id`. Build
   `mergedVotes`:
   ```ts
   mergedVotes = [
     ...(votesResponse.ok
       ? votesResponse.items.filter((v) => v.user_id !== user_id)
       : []),
     { id, decision_id, user_id, vote_type, voted_at: now },
   ];
   ```
   This guarantees the just-written vote appears even if the query reflects a
   stale read (§16).
9. **Update the message in place.** Re-emit the §8.5 layout but:
   - "Required Voters" field: `${decision.required_voters_count} voters` (label,
     not mentions). The count comes from the denormalised field on the decision
     row, not a `voters` query (audit §A.4).
   - "Status" field:
     `🟢 Active — quorum ${quorum} of ${R}\n*Votes:*
     ${voteCount}/${R}\nVoted: <@u1>, <@u2>`
     (truncate to 30 voters with `+N more` past that).
   - All five buttons remain, with `value = decision_id`. On failure, log and
     continue.
10. **Confirm to voter.** Post ephemeral
    `"${emoji} Your vote (${UPPER}) has been recorded for \"${escaped
    decision.name}\""`.
11. **Maybe finalise.** Call
    `checkIfShouldFinalize(client, decision_id,
    decision, mergedVotes)`
    (§12). If true, call `finalizeDecision(client, decision, mergedVotes)`
    (§13).

---

## 10. Cancel handler

`action_id === "decision_cancel"`. Permission: **any workspace member.**

1. Load decision; on miss → ephemeral `"Decision not found."` and return.
2. Status guard: if not `"active"` → ephemeral
   `"This decision is no longer
   active (${status})."` and return.
3. **Concurrency-safe write.** Use the `concurrency.reReadAndPut` helper (§16):
   re-load the decision row, re-check `status === "active"`, then put with
   `status: "cancelled"`, `outcome_reason: "cancelled by
   <@${user_id}>"`,
   `updated_at: now`. If the re-read shows a different status (a vote handler
   finalised it in the gap), abort and post ephemeral
   `"This decision was just finalised — cannot cancel."`
4. **Pin probe.** `pins.list({ channel })`. If the message is pinned,
   `pins.remove`; otherwise skip silently.
5. **Replace the message.** `chat.update` with three blocks: header
   (`🚫 ${escaped name}`), proposal section (escaped), fields section showing
   `*Status:* 🚫 Cancelled` and `*Cancelled by:* <@user_id>`, and a context
   element `Created by <@creator_id> | Cancelled at ${nowDisplay}`. No buttons.
6. Ephemeral confirmation:
   `"🚫 Decision \"${escaped name}\" has been
   cancelled."`

---

## 11. Delete handler

`action_id === "decision_delete"`. Permission: **only the original creator.**

1. Load decision; on miss → ephemeral `"Decision not found."` and return.
2. **Authorisation.** If `decision.creator_id !== user_id`, post ephemeral
   `"⛔ Only the creator of this decision can delete it."` and return.
3. Cascade-delete: query and delete every row where `decision_id` matches, in
   this order:
   1. `vote_history`
   2. `votes`
   3. `voters`
   4. `decisions` (the row itself)
4. **Pin probe.** As §10 step 4.
5. Try `chat.delete({ channel, ts: message_ts })`. If that fails (e.g. message
   too old), fall back to `chat.update` with a single section containing
   `_This decision (\"${escaped name}\") was deleted by
   <@user_id>._`.
6. Ephemeral confirmation:
   `"🗑️ Decision \"${escaped name}\" has been
   deleted."`

The delete is permanent and not recoverable.

---

## 12. Finalisation gating — `checkIfShouldFinalize`

```ts
async function checkIfShouldFinalize(
  client,
  decision_id,
  decision,
  mergedVotes,
): Promise<boolean>;
```

1. **Already finalised guard.** If `decision.finalized_at` is set, return
   `false` (the decision is not in a state where it should be re-evaluated).
2. **Past-deadline.** If `isDeadlinePassed(decision)`, return `true`. (Vote
   collection is closed; finalise with what we have.)
3. **All required voters voted.** Compute `voted = mergedVotes.length`. Use the
   denormalised `decision.required_voters_count` for `R`. Return `voted >= R`.
4. **Deadlock detection.** If
   `checkDeadlock(mergedVotes,
   decision.success_criteria, decision.required_voters_count, decision.quorum)`
   reports `isDeadlocked: true`, return `true`. (No further yes votes can change
   the outcome, finalise as `rejected` with a deadlock reason — §15.)

---

## 13. Finalisation — `finalizeDecision`

This is the only place `finalized_at` is written. The order matters: token
first, ADR after, so a partial run still presents the decision as finalised.

1. **Re-read decision.** `apps.datastore.get`. If `status !== "active"` OR
   `finalized_at` is set, abort silently (idempotent).
2. **Refresh voter activity.** For each voter, if `is_active === true`, call
   `users.info`. If the user is `deleted: true`, write `is_active: false` to the
   voter row. Log who was excluded.
3. **Recompute R.** `R_effective = voters.filter(is_active).length`. If
   `R_effective === 0`, set `status = "cancelled"`,
   `outcome_reason = "no
   eligible voters remain"`, write to message and ADR
   thread, return.
4. **Compute outcome.**
   `outcome = calculateDecisionOutcome(mergedVotes,
   decision.success_criteria, R_effective, decision.quorum)`
   (§15).
5. **Set the idempotency token.** `apps.datastore.put` the decision with
   `status: outcome.passed ? "approved" : "rejected"`,
   `outcome_reason:
   outcome.reason`, `finalized_at: now`, `updated_at: now`.
   **If the conditional re-read in step 1 raced and another finalizer is also
   running, last-write-wins; both finalizers will then see `finalized_at` set
   and skip the ADR post (step 9).**
6. **Pin probe + remove.** As §10 step 4.
7. **Update the message** with a "decided" layout: header
   `${✅|❌} ${escaped
   name}`, a section stating `*Status:* ${STATUS}` and
   `*Reason:*
   ${outcome.reason}`, a fields section with vote totals (`Yes`,
   `No`, `Abstain`, `Total`, `Required (effective)`). Surface `tied` /
   `deadlocked` reasons explicitly. No buttons.
8. **Build `userMap`.** Prefer the names cached during voter resolution
   (denormalised in `vote_history` events at vote time). Only fall back to
   `client.users.info` for users not in the cache.
9. **Re-check for double finalisation.** Re-read the decision row. If
   `finalized_at` was set by another concurrent run AND that other run's
   timestamp is earlier than ours, skip the ADR post. Otherwise proceed.
10. **Generate and post the ADR.**
    `adrMarkdown =
    generateADRMarkdown(decision, mergedVotes, voteHistory, outcome,
    userMap)`
    (§17). `chat.postMessage` with `thread_ts = message_ts` and
    `blocks = formatADRForSlack(adrMarkdown)` and
    `text: "ADR Generated -
    See thread for details"`.

The workflow run remains alive (`completed: false` semantics from §8.7); this is
intentional and not a leak.

---

## 14. Slack parsing utilities (`utils/slack_parse.ts`)

Two pure functions. Both accept `string | string[]` (the array form is a
backward-compatibility hatch).

### 14.1 `parseUserIds(input)`

Tokenises by `/[\s,]+/`. For each token:

- Slack mrkdwn user mention: `^<@([UW][A-Z0-9]+)(?:\|[^>]*)?>$` → capture
  group 1.
- Raw user ID: `^[UW][A-Z0-9]{5,}$` → token itself.

Else discard. Deduplicate. Returns `string[]`.

If `input` is a string array, return `[...new Set(input.filter(Boolean))]`.

### 14.2 `parseUsergroupInput(input): { ids, handles, broadcasts }`

Tokenises identically. For each token:

- `^<!subteam\^([A-Z0-9]+)(?:\|[^>]*)?>$` → push `ids`.
- `^S[A-Z0-9]{5,}$` → push `ids`.
- `^@(here|channel|everyone)$` → push `broadcasts` (caller MUST reject — see
  §8.1.3).
- `^@(.+)$` (length > 1, not a broadcast) → push `handles` with the leading `@`
  stripped.

Else discard. Deduplicate all three arrays.

If `input` is a string array, treat as IDs only:
`{ ids: dedup(input),
handles: [], broadcasts: [] }`.

### 14.3 `escapeSlackText(input: string): string`

Defined in `utils/escape_slack.ts` (referenced here for completeness). Replaces:

- `<` → `&lt;`
- `>` → `&gt;`
- `&` → `&amp;`

This is sufficient to neutralise `<@…>`, `<!channel>`, `<!here>`, and
`<!everyone>` mentions in user-supplied text. It also escapes triple backticks
safely for the ADR code-fence (§17).

These rules are pinned by `tests/slack_parse_test.ts` and
`tests/escape_slack_test.ts`. Re-development must make every assertion green.

---

## 15. Decision logic (`utils/decision_logic.ts`)

All vote counting is **pure** — no I/O, no datastore, no async. All comparisons
use **integer arithmetic** to avoid floating-point edge cases.

### 15.1 Model

For a decision with `R` required voters (effective; deactivated users excluded),
and a `quorum`:

| Concept            | Definition                               |
| ------------------ | ---------------------------------------- |
| **Votes cast**     | `yes + no + abstain`                     |
| **Decisive votes** | `yes + no` (abstentions excluded)        |
| **Quorum**         | Minimum `votes_cast` for a valid outcome |

Per-criterion pass conditions (integer-safe):

| Criterion         | Default quorum | Pass condition                                                |
| ----------------- | -------------- | ------------------------------------------------------------- |
| `simple_majority` | `ceil(R / 2)`  | `votes_cast ≥ quorum AND yes*2 > yes+no AND (yes+no) ≥ 1`     |
| `super_majority`  | `ceil(R*2/3)`  | `votes_cast ≥ quorum AND yes*3 ≥ (yes+no)*2 AND (yes+no) ≥ 1` |
| `unanimous`       | `R`            | `votes_cast ≥ quorum AND no == 0 AND yes ≥ 1`                 |

Abstentions are excluded from the numerator AND denominator across all criteria
(Robert's Rules / ISO Directives / UK Companies Act baseline).

### 15.2 Types

```ts
interface VoteCounts {
  yes: number;
  no: number;
  abstain: number;
  total: number;
}

interface DecisionResult {
  passed: boolean;
  reason: string; // e.g. "Simple majority achieved (5 yes of 7 decisive)"
  voteCounts: VoteCounts;
  decisiveVotes: number;
  effectiveRequiredVoters: number;
  quorum: number;
  quorumMet: boolean;
  outcome: "approved" | "rejected" | "tied" | "deadlocked";
}

interface DeadlockResult {
  isDeadlocked: boolean;
  reason: string;
  voteCounts: VoteCounts;
  remainingVotes: number;
}
```

### 15.3 `calculateVoteCounts(votes)`

Linear scan; increment `yes` / `no` / `abstain`. `total = votes.length`.

### 15.4 `calculateSimpleMajority(counts, R, quorum)`

```
votes_cast = counts.total
decisive   = counts.yes + counts.no

if votes_cast < quorum:
  return { passed: false, outcome: "rejected",
    reason: `Quorum not met (${votes_cast} of ${quorum} required)` }
if decisive == 0:
  return { passed: false, outcome: "rejected",
    reason: "No decisive votes (all abstentions)" }
if counts.yes * 2 > decisive:
  return { passed: true, outcome: "approved",
    reason: `Simple majority achieved (${counts.yes} yes of ${decisive} decisive)` }
if counts.yes == counts.no:
  return { passed: false, outcome: "tied",
    reason: `Tied (${counts.yes} yes, ${counts.no} no)` }
return { passed: false, outcome: "rejected",
  reason: `Simple majority not achieved (${counts.yes} yes of ${decisive} decisive)` }
```

### 15.5 `calculateSupermajority(counts, R, quorum)`

```
votes_cast = counts.total
decisive   = counts.yes + counts.no

if votes_cast < quorum:
  return { passed: false, outcome: "rejected",
    reason: `Quorum not met (${votes_cast} of ${quorum} required)` }
if decisive == 0:
  return { passed: false, outcome: "rejected",
    reason: "No decisive votes (all abstentions)" }
if counts.yes * 3 >= decisive * 2:
  return { passed: true, outcome: "approved",
    reason: `Two-thirds majority achieved (${counts.yes} yes of ${decisive} decisive)` }
return { passed: false, outcome: "rejected",
  reason: `Two-thirds majority not achieved (${counts.yes} yes of ${decisive} decisive)` }
```

### 15.6 `calculateUnanimity(counts, R, quorum)`

```
votes_cast = counts.total

if votes_cast < quorum:
  return { passed: false, outcome: "rejected",
    reason: `Quorum not met (${votes_cast} of ${quorum} required)` }
if counts.yes == 0:
  return { passed: false, outcome: "rejected",
    reason: "No yes votes cast" }
if counts.no > 0:
  return { passed: false, outcome: "rejected",
    reason: `Unanimity not achieved (${counts.no} vote(s) against)` }
return { passed: true, outcome: "approved",
  reason: `Unanimity achieved (${counts.yes} yes, ${counts.abstain} abstention(s))` }
```

Abstentions never block unanimity (note the parallel with §C.8 of the audit).

### 15.7 `calculateDecisionOutcome(votes, criteria, R, quorum)`

Switches on `criteria`. `default` returns
`{ passed: false, outcome:
"rejected", reason: "Invalid success criteria: X", voteCounts, ...,
error: true }`.

### 15.8 `checkDeadlock(votes, criteria, R, quorum)`

Used by `checkIfShouldFinalize` (§12) to short-circuit when the outcome cannot
change.

```
votes_cast = counts.total
remaining  = R - votes_cast

switch criteria:
  case simple_majority:
    // Best case for yes: all remaining vote yes
    max_yes      = counts.yes + remaining
    max_decisive = counts.yes + counts.no + remaining
    // If even max yes can't exceed half of max decisive, deadlocked
    if max_yes * 2 <= max_decisive:
      return { isDeadlocked: true,
        reason: "Cannot achieve simple majority even with all remaining yes" }
    break

  case super_majority:
    max_yes      = counts.yes + remaining
    max_decisive = counts.yes + counts.no + remaining
    if max_yes * 3 < max_decisive * 2:
      return { isDeadlocked: true,
        reason: "Cannot achieve two-thirds majority even with all remaining yes" }
    break

  case unanimous:
    if counts.no > 0:
      return { isDeadlocked: true,
        reason: "Unanimity impossible — at least one no vote already cast" }
    break

return { isDeadlocked: false, reason: "" }
```

Quorum is **not** part of the deadlock check at runtime — even if quorum hasn't
been met, the outcome could still change with more voters; we simply wait for
the deadline-finalisation path.

When `checkDeadlock` returns `true`, finalisation runs with
`outcome:
"deadlocked"` (a flavour of `rejected` in the status, with the
deadlock reason in `outcome_reason`).

---

## 16. Concurrency, consistency, and idempotency

Slack Datastores are DynamoDB-backed and only **eventually consistent** for
query operations. They expose no conditional puts or transactions. Three
patterns mitigate this:

### 16.1 Vote merge (read-after-write)

After `put`-ing the user's vote, the subsequent `query` of `votes` may omit it.
The vote handler MUST build a `mergedVotes` array by filtering the user's stale
row out of the query results and appending the just-written vote.

### 16.2 Skip-stale-query at the finalisation gate

The vote handler passes `mergedVotes` directly to `checkIfShouldFinalize` (§12).
The gate uses the merged length and avoids re-querying `votes`, sidestepping the
eventual-consistency hole entirely.

### 16.3 `finalized_at` idempotency token

`finalizeDecision` (§13) writes `finalized_at` immediately before posting the
ADR. A re-read inside `finalizeDecision` (step 1 and step 9) detects concurrent
finalisation runs:

- Step 1 aborts silently if `finalized_at` is already set when the run starts.
- Step 9 re-reads after the status flip; if a peer wrote a strictly earlier
  `finalized_at`, the current run skips the ADR post.

The result is at-most-once ADR semantics in practice; under heavy contention
duplicate ADRs are theoretically possible (no native CAS in ROSI) but
vanishingly rare. Tests in §21 (D.2) verify the typical case.

### 16.4 Re-read-and-bail on cancel/delete

The cancel handler (§10) and finalisation (§13) re-read the decision row
immediately before any status-changing put. If the status has moved on, the
operation aborts and surfaces an ephemeral. This is best-effort CAS; combined
with the `finalized_at` token, the race window is narrow.

A reusable helper lives in `utils/concurrency.ts`:

```ts
export async function reReadAndCheck<T>(
  client: SlackClient,
  datastore: string,
  id: string,
  expect: (item: T) => boolean,
): Promise<{ ok: true; item: T } | { ok: false; reason: string }> {
  const got = await client.apps.datastore.get({ datastore, id });
  if (!got.ok || !got.item) return { ok: false, reason: "not_found" };
  const item = got.item as T;
  if (!expect(item)) return { ok: false, reason: "predicate_failed" };
  return { ok: true, item };
}
```

### 16.5 What this spec does NOT promise

- No strict serialisability across handlers. Two handlers running simultaneously
  can both see "active" and both attempt a status flip; last-write-wins.
- No native rollback for partial failures across multiple datastores. The
  ordering in §8.4 minimises blast radius but does not eliminate it.
- No retry of failed Slack API calls (audit §B.39, §B.40). A future iteration
  adds bounded retry with jittered backoff; v1 surfaces failures in ephemerals
  and logs.

These are documented constraints. Tests pin the mitigations, not perfect
isolation.

---

## 17. ADR generation (`utils/adr_generator.ts`)

### 17.1 `generateADRMarkdown(decision, votes, voteHistory, outcome, userMap)`

Builds a markdown ADR. Whitespace and trailing two-space line breaks are
significant. User-supplied fields (`name`, `proposal`) are escaped via
`escapeSlackText` AND have any triple-backtick sequences neutralised
(`\`\`\``→`\\\`\\\`\\\``) to prevent code-fence break-out (audit §B.30).

```
# ${escaped name}

**Status:** ${outcome.passed ? "Accepted" : "Rejected"}  
**Date:** ${YYYY-MM-DD of decision.created_at}  
**Decision ID:** ${decision.id}  
**Success Criteria:** ${criteriaDisplay}  
**Quorum:** ${quorum} of ${R_effective} required voters  
**Deadline:** ${deadlineDisplay}

## Context

${escaped proposal}

## Decision

This decision was put to a vote using the **${criteriaDisplay}** consensus criterion.

### Voting Results

**Outcome:** ${outcome.passed ? "✅ APPROVED" : "❌ REJECTED"}  
**Reason:** ${outcome.reason}

**Vote Breakdown:**
- Yes: ${counts.yes}
- No: ${counts.no}
- Abstain: ${counts.abstain}
- Total Votes: ${counts.total}
- Required Voters (effective): ${R_effective}
- Decisive Votes (yes+no): ${decisive}
- Quorum: ${quorum} (${quorumMet ? "met" : "not met"})

### Individual Votes

- ${✅|❌|⚪} ${userMap.get(user_id) ?? user_id}: ${VOTE_TYPE_UPPER}
… (one per voter, latest vote shown; vote changes flagged below)

### Vote History

${voteHistory.length > votes.length
  ? "The following voters changed their vote during the decision:\n\n" +
    voteHistory.filter(h => h.event_kind === "changed").map(h =>
      `- ${userMap.get(h.user_id)}: ${h.previous_vote_type.toUpperCase()} → ${h.vote_type.toUpperCase()} at ${h.voted_at}`
    ).join("\n")
  : "_No voters changed their vote._"}

### Excluded Voters

${anyDeactivated
  ? "The following voters were deactivated during the decision and excluded from quorum:\n\n" +
    deactivatedVoters.map(v => `- ${userMap.get(v.user_id) ?? v.user_id}`).join("\n")
  : "_None._"}

## Consequences

### If Accepted

${if outcome.passed: "This decision has been approved and should be implemented as proposed."
  else:              "N/A — Decision was not approved."}

### If Rejected

${if !outcome.passed: "This decision was rejected. The team may revisit this proposal in the future with modifications or abandon it entirely."
  else:               "N/A — Decision was approved."}

## Implementation Notes

${if outcome.passed: "Teams should proceed with implementing the proposal as described in the Context section."
  else:              "No implementation required as decision was rejected."}

## References

- **Decision Created:** ${ISO 8601 of decision.created_at}
- **Deadline Resolved:** ${decision.deadline_resolved} (${decision.deadline_tz})
- **Finalised:** ${decision.finalized_at}
- **Creator:** <@${decision.creator_id}>
- **Total Participants:** ${voters.length}

---

*This ADR was automatically generated by ConsensusBot*  
*Suggested filename: `${YYYY-MM-DD}-${slug(name)}-${decision.id.slice(0,8)}.md`*
```

The filename slug uses ASCII-folding
(`name.toLowerCase().replace(/[^a-z0-9]+/g, "-")`) plus the first 8 chars of the
UUID to make it collision-resistant when two decisions share a name on a date
(audit §D.8).

### 17.2 `formatADRForSlack(adrMarkdown)`

Returns three blocks in order:

1. Section: "📝 _Architecture Decision Record Generated_\n\nThe decision has
   been finalised. Below is the ADR markdown that can be copied to your
   documentation repository:".
2. Section: triple-backtick fenced code block containing `adrMarkdown`.
   (Backticks in the markdown body are escaped per §17.1.)
3. Context: "💡 _To archive this ADR:_ Copy the markdown above and paste it into
   your team's documentation repository or wiki."

These exact strings are asserted by `tests/adr_generator_test.ts`.

---

## 18. Process Active Decisions (`functions/process_active_decisions.ts`)

`callback_id: "process_active_decisions_function"`. No inputs.

This function runs on the weekday 09:00 UTC tick (§6.2). It does **two** things,
in this order: (a) finalise every `active` decision whose deadline has passed;
(b) send DM reminders to non-voters on still-active decisions.

### 18.1 Phase A — Finalise past-deadline decisions

1. Query all `decisions` where `status = "active"` AND `finalized_at` is nil
   (expression with two conditions; or query by status and filter by
   finalized_at in code).
2. For each row, if `isDeadlinePassed(decision)`:
   - Query the latest `votes` for this decision.
   - Call `finalizeDecision(client, decision, votes)` (§13). The `finalized_at`
     token guarantees idempotency if a vote handler is racing.

### 18.2 Phase B — Send reminders

3. For each remaining `active` decision (not past deadline):
   - Query `voters` for this decision.
   - Filter to `is_active === true`. (Voter rows for users who are now
     deactivated are flipped to `is_active=false` here as a side effect: for
     each `is_active=true` voter, call `users.info`; if `deleted ===
     true`,
     write `is_active=false` to the voter row.)
   - Query `votes` for this decision.
   - Compute `votedUserIds = new Set(votes.items.map(v => v.user_id))`.
   - `missingVoters = voters.items.filter(v => v.is_active &&
     !votedUserIds.has(v.user_id))`.
   - For each missing voter, call
     `sendReminderDM(client, user_id,
     decision)` (§18.4). Increment
     `remindersSent` if successful.

### 18.3 Pagination & rate limiting

The active-decisions query and the per-decision queries MUST iterate
`response_metadata.next_cursor` if present (Slack returns paged results for
large datastores). Enforce a soft cap of 1000 active decisions per tick to stay
inside the function timeout; if exceeded, log a warning and process the
first 1000.

### 18.4 `sendReminderDM(client, userId, decision)`

`chat.postMessage({ channel: userId, text, blocks })` where `channel:
userId`
opens an IM (Slack accepts a user ID as a channel for DMs given `im:write`).

Blocks:

1. Section: `"👋 Hi! You have a pending vote on a consensus decision."`
2. Section:
   `"*Decision:* ${escaped name}\n*Deadline:* ${deadlineDisplay}\n\nPlease visit
   <#${channel_id}> to cast your vote."`
3. Context: `"This is an automated reminder from ConsensusBot"`.

Fallback `text`: `"Reminder: You have a pending vote for \"${escaped name}\""`.
Return the boolean `result.ok`. Catch and log errors as failures (do not throw).

### 18.5 Output

Return
`{ outputs: { reminders_sent: remindersSent, decisions_finalised:
finalisedCount } }`.
Both fields are surfaced for observability via `slack activity`.

---

## 19. Date & time utilities (`utils/date_utils.ts`)

All timestamps are ISO-8601. The deadline resolver is the most subtle piece.

### 19.1 `addBusinessDays(days, startDate = new Date()): Date`

Increment one calendar day at a time, only counting weekdays (`getDay()` not 0
or 6) until `daysAdded === days`. Returns `Date`. Bank-holiday calendars are out
of scope (§22.B1).

### 19.2 `getDefaultDeadline(workspaceTz): string`

`addBusinessDays(5)`, then resolve to end-of-day in `workspaceTz`, then
`formatDate` to `YYYY-MM-DD`. The form picker stores a date; the resolution to a
tz-aware timestamp happens on submission.

### 19.3 `formatDate(d: Date | string): string`

`(typeof d === "string" ? new Date(d) : d).toISOString().split("T")[0]`.

### 19.4 `resolveDeadline(deadlineDate: string, workspaceTz: string): { iso: string; tz: string; humanDisplay: string }`

The core fix for audit §A.11.

1. Parse `deadlineDate` (`YYYY-MM-DD`) as a calendar date in `workspaceTz`.
2. Resolve to the last instant of that calendar day in `workspaceTz`:
   `23:59:59.999`. Compute the equivalent ISO-8601 timestamp **with the correct
   UTC offset** for that local time on that date (DST-aware).
3. Return `{ iso, tz, humanDisplay }` where:
   - `iso` is e.g. `"2026-05-09T22:59:59.999Z"` (the UTC instant equivalent to
     23:59:59 BST on 9 May 2026).
   - `tz` is e.g. `"Europe/London"`.
   - `humanDisplay` is `"9 May 2026 at 23:59 BST"`.

Implementation note. Deno provides `Intl.DateTimeFormat` with `timeZone`
support; combine it with `Temporal` polyfill OR a small manual offset table. For
the v1, use `Intl.DateTimeFormat({ timeZone })` to derive the offset and do
plain `Date` arithmetic; document the ~one-second precision.

### 19.5 `getWorkspaceTz(client: SlackClient): Promise<string>`

Call `client.team.info()` and return `team.tz` (an IANA name, e.g.
`Europe/London`). Cache the result in-function — it doesn't change on business
timescales. If the call fails, fall back to `"Europe/London"` (the operator's
primary tz; document this).

### 19.6 `isDeadlinePassed(decision: DecisionRecord): boolean`

`new Date(decision.deadline_resolved) < new Date()`. The comparison is between
two UTC instants — tz-correct because `deadline_resolved` was already converted
in §19.4.

### 19.7 `formatDeadlineHuman(deadlineResolved: string, tz: string): string`

`Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "long",
timeStyle: "short", timeZoneName: "short" }).format(new
Date(deadlineResolved))`.
Yields e.g. `"9 May 2026, 23:59 BST"`.

---

## 20. Slack types (`types/slack_types.ts`)

A hand-written `SlackClient` interface narrows the SDK's `client` to exactly the
surface the app uses:

- `apps.datastore.{get, put, query, delete}`
- `chat.{postMessage, postEphemeral, update, delete}`
- `users.info` (returns `{ id, real_name, name, is_bot, deleted }`)
- `conversations.members` (cursor-paginated)
- `pins.{list, add, remove}`
- `usergroups.list` (cursor-paginated), `usergroups.users.list`
  (cursor-paginated)
- `team.info` (returns `{ tz }`)

It also defines `SlackBlock`, `SlackElement`, `SlackTextObject`,
`SlackButtonElement`, `SlackUsergroupSummary`, `SlackUserInfo`.

Avoid `any`. The interface is consumed by every utility/function file and by the
integration tests' `MockSlackClient`. The mock implements the full surface. New
methods (`team.info`, `pins.list`, `users.info.deleted`, cursor pagination on
`usergroups.*`) MUST be present in both the type and the mock.

---

## 21. Tests

The test suite is the contract. Re-development must reproduce both the test
files and their assertions verbatim — they pin the spec.

### 21.1 Unit tests (`tests/*.ts`)

| File                                                 | Coverage                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `decision_logic_test.ts`                             | All criteria × Robert's Rules edge cases (§D.1 of audit): quorum-not-met, all-abstain, tied, integer-arithmetic boundaries (e.g. 67 yes / 33 no passes super; 66/34 fails), unanimity with abstentions, deadlock detection.                      |
| `date_utils_test.ts`                                 | Weekday skipping, default deadline format, `formatDate`, deadline comparison.                                                                                                                                                                    |
| `escape_slack_test.ts`                               | `<`/`>`/`&` escapes; `<@U…>`, `<!channel>`, `<!here>` neutralised.                                                                                                                                                                               |
| `log_test.ts`                                        | Structured log lines emit JSON with `event`, `decision_id`, `actor_id`, `result`.                                                                                                                                                                |
| `adr_generator_test.ts`                              | Approved + rejected ADR contents; abstain handling; missing-userMap fallback; deactivated voter list rendering; vote-history rendering when changes occurred; suggested-filename collision-resistance via UUID prefix; three-block Slack format. |
| `types_test.ts`                                      | All record interfaces; `success_criteria` and `status` enum domains; new `vote_history` and `quorum`/`finalized_at` fields.                                                                                                                      |
| `slack_parse_test.ts`                                | All parsing rules for users and usergroups; broadcast detection (`@here`/`@channel`/`@everyone`); dedup; legacy-array hatch.                                                                                                                     |
| `usergroup_expansion_test.ts`                        | Single/multi-group dedup, individual+group dedup, empty/missing/large groups, **bot filter applied to usergroup members**, paginated `usergroups.list` and `usergroups.users.list`.                                                              |
| `channel_members_test.ts`                            | Bot/USLACKBOT filtering, individual/group/channel dedup, pagination, max-voter limit, deactivated-user filter.                                                                                                                                   |
| `create_decision_test.ts`                            | `SlackClient` shape; `SlackBlock` shapes; `actions`-block transform; UUID format; tz-resolved deadline rendering.                                                                                                                                |
| `vote_handler_test.ts` _(was `record_vote_test.ts`)_ | Vote-type normalisation; `DecisionRecord` / `VoteRecord` shape; `vote_history` event-seq generation.                                                                                                                                             |
| `process_active_decisions_test.ts`                   | Past-deadline finalisation phase; reminder phase; missing-voter computation; deactivated-voter exclusion; type casts on query items; pagination of active decisions.                                                                             |
| `concurrency_test.ts`                                | `reReadAndCheck` happy path and predicate-failed path; `finalized_at` idempotency token semantics.                                                                                                                                               |

### 21.2 Integration tests (`tests/integration/*.ts`)

Drive a `MockSlackClient` (`tests/mocks/slack_client.ts`) through realistic
sequences. The mock records every API call into `calls: MockCall[]`, exposes
helpers (`setUsergroupMembers`, `setChannelMembers`, `setUserInfo`,
`setDatastoreItem`, `setDatastoreQueryResults`, `enableChannelMemberPagination`,
`setTeamTz`, `setUserDeleted`, `forceFailure`, `clearCalls`, `getCallsFor`), and
supports in-memory pagination for `conversations.members`, `usergroups.list`,
`usergroups.users.list`.

| File                                   | Behaviours pinned                                                                                                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_decision_test.ts`              | UUID-based decision_id; rollback-on-failure ordering (datastore put failure rolls back; message-post failure rolls back); tz-resolved deadline; bot filter; **vote-merge / eventual consistency** (the three EC cases from §16).                                      |
| `vote_handler_test.ts` _(integration)_ | yes/no/abstain put + vote_history append; vote-update path (overwrite + history changed event); vote query; ephemeral confirm; vote-type normalisation; **vote-after-deadline triggers finalisation without recording**.                                              |
| `process_active_decisions_test.ts`     | Past-deadline finalisation produces ADR exactly once (idempotency token honoured); deactivated voters excluded from `requiredVotersCount`; reminder DMs sent only to active non-voters; pagination of active decisions; rate-limit-failure logged but loop continues. |
| `cancel_delete_test.ts`                | Cancel transitions status atomically (re-read+predicate); cascade delete of vote_history + votes + voters + decision; pin probe (skip remove if not pinned); chat.delete fallback to chat.update on too-old message; non-creator delete rejected.                     |
| `channel_members_integration_test.ts`  | Channel expansion + bot/USLACKBOT/deactivated filter; dedup with individual + usergroup; pagination; backward-compat no-op when `include_channel_members=false`; end-to-end combined flow.                                                                            |
| `usergroup_integration_test.ts`        | Multi-group expansion + dedup; broadcast handles rejected; bot filter; paginated `usergroups.list` + `usergroups.users.list`; backward-compat for missing usergroups.                                                                                                 |
| `deadline_finalisation_test.ts`        | Past-deadline `active` decision is finalised by Phase A; vote click after deadline triggers finalisation, no vote stored; `finalized_at` prevents double-ADR when both phases race.                                                                                   |
| `deactivation_test.ts`                 | Voter deactivated mid-flight is excluded from R_effective; if all voters deactivated, decision auto-cancels with `outcome_reason: "no eligible voters remain"`; ADR records who was excluded.                                                                         |
| `race_test.ts`                         | Two simultaneous `vote_yes` clicks producing finalisation: exactly one ADR posted; `pins.remove` called at most twice without uncaught error; cancel-vs-vote race resolves to a consistent terminal state.                                                            |

The CI pipeline (`.github/workflows/ci.yml`) is the contract for how these are
run; integration tests run after unit tests in the same job.

---

## 22. Backlog (deliberately deferred)

These are out of scope for v1 but documented so reviewers know they were
considered.

| #   | Item                                                                         | Rationale                                                                                                               |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| B1  | Bank-holiday-aware `addBusinessDays`                                         | Requires a bank-holiday source / external dependency. v1 skips weekends only.                                           |
| B2  | Retry with exponential backoff on Slack 5xx / 429                            | Adds complexity and a retry budget that need testing. v1 surfaces failures in ephemerals and logs.                      |
| B3  | Auto-archive ADR to a configured external location (Confluence, GitHub repo) | Requires `outgoingDomains`, secrets, error handling. v1's manual handoff was the explicit ROSI-migration design choice. |
| B4  | Multi-channel decisions (cross-post, watcher channels)                       | Adds significant data-model complexity and notification routing.                                                        |
| B5  | Decision templates (re-runnable categories like "release-blocker review")    | Useful but a layer above the v1 mechanic.                                                                               |
| B6  | Vote delegation                                                              | Governance complexity; needs separate spec.                                                                             |
| B7  | Custom criteria (e.g. weighted voting, three-fifths)                         | Add as a fourth criterion when there's demand.                                                                          |
| B8  | Analytics dashboard                                                          | Out of scope for ROSI's data-residency model.                                                                           |
| B9  | Internationalisation of UI strings                                           | English-only at v1; deferred until a non-EN workspace is on the roadmap.                                                |
| B10 | i18n-aware deadline formatting                                               | Currently `en-GB`. Easy to extend if needed.                                                                            |
| B11 | Strict-CAS-equivalent for cancel/finalise via a side-channel lock row        | Diminishing returns past the `finalized_at` token in §16.3.                                                             |
| B12 | Workspace-tz override per decision                                           | Most teams want workspace-default; fold into the form if a request emerges.                                             |

---

## 23. Tooling, contributor workflow, and CI

### 23.1 Deno tasks (`deno.jsonc`)

| Task        | Command                                                                      |
| ----------- | ---------------------------------------------------------------------------- |
| `fmt`       | `deno fmt`                                                                   |
| `fmt:check` | `deno fmt --check`                                                           |
| `lint`      | `deno lint`                                                                  |
| `check`     | `deno check manifest.ts`                                                     |
| `test`      | `deno test --allow-all tests/`                                               |
| `ci`        | `deno task fmt:check && deno task lint && deno task check && deno task test` |

`fmt`, `lint`, and `test` exclude `archive/`. Strict TypeScript is on. The
`start` task is removed.

### 23.2 Pre-commit hook (`.githooks/pre-commit`)

```
#!/usr/bin/env sh
set -e
echo "Running pre-commit checks..."
deno fmt
if ! git diff --quiet; then
  echo "ERROR: deno fmt modified files. Please stage the formatted changes and commit again."
  git diff --name-only
  exit 1
fi
deno task lint
deno task check
echo "Pre-commit checks passed."
```

Enabled with `git config core.hooksPath .githooks`. The hook does not run
`deno task test` to keep commits fast; CI catches test regressions.

### 23.3 GitHub Actions

The single canonical workflow is:

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v1
        with: { deno-version: v1.x }
      - run: deno task fmt:check
      - run: deno task lint
      - run: deno task check
      - run: deno task test
```

### 23.4 PR template & contributor docs

`AGENTS.md` (the contributor workflow) and `.github/copilot-instructions.md`
(the agent's mandate) both stipulate: **run `deno fmt` before every commit** and
**run `deno task ci` before opening a PR**. The PR template requires a checklist
confirming each `deno task` ran clean.

The Copilot instructions explicitly forbid modifying CI YAML, `deno.jsonc`, or
the PR template, and forbid claiming "checks blocked by network" as an excuse
for skipped checks.

### 23.5 Structured logging (`utils/log.ts`)

A 30-line wrapper around `console.log` that emits one JSON object per log:

```ts
log.info({ event: "vote_recorded", decision_id, user_id, vote_type, voted_at });
log.warn({ event: "usergroup_handle_unresolved", handle });
log.error({ event: "datastore_put_failed", datastore, id, error });
```

Every state transition (`decision_created`, `vote_cast`, `vote_changed`,
`decision_cancelled`, `decision_deleted`, `decision_finalised`, `reminder_sent`,
`voter_deactivated`) emits a log line. `slack activity` returns these as
queryable JSON.

---

## 24. End-to-end deploy procedure

The expected first-time deploy is:

```bash
slack login                               # OAuth in browser
slack create                              # in repo root; pick workspace
slack deploy                              # builds + deploys to Slack ROSI
slack triggers create --trigger-def triggers/consensus_command.ts
./scripts/deploy.sh                        # creates the schedule trigger
                                          # with a fresh future start_time
slack triggers list                        # verify both exist
```

For ongoing development:

- `slack run` → Socket-Mode dev loop with hot reload.
- `slack activity --tail` → live structured-log stream.
- `slack deploy` → push updates.
- `slack delete` → tear down (also deletes Datastore data — irreversible).

For an isolated production app, repeat `slack create` against a separate
production workspace, then `slack deploy` in that context. There is no
configured automated CI deploy; deploys are manual.

---

## 25. Acceptance criteria for "done"

A re-development is correct when **all** the following hold:

1. `deno task ci` passes from a fresh clone with no untracked changes.
2. Every test in §21 passes verbatim, with the same assertions, against the
   re-implemented modules.
3. `slack deploy` succeeds against a fresh Slack workspace (Pro plan or higher).
4. `/consensus` opens the modal and produces an active decision message with the
   exact six-block layout described in §8.5, where buttons carry the UUID
   `decision_id` from creation (no placeholder window).
5. **Vote behaviour:**
   - Yes/No/Abstain updates the message in place with vote counts and voted-by
     mentions.
   - Sends an ephemeral confirmation to the voter.
   - Reflects the just-cast vote in finalisation gating even if a backing query
     is stale (§16.1, §16.2).
   - A vote click after the deadline does NOT record but DOES trigger
     finalisation (§9 step 5).
   - Cancel and Delete behave per §10–§11.
6. **Finalisation:**
   - Reaching `R_effective` votes triggers the finalisation path immediately.
   - The 09:00 UTC weekday tick auto-finalises any past-deadline `active`
     decisions in the same run as it sends reminders (§18.1).
   - Concurrent finalisation paths do not produce a duplicate ADR
     (`finalized_at` token honoured, §16.3).
   - The finalised message is updated, unpinned, and an ADR-formatted thread
     reply is posted matching §17.
7. **Reminders:** Mon–Fri 09:00 UTC tick DMs only voters who are
   `is_active === true` and have not yet voted on still-active decisions whose
   deadlines have not passed.
8. **Vote resolution:** §15 holds for all three criteria with quorum enforced;
   abstentions never count for or against. 1-of-10 yes votes does NOT pass
   simple_majority.
9. **Deadline tz:** `2026-05-09` resolves to `2026-05-09T22:59:59.999Z` for a
   London-tz workspace (BST), and the message renders
   `"9 May 2026
   at 23:59 BST"`. (DST-aware.)
10. **Voter deactivation:** A voter deactivated mid-flight is excluded from
    `R_effective` at finalisation; if all voters are deactivated, the decision
    auto-cancels with `outcome_reason: "no eligible voters
    remain"`.
11. **Vote history:** A voter who changes their vote produces a `vote_history`
    entry with `event_kind: "changed"`, surfaced in the ADR.
12. **Zero secrets.** `slack env list` returns nothing the app depends on.

---

## 26. Reference: external resources

- Slack Automation: <https://api.slack.com/automation>
- Slack ROSI Functions: <https://api.slack.com/automation/functions>
- Slack ROSI Datastores: <https://api.slack.com/automation/datastores>
- Slack ROSI Scheduled Triggers:
  <https://api.slack.com/automation/triggers/scheduled>
- Slack `team.info`: <https://api.slack.com/methods/team.info>
- Deno Manual: <https://deno.land/manual>
- Robert's Rules of Order, 12th ed. (abstention semantics, §45)
- UK Companies Act 2006 §282–§283 (ordinary / special resolutions)
- ISO/IEC Directives Part 1, §2.7.5 (NWIP voting rules)
- IETF RFC 7282 (rough consensus)
- `docs/SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md` — historical rationale for
  this architecture.

---

_End of specification._
