// ConsensusBot v2.0 — Tests for usergroup expansion + bot/deleted filtering.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8.2 (Voter resolution)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §14.2 (parseUsergroupInput)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.1 (`usergroup_expansion_test.ts`)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-202
//
// `create_decision` does not exist yet (T-301), so we exercise the algorithm
// via:
//   1. `parseUsergroupInput` — the production parser, imported as-is.
//   2. A local `expandUsergroups` helper that mimics what the future
//      `create_decision` will do: iterate parsed IDs + resolve handles via
//      paginated `usergroups.list`, fetch members via paginated
//      `usergroups.users.list`, then apply the bot/deleted/USLACKBOT filter
//      via `users.info` (cached in-memory).
//
// The helper lives inline because it is the contract under test — when
// T-301 lands, the production code MUST exhibit the same behaviour and the
// integration tests in `tests/integration/usergroup_integration_test.ts`
// will pin the wiring against the real function.

import { assertEquals } from "@std/assert";
import { parseUsergroupInput } from "../utils/slack_parse.ts";
import type { SlackClient } from "../types/slack_types.ts";
import { MockSlackClient } from "./mocks/slack_client.ts";

// ---------------------------------------------------------------------------
// Inline helper that mimics create_decision's usergroup-expansion phase.
// ---------------------------------------------------------------------------

/**
 * Resolve a usergroup-input string to a deduplicated list of voter IDs.
 *
 * Mirrors SPEC §8.2.2 / §8.2.3:
 *   - parse the freeform input into ids + handles + broadcasts
 *   - reject broadcasts (caller's job — surfaced in the return tuple)
 *   - resolve handles via paginated `usergroups.list`
 *   - for every resolved ID, page through `usergroups.users.list`
 *   - for every member, apply the bot/deleted/USLACKBOT filter using
 *     `users.info` (cached in-memory)
 *
 * Order is preserved by group, then by member position within the group.
 * Cross-group duplicates are dropped — a voter who appears in two groups is
 * counted once.
 */
async function expandUsergroups(
  client: SlackClient,
  input: string | string[],
): Promise<{ voters: string[]; broadcasts: string[] }> {
  const parsed = parseUsergroupInput(input);
  const resolvedIds: string[] = [...parsed.ids];

  // Resolve handles via paginated `usergroups.list`. We follow the cursor
  // until exhausted and look up each handle once, in first-seen order.
  if (parsed.handles.length > 0) {
    const summaries: { id: string; handle?: string; name?: string }[] = [];
    let cursor: string | undefined;
    do {
      const res = await client.usergroups.list({ cursor });
      if (!res.ok || !res.usergroups) break;
      summaries.push(...res.usergroups);
      cursor = res.response_metadata?.next_cursor;
    } while (cursor);
    for (const handle of parsed.handles) {
      const match = summaries.find((s) => s.handle === handle);
      if (match) resolvedIds.push(match.id);
    }
  }

  // Per-user info cache so we never call `users.info` twice for the same id.
  const userCache = new Map<
    string,
    { is_bot?: boolean; deleted?: boolean }
  >();
  const fetchUser = async (
    userId: string,
  ): Promise<{ is_bot?: boolean; deleted?: boolean } | undefined> => {
    const cached = userCache.get(userId);
    if (cached) return cached;
    const res = await client.users.info({ user: userId });
    if (!res.ok || !res.user) return undefined;
    const slim = { is_bot: res.user.is_bot, deleted: res.user.deleted };
    userCache.set(userId, slim);
    return slim;
  };

  const voters = new Set<string>();
  for (const groupId of resolvedIds) {
    let cursor: string | undefined;
    do {
      const res = await client.usergroups.users.list({
        usergroup: groupId,
        cursor,
      });
      if (!res.ok || !res.users) break;
      for (const memberId of res.users) {
        if (memberId === "USLACKBOT") continue;
        const info = await fetchUser(memberId);
        if (!info) continue;
        if (info.is_bot === true) continue;
        if (info.deleted === true) continue;
        voters.add(memberId);
      }
      cursor = res.response_metadata?.next_cursor;
    } while (cursor);
  }

  return { voters: [...voters], broadcasts: parsed.broadcasts };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("expandUsergroups — single group dedups its own membership list", async () => {
  const client = new MockSlackClient();
  // Same id appears twice — Slack will sometimes do this on group merges.
  client.setUsergroupMembers("S001", ["U1", "U2", "U1", "U3"]);
  const { voters } = await expandUsergroups(client, "<!subteam^S001>");
  assertEquals(voters, ["U1", "U2", "U3"]);
});

Deno.test("expandUsergroups — multi-group with overlapping members produces deduped list", async () => {
  const client = new MockSlackClient();
  client.setUsergroupMembers("S001", ["U1", "U2", "U3"]);
  client.setUsergroupMembers("S002", ["U3", "U4", "U5"]);
  const { voters } = await expandUsergroups(
    client,
    "<!subteam^S001> <!subteam^S002>",
  );
  assertEquals(voters, ["U1", "U2", "U3", "U4", "U5"]);
});

Deno.test("expandUsergroups — individual + group dedup (caller merges; helper returns group set)", async () => {
  // The expansion helper handles groups only; the caller merges with the
  // individual-voter set. We exercise the full union here to pin the
  // create_decision contract: a voter who appears as an individual AND in
  // a group is counted once.
  const client = new MockSlackClient();
  client.setUsergroupMembers("S001", ["U2", "U3"]);
  const individuals = ["U1", "U2"];
  const { voters } = await expandUsergroups(client, "<!subteam^S001>");
  const merged = [...new Set([...individuals, ...voters])];
  assertEquals(merged, ["U1", "U2", "U3"]);
});

Deno.test("expandUsergroups — empty usergroup returns no voters", async () => {
  const client = new MockSlackClient();
  client.setUsergroupMembers("S001", []);
  const { voters } = await expandUsergroups(client, "<!subteam^S001>");
  assertEquals(voters, []);
});

Deno.test("expandUsergroups — missing usergroup id returns no voters (no preload)", async () => {
  const client = new MockSlackClient();
  // S999 has no preloaded membership.
  const { voters } = await expandUsergroups(client, "<!subteam^S999>");
  assertEquals(voters, []);
});

Deno.test("expandUsergroups — large group (100 members) returns every member", async () => {
  const client = new MockSlackClient();
  const members = Array.from({ length: 100 }, (_, i) => `U${i + 1}`);
  client.setUsergroupMembers("S001", members);
  const { voters } = await expandUsergroups(client, "<!subteam^S001>");
  assertEquals(voters.length, 100);
  assertEquals(voters[0], "U1");
  assertEquals(voters[99], "U100");
});

Deno.test("expandUsergroups — bot members are filtered out via users.info.is_bot", async () => {
  const client = new MockSlackClient();
  client.setUsergroupMembers("S001", ["U1", "BOT1", "U2", "BOT2"]);
  client.setUserInfo("BOT1", { is_bot: true });
  client.setUserInfo("BOT2", { is_bot: true });
  // U1, U2 fall through to the default (non-bot, non-deleted).
  const { voters } = await expandUsergroups(client, "<!subteam^S001>");
  assertEquals(voters, ["U1", "U2"]);
});

Deno.test("expandUsergroups — deleted members are filtered out via users.info.deleted", async () => {
  const client = new MockSlackClient();
  client.setUsergroupMembers("S001", ["U1", "U2", "U3"]);
  client.setUserDeleted("U2");
  const { voters } = await expandUsergroups(client, "<!subteam^S001>");
  assertEquals(voters, ["U1", "U3"]);
});

Deno.test("expandUsergroups — USLACKBOT is filtered by id even without is_bot=true", async () => {
  // USLACKBOT does not always carry `is_bot=true` (SPEC §8.2.3 footnote).
  const client = new MockSlackClient();
  client.setUsergroupMembers("S001", ["U1", "USLACKBOT", "U2"]);
  client.setUserInfo("USLACKBOT", { is_bot: false }); // adversarial mock
  const { voters } = await expandUsergroups(client, "<!subteam^S001>");
  assertEquals(voters, ["U1", "U2"]);
});

Deno.test("expandUsergroups — users.info is cached across multiple groups (no duplicate calls)", async () => {
  const client = new MockSlackClient();
  client.setUsergroupMembers("S001", ["U1", "U2"]);
  client.setUsergroupMembers("S002", ["U1", "U2"]); // same membership
  await expandUsergroups(client, "<!subteam^S001> <!subteam^S002>");
  // Each user should have been fetched exactly once.
  const u1Calls = client.getCallsFor("users.info").filter(
    (c) => (c.args as { user: string }).user === "U1",
  );
  const u2Calls = client.getCallsFor("users.info").filter(
    (c) => (c.args as { user: string }).user === "U2",
  );
  assertEquals(u1Calls.length, 1);
  assertEquals(u2Calls.length, 1);
});

Deno.test("expandUsergroups — paginated usergroups.list resolves handles across pages", async () => {
  const client = new MockSlackClient();
  // 5 summaries split across pages of 2 → 3 pages with cursors.
  client.setUsergroupsList([
    { id: "S001", handle: "alpha" },
    { id: "S002", handle: "beta" },
    { id: "S003", handle: "gamma" },
    { id: "S004", handle: "delta" },
    { id: "S005", handle: "engineers" },
  ]);
  client.enableUsergroupPagination(2);
  client.setUsergroupMembers("S005", ["U1", "U2"]);
  // The handle `engineers` lives on the LAST page — forces the helper
  // to follow `next_cursor` to completion.
  const { voters } = await expandUsergroups(client, "@engineers");
  assertEquals(voters, ["U1", "U2"]);
  // Verify the helper made multiple list calls following cursors.
  const listCalls = client.getCallsFor("usergroups.list");
  assertEquals(listCalls.length, 3);
  const cursors = listCalls.map(
    (c) => (c.args as { cursor?: string }).cursor,
  );
  assertEquals(cursors, [undefined, "2", "4"]);
});

Deno.test("expandUsergroups — paginated usergroups.users.list returns every member across pages", async () => {
  const client = new MockSlackClient();
  // 250 members in one group, paginated 100 per page.
  const members = Array.from({ length: 250 }, (_, i) => `U${i + 1}`);
  client.setUsergroupMembers("S001", members);
  client.enableUsergroupUsersPagination("S001", 100);
  const { voters } = await expandUsergroups(client, "<!subteam^S001>");
  assertEquals(voters.length, 250);
  assertEquals(voters[0], "U1");
  assertEquals(voters[249], "U250");
  const usersListCalls = client.getCallsFor("usergroups.users.list");
  // 100 / 100 / 50 → 3 pages.
  assertEquals(usersListCalls.length, 3);
});

Deno.test("expandUsergroups — broadcast handles are surfaced separately, not expanded", async () => {
  // Caller is responsible for rejecting broadcasts (SPEC §8.1.3). The helper
  // returns them in the `broadcasts` field and does not attempt expansion.
  const client = new MockSlackClient();
  const { voters, broadcasts } = await expandUsergroups(
    client,
    "@here @channel @everyone",
  );
  assertEquals(voters, []);
  assertEquals(broadcasts, ["here", "channel", "everyone"]);
  // No usergroups.list / usergroups.users.list calls fired for broadcasts.
  assertEquals(client.getCallsFor("usergroups.list").length, 0);
  assertEquals(client.getCallsFor("usergroups.users.list").length, 0);
});

Deno.test("expandUsergroups — bot filter applied across paginated members", async () => {
  // Mix of bots and humans that span multiple pages.
  const client = new MockSlackClient();
  const members = ["U1", "BOT1", "U2", "BOT2", "U3", "USLACKBOT"];
  client.setUsergroupMembers("S001", members);
  client.enableUsergroupUsersPagination("S001", 2);
  client.setUserInfo("BOT1", { is_bot: true });
  client.setUserInfo("BOT2", { is_bot: true });
  const { voters } = await expandUsergroups(client, "<!subteam^S001>");
  assertEquals(voters, ["U1", "U2", "U3"]);
});
