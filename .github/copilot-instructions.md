# Copilot / AI-agent contributor mandate

These instructions are binding for every AI agent (Copilot, Claude, etc.)
contributing to ConsensusBot v2.0. The source of truth for behaviour is
`docs/REDEVELOPMENT_SPECIFICATION.md`. This file is pinned by SPEC §23.4.

## Style

- TypeScript strict mode. No `any`. No `// @ts-ignore`.
- When a value's shape is not statically known, type it as `unknown` and narrow
  with explicit type guards before use.
- Prefer named exports and explicit return types on exported functions.

## Pre-commit

- Run `deno fmt` before every commit.
- The repo's pre-commit hook (`.githooks/pre-commit`, enabled via
  `git config core.hooksPath .githooks`) does this automatically.
- If the hook isn't installed, run the following manually before committing:
  ```
  deno fmt
  deno task lint
  deno task check
  ```

## Pre-PR

- Run `deno task ci` and confirm it is green before opening a PR.
- The PR template's checklist must be filled in honestly.

## Filing issues

When opening a GitHub issue (via web UI or `gh issue create`), follow the
structure in [`.github/ISSUE_TEMPLATE.md`](ISSUE_TEMPLATE.md): Problem → Repro /
Background → Why this matters → Proposed approach → Acceptance → Context. Cite
file:line and SPEC § rather than paraphrasing. Don't invent new section headings
— downstream tooling and other agents key off these.

## Forbidden modifications

Do NOT modify the following files without explicit owner approval. They are
pinned by SPEC §23:

- `.github/workflows/ci.yml`
- `deno.jsonc`
- `.github/pull_request_template.md`

If a task genuinely requires a change to one of these, stop and request
approval; do not bundle it silently into another change.

## No "checks blocked by network" excuses

Run the checks. `deno task ci` does not need network access for the offline test
suite. If a check truly cannot run, say so explicitly with reproducible failure
logs — do not skip checks and claim they were blocked.

## Single-file ownership for parallel work

When multiple agents are dispatched in parallel, each agent owns the file paths
listed in its task brief. Never modify another task's files. If your task
requires a change to a file owned by another task, stop and surface the conflict
to the orchestrator.

## Slack-render escaping

All user-supplied text MUST pass through `escapeSlackText` AND
`neutraliseBackticks` before being rendered into any Slack message, modal, or
thread reply (per SPEC §14.3 and §17.1). This includes titles, descriptions,
outcome reasons, and any free-form input surfaced back to users.

## Vote-resolution invariants

- Use **integer arithmetic only** for pass/fail determination (yes counts,
  effective quorum, threshold comparisons).
- Floating-point arithmetic is acceptable for **display percentages only**.
- Abstentions never count for or against a decision.

## Datastore-write-before-message-post ordering

Per SPEC §8.4: never post a Slack message before the supporting datastore rows
are persisted. The required order is:

1. Persist `decisions` / `voters` / `votes` rows.
2. Post (or update) the Slack message.
3. On message-post failure, rollback the datastore rows.

This applies to decision creation, vote recording, finalisation, cancel, and
delete flows.

## Forbidden legacy artefacts

Do not re-introduce names from the v1 codebase:

- `vote_button_trigger`
- `record_vote_function`
- `send_reminders_function`
- The `{{decision_id}}` placeholder in any code, template, or block payload.

## Secrets / environment

- No `Deno.env.get` in production code paths. Configuration that varies per
  workspace lives in datastores or manifest config.
- No secrets committed to the repo.
