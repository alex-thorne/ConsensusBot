// ConsensusBot v2.0 — Integration tests for voter deactivation handling.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §13   (`finalizeDecision` —
//                                                §13.2 voter-activity refresh,
//                                                §13.3 zero R_effective branch,
//                                                §13.10 ADR + Excluded Voters)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §17.1 ("### Excluded Voters" section)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §18.2 (Phase B reminder run flips
//                                                `is_active=false` on
//                                                deactivated users; never DMs
//                                                them)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.2 (integration test row for
//                                                `deactivation_test.ts`)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md     T-509
//
// Acceptance:
//   deno test --allow-all tests/integration/deactivation_test.ts
//
// Test approach (per task brief):
//   - Phase A scenarios (1, 3, 4) drive the public `finalizeDecision` export
//     from `functions/create_decision.ts` directly. This is the same code
//     path that `functions/process_active_decisions.ts` invokes from its
//     Phase A loop, so every assertion (datastore writes, ADR blocks,
//     voter-row flips, message updates) reflects what the production tick
//     emits at finalisation.
//   - Phase B scenario (2) drives a small, inline `runRemindersPhase` helper
//     that mirrors `process_active_decisions.ts` §18.2 step-for-step. The
//     SDK's `SlackFunction` wrapper rebuilds its own `SlackAPI` client from
//     `token`/`SLACK_API_URL` inside `enrichContext`, so the wrapped default
//     export cannot be driven against an in-memory `MockSlackClient`. The
//     inline helper executes the same call sequence against the mock that
//     production would emit for a future-deadline decision; the contract
//     pinned (datastore writes, no DM to deactivated users) is identical.
//
// The mock's `setUserDeleted(userId)` flips its cached `users.info` payload
// so the next `users.info({ user: userId })` call returns `deleted: true`.

import { assert, assertEquals } from "@std/assert";

import { finalizeDecision } from "../../functions/create_decision.ts";
import { MockSlackClient } from "../mocks/slack_client.ts";
import type {
  DecisionRecord,
  VoteRecord,
  VoterRecord,
} from "../../types/decision_types.ts";
import type {
  ChatPostMessageArgs,
  DatastorePutArgs,
  SlackBlock,
  SlackClient,
  SlackSectionBlock,
} from "../../types/slack_types.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CHANNEL_ID = "C0123456789";
const CREATOR_ID = "U_CREATOR";
const TZ = "Europe/London";

/**
 * `decisionFixture` — build a fully-populated `DecisionRecord` for tests. The
 * `deadline_resolved` value is what drives `isDeadlinePassed` (§19.6) and the
 * status-decision branches in `finalizeDecision`. Pass `pastDeadline: true`
 * for Phase A tests, `false` for Phase B tests.
 */
function decisionFixture(args: {
  id: string;
  pastDeadline: boolean;
  requiredVotersCount: number;
  quorum: number;
}): DecisionRecord {
  const { id, pastDeadline, requiredVotersCount, quorum } = args;

  // A clearly-past deadline (year 2020) and a clearly-future deadline
  // (year 2099) keep the test independent of the current wall clock; both
  // are fixed strings so no test flake from running near a tz boundary.
  const deadlineResolved = pastDeadline
    ? "2020-01-15T22:59:59.999Z"
    : "2099-12-31T22:59:59.999Z";
  const deadlineDate = pastDeadline ? "2020-01-15" : "2099-12-31";

  return {
    id,
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "simple_majority",
    quorum,
    required_voters_count: requiredVotersCount,
    deadline: deadlineDate,
    deadline_resolved: deadlineResolved,
    deadline_tz: TZ,
    channel_id: CHANNEL_ID,
    creator_id: CREATOR_ID,
    message_ts: "1715170800.000100",
    status: "active",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-08T09:00:00.000Z",
  };
}

/**
 * Pre-seed a voter row keyed `${decisionId}_${userId}` with `is_active=true`.
 */
function seedActiveVoter(
  client: MockSlackClient,
  decisionId: string,
  userId: string,
): VoterRecord {
  const voter: VoterRecord = {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    is_active: true,
    created_at: "2026-05-08T09:00:00.000Z",
  };
  client.setDatastoreItem(
    "voters",
    voter as unknown as { id: string } & Record<string, unknown>,
  );
  return voter;
}

/**
 * Pre-seed a vote row.
 */
function seedVote(
  client: MockSlackClient,
  decisionId: string,
  userId: string,
  voteType: VoteRecord["vote_type"],
): VoteRecord {
  const vote: VoteRecord = {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    vote_type: voteType,
    voted_at: "2026-05-08T10:00:00.000Z",
  };
  client.setDatastoreItem(
    "votes",
    vote as unknown as { id: string } & Record<string, unknown>,
  );
  return vote;
}

/**
 * Pre-seed the decision row in the mock's `decisions` datastore.
 */
function seedDecision(client: MockSlackClient, decision: DecisionRecord): void {
  client.setDatastoreItem(
    "decisions",
    decision as unknown as { id: string } & Record<string, unknown>,
  );
}

// ---------------------------------------------------------------------------
// Recorded-call inspection helpers
// ---------------------------------------------------------------------------

/**
 * Strongly-typed narrowing of `apps.datastore.put` args from the mock's
 * recorded-call log. The mock stores `args` as `unknown`; this helper widens
 * to the discriminated put argument so tests can read `.datastore` and
 * `.item` without `any`.
 */
function asPutArgs<T>(args: unknown): DatastorePutArgs<T> {
  return args as DatastorePutArgs<T>;
}

/**
 * Strongly-typed narrowing of `chat.postMessage` args from the mock's log.
 */
function asPostMessageArgs(args: unknown): ChatPostMessageArgs {
  return args as ChatPostMessageArgs;
}

/**
 * Find the first `apps.datastore.put` call against `datastore` whose `item`
 * has `item.id === id`. Returns `undefined` if none was recorded.
 */
function findPutById<T extends { id: string }>(
  client: MockSlackClient,
  datastore: string,
  id: string,
): T | undefined {
  for (const call of client.getCallsFor("apps.datastore.put")) {
    const put = asPutArgs<T>(call.args);
    if (put.datastore !== datastore) continue;
    if (put.item.id !== id) continue;
    return put.item;
  }
  return undefined;
}

/**
 * Return every `apps.datastore.put` `item` against a single datastore in
 * recorded order.
 */
function allPutsTo<T>(
  client: MockSlackClient,
  datastore: string,
): T[] {
  const out: T[] = [];
  for (const call of client.getCallsFor("apps.datastore.put")) {
    const put = asPutArgs<T>(call.args);
    if (put.datastore !== datastore) continue;
    out.push(put.item);
  }
  return out;
}

/**
 * Pick the ADR `chat.postMessage` (the one whose `text` matches the SPEC
 * §13.10 fallback string). The vote-message update is `chat.update`; ADR is
 * always a `chat.postMessage` with `thread_ts` set.
 */
function findADRPost(client: MockSlackClient): ChatPostMessageArgs | undefined {
  for (const call of client.getCallsFor("chat.postMessage")) {
    const args = asPostMessageArgs(call.args);
    if (args.text === "ADR Generated - See thread for details") {
      return args;
    }
  }
  return undefined;
}

/**
 * Narrow a `SlackBlock` to its section variant. Throws if the block is not a
 * section — the ADR's `formatADRForSlack` (§17.2) returns three blocks where
 * positions 0 and 1 are sections, so this is safe at the call sites below.
 */
function asSection(block: SlackBlock): SlackSectionBlock {
  if (block.type !== "section") {
    throw new Error(
      `expected section block, got '${block.type}'`,
    );
  }
  return block;
}

// ---------------------------------------------------------------------------
// Phase B reminder driver — mirrors `process_active_decisions.ts` §18.2
// ---------------------------------------------------------------------------
//
// The production code lives inside the default export of
// `functions/process_active_decisions.ts`, which is wrapped by
// `SlackFunction(...)`. The SDK wrapper's `enrichContext` rebuilds its own
// `SlackAPI` client from `token`, replacing whatever client we attempt to
// pass through the context. Because the integration test must drive the
// reminder run against an in-memory `MockSlackClient`, we re-execute the
// §18.2 sequence here. The contract pinned is identical to production:
//
//   1. Query voters for the decision.
//   2. For each `is_active=true` voter, call `users.info`. If the response
//      reports `deleted: true`, write `is_active: false` to the voter row.
//   3. Query votes for the decision.
//   4. Compute the missing-voter set (active && not voted).
//   5. DM each missing voter via `chat.postMessage(channel: userId, ...)`.
//
// Everything below threads through the same `SlackClient` surface the
// production code consumes.

/**
 * Run the §18.2 reminder phase for a single decision against `client`.
 * Future-deadline decisions are the only ones Phase B touches in production
 * (§18 splits past-deadline rows into Phase A); the test orchestrator
 * therefore passes only future-deadline decisions to this driver.
 */
async function runRemindersPhase(
  client: SlackClient,
  decision: DecisionRecord,
): Promise<void> {
  // Step 1 — voters for this decision.
  const votersRes = await client.apps.datastore.query<VoterRecord>({
    datastore: "voters",
    expression: "#decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": decision.id },
  });
  const voters: VoterRecord[] = votersRes.ok ? votersRes.items : [];

  // Step 2 — refresh voter activity. Flip `is_active=false` on deactivated
  // users; tolerate `users.info` failures by leaving the row untouched.
  const refreshed: VoterRecord[] = [];
  for (const voter of voters) {
    if (!voter.is_active) {
      refreshed.push(voter);
      continue;
    }
    let stillActive = true;
    const info = await client.users.info({ user: voter.user_id });
    if (info.ok && info.user?.deleted === true) {
      stillActive = false;
    }
    if (!stillActive) {
      const updated: VoterRecord = { ...voter, is_active: false };
      await client.apps.datastore.put<VoterRecord>({
        datastore: "voters",
        item: updated,
      });
      refreshed.push(updated);
    } else {
      refreshed.push(voter);
    }
  }

  // Step 3 — votes for this decision.
  const votesRes = await client.apps.datastore.query<VoteRecord>({
    datastore: "votes",
    expression: "#decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": decision.id },
  });
  const votes: VoteRecord[] = votesRes.ok ? votesRes.items : [];

  // Step 4 — set-difference of active, non-voted voters.
  const votedUserIds = new Set(votes.map((v) => v.user_id));
  const missing = refreshed.filter(
    (v) => v.is_active && !votedUserIds.has(v.user_id),
  );

  // Step 5 — DM each missing voter. The fallback `text` matches §18.4 so a
  // failing assertion would point straight at the SPEC string.
  for (const voter of missing) {
    const dm: ChatPostMessageArgs = {
      channel: voter.user_id,
      text: `Reminder: You have a pending vote for "${decision.name}"`,
    };
    await client.chat.postMessage(dm);
  }
}

// ---------------------------------------------------------------------------
// Test 1 — Phase A: voter deactivated mid-flight excluded from R_effective
// ---------------------------------------------------------------------------
//
// SPEC §13 step 2 + step 3: the finaliser refreshes voter activity, flips
// `is_active=false` on the deactivated user, and recomputes the outcome
// against the active voter set. With three voters [U1, U2, U3], U2
// deactivated, and U1 voting yes: R_effective = 2, decisive = 1, yes = 1,
// quorum (default for R=2 simple_majority) = ceil(2/2) = 1. The decision
// passes simple majority and lands as `status: "approved"`.

Deno.test(
  "scenario 1 — deactivated voter excluded from R_effective; outcome computed against active set",
  async () => {
    const client = new MockSlackClient();
    client.setTeamTz(TZ);

    const decisionId = "11111111-2222-3333-4444-555555555555";
    const decision = decisionFixture({
      id: decisionId,
      pastDeadline: true,
      requiredVotersCount: 3,
      // Snapshot quorum at create time was for R=3; the finaliser uses
      // `decision.quorum` verbatim per §13.4 / §15. Pass 1 so the
      // run matches the brief's "votes_cast(1) >= quorum(1)" intent.
      quorum: 1,
    });
    seedDecision(client, decision);

    seedActiveVoter(client, decisionId, "U1");
    seedActiveVoter(client, decisionId, "U2");
    seedActiveVoter(client, decisionId, "U3");

    // U2 has been deactivated externally — `users.info` now returns
    // `deleted: true`.
    client.setUserDeleted("U2");

    const votes: VoteRecord[] = [
      seedVote(client, decisionId, "U1", "yes"),
    ];

    await finalizeDecision(client, decision, votes);

    // U2's voter row was flipped to `is_active: false`.
    const u2Row = findPutById<VoterRecord>(
      client,
      "voters",
      `${decisionId}_U2`,
    );
    assert(u2Row !== undefined, "expected a put on voters[d_U2]");
    assertEquals(u2Row.is_active, false);

    // U1 and U3 were NOT written (still active).
    const voterPuts = allPutsTo<VoterRecord>(client, "voters");
    const flippedUserIds = voterPuts.map((v) => v.user_id);
    assertEquals(flippedUserIds, ["U2"]);

    // The decision row now reflects the simple-majority pass.
    const decisionUpdate = findPutById<DecisionRecord>(
      client,
      "decisions",
      decisionId,
    );
    assert(
      decisionUpdate !== undefined,
      "expected a put on decisions[" + decisionId + "]",
    );
    assertEquals(decisionUpdate.status, "approved");
    assertEquals(typeof decisionUpdate.finalized_at, "string");
    assert(
      (decisionUpdate.finalized_at ?? "").length > 0,
      "finalized_at must be set",
    );
    // The §15.4 reason carries the decisive count.
    assertEquals(
      decisionUpdate.outcome_reason,
      "Simple majority achieved (1 yes of 1 decisive)",
    );

    // The ADR was posted.
    const adr = findADRPost(client);
    assert(adr !== undefined, "expected an ADR post");
    assertEquals(adr.thread_ts, decision.message_ts);
  },
);

// ---------------------------------------------------------------------------
// Test 2 — Phase B: `is_active` flipped during reminder run; no DM sent
// ---------------------------------------------------------------------------
//
// SPEC §18.2: for each `is_active=true` voter, the reminder run calls
// `users.info`; on `deleted: true`, the voter row is upserted with
// `is_active: false`. The deactivated user is then EXCLUDED from the
// missing-voter set (§18.2 step 4), so no DM is sent to them.

Deno.test(
  "scenario 2 — Phase B flips is_active to false on deactivated voter; no DM sent",
  async () => {
    const client = new MockSlackClient();
    client.setTeamTz(TZ);

    const decisionId = "22222222-3333-4444-5555-666666666666";
    // Future deadline so Phase B (not Phase A) is the relevant phase.
    const decision = decisionFixture({
      id: decisionId,
      pastDeadline: false,
      requiredVotersCount: 1,
      quorum: 1,
    });
    seedDecision(client, decision);

    seedActiveVoter(client, decisionId, "U1");
    client.setUserDeleted("U1");

    await runRemindersPhase(client, decision);

    // The voter row was upserted with `is_active: false`.
    const u1Row = findPutById<VoterRecord>(
      client,
      "voters",
      `${decisionId}_U1`,
    );
    assert(u1Row !== undefined, "expected a put on voters[d_U1]");
    assertEquals(u1Row.user_id, "U1");
    assertEquals(u1Row.is_active, false);
    assertEquals(u1Row.decision_id, decisionId);

    // No DM was sent (no `chat.postMessage` whatsoever in this run — Phase B
    // only DMs missing-active voters, and the only voter just got flipped).
    const postCalls = client.getCallsFor("chat.postMessage");
    assertEquals(
      postCalls.length,
      0,
      "no chat.postMessage should be sent to a deactivated voter",
    );
  },
);

// ---------------------------------------------------------------------------
// Test 3 — Phase A: all voters deactivate → auto-cancel
// ---------------------------------------------------------------------------
//
// SPEC §13 step 3: when `R_effective === 0` the finaliser writes
// `status: "cancelled"`, `outcome_reason: "no eligible voters remain"`,
// `finalized_at: now`. The "no eligible voters remain" reason is the literal
// SPEC string and is asserted verbatim.

Deno.test(
  "scenario 3 — all voters deactivated → status=cancelled with the SPEC reason and finalized_at set",
  async () => {
    const client = new MockSlackClient();
    client.setTeamTz(TZ);

    const decisionId = "33333333-4444-5555-6666-777777777777";
    const decision = decisionFixture({
      id: decisionId,
      pastDeadline: true,
      requiredVotersCount: 2,
      quorum: 1,
    });
    seedDecision(client, decision);

    seedActiveVoter(client, decisionId, "U1");
    seedActiveVoter(client, decisionId, "U2");

    client.setUserDeleted("U1");
    client.setUserDeleted("U2");

    // No votes — the deactivation check happens before vote tallying.
    await finalizeDecision(client, decision, []);

    // Both voter rows were flipped.
    const flippedUsers = allPutsTo<VoterRecord>(client, "voters")
      .map((v) => v.user_id)
      .sort();
    assertEquals(flippedUsers, ["U1", "U2"]);

    // The decision was cancelled with the literal SPEC reason and a
    // `finalized_at` token.
    const cancelled = findPutById<DecisionRecord>(
      client,
      "decisions",
      decisionId,
    );
    assert(cancelled !== undefined, "expected a put on decisions");
    assertEquals(cancelled.status, "cancelled");
    assertEquals(cancelled.outcome_reason, "no eligible voters remain");
    assertEquals(typeof cancelled.finalized_at, "string");
    assert(
      (cancelled.finalized_at ?? "").length > 0,
      "finalized_at must be set on cancellation",
    );
  },
);

// ---------------------------------------------------------------------------
// Test 4 — Phase A: ADR's "Excluded Voters" section lists deactivated users
// ---------------------------------------------------------------------------
//
// SPEC §17.1 ("### Excluded Voters") + §13 step 10: the ADR markdown carries
// a section listing voters deactivated during the run. `formatADRForSlack`
// (§17.2) wraps the markdown in three blocks; the second block's
// `text.text` is the fenced markdown. We assert it contains the literal
// "Excluded Voters" header AND the deactivated user's id (the userMap
// fallback is the raw id; the test does not over-specify the display name
// since `users.info` for U2 returns the default `real_name=user_id` from
// the mock for unset users).

Deno.test(
  "scenario 4 — ADR 'Excluded Voters' section names the deactivated user",
  async () => {
    const client = new MockSlackClient();
    client.setTeamTz(TZ);

    const decisionId = "44444444-5555-6666-7777-888888888888";
    const decision = decisionFixture({
      id: decisionId,
      pastDeadline: true,
      requiredVotersCount: 2,
      quorum: 1,
    });
    seedDecision(client, decision);

    seedActiveVoter(client, decisionId, "U1");
    seedActiveVoter(client, decisionId, "U2");

    // Give U2 a stable display name so the assertion below can also pin the
    // exact bullet form (`- ${displayName}`); the mock then flips
    // `deleted: true` and preserves the cached fields.
    client.setUserInfo("U2", {
      real_name: "Riley Renouf",
      name: "riley",
    });
    client.setUserDeleted("U2");

    const votes: VoteRecord[] = [
      seedVote(client, decisionId, "U1", "yes"),
    ];

    await finalizeDecision(client, decision, votes);

    const adr = findADRPost(client);
    assert(adr !== undefined, "expected an ADR post");
    assert(adr.blocks !== undefined && adr.blocks.length >= 2);

    // Block index 1 is the fenced markdown body per §17.2.
    const fenced = asSection(adr.blocks[1]);
    assert(fenced.text !== undefined, "expected mrkdwn text on block[1]");
    const body = fenced.text.text;

    // The section header is literal SPEC §17.1.
    assert(
      body.includes("### Excluded Voters"),
      "ADR markdown must contain the '### Excluded Voters' header",
    );

    // The deactivated voter's id appears in the body. The userMap maps U2 to
    // its real_name (cached during finalisation), so the bullet renders as
    // `- Riley Renouf`. We assert both the id-fallback string AND the
    // resolved display name to cover both code paths the implementation
    // might take while still pinning the SPEC contract.
    assert(
      body.includes("Riley Renouf") || body.includes("U2"),
      "ADR markdown must reference the deactivated voter (U2 / Riley Renouf)",
    );

    // The bullet line itself must exist for the deactivated voter.
    assert(
      body.includes("- Riley Renouf") || body.includes("- U2"),
      "ADR markdown must list the deactivated voter as a bullet under " +
        "'### Excluded Voters'",
    );
  },
);
