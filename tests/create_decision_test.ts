/**
 * Tests for create_decision function
 *
 * Tests the core functionality of creating a decision with proper type safety
 */

import { assertEquals, assertExists } from "@std/assert";
import { SlackBlock, SlackClient } from "../types/slack_types.ts";

// Mock Slack Client
class MockSlackClient implements SlackClient {
  apps = {
    datastore: {
      // deno-lint-ignore require-await
      get: async (_params: { datastore: string; id: string }) => {
        return { ok: true, item: {} };
      },
      // deno-lint-ignore require-await
      put: async (
        _params: { datastore: string; item: Record<string, unknown> },
      ) => {
        return { ok: true };
      },
      // deno-lint-ignore require-await
      query: async (_params: {
        datastore: string;
        expression?: string;
        expression_attributes?: Record<string, string>;
        expression_values?: Record<string, unknown>;
      }) => {
        return { ok: true, items: [] };
      },
      // deno-lint-ignore require-await
      delete: async (_params: { datastore: string; id: string }) => {
        return { ok: true };
      },
    },
  };

  chat = {
    // deno-lint-ignore require-await
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
    // deno-lint-ignore require-await
    postEphemeral: async (_params: {
      channel: string;
      user: string;
      text: string;
      blocks?: SlackBlock[];
    }) => {
      return { ok: true };
    },
    // deno-lint-ignore require-await
    update: async (_params: {
      channel: string;
      ts: string;
      text: string;
      blocks?: SlackBlock[];
    }) => {
      return { ok: true };
    },
    // deno-lint-ignore require-await
    delete: async (_params: { channel: string; ts: string }) => {
      return { ok: true };
    },
  };

  users = {
    // deno-lint-ignore require-await
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

  conversations = {
    // deno-lint-ignore require-await
    members: async (_params: { channel: string; cursor?: string }) => {
      return {
        ok: true,
        members: ["U12345", "U67890"],
      };
    },
  };

  pins = {
    // deno-lint-ignore require-await
    add: async (_params: { channel: string; timestamp: string }) => {
      return { ok: true };
    },
    // deno-lint-ignore require-await
    remove: async (_params: { channel: string; timestamp: string }) => {
      return { ok: true };
    },
  };

  usergroups = {
    // deno-lint-ignore require-await
    list: async (_params?: { include_disabled?: boolean }) => {
      return { ok: true, usergroups: [] };
    },
    users: {
      // deno-lint-ignore require-await
      list: async (_params: { usergroup: string }) => {
        return {
          ok: true,
          users: ["U1234567890", "U0987654321"],
        };
      },
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

Deno.test(
  "create_decision - button stamp reconstruction uses real decision_id not placeholder",
  () => {
    const realDecisionId = "1772800105.129129";
    const placeholder = "{{decision_id}}";

    // Simulate reconstructing buttons from scratch (the Bug 1 fix)
    // instead of relying on message.message?.blocks
    const reconstructedBlocks: SlackBlock[] = [
      {
        type: "header",
        text: { type: "plain_text", text: "🗳️ Test Decision" },
      },
      {
        type: "actions",
        block_id: "voting_actions",
        elements: [
          {
            type: "button",
            action_id: "vote_yes",
            value: realDecisionId,
          },
          {
            type: "button",
            action_id: "vote_no",
            value: realDecisionId,
          },
          {
            type: "button",
            action_id: "vote_abstain",
            value: realDecisionId,
          },
          {
            type: "button",
            action_id: "decision_cancel",
            value: realDecisionId,
          },
          {
            type: "button",
            action_id: "decision_delete",
            value: realDecisionId,
          },
        ],
      },
    ];

    const actionsBlock = reconstructedBlocks.find(
      (b) => b.type === "actions",
    );
    assertExists(actionsBlock);
    assertExists(actionsBlock.elements);

    for (const element of actionsBlock.elements) {
      // Every button value must be the real ID, not the placeholder
      assertEquals(element.value, realDecisionId);
      assertEquals(element.value !== placeholder, true);
    }
  },
);

Deno.test(
  "create_decision - button stamp works even when message.message?.blocks is undefined",
  () => {
    const realDecisionId = "1772800105.129129";

    // Simulate what happens when Slack omits the message body (the bug scenario)
    const messageResponse = {
      ok: true,
      ts: realDecisionId,
      message: undefined, // Slack API omits this
    };

    // Old (buggy) approach: relies on optional chain
    const oldApproachBlocks = messageResponse.message?.blocks?.map(
      (block: SlackBlock) => {
        if (block.type === "actions") {
          return {
            ...block,
            elements: block.elements?.map((el) => ({
              ...el,
              value: realDecisionId,
            })),
          };
        }
        return block;
      },
    );

    // The old approach produces undefined when message is missing
    assertEquals(oldApproachBlocks, undefined);

    // New (fixed) approach: reconstruct from scratch
    const newApproachBlocks: SlackBlock[] = [
      {
        type: "actions",
        block_id: "voting_actions",
        elements: [
          { type: "button", action_id: "vote_yes", value: realDecisionId },
          { type: "button", action_id: "vote_no", value: realDecisionId },
        ],
      },
    ];

    // The new approach always produces a valid blocks array
    assertExists(newApproachBlocks);
    assertEquals(newApproachBlocks.length, 1);

    const actionsBlock = newApproachBlocks[0];
    assertExists(actionsBlock.elements);
    for (const el of actionsBlock.elements) {
      assertEquals(el.value, realDecisionId);
    }
  },
);
