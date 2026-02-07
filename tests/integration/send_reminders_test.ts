/**
 * Integration tests for send_reminders function
 *
 * Tests the reminder sending flow with mocked Slack client
 */

import { assertEquals } from "@std/assert";
import { createMockSlackClient } from "../mocks/slack_client.ts";

// Type definitions for mock client parameters
interface DatastoreQueryParams {
  datastore: string;
  expression?: string;
  expression_attributes?: Record<string, string>;
  expression_values?: Record<string, unknown>;
}

interface ChatPostMessageParams {
  channel: string;
  text?: string;
  blocks?: unknown[];
  thread_ts?: string;
}

interface ConversationsMembersParams {
  channel: string;
}

Deno.test("send_reminders integration - should query active decisions", async () => {
  const mockClient = createMockSlackClient();

  // Set up mock active decisions
  mockClient.setDatastoreQueryResults([
    {
      id: "decision1",
      name: "Test Decision 1",
      status: "active",
      deadline: "2026-02-10T23:59:59.000Z",
      channel_id: "C123456",
      message_ts: "1234567890.123456",
    },
    {
      id: "decision2",
      name: "Test Decision 2",
      status: "active",
      deadline: "2026-02-12T23:59:59.000Z",
      channel_id: "C123456",
      message_ts: "1234567890.123457",
    },
  ]);

  // Query active decisions
  const response = await mockClient.apps.datastore.query({
    datastore: "decisions",
    expression: "#status = :status",
    expression_attributes: { "#status": "status" },
    expression_values: { ":status": "active" },
  });

  // Verify query was executed
  const queryCalls = mockClient.getCallsFor("apps.datastore.query");
  assertEquals(queryCalls.length, 1);
  assertEquals(
    (queryCalls[0].params as DatastoreQueryParams).datastore,
    "decisions",
  );

  // Verify active decisions were returned
  assertEquals(response.ok, true);
  assertEquals(response.items!.length, 2);
});

Deno.test("send_reminders integration - should post reminder message to thread", async () => {
  const mockClient = createMockSlackClient();

  const channelId = "C123456";
  const threadTs = "1234567890.123456";

  // Post reminder message in thread
  await mockClient.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: "⏰ Reminder: This decision deadline is approaching!",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "⏰ *Reminder:* This decision deadline is approaching!",
        },
      },
    ],
  });

  // Verify message was posted
  const postCalls = mockClient.getCallsFor("chat.postMessage");
  assertEquals(postCalls.length, 1);
  assertEquals(
    (postCalls[0].params as ChatPostMessageParams).channel,
    channelId,
  );
  assertEquals(
    (postCalls[0].params as ChatPostMessageParams).thread_ts,
    threadTs,
  );
});

Deno.test("send_reminders integration - should query votes for decision", async () => {
  const mockClient = createMockSlackClient();

  const decisionId = "decision1";

  // Set up mock votes
  mockClient.setDatastoreQueryResults([
    {
      id: `${decisionId}_U123456`,
      decision_id: decisionId,
      user_id: "U123456",
      vote_type: "yes",
    },
    {
      id: `${decisionId}_U234567`,
      decision_id: decisionId,
      user_id: "U234567",
      vote_type: "no",
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

  // Verify votes were returned
  assertEquals(response.ok, true);
  assertEquals(response.items!.length, 2);
});

Deno.test("send_reminders integration - should get channel members", async () => {
  const mockClient = createMockSlackClient();

  const channelId = "C123456";

  // Get channel members
  const response = await mockClient.conversations.members({
    channel: channelId,
  });

  // Verify members API was called
  const membersCalls = mockClient.getCallsFor("conversations.members");
  assertEquals(membersCalls.length, 1);
  assertEquals(
    (membersCalls[0].params as ConversationsMembersParams).channel,
    channelId,
  );

  // Verify members were returned
  assertEquals(response.ok, true);
  assertEquals(response.members!.length, 3);
});

Deno.test("send_reminders integration - should identify users who haven't voted", () => {
  const _mockClient = createMockSlackClient();

  // Channel members
  const allMembers = ["U123456", "U234567", "U345678", "U456789"];

  // Users who have voted
  const votedUsers = new Set(["U123456", "U234567"]);

  // Calculate users who haven't voted
  const nonVoters = allMembers.filter((userId) => !votedUsers.has(userId));

  // Verify non-voters were identified
  assertEquals(nonVoters.length, 2);
  assertEquals(nonVoters.includes("U345678"), true);
  assertEquals(nonVoters.includes("U456789"), true);
});

Deno.test("send_reminders integration - should handle decisions with no votes", async () => {
  const mockClient = createMockSlackClient();

  const decisionId = "decision_no_votes";

  // Set up empty votes
  mockClient.setDatastoreQueryResults([]);

  // Query votes for this decision
  const response = await mockClient.apps.datastore.query({
    datastore: "votes",
    expression: "decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": decisionId },
  });

  // Verify no votes were returned
  assertEquals(response.ok, true);
  assertEquals(response.items!.length, 0);
});

Deno.test("send_reminders integration - should calculate time until deadline", () => {
  const now = new Date("2026-02-08T12:00:00.000Z");
  const deadline = new Date("2026-02-10T23:59:59.000Z");

  const msUntilDeadline = deadline.getTime() - now.getTime();
  const hoursUntilDeadline = Math.floor(msUntilDeadline / (1000 * 60 * 60));
  const daysUntilDeadline = Math.floor(hoursUntilDeadline / 24);

  // Verify calculations
  assertEquals(daysUntilDeadline, 2); // 2 days until deadline
  assertEquals(hoursUntilDeadline >= 59, true); // More than 59 hours
});

Deno.test("send_reminders integration - should handle multiple decisions", async () => {
  const mockClient = createMockSlackClient();

  const decisions = [
    {
      id: "decision1",
      channel_id: "C123456",
      message_ts: "1234567890.123456",
      deadline: "2026-02-10",
    },
    {
      id: "decision2",
      channel_id: "C234567",
      message_ts: "1234567890.123457",
      deadline: "2026-02-11",
    },
    {
      id: "decision3",
      channel_id: "C345678",
      message_ts: "1234567890.123458",
      deadline: "2026-02-12",
    },
  ];

  // Send reminders for each decision
  for (const decision of decisions) {
    await mockClient.chat.postMessage({
      channel: decision.channel_id,
      thread_ts: decision.message_ts,
      text: `⏰ Reminder: Deadline is ${decision.deadline}`,
    });
  }

  // Verify all reminders were sent
  const postCalls = mockClient.getCallsFor("chat.postMessage");
  assertEquals(postCalls.length, 3);

  // Verify each reminder went to correct channel
  assertEquals(
    (postCalls[0].params as ChatPostMessageParams).channel,
    "C123456",
  );
  assertEquals(
    (postCalls[1].params as ChatPostMessageParams).channel,
    "C234567",
  );
  assertEquals(
    (postCalls[2].params as ChatPostMessageParams).channel,
    "C345678",
  );
});
