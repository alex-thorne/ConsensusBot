# Slack-native architecture re-evaluation

This document records the rationale for migrating ConsensusBot from an
Azure-hosted Bolt-framework deployment to a Slack-native ROSI (Run on Slack
Infrastructure) Deno application. It is historical and is referenced from
[`REDEVELOPMENT_SPECIFICATION.md`](./REDEVELOPMENT_SPECIFICATION.md) §1 and §17.

## 1. Context

ConsensusBot started life as a Slack [Bolt-framework][bolt] (Node.js) app
deployed on Microsoft Azure: App Service for compute (with Functions for
scheduled reminders), a separate hosted database (Table Storage / Cosmos) for
vote state, and Azure Key Vault holding the signing secret, bot OAuth token, and
database connection strings. GitHub Actions ran lint and tests, with a manual
deploy step pushing the bundle to Azure.

The architecture worked, but came with a recurring tax: infra to patch, secrets
to rotate, dashboards to keep alive, and a small monthly bill for a tool that is
busy only a few times a day. The original ADR for this design is preserved at
[`adr/0001-use-slack-bolt-framework.md`](./adr/0001-use-slack-bolt-framework.md).

## 2. Drivers for re-evaluation

- **Cost.** Azure was a recurring monthly cost; ROSI is included with the
  workspace's existing Slack tier (Pro+ is required only because Datastores are
  a paid-plan feature — the compute itself is free).
- **Operational burden.** Secrets rotation, framework patching, runtime
  upgrades, and a separate monitoring stack were all on the maintainer. ROSI
  replaces these with Slack-managed runtime, logs, and OAuth.
- **Auth.** OAuth tokens previously lived in Key Vault and had to be rotated on
  scope changes. ROSI handles token issuance and per-invocation scoping
  implicitly; the app never sees a long-lived bot token.
- **Compliance and data residency.** Vote state used to live in an external
  database the workspace owner had to reason about separately. With Datastores,
  state lives inside the Slack workspace itself.

## 3. What ROSI buys us

- **Zero secrets.** Runtime and storage authenticate via Slack-managed
  mechanisms; `slack env list` is empty for any user-managed token.
- **Datastores.** A DynamoDB-backed key-value store sufficient for the two
  tables (`decisions`, `vote_history`). Reads are eventually consistent; the
  spec's §16 patterns (write-then-merge, `finalized_at` token) are written
  specifically to deal with this.
- **Scheduled triggers.** Slack-native cron replaces the Azure Function timer
  for daily reminders.
- **In-process block-action handlers.** Button clicks land directly in a
  function invocation; no separate Events API → queue → handler pipeline.
- **Structured-log streaming.** `slack activity` streams logs without a separate
  APM product.

## 4. Trade-offs and open issues

- **Eventual consistency on Datastore queries.** The just-written row is not
  guaranteed to appear in a subsequent query. Mitigated by the §16 patterns:
  every finalisation read merges the just-written vote into the query result.
- **No CAS / transactions.** Datastore does not expose conditional writes; the
  best-effort fence is the `finalized_at` token (§16.3).
- **No automated CI deploy.** A credential-free CI deploy would require
  re-introducing a Slack CLI auth token in CI, defeating the zero-secrets
  posture. Deploys are manual (`slack deploy`).
- **ADRs as markdown only.** The bot emits ADRs as a formatted markdown block
  in-thread; it does not push them to Confluence, a Git wiki, or a docs
  repository — that would require an outbound API token.
- **Plan-tier requirement.** Datastores require Slack Pro or higher.

## 5. What was not migrated

- **Legacy Azure-era Bolt code.** Archived (not deleted from history).
- **Original ADR.**
  [`adr/0001-use-slack-bolt-framework.md`](./adr/0001-use-slack-bolt-framework.md)
  is preserved as a historical record.
- **Azure deployment scripts and pipeline definitions.** Not carried forward;
  the new deploy story is `slack deploy`.

## 6. Forward-looking notes

The v1 spec deliberately defers several items (see SPEC §22): retry and backoff
on Slack API failure, multi-channel decisions, automated ADR archive, and
bank-holiday-aware business-day arithmetic. None of these are blockers for the
ROSI migration; they are tracked as future iterations and are explicitly out of
scope for the v2.0 redevelopment.

If, at some future point, ROSI gains conditional Datastore writes or a
credential-free CI integration, the §16 mitigations and the manual-deploy
constraint above can be revisited.

[bolt]: https://slack.dev/bolt-js/
