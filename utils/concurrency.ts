// ConsensusBot v2.0 — Concurrency helpers (re-read-and-bail, claim token).
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16.3 (`finalized_at` token)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16.4 (re-read-and-bail)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-107
//
// Slack Datastores are eventually consistent and expose no conditional puts
// or transactions. These helpers provide best-effort idempotency:
//
//   - `reReadAndCheck` re-fetches a row by id and asserts a caller-supplied
//     predicate before any status-changing put. The cancel handler (§10) and
//     finalisation (§13) use this to detect that the decision has moved on
//     under them.
//
//   - `claimFinalisation` is the single writer of `decisions.finalized_at`.
//     It re-reads the decision row and refuses to overwrite an existing
//     token. There is no native CAS in ROSI, so under heavy contention two
//     simultaneous claims could both observe a nil token and both write —
//     the SPEC §16.3 acknowledges this and rates the residual risk as
//     "vanishingly rare".

import type { SlackClient } from "../types/slack_types.ts";
import type { DecisionRecord } from "../types/decision_types.ts";

/**
 * Outcome of a re-read-and-check call.
 *
 * The narrow `reason` union lets call-sites discriminate between "the row
 * has been deleted" (`not_found`), "the row is in an unexpected state"
 * (`predicate_failed`), and "the get itself failed" (`api_error`). The SPEC
 * §16.4 example uses a wider `reason: string`; we keep the narrower union
 * here because every call-site cares which case it is.
 */
export type ReReadResult<T> =
  | { ok: true; item: T }
  | { ok: false; reason: "not_found" | "predicate_failed" | "api_error" };

/**
 * §16.4 — Re-read a datastore row by primary key and assert a predicate.
 *
 * Returns `{ ok: true, item }` only when the row exists, the get succeeded,
 * and the predicate accepts it. The four failure modes are distinguished:
 *
 *   - `api_error`         — `apps.datastore.get` returned `ok: false`.
 *   - `not_found`         — get succeeded but the row is absent.
 *   - `predicate_failed`  — row exists, but the caller's invariant doesn't.
 *
 * Call-sites compose this immediately before any status-changing put to
 * implement best-effort CAS ("re-read-and-bail"); see §10 (cancel) and §13
 * (finalisation).
 */
export async function reReadAndCheck<T>(
  client: SlackClient,
  datastore: string,
  id: string,
  expect: (item: T) => boolean,
): Promise<ReReadResult<T>> {
  const got = await client.apps.datastore.get<T>({ datastore, id });
  if (!got.ok) {
    return { ok: false, reason: "api_error" };
  }
  if (!got.item) {
    return { ok: false, reason: "not_found" };
  }
  const item = got.item;
  if (!expect(item)) {
    return { ok: false, reason: "predicate_failed" };
  }
  return { ok: true, item };
}

/**
 * §16.3 — Best-effort claim of finalisation rights via the `finalized_at`
 * idempotency token.
 *
 * Re-reads the decision row by id. If `finalized_at` is already a non-empty
 * string, a peer has claimed finalisation; returns `false` and the caller
 * MUST skip the ADR post. Otherwise writes the same row back with
 * `finalized_at = updated_at = now()` and returns `true`.
 *
 * Failure semantics:
 *   - get returns `ok: false`           → `false` (treat as "already claimed").
 *   - get returns no item (deleted)     → `false`.
 *   - put returns `ok: false`           → `false`.
 *   - put throws                        → `false`.
 *
 * NOTE: there is no native CAS in ROSI. Under simultaneous contention two
 * callers may both observe a nil `finalized_at` and both write theirs —
 * §16.3 documents this and notes the §13 step-9 re-read is the second line
 * of defence (it picks the strictly-earlier `finalized_at` and the loser
 * skips the ADR). This helper is therefore "best-effort" at the spec level.
 */
export async function claimFinalisation(
  client: SlackClient,
  decision: DecisionRecord,
): Promise<boolean> {
  let got;
  try {
    got = await client.apps.datastore.get<DecisionRecord>({
      datastore: "decisions",
      id: decision.id,
    });
  } catch {
    return false;
  }

  if (!got.ok || !got.item) {
    return false;
  }

  const current = got.item;
  if (
    typeof current.finalized_at === "string" && current.finalized_at.length > 0
  ) {
    // Someone else already claimed.
    return false;
  }

  const now = new Date().toISOString();
  const claimed: DecisionRecord = {
    ...current,
    finalized_at: now,
    updated_at: now,
  };

  let put;
  try {
    put = await client.apps.datastore.put<DecisionRecord>({
      datastore: "decisions",
      item: claimed,
    });
  } catch {
    return false;
  }

  if (!put.ok) {
    return false;
  }
  return true;
}
