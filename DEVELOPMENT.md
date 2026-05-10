# Development

This document describes the local development workflow for ConsensusBot. For the
deploy procedure see **[DEPLOYMENT.md](DEPLOYMENT.md)**; for the contributor
workflow see **[AGENTS.md](AGENTS.md)**.

## Prerequisites

- Deno ≥ 1.37 (`deno --version`).
- Slack CLI (`slack`) — install per <https://api.slack.com/automation/cli>.
- A Slack workspace on the **Pro plan or higher** — Slack Datastores require a
  paid plan, so a Free workspace will fail to deploy.

## First-time setup

```bash
git clone <this-repo>
cd ConsensusBot
git config core.hooksPath .githooks      # enable the auto-fmt pre-commit hook
slack login                              # OAuth your Slack workspace
slack create                             # link the repo to a workspace
```

The pre-commit hook is defined in `.githooks/pre-commit`. It runs `deno fmt`,
fails the commit if formatting changed any tracked file (so the change can be
re-staged), then runs `deno task lint` and `deno task check`. Tests are
intentionally omitted from the hook to keep commits fast — CI catches
regressions.

## The dev loop

```bash
slack run                                # socket-mode dev loop with hot reload
```

`slack run` connects to your dev workspace over Socket Mode, watches the source
tree, and re-deploys on save. `/consensus` in the workspace will hit your local
code.

In a second terminal you can stream logs:

```bash
slack activity --tail                    # live structured-log stream
```

## Deno tasks

The canonical task list (defined in `deno.jsonc`) is:

| Task        | Command                                                                      | When to run                       |
| ----------- | ---------------------------------------------------------------------------- | --------------------------------- |
| `fmt`       | `deno fmt`                                                                   | Before every commit (auto-fixed). |
| `fmt:check` | `deno fmt --check`                                                           | CI gate; verify no drift.         |
| `lint`      | `deno lint`                                                                  | Before every commit.              |
| `check`     | `deno check manifest.ts`                                                     | Before every commit.              |
| `test`      | `deno test --allow-all tests/`                                               | Before opening a PR.              |
| `ci`        | `deno task fmt:check && deno task lint && deno task check && deno task test` | Before opening a PR.              |

Run `deno task ci` from a clean tree before pushing — the GitHub Actions
workflow runs the same commands and will fail otherwise.

Manifest schema guard: `deno task test` includes
`tests/manifest_open_form_validation_test.ts`, which fails if an OpenForm string
field uses unsupported properties such as `max_length` or `min_length`.

## Project structure

The full layout is documented in
**[docs/REDEVELOPMENT_SPECIFICATION.md §3](docs/REDEVELOPMENT_SPECIFICATION.md)**.
The high-level shape:

- `manifest.ts` — Slack app manifest (workflows, datastores, scopes).
- `datastores/` — four Datastore declarations (`decisions`, `votes`, `voters`,
  `vote_history`).
- `functions/` — Slack functions (`create_decision`,
  `process_active_decisions`).
- `workflows/` — workflow definitions wired into the manifest.
- `triggers/` — the `/consensus` shortcut and the weekday 09:00 UTC schedule.
- `utils/` — pure helpers (`decision_logic`, `date_utils`, `escape_slack`,
  `concurrency`, `adr_generator`, `slack_parse`, `log`).
- `tests/` — unit tests in the root and integration tests under
  `tests/integration/`.
- `scripts/deploy.sh` — registers the schedule trigger with a freshly computed
  `start_time` (Slack rejects past start times).

## Testing

```bash
deno task test
```

Tests live under `tests/`. Unit tests sit at the root of `tests/`; the
integration tests under `tests/integration/` exercise multi-module flows against
the in-process mock client in `tests/mocks/slack_client.ts`. Both suites run as
a single `deno test` invocation; `--allow-all` is required because the SDK
probes for environment variables at import time (none of which the app actually
depends on — see `SECURITY.md`).

## Datastore caveat

Datastores are a **Slack Pro+ feature**. Attempting `slack deploy` against a
Free workspace will fail with a plan-tier error. Use a Pro dev workspace or ask
your admin to upgrade the workspace before continuing.

## Troubleshooting

- **`invalid_start_before_now` from `slack triggers create`.** The static date
  in `triggers/process_active_decisions_schedule.ts` has drifted past today. Run
  `./scripts/deploy.sh` instead — it computes a fresh future `start_time`.
- **Hot reload not picking up changes.** Check that `slack run` is still
  attached; restart if the socket dropped.
- **`deno fmt` keeps modifying files in CI.** Run `deno task fmt` locally,
  re-stage, and commit. The pre-commit hook would have caught this — make sure
  `git config core.hooksPath .githooks` was run.

## Where to go next

- Read
  **[docs/REDEVELOPMENT_SPECIFICATION.md](docs/REDEVELOPMENT_SPECIFICATION.md)**
  for the full behavioural contract.
- Read **[AGENTS.md](AGENTS.md)** for the PR workflow and the
  single-file-ownership rule used during the rebuild.
