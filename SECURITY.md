# Security

ConsensusBot is designed to hold **zero secrets**. This document describes that
posture, the OAuth scopes the app requests and why, and how to disclose a
vulnerability.

## Zero-secret design

- Authentication is performed entirely via Slack-managed OAuth. The app does not
  store API tokens of its own.
- The app does not call any external services. `outgoingDomains` in
  `manifest.ts` is the empty list `[]`, so the Slack-managed runtime will refuse
  outbound HTTP to anywhere except the Slack API itself.
- There is no `.env`, no secret manager integration, and no credential injection
  at deploy time. `slack env list` returns nothing the app depends on.
- There are no API keys, webhook secrets, or signing secrets to rotate. The
  attack surface is limited to the Slack workspace itself plus Slack's own
  managed infrastructure.

## State storage

State lives in **Slack-managed Datastores** (DynamoDB-backed) on Slack's Run on
Slack Infrastructure (ROSI) platform. Reads and writes go through Slack's
managed SDK; the app never sees the underlying credentials. Datastores are
**eventually consistent** for queries, which the app handles explicitly (see
SPEC §16).

The four datastores — `decisions`, `votes`, `voters`, `vote_history` — are keyed
by an opaque server-generated UUID and a Slack user ID. They contain no PII
beyond the Slack user IDs of voters and the user-supplied proposal text, both of
which are also visible in the Slack channel itself.

## Bot scopes

The Slack app manifest requests **13 bot scopes**, each with a specific runtime
purpose. The full list, lifted verbatim from `manifest.ts` / SPEC §4:

| Scope               | Why                                                     |
| ------------------- | ------------------------------------------------------- |
| `commands`          | `/consensus` slash command.                             |
| `chat:write`        | Post and update voting messages.                        |
| `chat:write.public` | Post in channels the bot isn't a member of.             |
| `datastore:read`    | Query datastores.                                       |
| `datastore:write`   | Put / delete datastore items.                           |
| `pins:read`         | Probe `pins.list` before unpinning.                     |
| `pins:write`        | Pin / unpin decision messages.                          |
| `team:read`         | Resolve workspace timezone for deadline interpretation. |
| `users:read`        | Resolve names and bot / deactivated flags.              |
| `usergroups:read`   | List / expand user groups in the voter picker.          |
| `channels:read`     | Resolve channel members (public channels).              |
| `groups:read`       | Resolve channel members (private channels).             |
| `im:write`          | DM voters with reminders.                               |

### New scopes vs the previous (Bolt-era) version

Three scopes were added during the v2.0 rebuild. Each has a concrete operational
rationale:

- **`pins:read`** — the cancel and delete handlers now probe `pins.list` before
  calling `pins.remove`. Calling `pins.remove` on an unpinned message returns a
  benign error that pollutes the structured log; `pins:read` lets the handler
  skip the call entirely when the message isn't pinned.
- **`team:read`** — deadline resolution interprets the picked `YYYY-MM-DD` as
  end-of-day in the workspace's IANA timezone (e.g. `Europe/London`), not
  midnight UTC. Looking up the workspace `tz` requires `team:read`.
- **`chat:write.public`** — lets users run `/consensus` in any channel without
  first inviting the bot. This is the same UX as `/poll`-style Slack apps.

The previously requested scopes are unchanged in semantics. No scopes were
removed.

## Secrets to rotate

None. There is no static credential associated with the app outside of the
Slack-managed OAuth grant, which is rotated by Slack and revoked by uninstalling
the app from the workspace (`slack delete`).

## Reporting a vulnerability

Report security issues via the project's GitHub Issues tracker. Mark the issue
title with `[security]`. If the issue should not be public, contact the
repository owner directly via their GitHub profile rather than opening a public
issue.

There is no public bug-bounty programme.
