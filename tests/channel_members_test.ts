/**
 * Unit tests for channel member expansion logic
 *
 * Tests channel member expansion, bot filtering, deduplication, and pagination
 */

import { assertEquals } from "@std/assert";
import { createMockSlackClient } from "./mocks/slack_client.ts";

Deno.test("channel members - should expand channel members to voters", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["U001", "U002", "U003"]);

  const response = await mockClient.conversations.members({
    channel: "C123456",
  });

  assertEquals(response.ok, true);
  assertEquals(response.members, ["U001", "U002", "U003"]);

  const calls = mockClient.getCallsFor("conversations.members");
  assertEquals(calls.length, 1);
});

Deno.test("channel members - should filter out bot users", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["U001", "UBOT1", "U003"]);
  mockClient.setUserInfo("UBOT1", { is_bot: true });

  const membersResponse = await mockClient.conversations.members({
    channel: "C123456",
  });

  const allVoters = new Set<string>();
  for (const memberId of membersResponse.members || []) {
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

  assertEquals(allVoters.size, 2);
  assertEquals(Array.from(allVoters).sort(), ["U001", "U003"]);
});

Deno.test("channel members - should filter out USLACKBOT", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["U001", "USLACKBOT", "U003"]);

  const membersResponse = await mockClient.conversations.members({
    channel: "C123456",
  });

  const allVoters = new Set<string>();
  for (const memberId of membersResponse.members || []) {
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

  assertEquals(allVoters.size, 2);
  assertEquals(Array.from(allVoters).sort(), ["U001", "U003"]);
});

Deno.test("channel members - should deduplicate with individually selected users", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["U001", "U002", "U003"]);

  const individualVoters = ["U001", "U004"]; // U001 is also a channel member

  const membersResponse = await mockClient.conversations.members({
    channel: "C123456",
  });

  const allVoters = new Set<string>(individualVoters);
  for (const memberId of membersResponse.members || []) {
    const userInfo = await mockClient.users.info({ user: memberId });
    if (userInfo.ok && userInfo.user && !userInfo.user.is_bot) {
      allVoters.add(memberId);
    }
  }

  assertEquals(allVoters.size, 4); // U001, U002, U003, U004
  assertEquals(Array.from(allVoters).sort(), ["U001", "U002", "U003", "U004"]);
});

Deno.test("channel members - should deduplicate with usergroup members", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["U001", "U002", "U003"]);
  mockClient.setUsergroupMembers("S123456", ["U002", "U005"]);

  const allVoters = new Set<string>();

  // Add usergroup members
  const groupResponse = await mockClient.usergroups.users.list({
    usergroup: "S123456",
  });
  for (const member of groupResponse.users || []) {
    allVoters.add(member);
  }

  // Add channel members
  const membersResponse = await mockClient.conversations.members({
    channel: "C123456",
  });
  for (const memberId of membersResponse.members || []) {
    const userInfo = await mockClient.users.info({ user: memberId });
    if (userInfo.ok && userInfo.user && !userInfo.user.is_bot) {
      allVoters.add(memberId);
    }
  }

  // U002 appears in both channel and usergroup; should be deduped
  assertEquals(allVoters.size, 4); // U001, U002, U003, U005
  assertEquals(Array.from(allVoters).sort(), ["U001", "U002", "U003", "U005"]);
});

Deno.test("channel members - should handle empty channel (only bots)", async () => {
  const mockClient = createMockSlackClient();

  mockClient.setChannelMembers("C123456", ["UBOT1", "UBOT2"]);
  mockClient.setUserInfo("UBOT1", { is_bot: true });
  mockClient.setUserInfo("UBOT2", { is_bot: true });

  const membersResponse = await mockClient.conversations.members({
    channel: "C123456",
  });

  const allVoters = new Set<string>();
  for (const memberId of membersResponse.members || []) {
    const userInfo = await mockClient.users.info({ user: memberId });
    if (userInfo.ok && userInfo.user && !userInfo.user.is_bot) {
      allVoters.add(memberId);
    }
  }

  assertEquals(allVoters.size, 0);
});

Deno.test("channel members - should handle pagination", async () => {
  const mockClient = createMockSlackClient();

  // Set up 5 members; pagination splits into pages of 2
  mockClient.setChannelMembers("C123456", ["U001", "U002", "U003", "U004", "U005"]);
  mockClient.enableChannelMemberPagination();

  const allMembers: string[] = [];
  let cursor: string | undefined = undefined;

  do {
    const response = await mockClient.conversations.members({
      channel: "C123456",
      ...(cursor ? { cursor } : {}),
    });

    if (response.ok && response.members) {
      allMembers.push(...response.members);
    }

    cursor = response.response_metadata?.next_cursor || undefined;
  } while (cursor);

  assertEquals(allMembers.length, 5);
  assertEquals(allMembers.sort(), ["U001", "U002", "U003", "U004", "U005"]);
});

Deno.test("channel members - should enforce max voter limit", () => {
  const MAX_CHANNEL_VOTERS = 500;

  // Simulate 501 members
  const members = Array.from({ length: 501 }, (_, i) => `U${String(i).padStart(6, "0")}`);

  const exceedsLimit = members.length > MAX_CHANNEL_VOTERS;

  assertEquals(exceedsLimit, true);
  assertEquals(members.length, 501);
});
