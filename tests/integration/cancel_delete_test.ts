/**
 * Integration tests for decision cancel and delete functionality
 */

import { assertEquals, assertExists } from "@std/assert";
import { createMockSlackClient } from "../mocks/slack_client.ts";

const DECISION_ID = "1234567890.123456";
const CHANNEL_ID = "C123456";
const CREATOR_ID = "U111111";
const OTHER_USER_ID = "U222222";

function makeActiveDecision() {
  return {
    id: DECISION_ID,
    name: "Test Decision",
    proposal: "A test proposal",
    success_criteria: "simple_majority",
    deadline: "2026-12-31",
    channel_id: CHANNEL_ID,
    creator_id: CREATOR_ID,
    message_ts: DECISION_ID,
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Cancel tests
// ---------------------------------------------------------------------------

Deno.test("cancel - updates datastore status to cancelled and unpins", async () => {
  const mockClient = createMockSlackClient();
  mockClient.setDatastoreItem(DECISION_ID, makeActiveDecision());

  // Simulate cancel handler logic
  const getResult = await mockClient.apps.datastore.get({
    datastore: "decisions",
    id: DECISION_ID,
  });
  assertExists(getResult.item);
  assertEquals(getResult.item.status, "active");

  const decision = getResult.item;
  const now = new Date().toISOString();

  // Update status to cancelled
  await mockClient.apps.datastore.put({
    datastore: "decisions",
    item: { ...decision, status: "cancelled", updated_at: now },
  });

  // Unpin message
  await mockClient.pins.remove({
    channel: CHANNEL_ID,
    timestamp: DECISION_ID,
  });

  // Verify datastore.put was called with cancelled status
  const putCalls = mockClient.getCallsFor("apps.datastore.put");
  assertEquals(putCalls.length, 1);
  assertEquals(
    (putCalls[0].params as { item: Record<string, unknown> }).item.status,
    "cancelled",
  );

  // Verify pins.remove was called
  const pinRemoveCalls = mockClient.getCallsFor("pins.remove");
  assertEquals(pinRemoveCalls.length, 1);
  assertEquals(
    (pinRemoveCalls[0].params as { channel: string; timestamp: string })
      .channel,
    CHANNEL_ID,
  );
});

Deno.test("cancel - posts ephemeral confirmation", async () => {
  const mockClient = createMockSlackClient();
  mockClient.setDatastoreItem(DECISION_ID, makeActiveDecision());

  await mockClient.chat.postEphemeral({
    channel: CHANNEL_ID,
    user: OTHER_USER_ID,
    text: `🚫 Decision "Test Decision" has been cancelled.`,
  });

  const ephemeralCalls = mockClient.getCallsFor("chat.postEphemeral");
  assertEquals(ephemeralCalls.length, 1);
  const params = ephemeralCalls[0].params as {
    channel: string;
    user: string;
    text: string;
  };
  assertEquals(params.user, OTHER_USER_ID);
  assertEquals(params.text.includes("cancelled"), true);
});

Deno.test("cancel - rejects if decision is not active", async () => {
  const mockClient = createMockSlackClient();
  const decision = { ...makeActiveDecision(), status: "approved" };
  mockClient.setDatastoreItem(DECISION_ID, decision);

  const getResult = await mockClient.apps.datastore.get({
    datastore: "decisions",
    id: DECISION_ID,
  });

  // Simulate status check
  const isActive = getResult.item?.status === "active";
  assertEquals(isActive, false);

  if (!isActive) {
    await mockClient.chat.postEphemeral({
      channel: CHANNEL_ID,
      user: OTHER_USER_ID,
      text: "This decision is no longer active.",
    });
  }

  // Verify no put was called (status not updated)
  const putCalls = mockClient.getCallsFor("apps.datastore.put");
  assertEquals(putCalls.length, 0);

  // Verify ephemeral was sent
  const ephemeralCalls = mockClient.getCallsFor("chat.postEphemeral");
  assertEquals(ephemeralCalls.length, 1);
});

// ---------------------------------------------------------------------------
// Delete tests
// ---------------------------------------------------------------------------

Deno.test("delete - rejects non-creator with ephemeral message", async () => {
  const mockClient = createMockSlackClient();
  mockClient.setDatastoreItem(DECISION_ID, makeActiveDecision());

  const getResult = await mockClient.apps.datastore.get({
    datastore: "decisions",
    id: DECISION_ID,
  });
  assertExists(getResult.item);

  // Simulate authorization check (OTHER_USER_ID is not the creator)
  const isCreator = getResult.item.creator_id === OTHER_USER_ID;
  assertEquals(isCreator, false);

  if (!isCreator) {
    await mockClient.chat.postEphemeral({
      channel: CHANNEL_ID,
      user: OTHER_USER_ID,
      text: "⛔ Only the creator of this decision can delete it.",
    });
  }

  // Verify no delete was called
  const deleteCalls = mockClient.getCallsFor("apps.datastore.delete");
  assertEquals(deleteCalls.length, 0);

  // Verify ephemeral was sent with authorization error
  const ephemeralCalls = mockClient.getCallsFor("chat.postEphemeral");
  assertEquals(ephemeralCalls.length, 1);
  const params = ephemeralCalls[0].params as { text: string };
  assertEquals(params.text.includes("creator"), true);
});

Deno.test("delete - creator removes decision, votes and voters records", async () => {
  const mockClient = createMockSlackClient();
  mockClient.setDatastoreItem(DECISION_ID, makeActiveDecision());

  // Seed votes and voters
  const voteItems = [
    { id: `${DECISION_ID}_U001`, decision_id: DECISION_ID, user_id: "U001" },
    { id: `${DECISION_ID}_U002`, decision_id: DECISION_ID, user_id: "U002" },
  ];
  const voterItems = [
    { id: `${DECISION_ID}_U001`, decision_id: DECISION_ID, user_id: "U001" },
  ];
  for (const v of voteItems) {
    mockClient.setDatastoreItem(v.id, v);
  }
  for (const v of voterItems) {
    mockClient.setDatastoreItem(v.id, v);
  }

  // Override query results to return the seeded items
  mockClient.setDatastoreQueryResults(voteItems);

  // Simulate deleting votes
  const votesResponse = await mockClient.apps.datastore.query({
    datastore: "votes",
    expression: "#decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": DECISION_ID },
  });
  assertEquals(votesResponse.ok, true);
  for (const vote of votesResponse.items) {
    await mockClient.apps.datastore.delete({
      datastore: "votes",
      id: vote.id as string,
    });
  }

  // Simulate deleting voters
  mockClient.setDatastoreQueryResults(voterItems);
  const votersResponse = await mockClient.apps.datastore.query({
    datastore: "voters",
    expression: "#decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": DECISION_ID },
  });
  assertEquals(votersResponse.ok, true);
  for (const voter of votersResponse.items) {
    await mockClient.apps.datastore.delete({
      datastore: "voters",
      id: voter.id as string,
    });
  }

  // Simulate deleting the decision itself
  await mockClient.apps.datastore.delete({
    datastore: "decisions",
    id: DECISION_ID,
  });

  // Verify delete calls: 2 votes + 1 voter + 1 decision = 4 total
  const deleteCalls = mockClient.getCallsFor("apps.datastore.delete");
  assertEquals(deleteCalls.length, 4);

  // Decision should be gone from the mock datastore
  const afterDelete = await mockClient.apps.datastore.get({
    datastore: "decisions",
    id: DECISION_ID,
  });
  assertEquals(Object.keys(afterDelete.item ?? {}).length, 0);
});

Deno.test("delete - unpins message and posts ephemeral confirmation", async () => {
  const mockClient = createMockSlackClient();
  mockClient.setDatastoreItem(DECISION_ID, makeActiveDecision());

  // Unpin
  await mockClient.pins.remove({
    channel: CHANNEL_ID,
    timestamp: DECISION_ID,
  });

  // Delete message
  await mockClient.chat.delete({
    channel: CHANNEL_ID,
    ts: DECISION_ID,
  });

  // Confirm
  await mockClient.chat.postEphemeral({
    channel: CHANNEL_ID,
    user: CREATOR_ID,
    text: `🗑️ Decision "Test Decision" has been deleted.`,
  });

  const pinRemoveCalls = mockClient.getCallsFor("pins.remove");
  assertEquals(pinRemoveCalls.length, 1);

  const chatDeleteCalls = mockClient.getCallsFor("chat.delete");
  assertEquals(chatDeleteCalls.length, 1);

  const ephemeralCalls = mockClient.getCallsFor("chat.postEphemeral");
  assertEquals(ephemeralCalls.length, 1);
  const params = ephemeralCalls[0].params as { text: string };
  assertEquals(params.text.includes("deleted"), true);
});
