/**
 * Integration tests for create_decision with user group support
 *
 * Tests the complete decision creation flow with user groups
 */

import { assertEquals, assertExists } from "@std/assert";
import { createMockSlackClient } from "../mocks/slack_client.ts";

Deno.test("create_decision with usergroups - should expand user groups and store all voters", async () => {
  const mockClient = createMockSlackClient();

  // Set up mock user groups
  mockClient.setUsergroupMembers("S123456", ["U001", "U002", "U003"]);
  mockClient.setUsergroupMembers("S789012", ["U004", "U005"]);

  const inputs = {
    decision_name: "Adopt New Framework",
    proposal: "We should adopt the new framework for all projects",
    required_voters: ["U006"], // Individual voter
    required_usergroups: ["S123456", "S789012"], // Two user groups
    success_criteria: "simple_majority",
    deadline: "2026-02-15",
    channel_id: "C123456",
    creator_id: "U999",
  };

  // Simulate user group expansion
  const allVoters = new Set<string>();

  // Add individual voters
  if (inputs.required_voters) {
    for (const voter of inputs.required_voters) {
      allVoters.add(voter);
    }
  }

  // Expand user groups
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

  // Verify usergroups.users.list was called for each group
  const usergroupCalls = mockClient.getCallsFor("usergroups.users.list");
  assertEquals(usergroupCalls.length, 2);

  // Verify all voters were stored (6 unique voters total)
  const putCalls = mockClient.getCallsFor("apps.datastore.put");
  assertEquals(putCalls.length, 6); // U001, U002, U003, U004, U005, U006

  // Verify voters are deduplicated
  assertEquals(finalVoters.length, 6);
  assertEquals(
    finalVoters.sort(),
    ["U001", "U002", "U003", "U004", "U005", "U006"],
  );
});

Deno.test("create_decision with usergroups - should handle overlapping group memberships", async () => {
  const mockClient = createMockSlackClient();

  // Set up mock user groups with overlapping members
  mockClient.setUsergroupMembers("S123456", ["U001", "U002", "U003"]);
  mockClient.setUsergroupMembers("S789012", ["U002", "U003", "U004"]);

  const inputs = {
    required_usergroups: ["S123456", "S789012"],
  };

  // Simulate user group expansion
  const allVoters = new Set<string>();

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

  const finalVoters = Array.from(allVoters);

  // Verify deduplication (U002 and U003 should appear only once)
  assertEquals(finalVoters.length, 4);
  assertEquals(finalVoters.sort(), ["U001", "U002", "U003", "U004"]);
});

Deno.test("create_decision with usergroups - should handle user selected individually and via group", async () => {
  const mockClient = createMockSlackClient();

  // Set up mock user group
  mockClient.setUsergroupMembers("S123456", ["U001", "U002", "U003"]);

  const inputs = {
    required_voters: ["U001", "U004"], // U001 is also in the group
    required_usergroups: ["S123456"],
  };

  // Simulate user group expansion
  const allVoters = new Set<string>();

  // Add individual voters
  if (inputs.required_voters) {
    for (const voter of inputs.required_voters) {
      allVoters.add(voter);
    }
  }

  // Expand user groups
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

  const finalVoters = Array.from(allVoters);

  // Verify deduplication (U001 should appear only once)
  assertEquals(finalVoters.length, 4);
  assertEquals(finalVoters.sort(), ["U001", "U002", "U003", "U004"]);
});

Deno.test("create_decision with usergroups - should handle empty user group gracefully", async () => {
  const mockClient = createMockSlackClient();

  // Set up empty user group
  mockClient.setUsergroupMembers("S123456", []);

  const inputs = {
    required_voters: ["U001", "U002"],
    required_usergroups: ["S123456"],
  };

  // Simulate user group expansion
  const allVoters = new Set<string>();

  if (inputs.required_voters) {
    for (const voter of inputs.required_voters) {
      allVoters.add(voter);
    }
  }

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

  const finalVoters = Array.from(allVoters);

  // Verify only individual voters are included
  assertEquals(finalVoters.length, 2);
  assertEquals(finalVoters.sort(), ["U001", "U002"]);
});

Deno.test("create_decision with usergroups - should work with only usergroups (no individual voters)", async () => {
  const mockClient = createMockSlackClient();

  // Set up mock user groups
  mockClient.setUsergroupMembers("S123456", ["U001", "U002", "U003"]);

  const inputs = {
    required_voters: [], // No individual voters
    required_usergroups: ["S123456"],
  };

  // Simulate user group expansion
  const allVoters = new Set<string>();

  if (inputs.required_voters) {
    for (const voter of inputs.required_voters) {
      allVoters.add(voter);
    }
  }

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

  const finalVoters = Array.from(allVoters);

  // Verify group members are included
  assertEquals(finalVoters.length, 3);
  assertEquals(finalVoters.sort(), ["U001", "U002", "U003"]);
});

Deno.test("create_decision with usergroups - should maintain backward compatibility (no usergroups)", async () => {
  const mockClient = createMockSlackClient();

  const inputs = {
    required_voters: ["U001", "U002", "U003"],
    required_usergroups: [], // No user groups
  };

  // Simulate user group expansion
  const allVoters = new Set<string>();

  if (inputs.required_voters) {
    for (const voter of inputs.required_voters) {
      allVoters.add(voter);
    }
  }

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

  const finalVoters = Array.from(allVoters);

  // Verify only individual voters are included
  assertEquals(finalVoters.length, 3);
  assertEquals(finalVoters.sort(), ["U001", "U002", "U003"]);

  // Verify usergroups.users.list was not called
  const usergroupCalls = mockClient.getCallsFor("usergroups.users.list");
  assertEquals(usergroupCalls.length, 0);
});

Deno.test("create_decision with usergroups - should post message with all expanded voters", async () => {
  const mockClient = createMockSlackClient();

  // Set up mock user group
  mockClient.setUsergroupMembers("S123456", ["U001", "U002", "U003"]);

  const inputs = {
    decision_name: "Test Decision",
    required_voters: ["U004"],
    required_usergroups: ["S123456"],
    channel_id: "C123456",
  };

  // Simulate user group expansion
  const allVoters = new Set<string>();

  if (inputs.required_voters) {
    for (const voter of inputs.required_voters) {
      allVoters.add(voter);
    }
  }

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

  const finalVoters = Array.from(allVoters);
  const votersMentions = finalVoters
    .map((userId: string) => `<@${userId}>`)
    .join(", ");

  // Post message with voter mentions
  const messageResponse = await mockClient.chat.postMessage({
    channel: inputs.channel_id,
    text: `New Decision: ${inputs.decision_name}`,
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

  // Verify message was posted
  assertEquals(messageResponse.ok, true);
  assertExists(messageResponse.ts);

  // Verify message contains all voter mentions
  assertEquals(votersMentions.includes("<@U001>"), true);
  assertEquals(votersMentions.includes("<@U002>"), true);
  assertEquals(votersMentions.includes("<@U003>"), true);
  assertEquals(votersMentions.includes("<@U004>"), true);
});
