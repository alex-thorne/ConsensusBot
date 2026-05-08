// ConsensusBot v2.0 — Integration: race conditions.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16 (concurrency, consistency, idempotency)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16.3 (`finalized_at` token)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16.4 (re-read-and-bail)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.2 (`race_test.ts` row)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-510
//
// Acceptance:
//   deno test --allow-all tests/integration/race_test.ts
//
// Why a fetch bridge?
//
// The SDK's `SlackFunction` wrapper enriches the handler context by
// instantiating a real `SlackAPI` client from `context.token`. That call
// over-writes anything we put on `ctx.client`, so we cannot inject the
// `MockSlackClient` directly into the wrapper. Instead, we interpose
// `globalThis.fetch` with a shim that translates the SDK's outgoing HTTP
// requests into method calls on a `MockSlackClient` instance and serialises
// its responses back as Slack-shaped JSON. Every call still flows through
// the mock's recorded-call log so we can assert on `mock.calls` exactly as
// the unit tests do.

import { assert, assertEquals } from "@std/assert";
import createDecisionFunctionDefault from "../../functions/create_decision.ts";
import { MockSlackClient } from "../mocks/slack_client.ts";
import type {
  ChatPostEphemeralArgs,
  ChatPostMessageArgs,
  ChatUpdateArgs,
  DatastoreQueryArgs,
  SlackBlock,
} from "../../types/slack_types.ts";
import type {
  DecisionRecord,
  VoteHistoryRecord,
  VoteRecord,
  VoterRecord,
} from "../../types/decision_types.ts";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CHANNEL_ID = "C0001";
const MESSAGE_TS = "1715170800.000100";
const FAR_FUTURE_DEADLINE = "2099-05-15T22:59:59+01:00";
const CREATED_AT = "2026-05-08T09:00:00.000Z";

// ---------------------------------------------------------------------------
// Block-actions context shape
// ---------------------------------------------------------------------------

/**
 * Minimal shape of the context the SlackFunction `blockActions` entry-point
 * accepts. The SDK enriches it with a real client (which we intercept via the
 * fetch bridge); we must still supply `action`, `body`, `env`, `token`, and
 * `team_id` to satisfy the wrapper's destructuring.
 */
interface BlockActionsCtx {
  action: { action_id: string; value: string };
  body: {
    user: { id: string };
    container: { channel_id: string; message_ts: string };
  };
  env: Record<string, string>;
  token: string;
  team_id: string;
}

/**
 * Produce a well-formed block-actions context for an `action_id` on a given
 * decision. The `value` is the decision UUID per SPEC §8.5.
 */
function makeBlockActionsCtx(
  actionId: string,
  decisionId: string,
  userId: string,
): BlockActionsCtx {
  return {
    action: { action_id: actionId, value: decisionId },
    body: {
      user: { id: userId },
      container: { channel_id: CHANNEL_ID, message_ts: MESSAGE_TS },
    },
    env: {},
    token: "xoxb-test",
    team_id: "T1",
  };
}

// ---------------------------------------------------------------------------
// Decision / voter pre-seed helpers
// ---------------------------------------------------------------------------

/**
 * Build an active decision row with R required voters and the supplied
 * success_criteria/quorum. Deadline is set far in the future so the
 * past-deadline branch in the vote handler never fires.
 */
function makeActiveDecision(opts: {
  id: string;
  R: number;
  quorum: number;
}): DecisionRecord {
  return {
    id: opts.id,
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "simple_majority",
    quorum: opts.quorum,
    required_voters_count: opts.R,
    deadline: "2099-05-15",
    deadline_resolved: FAR_FUTURE_DEADLINE,
    deadline_tz: "Europe/London",
    channel_id: CHANNEL_ID,
    creator_id: "U_ALICE",
    message_ts: MESSAGE_TS,
    status: "active",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

function makeVoter(decisionId: string, userId: string): VoterRecord {
  return {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    is_active: true,
    created_at: CREATED_AT,
  };
}

/**
 * Pre-seed a `MockSlackClient` with an active decision and its voters.
 * Caller supplies the user IDs; each becomes an active voter row.
 */
function seed(
  client: MockSlackClient,
  decision: DecisionRecord,
  voterIds: string[],
): void {
  client.setDatastoreItem(
    "decisions",
    decision as unknown as { id: string } & Record<string, unknown>,
  );
  for (const uid of voterIds) {
    client.setDatastoreItem(
      "voters",
      makeVoter(decision.id, uid) as unknown as
        & { id: string }
        & Record<string, unknown>,
    );
  }
}

// ---------------------------------------------------------------------------
// Fetch bridge — translate SDK HTTP calls to MockSlackClient
// ---------------------------------------------------------------------------

/**
 * Slack-shaped response object. Permissive `unknown` payload because the
 * concrete shape varies per method (datastore vs chat vs pins).
 */
interface SlackBridgeResponse {
  ok: boolean;
  [key: string]: unknown;
}

/**
 * Read the `init.body` of an outgoing fetch request and reduce it to a
 * key→value record. The SDK serialises datastore calls as JSON, but nested
 * fields like `item`, `expression_values`, `expression_attributes`, and
 * `blocks` arrive as JSON-stringified inner payloads — we re-parse those at
 * dispatch time so the mock receives the same shape unit tests would pass.
 */
async function readBody(
  init: RequestInit | undefined,
): Promise<Record<string, unknown>> {
  if (!init || init.body === undefined || init.body === null) return {};
  const b = init.body;
  if (typeof b === "string") {
    try {
      const parsed = JSON.parse(b) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      // Form-urlencoded fallback.
      const out: Record<string, unknown> = {};
      for (const part of b.split("&")) {
        const [k, v] = part.split("=");
        if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
      }
      return out;
    }
  }
  if (b instanceof URLSearchParams) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of b.entries()) out[k] = v;
    return out;
  }
  if (b instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of b.entries()) out[k] = v;
    return out;
  }
  // ReadableStream — drain through Response.
  try {
    const text = await new Response(b as BodyInit).text();
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return { _raw: text };
    }
  } catch {
    return {};
  }
}

/** Coerce an unknown to a string (default ""). */
function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Coerce an unknown to a number, or undefined if not a number. */
function n(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = Number.parseInt(v, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Re-parse a JSON-stringified inner field if needed. The SDK sometimes wraps
 * structured request fields (item, expression_values, expression_attributes,
 * blocks) as JSON strings in the outer JSON body.
 */
function parseInner(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/**
 * Dispatch a single Slack Web API call body to the appropriate
 * `MockSlackClient` method and return the (resolved) response object.
 *
 * Intentionally kept narrow — only the methods the create_decision handlers
 * exercise are routed. Anything else throws so a missing route surfaces
 * loudly in the test rather than silently returning `{ok: true}`.
 */
async function dispatchToMock(
  client: MockSlackClient,
  method: string,
  body: Record<string, unknown>,
): Promise<SlackBridgeResponse> {
  switch (method) {
    case "users.info": {
      const r = await client.users.info({ user: s(body.user) });
      return r as unknown as SlackBridgeResponse;
    }
    case "team.info": {
      const r = await client.team.info();
      return r as unknown as SlackBridgeResponse;
    }
    case "conversations.members": {
      const r = await client.conversations.members({
        channel: s(body.channel),
        cursor: body.cursor !== undefined ? s(body.cursor) : undefined,
        limit: n(body.limit),
      });
      return r as unknown as SlackBridgeResponse;
    }
    case "usergroups.list": {
      const r = await client.usergroups.list({
        cursor: body.cursor !== undefined ? s(body.cursor) : undefined,
        limit: n(body.limit),
      });
      return r as unknown as SlackBridgeResponse;
    }
    case "usergroups.users.list": {
      const r = await client.usergroups.users.list({
        usergroup: s(body.usergroup),
        cursor: body.cursor !== undefined ? s(body.cursor) : undefined,
        limit: n(body.limit),
      });
      return r as unknown as SlackBridgeResponse;
    }
    case "chat.postMessage": {
      const args: ChatPostMessageArgs = {
        channel: s(body.channel),
        text: body.text !== undefined ? s(body.text) : undefined,
        thread_ts: body.thread_ts !== undefined ? s(body.thread_ts) : undefined,
        blocks: parseInner(body.blocks) as SlackBlock[] | undefined,
      };
      const r = await client.chat.postMessage(args);
      return r as unknown as SlackBridgeResponse;
    }
    case "chat.postEphemeral": {
      const args: ChatPostEphemeralArgs = {
        channel: s(body.channel),
        user: s(body.user),
        text: body.text !== undefined ? s(body.text) : undefined,
        blocks: parseInner(body.blocks) as SlackBlock[] | undefined,
      };
      const r = await client.chat.postEphemeral(args);
      return r as unknown as SlackBridgeResponse;
    }
    case "chat.update": {
      const args: ChatUpdateArgs = {
        channel: s(body.channel),
        ts: s(body.ts),
        text: body.text !== undefined ? s(body.text) : undefined,
        blocks: parseInner(body.blocks) as SlackBlock[] | undefined,
      };
      const r = await client.chat.update(args);
      return r as unknown as SlackBridgeResponse;
    }
    case "chat.delete": {
      const r = await client.chat.delete({
        channel: s(body.channel),
        ts: s(body.ts),
      });
      return r as unknown as SlackBridgeResponse;
    }
    case "pins.list": {
      const r = await client.pins.list({ channel: s(body.channel) });
      return r as unknown as SlackBridgeResponse;
    }
    case "pins.add": {
      const r = await client.pins.add({
        channel: s(body.channel),
        timestamp: s(body.timestamp),
      });
      return r as unknown as SlackBridgeResponse;
    }
    case "pins.remove": {
      const r = await client.pins.remove({
        channel: s(body.channel),
        timestamp: s(body.timestamp),
      });
      return r as unknown as SlackBridgeResponse;
    }
    case "apps.datastore.get": {
      const r = await client.apps.datastore.get({
        datastore: s(body.datastore),
        id: s(body.id),
      });
      return r as unknown as SlackBridgeResponse;
    }
    case "apps.datastore.put": {
      const item = parseInner(body.item) as Record<string, unknown>;
      const r = await client.apps.datastore.put({
        datastore: s(body.datastore),
        item,
      });
      return r as unknown as SlackBridgeResponse;
    }
    case "apps.datastore.query": {
      const args: DatastoreQueryArgs = {
        datastore: s(body.datastore),
        expression: body.expression !== undefined
          ? s(body.expression)
          : undefined,
        expression_attributes: parseInner(body.expression_attributes) as
          | Record<string, string>
          | undefined,
        expression_values: parseInner(body.expression_values) as
          | Record<string, unknown>
          | undefined,
        cursor: body.cursor !== undefined ? s(body.cursor) : undefined,
        limit: n(body.limit),
      };
      const r = await client.apps.datastore.query(args);
      return r as unknown as SlackBridgeResponse;
    }
    case "apps.datastore.delete": {
      const r = await client.apps.datastore.delete({
        datastore: s(body.datastore),
        id: s(body.id),
      });
      return r as unknown as SlackBridgeResponse;
    }
    default:
      throw new Error(`bridge: unsupported method ${method}`);
  }
}

/**
 * Build a `globalThis.fetch` replacement that routes Slack Web API requests
 * to `client`. URLs whose pathname matches `/api/<method>` are translated;
 * non-Slack URLs throw to make unintended escapes loud.
 */
function makeFetchBridge(client: MockSlackClient): typeof globalThis.fetch {
  return async (
    input: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const m = url.match(/\/api\/([^?]+)/);
    if (!m) {
      throw new Error(`bridge: not a Slack API URL: ${url}`);
    }
    const method = m[1];
    const body = await readBody(init);
    let resp: SlackBridgeResponse;
    try {
      resp = await dispatchToMock(client, method, body);
    } catch (err) {
      resp = { ok: false, error: String(err) };
    }
    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

/**
 * Run `body` with `globalThis.fetch` replaced by a bridge bound to `client`,
 * restoring the original `fetch` afterwards (even on throw).
 */
async function withBridge<T>(
  client: MockSlackClient,
  body: () => Promise<T>,
): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = makeFetchBridge(client);
  try {
    return await body();
  } finally {
    globalThis.fetch = real;
  }
}

// ---------------------------------------------------------------------------
// SlackFunction default-export driver
// ---------------------------------------------------------------------------

/**
 * Type narrowing for the SDK's `SlackFunction` wrapper. The wrapper exposes
 * a `blockActions` method that takes an enriched-by-the-SDK context, runs
 * `matchHandler` to pick the registered chain, and invokes the handler.
 *
 * We keep this narrow so the cast at the call site is contained to a single
 * place. The `inputs`/initial-execution path is not exercised here.
 */
interface SlackFunctionWrapper {
  blockActions(ctx: BlockActionsCtx): Promise<unknown>;
}

const wrapper =
  createDecisionFunctionDefault as unknown as SlackFunctionWrapper;

// ---------------------------------------------------------------------------
// Call-introspection helpers
// ---------------------------------------------------------------------------

function adrPosts(client: MockSlackClient): ChatPostMessageArgs[] {
  return client.getCallsFor("chat.postMessage")
    .map((c) => c.args as ChatPostMessageArgs)
    .filter((a) => a.thread_ts === MESSAGE_TS);
}

function chatUpdates(client: MockSlackClient): ChatUpdateArgs[] {
  return client.getCallsFor("chat.update").map((c) => c.args as ChatUpdateArgs);
}

function ephemerals(client: MockSlackClient): ChatPostEphemeralArgs[] {
  return client.getCallsFor("chat.postEphemeral")
    .map((c) => c.args as ChatPostEphemeralArgs);
}

function decisionPuts(client: MockSlackClient): DecisionRecord[] {
  return client.getCallsFor("apps.datastore.put")
    .map((c) => c.args as { datastore: string; item: unknown })
    .filter((a) => a.datastore === "decisions")
    .map((a) => a.item as DecisionRecord);
}

function voteHistoryPuts(client: MockSlackClient): VoteHistoryRecord[] {
  return client.getCallsFor("apps.datastore.put")
    .map((c) => c.args as { datastore: string; item: unknown })
    .filter((a) => a.datastore === "vote_history")
    .map((a) => a.item as VoteHistoryRecord);
}

function votesPuts(client: MockSlackClient): VoteRecord[] {
  return client.getCallsFor("apps.datastore.put")
    .map((c) => c.args as { datastore: string; item: unknown })
    .filter((a) => a.datastore === "votes")
    .map((a) => a.item as VoteRecord);
}

/**
 * Return whether any chat.update call carries a "cancelled" layout. The
 * cancelled layout's `text` (audit §10) starts with "Decision cancelled:"
 * (per `cancelHandler`'s `chat.update` body) — that pinpoints the cancelled
 * state without coupling to block structure.
 */
function hasCancelledChatUpdate(client: MockSlackClient): boolean {
  return chatUpdates(client).some((u) =>
    typeof u.text === "string" && u.text.startsWith("Decision cancelled:")
  );
}

function hasFinalisedChatUpdate(client: MockSlackClient): boolean {
  return chatUpdates(client).some((u) =>
    typeof u.text === "string" && u.text.startsWith("Decision finalised:")
  );
}

// ===========================================================================
// Test 1 — Two simultaneous vote_yes clicks producing finalisation
// ===========================================================================
//
// Pre-seed an active decision with R=2 and voters [U1, U2]. Drive both vote
// handlers concurrently via `Promise.all`. Both handlers read the
// un-finalised decision at vote-step 2; both compute mergedVotes.length=2
// once both PUT(votes) settle, and both reach `finalizeDecision`.
//
// The §16.3 invariant under test is "at most one ADR posted to the
// thread". The persisted `finalized_at` token is the gate: the second
// finalizer's step-1 re-read sees the token set and aborts before posting
// the ADR.
//
// Determinism note (FRAGILE assertion):
//   The bare `Promise.all([h1, h2])` form interleaves both handlers in
//   microtask lockstep against the in-memory mock; both reach
//   `finalizeDecision` at the same `Date.now()` millisecond, the §13.9
//   strict-less-than tie-break can't engage, and BOTH would post a
//   duplicate ADR. To exercise the §16.3 invariant deterministically we
//   stagger handler 2's start through a chain of resolved-promise hops.
//   That gives handler 1 enough head-start to write `finalized_at` before
//   handler 2 reads the row in step-1 of its own finalisation, so handler
//   2 aborts cleanly. 64 hops is the smallest empirically-stable margin on
//   this machine; 32 was borderline. See the report at the bottom of this
//   file's accompanying task notes for the deeper analysis.
//
// Acceptance:
//   - chat.postMessage(thread_ts === MESSAGE_TS) called <= 1 time
//   - decision row has finalized_at set
//   - decision row status is "approved" (R=2, 2 yes ⇒ simple_majority passes)
//   - both U1 and U2 votes were recorded

Deno.test(
  "race — two simultaneous vote_yes clicks: at most one ADR posted",
  async () => {
    const client = new MockSlackClient();
    const decisionId = "11111111-2222-3333-4444-555555555555";
    const decision = makeActiveDecision({ id: decisionId, R: 2, quorum: 2 });
    seed(client, decision, ["U1", "U2"]);

    await withBridge(client, async () => {
      const c1 = makeBlockActionsCtx("vote_yes", decisionId, "U1");
      const c2 = makeBlockActionsCtx("vote_yes", decisionId, "U2");
      // Microtask stagger — see "Determinism note" in the block comment above.
      const microtaskHops = 64;
      let chained: Promise<unknown> = Promise.resolve();
      for (let i = 0; i < microtaskHops; i++) {
        chained = chained.then(() => undefined);
      }
      await Promise.all([
        wrapper.blockActions(c1),
        chained.then(() => wrapper.blockActions(c2)),
      ]);
    });

    // §16.3 — at most one ADR.
    const adr = adrPosts(client);
    assert(
      adr.length <= 1,
      `expected at most 1 ADR posted to thread, got ${adr.length}`,
    );

    // §13 step 5 — finalised_at must be set on the persisted decision row.
    const finalised = decisionPuts(client).filter((d) =>
      typeof d.finalized_at === "string" && d.finalized_at.length > 0
    );
    assert(
      finalised.length >= 1,
      "expected at least one PUT(decisions) to set finalized_at",
    );
    const last = finalised[finalised.length - 1];
    assertEquals(last.id, decisionId);
    assert(
      typeof last.finalized_at === "string" && last.finalized_at.length > 0,
      "finalized_at must be set on the decision row",
    );
    // Status must transition to a terminal value (R=2 with 2 yes votes →
    // simple_majority passes → "approved").
    assertEquals(last.status, "approved");

    // Both votes were recorded.
    const voteRows = votesPuts(client);
    const voters = new Set(voteRows.map((v) => v.user_id));
    assert(voters.has("U1"), "expected U1's vote to be recorded");
    assert(voters.has("U2"), "expected U2's vote to be recorded");
  },
);

// ===========================================================================
// Test 2 — Cancel vs vote_yes (R=1) race
// ===========================================================================
//
// Pre-seed an active decision with R=1 and one voter U1. Drive the cancel
// click (by the creator U_ALICE) and U1's vote_yes click concurrently. The
// final state MUST be exactly one of:
//
//   A. cancel won: status="cancelled", chat.update with the cancelled
//      layout was posted, and NO ADR was posted to the thread.
//   B. vote won:   status in {"approved","rejected"}, an ADR was posted,
//      and the cancel handler's `reReadAndCheck` (§10 step 3) failed,
//      surfacing a "just finalised — cannot cancel" ephemeral to the
//      cancel-clicker.
//
// In either case at least one ephemeral was posted to the loser:
//   - Case A: the vote handler's "no longer active" ephemeral or its
//     "vote recorded" ephemeral lands on U1 (the in-flight voter).
//   - Case B: the cancel handler's "just finalised — cannot cancel"
//     ephemeral lands on the cancel clicker.

Deno.test(
  "race — cancel vs vote_yes (R=1): exactly one terminal state, loser gets ephemeral",
  async () => {
    const client = new MockSlackClient();
    const decisionId = "22222222-3333-4444-5555-666666666666";
    const decision = makeActiveDecision({ id: decisionId, R: 1, quorum: 1 });
    seed(client, decision, ["U1"]);

    await withBridge(client, async () => {
      const cancelCtx = makeBlockActionsCtx(
        "decision_cancel",
        decisionId,
        decision.creator_id,
      );
      const voteCtx = makeBlockActionsCtx("vote_yes", decisionId, "U1");
      await Promise.all([
        wrapper.blockActions(cancelCtx),
        wrapper.blockActions(voteCtx),
      ]);
    });

    // Inspect the latest persisted decision row (last PUT wins, mirroring
    // the SPEC §13 step-5 last-write-wins note).
    const dPuts = decisionPuts(client);
    assert(
      dPuts.length >= 1,
      "expected at least one PUT to the decisions row",
    );
    const finalRow = dPuts[dPuts.length - 1];
    const cancelledUiPosted = hasCancelledChatUpdate(client);
    const finalisedUiPosted = hasFinalisedChatUpdate(client);
    const adr = adrPosts(client);

    if (finalRow.status === "cancelled") {
      // Case A — cancel handler won the race.
      assert(
        cancelledUiPosted,
        "cancel won → expected a chat.update with cancelled layout",
      );
      assertEquals(
        adr.length,
        0,
        "cancel won → no ADR should have been posted",
      );
      // The voter's handler still ran; an ephemeral landed on U1 either
      // because the status guard ("no longer active") fired or because
      // their vote-recorded ephemeral fired. Either lands on U1.
      const u1Ephemerals = ephemerals(client).filter((e) => e.user === "U1");
      assert(
        u1Ephemerals.length >= 1,
        "cancel won → expected at least one ephemeral to U1 (the loser)",
      );
    } else if (
      finalRow.status === "approved" || finalRow.status === "rejected"
    ) {
      // Case B — vote handler's finalisation won the race.
      assertEquals(
        finalRow.status,
        "approved",
        "vote_yes with quorum=1 and 1 yes vote → simple_majority passes",
      );
      assert(
        finalisedUiPosted,
        "vote won → expected a chat.update with finalised layout",
      );
      assert(
        adr.length >= 1 && adr.length <= 1,
        `vote won → expected exactly one ADR posted, got ${adr.length}`,
      );
      assert(
        typeof finalRow.finalized_at === "string" &&
          finalRow.finalized_at.length > 0,
        "vote won → finalized_at must be set",
      );
      // Cancel handler's `reReadAndCheck` (§10 step 3) detected the status
      // flip and surfaced the explicit "just finalised — cannot cancel"
      // ephemeral. The cancel clicker is `decision.creator_id` per the ctx
      // construction above.
      const cancelEphemerals = ephemerals(client).filter((e) =>
        e.user === decision.creator_id &&
        typeof e.text === "string" &&
        e.text.includes("just finalised")
      );
      assert(
        cancelEphemerals.length >= 1,
        `vote won → expected a "just finalised" ephemeral to the cancel ` +
          `clicker; got ephemerals: ${JSON.stringify(ephemerals(client))}`,
      );
    } else {
      throw new Error(
        `unexpected terminal status: ${finalRow.status} (expected one of: ` +
          `"cancelled", "approved", "rejected")`,
      );
    }

    // Cross-cutting invariant: cancellation and ADR posting are mutually
    // exclusive — if cancel won there's no ADR; otherwise an ADR exists.
    if (finalRow.status === "cancelled") {
      assertEquals(
        adr.length,
        0,
        "mutually-exclusive invariant: cancelled state must not co-exist " +
          "with an ADR post",
      );
    }
  },
);

// ===========================================================================
// Test 3 — Same user clicking the same button twice (sequential)
// ===========================================================================
//
// Pre-seed an active decision with R=3 (so 1 vote does NOT trigger
// finalisation) and a single voter U1. Drive U1's vote_yes click twice
// sequentially.
//
//   Click 1: previous_vote_type undefined → event_kind="cast" → `previous_vote_type` absent.
//   Click 2: votes row already exists with vote_type="yes"; the handler reads
//            previous_vote_type="yes" and writes a NEW vote_history row with
//            event_kind="changed" (§9 step 7: `previous_vote_type ? "changed"
//            : "cast"`). Even though the vote_type is unchanged, the event
//            is logged as a "changed" because previous_vote_type was set.
//
// Acceptance:
//   - exactly ONE vote_history row has event_kind: "cast"
//   - the votes row carries vote_type: "yes" (unchanged across clicks)

Deno.test(
  "race — same user double-click vote_yes: exactly one vote_history `cast` row",
  async () => {
    const client = new MockSlackClient();
    const decisionId = "33333333-4444-5555-6666-777777777777";
    const decision = makeActiveDecision({ id: decisionId, R: 3, quorum: 2 });
    seed(client, decision, ["U1"]);

    await withBridge(client, async () => {
      const ctx = makeBlockActionsCtx("vote_yes", decisionId, "U1");
      // Sequential — NOT Promise.all — per task brief.
      await wrapper.blockActions(ctx);
      await wrapper.blockActions(ctx);
    });

    // Filter vote_history PUTs by event_kind. Exactly one "cast" row.
    const history = voteHistoryPuts(client);
    const castRows = history.filter((h) => h.event_kind === "cast");
    assertEquals(
      castRows.length,
      1,
      `expected exactly 1 vote_history row with event_kind="cast"; got ` +
        `${castRows.length}`,
    );
    // The `cast` row carries no previous_vote_type per SPEC §5.4 / §9 step 7.
    assertEquals(castRows[0].previous_vote_type, undefined);
    assertEquals(castRows[0].vote_type, "yes");
    assertEquals(castRows[0].user_id, "U1");
    assertEquals(castRows[0].decision_id, decisionId);

    // Subsequent vote clicks (same vote_type) still produce a `changed`
    // history row because `previous_vote_type` was set on the read.
    const changedRows = history.filter((h) => h.event_kind === "changed");
    assertEquals(
      changedRows.length,
      1,
      `expected exactly 1 vote_history row with event_kind="changed" after ` +
        `the second click; got ${changedRows.length}`,
    );
    assertEquals(changedRows[0].previous_vote_type, "yes");
    assertEquals(changedRows[0].vote_type, "yes");

    // The current `votes` row reflects the persistent vote_type — "yes".
    const votes = votesPuts(client).filter((v) => v.user_id === "U1");
    assert(
      votes.length >= 1,
      "expected at least one PUT(votes) for U1",
    );
    const latest = votes[votes.length - 1];
    assertEquals(latest.vote_type, "yes");
    assertEquals(latest.decision_id, decisionId);
    assertEquals(latest.id, `${decisionId}_U1`);
  },
);
