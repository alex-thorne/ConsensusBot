// ConsensusBot v2.0 — Integration tests for channel-member voter resolution.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8.2  (Voter resolution)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8.2.4 (channel-members source)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.2 (Integration tests row for
//                                                channel_members_integration_test)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md     T-506
//
// Acceptance:
//   deno test --allow-all tests/integration/channel_members_integration_test.ts
//
// Approach
// --------
// `create_decision` is wrapped by `SlackFunction(...)`. The SDK's wrapper calls
// `enrichContext(ctx)` on the way in, which discards any `client` carried on
// the test's context and substitutes a real `SlackAPI(token)` HTTP client. We
// therefore drive the function **end-to-end** by stubbing `globalThis.fetch`
// for the duration of each test and routing every Slack-API call to a
// `MockSlackClient`. The mock records the calls; we assert against them.
//
// Single-file ownership: T-506 owns ONLY this file.

import { assertEquals } from "@std/assert";

import createDecisionDefault from "../../functions/create_decision.ts";
import { MockSlackClient } from "../mocks/slack_client.ts";
import type { VoterRecord } from "../../types/decision_types.ts";
import type {
  ChatDeleteArgs,
  ChatPostEphemeralArgs,
  ChatPostMessageArgs,
  ChatUpdateArgs,
  ConversationsMembersArgs,
  DatastoreDeleteArgs,
  DatastoreGetArgs,
  DatastorePutArgs,
  DatastoreQueryArgs,
  PinsAddArgs,
  PinsListArgs,
  PinsRemoveArgs,
  UsergroupsListArgs,
  UsergroupsUsersListArgs,
  UsersInfoArgs,
} from "../../types/slack_types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Workspace tz for the integration sweep (matches MockSlackClient default). */
const WORKSPACE_TZ = "Europe/London";

/** Future YYYY-MM-DD; today is 2026-05-09 so this is well inside range. */
const FUTURE_DEADLINE = "2026-12-09";

/** Stub channel where the decision message lands. */
const CHANNEL_ID = "C1";

/** Stub creator_id for /consensus invocation. */
const CREATOR_ID = "U99";

// ---------------------------------------------------------------------------
// Body parsing helpers
// ---------------------------------------------------------------------------

/**
 * Pull the request body out of a `fetch(input, init)` call. The Slack API
 * client encodes parameters as `application/x-www-form-urlencoded`. We support
 * string, `URLSearchParams`, and the `Request.body` form (where the body has
 * already been streamed onto the request).
 */
async function readBody(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<string> {
  if (init?.body !== undefined && init?.body !== null) {
    if (typeof init.body === "string") return init.body;
    if (init.body instanceof URLSearchParams) return init.body.toString();
    return String(init.body);
  }
  if (input instanceof Request) {
    return await input.text();
  }
  return "";
}

/**
 * Decode an `application/x-www-form-urlencoded` body into a flat
 * `Record<string, unknown>`, JSON-parsing fields the Slack client emits as
 * JSON-encoded strings (`item`, `expression_attributes`, `expression_values`,
 * `blocks`) and coercing `limit` to a number.
 */
function parseFormBody(body: string): Record<string, unknown> {
  const params = new URLSearchParams(body);
  const out: Record<string, unknown> = {};
  for (const [k, v] of params.entries()) {
    if (
      k === "item" ||
      k === "expression_attributes" ||
      k === "expression_values" ||
      k === "blocks"
    ) {
      try {
        out[k] = JSON.parse(v);
        continue;
      } catch {
        // fall through to string copy
      }
    }
    if (k === "limit") {
      const n = Number(v);
      out[k] = Number.isNaN(n) ? v : n;
      continue;
    }
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetch → MockSlackClient bridge
// ---------------------------------------------------------------------------

/**
 * Build a `globalThis.fetch` shim that delegates every `https://slack.com/api/...`
 * call to the equivalent method on a {@link MockSlackClient}. Unrecognised URLs
 * resolve to `{ ok: false, error: "unrouted_url:..." }` so a missing route
 * fails the test loudly without throwing.
 *
 * The shim:
 *   - Extracts the API method name from the URL path component.
 *   - Decodes the form-encoded body via `parseFormBody`.
 *   - Calls the matching method on the mock and JSON-encodes the response.
 *   - Records nothing extra on its own — the mock already records every call.
 */
function makeFetchBridge(mock: MockSlackClient): typeof globalThis.fetch {
  return async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const m = url.match(/\/api\/([a-zA-Z._]+)$/);
    if (!m) {
      return new Response(
        JSON.stringify({ ok: false, error: `unrouted_url:${url}` }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const method = m[1];
    const bodyStr = await readBody(input, init);
    const args = parseFormBody(bodyStr);

    // The form-decoded payload is a `Record<string, unknown>`; the mock's
    // method signatures require concrete arg shapes. We bridge through
    // `unknown` (per the no-`any` constraint) — the mock's internal `#record`
    // recovers the full payload regardless.
    const a = args as unknown;
    let result: unknown;
    try {
      switch (method) {
        case "apps.datastore.get":
          result = await mock.apps.datastore.get(a as DatastoreGetArgs);
          break;
        case "apps.datastore.put":
          result = await mock.apps.datastore.put(
            a as DatastorePutArgs<Record<string, unknown>>,
          );
          break;
        case "apps.datastore.query":
          result = await mock.apps.datastore.query(a as DatastoreQueryArgs);
          break;
        case "apps.datastore.delete":
          result = await mock.apps.datastore.delete(a as DatastoreDeleteArgs);
          break;
        case "chat.postMessage":
          result = await mock.chat.postMessage(a as ChatPostMessageArgs);
          break;
        case "chat.postEphemeral":
          result = await mock.chat.postEphemeral(a as ChatPostEphemeralArgs);
          break;
        case "chat.update":
          result = await mock.chat.update(a as ChatUpdateArgs);
          break;
        case "chat.delete":
          result = await mock.chat.delete(a as ChatDeleteArgs);
          break;
        case "users.info":
          result = await mock.users.info(a as UsersInfoArgs);
          break;
        case "conversations.members":
          result = await mock.conversations.members(
            a as ConversationsMembersArgs,
          );
          break;
        case "pins.list":
          result = await mock.pins.list(a as PinsListArgs);
          break;
        case "pins.add":
          result = await mock.pins.add(a as PinsAddArgs);
          break;
        case "pins.remove":
          result = await mock.pins.remove(a as PinsRemoveArgs);
          break;
        case "usergroups.list":
          result = await mock.usergroups.list(a as UsergroupsListArgs);
          break;
        case "usergroups.users.list":
          result = await mock.usergroups.users.list(
            a as UsergroupsUsersListArgs,
          );
          break;
        case "team.info":
          result = await mock.team.info();
          break;
        default:
          result = { ok: false, error: `unrouted_method:${method}` };
      }
    } catch (err) {
      result = { ok: false, error: String(err) };
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

// ---------------------------------------------------------------------------
// Test driver
// ---------------------------------------------------------------------------

/**
 * Inputs passed to `create_decision`'s initial-execution handler. Mirrors
 * SPEC §8.1 with `channel_id`/`creator_id` injected from the trigger.
 */
interface DriveInputs {
  decision_name?: string;
  proposal?: string;
  required_voters?: string[];
  required_usergroups?: string;
  include_channel_members?: boolean;
  success_criteria?: string;
  deadline?: string;
  channel_id?: string;
  creator_id?: string;
  quorum_override?: number;
}

/**
 * Drive the SlackFunction-wrapped default export with a constructed context
 * and a fetch bridge that delegates to the supplied mock. Returns the
 * function's outcome (`{ completed: false }` on success, `{ error }` on
 * validation failure, etc.).
 */
async function runCreateDecision(
  mock: MockSlackClient,
  inputs: DriveInputs,
): Promise<unknown> {
  const fullInputs = {
    decision_name: "Decision",
    proposal: "Proposal body",
    required_voters: [] as string[],
    required_usergroups: "",
    include_channel_members: false,
    success_criteria: "simple_majority",
    deadline: FUTURE_DEADLINE,
    channel_id: CHANNEL_ID,
    creator_id: CREATOR_ID,
    ...inputs,
  };
  const ctx = {
    inputs: fullInputs,
    env: {} as Record<string, string>,
    token: "xoxb-mock-token",
    team_id: "T1",
    enterprise_id: "",
  };

  const original = globalThis.fetch;
  globalThis.fetch = makeFetchBridge(mock);
  try {
    // The SlackFunction wrapper's runtime type isn't exported in a way we can
    // import cleanly; the wrapper is callable as `(ctx) => ...`. We bridge
    // through `unknown` (no `any`, no `// @ts-ignore`).
    const callable = createDecisionDefault as unknown as (
      ctx: unknown,
    ) => Promise<unknown>;
    return await callable(ctx);
  } finally {
    globalThis.fetch = original;
  }
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** Type guard for `apps.datastore.put` args targeting the `voters` datastore. */
function isVoterPut(
  args: unknown,
): args is DatastorePutArgs<VoterRecord> {
  if (typeof args !== "object" || args === null) return false;
  const a = args as { datastore?: unknown; item?: unknown };
  if (a.datastore !== "voters") return false;
  if (typeof a.item !== "object" || a.item === null) return false;
  const item = a.item as { user_id?: unknown };
  return typeof item.user_id === "string";
}

/**
 * Pull every voter row written via `apps.datastore.put({ datastore: "voters" })`.
 * Returns the ordered list of `user_id`s — order is the order the
 * `create_decision` handler wrote them.
 */
function collectVoterUserIds(mock: MockSlackClient): string[] {
  const out: string[] = [];
  for (const c of mock.getCallsFor("apps.datastore.put")) {
    if (isVoterPut(c.args)) {
      out.push(c.args.item.user_id);
    }
  }
  return out;
}

/** Pre-load workspace tz on the mock and seed a "team1" team payload. */
function configureWorkspace(mock: MockSlackClient): void {
  mock.setTeamTz(WORKSPACE_TZ);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("channel expansion populates voters — three humans persisted", async () => {
  const mock = new MockSlackClient();
  configureWorkspace(mock);
  // Channel has three users; default `users.info` payloads make them human.
  mock.setChannelMembers(CHANNEL_ID, ["U1", "U2", "U3"]);

  const result = await runCreateDecision(mock, {
    required_voters: [],
    include_channel_members: true,
  });

  // The function should have completed successfully — no `error`.
  assertEquals((result as { error?: string }).error, undefined);

  // Three voter rows persisted, one per user.
  const voterIds = collectVoterUserIds(mock);
  assertEquals(voterIds.sort(), ["U1", "U2", "U3"]);
});

Deno.test("bot/USLACKBOT/deactivated users filtered out uniformly via channel source", async () => {
  const mock = new MockSlackClient();
  configureWorkspace(mock);
  // Five members: U1 human, U2 bot, USLACKBOT (id-blocked), U4 deleted, U5 human.
  mock.setChannelMembers(CHANNEL_ID, ["U1", "U2", "USLACKBOT", "U4", "U5"]);
  mock.setUserInfo("U2", { is_bot: true });
  mock.setUserDeleted("U4");
  // USLACKBOT is filtered by id even when `is_bot=false`. Set explicitly to
  // exercise the id-only branch (SPEC §8.2.3 footnote).
  mock.setUserInfo("USLACKBOT", { is_bot: false, deleted: false });

  const result = await runCreateDecision(mock, {
    required_voters: [],
    include_channel_members: true,
  });

  assertEquals((result as { error?: string }).error, undefined);

  const voterIds = collectVoterUserIds(mock);
  assertEquals(voterIds.sort(), ["U1", "U5"]);
});

Deno.test("dedup with individual + usergroup + channel — union written exactly once", async () => {
  const mock = new MockSlackClient();
  configureWorkspace(mock);

  // Individual voters: U1, U2.
  // Usergroup G1 members:    U2, U3.
  // Channel members:         U3, U4.
  // Expected union (deduped): {U1, U2, U3, U4}.
  mock.setUsergroupMembers("S001", ["U2", "U3"]);
  mock.setChannelMembers(CHANNEL_ID, ["U3", "U4"]);

  const result = await runCreateDecision(mock, {
    required_voters: ["U1", "U2"],
    // Pass usergroup as a raw <!subteam^…> mention (parseUsergroupInput
    // accepts mention syntax, IDs, or @handles).
    required_usergroups: "<!subteam^S001>",
    include_channel_members: true,
  });

  assertEquals((result as { error?: string }).error, undefined);

  const voterIds = collectVoterUserIds(mock);
  assertEquals(voterIds.sort(), ["U1", "U2", "U3", "U4"]);
  // Exactly one row per user — no duplicates.
  assertEquals(voterIds.length, 4);
});

Deno.test("pagination via next_cursor — 50 members across 3 pages all persisted", async () => {
  const mock = new MockSlackClient();
  configureWorkspace(mock);

  // 50 unique humans; default users.info responses keep them all human.
  const members = Array.from({ length: 50 }, (_, i) => `U${i + 1}`);
  mock.setChannelMembers(CHANNEL_ID, members);
  // Page size 20 → 20/20/10 across 3 pages.
  mock.enableChannelMemberPagination(CHANNEL_ID, 20);

  const result = await runCreateDecision(mock, {
    required_voters: [],
    include_channel_members: true,
  });

  assertEquals((result as { error?: string }).error, undefined);

  const voterIds = collectVoterUserIds(mock);
  assertEquals(voterIds.length, 50);
  assertEquals(new Set(voterIds).size, 50);

  // Three paginated `conversations.members` calls were made.
  const memberCalls = mock.getCallsFor("conversations.members");
  assertEquals(memberCalls.length, 3);
  const cursors = memberCalls.map((c) =>
    (c.args as { cursor?: string }).cursor
  );
  assertEquals(cursors, [undefined, "20", "40"]);
});

Deno.test("backward-compat — `include_channel_members=false` issues no conversations.members", async () => {
  const mock = new MockSlackClient();
  configureWorkspace(mock);
  // Channel has members but we MUST NOT consult them with the flag false.
  mock.setChannelMembers(CHANNEL_ID, ["U2", "U3", "U4"]);

  const result = await runCreateDecision(mock, {
    required_voters: ["U1"],
    include_channel_members: false,
  });

  assertEquals((result as { error?: string }).error, undefined);

  // Zero `conversations.members` calls — no expansion attempted.
  assertEquals(mock.getCallsFor("conversations.members").length, 0);

  // And the only voter is the individual U1.
  const voterIds = collectVoterUserIds(mock);
  assertEquals(voterIds, ["U1"]);
});

Deno.test("end-to-end combined flow — individual + usergroup + channel union after bot filter", async () => {
  const mock = new MockSlackClient();
  configureWorkspace(mock);

  // Individual:   U1, U2.
  // Usergroup G1: U3, U4.
  // Channel:      U5, U6 (bot), U7.
  // Expected union after bot filter and dedup: {U1, U2, U3, U4, U5, U7} → 6.
  mock.setUsergroupMembers("S100", ["U3", "U4"]);
  mock.setChannelMembers(CHANNEL_ID, ["U5", "U6", "U7"]);
  mock.setUserInfo("U6", { is_bot: true });

  const result = await runCreateDecision(mock, {
    required_voters: ["U1", "U2"],
    required_usergroups: "<!subteam^S100>",
    include_channel_members: true,
  });

  assertEquals((result as { error?: string }).error, undefined);

  const voterIds = collectVoterUserIds(mock);
  assertEquals(voterIds.sort(), ["U1", "U2", "U3", "U4", "U5", "U7"]);
  assertEquals(voterIds.length, 6);
});
