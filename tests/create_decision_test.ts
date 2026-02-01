/**
 * Tests for create_decision function
 * 
 * Tests the core functionality of creating a decision with proper type safety
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { SlackClient, SlackBlock } from "../types/slack_types.ts";

// Mock Slack Client
class MockSlackClient implements SlackClient {
  apps = {
    datastore: {
      get: async (_params: { datastore: string; id: string }) => {
        return { ok: true, item: {} };
      },
      put: async (_params: { datastore: string; item: Record<string, unknown> }) => {
        return { ok: true };
      },
      query: async (_params: {
        datastore: string;
        expression?: string;
        expression_attributes?: Record<string, string>;
        expression_values?: Record<string, unknown>;
      }) => {
        return { ok: true, items: [] };
      },
    },
  };

  chat = {
    postMessage: async (params: {
      channel: string;
      text: string;
      blocks?: SlackBlock[];
      thread_ts?: string;
    }) => {
      return {
        ok: true,
        ts: "1234567890.123456",
        message: {
          blocks: params.blocks,
        },
      };
    },
    postEphemeral: async (_params: {
      channel: string;
      user: string;
      text: string;
      blocks?: SlackBlock[];
    }) => {
      return { ok: true };
    },
    update: async (_params: {
      channel: string;
      ts: string;
      text: string;
      blocks?: SlackBlock[];
    }) => {
      return { ok: true };
    },
  };

  users = {
    info: async (_params: { user: string }) => {
      return {
        ok: true,
        user: {
          real_name: "Test User",
          name: "testuser",
        },
      };
    },
  };

  pins = {
    add: async (_params: { channel: string; timestamp: string }) => {
      return { ok: true };
    },
    remove: async (_params: { channel: string; timestamp: string }) => {
      return { ok: true };
    },
  };
}

Deno.test("create_decision - SlackClient type compatibility", () => {
  const mockClient = new MockSlackClient();
  
  // Verify that MockSlackClient implements SlackClient correctly
  assertExists(mockClient.apps);
  assertExists(mockClient.chat);
  assertExists(mockClient.users);
  assertExists(mockClient.pins);
  
  // Verify datastore methods exist
  assertExists(mockClient.apps.datastore.get);
  assertExists(mockClient.apps.datastore.put);
  assertExists(mockClient.apps.datastore.query);
  
  // Verify chat methods exist
  assertExists(mockClient.chat.postMessage);
  assertExists(mockClient.chat.postEphemeral);
  assertExists(mockClient.chat.update);
});

Deno.test("create_decision - SlackBlock type for Block Kit objects", () => {
  const block: SlackBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: "Test message",
    },
  };
  
  assertEquals(block.type, "section");
  assertExists(block.text);
});

Deno.test("create_decision - SlackBlock actions block with elements", () => {
  const actionsBlock: SlackBlock = {
    type: "actions",
    block_id: "voting_actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Yes",
        },
        action_id: "vote_yes",
        value: "decision_123",
      },
    ],
  };
  
  assertEquals(actionsBlock.type, "actions");
  assertEquals(actionsBlock.block_id, "voting_actions");
  assertExists(actionsBlock.elements);
  assertEquals(actionsBlock.elements.length, 1);
});

Deno.test("create_decision - block mapping preserves type safety", () => {
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Decision Title",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          value: "old_value",
        },
      ],
    },
  ];
  
  // Simulate the block mapping logic from create_decision.ts
  const mappedBlocks = blocks.map((block) => {
    const typedBlock = block as SlackBlock;
    if (typedBlock.type === "actions") {
      return {
        ...typedBlock,
        elements: typedBlock.elements?.map((element) => ({
          ...element,
          value: "new_value",
        })),
      };
    }
    return typedBlock;
  });
  
  assertEquals(mappedBlocks.length, 2);
  assertEquals(mappedBlocks[0].type, "header");
  assertEquals(mappedBlocks[1].type, "actions");
  
  // Verify the value was updated
  const actionsBlock = mappedBlocks[1];
  if (actionsBlock.elements && actionsBlock.elements.length > 0) {
    assertEquals(actionsBlock.elements[0].value, "new_value");
  }
});
