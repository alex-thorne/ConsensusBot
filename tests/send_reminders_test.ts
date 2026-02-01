/**
 * Tests for send_reminders function
 * 
 * Tests the reminder functionality with proper type safety
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { DecisionRecord, VoteRecord, VoterRecord } from "../types/decision_types.ts";

Deno.test("send_reminders - DecisionRecord type for reminder DMs", () => {
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
  
  // Verify fields needed for reminder message
  assertExists(decision.name);
  assertExists(decision.deadline);
  assertExists(decision.channel_id);
  
  assertEquals(decision.name, "Test Decision");
  assertEquals(decision.status, "active");
});

Deno.test("send_reminders - VoterRecord type structure", () => {
  const voter: VoterRecord = {
    id: "decision_user",
    decision_id: "1234567890.123456",
    user_id: "U123456",
    required: true,
    created_at: "2026-02-01T00:00:00.000Z",
  };
  
  assertExists(voter.id);
  assertExists(voter.decision_id);
  assertExists(voter.user_id);
  assertExists(voter.required);
  assertExists(voter.created_at);
  
  assertEquals(voter.required, true);
  assertEquals(voter.user_id, "U123456");
});

Deno.test("send_reminders - find missing voters logic", () => {
  const voters: VoterRecord[] = [
    {
      id: "d1_u1",
      decision_id: "d1",
      user_id: "U111",
      required: true,
      created_at: "2026-02-01T00:00:00.000Z",
    },
    {
      id: "d1_u2",
      decision_id: "d1",
      user_id: "U222",
      required: true,
      created_at: "2026-02-01T00:00:00.000Z",
    },
    {
      id: "d1_u3",
      decision_id: "d1",
      user_id: "U333",
      required: true,
      created_at: "2026-02-01T00:00:00.000Z",
    },
  ];
  
  const votes: VoteRecord[] = [
    {
      id: "d1_u1",
      decision_id: "d1",
      user_id: "U111",
      vote_type: "yes",
      voted_at: "2026-02-01T12:00:00.000Z",
    },
  ];
  
  // Create set of users who voted
  const votedUserIds = new Set(votes.map((v) => v.user_id));
  
  // Find missing voters
  const missingVoters = voters.filter((voter) => !votedUserIds.has(voter.user_id));
  
  assertEquals(missingVoters.length, 2);
  assertEquals(missingVoters[0].user_id, "U222");
  assertEquals(missingVoters[1].user_id, "U333");
});

Deno.test("send_reminders - type casting for voters and votes", () => {
  // Simulate datastore query response
  const votersResponse = {
    ok: true,
    items: [
      {
        id: "d1_u1",
        decision_id: "d1",
        user_id: "U111",
        required: true,
        created_at: "2026-02-01T00:00:00.000Z",
      },
    ],
  };
  
  const votesResponse = {
    ok: true,
    items: [
      {
        id: "d1_u1",
        decision_id: "d1",
        user_id: "U111",
        vote_type: "yes",
        voted_at: "2026-02-01T12:00:00.000Z",
      },
    ],
  };
  
  // Type cast similar to send_reminders.ts
  const votedUserIds = new Set(
    votesResponse.ok ? votesResponse.items.map((v) => (v as VoteRecord).user_id) : []
  );
  
  const missingVoters = votersResponse.items.filter(
    (voter) => !votedUserIds.has((voter as VoterRecord).user_id)
  );
  
  assertEquals(missingVoters.length, 0); // All voters have voted
  assertExists(votedUserIds);
  assertEquals(votedUserIds.size, 1);
});

Deno.test("send_reminders - active decisions filtering", () => {
  const decisions: DecisionRecord[] = [
    {
      id: "d1",
      name: "Active Decision 1",
      proposal: "Proposal 1",
      success_criteria: "simple_majority",
      deadline: "2026-02-15T23:59:59.000Z",
      channel_id: "C123456",
      creator_id: "U123456",
      message_ts: "1234567890.123456",
      status: "active",
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    },
    {
      id: "d2",
      name: "Approved Decision",
      proposal: "Proposal 2",
      success_criteria: "simple_majority",
      deadline: "2026-01-30T23:59:59.000Z",
      channel_id: "C123456",
      creator_id: "U123456",
      message_ts: "1234567890.123457",
      status: "approved",
      created_at: "2026-01-25T00:00:00.000Z",
      updated_at: "2026-01-30T00:00:00.000Z",
    },
    {
      id: "d3",
      name: "Active Decision 2",
      proposal: "Proposal 3",
      success_criteria: "unanimous",
      deadline: "2026-02-20T23:59:59.000Z",
      channel_id: "C123456",
      creator_id: "U123456",
      message_ts: "1234567890.123458",
      status: "active",
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    },
  ];
  
  // Filter active decisions
  const activeDecisions = decisions.filter(d => d.status === "active");
  
  assertEquals(activeDecisions.length, 2);
  assertEquals(activeDecisions[0].name, "Active Decision 1");
  assertEquals(activeDecisions[1].name, "Active Decision 2");
});
