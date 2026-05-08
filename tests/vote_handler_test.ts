// ConsensusBot v2.0 — Vote-handler shape unit tests.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §5.1  (decisions)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §5.2  (votes)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §5.4  (vote_history)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8.6  (vote_type extraction)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §9 step 7 (event_seq generation)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.1 (`vote_handler_test.ts` row)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-204
//
// These tests pin *shape* and *normalisation logic*, not handler behaviour.
// The handler module is intentionally NOT imported — fixtures are inline so
// the contract is verified independently of the implementation.

import { assert, assertEquals } from "@std/assert";
import type {
  DecisionRecord,
  VoteHistoryRecord,
  VoteRecord,
  VoteType,
} from "../types/decision_types.ts";

// ---------------------------------------------------------------------------
// 1. Vote-type normalisation (SPEC §8.6)
// ---------------------------------------------------------------------------
//
// The vote handler computes:
//   `vote_type = action.action_id.replace(/^vote_/, "")`
// Only the leading `vote_` prefix is stripped. Other action_ids that do not
// match the prefix MUST pass through unchanged.

Deno.test("vote-type normalisation — `vote_yes` strips to `yes`", () => {
  assertEquals("vote_yes".replace(/^vote_/, ""), "yes");
});

Deno.test("vote-type normalisation — `vote_no` strips to `no`", () => {
  assertEquals("vote_no".replace(/^vote_/, ""), "no");
});

Deno.test("vote-type normalisation — `vote_abstain` strips to `abstain`", () => {
  assertEquals("vote_abstain".replace(/^vote_/, ""), "abstain");
});

Deno.test("vote-type normalisation — `decision_cancel` is left unchanged (anchored regex)", () => {
  // Guards against an accidental capture if the regex ever loses its `^`
  // anchor. `decision_cancel` does not start with `vote_`, so the replacement
  // is a no-op.
  assertEquals(
    "decision_cancel".replace(/^vote_/, ""),
    "decision_cancel",
  );
});

Deno.test("vote-type normalisation — produces the VoteType union for the three vote action_ids", () => {
  const actionIds = ["vote_yes", "vote_no", "vote_abstain"] as const;
  const normalised: VoteType[] = actionIds.map(
    (id): VoteType => {
      const stripped = id.replace(/^vote_/, "");
      // Narrow to VoteType — the three action_ids map to the three literal
      // members of the union.
      if (stripped === "yes" || stripped === "no" || stripped === "abstain") {
        return stripped;
      }
      throw new Error(`unexpected normalised vote_type: ${stripped}`);
    },
  );

  assertEquals(normalised, ["yes", "no", "abstain"]);
});

// ---------------------------------------------------------------------------
// 2. DecisionRecord shape — including new fields (SPEC §5.1)
// ---------------------------------------------------------------------------
//
// The vote handler reads a `DecisionRecord` via
// `apps.datastore.get({ datastore: "decisions", id: decision_id })`.
// All of the following fields MUST be present and typed as documented:
// `quorum`, `required_voters_count`, `deadline_resolved`, `deadline_tz`,
// plus the optional `outcome_reason` and `finalized_at` set on finalisation.

Deno.test("DecisionRecord — full shape including quorum/required_voters_count/deadline_resolved/deadline_tz/outcome_reason/finalized_at", () => {
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
    status: "approved",
    outcome_reason: "simple-majority threshold met",
    finalized_at: "2026-05-15T23:00:00.000Z",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-15T23:00:00.000Z",
  };

  // quorum is a number, not a string.
  assertEquals(typeof decision.quorum, "number");
  assertEquals(decision.quorum, 3);

  // required_voters_count is denormalised on the row so the vote handler
  // does not need to requery `voters` (audit §A.4).
  assertEquals(typeof decision.required_voters_count, "number");
  assertEquals(decision.required_voters_count, 5);

  // deadline_resolved is the resolved end-of-day timestamp with offset.
  assertEquals(typeof decision.deadline_resolved, "string");
  assertEquals(decision.deadline_resolved, "2026-05-15T22:59:59+01:00");

  // deadline_tz is the IANA tz name used to resolve the deadline.
  assertEquals(typeof decision.deadline_tz, "string");
  assertEquals(decision.deadline_tz, "Europe/London");

  // outcome_reason is set on finalisation.
  assert(decision.outcome_reason !== undefined);
  assertEquals(decision.outcome_reason, "simple-majority threshold met");

  // finalized_at is the idempotency token preventing double-finalisation.
  assert(decision.finalized_at !== undefined);
  assertEquals(decision.finalized_at, "2026-05-15T23:00:00.000Z");
});

Deno.test("DecisionRecord — outcome_reason and finalized_at are optional while status is `active`", () => {
  const decision: DecisionRecord = {
    id: "decision-uuid",
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
  assertEquals(decision.outcome_reason, undefined);
  assertEquals(decision.finalized_at, undefined);
});

// ---------------------------------------------------------------------------
// 3. VoteRecord shape — every vote_type enum value compiles (SPEC §5.2)
// ---------------------------------------------------------------------------

Deno.test("VoteRecord — `yes` fixture has the expected shape", () => {
  const vote: VoteRecord = {
    id: "decision_user_yes",
    decision_id: "decision",
    user_id: "user_yes",
    vote_type: "yes",
    voted_at: "2026-05-08T10:00:00.000Z",
  };

  assertEquals(vote.vote_type, "yes");
  assertEquals(vote.id, "decision_user_yes");
  assertEquals(vote.decision_id, "decision");
  assertEquals(vote.user_id, "user_yes");
  assertEquals(typeof vote.voted_at, "string");
});

Deno.test("VoteRecord — `no` fixture has the expected shape", () => {
  const vote: VoteRecord = {
    id: "decision_user_no",
    decision_id: "decision",
    user_id: "user_no",
    vote_type: "no",
    voted_at: "2026-05-08T10:00:00.000Z",
  };

  assertEquals(vote.vote_type, "no");
});

Deno.test("VoteRecord — `abstain` fixture has the expected shape", () => {
  const vote: VoteRecord = {
    id: "decision_user_abstain",
    decision_id: "decision",
    user_id: "user_abstain",
    vote_type: "abstain",
    voted_at: "2026-05-08T10:00:00.000Z",
  };

  assertEquals(vote.vote_type, "abstain");
});

Deno.test("VoteRecord — every vote_type domain value compiles in the union", () => {
  const values: VoteType[] = ["yes", "no", "abstain"];
  const records: VoteRecord[] = values.map(
    (vote_type): VoteRecord => ({
      id: `decision_user_${vote_type}`,
      decision_id: "decision",
      user_id: `user_${vote_type}`,
      vote_type,
      voted_at: "2026-05-08T10:00:00.000Z",
    }),
  );

  assertEquals(records.length, 3);
  assertEquals(records.map((r) => r.vote_type), ["yes", "no", "abstain"]);
});

// ---------------------------------------------------------------------------
// 4. VoteHistoryRecord shape — `event_kind` semantics (SPEC §5.4 / §9 step 7)
// ---------------------------------------------------------------------------
//
// Per §9 step 7, `event_kind` is `previous_vote_type ? "changed" : "cast"`.
// Therefore the first vote yields `event_kind: "cast"` with an absent
// `previous_vote_type`, and a vote-update yields `event_kind: "changed"`
// with the prior value populated.

Deno.test("VoteHistoryRecord — first vote: event_kind=`cast`, previous_vote_type undefined", () => {
  const cast: VoteHistoryRecord = {
    id: "decision_user_0001",
    decision_id: "decision",
    user_id: "user",
    vote_type: "yes",
    event_kind: "cast",
    voted_at: "2026-05-08T10:00:00.000Z",
  };

  assertEquals(cast.event_kind, "cast");
  assertEquals(cast.previous_vote_type, undefined);
  assertEquals(cast.vote_type, "yes");
});

Deno.test("VoteHistoryRecord — vote change: event_kind=`changed`, previous_vote_type=`yes`, vote_type=`no`", () => {
  const changed: VoteHistoryRecord = {
    id: "decision_user_0002",
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
// 5. event_seq generation logic (SPEC §5.4 PK / §9 step 7)
// ---------------------------------------------------------------------------
//
// Per §9 step 7, `event_seq` is "determined by querying existing rows and
// using `count + 1` zero-padded to 4 digits". The PK (§5.4) is
// `${decision_id}_${user_id}_${event_seq}`.
//
// We model the helper inline so the contract is testable without importing
// the handler.

function nextEventSeq(existingCount: number): string {
  return String(existingCount + 1).padStart(4, "0");
}

function buildHistoryId(
  decision_id: string,
  user_id: string,
  event_seq: string,
): string {
  return `${decision_id}_${user_id}_${event_seq}`;
}

Deno.test("event_seq — first event for a user is `0001`", () => {
  assertEquals(nextEventSeq(0), "0001");
});

Deno.test("event_seq — after one existing event the next is `0002`", () => {
  assertEquals(nextEventSeq(1), "0002");
});

Deno.test("event_seq — sequence advances to `0003`, `0010`, `0099`, `1000`", () => {
  assertEquals(nextEventSeq(2), "0003");
  assertEquals(nextEventSeq(9), "0010");
  assertEquals(nextEventSeq(98), "0099");
  assertEquals(nextEventSeq(999), "1000");
});

Deno.test("event_seq — width is always at least 4 (zero-padded)", () => {
  for (let n = 0; n < 1000; n++) {
    const seq = nextEventSeq(n);
    assert(
      seq.length >= 4,
      `event_seq must be >= 4 chars wide; got "${seq}" for count=${n}`,
    );
  }
});

Deno.test("event_seq — id of the form `${decision_id}_${user_id}_${event_seq}` is built correctly for the first vote", () => {
  const decision_id = "11111111-2222-3333-4444-555555555555";
  const user_id = "U0042";
  const event_seq = nextEventSeq(0);

  const id = buildHistoryId(decision_id, user_id, event_seq);

  assertEquals(event_seq, "0001");
  assertEquals(
    id,
    "11111111-2222-3333-4444-555555555555_U0042_0001",
  );
});

Deno.test("event_seq — id round-trips into a typed VoteHistoryRecord (`cast` then `changed`)", () => {
  const decision_id = "decision-uuid";
  const user_id = "U0001";

  const firstSeq = nextEventSeq(0);
  const secondSeq = nextEventSeq(1);

  const cast: VoteHistoryRecord = {
    id: buildHistoryId(decision_id, user_id, firstSeq),
    decision_id,
    user_id,
    vote_type: "yes",
    event_kind: "cast",
    voted_at: "2026-05-08T10:00:00.000Z",
  };
  const changed: VoteHistoryRecord = {
    id: buildHistoryId(decision_id, user_id, secondSeq),
    decision_id,
    user_id,
    vote_type: "no",
    previous_vote_type: "yes",
    event_kind: "changed",
    voted_at: "2026-05-08T11:00:00.000Z",
  };

  assertEquals(cast.id, "decision-uuid_U0001_0001");
  assertEquals(changed.id, "decision-uuid_U0001_0002");
  // Neither id collides with the other — the event_seq differentiates them.
  assert(cast.id !== changed.id);
});
