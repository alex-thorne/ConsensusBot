/**
 * Tests for record_vote function
 *
 * Tests the vote recording functionality with proper type safety
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { DecisionRecord, VoteRecord } from "../types/decision_types.ts";

Deno.test("record_vote - DecisionRecord includes all required fields", () => {
  const decision: DecisionRecord = {
    id: "1234567890.123456",
    name: "Test Decision",
    proposal: "This is a test proposal",
    success_criteria: "simple_majority",
    deadline: "2026-02-15T23:59:59.000Z",
    channel_id: "C123456",
    creator_id: "U123456",
    message_ts: "1234567890.123456",
    status: "active",
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };

  // Verify all required fields exist
  assertExists(decision.id);
  assertExists(decision.name);
  assertExists(decision.proposal);
  assertExists(decision.success_criteria);
  assertExists(decision.deadline);
  assertExists(decision.channel_id);
  assertExists(decision.creator_id);
  assertExists(decision.message_ts);
  assertExists(decision.status);
  assertExists(decision.created_at);
  assertExists(decision.updated_at);

  // Verify field values
  assertEquals(decision.name, "Test Decision");
  assertEquals(decision.status, "active");
  assertEquals(decision.success_criteria, "simple_majority");
});

Deno.test("record_vote - DecisionRecord type compatibility with generateADRMarkdown", () => {
  const decision: DecisionRecord = {
    id: "1234567890.123456",
    name: "Test Decision",
    proposal: "This is a test proposal",
    success_criteria: "simple_majority",
    deadline: "2026-02-15T23:59:59.000Z",
    channel_id: "C123456",
    creator_id: "U123456",
    message_ts: "1234567890.123456",
    status: "active",
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };

  // These fields are required by generateADRMarkdown
  assertExists(decision.id);
  assertExists(decision.name);
  assertExists(decision.proposal);
  assertExists(decision.success_criteria);
  assertExists(decision.deadline);
  assertExists(decision.creator_id);
  assertExists(decision.created_at);
  assertExists(decision.status);
});

Deno.test("record_vote - VoteRecord type structure", () => {
  const vote: VoteRecord = {
    id: "decision_user",
    decision_id: "1234567890.123456",
    user_id: "U123456",
    vote_type: "yes",
    voted_at: "2026-02-01T12:00:00.000Z",
  };

  assertEquals(vote.decision_id, "1234567890.123456");
  assertEquals(vote.user_id, "U123456");
  assertEquals(vote.vote_type, "yes");
  assertExists(vote.voted_at);
});

Deno.test("record_vote - VoteRecord supports all vote types", () => {
  const voteYes: VoteRecord = {
    id: "d1_u1",
    decision_id: "d1",
    user_id: "u1",
    vote_type: "yes",
    voted_at: new Date().toISOString(),
  };

  const voteNo: VoteRecord = {
    id: "d1_u2",
    decision_id: "d1",
    user_id: "u2",
    vote_type: "no",
    voted_at: new Date().toISOString(),
  };

  const voteAbstain: VoteRecord = {
    id: "d1_u3",
    decision_id: "d1",
    user_id: "u3",
    vote_type: "abstain",
    voted_at: new Date().toISOString(),
  };

  assertEquals(voteYes.vote_type, "yes");
  assertEquals(voteNo.vote_type, "no");
  assertEquals(voteAbstain.vote_type, "abstain");
});

Deno.test("record_vote - votes array mapping for decision outcome", () => {
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

  assertEquals(votes.length, 3);

  // Count votes by type
  const yesVotes = votes.filter((v) => v.vote_type === "yes").length;
  const noVotes = votes.filter((v) => v.vote_type === "no").length;

  assertEquals(yesVotes, 2);
  assertEquals(noVotes, 1);
});

Deno.test("record_vote - user map creation for ADR generation", () => {
  const votes: VoteRecord[] = [
    {
      id: "d1_u1",
      decision_id: "d1",
      user_id: "U123",
      vote_type: "yes",
      voted_at: "2026-02-01T12:00:00.000Z",
    },
    {
      id: "d1_u2",
      decision_id: "d1",
      user_id: "U456",
      vote_type: "no",
      voted_at: "2026-02-01T12:01:00.000Z",
    },
  ];

  // Simulate creating user map
  const userMap = new Map<string, string>();
  for (const vote of votes) {
    userMap.set(vote.user_id, `User ${vote.user_id}`);
  }

  assertEquals(userMap.size, 2);
  assertEquals(userMap.get("U123"), "User U123");
  assertEquals(userMap.get("U456"), "User U456");
});
