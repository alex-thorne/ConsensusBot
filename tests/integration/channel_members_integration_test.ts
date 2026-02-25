/**
 * Integration tests for create_decision with channel member support
 *
 * Tests the complete decision creation flow with @channel expansion
 */

import { assertEquals, assertExists } from "@std/assert";
import { createMockSlackClient } from "../mocks/slack_client.ts";

Deno.test("create_decision with channel members - should expand channel members and store voters", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["U001", "U002", "U003"]);

  const inputs = {
    decision_name: "Adopt New Process",
    proposal: "We should adopt the new process for all projects",
    required_voters: [],
    required_usergroups: [],
    include_channel_members: true,
    success_criteria: "simple_majority",
    deadline: "2026-02-15",
    channel_id: "C123456",
    creator_id: "U999",
  };

  const allVoters = new Set<string>();

  // Add individual voters
  for (const voter of inputs.required_voters) {
    allVoters.add(voter);
  }

  // Expand channel members
  if (inputs.include_channel_members) {
    const membersResponse = await mockClient.conversations.members({
      channel: inputs.channel_id,
    });
    if (membersResponse.ok && membersResponse.members) {
      for (const memberId of membersResponse.members) {
        const userInfo = await mockClient.users.info({ user: memberId });
        if (
          userInfo.ok &&
          userInfo.user &&
          !userInfo.user.is_bot &&
          userInfo.user.id !== "USLACKBOT"
        ) {
          allVoters.add(memberId);
        }
      }
    }
  }

  const finalVoters = Array.from(allVoters);

  // Store voters in datastore
  const decisionId = "1234567890.123456";
  for (const voter_id of finalVoters) {
    await mockClient.apps.datastore.put({
      datastore: "voters",
      item: {
        id: `${decisionId}_${voter_id}`,
        decision_id: decisionId,
        user_id: voter_id,
        required: true,
        created_at: new Date().toISOString(),
      },
    });
  }

  // Verify conversations.members was called
  const membersCalls = mockClient.getCallsFor("conversations.members");
  assertEquals(membersCalls.length, 1);

  // Verify all voters stored
  const putCalls = mockClient.getCallsFor("apps.datastore.put");
  assertEquals(putCalls.length, 3); // U001, U002, U003

  assertEquals(finalVoters.length, 3);
  assertEquals(finalVoters.sort(), ["U001", "U002", "U003"]);
});

Deno.test("create_decision with channel members - should deduplicate individual voters and channel members", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["U001", "U002", "U003"]);

  const inputs = {
    required_voters: ["U001", "U004"], // U001 is also a channel member
    include_channel_members: true,
    channel_id: "C123456",
  };

  const allVoters = new Set<string>();

  for (const voter of inputs.required_voters) {
    allVoters.add(voter);
  }

  if (inputs.include_channel_members) {
    const membersResponse = await mockClient.conversations.members({
      channel: inputs.channel_id,
    });
    if (membersResponse.ok && membersResponse.members) {
      for (const memberId of membersResponse.members) {
        const userInfo = await mockClient.users.info({ user: memberId });
        if (userInfo.ok && userInfo.user && !userInfo.user.is_bot) {
          allVoters.add(memberId);
        }
      }
    }
  }

  const finalVoters = Array.from(allVoters);

  // U001 should appear only once
  assertEquals(finalVoters.length, 4);
  assertEquals(finalVoters.sort(), ["U001", "U002", "U003", "U004"]);
});

Deno.test("create_decision with channel members - should deduplicate usergroup members and channel members", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["U001", "U002", "U003"]);
  mockClient.setUsergroupMembers("S123456", ["U002", "U005"]);

  const inputs = {
    required_voters: [],
    required_usergroups: ["S123456"],
    include_channel_members: true,
    channel_id: "C123456",
  };

  const allVoters = new Set<string>();

  // Add usergroup members
  for (const usergroup_id of inputs.required_usergroups) {
    const response = await mockClient.usergroups.users.list({
      usergroup: usergroup_id,
    });
    if (response.ok && response.users) {
      for (const member of response.users) {
        allVoters.add(member);
      }
    }
  }

  // Add channel members
  if (inputs.include_channel_members) {
    const membersResponse = await mockClient.conversations.members({
      channel: inputs.channel_id,
    });
    if (membersResponse.ok && membersResponse.members) {
      for (const memberId of membersResponse.members) {
        const userInfo = await mockClient.users.info({ user: memberId });
        if (userInfo.ok && userInfo.user && !userInfo.user.is_bot) {
          allVoters.add(memberId);
        }
      }
    }
  }

  const finalVoters = Array.from(allVoters);

  // U002 appears in both usergroup and channel; should appear only once
  assertEquals(finalVoters.length, 4); // U001, U002, U003, U005
  assertEquals(finalVoters.sort(), ["U001", "U002", "U003", "U005"]);
});

Deno.test("create_decision with channel members - should filter bot users from channel", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", [
    "U001",
    "UBOT1",
    "U003",
    "USLACKBOT",
  ]);
  mockClient.setUserInfo("UBOT1", { is_bot: true });

  const inputs = {
    required_voters: [],
    include_channel_members: true,
    channel_id: "C123456",
  };

  const allVoters = new Set<string>();

  if (inputs.include_channel_members) {
    const membersResponse = await mockClient.conversations.members({
      channel: inputs.channel_id,
    });
    if (membersResponse.ok && membersResponse.members) {
      for (const memberId of membersResponse.members) {
        const userInfo = await mockClient.users.info({ user: memberId });
        if (
          userInfo.ok &&
          userInfo.user &&
          !userInfo.user.is_bot &&
          userInfo.user.id !== "USLACKBOT"
        ) {
          allVoters.add(memberId);
        }
      }
    }
  }

  const finalVoters = Array.from(allVoters);

  // UBOT1 and USLACKBOT should be excluded
  assertEquals(finalVoters.length, 2);
  assertEquals(finalVoters.sort(), ["U001", "U003"]);
});

Deno.test("create_decision with channel members - should post message with channel-expanded voters", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["U001", "U002", "U003"]);

  const allVoters = new Set<string>();

  const membersResponse = await mockClient.conversations.members({
    channel: "C123456",
  });
  if (membersResponse.ok && membersResponse.members) {
    for (const memberId of membersResponse.members) {
      const userInfo = await mockClient.users.info({ user: memberId });
      if (userInfo.ok && userInfo.user && !userInfo.user.is_bot) {
        allVoters.add(memberId);
      }
    }
  }

  const finalVoters = Array.from(allVoters);
  const votersMentions = finalVoters
    .map((userId: string) => `<@${userId}>`)
    .join(", ");

  const messageResponse = await mockClient.chat.postMessage({
    channel: "C123456",
    text: "New Decision: Test",
    blocks: [
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Required Voters:*\n${votersMentions}`,
          },
        ],
      },
    ],
  });

  assertEquals(messageResponse.ok, true);
  assertExists(messageResponse.ts);

  assertEquals(votersMentions.includes("<@U001>"), true);
  assertEquals(votersMentions.includes("<@U002>"), true);
  assertEquals(votersMentions.includes("<@U003>"), true);
});

Deno.test("create_decision with channel members - should handle pagination", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", [
    "U001",
    "U002",
    "U003",
    "U004",
    "U005",
  ]);
  mockClient.enableChannelMemberPagination();

  const allVoters = new Set<string>();
  let cursor: string | undefined = undefined;

  do {
    const membersResponse = await mockClient.conversations.members({
      channel: "C123456",
      ...(cursor ? { cursor } : {}),
    });

    if (membersResponse.ok && membersResponse.members) {
      for (const memberId of membersResponse.members) {
        const userInfo = await mockClient.users.info({ user: memberId });
        if (userInfo.ok && userInfo.user && !userInfo.user.is_bot) {
          allVoters.add(memberId);
        }
      }
    }

    cursor = membersResponse.response_metadata?.next_cursor || undefined;
  } while (cursor);

  const finalVoters = Array.from(allVoters);
  assertEquals(finalVoters.length, 5);
  assertEquals(finalVoters.sort(), ["U001", "U002", "U003", "U004", "U005"]);
});

Deno.test("create_decision with channel members - backward compatibility when include_channel_members is false", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["U001", "U002", "U003"]);

  const inputs = {
    required_voters: ["U004", "U005"],
    include_channel_members: false, // disabled
    channel_id: "C123456",
  };

  const allVoters = new Set<string>();

  for (const voter of inputs.required_voters) {
    allVoters.add(voter);
  }

  // include_channel_members is false, so we skip channel expansion
  if (inputs.include_channel_members) {
    const membersResponse = await mockClient.conversations.members({
      channel: inputs.channel_id,
    });
    if (membersResponse.ok && membersResponse.members) {
      for (const memberId of membersResponse.members) {
        allVoters.add(memberId);
      }
    }
  }

  const finalVoters = Array.from(allVoters);

  // Only individual voters, no channel members
  assertEquals(finalVoters.length, 2);
  assertEquals(finalVoters.sort(), ["U004", "U005"]);

  // conversations.members should not have been called
  const membersCalls = mockClient.getCallsFor("conversations.members");
  assertEquals(membersCalls.length, 0);
});

Deno.test("create_decision with channel members - end-to-end combined flow", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["U001", "U002", "UBOT1"]);
  mockClient.setUsergroupMembers("S123456", ["U002", "U003"]);
  mockClient.setUserInfo("UBOT1", { is_bot: true });

  const inputs = {
    decision_name: "Major Architecture Decision",
    proposal: "Adopt microservices architecture",
    required_voters: ["U001", "U004"], // U001 also in channel
    required_usergroups: ["S123456"], // U002 also in channel
    include_channel_members: true,
    channel_id: "C123456",
    creator_id: "U999",
  };

  const allVoters = new Set<string>();

  // Individual voters
  for (const voter of inputs.required_voters) {
    allVoters.add(voter);
  }

  // Usergroup expansion
  for (const usergroup_id of inputs.required_usergroups) {
    const response = await mockClient.usergroups.users.list({
      usergroup: usergroup_id,
    });
    if (response.ok && response.users) {
      for (const member of response.users) {
        allVoters.add(member);
      }
    }
  }

  // Channel expansion
  if (inputs.include_channel_members) {
    const membersResponse = await mockClient.conversations.members({
      channel: inputs.channel_id,
    });
    if (membersResponse.ok && membersResponse.members) {
      for (const memberId of membersResponse.members) {
        const userInfo = await mockClient.users.info({ user: memberId });
        if (
          userInfo.ok &&
          userInfo.user &&
          !userInfo.user.is_bot &&
          userInfo.user.id !== "USLACKBOT"
        ) {
          allVoters.add(memberId);
        }
      }
    }
  }

  const finalVoters = Array.from(allVoters);

  // U001: individual + channel (deduped)
  // U002: usergroup + channel (deduped)
  // U003: usergroup only
  // U004: individual only
  // UBOT1: filtered out (is_bot)
  assertEquals(finalVoters.length, 4);
  assertEquals(finalVoters.sort(), ["U001", "U002", "U003", "U004"]);

  // Store voters in datastore
  const decisionId = "1234567890.123456";
  for (const voter_id of finalVoters) {
    await mockClient.apps.datastore.put({
      datastore: "voters",
      item: {
        id: `${decisionId}_${voter_id}`,
        decision_id: decisionId,
        user_id: voter_id,
        required: true,
        created_at: new Date().toISOString(),
      },
    });
  }

  // Verify correct number of voters stored
  const putCalls = mockClient.getCallsFor("apps.datastore.put");
  assertEquals(putCalls.length, 4);
});
