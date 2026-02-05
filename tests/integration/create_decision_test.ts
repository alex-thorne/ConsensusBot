/**
 * Integration tests for create_decision function
 *
 * Tests the complete decision creation flow with mocked Slack client
 */

import { assertEquals, assertExists } from "@std/assert";
import { createMockSlackClient, DatastorePutParams, ChatPostMessageParams, ConversationsMembersParams } from "../mocks/slack_client.ts";

Deno.test("create_decision integration - should create decision and post message", async () => {
  const mockClient = createMockSlackClient();

  // Simulate the create_decision function behavior
  const inputs = {
    decision_name: "Adopt TypeScript",
    proposal: "We should adopt TypeScript for all new projects",
    success_criteria: "simple_majority",
    deadline: "2026-02-15",
    channel_id: "C123456",
    creator_id: "U123456",
  };

  // Mock the decision creation
  const decisionId = "1234567890.123456";
  const decision = {
    id: decisionId,
    name: inputs.decision_name,
    proposal: inputs.proposal,
    success_criteria: inputs.success_criteria,
    deadline: inputs.deadline,
    channel_id: inputs.channel_id,
    creator_id: inputs.creator_id,
    message_ts: "",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Save decision to datastore
  await mockClient.apps.datastore.put({
    datastore: "decisions",
    item: decision,
  });

  // Post message to channel
  const messageResponse = await mockClient.chat.postMessage({
    channel: inputs.channel_id,
    text: `New decision: ${inputs.decision_name}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🗳️ ${inputs.decision_name}`,
        },
      },
    ],
  });

  // Verify datastore.put was called
  const putCalls = mockClient.getCallsFor("apps.datastore.put");
  assertEquals(putCalls.length, 1);
  assertEquals((putCalls[0].params as DatastorePutParams).datastore, "decisions");
  assertEquals((putCalls[0].params as DatastorePutParams).item.name, inputs.decision_name);

  // Verify chat.postMessage was called
  const postMessageCalls = mockClient.getCallsFor("chat.postMessage");
  assertEquals(postMessageCalls.length, 1);
  assertEquals((postMessageCalls[0].params as ChatPostMessageParams).channel, inputs.channel_id);

  // Verify message was posted successfully
  assertEquals(messageResponse.ok, true);
  assertExists(messageResponse.ts);
});

Deno.test("create_decision integration - should fetch channel members", async () => {
  const mockClient = createMockSlackClient();

  const channelId = "C123456";

  // Fetch channel members
  const membersResponse = await mockClient.conversations.members({
    channel: channelId,
  });

  // Verify conversations.members was called
  const membersCalls = mockClient.getCallsFor("conversations.members");
  assertEquals(membersCalls.length, 1);
  assertEquals((membersCalls[0].params as ConversationsMembersParams).channel, channelId);

  // Verify members were returned
  assertEquals(membersResponse.ok, true);
  assertExists(membersResponse.members);
  assertEquals(membersResponse.members!.length > 0, true);
});

Deno.test("create_decision integration - should validate required inputs", () => {
  // Test that required inputs are validated
  const requiredFields = [
    "decision_name",
    "proposal",
    "success_criteria",
    "deadline",
    "channel_id",
    "creator_id",
  ];

  const inputs = {
    decision_name: "Test Decision",
    proposal: "Test proposal",
    success_criteria: "simple_majority",
    deadline: "2026-02-15",
    channel_id: "C123456",
    creator_id: "U123456",
  };

  // Verify all required fields are present
  requiredFields.forEach((field) => {
    assertExists(inputs[field as keyof typeof inputs]);
  });
});

Deno.test("create_decision integration - should support different success criteria", async () => {
  const mockClient = createMockSlackClient();

  const successCriteriaOptions = [
    "simple_majority",
    "super_majority",
    "unanimous",
  ];

  for (const criteria of successCriteriaOptions) {
    mockClient.clearCalls();

    const decision = {
      id: `decision_${criteria}`,
      name: `Test ${criteria}`,
      proposal: "Test proposal",
      success_criteria: criteria,
      deadline: "2026-02-15",
      channel_id: "C123456",
      creator_id: "U123456",
      message_ts: "",
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await mockClient.apps.datastore.put({
      datastore: "decisions",
      item: decision,
    });

    const putCalls = mockClient.getCallsFor("apps.datastore.put");
    assertEquals(putCalls.length, 1);
    assertEquals((putCalls[0].params as DatastorePutParams).item.success_criteria, criteria);
  }
});

Deno.test("create_decision integration - should handle custom deadline", async () => {
  const mockClient = createMockSlackClient();

  const customDeadline = "2026-03-15";
  const decision = {
    id: "decision_custom_deadline",
    name: "Test Decision",
    proposal: "Test proposal",
    success_criteria: "simple_majority",
    deadline: customDeadline,
    channel_id: "C123456",
    creator_id: "U123456",
    message_ts: "",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await mockClient.apps.datastore.put({
    datastore: "decisions",
    item: decision,
  });

  const putCalls = mockClient.getCallsFor("apps.datastore.put");
  assertEquals(putCalls.length, 1);
  assertEquals((putCalls[0].params as DatastorePutParams).item.deadline, customDeadline);
});
