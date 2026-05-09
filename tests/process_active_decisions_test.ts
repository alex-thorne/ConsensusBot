// ConsensusBot v2.0 — Shape & logic unit tests for
// `functions/process_active_decisions.ts`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §18 (Process Active Decisions)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §5.3 (voter `is_active`)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.1 (`process_active_decisions_test.ts`)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-205
//
// Acceptance:
//   deno test --allow-read --allow-env tests/process_active_decisions_test.ts
//
// This is a TYPE-SHAPE & LOGIC unit test: it MUST NOT import the function file
// (T-302). All helpers and fixtures are inline so the test pins the
// expected shape of the data passed through `process_active_decisions` and the
// pure transforms it performs (set-difference, status filter, effective R,
// safe casts, pagination loop). The integration sweep lives in
// `tests/integration/process_active_decisions_test.ts` (T-504).

import { assert, assertEquals } from "@std/assert";
import type {
  DecisionRecord,
  DecisionStatus,
  VoteRecord,
  VoterRecord,
} from "../types/decision_types.ts";

// ---------------------------------------------------------------------------
// Inline helpers — these mirror the pure transforms used inside
// `process_active_decisions` (§18.2). They are duplicated here on purpose so
// this test file remains independent of the function file.
// ---------------------------------------------------------------------------

/**
 * Set-difference: voters that are still active and have not yet voted.
 *
 * SPEC §18.2:
 *   `missingVoters = voters.items.filter(v => v.is_active &&
 *                                              !votedUserIds.has(v.user_id))`
 *
 * Voters whose `is_active === false` (deactivated mid-flight) are excluded
 * from the reminder DM list per §5.3 + §13.
 */
function missingVoters(
  voters: VoterRecord[],
  votes: VoteRecord[],
): VoterRecord[] {
  const voted = new Set(votes.map((v) => v.user_id));
  return voters.filter((v) => v.is_active && !voted.has(v.user_id));
}

/**
 * Status filter: only `active` decisions reach Phase B.
 * Phase A (§18.1) finalises past-deadline rows and flips them to a
 * terminal status; Phase B (§18.2) iterates only the survivors.
 */
function filterActive(decisions: DecisionRecord[]): DecisionRecord[] {
  return decisions.filter((d) => d.status === "active");
}

/**
 * Effective required-voters count after deactivation pruning (§13 + §18.2).
 * Voters with `is_active === false` are excluded from `R_effective` and
 * therefore from `quorum` recomputation.
 */
function effectiveR(voters: VoterRecord[]): number {
  return voters.filter((v) => v.is_active).length;
}

/**
 * Wire shape of a single page returned by `apps.datastore.query`. Slack's
 * datastore client surfaces `items: unknown[]` with a `response_metadata`
 * carrying `next_cursor`; an empty / absent cursor terminates the loop.
 */
interface DatastorePage {
  items: unknown[];
  response_metadata: { next_cursor?: string };
}

/**
 * Drain a paginated `apps.datastore.query` by calling `fetchPage(cursor)`
 * until `next_cursor` is empty / absent, then concatenating items.
 *
 * SPEC §18.3: "MUST iterate `response_metadata.next_cursor` if present".
 */
async function drainPaginated(
  fetchPage: (cursor: string) => Promise<DatastorePage>,
): Promise<unknown[]> {
  const out: unknown[] = [];
  let cursor = "";
  // The first call uses the empty cursor (i.e. start from the first page);
  // subsequent calls feed back the value from `response_metadata.next_cursor`.
  // We loop while the most recent page surfaced a non-empty cursor.
  while (true) {
    const page = await fetchPage(cursor);
    out.push(...page.items);
    const next = page.response_metadata.next_cursor ?? "";
    if (next === "") return out;
    cursor = next;
  }
}

// ---------------------------------------------------------------------------
// Fixture builders.
// ---------------------------------------------------------------------------

function makeVoter(
  decisionId: string,
  userId: string,
  isActive: boolean,
): VoterRecord {
  return {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    is_active: isActive,
    created_at: "2026-05-08T09:00:00.000Z",
  };
}

function makeVote(
  decisionId: string,
  userId: string,
  vote: VoterVoteType = "yes",
): VoteRecord {
  return {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    vote_type: vote,
    voted_at: "2026-05-08T10:00:00.000Z",
  };
}

// Local alias to keep `makeVote` independent of unrelated re-exports.
type VoterVoteType = VoteRecord["vote_type"];

function makeDecision(
  id: string,
  status: DecisionStatus,
): DecisionRecord {
  return {
    id,
    name: `Decision ${id}`,
    proposal: `Proposal for ${id}`,
    success_criteria: "simple_majority",
    quorum: 3,
    required_voters_count: 5,
    deadline: "2026-05-15",
    deadline_resolved: "2026-05-15T22:59:59+01:00",
    deadline_tz: "Europe/London",
    channel_id: "C0123456789",
    creator_id: "U0001",
    message_ts: `1715170800.${id}`,
    status,
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-08T09:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// 1. Missing-voter set-difference logic (excluding `is_active === false`).
// ---------------------------------------------------------------------------

Deno.test("missingVoters — 4 active voters, 2 voted, returns the 2 non-voters", () => {
  const decisionId = "d1";
  const voters: VoterRecord[] = [
    makeVoter(decisionId, "U1", true),
    makeVoter(decisionId, "U2", true),
    makeVoter(decisionId, "U3", true),
    makeVoter(decisionId, "U4", true),
  ];
  const votes: VoteRecord[] = [
    makeVote(decisionId, "U1"),
    makeVote(decisionId, "U3"),
  ];

  const missing = missingVoters(voters, votes);
  const missingIds = missing.map((v) => v.user_id).sort();

  assertEquals(missing.length, 2);
  assertEquals(missingIds, ["U2", "U4"]);
});

Deno.test("missingVoters — inactive voter is excluded from the missing set even with zero votes", () => {
  // 4 voters, U2 deactivated (is_active=false), 0 votes recorded.
  // U2 must NOT appear in missingVoters: deactivated users do not get DM'd.
  const decisionId = "d2";
  const voters: VoterRecord[] = [
    makeVoter(decisionId, "U1", true),
    makeVoter(decisionId, "U2", false), // deactivated
    makeVoter(decisionId, "U3", true),
    makeVoter(decisionId, "U4", true),
  ];
  const votes: VoteRecord[] = [];

  const missing = missingVoters(voters, votes);
  const missingIds = missing.map((v) => v.user_id).sort();

  assertEquals(missing.length, 3);
  assertEquals(missingIds, ["U1", "U3", "U4"]);
  assert(!missingIds.includes("U2"), "deactivated voter must be excluded");
});

Deno.test("missingVoters — all voters voted yields empty array", () => {
  const decisionId = "d3";
  const voters: VoterRecord[] = [
    makeVoter(decisionId, "U1", true),
    makeVoter(decisionId, "U2", true),
    makeVoter(decisionId, "U3", true),
  ];
  const votes: VoteRecord[] = [
    makeVote(decisionId, "U1", "yes"),
    makeVote(decisionId, "U2", "no"),
    makeVote(decisionId, "U3", "abstain"),
  ];

  const missing = missingVoters(voters, votes);
  assertEquals(missing.length, 0);
  assertEquals(missing, []);
});

Deno.test("missingVoters — all voters inactive yields empty array (not the inactive set)", () => {
  // Edge case: every voter has been deactivated. The result must be an
  // EMPTY array (no DMs to send), not the inactive list.
  const decisionId = "d4";
  const voters: VoterRecord[] = [
    makeVoter(decisionId, "U1", false),
    makeVoter(decisionId, "U2", false),
    makeVoter(decisionId, "U3", false),
  ];
  const votes: VoteRecord[] = [];

  const missing = missingVoters(voters, votes);
  assertEquals(missing.length, 0);
  assertEquals(missing, []);
});

// ---------------------------------------------------------------------------
// 2. Active-decision filtering by status.
// ---------------------------------------------------------------------------

Deno.test("filterActive — keeps only status='active' across the four lifecycle states", () => {
  const decisions: DecisionRecord[] = [
    makeDecision("a1", "active"),
    makeDecision("a2", "approved"),
    makeDecision("a3", "rejected"),
    makeDecision("a4", "cancelled"),
    makeDecision("a5", "active"),
  ];

  const active = filterActive(decisions);
  const ids = active.map((d) => d.id).sort();

  assertEquals(active.length, 2);
  assertEquals(ids, ["a1", "a5"]);
  for (const d of active) {
    assertEquals(d.status, "active");
  }
});

Deno.test("filterActive — empty input yields empty output", () => {
  assertEquals(filterActive([]), []);
});

Deno.test("filterActive — no active decisions yields empty array", () => {
  const decisions: DecisionRecord[] = [
    makeDecision("b1", "approved"),
    makeDecision("b2", "rejected"),
    makeDecision("b3", "cancelled"),
  ];
  assertEquals(filterActive(decisions), []);
});

// ---------------------------------------------------------------------------
// 3. Deactivated-voter exclusion in the count.
// ---------------------------------------------------------------------------

Deno.test("effectiveR — 5 voters, 2 inactive, returns 3", () => {
  const decisionId = "d5";
  const voters: VoterRecord[] = [
    makeVoter(decisionId, "U1", true),
    makeVoter(decisionId, "U2", false), // deactivated
    makeVoter(decisionId, "U3", true),
    makeVoter(decisionId, "U4", false), // deactivated
    makeVoter(decisionId, "U5", true),
  ];

  assertEquals(effectiveR(voters), 3);
});

Deno.test("effectiveR — all voters active equals total length", () => {
  const decisionId = "d6";
  const voters: VoterRecord[] = [
    makeVoter(decisionId, "U1", true),
    makeVoter(decisionId, "U2", true),
    makeVoter(decisionId, "U3", true),
  ];
  assertEquals(effectiveR(voters), voters.length);
});

Deno.test("effectiveR — all voters inactive yields 0 (auto-cancel signal)", () => {
  // §18 + §13: when R_effective = 0 the decision auto-cancels with
  // outcome_reason="no eligible voters remain" — but that branch is
  // implemented in `process_active_decisions` itself; here we just pin
  // the count semantics.
  const decisionId = "d7";
  const voters: VoterRecord[] = [
    makeVoter(decisionId, "U1", false),
    makeVoter(decisionId, "U2", false),
  ];
  assertEquals(effectiveR(voters), 0);
});

Deno.test("effectiveR — empty voter list yields 0", () => {
  assertEquals(effectiveR([]), 0);
});

// ---------------------------------------------------------------------------
// 4. Type casts on query items.
// ---------------------------------------------------------------------------

Deno.test("query-item cast — `items: unknown[]` casts to DecisionRecord[] preserving fields", () => {
  // Mimic the wire shape: `apps.datastore.query` returns items typed as
  // `unknown[]`. The callsite must `as DecisionRecord[]` after trusting the
  // datastore schema (the datastore typedef IS the schema). We assert here
  // that the cast is sufficient for downstream field access AND that the
  // fields we rely on round-trip through the cast.
  const wireItems: unknown[] = [
    {
      id: "d-cast-1",
      name: "Cast 1",
      proposal: "p",
      success_criteria: "simple_majority",
      quorum: 3,
      required_voters_count: 5,
      deadline: "2026-05-15",
      deadline_resolved: "2026-05-15T22:59:59+01:00",
      deadline_tz: "Europe/London",
      channel_id: "C1",
      creator_id: "U1",
      message_ts: "1715170800.000100",
      status: "active",
      created_at: "2026-05-08T09:00:00.000Z",
      updated_at: "2026-05-08T09:00:00.000Z",
    },
    {
      id: "d-cast-2",
      name: "Cast 2",
      proposal: "p",
      success_criteria: "super_majority",
      quorum: 4,
      required_voters_count: 5,
      deadline: "2026-05-15",
      deadline_resolved: "2026-05-15T22:59:59+01:00",
      deadline_tz: "Europe/London",
      channel_id: "C1",
      creator_id: "U1",
      message_ts: "1715170800.000200",
      status: "approved",
      outcome_reason: "super-majority threshold met",
      finalized_at: "2026-05-15T23:00:00.000Z",
      created_at: "2026-05-08T09:00:00.000Z",
      updated_at: "2026-05-15T23:00:00.000Z",
    },
  ];

  // The cast pattern used inside `process_active_decisions`.
  const decisions = wireItems as DecisionRecord[];

  // Field access works without TS complaint.
  assertEquals(decisions.length, 2);
  assertEquals(decisions[0].id, "d-cast-1");
  assertEquals(decisions[0].status, "active");
  assertEquals(decisions[0].quorum, 3);
  assertEquals(decisions[1].status, "approved");
  assertEquals(decisions[1].finalized_at, "2026-05-15T23:00:00.000Z");

  // The downstream filter still works through the cast.
  const active = filterActive(decisions);
  assertEquals(active.length, 1);
  assertEquals(active[0].id, "d-cast-1");
});

Deno.test("query-item cast — items cast to VoterRecord[] preserves is_active boolean", () => {
  const wireItems: unknown[] = [
    {
      id: "d_U1",
      decision_id: "d",
      user_id: "U1",
      is_active: true,
      created_at: "2026-05-08T09:00:00.000Z",
    },
    {
      id: "d_U2",
      decision_id: "d",
      user_id: "U2",
      is_active: false,
      created_at: "2026-05-08T09:00:00.000Z",
    },
  ];

  const voters = wireItems as VoterRecord[];

  assertEquals(voters.length, 2);
  assertEquals(voters[0].is_active, true);
  assertEquals(voters[1].is_active, false);
  assertEquals(effectiveR(voters), 1);
});

Deno.test("query-item cast — items cast to VoteRecord[] preserves vote_type literal", () => {
  const wireItems: unknown[] = [
    {
      id: "d_U1",
      decision_id: "d",
      user_id: "U1",
      vote_type: "yes",
      voted_at: "2026-05-08T10:00:00.000Z",
    },
    {
      id: "d_U2",
      decision_id: "d",
      user_id: "U2",
      vote_type: "abstain",
      voted_at: "2026-05-08T10:01:00.000Z",
    },
  ];

  const votes = wireItems as VoteRecord[];

  assertEquals(votes.length, 2);
  assertEquals(votes[0].vote_type, "yes");
  assertEquals(votes[1].vote_type, "abstain");
});

// ---------------------------------------------------------------------------
// 5. Pagination cursor traversal logic.
// ---------------------------------------------------------------------------

Deno.test("drainPaginated — accumulates items across three pages until next_cursor is empty", async () => {
  const d1 = makeDecision("p1", "active");
  const d2 = makeDecision("p2", "active");
  const d3 = makeDecision("p3", "active");
  const d4 = makeDecision("p4", "active");

  const pages: Record<string, DatastorePage> = {
    "": { items: [d1, d2], response_metadata: { next_cursor: "c1" } },
    "c1": { items: [d3], response_metadata: { next_cursor: "c2" } },
    "c2": { items: [d4], response_metadata: {} },
  };

  const seenCursors: string[] = [];
  const fetchPage = (cursor: string): Promise<DatastorePage> => {
    seenCursors.push(cursor);
    return Promise.resolve(pages[cursor]);
  };

  const accumulated = (await drainPaginated(fetchPage)) as DecisionRecord[];

  // Final accumulated array is [d1, d2, d3, d4] in order.
  assertEquals(accumulated.length, 4);
  assertEquals(accumulated.map((d) => d.id), ["p1", "p2", "p3", "p4"]);

  // The loop visited every cursor produced by the previous page.
  assertEquals(seenCursors, ["", "c1", "c2"]);
});

Deno.test("drainPaginated — single page with empty next_cursor terminates immediately", async () => {
  const d1 = makeDecision("s1", "active");
  const fetchPage = (_cursor: string): Promise<DatastorePage> =>
    Promise.resolve({
      items: [d1],
      response_metadata: { next_cursor: "" },
    });

  const accumulated = await drainPaginated(fetchPage);
  assertEquals(accumulated.length, 1);
});

Deno.test("drainPaginated — single page with absent next_cursor terminates immediately", async () => {
  // SPEC §18.3 admits both `next_cursor: ""` and an absent key as terminal.
  const d1 = makeDecision("a1", "active");
  const fetchPage = (_cursor: string): Promise<DatastorePage> =>
    Promise.resolve({
      items: [d1],
      response_metadata: {},
    });

  const accumulated = await drainPaginated(fetchPage);
  assertEquals(accumulated.length, 1);
});

Deno.test("drainPaginated — empty first page (no items, no cursor) yields empty array", async () => {
  const fetchPage = (_cursor: string): Promise<DatastorePage> =>
    Promise.resolve({
      items: [],
      response_metadata: {},
    });

  const accumulated = await drainPaginated(fetchPage);
  assertEquals(accumulated, []);
});
