// ConsensusBot v2.0 — Integration tests for deadline finalisation.
//
// SPEC sources of truth (read these BEFORE editing this file):
//   - docs/REDEVELOPMENT_SPECIFICATION.md §9 step 5  (vote-after-deadline gate)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §13        (`finalizeDecision`)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16.3      (`finalized_at` token)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §18.1      (Phase A)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.2      (this file)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md     T-508
//
// Acceptance:
//   deno test --allow-all tests/integration/deadline_finalisation_test.ts
//
// ---------------------------------------------------------------------------
// Test approach
// ---------------------------------------------------------------------------
//
// We drive the production finaliser (`finalizeDecision` exported from
// `functions/create_decision.ts`) directly against a `MockSlackClient`. The
// SDK's `SlackFunction(...)` wrapper replaces `ctx.client` via `enrichContext`
// at runtime, so calling the wrapped default export (`processActiveDecisions`,
// `createDecision.blockActions`) does NOT route through the mock — confirmed
// by probes during T-508 development. To preserve behavioural fidelity we:
//
//   - Replicate Phase A's outer loop (§18.1) in `runPhaseA`: query active
//     decisions, drop already-finalised rows, filter past-deadline rows, fetch
//     their votes, and invoke the production `finalizeDecision`.
//   - Replicate the vote handler's first five steps (§9 steps 1-5) in
//     `runVoteClickAfterDeadline`: load decision, status guard, eligibility
//     guard, isDeadlinePassed gate (post ephemeral, call `finalizeDecision`
//     with empty `mergedVotes`, return). The post-gate branch (steps 6-11) is
//     NEVER taken in this test file because every scenario sets a past
//     deadline.
//
// The pieces under test are therefore:
//   - the production `finalizeDecision` (idempotency token, ADR posting,
//     outcome computation),
//   - the §18.1 Phase A semantics (status filter, finalized_at filter,
//     past-deadline filter, per-row try/catch),
//   - the §9 step 5 vote-after-deadline gate (no `votes` write, no
//     `vote_history` write, ephemeral, finalisation triggered).

import { assert, assertEquals } from "@std/assert";

import { finalizeDecision } from "../../functions/create_decision.ts";
import { MockSlackClient } from "../mocks/slack_client.ts";
import type {
  DecisionRecord,
  VoteRecord,
  VoterRecord,
} from "../../types/decision_types.ts";
import type {
  ChatPostEphemeralArgs,
  ChatPostMessageArgs,
  DatastorePutArgs,
  SlackClient,
} from "../../types/slack_types.ts";
import {
  formatDeadlineHuman,
  isDeadlinePassed,
} from "../../utils/date_utils.ts";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/**
 * Build a decision past its deadline by a wide margin (1 day) so the
 * `isDeadlinePassed` check is unambiguous regardless of test runtime.
 */
function makePastDeadlineDecision(
  overrides: Partial<DecisionRecord>,
): DecisionRecord {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return {
    id: "11111111-2222-3333-4444-555555555555",
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "simple_majority",
    quorum: 1,
    required_voters_count: 1,
    deadline: "2026-05-08",
    deadline_resolved: past,
    deadline_tz: "Europe/London",
    channel_id: "C0123456789",
    creator_id: "U_ALICE",
    message_ts: "1715170800.000100",
    status: "active",
    finalized_at: "",
    created_at: "2026-05-01T09:00:00.000Z",
    updated_at: "2026-05-01T09:00:00.000Z",
    ...overrides,
  };
}

function makeVoter(decisionId: string, userId: string): VoterRecord {
  return {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    is_active: true,
    created_at: "2026-05-01T09:00:00.000Z",
  };
}

function makeVote(
  decisionId: string,
  userId: string,
  vote: VoteRecord["vote_type"],
): VoteRecord {
  return {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    vote_type: vote,
    voted_at: "2026-05-08T10:00:00.000Z",
  };
}

/**
 * Seed a row into the mock's in-memory datastore. The mock keys all rows by
 * their `id` field (Slack datastore primary-key convention).
 */
function seedRow(
  mock: MockSlackClient,
  datastore: string,
  row: { id: string } & Record<string, unknown>,
): void {
  mock.setDatastoreItem(datastore, row);
}

// ---------------------------------------------------------------------------
// Production-equivalent drivers
// ---------------------------------------------------------------------------

/**
 * Replicate §18.1 Phase A end-to-end against a `SlackClient`.
 *
 *   1. Query every `decisions` row.
 *   2. Skip rows whose `status !== "active"`.
 *   3. Skip rows whose `finalized_at` is set (a vote handler beat us).
 *   4. Skip rows whose deadline has not yet passed.
 *   5. For each survivor: query its `votes` rows and call the production
 *      `finalizeDecision` (the same function `process_active_decisions.ts`
 *      invokes from its inner Phase A loop).
 *
 * Returns `decisionsFinalised` exactly as the production wrapper does (§18.5).
 */
async function runPhaseA(client: SlackClient): Promise<number> {
  let decisionsFinalised = 0;

  const decisionsRes = await client.apps.datastore.query<DecisionRecord>({
    datastore: "decisions",
  });
  if (!decisionsRes.ok) return 0;

  for (const decision of decisionsRes.items) {
    if (decision.status !== "active") continue;
    if (
      typeof decision.finalized_at === "string" &&
      decision.finalized_at.length > 0
    ) {
      continue;
    }
    if (!isDeadlinePassed(decision)) continue;

    const votesRes = await client.apps.datastore.query<VoteRecord>({
      datastore: "votes",
      expression: "#decision_id = :decision_id",
      expression_attributes: { "#decision_id": "decision_id" },
      expression_values: { ":decision_id": decision.id },
    });
    const votes: VoteRecord[] = votesRes.ok
      ? votesRes.items.filter((v) => v.decision_id === decision.id)
      : [];

    await finalizeDecision(client, decision, votes);
    decisionsFinalised += 1;
  }

  return decisionsFinalised;
}

/**
 * Replicate §9 steps 1-5 of the vote handler — the slice we need for the
 * past-deadline branch. Steps 6-11 (vote write, history append, message
 * update, finalise gate) are deliberately omitted: they are unreachable when
 * step 5 fires, and reproducing them would be redundant with
 * `tests/integration/vote_handler_test.ts` (T-502).
 *
 * The function returns no value; assertions inspect `mock.calls` directly.
 */
async function runVoteClickAfterDeadline(
  client: SlackClient,
  decisionId: string,
  userId: string,
  channelId: string,
): Promise<void> {
  // Step 2 — load decision.
  const got = await client.apps.datastore.get<DecisionRecord>({
    datastore: "decisions",
    id: decisionId,
  });
  if (!got.ok || !got.item) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "Decision not found.",
    });
    return;
  }
  const decision = got.item;

  // Step 3 — status guard.
  if (decision.status !== "active") {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `This decision is no longer active (${decision.status}).`,
    });
    return;
  }

  // Step 4 — eligibility guard.
  const voterGet = await client.apps.datastore.get<VoterRecord>({
    datastore: "voters",
    id: `${decisionId}_${userId}`,
  });
  if (!voterGet.ok || !voterGet.item || voterGet.item.is_active === false) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "You are not listed as an eligible voter for this decision.",
    });
    return;
  }

  // Step 5 — past-deadline gate. SPEC §9 step 5 verbatim:
  //   "post ephemeral `\"⏰ Voting closed at ${deadlineDisplay}. Finalising
  //   now.\"`, then proceed directly to `checkIfShouldFinalize` (§12) without
  //   recording the vote." In the production handler this calls
  //   `finalizeDecision(client, decision, [])` (no merged votes).
  if (isDeadlinePassed(decision)) {
    const deadlineDisplay = formatDeadlineHuman(
      decision.deadline_resolved,
      decision.deadline_tz,
    );
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `⏰ Voting closed at ${deadlineDisplay}. Finalising now.`,
    });
    await finalizeDecision(client, decision, []);
    return;
  }

  // Steps 6-11 are unreachable in the past-deadline integration suite. The
  // vote handler integration test (T-502) covers them.
  throw new Error(
    "deadline_finalisation_test invariant: deadline must be in the past",
  );
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Filter datastore-put calls by `datastore` name. Returns the typed args
 * payloads in invocation order.
 */
function datastorePutCalls(
  mock: MockSlackClient,
  datastore: string,
): DatastorePutArgs<Record<string, unknown>>[] {
  const out: DatastorePutArgs<Record<string, unknown>>[] = [];
  for (const c of mock.getCallsFor("apps.datastore.put")) {
    const args = c.args as DatastorePutArgs<Record<string, unknown>>;
    if (args.datastore === datastore) out.push(args);
  }
  return out;
}

/**
 * Filter chat.postMessage calls to those with a non-empty `thread_ts`. These
 * are the ADR posts (§13 step 10) — the cosmetic in-channel update goes
 * through `chat.update`, not `chat.postMessage`.
 */
function adrPostMessageCalls(
  mock: MockSlackClient,
): ChatPostMessageArgs[] {
  const out: ChatPostMessageArgs[] = [];
  for (const c of mock.getCallsFor("chat.postMessage")) {
    const args = c.args as ChatPostMessageArgs;
    if (typeof args.thread_ts === "string" && args.thread_ts.length > 0) {
      out.push(args);
    }
  }
  return out;
}

/**
 * Filter ephemeral calls by literal-prefix match. `text` is the human-facing
 * fallback — SPEC §9 step 5 pins the exact wording.
 */
function ephemeralCallsStartingWith(
  mock: MockSlackClient,
  prefix: string,
): ChatPostEphemeralArgs[] {
  const out: ChatPostEphemeralArgs[] = [];
  for (const c of mock.getCallsFor("chat.postEphemeral")) {
    const args = c.args as ChatPostEphemeralArgs;
    if (typeof args.text === "string" && args.text.startsWith(prefix)) {
      out.push(args);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Test 1 — Phase A finalises a past-deadline `active` decision (§18.1)
// ---------------------------------------------------------------------------
//
// Pre-seed an `active` decision with `deadline_resolved` 24h in the past and
// two voters [U1, U2] who both voted yes. The §18.1 sweep finalises it via
// `finalizeDecision`. Assert: `status: "approved"`, `finalized_at` non-empty,
// `outcome_reason` non-empty, ADR posted to the thread,
// `decisions_finalised >= 1`.

Deno.test(
  "deadline_finalisation — Phase A finalises past-deadline active decision (2 yes / 0 no, R=2 → approved)",
  async () => {
    const mock = new MockSlackClient();
    const decisionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    const decision = makePastDeadlineDecision({
      id: decisionId,
      quorum: 1, // ceil(2/2) = 1
      required_voters_count: 2,
      message_ts: "1715170800.000200",
    });
    seedRow(
      mock,
      "decisions",
      decision as unknown as
        & { id: string }
        & Record<string, unknown>,
    );
    seedRow(
      mock,
      "voters",
      makeVoter(decisionId, "U1") as unknown as
        & { id: string }
        & Record<string, unknown>,
    );
    seedRow(
      mock,
      "voters",
      makeVoter(decisionId, "U2") as unknown as
        & { id: string }
        & Record<string, unknown>,
    );
    seedRow(
      mock,
      "votes",
      makeVote(decisionId, "U1", "yes") as unknown as
        & { id: string }
        & Record<string, unknown>,
    );
    seedRow(
      mock,
      "votes",
      makeVote(decisionId, "U2", "yes") as unknown as
        & { id: string }
        & Record<string, unknown>,
    );

    // Drive Phase A.
    const decisionsFinalised = await runPhaseA(mock);

    // §18.5 — Phase A reports the count of finalised decisions.
    assert(
      decisionsFinalised >= 1,
      `decisions_finalised should be >= 1, got ${decisionsFinalised}`,
    );

    // §13 step 5 — the decisions row is updated with status, finalized_at,
    // outcome_reason. Read straight back via the mock's `get`.
    const reread = await mock.apps.datastore.get<DecisionRecord>({
      datastore: "decisions",
      id: decisionId,
    });
    assert(reread.ok && reread.item, "decision row missing after Phase A");
    const updated = reread.item;
    assertEquals(
      updated.status,
      "approved",
      "2 yes / 0 no with simple_majority and quorum=1 must approve",
    );
    assert(
      typeof updated.finalized_at === "string" &&
        updated.finalized_at.length > 0,
      "finalized_at must be set after finalisation",
    );
    assert(
      typeof updated.outcome_reason === "string" &&
        updated.outcome_reason.length > 0,
      "outcome_reason must be set after finalisation",
    );

    // §13 step 10 — exactly one ADR is posted to the original message thread.
    const adrPosts = adrPostMessageCalls(mock);
    assertEquals(
      adrPosts.length,
      1,
      `expected exactly 1 ADR post; got ${adrPosts.length}`,
    );
    assertEquals(adrPosts[0].thread_ts, decision.message_ts);
    assertEquals(adrPosts[0].channel, decision.channel_id);
  },
);

// ---------------------------------------------------------------------------
// Test 2 — Vote-after-deadline triggers finalisation, no votes/history written
// ---------------------------------------------------------------------------
//
// Pre-seed an `active` past-deadline decision with one voter U1 and zero
// votes. Drive a vote_yes click. The §9 step 5 gate fires — assert NO
// `apps.datastore.put({datastore:"votes"})` and NO
// `apps.datastore.put({datastore:"vote_history"})` calls. Assert the
// ⏰-prefixed ephemeral. Assert the decision row is finalised with
// `finalized_at` set; with R=1, quorum=1, 0 votes the SPEC §15.4 reason is
// "Quorum not met (0 of 1 required)" and the outcome is `rejected`.

Deno.test(
  "deadline_finalisation — vote click after deadline triggers finalisation, no votes/vote_history persisted",
  async () => {
    const mock = new MockSlackClient();
    const decisionId = "ffffffff-0000-1111-2222-333333333333";
    const channelId = "C_VOTE";

    const decision = makePastDeadlineDecision({
      id: decisionId,
      quorum: 1,
      required_voters_count: 1,
      channel_id: channelId,
      message_ts: "1715170800.000300",
    });
    seedRow(
      mock,
      "decisions",
      decision as unknown as
        & { id: string }
        & Record<string, unknown>,
    );
    seedRow(
      mock,
      "voters",
      makeVoter(decisionId, "U1") as unknown as
        & { id: string }
        & Record<string, unknown>,
    );

    // Drive the vote handler steps 1-5.
    await runVoteClickAfterDeadline(mock, decisionId, "U1", channelId);

    // §9 step 5 — the vote is NOT recorded.
    const votePuts = datastorePutCalls(mock, "votes");
    assertEquals(
      votePuts.length,
      0,
      "votes datastore must not be written when the click hits the post-deadline gate",
    );

    // §9 step 5 — vote_history is NOT appended either (the SPEC says the
    // click "serves only to trigger finalisation").
    const historyPuts = datastorePutCalls(mock, "vote_history");
    assertEquals(
      historyPuts.length,
      0,
      "vote_history datastore must not be appended on the post-deadline gate",
    );

    // §9 step 5 — exact ephemeral wording.
    const ephemerals = ephemeralCallsStartingWith(mock, "⏰ Voting closed at ");
    assertEquals(
      ephemerals.length,
      1,
      `expected exactly 1 \"⏰ Voting closed…\" ephemeral; got ${ephemerals.length}`,
    );
    assert(
      ephemerals[0].text?.endsWith(". Finalising now."),
      `ephemeral must end with \". Finalising now.\"; got ${
        ephemerals[0].text
      }`,
    );
    assertEquals(ephemerals[0].channel, channelId);
    assertEquals(ephemerals[0].user, "U1");

    // §13 — finalisation occurred. With 0 votes < quorum=1, simple_majority
    // returns `rejected` with the §15.4 reason "Quorum not met (0 of 1
    // required)" (literal pinned string).
    const reread = await mock.apps.datastore.get<DecisionRecord>({
      datastore: "decisions",
      id: decisionId,
    });
    assert(reread.ok && reread.item, "decision row should still exist");
    const updated = reread.item;
    assertEquals(updated.status, "rejected");
    assertEquals(updated.outcome_reason, "Quorum not met (0 of 1 required)");
    assert(
      typeof updated.finalized_at === "string" &&
        updated.finalized_at.length > 0,
      "finalized_at must be set after gate-triggered finalisation",
    );

    // Sanity: the ADR was posted to the thread.
    const adrPosts = adrPostMessageCalls(mock);
    assertEquals(adrPosts.length, 1);
    assertEquals(adrPosts[0].thread_ts, decision.message_ts);
  },
);

// ---------------------------------------------------------------------------
// Test 3 — Race: scheduled tick + vote click both hit a past-deadline row.
// ---------------------------------------------------------------------------
//
// SPEC §16.3 — `finalized_at` is the idempotency token. The vote click runs
// first (it sets `finalized_at` and posts an ADR). When Phase A runs second:
// either it skips the row in its own filter (status moved to "rejected"), or
// it calls `finalizeDecision`, whose §13 step 1 re-read sees `finalized_at`
// set and bails silently. Either way, exactly ONE ADR is posted.

Deno.test(
  "deadline_finalisation — race: vote click + Phase A produce exactly one ADR (finalized_at idempotency)",
  async () => {
    const mock = new MockSlackClient();
    const decisionId = "12345678-9abc-def0-1234-56789abcdef0";
    const channelId = "C_RACE";

    const decision = makePastDeadlineDecision({
      id: decisionId,
      quorum: 1,
      required_voters_count: 1,
      channel_id: channelId,
      message_ts: "1715170800.000400",
    });
    seedRow(
      mock,
      "decisions",
      decision as unknown as
        & { id: string }
        & Record<string, unknown>,
    );
    seedRow(
      mock,
      "voters",
      makeVoter(decisionId, "U1") as unknown as
        & { id: string }
        & Record<string, unknown>,
    );

    // 1. Vote click after deadline → finalisation via the gate.
    await runVoteClickAfterDeadline(mock, decisionId, "U1", channelId);

    // After the vote click, `finalized_at` MUST be set.
    const afterClickRes = await mock.apps.datastore.get<DecisionRecord>({
      datastore: "decisions",
      id: decisionId,
    });
    assert(afterClickRes.ok && afterClickRes.item);
    const afterClick = afterClickRes.item;
    assert(
      typeof afterClick.finalized_at === "string" &&
        afterClick.finalized_at.length > 0,
      "vote-click finaliser must set finalized_at before Phase A runs",
    );
    const firstFinalizedAt = afterClick.finalized_at;
    const adrPostsAfterClick = adrPostMessageCalls(mock).length;
    assertEquals(
      adrPostsAfterClick,
      1,
      `vote-click finaliser should post exactly 1 ADR; got ${adrPostsAfterClick}`,
    );

    // 2. Phase A runs second. The decision's status is no longer "active";
    //    the §18.1 filter drops it BEFORE invoking `finalizeDecision`. Even
    //    if it didn't, §13 step 1 re-reads and bails on `finalized_at` set.
    const phaseACount = await runPhaseA(mock);
    assertEquals(
      phaseACount,
      0,
      "Phase A must skip rows the vote-click already finalised",
    );

    // 3. Exactly ONE ADR across both runs.
    const allAdrPosts = adrPostMessageCalls(mock);
    assertEquals(
      allAdrPosts.length,
      1,
      `expected exactly 1 ADR across both runs; got ${allAdrPosts.length}`,
    );
    assertEquals(allAdrPosts[0].thread_ts, decision.message_ts);

    // The `finalized_at` token must be untouched by the second pass.
    const finalRes = await mock.apps.datastore.get<DecisionRecord>({
      datastore: "decisions",
      id: decisionId,
    });
    assert(finalRes.ok && finalRes.item);
    assertEquals(
      finalRes.item.finalized_at,
      firstFinalizedAt,
      "Phase A must not overwrite the vote-click's finalized_at",
    );
  },
);

// ---------------------------------------------------------------------------
// Test 4 — Decision finalised without any votes — quorum-not-met reason.
// ---------------------------------------------------------------------------
//
// SPEC §15.4 reason text is `"Quorum not met (${votes_cast} of ${quorum}
// required)"`. With R=5, quorum=3, no votes, all voters active, finalisation
// rejects the decision with `"Quorum not met (0 of 3 required)"`.

Deno.test(
  "deadline_finalisation — past-deadline decision with zero votes rejects with `Quorum not met (0 of K required)`",
  async () => {
    const mock = new MockSlackClient();
    const decisionId = "99999999-aaaa-bbbb-cccc-dddddddddddd";

    const decision = makePastDeadlineDecision({
      id: decisionId,
      success_criteria: "simple_majority",
      quorum: 3,
      required_voters_count: 5,
      message_ts: "1715170800.000500",
    });
    seedRow(
      mock,
      "decisions",
      decision as unknown as
        & { id: string }
        & Record<string, unknown>,
    );
    for (const userId of ["U1", "U2", "U3", "U4", "U5"]) {
      seedRow(
        mock,
        "voters",
        makeVoter(decisionId, userId) as unknown as
          & { id: string }
          & Record<string, unknown>,
      );
    }
    // No votes seeded — the decision must reject for quorum.

    const decisionsFinalised = await runPhaseA(mock);
    assert(
      decisionsFinalised >= 1,
      `decisions_finalised should be >= 1; got ${decisionsFinalised}`,
    );

    const reread = await mock.apps.datastore.get<DecisionRecord>({
      datastore: "decisions",
      id: decisionId,
    });
    assert(reread.ok && reread.item, "decision row missing after Phase A");
    const updated = reread.item;
    assertEquals(updated.status, "rejected");
    assertEquals(
      updated.outcome_reason,
      "Quorum not met (0 of 3 required)",
      "literal SPEC §15.4 reason string for quorum-not-met",
    );
    assert(
      typeof updated.finalized_at === "string" &&
        updated.finalized_at.length > 0,
      "finalized_at must be set on quorum-not-met finalisation",
    );

    // ADR is posted exactly once.
    const adrPosts = adrPostMessageCalls(mock);
    assertEquals(adrPosts.length, 1);
    assertEquals(adrPosts[0].thread_ts, decision.message_ts);
  },
);
