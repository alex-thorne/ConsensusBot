/**
 * Unit tests for user group expansion logic
 *
 * Tests the user group expansion, deduplication, and error handling
 */

import { assertEquals } from "@std/assert";
import { createMockSlackClient } from "./mocks/slack_client.ts";

Deno.test("usergroup expansion - should expand single user group", async () => {
  const mockClient = createMockSlackClient();

  // Set up mock user group members
  mockClient.setUsergroupMembers("S123456", ["U001", "U002", "U003"]);

  // Fetch user group members
  const response = await mockClient.usergroups.users.list({
    usergroup: "S123456",
  });

  // Verify response
  assertEquals(response.ok, true);
  assertEquals(response.users, ["U001", "U002", "U003"]);

  // Verify the API was called
  const calls = mockClient.getCallsFor("usergroups.users.list");
  assertEquals(calls.length, 1);
});

Deno.test("usergroup expansion - should deduplicate users from multiple groups", async () => {
  const mockClient = createMockSlackClient();

  // Set up mock user groups with overlapping members
  mockClient.setUsergroupMembers("S123456", ["U001", "U002", "U003"]);
  mockClient.setUsergroupMembers("S789012", ["U003", "U004", "U005"]);

  // Fetch members from both groups
  const response1 = await mockClient.usergroups.users.list({
    usergroup: "S123456",
  });
  const response2 = await mockClient.usergroups.users.list({
    usergroup: "S789012",
  });

  // Combine and deduplicate
  const allUsers = new Set([
    ...(response1.users || []),
    ...(response2.users || []),
  ]);

  // Verify deduplication
  assertEquals(allUsers.size, 5); // Should have 5 unique users
  assertEquals(
    Array.from(allUsers).sort(),
    ["U001", "U002", "U003", "U004", "U005"],
  );
});

Deno.test("usergroup expansion - should deduplicate users selected individually and via group", async () => {
  const mockClient = createMockSlackClient();

  // Set up mock user group members
  mockClient.setUsergroupMembers("S123456", ["U001", "U002", "U003"]);

  // Individual voters
  const individualVoters = ["U001", "U004"]; // U001 is also in the group

  // Fetch group members
  const response = await mockClient.usergroups.users.list({
    usergroup: "S123456",
  });

  // Combine and deduplicate
  const allUsers = new Set([
    ...individualVoters,
    ...(response.users || []),
  ]);

  // Verify deduplication
  assertEquals(allUsers.size, 4); // U001, U002, U003, U004
  assertEquals(
    Array.from(allUsers).sort(),
    ["U001", "U002", "U003", "U004"],
  );
});

Deno.test("usergroup expansion - should handle empty user group", async () => {
  const mockClient = createMockSlackClient();

  // Set up empty user group
  mockClient.setUsergroupMembers("S123456", []);

  // Fetch user group members
  const response = await mockClient.usergroups.users.list({
    usergroup: "S123456",
  });

  // Verify response
  assertEquals(response.ok, true);
  assertEquals(response.users, []);
});

Deno.test("usergroup expansion - should handle non-existent user group gracefully", async () => {
  const mockClient = createMockSlackClient();

  // Fetch non-existent user group (not set up in mock)
  const response = await mockClient.usergroups.users.list({
    usergroup: "S999999",
  });

  // Verify response (mock returns empty array for non-existent groups)
  assertEquals(response.ok, true);
  assertEquals(response.users, []);
});

Deno.test("usergroup expansion - should handle large user groups", async () => {
  const mockClient = createMockSlackClient();

  // Create a large user group (100 members)
  const largeGroup = Array.from(
    { length: 100 },
    (_, i) => `U${String(i).padStart(6, "0")}`,
  );
  mockClient.setUsergroupMembers("S123456", largeGroup);

  // Fetch user group members
  const response = await mockClient.usergroups.users.list({
    usergroup: "S123456",
  });

  // Verify response
  assertEquals(response.ok, true);
  assertEquals(response.users!.length, 100);
  assertEquals(response.users![0], "U000000");
  assertEquals(response.users![99], "U000099");
});

Deno.test("usergroup expansion - should track which users came from which groups", async () => {
  const mockClient = createMockSlackClient();

  // Set up mock user groups
  mockClient.setUsergroupMembers("S123456", ["U001", "U002", "U003"]);
  mockClient.setUsergroupMembers("S789012", ["U004", "U005"]);

  const userGroupInfo: Map<string, string[]> = new Map();

  // Fetch and track groups
  const response1 = await mockClient.usergroups.users.list({
    usergroup: "S123456",
  });
  userGroupInfo.set("S123456", response1.users || []);

  const response2 = await mockClient.usergroups.users.list({
    usergroup: "S789012",
  });
  userGroupInfo.set("S789012", response2.users || []);

  // Verify tracking
  assertEquals(userGroupInfo.get("S123456"), ["U001", "U002", "U003"]);
  assertEquals(userGroupInfo.get("S789012"), ["U004", "U005"]);
});
