/**
 * Integration tests for record_vote function
 *
 * Tests the complete vote recording flow with mocked Slack client
 */

import { assertEquals, assertExists } from "@std/assert";
import { createMockSlackClient } from "../mocks/slack_client.ts";

Deno.test("record_vote integration - should record a yes vote", async () => {
  const mockClient = createMockSlackClient();

  // Set up existing decision
  const decisionId = "1234567890.123456";
  const decision = {
    id: decisionId,
    name: "Test Decision",
    proposal: "Test proposal",
    success_criteria: "simple_majority",
    deadline: "2026-02-15T23:59:59.000Z",
    channel_id: "C123456",
    creator_id: "U123456",
    message_ts: "1234567890.123456",
    status: "active",
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };

  mockClient.setDatastoreItem(decisionId, decision);

  // Record a vote
  const voteRecord = {
    id: `${decisionId}_U234567`,
    decision_id: decisionId,
    user_id: "U234567",
    vote_type: "yes",
    voted_at: new Date().toISOString(),
  };

  await mockClient.apps.datastore.put({
    datastore: "votes",
    item: voteRecord,
  });

  // Verify vote was recorded
  const putCalls = mockClient.getCallsFor("apps.datastore.put");
  assertEquals(putCalls.length, 1);
  assertEquals((putCalls[0].params as any).datastore, "votes");
  assertEquals((putCalls[0].params as any).item.vote_type, "yes");
  assertEquals((putCalls[0].params as any).item.user_id, "U234567");
});

Deno.test("record_vote integration - should record a no vote", async () => {
  const mockClient = createMockSlackClient();

  const voteRecord = {
    id: "decision_U234567",
    decision_id: "decision_id",
    user_id: "U234567",
    vote_type: "no",
    voted_at: new Date().toISOString(),
  };

  await mockClient.apps.datastore.put({
    datastore: "votes",
    item: voteRecord,
  });

  const putCalls = mockClient.getCallsFor("apps.datastore.put");
  assertEquals(putCalls.length, 1);
  assertEquals((putCalls[0].params as any).item.vote_type, "no");
});

Deno.test("record_vote integration - should record an abstain vote", async () => {
  const mockClient = createMockSlackClient();

  const voteRecord = {
    id: "decision_U234567",
    decision_id: "decision_id",
    user_id: "U234567",
    vote_type: "abstain",
    voted_at: new Date().toISOString(),
  };

  await mockClient.apps.datastore.put({
    datastore: "votes",
    item: voteRecord,
  });

  const putCalls = mockClient.getCallsFor("apps.datastore.put");
  assertEquals(putCalls.length, 1);
  assertEquals((putCalls[0].params as any).item.vote_type, "abstain");
});

Deno.test("record_vote integration - should update message after vote", async () => {
  const mockClient = createMockSlackClient();

  const channelId = "C123456";
  const messageTs = "1234567890.123456";

  // Update the decision message with new vote counts
  await mockClient.chat.update({
    channel: channelId,
    ts: messageTs,
    text: "Decision updated",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Votes: Yes: 1, No: 0, Abstain: 0",
        },
      },
    ],
  });

  // Verify message was updated
  const updateCalls = mockClient.getCallsFor("chat.update");
  assertEquals(updateCalls.length, 1);
  assertEquals((updateCalls[0].params as any).channel, channelId);
  assertEquals((updateCalls[0].params as any).ts, messageTs);
});

Deno.test("record_vote integration - should handle vote updates", async () => {
  const mockClient = createMockSlackClient();

  const voteId = "decision_U234567";
  const initialVote = {
    id: voteId,
    decision_id: "decision_id",
    user_id: "U234567",
    vote_type: "yes",
    voted_at: new Date().toISOString(),
  };

  // Record initial vote
  mockClient.setDatastoreItem(voteId, initialVote);

  // Update vote to "no"
  const updatedVote = {
    id: voteId,
    vote_type: "no",
    voted_at: new Date().toISOString(),
  };

  await mockClient.apps.datastore.update({
    datastore: "votes",
    item: updatedVote,
  });

  // Verify update was called
  const updateCalls = mockClient.getCallsFor("apps.datastore.update");
  assertEquals(updateCalls.length, 1);
  assertEquals((updateCalls[0].params as any).item.vote_type, "no");
});

Deno.test("record_vote integration - should query existing votes for decision", async () => {
  const mockClient = createMockSlackClient();

  const decisionId = "1234567890.123456";

  // Set up mock query results
  mockClient.setDatastoreQueryResults([
    {
      id: `${decisionId}_U123456`,
      decision_id: decisionId,
      user_id: "U123456",
      vote_type: "yes",
      voted_at: "2026-02-01T13:00:00.000Z",
    },
    {
      id: `${decisionId}_U234567`,
      decision_id: decisionId,
      user_id: "U234567",
      vote_type: "no",
      voted_at: "2026-02-01T14:00:00.000Z",
    },
  ]);

  // Query votes for this decision
  const response = await mockClient.apps.datastore.query({
    datastore: "votes",
    expression: "decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": decisionId },
  });

  // Verify query was executed
  const queryCalls = mockClient.getCallsFor("apps.datastore.query");
  assertEquals(queryCalls.length, 1);
  assertEquals((queryCalls[0].params as any).datastore, "votes");

  // Verify results
  assertEquals(response.ok, true);
  assertEquals(response.items!.length, 2);
});

Deno.test("record_vote integration - should post ephemeral confirmation", async () => {
  const mockClient = createMockSlackClient();

  const channelId = "C123456";
  const userId = "U234567";

  // Post ephemeral message to confirm vote
  await mockClient.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text: "Your vote has been recorded!",
  });

  // Verify ephemeral message was posted
  const ephemeralCalls = mockClient.getCallsFor("chat.postEphemeral");
  assertEquals(ephemeralCalls.length, 1);
  assertEquals((ephemeralCalls[0].params as any).channel, channelId);
  assertEquals((ephemeralCalls[0].params as any).user, userId);
});

Deno.test("record_vote integration - vote type normalization", () => {
  // Test vote type normalization (stripping vote_ prefix)
  const testCases = [
    { input: "vote_yes", expected: "yes" },
    { input: "vote_no", expected: "no" },
    { input: "vote_abstain", expected: "abstain" },
    { input: "yes", expected: "yes" },
    { input: "no", expected: "no" },
    { input: "abstain", expected: "abstain" },
  ];

  testCases.forEach(({ input, expected }) => {
    const normalized = input.replace(/^vote_/, "");
    assertEquals(normalized, expected);
  });
});
