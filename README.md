# ConsensusBot

ConsensusBot is a Slack-native application that turns a proposal into a
structured, time-boxed, audited team vote. A user runs `/consensus` in any
channel; a modal collects a proposal, voter list, success criterion, and
deadline; the app posts an interactive voting message with Yes / No / Abstain
buttons, records each vote in Slack Datastores, sends weekday DM reminders to
voters who haven't voted, and on finalisation writes a formatted Architecture
Decision Record (ADR) into the message thread for a human to copy into their
wiki.

The entire system runs on **Run on Slack Infrastructure (ROSI)** — Slack's
managed Deno runtime — with no external services and no secrets to rotate. State
lives in Slack-managed Datastores (DynamoDB-backed).

## Vote-resolution semantics

ConsensusBot follows Robert's Rules of Order: **abstentions are excluded from
both the numerator and the denominator** of every pass calculation. An abstain
is _not_ a "no" — it removes the voter from the decisive tally entirely. This
matches Robert's Rules / ISO Directives / UK Companies Act baseline.

Three success criteria are supported, each with a default quorum that scales
with the required-voters count `R`:

| Criterion         | Default quorum | Pass condition                                                |
| ----------------- | -------------- | ------------------------------------------------------------- |
| `simple_majority` | `ceil(R / 2)`  | `votes_cast ≥ quorum AND yes*2 > yes+no AND (yes+no) ≥ 1`     |
| `super_majority`  | `ceil(R*2/3)`  | `votes_cast ≥ quorum AND yes*3 ≥ (yes+no)*2 AND (yes+no) ≥ 1` |
| `unanimous`       | `R`            | `votes_cast ≥ quorum AND no == 0 AND yes ≥ 1`                 |

Where `votes_cast` is `yes + no + abstain` (used for quorum) and the "decisive"
tally is `yes + no` (used for the pass ratio). All comparisons are integer
arithmetic to avoid floating-point edge cases.

A handful of consequences worth calling out:

- 1 yes out of 10 voters does **not** pass `simple_majority` — the quorum gate
  blocks it.
- Abstentions never block `unanimous`; only a `no` does.
- Ties under `simple_majority` are reported as `tied`, a flavour of `rejected`.
- The final outcome is shown on the message with the legend ✅ yes / ❌ no / ⚪
  abstain.

## Quick start (development)

```bash
slack login                 # browser-based OAuth
slack create                # in repo root; pick workspace
slack run                   # socket-mode dev loop with hot reload
slack deploy                # deploy to Slack ROSI
./scripts/deploy.sh         # register the schedule trigger with a fresh start_time
```

See **[DEVELOPMENT.md](DEVELOPMENT.md)** for the full local workflow, test
matrix, and pre-commit setup, and **[DEPLOYMENT.md](DEPLOYMENT.md)** for the
end-to-end deploy procedure.

## Documentation

- **[docs/REDEVELOPMENT_SPECIFICATION.md](docs/REDEVELOPMENT_SPECIFICATION.md)**
  — authoritative source of truth for all behaviour. If the code and the SPEC
  disagree, the SPEC wins until the SPEC is amended.
- **[docs/REDEVELOPMENT_BUILD_PLAN.md](docs/REDEVELOPMENT_BUILD_PLAN.md)** —
  authoritative source of truth for execution: waves, tasks, ownership, and
  acceptance gates.
- **[AGENTS.md](AGENTS.md)** — contributor workflow.
- **[SECURITY.md](SECURITY.md)** — zero-secret design, scope rationale, and
  disclosure path.

## Requirements

- Slack workspace on the **Pro plan or higher** (Datastores require a paid
  plan).
- Deno ≥ 1.37 and the [Slack CLI](https://api.slack.com/automation/cli) for
  local development.

## License

See the repository's `LICENSE` file.
