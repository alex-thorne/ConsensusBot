// ConsensusBot v2.0 — Integration tests for `create_decision`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8  (full create_decision flow)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16 (eventual consistency, finalized_at)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.2 (integration test contract)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md  T-502 (this task)
//
// Test approach
// -------------
//
// `functions/create_decision.ts` exports the SlackFunction-wrapped function as
// its default export. The wrapper is a function `(ctx) => ...` that internally
// calls `enrichContext(ctx)` (from the SDK) which **discards** any user-supplied
// `ctx.client` and constructs a fresh `SlackAPI(token)` web client. That client
// makes real `fetch()` calls to `https://slack.com/api/<method>`.
//
// To drive the function with a `MockSlackClient` we therefore:
//
//   1. Patch `globalThis.fetch` for the duration of each test.
//   2. Parse each request URL → method name (e.g. `apps.datastore.put`).
//   3. Decode the SDK's URL-encoded form body. Object/array fields (`item`,
//      `expression_values`, `blocks`, …) are JSON-stringified by the SDK on
//      the way out, so we JSON.parse them on the way in.
//   4. Dispatch to the corresponding `MockSlackClient` method.
//   5. Serialise the mock's response back as a JSON Response.
//
// Block-action handlers (vote / cancel / delete) are dispatched via
// `default.blockActions.call(default, ctx)` — `blockActions` is a method bound
// to the wrapper instance (it does `this.matchHandler(...)`), so we use
// `Function.prototype.call` with the wrapper as `this`.
//
// What this gets us: the real production code paths inside
// `functions/create_decision.ts` are exercised end-to-end against an in-memory
// datastore + chat. No code paths are inlined or replicated.
//
// Acceptance:
//   deno test --allow-all tests/integration/create_decision_test.ts

import { assert, assertEquals, assertMatch } from "@std/assert";

import createDecision from "../../functions/create_decision.ts";
import { MockSlackClient } from "../mocks/slack_client.ts";
import type {
  DecisionRecord,
  VoteRecord,
  VoterRecord,
} from "../../types/decision_types.ts";
import type {
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
} from "../../types/slack_types.ts";

// ---------------------------------------------------------------------------
// UUID regex (RFC-4122 v4-shaped) — used by Test 1 to assert decision_id format.
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Fetch bridge — routes Slack web-API calls to a `MockSlackClient`.
// ---------------------------------------------------------------------------

/**
 * Decode the SDK's URL-encoded request body into a plain object.
 *
 * The deno-slack-api 2.8 client serialises bodies as `URLSearchParams` with
 * `Content-Type: application/x-www-form-urlencoded`. Top-level scalar fields
 * are passed through; nested objects/arrays (`item`, `blocks`, `attachments`,
 * `expression_attributes`, `expression_values`) are JSON-stringified.
 */
function decodeBody(init: RequestInit | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const body = init?.body;
  if (!body) return out;

  const parseStringValue = (key: string, raw: string): unknown => {
    if (key === "limit") {
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : raw;
    }
    if (raw === "true") return true;
    if (raw === "false") return false;
    // Best-effort JSON parse for nested fields. Falling back to the raw string
    // is fine — `String(body.x)` callers below tolerate either shape.
    if (
      key === "item" ||
      key === "blocks" ||
      key === "attachments" ||
      key === "expression_attributes" ||
      key === "expression_values"
    ) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  };

  if (body instanceof URLSearchParams) {
    for (const [k, v] of body.entries()) out[k] = parseStringValue(k, v);
    return out;
  }
  if (body instanceof FormData) {
    for (const [k, v] of body.entries()) {
      if (typeof v === "string") out[k] = parseStringValue(k, v);
      else out[k] = v;
    }
    return out;
  }
  if (typeof body === "string") {
    try {
      Object.assign(out, JSON.parse(body));
    } catch {
      // ignore — not JSON
    }
    return out;
  }
  return out;
}

/**
 * Dispatch a single decoded Slack web-API call to the corresponding
 * `MockSlackClient` method. Throws on unrecognised methods so test authors
 * notice when a new SDK call appears.
 */
async function dispatch(
  client: MockSlackClient,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const cursor = typeof body.cursor === "string" ? body.cursor : undefined;
  const limit = typeof body.limit === "number" ? body.limit : undefined;

  switch (method) {
    case "team.info":
      return await client.team.info();

    case "users.info":
      return await client.users.info({ user: String(body.user ?? "") });

    case "usergroups.list": {
      const args: UsergroupsListArgs = { cursor, limit };
      return await client.usergroups.list(args);
    }

    case "usergroups.users.list": {
      const args: UsergroupsUsersListArgs = {
        usergroup: String(body.usergroup ?? ""),
        cursor,
        limit,
      };
      return await client.usergroups.users.list(args);
    }

    case "conversations.members": {
      const args: ConversationsMembersArgs = {
        channel: String(body.channel ?? ""),
        cursor,
        limit,
      };
      return await client.conversations.members(args);
    }

    case "chat.postMessage": {
      const args: ChatPostMessageArgs = {
        channel: String(body.channel ?? ""),
        text: typeof body.text === "string" ? body.text : undefined,
        blocks: Array.isArray(body.blocks)
          ? (body.blocks as ChatPostMessageArgs["blocks"])
          : undefined,
        thread_ts: typeof body.thread_ts === "string"
          ? body.thread_ts
          : undefined,
      };
      return await client.chat.postMessage(args);
    }

    case "chat.postEphemeral":
      return await client.chat.postEphemeral({
        channel: String(body.channel ?? ""),
        user: String(body.user ?? ""),
        text: typeof body.text === "string" ? body.text : undefined,
      });

    case "chat.update": {
      const args: ChatUpdateArgs = {
        channel: String(body.channel ?? ""),
        ts: String(body.ts ?? ""),
        text: typeof body.text === "string" ? body.text : undefined,
        blocks: Array.isArray(body.blocks)
          ? (body.blocks as ChatUpdateArgs["blocks"])
          : undefined,
      };
      return await client.chat.update(args);
    }

    case "chat.delete":
      return await client.chat.delete({
        channel: String(body.channel ?? ""),
        ts: String(body.ts ?? ""),
      });

    case "pins.list": {
      const args: PinsListArgs = { channel: String(body.channel ?? "") };
      return await client.pins.list(args);
    }

    case "pins.add": {
      const args: PinsAddArgs = {
        channel: String(body.channel ?? ""),
        timestamp: String(body.timestamp ?? ""),
      };
      return await client.pins.add(args);
    }

    case "pins.remove": {
      const args: PinsRemoveArgs = {
        channel: String(body.channel ?? ""),
        timestamp: String(body.timestamp ?? ""),
      };
      return await client.pins.remove(args);
    }

    case "apps.datastore.get": {
      const args: DatastoreGetArgs = {
        datastore: String(body.datastore ?? ""),
        id: String(body.id ?? ""),
      };
      return await client.apps.datastore.get(args);
    }

    case "apps.datastore.put": {
      const args: DatastorePutArgs<unknown> = {
        datastore: String(body.datastore ?? ""),
        item: body.item,
      };
      return await client.apps.datastore.put(args);
    }

    case "apps.datastore.query": {
      const args: DatastoreQueryArgs = {
        datastore: String(body.datastore ?? ""),
        expression: typeof body.expression === "string"
          ? body.expression
          : undefined,
        expression_attributes: body.expression_attributes as DatastoreQueryArgs[
          "expression_attributes"
        ],
        expression_values: body.expression_values as DatastoreQueryArgs[
          "expression_values"
        ],
        cursor,
        limit,
      };
      return await client.apps.datastore.query(args);
    }

    case "apps.datastore.delete": {
      const args: DatastoreDeleteArgs = {
        datastore: String(body.datastore ?? ""),
        id: String(body.id ?? ""),
      };
      return await client.apps.datastore.delete(args);
    }

    default:
      throw new Error(`fetch bridge: unsupported method "${method}"`);
  }
}

/**
 * Install a `globalThis.fetch` patch that routes Slack web-API calls to
 * `client`. Returns a disposer that restores the previous `fetch`.
 */
function installFetchBridge(client: MockSlackClient): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (
    input: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    const m = /\/api\/([a-zA-Z._]+)/.exec(url);
    if (!m) {
      // Pass through any non-Slack fetch.
      return await realFetch(input, init);
    }
    const method = m[1];
    const body = decodeBody(init);
    let result: unknown;
    try {
      result = await dispatch(client, method, body);
    } catch (err) {
      result = { ok: false, error: String(err) };
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick a deadline calendar date `nDays` ahead in UTC, formatted `YYYY-MM-DD`.
 * Used by tests that need the deadline simply to be in the future.
 */
function futureDate(nDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + nDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Drive the SlackFunction-wrapped default export with a synthetic function
 * context. The SDK's enrichContext discards `client`, so we don't pass one —
 * the bridge installed by `installFetchBridge` takes its place.
 */
async function driveCreate(
  inputs: Record<string, unknown>,
): Promise<unknown> {
  // The SDK takes a single positional context object. We treat the wrapper as
  // an opaque async function rather than typing the SDK's broader internals.
  const fn = createDecision as unknown as (ctx: unknown) => Promise<unknown>;
  return await fn({
    inputs,
    env: {},
    token: "xoxb-test",
    team_id: "T_TEST",
    enterprise_id: "",
  });
}

/**
 * Drive a block-action handler chained on the function. `default.blockActions`
 * is a method on the wrapper instance — it dispatches via `this.matchHandler`,
 * so we invoke it with `Function.prototype.call`.
 */
async function driveBlockAction(
  actionId: string,
  decisionId: string,
  args: { userId: string; channelId: string; messageTs: string },
): Promise<void> {
  // The SlackFunction wrapper attaches `blockActions` as a method on itself
  // and references `this.matchHandler` internally — we therefore have to
  // invoke it via `Function.prototype.call(wrapper, ctx)`. Typing it through
  // `unknown` keeps `any` out of the test surface.
  const wrapper = createDecision as unknown as {
    blockActions: (this: unknown, ctx: unknown) => Promise<void>;
  };
  const ctx = {
    action: { action_id: actionId, value: decisionId },
    body: {
      user: { id: args.userId },
      container: { channel_id: args.channelId, message_ts: args.messageTs },
    },
    env: {},
    token: "xoxb-test",
    team_id: "T_TEST",
    enterprise_id: "",
  };
  await wrapper.blockActions.call(wrapper, ctx);
}

/**
 * Common voter-context inputs. Tests override individual fields.
 */
function baseInputs(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    decision_name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    required_voters: ["U1"],
    required_usergroups: "",
    include_channel_members: false,
    success_criteria: "simple_majority",
    deadline: futureDate(30),
    channel_id: "C0001",
    creator_id: "U_ALICE",
    ...over,
  };
}

/**
 * Pull the most-recent decision row written to the `decisions` table from a
 * mock's recorded `apps.datastore.put` calls.
 */
function getLastDecisionPut(mock: MockSlackClient): DecisionRecord | undefined {
  const puts = mock.getCallsFor("apps.datastore.put");
  for (let i = puts.length - 1; i >= 0; i--) {
    const args = puts[i].args as DatastorePutArgs<unknown>;
    if (args.datastore === "decisions") {
      return args.item as DecisionRecord;
    }
  }
  return undefined;
}

/**
 * All voter rows written to the `voters` table, in put order.
 */
function getVoterPuts(mock: MockSlackClient): VoterRecord[] {
  const out: VoterRecord[] = [];
  for (const c of mock.getCallsFor("apps.datastore.put")) {
    const args = c.args as DatastorePutArgs<unknown>;
    if (args.datastore === "voters") out.push(args.item as VoterRecord);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Test 1 — UUID format on `decision_id` (SPEC §8.4 step 1).
// ---------------------------------------------------------------------------

Deno.test("create_decision — persisted decision_id matches the canonical UUID regex", async () => {
  const mock = new MockSlackClient();
  mock.setUserInfo("U1", { is_bot: false, deleted: false });
  const restore = installFetchBridge(mock);
  try {
    const result = await driveCreate(
      baseInputs({ required_voters: ["U1"], deadline: futureDate(14) }),
    );
    // SPEC §8.7 — successful create returns `{ completed: false }`.
    assertEquals(result, { completed: false });

    const decision = getLastDecisionPut(mock);
    assert(decision !== undefined, "expected a decision row to be persisted");
    assertMatch(decision.id, UUID_RE);
    // The same UUID is also emitted as each button's `value` in chat.postMessage.
    const post = mock.getCallsFor("chat.postMessage")[0]
      ?.args as ChatPostMessageArgs;
    assert(post !== undefined, "expected chat.postMessage to have been called");
    const blocks = post.blocks ?? [];
    const actions = blocks.find((b) => b.type === "actions");
    assert(
      actions !== undefined && "elements" in actions,
      "expected an actions block",
    );
    for (const el of actions.elements) {
      if ("action_id" in el && typeof el.value === "string") {
        assertEquals(el.value, decision.id);
        assertMatch(el.value, UUID_RE);
      }
    }
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Test 2 — TZ-resolved deadline (SPEC §8.3, §19).
// ---------------------------------------------------------------------------

Deno.test("create_decision — GMT deadline resolves to 23:59:59.999Z", async () => {
  const mock = new MockSlackClient();
  mock.setTeamTz("Europe/London");
  mock.setUserInfo("U1", { is_bot: false, deleted: false });
  const restore = installFetchBridge(mock);
  try {
    // 9 December 2026 is GMT (no DST). End-of-day local == end-of-day UTC.
    const result = await driveCreate(
      baseInputs({ required_voters: ["U1"], deadline: "2026-12-09" }),
    );
    assertEquals(result, { completed: false });

    const decision = getLastDecisionPut(mock);
    assert(decision !== undefined);
    assert(
      decision.deadline_resolved.endsWith("23:59:59.999Z"),
      `GMT deadline expected to end with 23:59:59.999Z; got ${decision.deadline_resolved}`,
    );
    assertEquals(decision.deadline_tz, "Europe/London");

    // Block Kit message renders the human deadline including the tz abbrev.
    const post = mock.getCallsFor("chat.postMessage")[0]
      ?.args as ChatPostMessageArgs;
    const serialised = JSON.stringify(post.blocks ?? []);
    assert(
      /\bGMT\b/.test(serialised),
      `expected the rendered message to mention GMT; got: ${
        serialised.slice(0, 400)
      }`,
    );
  } finally {
    restore();
  }
});

Deno.test("create_decision — BST deadline resolves to 22:59:59.999Z and renders BST", async () => {
  const mock = new MockSlackClient();
  mock.setTeamTz("Europe/London");
  mock.setUserInfo("U1", { is_bot: false, deleted: false });
  const restore = installFetchBridge(mock);
  try {
    // Pick a date that is firmly inside BST (mid-July) and far enough out to
    // never be in the past on the test runner's clock.
    const result = await driveCreate(
      baseInputs({ required_voters: ["U1"], deadline: "2099-07-15" }),
    );
    assertEquals(result, { completed: false });

    const decision = getLastDecisionPut(mock);
    assert(decision !== undefined);
    assert(
      decision.deadline_resolved.endsWith("22:59:59.999Z"),
      `BST deadline expected to end with 22:59:59.999Z; got ${decision.deadline_resolved}`,
    );
    assertEquals(decision.deadline_tz, "Europe/London");

    const post = mock.getCallsFor("chat.postMessage")[0]
      ?.args as ChatPostMessageArgs;
    const serialised = JSON.stringify(post.blocks ?? []);
    assert(
      /\bBST\b/.test(serialised),
      `expected the rendered message to mention BST; got: ${
        serialised.slice(0, 400)
      }`,
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Test 3 — Bot/USLACKBOT/deleted filter is uniform across voter sources
// (SPEC §8.2.3, audit invariant 14).
// ---------------------------------------------------------------------------

Deno.test("create_decision — bot, deleted, and USLACKBOT users are excluded uniformly", async () => {
  const mock = new MockSlackClient();
  mock.setTeamTz("Europe/London");
  // Individual humans
  mock.setUserInfo("U_HUMAN_1", { is_bot: false, deleted: false });
  mock.setUserInfo("U_HUMAN_2", { is_bot: false, deleted: false });
  // Filtered-out cases
  mock.setUserInfo("U_BOT", { is_bot: true });
  mock.setUserInfo("U_DELETED", {});
  mock.setUserDeleted("U_DELETED");
  // USLACKBOT — even without is_bot:true the filter MUST exclude it.
  mock.setUserInfo("USLACKBOT", { is_bot: false, deleted: false });

  // Add a usergroup whose members include a deleted user, to exercise the
  // bot-filter on the usergroup expansion path as well.
  mock.setUsergroupsList([{ id: "S100", handle: "team", name: "Team" }]);
  mock.setUsergroupMembers("S100", ["U_HUMAN_2", "U_BOT", "U_DELETED"]);

  const restore = installFetchBridge(mock);
  try {
    const result = await driveCreate(
      baseInputs({
        required_voters: ["U_HUMAN_1", "U_BOT", "USLACKBOT"],
        required_usergroups: "@team",
      }),
    );
    assertEquals(result, { completed: false });

    const decision = getLastDecisionPut(mock);
    assert(decision !== undefined);
    // R counts only the two humans; the bot, deleted, and USLACKBOT entries
    // are filtered uniformly across the individual + usergroup sources.
    assertEquals(decision.required_voters_count, 2);

    const voterRows = getVoterPuts(mock);
    const persistedVoterIds = voterRows.map((v) => v.user_id).sort();
    assertEquals(persistedVoterIds, ["U_HUMAN_1", "U_HUMAN_2"]);

    // Sanity: the filtered IDs should NOT appear in any voter row.
    for (const v of voterRows) {
      assert(
        v.user_id !== "U_BOT" && v.user_id !== "USLACKBOT" &&
          v.user_id !== "U_DELETED",
        `unexpected non-human voter row: ${v.user_id}`,
      );
    }
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Test 4 — quorum override of 0 falls back to criterion default
// (Issue: quorum_override UX; SPEC §8.3 default quorum rules).
// ---------------------------------------------------------------------------

Deno.test("create_decision — quorum_override 0 uses default quorum", async () => {
  const mock = new MockSlackClient();
  mock.setTeamTz("Europe/London");
  mock.setUserInfo("U1", { is_bot: false, deleted: false });
  mock.setUserInfo("U2", { is_bot: false, deleted: false });
  mock.setUserInfo("U3", { is_bot: false, deleted: false });
  const restore = installFetchBridge(mock);
  try {
    const result = await driveCreate(
      baseInputs({
        required_voters: ["U1", "U2", "U3"],
        success_criteria: "simple_majority",
        quorum_override: 0,
      }),
    );
    assertEquals(result, { completed: false });

    const decision = getLastDecisionPut(mock);
    assert(decision !== undefined);
    assertEquals(decision.required_voters_count, 3);
    assertEquals(decision.quorum, 2);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Test 5 — negative quorum override falls back to criterion default
// (Issue: quorum_override UX; SPEC §8.3 default quorum rules).
// ---------------------------------------------------------------------------

Deno.test("create_decision — negative quorum_override uses default quorum", async () => {
  const mock = new MockSlackClient();
  mock.setTeamTz("Europe/London");
  mock.setUserInfo("U1", { is_bot: false, deleted: false });
  mock.setUserInfo("U2", { is_bot: false, deleted: false });
  mock.setUserInfo("U3", { is_bot: false, deleted: false });
  const restore = installFetchBridge(mock);
  try {
    const result = await driveCreate(
      baseInputs({
        required_voters: ["U1", "U2", "U3"],
        success_criteria: "simple_majority",
        quorum_override: -3,
      }),
    );
    assertEquals(result, { completed: false });

    const decision = getLastDecisionPut(mock);
    assert(decision !== undefined);
    assertEquals(decision.required_voters_count, 3);
    assertEquals(decision.quorum, 2);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Test 6 — Datastore put failure on the decision row aborts cleanly
// (SPEC §8.4 step 3, audit invariant 12).
// ---------------------------------------------------------------------------

Deno.test("create_decision — failed datastore put on decision row returns error and writes nothing else", async () => {
  const mock = new MockSlackClient();
  mock.setTeamTz("Europe/London");
  mock.setUserInfo("U1", { is_bot: false, deleted: false });
  mock.forceFailure("apps.datastore.put", "internal_error");

  const restore = installFetchBridge(mock);
  try {
    const result = await driveCreate(
      baseInputs({ required_voters: ["U1"], deadline: futureDate(14) }),
    ) as { error?: string; completed?: boolean };
    assert(typeof result.error === "string", "expected an error response");
    assertMatch(result.error, /Failed to create decision/);

    // No voter rows were attempted (the decision put came first and failed).
    const voterRows = getVoterPuts(mock);
    assertEquals(voterRows.length, 0);

    // No message was posted.
    assertEquals(mock.getCallsFor("chat.postMessage").length, 0);

    // Exactly one decision-row put attempt was made (the failing one).
    const decisionPuts = mock
      .getCallsFor("apps.datastore.put")
      .filter((c) =>
        (c.args as DatastorePutArgs<unknown>).datastore === "decisions"
      );
    assertEquals(decisionPuts.length, 1);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Test 7 — `chat.postMessage` failure rolls every datastore row back
// (SPEC §8.4 step 5).
// ---------------------------------------------------------------------------

Deno.test("create_decision — chat.postMessage failure rolls back decision + voter rows", async () => {
  const mock = new MockSlackClient();
  mock.setTeamTz("Europe/London");
  mock.setUserInfo("U1", { is_bot: false, deleted: false });
  mock.setUserInfo("U2", { is_bot: false, deleted: false });
  mock.forceFailure("chat.postMessage", "channel_not_found");

  const restore = installFetchBridge(mock);
  try {
    const result = await driveCreate(
      baseInputs({
        required_voters: ["U1", "U2"],
        deadline: futureDate(14),
      }),
    ) as { error?: string; completed?: boolean };
    assert(typeof result.error === "string", "expected an error response");
    assertMatch(result.error, /Failed to post decision message/);

    // Inspect rollback. Every voter row that was put earlier must be deleted,
    // along with the decision row itself.
    const deletes = mock.getCallsFor("apps.datastore.delete");
    const datastoresDeleted = deletes.map(
      (c) => (c.args as DatastoreDeleteArgs).datastore,
    );
    // Decision row is the canary — it MUST appear in the delete list.
    assert(
      datastoresDeleted.includes("decisions"),
      `expected a delete on "decisions"; got ${
        JSON.stringify(datastoresDeleted)
      }`,
    );
    // Two voter rows were written, so two voter deletes are expected.
    const voterDeletes = deletes.filter(
      (c) => (c.args as DatastoreDeleteArgs).datastore === "voters",
    );
    assertEquals(voterDeletes.length, 2);

    // The voter rows targeted by the deletes match the IDs that were put.
    const voterIdsDeleted = voterDeletes
      .map((c) => (c.args as DatastoreDeleteArgs).id)
      .sort();
    const voterIdsPut = getVoterPuts(mock).map((v) => v.id).sort();
    assertEquals(voterIdsDeleted, voterIdsPut);

    // After rollback, neither the decision nor any voter remains in the store.
    const decisionGet = await mock.apps.datastore.get<DecisionRecord>({
      datastore: "decisions",
      id: voterIdsPut[0].split("_")[0],
    });
    assert(
      decisionGet.ok && decisionGet.item === undefined,
      "decision row should have been deleted by rollback",
    );
    for (const vid of voterIdsPut) {
      const got = await mock.apps.datastore.get<VoterRecord>({
        datastore: "voters",
        id: vid,
      });
      assert(
        got.ok && got.item === undefined,
        `voter row ${vid} should have been deleted by rollback`,
      );
    }
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Test 8 — Eventual-consistency vote-merge (SPEC §16.1 / §16.2).
// ---------------------------------------------------------------------------
//
// These three cases drive the chained `vote_yes` / `vote_no` block-action
// handler to verify the read-after-write merge defined in SPEC §16. The mock's
// `setDatastoreQueryResults` returns a stale view of the `votes` table even
// after a fresh put; the handler's `mergedVotes` array must reconcile this.

Deno.test("create_decision (vote merge) — adds the just-cast vote when the post-put query returns empty", async () => {
  const mock = new MockSlackClient();
  mock.setTeamTz("Europe/London");

  // Pre-seed an active decision with two required voters. R = 2, quorum = 1.
  const decisionId = "11111111-2222-3333-4444-555555555555";
  const decision: DecisionRecord = {
    id: decisionId,
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "simple_majority",
    quorum: 1,
    required_voters_count: 2,
    deadline: futureDate(14),
    deadline_resolved: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(),
    deadline_tz: "Europe/London",
    channel_id: "C0001",
    creator_id: "U_ALICE",
    message_ts: "1715170800.000100",
    status: "active",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-08T09:00:00.000Z",
  };
  mock.setDatastoreItem(
    "decisions",
    decision as unknown as { id: string } & Record<string, unknown>,
  );
  // U1 & U2 are eligible voters; only U1 will click yes here.
  mock.setDatastoreItem("voters", {
    id: `${decisionId}_U1`,
    decision_id: decisionId,
    user_id: "U1",
    is_active: true,
    created_at: decision.created_at,
  });
  mock.setDatastoreItem("voters", {
    id: `${decisionId}_U2`,
    decision_id: decisionId,
    user_id: "U2",
    is_active: true,
    created_at: decision.created_at,
  });
  // EVENTUAL-CONSISTENCY HOLE: the query returns an EMPTY votes list even
  // after the handler put a fresh row. The merge must still surface U1's vote.
  mock.setDatastoreQueryResults("votes", []);

  const restore = installFetchBridge(mock);
  try {
    await driveBlockAction("vote_yes", decisionId, {
      userId: "U1",
      channelId: "C0001",
      messageTs: "1715170800.000100",
    });

    // The post-vote chat.update reflects mergedVotes = [U1's just-cast vote].
    const update = mock
      .getCallsFor("chat.update")
      .map((c) => c.args as ChatUpdateArgs)
      .at(-1);
    assert(update !== undefined, "expected a chat.update call after the vote");
    const blocks = update.blocks ?? [];
    const serialised = JSON.stringify(blocks);
    // SPEC §9 step 9 — `*Votes:* 1/2` and `<@U1>` appear in the merged status.
    assert(
      serialised.includes("*Votes:* 1/2"),
      `expected merged vote count 1/2 in chat.update blocks; got: ${serialised}`,
    );
    assert(
      serialised.includes("<@U1>"),
      `expected <@U1> mention in chat.update blocks; got: ${serialised}`,
    );
  } finally {
    restore();
  }
});

Deno.test("create_decision (vote merge) — replaces a stale vote row with the just-cast vote", async () => {
  const mock = new MockSlackClient();
  mock.setTeamTz("Europe/London");

  // R = 3 so a single no vote does NOT deadlock simple-majority — the
  // post-vote chat.update reflects the active-with-1-vote intermediate state
  // and we can read the merged vote out of it.
  const decisionId = "22222222-3333-4444-5555-666666666666";
  const decision: DecisionRecord = {
    id: decisionId,
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "simple_majority",
    quorum: 2,
    required_voters_count: 3,
    deadline: futureDate(14),
    deadline_resolved: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(),
    deadline_tz: "Europe/London",
    channel_id: "C0001",
    creator_id: "U_ALICE",
    message_ts: "1715170800.000200",
    status: "active",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-08T09:00:00.000Z",
  };
  mock.setDatastoreItem(
    "decisions",
    decision as unknown as { id: string } & Record<string, unknown>,
  );
  for (const uid of ["U1", "U2", "U3"]) {
    mock.setDatastoreItem("voters", {
      id: `${decisionId}_${uid}`,
      decision_id: decisionId,
      user_id: uid,
      is_active: true,
      created_at: decision.created_at,
    });
  }
  // U1 has already voted YES previously (we'll simulate a vote-change to NO).
  mock.setDatastoreItem("votes", {
    id: `${decisionId}_U1`,
    decision_id: decisionId,
    user_id: "U1",
    vote_type: "yes",
    voted_at: "2026-05-08T10:00:00.000Z",
  });
  // EVENTUAL-CONSISTENCY HOLE: post-put query returns U1's STALE "yes" row.
  mock.setDatastoreQueryResults("votes", [
    {
      id: `${decisionId}_U1`,
      decision_id: decisionId,
      user_id: "U1",
      vote_type: "yes",
      voted_at: "2026-05-08T10:00:00.000Z",
    } as unknown as Record<string, unknown>,
  ]);

  const restore = installFetchBridge(mock);
  try {
    await driveBlockAction("vote_no", decisionId, {
      userId: "U1",
      channelId: "C0001",
      messageTs: "1715170800.000200",
    });

    // The latest persisted votes row is U1 = "no" (overwrote the stale "yes").
    const votePuts = mock
      .getCallsFor("apps.datastore.put")
      .map((c) => c.args as DatastorePutArgs<unknown>)
      .filter((a) => a.datastore === "votes")
      .map((a) => a.item as VoteRecord);
    const u1Vote = votePuts.find((v) => v.user_id === "U1");
    assert(u1Vote !== undefined, "expected a votes-table put for U1");
    assertEquals(u1Vote.vote_type, "no");

    // The post-vote chat.update STILL only counts U1 as one voter (not two)
    // — the stale "yes" row was filtered out and replaced by the new "no".
    const update = mock
      .getCallsFor("chat.update")
      .map((c) => c.args as ChatUpdateArgs)
      .at(-1);
    assert(update !== undefined);
    const serialised = JSON.stringify(update.blocks ?? []);
    assert(
      serialised.includes("*Votes:* 1/3"),
      `expected merged vote count 1/3 (no double-counting); got: ${serialised}`,
    );
  } finally {
    restore();
  }
});

Deno.test("create_decision (vote merge) — finalisation gate uses mergedVotes (no extra votes query)", async () => {
  const mock = new MockSlackClient();
  mock.setTeamTz("Europe/London");

  // R = 1 — the very first vote completes quorum, triggering finalisation.
  const decisionId = "33333333-4444-5555-6666-777777777777";
  const decision: DecisionRecord = {
    id: decisionId,
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "simple_majority",
    quorum: 1,
    required_voters_count: 1,
    deadline: futureDate(14),
    deadline_resolved: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(),
    deadline_tz: "Europe/London",
    channel_id: "C0001",
    creator_id: "U_ALICE",
    message_ts: "1715170800.000300",
    status: "active",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-08T09:00:00.000Z",
  };
  mock.setDatastoreItem(
    "decisions",
    decision as unknown as { id: string } & Record<string, unknown>,
  );
  mock.setDatastoreItem("voters", {
    id: `${decisionId}_U1`,
    decision_id: decisionId,
    user_id: "U1",
    is_active: true,
    created_at: decision.created_at,
  });
  // The post-vote query returns an empty list — eventual consistency in action.
  // If `checkIfShouldFinalize` mistakenly issued ANOTHER votes query, it would
  // see `mergedVotes.length === 0` and refuse to finalise — but the real
  // gate uses the in-memory mergedVotes (length 1) and proceeds.
  mock.setDatastoreQueryResults("votes", []);

  const restore = installFetchBridge(mock);
  try {
    // Snapshot the votes-query call count before driving the action.
    const queriesBefore = mock
      .getCallsFor("apps.datastore.query")
      .filter((c) => (c.args as DatastoreQueryArgs).datastore === "votes")
      .length;

    await driveBlockAction("vote_yes", decisionId, {
      userId: "U1",
      channelId: "C0001",
      messageTs: "1715170800.000300",
    });

    // SPEC §16.2 — exactly ONE post-put `votes` query (the merge step). The
    // gate must NOT issue an extra one.
    const queriesAfter = mock
      .getCallsFor("apps.datastore.query")
      .filter((c) => (c.args as DatastoreQueryArgs).datastore === "votes")
      .length;
    assertEquals(queriesAfter - queriesBefore, 1);

    // Finalisation actually ran: the decision row was updated and the
    // finalised message was posted.
    const finalised = (mock
      .getCallsFor("apps.datastore.put")
      .map((c) => c.args as DatastorePutArgs<unknown>)
      .filter((a) => a.datastore === "decisions")
      .at(-1)?.item ?? undefined) as DecisionRecord | undefined;
    assert(finalised !== undefined, "expected a decisions put on finalisation");
    assert(
      finalised.status === "approved" || finalised.status === "rejected",
      `expected finalised status; got ${finalised.status}`,
    );
    assert(
      typeof finalised.finalized_at === "string" &&
        finalised.finalized_at.length > 0,
      "expected finalized_at idempotency token to be set",
    );
  } finally {
    restore();
  }
});
