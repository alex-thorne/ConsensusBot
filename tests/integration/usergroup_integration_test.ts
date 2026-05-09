// ConsensusBot v2.0 — Integration tests for usergroup expansion in
// `create_decision`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8.2  (voter resolution algorithm)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §14   (parsing / escape utilities)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.2 (integration test contract)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md   T-507
//
// Tests drive `CreateDecisionFunction` end-to-end. Because the SDK's
// `SlackFunction(...)` wrapper unconditionally calls `enrichContext(ctx)` ↦
// `client = SlackAPI(token)` (replacing whatever client the caller passed
// in), the `client` slot on the runtime context cannot be substituted
// directly. The standard escape hatch — and what the brief calls for — is
// to bridge `globalThis.fetch` to a `MockSlackClient`: every Slack web-API
// call (`https://slack.com/api/<method>`) is decoded from its URL-encoded
// form payload and dispatched into the corresponding method on the mock.
//
// Single-file ownership (T-507): everything below — the bridge, the
// dispatcher, and the tests — lives in this one file.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import createDecisionDefault from "../../functions/create_decision.ts";
import { MockSlackClient } from "../mocks/slack_client.ts";
import type {
  ChatPostMessageArgs,
  ConversationsMembersResponse,
  DatastoreDeleteResponse,
  DatastoreGetResponse,
  DatastorePutResponse,
  DatastoreQueryResponse,
  PinsListResponse,
  PinsMutationResponse,
  SlackBlock,
  TeamInfoResponse,
  UsergroupsListResponse,
  UsergroupsUsersListResponse,
  UsersInfoResponse,
} from "../../types/slack_types.ts";
import type { VoterRecord } from "../../types/decision_types.ts";

// ---------------------------------------------------------------------------
// Runtime ctx shape — narrow the SlackFunction wrapper's first argument.
// ---------------------------------------------------------------------------

interface CreateDecisionInputs {
  decision_name: string;
  proposal: string;
  required_voters: string[];
  required_usergroups?: string;
  include_channel_members?: boolean;
  success_criteria: string;
  deadline?: string;
  quorum_override?: number;
  channel_id: string;
  creator_id: string;
}

interface CreateDecisionContext {
  inputs: CreateDecisionInputs;
  env: Record<string, string>;
  token: string;
  team_id: string;
  enterprise_id?: string;
}

interface CreateDecisionResult {
  error?: string;
  completed?: boolean;
}

/**
 * Minimal callable signature for the `default` export of
 * `functions/create_decision.ts`. The real signature is provided by the SDK
 * generic `SlackFunctionType<...>` and is much wider; we only need the
 * `(ctx) => Promise<...>` shape for these tests.
 */
type CreateDecisionDefault = (
  ctx: CreateDecisionContext,
) => Promise<CreateDecisionResult>;

const callCreateDecision =
  createDecisionDefault as unknown as CreateDecisionDefault;

// ---------------------------------------------------------------------------
// Fetch → MockSlackClient bridge
// ---------------------------------------------------------------------------

/**
 * Generic Slack-shaped JSON response. The bridge produces these from method
 * dispatch results; the SDK's `SlackAPIClient` parses them into method-typed
 * payloads. `unknown` keeps the bridge agnostic to method-specific shapes.
 */
type SlackJsonResponse =
  | DatastoreGetResponse<unknown>
  | DatastorePutResponse<unknown>
  | DatastoreQueryResponse<unknown>
  | DatastoreDeleteResponse
  | UsersInfoResponse
  | TeamInfoResponse
  | UsergroupsListResponse
  | UsergroupsUsersListResponse
  | ConversationsMembersResponse
  | PinsListResponse
  | PinsMutationResponse
  | { ok: boolean; ts?: string; channel?: string; error?: string };

/**
 * Decode a URL-encoded request body into `Record<string, string>`. JSON
 * fields (`item`, `blocks`, `expression_attributes`, `expression_values`)
 * remain JSON-encoded strings — the dispatcher parses them on demand.
 */
function decodeFormBody(body: BodyInit | null | undefined): Record<
  string,
  string
> {
  const out: Record<string, string> = {};
  if (!body) return out;
  if (body instanceof URLSearchParams) {
    for (const [k, v] of body.entries()) out[k] = v;
    return out;
  }
  if (typeof body === "string") {
    for (const part of body.split("&")) {
      if (!part) continue;
      const [k, v] = part.split("=");
      out[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
    return out;
  }
  // Other body shapes (ReadableStream, Blob, FormData) are not produced by
  // `deno_slack_api`; treat as empty so the dispatcher returns `ok: false`.
  return out;
}

/** Strict number parser; returns undefined for missing / unparseable values. */
function asNumber(v: string | undefined): number | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse a JSON string from the form body, or return undefined if missing. */
function asJson(v: string | undefined): unknown {
  if (typeof v !== "string" || v.length === 0) return undefined;
  return JSON.parse(v);
}

/**
 * Dispatch a single decoded Slack web-API call into the {@link MockSlackClient}
 * surface. Methods unsupported by the mock return `{ ok: false }` so the
 * caller can detect missing wiring.
 */
async function dispatchToMock(
  mock: MockSlackClient,
  method: string,
  body: Record<string, string>,
): Promise<SlackJsonResponse> {
  switch (method) {
    case "team.info":
      return await mock.team.info();

    case "users.info":
      return await mock.users.info({ user: body.user ?? "" });

    case "usergroups.list": {
      const cursor = body.cursor && body.cursor.length > 0
        ? body.cursor
        : undefined;
      const limit = asNumber(body.limit);
      return await mock.usergroups.list({ cursor, limit });
    }

    case "usergroups.users.list": {
      const cursor = body.cursor && body.cursor.length > 0
        ? body.cursor
        : undefined;
      const limit = asNumber(body.limit);
      return await mock.usergroups.users.list({
        usergroup: body.usergroup ?? "",
        cursor,
        limit,
      });
    }

    case "conversations.members": {
      const cursor = body.cursor && body.cursor.length > 0
        ? body.cursor
        : undefined;
      const limit = asNumber(body.limit);
      return await mock.conversations.members({
        channel: body.channel ?? "",
        cursor,
        limit,
      });
    }

    case "chat.postMessage": {
      const blocks = asJson(body.blocks) as SlackBlock[] | undefined;
      return await mock.chat.postMessage({
        channel: body.channel ?? "",
        text: body.text,
        blocks,
      });
    }

    case "chat.postEphemeral": {
      const blocks = asJson(body.blocks) as SlackBlock[] | undefined;
      return await mock.chat.postEphemeral({
        channel: body.channel ?? "",
        user: body.user ?? "",
        text: body.text,
        blocks,
      });
    }

    case "chat.update": {
      const blocks = asJson(body.blocks) as SlackBlock[] | undefined;
      return await mock.chat.update({
        channel: body.channel ?? "",
        ts: body.ts ?? "",
        text: body.text,
        blocks,
      });
    }

    case "chat.delete":
      return await mock.chat.delete({
        channel: body.channel ?? "",
        ts: body.ts ?? "",
      });

    case "pins.list":
      return await mock.pins.list({ channel: body.channel ?? "" });

    case "pins.add":
      return await mock.pins.add({
        channel: body.channel ?? "",
        timestamp: body.timestamp ?? "",
      });

    case "pins.remove":
      return await mock.pins.remove({
        channel: body.channel ?? "",
        timestamp: body.timestamp ?? "",
      });

    case "apps.datastore.get":
      return await mock.apps.datastore.get({
        datastore: body.datastore ?? "",
        id: body.id ?? "",
      });

    case "apps.datastore.put": {
      const item = asJson(body.item);
      return await mock.apps.datastore.put({
        datastore: body.datastore ?? "",
        item,
      });
    }

    case "apps.datastore.query": {
      const exprAttrs = asJson(body.expression_attributes) as
        | Record<string, string>
        | undefined;
      const exprVals = asJson(body.expression_values) as
        | Record<string, unknown>
        | undefined;
      const cursor = body.cursor && body.cursor.length > 0
        ? body.cursor
        : undefined;
      const limit = asNumber(body.limit);
      return await mock.apps.datastore.query({
        datastore: body.datastore ?? "",
        expression: body.expression,
        expression_attributes: exprAttrs,
        expression_values: exprVals,
        cursor,
        limit,
      });
    }

    case "apps.datastore.delete":
      return await mock.apps.datastore.delete({
        datastore: body.datastore ?? "",
        id: body.id ?? "",
      });

    default:
      return { ok: false, error: `bridge: unsupported method ${method}` };
  }
}

/**
 * Install a `globalThis.fetch` interceptor that routes every
 * `https://slack.com/api/<method>` request into {@link dispatchToMock}.
 *
 * Returns the original fetch so the caller can restore it. We always restore
 * in a `try / finally`.
 */
function installFetchBridge(
  mock: MockSlackClient,
): typeof globalThis.fetch {
  const original = globalThis.fetch;
  globalThis.fetch = async (
    input: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const urlStr = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const match = urlStr.match(/\/api\/([^?]+)/);
    if (!match) {
      throw new Error(`bridge: non-Slack fetch escaped: ${urlStr}`);
    }
    const method = match[1];
    const body = decodeFormBody(init?.body ?? null);
    let payload: SlackJsonResponse;
    try {
      payload = await dispatchToMock(mock, method, body);
    } catch (err) {
      payload = { ok: false, error: String(err) };
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return original;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Always 30 days out so the past-deadline guard never trips. */
function futureIsoDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

/** Minimal valid input set; per-test overrides via `Partial`. */
function makeInputs(
  overrides: Partial<CreateDecisionInputs> = {},
): CreateDecisionInputs {
  return {
    decision_name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    required_voters: [],
    required_usergroups: "",
    include_channel_members: false,
    success_criteria: "simple_majority",
    deadline: futureIsoDate(),
    channel_id: "C001",
    creator_id: "U_CREATOR",
    ...overrides,
  };
}

function makeCtx(
  inputs: CreateDecisionInputs,
): CreateDecisionContext {
  return {
    inputs,
    env: {},
    token: "xoxb-test",
    team_id: "T1",
    enterprise_id: undefined,
  };
}

/** All `apps.datastore.put` rows that landed in the `voters` datastore. */
function votersWritten(mock: MockSlackClient): VoterRecord[] {
  const out: VoterRecord[] = [];
  for (const c of mock.getCallsFor("apps.datastore.put")) {
    const args = c.args as { datastore: string; item: VoterRecord };
    if (args.datastore === "voters") out.push(args.item);
  }
  return out;
}

/**
 * Drive the `default` export of `create_decision` with the supplied inputs.
 * Installs the fetch bridge for the duration of the call and restores the
 * original `fetch` afterwards.
 */
async function runCreateDecision(
  mock: MockSlackClient,
  inputs: CreateDecisionInputs,
): Promise<CreateDecisionResult> {
  const original = installFetchBridge(mock);
  try {
    return await callCreateDecision(makeCtx(inputs));
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * Walk the block tree of a `chat.postMessage` call and return the first
 * `mrkdwn` text block whose text matches `predicate`. Used to assert on the
 * post-create message's "Required Voters" field.
 */
function findFirstMrkdwn(
  blocks: SlackBlock[] | undefined,
  predicate: (text: string) => boolean,
): string | undefined {
  if (!blocks) return undefined;
  for (const b of blocks) {
    if (b.type === "section") {
      if (b.text && b.text.type === "mrkdwn" && predicate(b.text.text)) {
        return b.text.text;
      }
      if (b.fields) {
        for (const f of b.fields) {
          if (f.type === "mrkdwn" && predicate(f.text)) return f.text;
        }
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("usergroup integration — multi-group expansion stores all members", async () => {
  const mock = new MockSlackClient();
  mock.setUsergroupsList([
    { id: "S1", handle: "eng" },
    { id: "S2", handle: "design" },
  ]);
  mock.setUsergroupMembers("S1", ["U1", "U2"]);
  mock.setUsergroupMembers("S2", ["U3", "U4"]);
  // Default users.info returns non-bot, non-deleted humans for U1..U4.

  const result = await runCreateDecision(
    mock,
    makeInputs({
      required_voters: [],
      required_usergroups: "@eng @design",
    }),
  );

  assertEquals(result.error, undefined, `unexpected error: ${result.error}`);
  assertEquals(result.completed, false);

  const voters = votersWritten(mock);
  const ids = voters.map((v) => v.user_id).sort();
  assertEquals(ids, ["U1", "U2", "U3", "U4"]);
  assertEquals(voters.length, 4);
});

Deno.test("usergroup integration — overlapping groups are deduplicated", async () => {
  const mock = new MockSlackClient();
  mock.setUsergroupsList([
    { id: "S1", handle: "eng" },
    { id: "S2", handle: "design" },
  ]);
  mock.setUsergroupMembers("S1", ["U1", "U2"]);
  mock.setUsergroupMembers("S2", ["U2", "U3"]);

  const result = await runCreateDecision(
    mock,
    makeInputs({
      required_voters: [],
      required_usergroups: "@eng @design",
    }),
  );

  assertEquals(result.error, undefined);
  const voters = votersWritten(mock);
  const ids = voters.map((v) => v.user_id).sort();
  assertEquals(ids, ["U1", "U2", "U3"]);
  assertEquals(voters.length, 3);
});

Deno.test("usergroup integration — broadcast handles rejected at validation", async () => {
  const mock = new MockSlackClient();
  // Even though we don't expect any expansion, configure usergroups so a
  // mistakenly-attempted resolution would be visible in `mock.calls`.
  mock.setUsergroupsList([{ id: "S1", handle: "here" }]);
  mock.setUsergroupMembers("S1", ["U_SHOULD_NOT_APPEAR"]);

  const result = await runCreateDecision(
    mock,
    makeInputs({
      required_voters: ["U_IGNORED"],
      required_usergroups: "@here",
    }),
  );

  assertEquals(
    result.error,
    "Broadcast handles (@here, @channel, @everyone) are not supported as voter sources.",
  );
  // No datastore writes — pre-flight validation must reject before any
  // `apps.datastore.put` is dispatched.
  assertEquals(mock.getCallsFor("apps.datastore.put").length, 0);
  // No usergroup expansion either — the broadcast trap fires first.
  assertEquals(mock.getCallsFor("usergroups.list").length, 0);
  assertEquals(mock.getCallsFor("usergroups.users.list").length, 0);
});

Deno.test("usergroup integration — bot filter applied to usergroup members", async () => {
  const mock = new MockSlackClient();
  mock.setUsergroupsList([{ id: "S1", handle: "eng" }]);
  mock.setUsergroupMembers("S1", ["U1", "U2", "U3"]);
  mock.setUserInfo("U1", { is_bot: false, deleted: false });
  mock.setUserInfo("U2", { is_bot: true, deleted: false });
  mock.setUserInfo("U3", { is_bot: false, deleted: true });

  const result = await runCreateDecision(
    mock,
    makeInputs({
      required_voters: [],
      required_usergroups: "@eng",
    }),
  );

  assertEquals(result.error, undefined);
  const voters = votersWritten(mock);
  const ids = voters.map((v) => v.user_id);
  assertEquals(ids, ["U1"]);
});

Deno.test("usergroup integration — paginated usergroups.list resolves a non-first-page handle", async () => {
  const mock = new MockSlackClient();
  // 7 summaries, with the matching handle on the second page (page size 3).
  mock.setUsergroupsList([
    { id: "S101", handle: "alpha" },
    { id: "S102", handle: "beta" },
    { id: "S103", handle: "gamma" },
    { id: "S104", handle: "delta" },
    { id: "S105", handle: "eng" }, // → page 2
    { id: "S106", handle: "ops" },
    { id: "S107", handle: "qa" },
  ]);
  mock.enableUsergroupPagination(3);
  mock.setUsergroupMembers("S105", ["U1", "U2"]);

  const result = await runCreateDecision(
    mock,
    makeInputs({
      required_voters: [],
      required_usergroups: "@eng",
    }),
  );

  assertEquals(result.error, undefined);
  const voters = votersWritten(mock);
  assertEquals(voters.map((v) => v.user_id).sort(), ["U1", "U2"]);

  // The list endpoint was called more than once — pagination occurred.
  assert(
    mock.getCallsFor("usergroups.list").length >= 2,
    `expected paginated calls, got ${
      mock.getCallsFor("usergroups.list").length
    }`,
  );
});

Deno.test("usergroup integration — paginated usergroups.users.list yields every member", async () => {
  const mock = new MockSlackClient();
  mock.setUsergroupsList([{ id: "S1", handle: "eng" }]);
  const members = ["U1", "U2", "U3", "U4", "U5", "U6", "U7"];
  mock.setUsergroupMembers("S1", members);
  mock.enableUsergroupUsersPagination("S1", 2);

  const result = await runCreateDecision(
    mock,
    makeInputs({
      required_voters: [],
      required_usergroups: "@eng",
    }),
  );

  assertEquals(result.error, undefined);
  const voters = votersWritten(mock);
  assertEquals(voters.map((v) => v.user_id).sort(), members.slice().sort());
  // 4 pages over 7 members at page-size 2 → at least 4 calls.
  assert(
    mock.getCallsFor("usergroups.users.list").length >= 4,
    `expected paginated members calls, got ${
      mock.getCallsFor("usergroups.users.list").length
    }`,
  );
});

Deno.test("usergroup integration — backward-compat: empty usergroups skips usergroups.list", async () => {
  const mock = new MockSlackClient();
  mock.setUsergroupsList([{ id: "S1", handle: "eng" }]); // present but unused

  const result = await runCreateDecision(
    mock,
    makeInputs({
      required_voters: ["U1"],
      required_usergroups: "",
    }),
  );

  assertEquals(result.error, undefined);
  // No usergroup endpoints invoked when the input is blank.
  assertEquals(mock.getCallsFor("usergroups.list").length, 0);
  assertEquals(mock.getCallsFor("usergroups.users.list").length, 0);

  const voters = votersWritten(mock);
  assertEquals(voters.map((v) => v.user_id), ["U1"]);
});

Deno.test("usergroup integration — chat.postMessage blocks render voter mentions", async () => {
  const mock = new MockSlackClient();
  mock.setUsergroupsList([{ id: "S1", handle: "eng" }]);
  mock.setUsergroupMembers("S1", ["U1", "U2"]);

  const result = await runCreateDecision(
    mock,
    makeInputs({
      required_voters: [],
      required_usergroups: "@eng",
    }),
  );

  assertEquals(result.error, undefined);

  const postCalls = mock.getCallsFor("chat.postMessage");
  assertEquals(postCalls.length, 1, "exactly one chat.postMessage expected");
  const args = postCalls[0].args as ChatPostMessageArgs;

  const requiredVotersField = findFirstMrkdwn(
    args.blocks,
    (text) => text.startsWith("*Required Voters:*"),
  );
  assert(
    requiredVotersField !== undefined,
    "expected a *Required Voters:* field in the post-message blocks",
  );
  // §8.5 step 3 — mentions are rendered as `<@id>` separated by `, `.
  assertStringIncludes(requiredVotersField, "<@U1>, <@U2>");
});
