/**
 * Tests for decision_logic utility
 *
 * Tests decision outcome calculations with the unified VoteRecord type
 */

import { assertEquals } from "@std/assert";
import {
  calculateDecisionOutcome,
  calculateSimpleMajority,
  calculateSupermajority,
  calculateUnanimity,
  calculateVoteCounts,
} from "../utils/decision_logic.ts";
import { VoteRecord } from "../types/decision_types.ts";

Deno.test("decision_logic - calculateVoteCounts with VoteRecord type", () => {
  const votes: VoteRecord[] = [
    {
      id: "d1_u1",
      decision_id: "d1",
      user_id: "u1",
      vote_type: "yes",
      voted_at: "2026-02-01T12:00:00.000Z",
    },
    {
      id: "d1_u2",
      decision_id: "d1",
      user_id: "u2",
      vote_type: "yes",
      voted_at: "2026-02-01T12:01:00.000Z",
    },
    {
      id: "d1_u3",
      decision_id: "d1",
      user_id: "u3",
      vote_type: "no",
      voted_at: "2026-02-01T12:02:00.000Z",
    },
    {
      id: "d1_u4",
      decision_id: "d1",
      user_id: "u4",
      vote_type: "abstain",
      voted_at: "2026-02-01T12:03:00.000Z",
    },
  ];

  const counts = calculateVoteCounts(votes);

  assertEquals(counts.yes, 2);
  assertEquals(counts.no, 1);
  assertEquals(counts.abstain, 1);
  assertEquals(counts.total, 4);
});

Deno.test("decision_logic - simple majority passes with >50% yes", () => {
  const votes: VoteRecord[] = [
    {
      id: "d1_u1",
      decision_id: "d1",
      user_id: "u1",
      vote_type: "yes",
      voted_at: "2026-02-01T12:00:00.000Z",
    },
    {
      id: "d1_u2",
      decision_id: "d1",
      user_id: "u2",
      vote_type: "yes",
      voted_at: "2026-02-01T12:01:00.000Z",
    },
    {
      id: "d1_u3",
      decision_id: "d1",
      user_id: "u3",
      vote_type: "no",
      voted_at: "2026-02-01T12:02:00.000Z",
    },
  ];

  const counts = calculateVoteCounts(votes);
  const result = calculateSimpleMajority(counts);

  assertEquals(result.passed, true);
  assertEquals(result.voteCounts.yes, 2);
  assertEquals(result.voteCounts.total, 3);
});

Deno.test("decision_logic - supermajority requires 66% yes votes", () => {
  const votes: VoteRecord[] = [
    {
      id: "d1_u1",
      decision_id: "d1",
      user_id: "u1",
      vote_type: "yes",
      voted_at: "2026-02-01T12:00:00.000Z",
    },
    {
      id: "d1_u2",
      decision_id: "d1",
      user_id: "u2",
      vote_type: "yes",
      voted_at: "2026-02-01T12:01:00.000Z",
    },
    {
      id: "d1_u3",
      decision_id: "d1",
      user_id: "u3",
      vote_type: "no",
      voted_at: "2026-02-01T12:02:00.000Z",
    },
  ];

  const counts = calculateVoteCounts(votes);
  const result = calculateSupermajority(counts, 3);

  assertEquals(result.passed, true); // 2/3 = 66.67%
  assertEquals(result.voteCounts.yes, 2);
  assertEquals(result.requiredVotersCount, 3);
});

Deno.test("decision_logic - unanimity requires all yes (no votes)", () => {
  const votes: VoteRecord[] = [
    {
      id: "d1_u1",
      decision_id: "d1",
      user_id: "u1",
      vote_type: "yes",
      voted_at: "2026-02-01T12:00:00.000Z",
    },
    {
      id: "d1_u2",
      decision_id: "d1",
      user_id: "u2",
      vote_type: "yes",
      voted_at: "2026-02-01T12:01:00.000Z",
    },
    {
      id: "d1_u3",
      decision_id: "d1",
      user_id: "u3",
      vote_type: "abstain",
      voted_at: "2026-02-01T12:02:00.000Z",
    },
  ];

  const counts = calculateVoteCounts(votes);
  const result = calculateUnanimity(counts, 3);

  assertEquals(result.passed, true); // All non-abstain votes are yes
  assertEquals(result.voteCounts.yes, 2);
  assertEquals(result.voteCounts.no, 0);
});

Deno.test("decision_logic - calculateDecisionOutcome with simple_majority", () => {
  const votes: VoteRecord[] = [
    {
      id: "d1_u1",
      decision_id: "d1",
      user_id: "u1",
      vote_type: "yes",
      voted_at: "2026-02-01T12:00:00.000Z",
    },
    {
      id: "d1_u2",
      decision_id: "d1",
      user_id: "u2",
      vote_type: "no",
      voted_at: "2026-02-01T12:01:00.000Z",
    },
    {
      id: "d1_u3",
      decision_id: "d1",
      user_id: "u3",
      vote_type: "no",
      voted_at: "2026-02-01T12:02:00.000Z",
    },
  ];

  const result = calculateDecisionOutcome(votes, "simple_majority", 3);

  assertEquals(result.passed, false); // Only 1/3 = 33.33% yes
  assertEquals(result.voteCounts.yes, 1);
  assertEquals(result.voteCounts.no, 2);
});

Deno.test("decision_logic - calculateDecisionOutcome with super_majority", () => {
  const votes: VoteRecord[] = [
    {
      id: "d1_u1",
      decision_id: "d1",
      user_id: "u1",
      vote_type: "yes",
      voted_at: "2026-02-01T12:00:00.000Z",
    },
    {
      id: "d1_u2",
      decision_id: "d1",
      user_id: "u2",
      vote_type: "yes",
      voted_at: "2026-02-01T12:01:00.000Z",
    },
    {
      id: "d1_u3",
      decision_id: "d1",
      user_id: "u3",
      vote_type: "yes",
      voted_at: "2026-02-01T12:02:00.000Z",
    },
  ];

  const result = calculateDecisionOutcome(votes, "super_majority", 3);

  assertEquals(result.passed, true); // 3/3 = 100% >= 66%
  assertEquals(result.voteCounts.yes, 3);
});

Deno.test("decision_logic - calculateDecisionOutcome with unanimous", () => {
  const votes: VoteRecord[] = [
    {
      id: "d1_u1",
      decision_id: "d1",
      user_id: "u1",
      vote_type: "yes",
      voted_at: "2026-02-01T12:00:00.000Z",
    },
    {
      id: "d1_u2",
      decision_id: "d1",
      user_id: "u2",
      vote_type: "no",
      voted_at: "2026-02-01T12:01:00.000Z",
    },
  ];

  const result = calculateDecisionOutcome(votes, "unanimous", 2);

  assertEquals(result.passed, false); // Has a no vote
  assertEquals(result.voteCounts.no, 1);
});
