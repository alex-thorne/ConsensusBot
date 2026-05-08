// ConsensusBot v2.0 — Integration tests for cancel + delete handlers.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §10    (cancel handler)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §11    (delete handler)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16.4  (re-read-and-bail)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.2  (integration tests)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md     T-505
//
// Acceptance:
//   deno test --allow-all tests/integration/cancel_delete_test.ts
//
// ## Handler-driving approach
//
// The default export of `functions/create_decision.ts` is a SlackFunction
// callable produced by the SDK. Its `.blockActions(ctx)` entry-point dispatches
// to the registered handler. The SDK's `enrichContext` REPLACES the `client`
// supplied in the context with `SlackAPI(token)` — a real fetch-based Slack
// API client. Therefore passing a `MockSlackClient` directly as `ctx.client`
// has no effect (the SDK overwrites it before the handler runs).
//
// We work around this by intercepting `globalThis.fetch` and routing every
// outbound `https://slack.com/api/<method>` request to a `MockSlackClient`
// instance, then encoding the mock's response back as a JSON body. This lets
// us drive the real `default.blockActions(ctx)` path end-to-end while keeping
// every assertion against the same recorded-call surface used by the unit
// tests (`MockSlackClient.calls`).
//
// The SDK serialises arguments as `URLSearchParams` with nested object fields
// (`item`, `expression_attributes`, `expression_values`, `blocks`) JSON-encoded
// as strings; the dispatcher JSON-parses those known nested fields back into
// objects and leaves scalar fields (`channel`, `id`, `ts`, `timestamp`, `user`,
// `text`, `datastore`, etc.) as plain strings to preserve precision.

import { assert, assertEquals } from "@std/assert";

import createDecisionDefault from "../../functions/create_decision.ts";
import { MockSlackClient } from "../mocks/slack_client.ts";

import type {
  DatastoreDeleteArgs,
  DatastoreGetArgs,
  DatastoreGetResponse,
  DatastorePutArgs,
  DatastoreQueryArgs,
} from "../../types/slack_types.ts";
import type {
  DecisionRecord,
  VoteHistoryRecord,
  VoteRecord,
  VoterRecord,
} from "../../types/decision_types.ts";

// ---------------------------------------------------------------------------
// Test fixture builders
// ---------------------------------------------------------------------------

/** Build a baseline active `DecisionRecord` whose every field is filled in. */
function makeActiveDecision(
  overrides: Partial<DecisionRecord> = {},
): DecisionRecord {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "simple_majority",
    quorum: 2,
    required_voters_count: 3,
    deadline: "2026-05-15",
    deadline_resolved: "2027-05-15T22:59:59+01:00",
    deadline_tz: "Europe/London",
    channel_id: "C0001",
    creator_id: "U_ALICE",
    message_ts: "1715170800.000100",
    status: "active",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-08T09:00:00.000Z",
    ...overrides,
  };
}

/** Build a `VoterRecord` for the given (decision, user, is_active). */
function makeVoter(
  decisionId: string,
  userId: string,
  isActive = true,
): VoterRecord {
  return {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    is_active: isActive,
    created_at: "2026-05-08T09:00:00.000Z",
  };
}

/** Build a `VoteRecord` for the given (decision, user). */
function makeVote(
  decisionId: string,
  userId: string,
  voteType: VoteRecord["vote_type"] = "yes",
): VoteRecord {
  return {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    vote_type: voteType,
    voted_at: "2026-05-08T10:00:00.000Z",
  };
}

/** Build a `VoteHistoryRecord` for the given (decision, user, seq). */
function makeVoteHistory(
  decisionId: string,
  userId: string,
  seq: string,
  voteType: VoteRecord["vote_type"] = "yes",
): VoteHistoryRecord {
  return {
    id: `${decisionId}_${userId}_${seq}`,
    decision_id: decisionId,
    user_id: userId,
    vote_type: voteType,
    event_kind: "cast",
    voted_at: "2026-05-08T10:00:00.000Z",
  };
}

/**
 * Cast `record` into the `{ id: string }` plain-object shape required by
 * `MockSlackClient.setDatastoreItem` without smuggling in `any`.
 */
function asStoreItem(
  record: DecisionRecord | VoterRecord | VoteRecord | VoteHistoryRecord,
): { id: string } & Record<string, unknown> {
  return record as unknown as { id: string } & Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Fetch dispatcher — routes Slack API calls to a MockSlackClient
// ---------------------------------------------------------------------------

/**
 * Names of body fields the SDK JSON-encodes as strings inside a
 * `URLSearchParams` body. We round-trip these back to objects/arrays so the
 * mock receives the same shape unit tests do.
 */
const NESTED_BODY_FIELDS = new Set([
  "item",
  "blocks",
  "elements",
  "expression_attributes",
  "expression_values",
]);

/** Decode the SDK's `URLSearchParams` body into a normal JS object. */
function decodeFetchBody(
  init: RequestInit | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const body = init?.body;
  if (!body) return out;

  if (body instanceof URLSearchParams) {
    for (const [k, v] of body.entries()) {
      out[k] = NESTED_BODY_FIELDS.has(k) ? JSON.parse(v) : v;
    }
    return out;
  }
  if (body instanceof FormData) {
    for (const [k, v] of body.entries()) {
      if (typeof v !== "string") {
        out[k] = v;
        continue;
      }
      out[k] = NESTED_BODY_FIELDS.has(k) ? JSON.parse(v) : v;
    }
    return out;
  }
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(out, parsed as Record<string, unknown>);
      }
    } catch { /* leave empty */ }
  }
  return out;
}

/**
 * Optional hook installed by a single test to override the default mock
 * dispatch for one or more `apps.datastore.*` calls. Returning `undefined`
 * means "fall through to the default dispatcher".
 */
type DispatchHook = (
  method: string,
  body: Record<string, unknown>,
) => unknown | undefined;

interface InstallOpts {
  hook?: DispatchHook;
}

/**
 * Install a `globalThis.fetch` interceptor for the duration of `run()`. The
 * interceptor parses the outbound Slack API call, optionally consults `hook`
 * for an override, and otherwise dispatches to `mock`. The original `fetch`
 * is restored on completion (success OR failure).
 */
async function withFetchDispatcher(
  mock: MockSlackClient,
  opts: InstallOpts,
  run: () => Promise<void>,
): Promise<void> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (
    input: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const match = /\/api\/([a-zA-Z._]+)$/.exec(url);
    if (!match) {
      return new Response(
        JSON.stringify({ ok: false, error: "no_method" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    const method = match[1];
    const body = decodeFetchBody(init);

    let result: unknown;
    if (opts.hook) {
      const override = opts.hook(method, body);
      if (override !== undefined) {
        return new Response(JSON.stringify(override), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    try {
      result = await dispatchToMock(mock, method, body);
    } catch (err) {
      result = { ok: false, error: String(err) };
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

/**
 * Dispatch a single decoded Slack API call to the mock surface. Unknown
 * methods get a generic `{ ok: true }` so the SDK does not blow up on them.
 */
async function dispatchToMock(
  mock: MockSlackClient,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "team.info":
      return await mock.team.info();
    case "users.info":
      return await mock.users.info({ user: String(body.user ?? "") });
    case "apps.datastore.get":
      return await mock.apps.datastore.get(
        body as unknown as DatastoreGetArgs,
      );
    case "apps.datastore.put":
      return await mock.apps.datastore.put(
        body as unknown as DatastorePutArgs<unknown>,
      );
    case "apps.datastore.query":
      return await mock.apps.datastore.query(
        body as unknown as DatastoreQueryArgs,
      );
    case "apps.datastore.delete":
      return await mock.apps.datastore.delete(
        body as unknown as DatastoreDeleteArgs,
      );
    case "chat.postMessage":
      return await mock.chat.postMessage({
        channel: String(body.channel ?? ""),
        text: typeof body.text === "string" ? body.text : undefined,
      });
    case "chat.update":
      return await mock.chat.update({
        channel: String(body.channel ?? ""),
        ts: String(body.ts ?? ""),
        text: typeof body.text === "string" ? body.text : undefined,
      });
    case "chat.delete":
      return await mock.chat.delete({
        channel: String(body.channel ?? ""),
        ts: String(body.ts ?? ""),
      });
    case "chat.postEphemeral":
      return await mock.chat.postEphemeral({
        channel: String(body.channel ?? ""),
        user: String(body.user ?? ""),
        text: typeof body.text === "string" ? body.text : undefined,
      });
    case "pins.list":
      return await mock.pins.list({ channel: String(body.channel ?? "") });
    case "pins.add":
      return await mock.pins.add({
        channel: String(body.channel ?? ""),
        timestamp: String(body.timestamp ?? ""),
      });
    case "pins.remove":
      return await mock.pins.remove({
        channel: String(body.channel ?? ""),
        timestamp: String(body.timestamp ?? ""),
      });
    default:
      return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Block-actions context builder + driver
// ---------------------------------------------------------------------------

/**
 * Build a minimal block-actions payload for the SDK. The handler reads
 * `action.{action_id, value}`, `body.user.id`, and `body.container.{channel_id,
 * message_ts}`; everything else is opaque to it.
 */
function makeBlockCtx(args: {
  actionId: string;
  decisionId: string;
  userId: string;
  channelId: string;
  messageTs: string;
}): Record<string, unknown> {
  return {
    action: { action_id: args.actionId, value: args.decisionId },
    body: {
      user: { id: args.userId },
      container: {
        channel_id: args.channelId,
        message_ts: args.messageTs,
      },
    },
    env: {},
    token: "xoxb-test",
    team_id: "T1",
    enterprise_id: "",
  };
}

/**
 * Drive `default.blockActions(ctx)` on the create_decision module. The
 * SlackFunction's `blockActions` method uses `this.matchHandler(action)`; we
 * bind `this` via `.call(fn, ctx)` so the handler chain resolves.
 */
async function driveBlockActions(
  ctx: Record<string, unknown>,
): Promise<void> {
  // The SDK's wrapper is a function-callable that exposes `blockActions` as
  // a property; bind `this` so its inner `this.matchHandler(...)` resolves.
  const fn = createDecisionDefault as unknown as {
    blockActions: (c: unknown) => Promise<unknown>;
  };
  await Reflect.apply(fn.blockActions, fn, [ctx]);
}

// ---------------------------------------------------------------------------
// Call inspection helpers
// ---------------------------------------------------------------------------

/**
 * `apps.datastore.put` arg shape for the `decisions` row. We don't widen the
 * mock's `MockCall.args` (which is `unknown` so its API stays narrow); a
 * runtime-narrowed accessor lives here.
 */
interface DatastorePutCallArgs {
  datastore: string;
  item: Record<string, unknown>;
}

function asDatastorePutArgs(args: unknown): DatastorePutCallArgs {
  if (args === null || typeof args !== "object") {
    throw new Error("expected datastore put args object");
  }
  const a = args as Record<string, unknown>;
  if (typeof a.datastore !== "string") {
    throw new Error("datastore field missing");
  }
  if (a.item === null || typeof a.item !== "object") {
    throw new Error("item field missing");
  }
  return {
    datastore: a.datastore,
    item: a.item as Record<string, unknown>,
  };
}

interface ChatUpdateCallArgs {
  channel: string;
  ts: string;
  text?: string;
}

function asChatUpdateArgs(args: unknown): ChatUpdateCallArgs {
  if (args === null || typeof args !== "object") {
    throw new Error("expected chat.update args object");
  }
  const a = args as Record<string, unknown>;
  return {
    channel: typeof a.channel === "string" ? a.channel : "",
    ts: typeof a.ts === "string" ? a.ts : "",
    text: typeof a.text === "string" ? a.text : undefined,
  };
}

interface ChatPostEphemeralCallArgs {
  channel: string;
  user: string;
  text?: string;
}

function asChatPostEphemeralArgs(args: unknown): ChatPostEphemeralCallArgs {
  if (args === null || typeof args !== "object") {
    throw new Error("expected chat.postEphemeral args object");
  }
  const a = args as Record<string, unknown>;
  return {
    channel: typeof a.channel === "string" ? a.channel : "",
    user: typeof a.user === "string" ? a.user : "",
    text: typeof a.text === "string" ? a.text : undefined,
  };
}

interface PinsRemoveCallArgs {
  channel: string;
  timestamp: string;
}

function asPinsRemoveArgs(args: unknown): PinsRemoveCallArgs {
  if (args === null || typeof args !== "object") {
    throw new Error("expected pins.remove args object");
  }
  const a = args as Record<string, unknown>;
  return {
    channel: typeof a.channel === "string" ? a.channel : "",
    timestamp: typeof a.timestamp === "string" ? a.timestamp : "",
  };
}

interface DatastoreDeleteCallArgs {
  datastore: string;
  id: string;
}

function asDatastoreDeleteArgs(args: unknown): DatastoreDeleteCallArgs {
  if (args === null || typeof args !== "object") {
    throw new Error("expected datastore delete args object");
  }
  const a = args as Record<string, unknown>;
  return {
    datastore: typeof a.datastore === "string" ? a.datastore : "",
    id: typeof a.id === "string" ? a.id : "",
  };
}

// ===========================================================================
// 1. Cancel — happy path: status flip + pin probe + chat.update + ephemeral
// ===========================================================================

Deno.test("cancel — transitions status to cancelled atomically (re-read+predicate)", async () => {
  const mock = new MockSlackClient();
  const decision = makeActiveDecision({ id: "DEC_CANCEL_HAPPY" });
  mock.setDatastoreItem("decisions", asStoreItem(decision));

  await withFetchDispatcher(mock, {}, async () => {
    await driveBlockActions(makeBlockCtx({
      actionId: "decision_cancel",
      decisionId: decision.id,
      userId: "U_BOB", // any workspace member can cancel (SPEC §10).
      channelId: decision.channel_id,
      messageTs: decision.message_ts,
    }));
  });

  // Two `apps.datastore.get` on `decisions` row: the initial load AND the
  // re-read-and-bail predicate check (SPEC §10 step 3 / §16.4).
  const decisionGets = mock.calls
    .filter((c) => c.method === "apps.datastore.get")
    .filter((c) => {
      const a = c.args as { datastore?: string; id?: string };
      return a.datastore === "decisions" && a.id === decision.id;
    });
  assertEquals(
    decisionGets.length,
    2,
    "cancel handler MUST re-read the decision row before put (SPEC §10 step 3)",
  );

  // Exactly one `apps.datastore.put` to `decisions`, status flipped to
  // "cancelled" with the SPEC-defined `outcome_reason` mention format.
  const decisionPuts = mock.calls
    .filter((c) => c.method === "apps.datastore.put")
    .map((c) => asDatastorePutArgs(c.args))
    .filter((p) => p.datastore === "decisions");
  assertEquals(decisionPuts.length, 1);
  const written = decisionPuts[0].item;
  assertEquals(written.id, decision.id);
  assertEquals(written.status, "cancelled");
  assertEquals(written.outcome_reason, "cancelled by <@U_BOB>");
  // Other DecisionRecord fields are preserved verbatim.
  assertEquals(written.name, decision.name);
  assertEquals(written.creator_id, decision.creator_id);
  assertEquals(written.channel_id, decision.channel_id);

  // chat.update writes the cancelled-layout message in place.
  const updates = mock.calls.filter((c) => c.method === "chat.update");
  assertEquals(updates.length, 1);
  const upd = asChatUpdateArgs(updates[0].args);
  assertEquals(upd.channel, decision.channel_id);
  assertEquals(upd.ts, decision.message_ts);
  assert(
    upd.text?.startsWith("Decision cancelled:"),
    `chat.update text should announce cancellation, got: ${upd.text}`,
  );

  // Ephemeral confirmation matches SPEC §10 step 6 verbatim.
  const ephemerals = mock.calls.filter(
    (c) => c.method === "chat.postEphemeral",
  );
  assertEquals(ephemerals.length, 1);
  const eph = asChatPostEphemeralArgs(ephemerals[0].args);
  assertEquals(eph.channel, decision.channel_id);
  assertEquals(eph.user, "U_BOB");
  assertEquals(
    eph.text,
    `🚫 Decision "${decision.name}" has been cancelled.`,
  );
});

// ===========================================================================
// 2. Cancel — re-read sees a finalised row → bails with no put
// ===========================================================================

Deno.test("cancel — rejects when row has been finalised between read and put", async () => {
  const mock = new MockSlackClient();
  const decision = makeActiveDecision({ id: "DEC_CANCEL_RACE" });
  mock.setDatastoreItem("decisions", asStoreItem(decision));

  // Counter-driven mid-flight swap: the FIRST get returns the active row;
  // EVERY SUBSEQUENT get returns the same row but with `status: "approved"`
  // and `finalized_at` set, simulating a peer finaliser winning the race.
  let getCount = 0;
  const finalised: DecisionRecord = {
    ...decision,
    status: "approved",
    outcome_reason: "simple-majority threshold met",
    finalized_at: "2026-05-08T11:00:00.000Z",
    updated_at: "2026-05-08T11:00:00.000Z",
  };
  const hook: DispatchHook = (method, body) => {
    if (method !== "apps.datastore.get") return undefined;
    if (body.datastore !== "decisions") return undefined;
    if (body.id !== decision.id) return undefined;
    getCount += 1;
    if (getCount === 1) {
      const resp: DatastoreGetResponse<DecisionRecord> = {
        ok: true,
        item: decision,
      };
      return resp;
    }
    const resp: DatastoreGetResponse<DecisionRecord> = {
      ok: true,
      item: finalised,
    };
    return resp;
  };

  await withFetchDispatcher(mock, { hook }, async () => {
    await driveBlockActions(makeBlockCtx({
      actionId: "decision_cancel",
      decisionId: decision.id,
      userId: "U_BOB",
      channelId: decision.channel_id,
      messageTs: decision.message_ts,
    }));
  });

  // Saw both gets — the initial load and the re-read-and-bail predicate check.
  assertEquals(
    getCount,
    2,
    "expected an initial get + a re-read get (predicate)",
  );

  // Predicate failed → no `apps.datastore.put` whatsoever (no status overwrite).
  const puts = mock.calls.filter((c) => c.method === "apps.datastore.put");
  assertEquals(
    puts.length,
    0,
    "predicate-failed cancel MUST NOT put any row",
  );

  // No chat.update either — the cancelled layout never replaces the message.
  const updates = mock.calls.filter((c) => c.method === "chat.update");
  assertEquals(updates.length, 0);

  // Ephemeral message is the SPEC §10 step 3 finalised-mid-flight string.
  const ephemerals = mock.calls.filter(
    (c) => c.method === "chat.postEphemeral",
  );
  assertEquals(ephemerals.length, 1);
  const eph = asChatPostEphemeralArgs(ephemerals[0].args);
  assertEquals(
    eph.text,
    "This decision was just finalised — cannot cancel.",
  );
});

// ===========================================================================
// 3. Cancel — pin probe via pins.list skips remove when not pinned
// ===========================================================================

Deno.test("cancel — pin probe skips pins.remove when message is not pinned", async () => {
  const mock = new MockSlackClient();
  const decision = makeActiveDecision({ id: "DEC_PIN_NONE" });
  mock.setDatastoreItem("decisions", asStoreItem(decision));
  // Default `pins.list` for an unconfigured channel returns `{ ok: true,
  // items: [] }` — the message is NOT pinned.

  await withFetchDispatcher(mock, {}, async () => {
    await driveBlockActions(makeBlockCtx({
      actionId: "decision_cancel",
      decisionId: decision.id,
      userId: "U_BOB",
      channelId: decision.channel_id,
      messageTs: decision.message_ts,
    }));
  });

  const pinsList = mock.calls.filter((c) => c.method === "pins.list");
  assertEquals(pinsList.length, 1, "pins.list MUST be called (probe)");
  const pinsRemove = mock.calls.filter((c) => c.method === "pins.remove");
  assertEquals(
    pinsRemove.length,
    0,
    "pins.remove MUST be skipped when the message is not in pins.list",
  );
});

Deno.test("cancel — pin probe calls pins.remove when message IS pinned", async () => {
  const mock = new MockSlackClient();
  const decision = makeActiveDecision({ id: "DEC_PIN_YES" });
  mock.setDatastoreItem("decisions", asStoreItem(decision));
  // Pre-populate pins.list to advertise that this message IS pinned.
  mock.setChannelPins(decision.channel_id, [
    { message: { ts: decision.message_ts } },
  ]);

  await withFetchDispatcher(mock, {}, async () => {
    await driveBlockActions(makeBlockCtx({
      actionId: "decision_cancel",
      decisionId: decision.id,
      userId: "U_BOB",
      channelId: decision.channel_id,
      messageTs: decision.message_ts,
    }));
  });

  const pinsRemove = mock.calls.filter((c) => c.method === "pins.remove");
  assertEquals(pinsRemove.length, 1, "pins.remove MUST be called when pinned");
  const removeArgs = asPinsRemoveArgs(pinsRemove[0].args);
  assertEquals(removeArgs.channel, decision.channel_id);
  assertEquals(removeArgs.timestamp, decision.message_ts);
});

// ===========================================================================
// 4. Delete — non-creator rejected with creator-only ephemeral
// ===========================================================================

Deno.test("delete — rejects non-creator with creator-only ephemeral", async () => {
  const mock = new MockSlackClient();
  const decision = makeActiveDecision({
    id: "DEC_DEL_AUTHZ",
    creator_id: "U_ALICE",
  });
  mock.setDatastoreItem("decisions", asStoreItem(decision));

  await withFetchDispatcher(mock, {}, async () => {
    await driveBlockActions(makeBlockCtx({
      actionId: "decision_delete",
      decisionId: decision.id,
      userId: "U_BOB", // ≠ creator_id
      channelId: decision.channel_id,
      messageTs: decision.message_ts,
    }));
  });

  // Authorisation rejects before any cascade-delete.
  const deletes = mock.calls.filter((c) =>
    c.method === "apps.datastore.delete"
  );
  assertEquals(
    deletes.length,
    0,
    "non-creator delete MUST NOT trigger any datastore delete",
  );

  // No chat.delete either — the message stays intact for the legitimate creator.
  const chatDeletes = mock.calls.filter((c) => c.method === "chat.delete");
  assertEquals(chatDeletes.length, 0);

  // Ephemeral matches SPEC §11 step 2 verbatim.
  const ephemerals = mock.calls.filter(
    (c) => c.method === "chat.postEphemeral",
  );
  assertEquals(ephemerals.length, 1);
  const eph = asChatPostEphemeralArgs(ephemerals[0].args);
  assertEquals(
    eph.text,
    "⛔ Only the creator of this decision can delete it.",
  );
  // The ephemeral goes to the unauthorised user (U_BOB), not the creator.
  assertEquals(eph.user, "U_BOB");
});

// ===========================================================================
// 5. Delete — cascade order is vote_history → votes → voters → decisions
// ===========================================================================

Deno.test("delete — cascade order: vote_history → votes → voters → decisions", async () => {
  const mock = new MockSlackClient();
  const decision = makeActiveDecision({
    id: "DEC_DEL_CASCADE",
    creator_id: "U_ALICE",
  });
  mock.setDatastoreItem("decisions", asStoreItem(decision));

  // Pre-seed two voters, two votes, and three vote_history rows for the
  // same decision. The delete handler queries each datastore and deletes
  // every returned row by id.
  const voters = [
    makeVoter(decision.id, "U_ALICE"),
    makeVoter(decision.id, "U_BOB"),
  ];
  const votes = [
    makeVote(decision.id, "U_ALICE", "yes"),
    makeVote(decision.id, "U_BOB", "no"),
  ];
  const histories = [
    makeVoteHistory(decision.id, "U_ALICE", "0001", "yes"),
    makeVoteHistory(decision.id, "U_BOB", "0001", "yes"),
    makeVoteHistory(decision.id, "U_BOB", "0002", "no"),
  ];

  // The handler issues a query per cascaded datastore; the mock falls back
  // to returning every row in the table when no explicit override is set.
  for (const v of voters) mock.setDatastoreItem("voters", asStoreItem(v));
  for (const v of votes) mock.setDatastoreItem("votes", asStoreItem(v));
  for (const h of histories) {
    mock.setDatastoreItem("vote_history", asStoreItem(h));
  }

  await withFetchDispatcher(mock, {}, async () => {
    await driveBlockActions(makeBlockCtx({
      actionId: "decision_delete",
      decisionId: decision.id,
      userId: "U_ALICE", // creator → authorised.
      channelId: decision.channel_id,
      messageTs: decision.message_ts,
    }));
  });

  // Examine the sequence of `apps.datastore.delete` calls. The SPEC §11 step 3
  // order is `vote_history` → `votes` → `voters` → `decisions`; assert the
  // first appearance of each datastore name follows that order.
  const deleteCalls = mock.calls
    .filter((c) => c.method === "apps.datastore.delete")
    .map((c) => asDatastoreDeleteArgs(c.args));

  // Total = 3 vote_history + 2 votes + 2 voters + 1 decisions = 8.
  assertEquals(deleteCalls.length, 8);

  // Group by datastore to assert per-table counts.
  const byDatastore = new Map<string, DatastoreDeleteCallArgs[]>();
  for (const d of deleteCalls) {
    const arr = byDatastore.get(d.datastore) ?? [];
    arr.push(d);
    byDatastore.set(d.datastore, arr);
  }
  assertEquals(byDatastore.get("vote_history")?.length, 3);
  assertEquals(byDatastore.get("votes")?.length, 2);
  assertEquals(byDatastore.get("voters")?.length, 2);
  assertEquals(byDatastore.get("decisions")?.length, 1);

  // Order check: every vote_history delete must precede every votes delete,
  // every votes delete must precede every voters delete, and every voters
  // delete must precede the decisions row delete.
  const indexedDatastores = deleteCalls.map((d) => d.datastore);
  const lastIdx = (name: string): number => indexedDatastores.lastIndexOf(name);
  const firstIdx = (name: string): number => indexedDatastores.indexOf(name);

  assert(
    lastIdx("vote_history") < firstIdx("votes"),
    "all vote_history deletes must precede every votes delete",
  );
  assert(
    lastIdx("votes") < firstIdx("voters"),
    "all votes deletes must precede every voters delete",
  );
  assert(
    lastIdx("voters") < firstIdx("decisions"),
    "all voters deletes must precede the decisions delete",
  );

  // The decisions row delete carries the right id.
  const decisionsDelete = byDatastore.get("decisions")?.[0];
  assert(decisionsDelete !== undefined);
  assertEquals(decisionsDelete.id, decision.id);
});

// ===========================================================================
// 6. Delete — chat.delete failure falls back to chat.update
// ===========================================================================

Deno.test("delete — chat.delete fallback to chat.update on too-old message", async () => {
  const mock = new MockSlackClient();
  const decision = makeActiveDecision({
    id: "DEC_DEL_OLDMSG",
    creator_id: "U_ALICE",
    name: "Adopt Deno 2",
  });
  mock.setDatastoreItem("decisions", asStoreItem(decision));

  // Force chat.delete to fail with the canonical "message_not_found" error.
  mock.forceFailure("chat.delete", "message_not_found");

  await withFetchDispatcher(mock, {}, async () => {
    await driveBlockActions(makeBlockCtx({
      actionId: "decision_delete",
      decisionId: decision.id,
      userId: "U_ALICE",
      channelId: decision.channel_id,
      messageTs: decision.message_ts,
    }));
  });

  // chat.delete attempted, then chat.update fallback called once.
  const chatDeletes = mock.calls.filter((c) => c.method === "chat.delete");
  assertEquals(chatDeletes.length, 1);
  const chatUpdates = mock.calls.filter((c) => c.method === "chat.update");
  assertEquals(
    chatUpdates.length,
    1,
    "chat.delete failure MUST fall back to a single chat.update",
  );
  const upd = asChatUpdateArgs(chatUpdates[0].args);
  assertEquals(upd.channel, decision.channel_id);
  assertEquals(upd.ts, decision.message_ts);
  // Fallback text matches SPEC §11 step 5.
  assertEquals(
    upd.text,
    `_This decision ("${decision.name}") was deleted by <@U_ALICE>._`,
  );
});

// ===========================================================================
// 7. Ephemeral confirmations (cancel + delete)
// ===========================================================================

Deno.test("cancel — ephemeral confirmation matches SPEC §10 step 6 verbatim", async () => {
  const mock = new MockSlackClient();
  const decision = makeActiveDecision({
    id: "DEC_CANCEL_EPH",
    name: "Adopt Deno 2",
  });
  mock.setDatastoreItem("decisions", asStoreItem(decision));

  await withFetchDispatcher(mock, {}, async () => {
    await driveBlockActions(makeBlockCtx({
      actionId: "decision_cancel",
      decisionId: decision.id,
      userId: "U_BOB",
      channelId: decision.channel_id,
      messageTs: decision.message_ts,
    }));
  });

  const ephemerals = mock.calls.filter(
    (c) => c.method === "chat.postEphemeral",
  );
  assertEquals(ephemerals.length, 1);
  const eph = asChatPostEphemeralArgs(ephemerals[0].args);
  assertEquals(eph.user, "U_BOB");
  assertEquals(eph.channel, decision.channel_id);
  assertEquals(
    eph.text,
    `🚫 Decision "${decision.name}" has been cancelled.`,
  );
});

Deno.test("delete — ephemeral confirmation matches SPEC §11 step 6 verbatim", async () => {
  const mock = new MockSlackClient();
  const decision = makeActiveDecision({
    id: "DEC_DEL_EPH",
    name: "Adopt Deno 2",
    creator_id: "U_ALICE",
  });
  mock.setDatastoreItem("decisions", asStoreItem(decision));

  await withFetchDispatcher(mock, {}, async () => {
    await driveBlockActions(makeBlockCtx({
      actionId: "decision_delete",
      decisionId: decision.id,
      userId: "U_ALICE",
      channelId: decision.channel_id,
      messageTs: decision.message_ts,
    }));
  });

  const ephemerals = mock.calls.filter(
    (c) => c.method === "chat.postEphemeral",
  );
  assertEquals(ephemerals.length, 1);
  const eph = asChatPostEphemeralArgs(ephemerals[0].args);
  assertEquals(eph.user, "U_ALICE");
  assertEquals(eph.channel, decision.channel_id);
  assertEquals(
    eph.text,
    `🗑️ Decision "${decision.name}" has been deleted.`,
  );
});
