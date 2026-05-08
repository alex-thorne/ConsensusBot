# Deployment

This document describes the end-to-end deploy procedure for ConsensusBot. For
local development see **[DEVELOPMENT.md](DEVELOPMENT.md)**.

The authoritative reference is
**[docs/REDEVELOPMENT_SPECIFICATION.md §24](docs/REDEVELOPMENT_SPECIFICATION.md)**.
This document is a contributor-facing summary; if it disagrees with the SPEC,
the SPEC wins.

## Prerequisites

- Slack CLI (`slack`) installed and authenticated against the target workspace.
- A Slack workspace on the **Pro plan or higher** (Datastores are gated by plan
  tier).
- Repository checked out at the commit you intend to deploy.

## First-time deploy

```bash
slack login                                                       # OAuth in browser
slack create                                                      # in repo root; pick workspace
slack deploy                                                      # builds + deploys to Slack ROSI
slack triggers create --trigger-def triggers/consensus_command.ts # /consensus shortcut
./scripts/deploy.sh                                               # creates the schedule trigger
slack triggers list                                               # verify both exist
```

After `slack triggers list` you should see two triggers:

1. The `/consensus` shortcut (created by the explicit `slack triggers create`
   call).
2. The Mon–Fri 09:00 UTC schedule trigger that runs the
   `process_active_decisions` workflow (created by `./scripts/deploy.sh`).

### Why `./scripts/deploy.sh` is required

Slack rejects scheduled triggers whose `start_time` is in the past with
`invalid_start_before_now`. The static date in
`triggers/process_active_decisions_schedule.ts` will drift past "today" the
moment any time has elapsed since the file was written. `scripts/deploy.sh`
sidesteps this by emitting a temporary trigger definition with a freshly
computed start time (the next weekday at 09:00 UTC) and feeding that to
`slack triggers create`. Always use the script — never call
`slack triggers create --trigger-def triggers/process_active_decisions_schedule.ts`
directly.

The schedule fires Mon–Fri at 09:00 UTC, deliberately landing before UK working
hours (10:00 BST / 09:00 GMT). On each tick the workflow auto-finalises any
past-deadline `active` decisions and DMs reminders to voters on still-active
decisions.

## Ongoing development cycle

| Command                 | Purpose                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `slack run`             | Socket-mode dev loop with hot reload — for development, not for prod. |
| `slack activity --tail` | Live structured-log stream from the deployed app.                     |
| `slack deploy`          | Push code updates to the existing app.                                |
| `slack delete`          | **Irreversible** — tears down the app AND deletes all Datastore data. |

Code changes do **not** require re-running the trigger commands. Trigger
definitions only need to be re-created if `triggers/consensus_command.ts`
changes its shape, or if the schedule needs to be reset (in which case run
`./scripts/deploy.sh` again).

## Production isolation

There is no "environments" concept in Slack ROSI — each deploy targets one
workspace. To run a production instance separately from your dev workspace,
re-run the first-time-deploy steps against a different workspace:

```bash
slack create        # in a clean shell; pick the production workspace
slack deploy
slack triggers create --trigger-def triggers/consensus_command.ts
./scripts/deploy.sh
```

The Slack CLI keeps per-workspace context in `.slack/`; switching between dev
and prod is a matter of switching workspaces with `slack workspace ...` or
running deploys from clean repo clones.

## CI / automation

There is **no automated CI deploy**. The `.github/workflows/ci.yml` workflow
gates code quality only — `fmt:check`, `lint`, `check`, and `test`. Production
deploys are deliberately manual; a human runs `slack deploy` against the
production workspace after CI is green and the PR is merged.

## Tearing down

```bash
slack delete
```

This is irreversible. It removes the app from the workspace **and deletes all
Datastore data** (decisions, votes, voters, vote history). Re-deploying
afterwards starts from an empty state.
