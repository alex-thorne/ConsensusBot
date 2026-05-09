// ConsensusBot v2.0 — Integration tests for `process_active_decisions`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §18    (Process Active Decisions)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §13    (finalizeDecision semantics)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16.3  (`finalized_at` idempotency)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.2  (integration tests)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md     T-504
//
// Acceptance:
//   deno test --allow-all tests/integration/process_active_decisions_test.ts
//
// Test driver. The `deno-slack-sdk` `SlackFunction(...)` wrapper unconditionally
// rebuilds the runtime client from `context.token` via `enrichContext`, so
// passing a `MockSlackClient` directly via the context is silently overridden.
// Instead, this file installs a `globalThis.fetch` interceptor that routes
// every Slack Web API request (`https://slack.com/api/<method>`) through a
// `MockSlackClient` instance. Each handler reads the URL-encoded body, parses
// the relevant JSON-encoded fields (`item`, `expression_*`, `blocks`), and
// dispatches to the matching MockSlackClient method. Responses are returned as
// JSON.
//
// This pattern preserves the SPEC §18 contract end-to-end: the function file
// is exercised verbatim, the SDK builds its real client, and the only change
// is at the network seam — exactly what an integration test is supposed to
// pin.
//
// Single-file ownership (T-504): this file does not modify any other source
// file in the repo.

import { assert, assertEquals, assertExists } from "@std/assert";

import processActiveDecisionsDefault from "../../functions/process_active_decisions.ts";
import { MockSlackClient } from "../mocks/slack_client.ts";

import type {
  DecisionRecord,
  VoterRecord,
  VoteType,
} from "../../types/decision_types.ts";
import type {
  ChatPostMessageArgs,
  ChatUpdateArgs,
  ConversationsMembersArgs,
  DatastoreDeleteArgs,
  DatastoreGetArgs,
  DatastorePutArgs,
  DatastoreQueryArgs,
  DatastoreQueryResponse,
  PinsListArgs,
  PinsRemoveArgs,
  UsersInfoArgs,
} from "../../types/slack_types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** §18.3 — soft cap on active decisions per tick. */
const MAX_ACTIVE_DECISIONS_PER_TICK = 1000;

/** Channel id used across all decisions in this file. */
const CHANNEL_ID = "C0001";

// ---------------------------------------------------------------------------
// Function-context shim
// ---------------------------------------------------------------------------

/**
 * The shape of the runtime context object the SDK wrapper expects. We type
 * the subset we actually populate so the call site stays type-safe; the
 * SDK's `enrichContext` does the rest (builds an internal SlackAPI client
 * from `token`, which our fetch router intercepts).
 */
interface RuntimeFunctionContextShim {
  inputs: Record<string, never>;
  env: Record<string, string>;
  token: string;
  team_id: string;
  enterprise_id: string;
}

/** Build a default context. */
function makeContext(): RuntimeFunctionContextShim {
  return {
    inputs: {},
    env: {},
    token: "xoxb-integration-test",
    team_id: "T_TEST",
    enterprise_id: "",
  };
}

/**
 * Invoke the default-exported wrapped SlackFunction. The wrapper has no
 * statically-typed call signature exposed (it returns `SlackFunctionType`
 * with a zero-property surface), so we type the entry point explicitly to
 * avoid `any` while still calling it correctly.
 */
async function runProcessActiveDecisions(): Promise<{
  outputs: { reminders_sent: number; decisions_finalised: number };
}> {
  type Entry = (
    ctx: RuntimeFunctionContextShim,
  ) => Promise<{
    outputs: { reminders_sent: number; decisions_finalised: number };
  }>;
  const entry = processActiveDecisionsDefault as unknown as Entry;
  return await entry(makeContext());
}

// ---------------------------------------------------------------------------
// Fetch router — translate Slack Web API calls into MockSlackClient methods
// ---------------------------------------------------------------------------

/**
 * Keys whose form-encoded value is itself a JSON document (the SDK serialises
 * complex args this way). Anything not in this set is passed through verbatim.
 */
const JSON_VALUED_KEYS = new Set([
  "expression_attributes",
  "expression_values",
  "item",
  "blocks",
  "fields",
]);

/** Numeric form-encoded keys we reify (`limit` is the only one used today). */
const NUMERIC_VALUED_KEYS = new Set(["limit"]);

/**
 * Parse a `application/x-www-form-urlencoded` request body into a plain
 * object, decoding JSON-shaped values for known multi-value keys.
 */
function parseFormBody(body: string): Record<string, unknown> {
  const params = new URLSearchParams(body);
  const out: Record<string, unknown> = {};
  for (const [k, v] of params.entries()) {
    if (JSON_VALUED_KEYS.has(k)) {
      try {
        out[k] = JSON.parse(v);
        continue;
      } catch {
        // Fall through to string assignment.
      }
    }
    if (NUMERIC_VALUED_KEYS.has(k)) {
      const n = Number(v);
      out[k] = Number.isNaN(n) ? v : n;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Read the body of a fetch request; the SDK's BaseSlackAPIClient sends a
 * `application/x-www-form-urlencoded` string body via `init.body`.
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

/** A side-channel hook: optionally override the response for one method. */
type RouterOverride = (
  method: string,
  args: Record<string, unknown>,
) => Promise<unknown> | unknown | undefined;

/**
 * Build a fetch interceptor that dispatches Slack Web API calls into a
 * `MockSlackClient`. The optional `override` callback receives every parsed
 * call BEFORE the mock is invoked; if it returns a non-undefined value, that
 * value is used as the response body (used for pagination injection). This
 * keeps individual tests free to splice in custom behaviour without forking
 * the mock surface.
 */
function makeFetchRouter(
  mock: MockSlackClient,
  override?: RouterOverride,
): typeof fetch {
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
      return jsonResponse({ ok: false, error: `unrouted_url:${url}` });
    }
    const method = m[1];
    const bodyStr = await readBody(input, init);
    const args = parseFormBody(bodyStr);

    if (override) {
      const overridden = await override(method, args);
      if (overridden !== undefined) {
        return jsonResponse(overridden);
      }
    }

    let result: unknown;
    try {
      switch (method) {
        case "apps.datastore.query":
          result = await mock.apps.datastore.query(
            args as unknown as DatastoreQueryArgs,
          );
          break;
        case "apps.datastore.get":
          result = await mock.apps.datastore.get(
            args as unknown as DatastoreGetArgs,
          );
          break;
        case "apps.datastore.put":
          result = await mock.apps.datastore.put(
            args as unknown as DatastorePutArgs<Record<string, unknown>>,
          );
          break;
        case "apps.datastore.delete":
          result = await mock.apps.datastore.delete(
            args as unknown as DatastoreDeleteArgs,
          );
          break;
        case "chat.postMessage":
          result = await mock.chat.postMessage(
            args as unknown as ChatPostMessageArgs,
          );
          break;
        case "chat.update":
          result = await mock.chat.update(args as unknown as ChatUpdateArgs);
          break;
        case "users.info":
          result = await mock.users.info(args as unknown as UsersInfoArgs);
          break;
        case "conversations.members":
          result = await mock.conversations.members(
            args as unknown as ConversationsMembersArgs,
          );
          break;
        case "pins.list":
          result = await mock.pins.list(args as unknown as PinsListArgs);
          break;
        case "pins.remove":
          result = await mock.pins.remove(args as unknown as PinsRemoveArgs);
          break;
        case "team.info":
          result = await mock.team.info();
          break;
        default:
          // Anything else is allowed but logged as `ok: true` to stay neutral
          // in tests that don't care about it. If a test cares, it will
          // assert via `mock.calls`.
          result = { ok: true };
      }
    } catch (err) {
      result = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return jsonResponse(result);
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Run a callback with `globalThis.fetch` swapped for the given router. The
 * original fetch is always restored, even on throw, so concurrent test files
 * are unaffected. Tests are intentionally serial within this file.
 */
async function withFetchRouter(
  router: typeof fetch,
  body: () => Promise<void>,
): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = router;
  try {
    await body();
  } finally {
    globalThis.fetch = orig;
  }
}

// ---------------------------------------------------------------------------
// Console-warn capture (used by the soft-cap test)
// ---------------------------------------------------------------------------

/**
 * Run `body` while capturing every `console.warn` call. Returns the captured
 * lines (unchanged from what the producer wrote). The structured logger emits
 * one JSON line per warn; tests parse that for the `event` discriminator.
 */
async function withWarnCapture(
  body: () => Promise<void>,
): Promise<string[]> {
  const captured: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]): void => {
    captured.push(args.map((a) => String(a)).join(" "));
  };
  try {
    await body();
  } finally {
    console.warn = originalWarn;
  }
  return captured;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/**
 * Build a fully-shaped `DecisionRecord`. `deadline_resolved` defaults to
 * a far-future date so the row is treated as still-active (`isDeadlinePassed`
 * returns false). Pass an ISO string in the past to force Phase A.
 */
function makeDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const id = overrides.id ?? "00000000-0000-0000-0000-000000000001";
  const futureIso = "2099-12-31T23:59:59.999Z";
  return {
    id,
    name: `Decision ${id}`,
    proposal: `Proposal for ${id}`,
    success_criteria: "simple_majority",
    quorum: 2,
    required_voters_count: 2,
    deadline: "2099-12-31",
    deadline_resolved: futureIso,
    deadline_tz: "Europe/London",
    channel_id: CHANNEL_ID,
    creator_id: "U_CREATOR",
    message_ts: `1715170800.${id.slice(-6)}`,
    status: "active",
    created_at: "2026-04-30T09:00:00.000Z",
    updated_at: "2026-04-30T09:00:00.000Z",
    ...overrides,
  };
}

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
    created_at: "2026-04-30T09:00:00.000Z",
  };
}

function makeVote(
  decisionId: string,
  userId: string,
  voteType: VoteType = "yes",
): { id: string } & Record<string, unknown> {
  return {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    vote_type: voteType,
    voted_at: "2026-05-01T10:00:00.000Z",
  };
}

/**
 * Cast a typed record (with required `id`) to the `setDatastoreItem`
 * parameter shape. The underlying record interfaces are deliberately closed
 * (no index signature), so we route through `unknown` to satisfy the
 * mock's permissive setter without weakening the call sites that build
 * the rows from `DecisionRecord` / `VoterRecord`.
 */
function asStoreItem<T extends { id: string }>(
  row: T,
): { id: string } & Record<string, unknown> {
  return row as unknown as { id: string } & Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Argument extractors (kept outside tests so each Deno.test stays focused)
// ---------------------------------------------------------------------------

function chatPostMessageArgs(call: { args: unknown }): ChatPostMessageArgs {
  return call.args as ChatPostMessageArgs;
}
function datastorePutArgs(
  call: { args: unknown },
): DatastorePutArgs<Record<string, unknown>> {
  return call.args as DatastorePutArgs<Record<string, unknown>>;
}
function datastoreQueryArgs(call: { args: unknown }): DatastoreQueryArgs {
  return call.args as DatastoreQueryArgs;
}

// ===========================================================================
// 1. Phase A finalises a past-deadline decision (§18.1 + §13)
// ===========================================================================

Deno.test(
  "Phase A — past-deadline decision is finalised, ADR posted in thread, decisions_finalised >= 1",
  async () => {
    const mock = new MockSlackClient();

    // Pre-seed an active, past-deadline decision with two yes votes.
    const decisionId = "11111111-1111-1111-1111-111111111111";
    const decision = makeDecision({
      id: decisionId,
      // deadline_resolved is in the past -> Phase A must finalise.
      deadline_resolved: "2026-04-01T22:59:59.000Z",
      deadline: "2026-04-01",
      name: "Adopt Deno 2",
      proposal: "Migrate the codebase to Deno 2.x.",
      message_ts: "1715170800.000100",
      quorum: 2,
      required_voters_count: 2,
    });
    mock.setDatastoreItem("decisions", asStoreItem(decision));

    // Voters: U1 + U2 active.
    mock.setDatastoreItem("voters", asStoreItem(makeVoter(decisionId, "U1")));
    mock.setDatastoreItem("voters", asStoreItem(makeVoter(decisionId, "U2")));

    // Both voted yes.
    mock.setDatastoreItem(
      "votes",
      asStoreItem(makeVote(decisionId, "U1", "yes")),
    );
    mock.setDatastoreItem(
      "votes",
      asStoreItem(makeVote(decisionId, "U2", "yes")),
    );

    let result:
      | { outputs: { reminders_sent: number; decisions_finalised: number } }
      | undefined;
    await withFetchRouter(makeFetchRouter(mock), async () => {
      result = await runProcessActiveDecisions();
    });

    assertExists(result);
    // §18.5 — outputs.decisions_finalised increments.
    assert(
      result.outputs.decisions_finalised >= 1,
      `expected decisions_finalised >= 1, got ${result.outputs.decisions_finalised}`,
    );

    // §13 step 5 — decision row was put with status="approved",
    // outcome_reason set, finalized_at set.
    const decisionPuts = mock.getCallsFor("apps.datastore.put").filter((c) =>
      datastorePutArgs(c).datastore === "decisions"
    );
    assert(
      decisionPuts.length >= 1,
      "expected at least one apps.datastore.put on decisions",
    );
    // The last decisions put is the finalised row.
    const finalisedPut = decisionPuts[decisionPuts.length - 1];
    const finalisedItem = datastorePutArgs(finalisedPut)
      .item as unknown as DecisionRecord;
    assertEquals(finalisedItem.id, decisionId);
    // Two yes votes against quorum 2 / required 2 / simple majority -> approved.
    assertEquals(finalisedItem.status, "approved");
    assertExists(finalisedItem.outcome_reason);
    assertExists(finalisedItem.finalized_at);
    assert(
      typeof finalisedItem.finalized_at === "string" &&
        finalisedItem.finalized_at.length > 0,
      "finalized_at must be a non-empty ISO string",
    );

    // §13 step 10 — ADR posted to the thread of the original message.
    const postCalls = mock.getCallsFor("chat.postMessage");
    const adrPosts = postCalls.filter((c) =>
      chatPostMessageArgs(c).thread_ts === decision.message_ts &&
      chatPostMessageArgs(c).channel === decision.channel_id
    );
    assert(
      adrPosts.length >= 1,
      `expected at least one ADR post in thread ${decision.message_ts}, ` +
        `got ${postCalls.length} chat.postMessage calls (none threaded)`,
    );

    // §13 step 7 — message in place updated to the "decided" layout.
    const updateCalls = mock.getCallsFor("chat.update");
    assert(
      updateCalls.length >= 1,
      "expected at least one chat.update for the decided layout",
    );
  },
);

// ===========================================================================
// 2. Phase A respects the idempotency token (§16.3)
// ===========================================================================

Deno.test(
  "Phase A — already-finalised row (finalized_at set) is skipped: no new ADR, no new decisions put",
  async () => {
    const mock = new MockSlackClient();

    // Pre-seed an active row that already carries finalized_at — i.e. a
    // previous run's idempotency token (§16.3).
    const decisionId = "22222222-2222-2222-2222-222222222222";
    const past = makeDecision({
      id: decisionId,
      deadline_resolved: "2026-04-01T22:59:59.000Z",
      deadline: "2026-04-01",
      message_ts: "1715170800.000200",
      finalized_at: "2026-04-01T22:59:59.500Z",
      // Status remains "active" because the previous-run finaliser may have
      // crashed AFTER setting finalized_at but BEFORE setting status; the
      // SPEC §18.1 admits filtering on `finalized_at` non-empty.
    });
    mock.setDatastoreItem("decisions", asStoreItem(past));

    let result:
      | { outputs: { reminders_sent: number; decisions_finalised: number } }
      | undefined;
    await withFetchRouter(makeFetchRouter(mock), async () => {
      result = await runProcessActiveDecisions();
    });

    assertExists(result);

    // No finalisation should occur.
    assertEquals(result.outputs.decisions_finalised, 0);

    // No ADR post (thread_ts === message_ts).
    const adrPosts = mock.getCallsFor("chat.postMessage").filter((c) =>
      chatPostMessageArgs(c).thread_ts === past.message_ts
    );
    assertEquals(
      adrPosts.length,
      0,
      "no ADR thread posts expected when finalized_at is already set",
    );

    // No new decisions.put either — the function must not rewrite the row.
    const decisionPuts = mock.getCallsFor("apps.datastore.put").filter((c) =>
      datastorePutArgs(c).datastore === "decisions"
    );
    assertEquals(
      decisionPuts.length,
      0,
      "no decisions.put expected when finalized_at is already set",
    );

    // No chat.update for the "decided" layout either.
    assertEquals(mock.getCallsFor("chat.update").length, 0);
  },
);

// ===========================================================================
// 3. Phase B — DM reminders only to active non-voters (§18.2)
// ===========================================================================

Deno.test(
  "Phase B — DMs only to active non-voters; voters who voted and inactive voters are skipped",
  async () => {
    const mock = new MockSlackClient();

    const decisionId = "33333333-3333-3333-3333-333333333333";
    const decision = makeDecision({
      id: decisionId,
      // Future deadline: stays active; Phase B runs.
      deadline_resolved: "2099-12-31T23:59:59.999Z",
      deadline: "2099-12-31",
      message_ts: "1715170800.000300",
      quorum: 3,
      required_voters_count: 4,
    });
    mock.setDatastoreItem("decisions", asStoreItem(decision));

    // U1 active + voted; U2 active + not voted; U3 inactive + not voted;
    // U4 active + not voted.
    mock.setDatastoreItem("voters", asStoreItem(makeVoter(decisionId, "U1")));
    mock.setDatastoreItem("voters", asStoreItem(makeVoter(decisionId, "U2")));
    mock.setDatastoreItem(
      "voters",
      asStoreItem(makeVoter(decisionId, "U3", false)),
    );
    mock.setDatastoreItem("voters", asStoreItem(makeVoter(decisionId, "U4")));
    mock.setDatastoreItem(
      "votes",
      asStoreItem(makeVote(decisionId, "U1", "yes")),
    );

    let result:
      | { outputs: { reminders_sent: number; decisions_finalised: number } }
      | undefined;
    await withFetchRouter(makeFetchRouter(mock), async () => {
      result = await runProcessActiveDecisions();
    });

    assertExists(result);
    assertEquals(result.outputs.decisions_finalised, 0);
    assertEquals(result.outputs.reminders_sent, 2);

    // DMs are `chat.postMessage(channel: <user_id>, ...)` — i.e. the
    // `channel` is the bare user id (im:write). Filter to those.
    const dmCalls = mock.getCallsFor("chat.postMessage").filter((c) =>
      chatPostMessageArgs(c).thread_ts === undefined
    );
    const dmRecipients = dmCalls.map((c) => chatPostMessageArgs(c).channel)
      .sort();
    assertEquals(dmRecipients, ["U2", "U4"]);

    // No DM to U1 (already voted) or U3 (inactive).
    assert(!dmRecipients.includes("U1"), "no DM should be sent to a voter");
    assert(
      !dmRecipients.includes("U3"),
      "no DM should be sent to an inactive voter",
    );
  },
);

// ===========================================================================
// 4. Deactivated-user side effect — `is_active` flipped to false (§18.2)
// ===========================================================================

Deno.test(
  "Phase B — users.info(deleted=true) flips voter row to is_active=false; no DM to that user",
  async () => {
    const mock = new MockSlackClient();

    const decisionId = "44444444-4444-4444-4444-444444444444";
    const decision = makeDecision({
      id: decisionId,
      deadline_resolved: "2099-12-31T23:59:59.999Z",
      deadline: "2099-12-31",
      message_ts: "1715170800.000400",
      quorum: 1,
      required_voters_count: 1,
    });
    mock.setDatastoreItem("decisions", asStoreItem(decision));

    // U1 currently flagged active in the voters row, but users.info reports
    // deleted: true.
    mock.setDatastoreItem("voters", asStoreItem(makeVoter(decisionId, "U1")));
    mock.setUserDeleted("U1");
    // No votes recorded.

    await withFetchRouter(makeFetchRouter(mock), async () => {
      await runProcessActiveDecisions();
    });

    // §18.2 — `apps.datastore.put({ datastore: "voters",
    //                                item: { ..., is_active: false } })` was
    // called for U1.
    const voterPuts = mock.getCallsFor("apps.datastore.put").filter((c) =>
      datastorePutArgs(c).datastore === "voters"
    );
    assert(
      voterPuts.length >= 1,
      "expected at least one voters.put for the deactivated user",
    );
    const matched = voterPuts.find((c) => {
      const item = datastorePutArgs(c).item as unknown as VoterRecord;
      return item.user_id === "U1" && item.is_active === false;
    });
    assertExists(
      matched,
      "expected a voters.put with user_id=U1 and is_active=false",
    );

    // No DM to U1 (now-inactive voter).
    const dmCalls = mock.getCallsFor("chat.postMessage").filter((c) => {
      const args = chatPostMessageArgs(c);
      return args.channel === "U1" && args.thread_ts === undefined;
    });
    assertEquals(
      dmCalls.length,
      0,
      "no DM should be sent to a user found deleted via users.info",
    );
  },
);

// ===========================================================================
// 5. Rate-limit failure on a DM does NOT break the loop (§18.2 + §18.4)
// ===========================================================================

Deno.test(
  "Phase B — chat.postMessage failure (rate_limited) is logged and the loop continues; no throw",
  async () => {
    const mock = new MockSlackClient();

    const decisionId = "55555555-5555-5555-5555-555555555555";
    const decision = makeDecision({
      id: decisionId,
      deadline_resolved: "2099-12-31T23:59:59.999Z",
      deadline: "2099-12-31",
      message_ts: "1715170800.000500",
      quorum: 2,
      required_voters_count: 2,
    });
    mock.setDatastoreItem("decisions", asStoreItem(decision));

    // Two active non-voters.
    mock.setDatastoreItem("voters", asStoreItem(makeVoter(decisionId, "U2")));
    mock.setDatastoreItem("voters", asStoreItem(makeVoter(decisionId, "U3")));

    // Force every chat.postMessage to fail with "rate_limited". The function
    // must catch the failure (or the falsy `result.ok`), log it, and keep
    // looping. The MockSlackClient's failure is sticky, so both DMs fail —
    // the prompt admits this as a valid simulation: outputs.reminders_sent
    // should be 0 and the function returns without throwing.
    mock.forceFailure("chat.postMessage", "rate_limited");

    let result:
      | { outputs: { reminders_sent: number; decisions_finalised: number } }
      | undefined;
    let threw: unknown = null;
    await withFetchRouter(makeFetchRouter(mock), async () => {
      try {
        result = await runProcessActiveDecisions();
      } catch (err) {
        threw = err;
      }
    });

    assertEquals(threw, null, "function must not throw on DM failures");
    assertExists(result);
    assertEquals(result.outputs.reminders_sent, 0);
    assertEquals(result.outputs.decisions_finalised, 0);

    // The function still attempted the DM(s).
    const dmAttempts = mock.getCallsFor("chat.postMessage").filter((c) =>
      chatPostMessageArgs(c).thread_ts === undefined
    );
    assert(
      dmAttempts.length >= 1,
      "expected at least one DM attempt before the rate-limit failure",
    );
  },
);

// ===========================================================================
// 6. Pagination of the active-decisions query (§18.3)
// ===========================================================================

Deno.test(
  "Phase A/B — active-decisions query iterates response_metadata.next_cursor across multiple pages",
  async () => {
    const mock = new MockSlackClient();

    // Three active decisions split across two pages: [d1, d2] then [d3].
    const ids = [
      "aaaaaaaa-1111-1111-1111-111111111111",
      "aaaaaaaa-2222-2222-2222-222222222222",
      "aaaaaaaa-3333-3333-3333-333333333333",
    ];
    const decisions = ids.map((id) =>
      makeDecision({
        id,
        // Future deadline: each lands in Phase B (which queries voters/votes
        // per decision, an easy proxy that "we processed this row").
        deadline_resolved: "2099-12-31T23:59:59.999Z",
        deadline: "2099-12-31",
        message_ts: `1715170800.${id.slice(-6)}`,
      })
    );

    // Pagination is injected at the fetch seam. Counter-state is closed over
    // by the override so the response varies between calls without leaking
    // into the mock itself. The mock's other handlers (voters/votes queries)
    // continue through to MockSlackClient.
    let decisionsQueryCount = 0;
    const override: RouterOverride = (method, args) => {
      if (
        method === "apps.datastore.query" &&
        args["datastore"] === "decisions"
      ) {
        decisionsQueryCount += 1;
        const cursor = args["cursor"];
        if (
          decisionsQueryCount === 1 &&
          (cursor === undefined || cursor === "")
        ) {
          // Page 1 of 2.
          const page1: DatastoreQueryResponse<DecisionRecord> = {
            ok: true,
            items: [decisions[0], decisions[1]],
            response_metadata: { next_cursor: "PAGE2" },
          };
          return page1;
        }
        if (cursor === "PAGE2") {
          // Page 2 (final).
          const page2: DatastoreQueryResponse<DecisionRecord> = {
            ok: true,
            items: [decisions[2]],
          };
          return page2;
        }
        // Defensive: any further calls return empty/no cursor.
        const empty: DatastoreQueryResponse<DecisionRecord> = {
          ok: true,
          items: [],
        };
        return empty;
      }
      // Default through to mock for everything else.
      return undefined;
    };

    await withFetchRouter(makeFetchRouter(mock, override), async () => {
      await runProcessActiveDecisions();
    });

    // The function must have made TWO `apps.datastore.query` calls against
    // `decisions`: the first with no cursor, the second with cursor "PAGE2".
    assertEquals(
      decisionsQueryCount,
      2,
      `expected two paginated decisions queries, got ${decisionsQueryCount}`,
    );

    // All three decisions reached Phase B — each triggers a voters query
    // keyed by its decision_id.
    const voterQueries = mock.getCallsFor("apps.datastore.query").filter(
      (c) => datastoreQueryArgs(c).datastore === "voters",
    );
    const seen = new Set(
      voterQueries.map((c) => {
        const args = datastoreQueryArgs(c);
        return (args.expression_values?.[":decision_id"] as string) ?? "";
      }),
    );
    assertEquals(
      seen.size,
      3,
      `expected 3 distinct decision_ids in voters queries, got ${seen.size}`,
    );
    for (const id of ids) {
      assert(seen.has(id), `voters query missing decision_id=${id}`);
    }
  },
);

// ===========================================================================
// 7. 1000-decision soft cap logs a warning (§18.3)
// ===========================================================================

Deno.test(
  "Phase A/B — over-cap (1100 active decisions) processes only 1000 and logs `decisions_cap_exceeded`",
  async () => {
    const mock = new MockSlackClient();

    // 1100 decisions, each with a far-future deadline (so Phase A skips and
    // Phase B handles each, but with empty voters and empty votes the per-
    // decision cost is small).
    const total = MAX_ACTIVE_DECISIONS_PER_TICK + 100; // 1100
    const decisions: DecisionRecord[] = [];
    for (let i = 0; i < total; i++) {
      const id = `cccccccc-${
        String(i).padStart(4, "0")
      }-0000-0000-000000000000`;
      decisions.push(
        makeDecision({
          id,
          deadline_resolved: "2099-12-31T23:59:59.999Z",
          deadline: "2099-12-31",
          message_ts: `1715170800.${String(i).padStart(6, "0")}`,
        }),
      );
    }

    // Inject all 1100 in a single page. The mock returns them with no
    // next_cursor, so Phase A reads all in one go. The function then slices
    // to 1000 per the soft cap (§18.3) and emits a warning.
    const decisionRows: Record<string, unknown>[] = decisions.map(
      (d) => d as unknown as Record<string, unknown>,
    );
    mock.setDatastoreQueryResults("decisions", decisionRows);
    // Empty voters / votes for every per-decision query.
    mock.setDatastoreQueryResults("voters", []);
    mock.setDatastoreQueryResults("votes", []);

    let result:
      | { outputs: { reminders_sent: number; decisions_finalised: number } }
      | undefined;
    const warnings = await withWarnCapture(async () => {
      await withFetchRouter(makeFetchRouter(mock), async () => {
        result = await runProcessActiveDecisions();
      });
    });
    assertExists(result);

    // §18.3 — soft cap warning was logged. The structured logger emits one
    // JSON line per warn call.
    const capWarnings = warnings.filter((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        if (
          typeof parsed === "object" && parsed !== null &&
          "event" in parsed && "level" in parsed
        ) {
          const obj = parsed as Record<string, unknown>;
          return obj.event === "decisions_cap_exceeded" && obj.level === "warn";
        }
      } catch {
        // not JSON — ignore
      }
      return false;
    });
    assert(
      capWarnings.length >= 1,
      `expected a "decisions_cap_exceeded" warn, captured ${warnings.length} warnings`,
    );

    // Only 1000 distinct decision_ids reached Phase B.
    const voterQueries = mock.getCallsFor("apps.datastore.query").filter(
      (c) => datastoreQueryArgs(c).datastore === "voters",
    );
    const distinctIds = new Set(
      voterQueries.map((c) => {
        const args = datastoreQueryArgs(c);
        return (args.expression_values?.[":decision_id"] as string) ?? "";
      }),
    );
    assertEquals(
      distinctIds.size,
      MAX_ACTIVE_DECISIONS_PER_TICK,
      `expected ${MAX_ACTIVE_DECISIONS_PER_TICK} distinct decisions processed, got ${distinctIds.size}`,
    );
  },
);
