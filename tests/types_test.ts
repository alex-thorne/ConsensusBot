/**
 * Tests for unified type definitions
 *
 * Ensures all type definitions are consistent and complete
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  DecisionItem,
  DecisionRecord,
  VoteRecord,
  VoterRecord,
} from "../types/decision_types.ts";
import { SlackBlock, SlackClient, SlackElement } from "../types/slack_types.ts";

Deno.test("types - DecisionRecord has all required fields", () => {
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

  // All fields should be present
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
});

Deno.test("types - DecisionItem is compatible with DecisionRecord", () => {
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

  // DecisionItem should be assignable from DecisionRecord
  const item: DecisionItem = decision;

  assertEquals(item.id, decision.id);
  assertEquals(item.name, decision.name);
});

Deno.test("types - VoteRecord has correct structure", () => {
  const vote: VoteRecord = {
    id: "decision_user",
    decision_id: "1234567890.123456",
    user_id: "U123456",
    vote_type: "yes",
    voted_at: "2026-02-01T12:00:00.000Z",
  };

  assertExists(vote.id);
  assertExists(vote.decision_id);
  assertExists(vote.user_id);
  assertExists(vote.vote_type);
  assertExists(vote.voted_at);

  // vote_type should be one of the valid values
  const validVoteTypes: Array<"yes" | "no" | "abstain"> = [
    "yes",
    "no",
    "abstain",
  ];
  assertEquals(validVoteTypes.includes(vote.vote_type), true);
});

Deno.test("types - VoterRecord has correct structure", () => {
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

  assertEquals(typeof voter.required, "boolean");
});

Deno.test("types - SlackClient has all required methods", () => {
  // Type check that SlackClient interface is complete
  type ClientType = SlackClient;

  // Verify the type has the expected structure
  const mockClient: Partial<ClientType> = {
    apps: {
      datastore: {
        // deno-lint-ignore require-await
        get: async () => ({ ok: true }),
        // deno-lint-ignore require-await
        put: async () => ({ ok: true }),
        // deno-lint-ignore require-await
        query: async () => ({ ok: true, items: [] }),
        // deno-lint-ignore require-await
        delete: async () => ({ ok: true }),
      },
    },
  };

  assertExists(mockClient.apps);
  assertExists(mockClient.apps?.datastore);
});

Deno.test("types - SlackBlock supports various block types", () => {
  const headerBlock: SlackBlock = {
    type: "header",
    text: {
      type: "plain_text",
      text: "Header Text",
    },
  };

  const sectionBlock: SlackBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: "Section text",
    },
  };

  const actionsBlock: SlackBlock = {
    type: "actions",
    elements: [
      {
        type: "button",
        value: "value",
      },
    ],
  };

  assertEquals(headerBlock.type, "header");
  assertEquals(sectionBlock.type, "section");
  assertEquals(actionsBlock.type, "actions");
});

Deno.test("types - SlackElement allows flexible element types", () => {
  const buttonElement: SlackElement = {
    type: "button",
    value: "button_value",
  };

  const textElement: SlackElement = {
    type: "mrkdwn",
    text: "Some text",
  };

  assertExists(buttonElement.type);
  assertExists(textElement.type);
  assertEquals(buttonElement.value, "button_value");
  assertEquals(textElement.text, "Some text");
});

Deno.test("types - DecisionRecord success_criteria values", () => {
  const validCriteria = ["simple_majority", "super_majority", "unanimous"];

  for (const criteria of validCriteria) {
    const decision: DecisionRecord = {
      id: "1234567890.123456",
      name: "Test Decision",
      proposal: "This is a test proposal",
      success_criteria: criteria,
      deadline: "2026-02-15T23:59:59.000Z",
      channel_id: "C123456",
      creator_id: "U123456",
      message_ts: "1234567890.123456",
      status: "active",
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    };

    assertEquals(decision.success_criteria, criteria);
  }
});

Deno.test("types - DecisionRecord status values", () => {
  const validStatuses = ["active", "approved", "rejected"];

  for (const status of validStatuses) {
    const decision: DecisionRecord = {
      id: "1234567890.123456",
      name: "Test Decision",
      proposal: "This is a test proposal",
      success_criteria: "simple_majority",
      deadline: "2026-02-15T23:59:59.000Z",
      channel_id: "C123456",
      creator_id: "U123456",
      message_ts: "1234567890.123456",
      status: status,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    };

    assertEquals(decision.status, status);
  }
});
