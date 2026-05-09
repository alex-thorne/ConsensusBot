// ConsensusBot v2.0 — Tests for channel-member resolution + filtering.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8.2 (Voter resolution)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8.2.4 (channel members + 500 cap)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.1 (`channel_members_test.ts`)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-202
//
// `create_decision` does not exist yet (T-301), so we exercise the algorithm
// via a local `expandChannelMembers` helper that mimics the future production
// code: page through `conversations.members`, apply the bot/USLACKBOT/deleted
// filter via cached `users.info`, enforce the `MAX_CHANNEL_VOTERS = 500` cap.
// Integration tests in `tests/integration/channel_members_integration_test.ts`
// will pin the wiring against the real function once T-301 lands.

import { assertEquals } from "@std/assert";
import type { SlackClient } from "../types/slack_types.ts";
import { MockSlackClient } from "./mocks/slack_client.ts";

// Hard cap from SPEC §8.2.4. Mirrored here so the helper is self-contained.
const MAX_CHANNEL_VOTERS = 500;

// ---------------------------------------------------------------------------
// Inline helper that mimics create_decision's channel-expansion phase.
// ---------------------------------------------------------------------------

/** Result of channel expansion. `error` set when the cap is exceeded. */
interface ExpandChannelResult {
  voters: string[];
  error?: string;
}

/**
 * Expand a channel into a deduplicated, filtered list of voter IDs.
 *
 * Mirrors SPEC §8.2.4:
 *   1. Page through `conversations.members` accumulating raw IDs.
 *   2. If raw count > `MAX_CHANNEL_VOTERS`, return an error verbatim per spec.
 *   3. Apply the bot/USLACKBOT/deleted filter via cached `users.info`.
 *   4. Return the unique filtered list, preserving first-seen order.
 */
async function expandChannelMembers(
  client: SlackClient,
  channel: string,
): Promise<ExpandChannelResult> {
  // Phase 1 — accumulate raw IDs across pages.
  const raw: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.conversations.members({ channel, cursor });
    if (!res.ok || !res.members) break;
    raw.push(...res.members);
    cursor = res.response_metadata?.next_cursor;
  } while (cursor);

  // Phase 2 — enforce the hard cap. SPEC verbatim error text.
  if (raw.length > MAX_CHANNEL_VOTERS) {
    return {
      voters: [],
      error: `Channel has too many members (${raw.length}). ` +
        `Maximum allowed is 500 voters. Please use individual user selection ` +
        `or user groups instead.`,
    };
  }

  // Phase 3 — filter. Cache `users.info` across iterations.
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
  for (const memberId of raw) {
    if (memberId === "USLACKBOT") continue;
    const info = await fetchUser(memberId);
    if (!info) continue;
    if (info.is_bot === true) continue;
    if (info.deleted === true) continue;
    voters.add(memberId);
  }
  return { voters: [...voters] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("expandChannelMembers — regular humans pass through unchanged", async () => {
  const client = new MockSlackClient();
  client.setChannelMembers("C123", ["U1", "U2", "U3"]);
  const { voters, error } = await expandChannelMembers(client, "C123");
  assertEquals(error, undefined);
  assertEquals(voters, ["U1", "U2", "U3"]);
});

Deno.test("expandChannelMembers — is_bot=true users are excluded", async () => {
  const client = new MockSlackClient();
  client.setChannelMembers("C123", ["U1", "BOT1", "U2", "BOT2"]);
  client.setUserInfo("BOT1", { is_bot: true });
  client.setUserInfo("BOT2", { is_bot: true });
  const { voters } = await expandChannelMembers(client, "C123");
  assertEquals(voters, ["U1", "U2"]);
});

Deno.test("expandChannelMembers — USLACKBOT excluded by id even when is_bot=false", async () => {
  // SPEC §8.2.3 footnote: USLACKBOT does not always carry `is_bot=true`.
  const client = new MockSlackClient();
  client.setChannelMembers("C123", ["U1", "USLACKBOT", "U2"]);
  client.setUserInfo("USLACKBOT", { is_bot: false });
  const { voters } = await expandChannelMembers(client, "C123");
  assertEquals(voters, ["U1", "U2"]);
});

Deno.test("expandChannelMembers — deleted users are excluded", async () => {
  const client = new MockSlackClient();
  client.setChannelMembers("C123", ["U1", "U2", "U3"]);
  client.setUserDeleted("U2");
  const { voters } = await expandChannelMembers(client, "C123");
  assertEquals(voters, ["U1", "U3"]);
});

Deno.test("expandChannelMembers — bot + USLACKBOT + deleted all excluded together", async () => {
  const client = new MockSlackClient();
  client.setChannelMembers("C123", ["U1", "BOT1", "USLACKBOT", "U2", "U3"]);
  client.setUserInfo("BOT1", { is_bot: true });
  client.setUserDeleted("U3");
  const { voters } = await expandChannelMembers(client, "C123");
  assertEquals(voters, ["U1", "U2"]);
});

Deno.test("expandChannelMembers — pagination via next_cursor accumulates every page", async () => {
  const client = new MockSlackClient();
  // 250 members across pages of 100 → 3 pages.
  const members = Array.from({ length: 250 }, (_, i) => `U${i + 1}`);
  client.setChannelMembers("C123", members);
  client.enableChannelMemberPagination("C123", 100);
  const { voters } = await expandChannelMembers(client, "C123");
  assertEquals(voters.length, 250);
  assertEquals(voters[0], "U1");
  assertEquals(voters[249], "U250");
  const memberCalls = client.getCallsFor("conversations.members");
  // 100 / 100 / 50 → 3 pages.
  assertEquals(memberCalls.length, 3);
  const cursors = memberCalls.map(
    (c) => (c.args as { cursor?: string }).cursor,
  );
  assertEquals(cursors, [undefined, "100", "200"]);
});

Deno.test("expandChannelMembers — bot filter applied across paginated pages", async () => {
  const client = new MockSlackClient();
  client.setChannelMembers("C123", [
    "U1",
    "BOT1",
    "U2",
    "USLACKBOT",
    "U3",
    "BOT2",
  ]);
  client.enableChannelMemberPagination("C123", 2);
  client.setUserInfo("BOT1", { is_bot: true });
  client.setUserInfo("BOT2", { is_bot: true });
  const { voters } = await expandChannelMembers(client, "C123");
  assertEquals(voters, ["U1", "U2", "U3"]);
});

Deno.test("expandChannelMembers — dedup with individual + usergroup voters (cross-source)", async () => {
  // Channel: U2, U3, U4. Individual: U1, U2. Group S001: U3, U5.
  // Expected union: U1..U5, no duplicates.
  const client = new MockSlackClient();
  client.setChannelMembers("C123", ["U2", "U3", "U4"]);
  client.setUsergroupMembers("S001", ["U3", "U5"]);

  const individuals = ["U1", "U2"];
  const { voters: groupVoters } = await (async () => {
    let cursor: string | undefined;
    const collected: string[] = [];
    do {
      const res = await client.usergroups.users.list({
        usergroup: "S001",
        cursor,
      });
      if (!res.ok || !res.users) break;
      collected.push(...res.users);
      cursor = res.response_metadata?.next_cursor;
    } while (cursor);
    return { voters: collected };
  })();
  const { voters: channelVoters } = await expandChannelMembers(client, "C123");

  const merged = [
    ...new Set([...individuals, ...groupVoters, ...channelVoters]),
  ];
  assertEquals(merged, ["U1", "U2", "U3", "U5", "U4"]);
});

Deno.test("expandChannelMembers — 600-member channel triggers MAX_CHANNEL_VOTERS error", async () => {
  const client = new MockSlackClient();
  const members = Array.from({ length: 600 }, (_, i) => `U${i + 1}`);
  client.setChannelMembers("C123", members);
  // Pagination on; the helper must exhaust pages before checking the cap.
  client.enableChannelMemberPagination("C123", 200);
  const { voters, error } = await expandChannelMembers(client, "C123");
  assertEquals(voters, []);
  assertEquals(
    error,
    "Channel has too many members (600). " +
      "Maximum allowed is 500 voters. Please use individual user selection " +
      "or user groups instead.",
  );
});

Deno.test("expandChannelMembers — 500 members exactly is allowed (boundary)", async () => {
  const client = new MockSlackClient();
  const members = Array.from({ length: 500 }, (_, i) => `U${i + 1}`);
  client.setChannelMembers("C123", members);
  const { voters, error } = await expandChannelMembers(client, "C123");
  assertEquals(error, undefined);
  assertEquals(voters.length, 500);
});

Deno.test("expandChannelMembers — empty channel returns empty list, no error", async () => {
  const client = new MockSlackClient();
  client.setChannelMembers("C123", []);
  const { voters, error } = await expandChannelMembers(client, "C123");
  assertEquals(error, undefined);
  assertEquals(voters, []);
});

Deno.test("expandChannelMembers — users.info caches across paginated pages", async () => {
  // The same user appearing on two pages must be looked up only once.
  const client = new MockSlackClient();
  client.setChannelMembers("C123", ["U1", "U2", "U1", "U3"]);
  client.enableChannelMemberPagination("C123", 2);
  await expandChannelMembers(client, "C123");
  const u1Calls = client.getCallsFor("users.info").filter(
    (c) => (c.args as { user: string }).user === "U1",
  );
  assertEquals(u1Calls.length, 1);
});

// Sanity: `expandChannelMembers` accepts the full `SlackClient` surface, not
// just the mock. This guarantees the helper compiles against the production
// type and will swap in cleanly when T-301 wires it up.
Deno.test("expandChannelMembers — typechecks against SlackClient (compile-time)", () => {
  const _accept = (client: SlackClient): Promise<ExpandChannelResult> =>
    expandChannelMembers(client, "C123");
  // No runtime assertion needed; if the function signature drifts, the
  // assignment will fail `deno check`.
  assertEquals(typeof _accept, "function");
});
