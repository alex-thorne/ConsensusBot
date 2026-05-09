// ConsensusBot v2.0 — Type-shape tests for `types/decision_types.ts`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §5.1–§5.5
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-101
//
// These tests verify *shape*, not behaviour. Interfaces are erased at runtime,
// so we construct typed literals and assert their fields. The test file
// MUST type-check (`deno check`) — that is half the contract.

import { assert, assertEquals } from "@std/assert";
import type {
  DecisionItem,
  DecisionRecord,
  DecisionStatus,
  SuccessCriteria,
  VoteHistoryRecord,
  VoteRecord,
  VoterRecord,
  VoteType,
} from "../types/decision_types.ts";

// ---------------------------------------------------------------------------
// DecisionRecord
// ---------------------------------------------------------------------------

Deno.test("DecisionRecord — constructable with all required fields, optional fields omitted", () => {
  const decision: DecisionRecord = {
    id: "11111111-2222-3333-4444-555555555555",
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "simple_majority",
    quorum: 3,
    required_voters_count: 5,
    deadline: "2026-05-15",
    deadline_resolved: "2026-05-15T22:59:59+01:00",
    deadline_tz: "Europe/London",
    channel_id: "C0123456789",
    creator_id: "U0001",
    message_ts: "1715170800.000100",
    status: "active",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-08T09:00:00.000Z",
  };

  assertEquals(decision.status, "active");
  assertEquals(decision.success_criteria, "simple_majority");
  assertEquals(decision.quorum, 3);
  assertEquals(decision.required_voters_count, 5);
  assertEquals(decision.deadline_resolved, "2026-05-15T22:59:59+01:00");
  assertEquals(decision.deadline_tz, "Europe/London");
  assertEquals(decision.outcome_reason, undefined);
  assertEquals(decision.finalized_at, undefined);
});

Deno.test("DecisionRecord — supports optional outcome_reason and finalized_at on finalisation", () => {
  const decision: DecisionRecord = {
    id: "decision-uuid",
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "super_majority",
    quorum: 4,
    required_voters_count: 5,
    deadline: "2026-05-15",
    deadline_resolved: "2026-05-15T22:59:59+01:00",
    deadline_tz: "Europe/London",
    channel_id: "C0123456789",
    creator_id: "U0001",
    message_ts: "1715170800.000100",
    status: "approved",
    outcome_reason: "super-majority threshold met",
    finalized_at: "2026-05-15T23:00:00.000Z",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-15T23:00:00.000Z",
  };

  assert(decision.finalized_at !== undefined);
  assertEquals(decision.outcome_reason, "super-majority threshold met");
  assertEquals(decision.status, "approved");
});

// ---------------------------------------------------------------------------
// success_criteria and status enum domains
// ---------------------------------------------------------------------------

Deno.test("DecisionRecord — success_criteria covers the three documented values", () => {
  const criteria: SuccessCriteria[] = [
    "simple_majority",
    "super_majority",
    "unanimous",
  ];
  assertEquals(criteria.length, 3);

  for (const c of criteria) {
    const decision: DecisionRecord = {
      id: `decision-${c}`,
      name: "n",
      proposal: "p",
      success_criteria: c,
      quorum: 1,
      required_voters_count: 1,
      deadline: "2026-05-15",
      deadline_resolved: "2026-05-15T22:59:59+01:00",
      deadline_tz: "Europe/London",
      channel_id: "C",
      creator_id: "U",
      message_ts: "1.0",
      status: "active",
      created_at: "2026-05-08T09:00:00.000Z",
      updated_at: "2026-05-08T09:00:00.000Z",
    };
    assertEquals(decision.success_criteria, c);
  }
});

Deno.test("DecisionRecord — status covers the four documented lifecycle values", () => {
  const statuses: DecisionStatus[] = [
    "active",
    "approved",
    "rejected",
    "cancelled",
  ];
  assertEquals(statuses.length, 4);

  // Value-narrowing: assigning a literal proves the union compiles.
  const active: DecisionStatus = "active";
  const approved: DecisionStatus = "approved";
  const rejected: DecisionStatus = "rejected";
  const cancelled: DecisionStatus = "cancelled";

  assertEquals(active, "active");
  assertEquals(approved, "approved");
  assertEquals(rejected, "rejected");
  assertEquals(cancelled, "cancelled");
});

// ---------------------------------------------------------------------------
// VoteRecord
// ---------------------------------------------------------------------------

Deno.test("VoteRecord — every vote_type domain value is constructable", () => {
  const votes: VoteRecord[] = (["yes", "no", "abstain"] as const).map(
    (vote_type): VoteRecord => ({
      id: `decision_user_${vote_type}`,
      decision_id: "decision",
      user_id: `user_${vote_type}`,
      vote_type,
      voted_at: "2026-05-08T10:00:00.000Z",
    }),
  );

  assertEquals(votes.length, 3);
  assertEquals(votes[0].vote_type, "yes");
  assertEquals(votes[1].vote_type, "no");
  assertEquals(votes[2].vote_type, "abstain");

  // Value-narrowing on the literal union.
  const v: VoteType = votes[0].vote_type;
  assertEquals(v, "yes");
});

// ---------------------------------------------------------------------------
// VoterRecord
// ---------------------------------------------------------------------------

Deno.test("VoterRecord — is_active accepts both true and false", () => {
  const active: VoterRecord = {
    id: "decision_user1",
    decision_id: "decision",
    user_id: "user1",
    is_active: true,
    created_at: "2026-05-08T09:00:00.000Z",
  };
  const deactivated: VoterRecord = {
    id: "decision_user2",
    decision_id: "decision",
    user_id: "user2",
    is_active: false,
    created_at: "2026-05-08T09:00:00.000Z",
  };

  assertEquals(active.is_active, true);
  assertEquals(deactivated.is_active, false);
});

// ---------------------------------------------------------------------------
// VoteHistoryRecord
// ---------------------------------------------------------------------------

Deno.test("VoteHistoryRecord — first vote: event_kind=cast, no previous_vote_type", () => {
  const cast: VoteHistoryRecord = {
    id: "decision_user_001",
    decision_id: "decision",
    user_id: "user",
    vote_type: "yes",
    event_kind: "cast",
    voted_at: "2026-05-08T10:00:00.000Z",
  };

  assertEquals(cast.event_kind, "cast");
  assertEquals(cast.previous_vote_type, undefined);
});

Deno.test("VoteHistoryRecord — overwrite: event_kind=changed, previous_vote_type set", () => {
  const changed: VoteHistoryRecord = {
    id: "decision_user_002",
    decision_id: "decision",
    user_id: "user",
    vote_type: "no",
    previous_vote_type: "yes",
    event_kind: "changed",
    voted_at: "2026-05-08T11:00:00.000Z",
  };

  assertEquals(changed.event_kind, "changed");
  assertEquals(changed.previous_vote_type, "yes");
  assertEquals(changed.vote_type, "no");
});

// ---------------------------------------------------------------------------
// DecisionItem alias
// ---------------------------------------------------------------------------

Deno.test("DecisionItem — alias of DecisionRecord (assignable both ways)", () => {
  const decision: DecisionRecord = {
    id: "decision-uuid",
    name: "n",
    proposal: "p",
    success_criteria: "unanimous",
    quorum: 5,
    required_voters_count: 5,
    deadline: "2026-05-15",
    deadline_resolved: "2026-05-15T22:59:59+01:00",
    deadline_tz: "Europe/London",
    channel_id: "C",
    creator_id: "U",
    message_ts: "1.0",
    status: "active",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-08T09:00:00.000Z",
  };

  // Assign DecisionRecord -> DecisionItem.
  const asItem: DecisionItem = decision;
  // Assign DecisionItem -> DecisionRecord (round-trip).
  const backToRecord: DecisionRecord = asItem;

  assertEquals(asItem.id, decision.id);
  assertEquals(backToRecord.success_criteria, "unanimous");
});
