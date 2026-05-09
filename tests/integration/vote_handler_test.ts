// ConsensusBot v2.0 — Integration tests for the vote handler.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §9   (vote handler)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16  (eventual consistency)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.2 (integration test contract)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-503
//
// Acceptance:
//   deno test --allow-all tests/integration/vote_handler_test.ts
//
// Handler-driving approach
// ------------------------
// The vote handler is registered via
// `SlackFunction(...).addBlockActionsHandler(["vote_yes", "vote_no",
//   "vote_abstain"], voteHandler)` (see `functions/create_decision.ts`). The
// registered closure is module-private, so we cannot import it directly.
//
// The SDK's wrapper exposes a `.blockActions(ctx)` entry point that matches
// the action_id and dispatches to the registered handler. However, the
// wrapper internally calls `enrichContext(ctx)` which REPLACES the supplied
// `client` with an authenticated `deno_slack_api` client constructed from
// `ctx.token`. That client routes every call through `globalThis.fetch` to
// `https://slack.com/api/<method>` with `application/x-www-form-urlencoded`
// bodies (primitive args as `key=value`; complex args as JSON-stringified
// values).
//
// We therefore drive the handler through the SDK's official entry point
// (`fn.blockActions(ctx)`) but stub `globalThis.fetch` for the duration of
// each test. The stub parses the URL + body back into a method + args pair
// and forwards the call to a `MockSlackClient` instance, returning the
// mock's response as a JSON HTTP 200. The mock therefore records every
// Slack API call the handler issues, exactly as if the SDK had used the
// mock directly.
//
// Constraints (PLAN §2): no `any`, no `// @ts-ignore`, no env reads.

import { assert, assertEquals } from "@std/assert";

import createDecisionDefault from "../../functions/create_decision.ts";
import { MockSlackClient } from "../mocks/slack_client.ts";
import type {
  DecisionRecord,
  VoteHistoryRecord,
  VoteRecord,
  VoterRecord,
} from "../../types/decision_types.ts";
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
  SlackBlock,
  SlackSectionBlock,
  UsergroupsListArgs,
  UsergroupsUsersListArgs,
  UsersInfoArgs,
} from "../../types/slack_types.ts";

// ---------------------------------------------------------------------------
// SDK wrapper handle — a function value with a `blockActions` method.
// ---------------------------------------------------------------------------

/**
 * Narrow type that captures the parts of the SlackFunction-wrapper we use:
 * the wrapper itself (callable for the function entry) and a `.blockActions`
 * method that dispatches a block-actions payload to the registered handler.
 */
interface SlackFunctionWrapper {
  blockActions(ctx: BlockActionsCtx): Promise<unknown>;
}

/**
 * Block-actions context shape the SDK accepts. `inputs`, `env`, `token`,
 * `team_id`, `enterprise_id` are the standard SDK fields; the SDK's
 * `enrichContext` consumes `token` to construct the API client.
 */
interface BlockActionsCtx {
  action: { action_id: string; value?: string; type?: string };
  body: {
    user: { id: string };
    container: { channel_id: string; message_ts: string };
  };
  inputs: Record<string, unknown>;
  env: Record<string, string>;
  token: string;
  team_id: string;
  enterprise_id?: string;
}

const fn = createDecisionDefault as unknown as SlackFunctionWrapper;

// ---------------------------------------------------------------------------
// Fetch interception → MockSlackClient bridge
// ---------------------------------------------------------------------------

/**
 * Decode an `x-www-form-urlencoded` body into a record of args. Values that
 * look like JSON (start with `{` or `[`) are parsed; primitives pass
 * through as strings; the special tokens `"true"`/`"false"` are converted
 * to booleans so callers don't need to coerce.
 *
 * Argument names that map to numbers in the SlackClient surface (`limit`)
 * are not auto-coerced; the mock surface accepts the wider type.
 */
function decodeBody(body: string): Record<string, unknown> {
  const params = new URLSearchParams(body);
  const out: Record<string, unknown> = {};
  for (const [k, v] of params.entries()) {
    if (v.length > 0 && (v.startsWith("{") || v.startsWith("["))) {
      try {
        out[k] = JSON.parse(v);
        continue;
      } catch {
        // fall through to string assignment
      }
    }
    if (v === "true") out[k] = true;
    else if (v === "false") out[k] = false;
    else out[k] = v;
  }
  return out;
}

/**
 * Install a `globalThis.fetch` stub that routes Slack Web API calls to
 * `mock`'s methods. Returns a teardown function that restores the original
 * `fetch`. Every call is decoded into a method+args pair and dispatched via
 * a switch on the URL's API method suffix.
 *
 * Methods not exercised by the vote handler (e.g. `users.info`,
 * `usergroups.*`, `conversations.members`) are still routed correctly so
 * any unexpected call surfaces in `mock.calls` rather than throwing.
 */
function installFetchBridge(mock: MockSlackClient): () => void {
  const original = globalThis.fetch;

  const stub: typeof globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

    let bodyText = "";
    if (init?.body instanceof URLSearchParams) {
      bodyText = init.body.toString();
    } else if (typeof init?.body === "string") {
      bodyText = init.body;
    } else if (init?.body instanceof FormData) {
      const fd = init.body;
      const params = new URLSearchParams();
      for (const [k, v] of fd.entries()) params.append(k, String(v));
      bodyText = params.toString();
    }
    const args = decodeBody(bodyText);

    const slackMethodMatch = url.match(/\/api\/([^?]+)$/);
    const method = slackMethodMatch ? slackMethodMatch[1] : "";

    let payload: unknown;
    switch (method) {
      case "apps.datastore.get":
        payload = await mock.apps.datastore.get(
          args as unknown as DatastoreGetArgs,
        );
        break;
      case "apps.datastore.put":
        payload = await mock.apps.datastore.put(
          args as unknown as DatastorePutArgs<Record<string, unknown>>,
        );
        break;
      case "apps.datastore.query":
        payload = await mock.apps.datastore.query(
          args as unknown as DatastoreQueryArgs,
        );
        break;
      case "apps.datastore.delete":
        payload = await mock.apps.datastore.delete(
          args as unknown as DatastoreDeleteArgs,
        );
        break;
      case "chat.postMessage":
        payload = await mock.chat.postMessage(
          args as unknown as ChatPostMessageArgs,
        );
        break;
      case "chat.postEphemeral":
        payload = await mock.chat.postEphemeral(
          args as unknown as ChatPostEphemeralArgs,
        );
        break;
      case "chat.update":
        payload = await mock.chat.update(args as unknown as ChatUpdateArgs);
        break;
      case "chat.delete":
        payload = await mock.chat.delete(args as unknown as ChatDeleteArgs);
        break;
      case "users.info":
        payload = await mock.users.info(args as unknown as UsersInfoArgs);
        break;
      case "conversations.members":
        payload = await mock.conversations.members(
          args as unknown as ConversationsMembersArgs,
        );
        break;
      case "pins.list":
        payload = await mock.pins.list(args as unknown as PinsListArgs);
        break;
      case "pins.add":
        payload = await mock.pins.add(args as unknown as PinsAddArgs);
        break;
      case "pins.remove":
        payload = await mock.pins.remove(args as unknown as PinsRemoveArgs);
        break;
      case "usergroups.list":
        payload = await mock.usergroups.list(
          args as unknown as UsergroupsListArgs,
        );
        break;
      case "usergroups.users.list":
        payload = await mock.usergroups.users.list(
          args as unknown as UsergroupsUsersListArgs,
        );
        break;
      case "team.info":
        payload = await mock.team.info();
        break;
      default:
        payload = { ok: false, error: `unhandled_method:${method}` };
        break;
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  globalThis.fetch = stub;
  return () => {
    globalThis.fetch = original;
  };
}

// ---------------------------------------------------------------------------
// Test fixtures and helpers
// ---------------------------------------------------------------------------

const DECISION_ID = "11111111-2222-3333-4444-555555555555";
const VOTER_U1 = "U1";
const VOTER_U2 = "U2";
const CHANNEL = "C0123456789";
const MESSAGE_TS = "1715170800.000100";

/**
 * Build a baseline `active` decision row. Future deadline by default so the
 * handler does not auto-finalise; tests opt into past-deadline by overriding
 * `deadline_resolved`.
 */
function makeActiveDecision(
  overrides: Partial<DecisionRecord> = {},
): DecisionRecord {
  return {
    id: DECISION_ID,
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "simple_majority",
    quorum: 1,
    required_voters_count: 1,
    deadline: "2099-12-31",
    deadline_resolved: "2099-12-31T22:59:59.999Z",
    deadline_tz: "Europe/London",
    channel_id: CHANNEL,
    creator_id: "U99",
    message_ts: MESSAGE_TS,
    status: "active",
    finalized_at: "",
    created_at: "2026-05-09T00:00:00.000Z",
    updated_at: "2026-05-09T00:00:00.000Z",
    ...overrides,
  };
}

/** Build an active voter row. */
function makeVoter(userId: string): VoterRecord {
  return {
    id: `${DECISION_ID}_${userId}`,
    decision_id: DECISION_ID,
    user_id: userId,
    is_active: true,
    created_at: "2026-05-09T00:00:00.000Z",
  };
}

/**
 * Build a block-actions context for a vote button click. `actionId` is the
 * raw button id (e.g. `"vote_yes"`); `userId` is the actor.
 */
function makeBlockActionsCtx(
  actionId: string,
  userId: string,
): BlockActionsCtx {
  return {
    action: { action_id: actionId, value: DECISION_ID, type: "button" },
    body: {
      user: { id: userId },
      container: { channel_id: CHANNEL, message_ts: MESSAGE_TS },
    },
    inputs: {},
    env: {},
    token: "stub-token",
    team_id: "T0001",
    enterprise_id: "",
  };
}

/**
 * Convert the mock's heterogeneous datastore-row storage to a typed slice.
 * Used by tests that need to inspect what was put().
 */
function getPutCall(
  mock: MockSlackClient,
  predicate: (args: unknown) => boolean,
): { datastore: string; item: Record<string, unknown> } | undefined {
  for (const c of mock.calls) {
    if (c.method !== "apps.datastore.put") continue;
    if (!predicate(c.args)) continue;
    const a = c.args as { datastore: string; item: Record<string, unknown> };
    return { datastore: a.datastore, item: a.item };
  }
  return undefined;
}

/** Find every put call to a given datastore. */
function getAllPuts(
  mock: MockSlackClient,
  datastore: string,
): { datastore: string; item: Record<string, unknown> }[] {
  const out: { datastore: string; item: Record<string, unknown> }[] = [];
  for (const c of mock.calls) {
    if (c.method !== "apps.datastore.put") continue;
    const a = c.args as { datastore: string; item: Record<string, unknown> };
    if (a.datastore === datastore) out.push({ datastore, item: a.item });
  }
  return out;
}

/** Concatenate every Status mrkdwn text rendered into a chat.update blocks
 * payload. Tests assert against the joined text. */
function statusTextsFromUpdate(args: unknown): string {
  const a = args as { blocks?: SlackBlock[] };
  const parts: string[] = [];
  for (const block of a.blocks ?? []) {
    if (block.type === "section") {
      const s = block as SlackSectionBlock;
      const fields = s.fields ?? [];
      for (const f of fields) {
        if (f.text.startsWith("*Status:*")) parts.push(f.text);
      }
      if (s.text && s.text.text.startsWith("*Status:")) parts.push(s.text.text);
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Test 1 — yes / no / abstain put + paired vote_history "cast" event
// ---------------------------------------------------------------------------

for (const variant of ["yes", "no", "abstain"] as const) {
  Deno.test(
    `vote handler — ${variant}: votes put + vote_history cast + ephemeral confirm`,
    async () => {
      const mock = new MockSlackClient();
      mock.setDatastoreItem(
        "decisions",
        makeActiveDecision({
          required_voters_count: 5,
          quorum: 3,
        }) as unknown as
          & { id: string }
          & Record<string, unknown>,
      );
      mock.setDatastoreItem(
        "voters",
        makeVoter(VOTER_U1) as unknown as
          & { id: string }
          & Record<string, unknown>,
      );
      // Empty vote_history query result (first vote ⇒ event_seq = "0001").
      mock.setDatastoreQueryResults("vote_history", []);

      const restore = installFetchBridge(mock);
      try {
        await fn.blockActions(makeBlockActionsCtx(`vote_${variant}`, VOTER_U1));
      } finally {
        restore();
      }

      // votes put with normalised vote_type (no "vote_" prefix).
      const votesPut = getPutCall(
        mock,
        (a) => (a as { datastore: string }).datastore === "votes",
      );
      assert(votesPut, "expected an apps.datastore.put call to votes");
      const voteRow = votesPut.item as unknown as VoteRecord;
      assertEquals(voteRow.id, `${DECISION_ID}_${VOTER_U1}`);
      assertEquals(voteRow.decision_id, DECISION_ID);
      assertEquals(voteRow.user_id, VOTER_U1);
      assertEquals(voteRow.vote_type, variant);
      assert(
        typeof voteRow.voted_at === "string" && voteRow.voted_at.length > 0,
      );

      // vote_history put: event_kind=cast, no previous_vote_type, seq=0001.
      const historyPut = getPutCall(
        mock,
        (a) => (a as { datastore: string }).datastore === "vote_history",
      );
      assert(historyPut, "expected an apps.datastore.put call to vote_history");
      const historyRow = historyPut.item as unknown as VoteHistoryRecord;
      assertEquals(historyRow.id, `${DECISION_ID}_${VOTER_U1}_0001`);
      assertEquals(historyRow.decision_id, DECISION_ID);
      assertEquals(historyRow.user_id, VOTER_U1);
      assertEquals(historyRow.vote_type, variant);
      assertEquals(historyRow.event_kind, "cast");
      // SPEC §5.4: previous_vote_type is absent on the first vote.
      assertEquals(historyRow.previous_vote_type, undefined);

      // Ephemeral confirm posted with the expected emoji + text.
      const ephemerals = mock.getCallsFor("chat.postEphemeral");
      const confirm = ephemerals.find((c) => {
        const a = c.args as { user: string; text?: string };
        return a.user === VOTER_U1 &&
          typeof a.text === "string" &&
          a.text.includes("has been recorded");
      });
      assert(confirm, "expected an ephemeral confirmation");
      const confirmArgs = confirm.args as { text: string };
      const expectedEmoji = variant === "yes"
        ? "✅"
        : variant === "no"
        ? "❌"
        : "⚪";
      const expectedUpper = variant.toUpperCase();
      assertEquals(
        confirmArgs.text,
        `${expectedEmoji} Your vote (${expectedUpper}) has been recorded for "Adopt Deno 2"`,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Test 2 — vote update path: overwrite + history "changed" event
// ---------------------------------------------------------------------------

Deno.test("vote handler — update path: votes overwritten in place; history records `changed` with previous_vote_type", async () => {
  const mock = new MockSlackClient();
  mock.setDatastoreItem(
    "decisions",
    makeActiveDecision({ required_voters_count: 3, quorum: 2 }) as unknown as
      & { id: string }
      & Record<string, unknown>,
  );
  mock.setDatastoreItem(
    "voters",
    makeVoter(VOTER_U1) as unknown as { id: string } & Record<string, unknown>,
  );
  // Pre-existing "yes" vote keyed by ${decision_id}_${user_id}.
  const existingVoteId = `${DECISION_ID}_${VOTER_U1}`;
  mock.setDatastoreItem("votes", {
    id: existingVoteId,
    decision_id: DECISION_ID,
    user_id: VOTER_U1,
    vote_type: "yes",
    voted_at: "2026-05-09T09:00:00.000Z",
  });
  // The "cast" event already exists in vote_history → next event_seq = 0002.
  mock.setDatastoreQueryResults("vote_history", [
    {
      id: `${DECISION_ID}_${VOTER_U1}_0001`,
      decision_id: DECISION_ID,
      user_id: VOTER_U1,
      vote_type: "yes",
      event_kind: "cast",
      voted_at: "2026-05-09T09:00:00.000Z",
    },
  ]);

  const restore = installFetchBridge(mock);
  try {
    await fn.blockActions(makeBlockActionsCtx("vote_no", VOTER_U1));
  } finally {
    restore();
  }

  // votes put: same id, vote_type flipped to "no".
  const votesPuts = getAllPuts(mock, "votes");
  assertEquals(votesPuts.length, 1);
  const newVote = votesPuts[0].item as unknown as VoteRecord;
  assertEquals(newVote.id, existingVoteId);
  assertEquals(newVote.vote_type, "no");

  // vote_history put: event_kind=changed, previous_vote_type=yes, seq=0002.
  const historyPuts = getAllPuts(mock, "vote_history");
  assertEquals(historyPuts.length, 1);
  const histRow = historyPuts[0].item as unknown as VoteHistoryRecord;
  assertEquals(histRow.id, `${DECISION_ID}_${VOTER_U1}_0002`);
  assertEquals(histRow.event_kind, "changed");
  assertEquals(histRow.previous_vote_type, "yes");
  assertEquals(histRow.vote_type, "no");
});

// ---------------------------------------------------------------------------
// Test 3 — post-vote chat.update with refreshed Status block
// ---------------------------------------------------------------------------

Deno.test("vote handler — chat.update: same channel + message_ts; blocks Status reflects updated count", async () => {
  const mock = new MockSlackClient();
  mock.setDatastoreItem(
    "decisions",
    makeActiveDecision({ required_voters_count: 3, quorum: 2 }) as unknown as
      & { id: string }
      & Record<string, unknown>,
  );
  mock.setDatastoreItem(
    "voters",
    makeVoter(VOTER_U1) as unknown as { id: string } & Record<string, unknown>,
  );
  mock.setDatastoreQueryResults("votes", []);
  mock.setDatastoreQueryResults("vote_history", []);

  const restore = installFetchBridge(mock);
  try {
    await fn.blockActions(makeBlockActionsCtx("vote_yes", VOTER_U1));
  } finally {
    restore();
  }

  // chat.update was called with the same channel and ts as the body.
  const updates = mock.getCallsFor("chat.update");
  assert(updates.length >= 1);
  const liveUpdate = updates[0].args as ChatUpdateArgs;
  assertEquals(liveUpdate.channel, CHANNEL);
  assertEquals(liveUpdate.ts, MESSAGE_TS);
  // Status block contains "Votes: 1/3" reflecting the merged vote.
  const statusText = statusTextsFromUpdate(updates[0].args);
  assert(
    statusText.includes("Votes:") && statusText.includes("1/3"),
    `expected updated vote count in Status; got: ${statusText}`,
  );
});

// ---------------------------------------------------------------------------
// Test 4 — votes query is issued between the put and the chat.update
// ---------------------------------------------------------------------------

Deno.test("vote handler — apps.datastore.query for votes runs between the votes put and chat.update", async () => {
  const mock = new MockSlackClient();
  mock.setDatastoreItem(
    "decisions",
    makeActiveDecision({ required_voters_count: 3, quorum: 2 }) as unknown as
      & { id: string }
      & Record<string, unknown>,
  );
  mock.setDatastoreItem(
    "voters",
    makeVoter(VOTER_U1) as unknown as { id: string } & Record<string, unknown>,
  );
  mock.setDatastoreQueryResults("votes", []);
  mock.setDatastoreQueryResults("vote_history", []);

  const restore = installFetchBridge(mock);
  try {
    await fn.blockActions(makeBlockActionsCtx("vote_yes", VOTER_U1));
  } finally {
    restore();
  }

  // Find the indices of the votes-put, the votes-query, and the chat.update.
  const votesPutIndex = mock.calls.findIndex((c) =>
    c.method === "apps.datastore.put" &&
    (c.args as { datastore: string }).datastore === "votes"
  );
  const votesQueryIndex = mock.calls.findIndex((c) =>
    c.method === "apps.datastore.query" &&
    (c.args as { datastore: string }).datastore === "votes"
  );
  const chatUpdateIndex = mock.calls.findIndex((c) =>
    c.method === "chat.update"
  );

  assert(votesPutIndex >= 0, "expected a votes put");
  assert(votesQueryIndex >= 0, "expected a votes query");
  assert(chatUpdateIndex >= 0, "expected a chat.update");
  assert(
    votesPutIndex < votesQueryIndex,
    `votes put (idx ${votesPutIndex}) should precede votes query (idx ${votesQueryIndex})`,
  );
  assert(
    votesQueryIndex < chatUpdateIndex,
    `votes query (idx ${votesQueryIndex}) should precede chat.update (idx ${chatUpdateIndex})`,
  );
});

// ---------------------------------------------------------------------------
// Test 5 — vote_type normalisation: "vote_yes" → persisted as "yes", etc.
// ---------------------------------------------------------------------------

for (const variant of ["yes", "no", "abstain"] as const) {
  Deno.test(`vote handler — vote_type normalisation: vote_${variant} persists vote_type="${variant}"`, async () => {
    const mock = new MockSlackClient();
    mock.setDatastoreItem(
      "decisions",
      makeActiveDecision({ required_voters_count: 5, quorum: 3 }) as unknown as
        & { id: string }
        & Record<string, unknown>,
    );
    mock.setDatastoreItem(
      "voters",
      makeVoter(VOTER_U1) as unknown as
        & { id: string }
        & Record<string, unknown>,
    );
    mock.setDatastoreQueryResults("vote_history", []);

    const restore = installFetchBridge(mock);
    try {
      await fn.blockActions(makeBlockActionsCtx(`vote_${variant}`, VOTER_U1));
    } finally {
      restore();
    }

    const put = getPutCall(
      mock,
      (a) => (a as { datastore: string }).datastore === "votes",
    );
    assert(put);
    const voteRow = put.item as unknown as VoteRecord;
    // Critical: the action_id "vote_yes" must NOT leak as "vote_yes" into the
    // datastore — only the suffix is persisted (SPEC §5.2 / §8.6).
    assertEquals(voteRow.vote_type, variant);
    assert(
      !voteRow.vote_type.startsWith("vote_"),
      `vote_type must not retain the "vote_" prefix; got ${voteRow.vote_type}`,
    );
  });
}

// ---------------------------------------------------------------------------
// Test 6 — vote-after-deadline: triggers finalisation, does NOT record vote
// ---------------------------------------------------------------------------

Deno.test("vote handler — past-deadline click finalises without recording the vote (no votes/vote_history puts; ephemeral '⏰ Voting closed at … Finalising now.')", async () => {
  const mock = new MockSlackClient();

  // Past deadline. With required_voters_count=2 and zero votes, the
  // calculator yields rejected (quorum not met) so the finaliser writes a
  // status flip + finalized_at.
  const pastDecision = makeActiveDecision({
    required_voters_count: 2,
    quorum: 2,
    deadline: "2020-01-01",
    deadline_resolved: "2020-01-01T22:59:59.999Z",
  });
  mock.setDatastoreItem(
    "decisions",
    pastDecision as unknown as { id: string } & Record<string, unknown>,
  );
  mock.setDatastoreItem(
    "voters",
    makeVoter(VOTER_U1) as unknown as
      & { id: string }
      & Record<string, unknown>,
  );
  mock.setDatastoreItem(
    "voters",
    makeVoter(VOTER_U2) as unknown as
      & { id: string }
      & Record<string, unknown>,
  );
  // Voters query returns BOTH active voters so rEffective == 2.
  mock.setDatastoreQueryResults("voters", [
    {
      ...makeVoter(VOTER_U1),
    } as unknown as Record<string, unknown>,
    {
      ...makeVoter(VOTER_U2),
    } as unknown as Record<string, unknown>,
  ]);

  const restore = installFetchBridge(mock);
  try {
    await fn.blockActions(makeBlockActionsCtx("vote_yes", VOTER_U1));
  } finally {
    restore();
  }

  // No votes / vote_history puts.
  assertEquals(getAllPuts(mock, "votes").length, 0);
  assertEquals(getAllPuts(mock, "vote_history").length, 0);

  // Ephemeral with the past-deadline message.
  const ephemerals = mock.getCallsFor("chat.postEphemeral");
  const closed = ephemerals.find((c) => {
    const a = c.args as { user: string; text?: string };
    return a.user === VOTER_U1 &&
      typeof a.text === "string" &&
      a.text.startsWith("⏰ Voting closed at") &&
      a.text.endsWith("Finalising now.");
  });
  assert(
    closed,
    `expected past-deadline ephemeral; saw: ${
      ephemerals.map((c) => (c.args as { text?: string }).text).join(" | ")
    }`,
  );

  // Finalisation pathway hit: a decisions put with finalized_at set and
  // status flipped to a terminal value (rejected for quorum-not-met).
  const decisionPuts = getAllPuts(mock, "decisions");
  const finalised = decisionPuts.find((p) => {
    const item = p.item as unknown as DecisionRecord;
    return typeof item.finalized_at === "string" &&
      item.finalized_at.length > 0 &&
      item.status !== "active";
  });
  assert(
    finalised,
    `expected a finalised decisions put; saw: ${
      decisionPuts.map((p) =>
        JSON.stringify({
          finalized_at: (p.item as { finalized_at?: unknown }).finalized_at,
          status: (p.item as { status?: unknown }).status,
        })
      ).join(" | ")
    }`,
  );
  const finalisedItem = finalised.item as unknown as DecisionRecord;
  assert(
    finalisedItem.status === "approved" ||
      finalisedItem.status === "rejected" ||
      finalisedItem.status === "cancelled",
    `unexpected final status: ${finalisedItem.status}`,
  );
});

// ---------------------------------------------------------------------------
// Test 7 — eventual-consistency vote merge (SPEC §16.1)
// ---------------------------------------------------------------------------

Deno.test("vote handler — eventual-consistency merge: stale votes query returns []; chat.update Status still reflects 1/2 for the just-cast vote", async () => {
  const mock = new MockSlackClient();
  // R = 2 voters so quorum-not-met after one vote keeps decision active and
  // we get a chat.update we can inspect (no finalisation yet).
  mock.setDatastoreItem(
    "decisions",
    makeActiveDecision({
      required_voters_count: 2,
      quorum: 2,
    }) as unknown as { id: string } & Record<string, unknown>,
  );
  mock.setDatastoreItem(
    "voters",
    makeVoter(VOTER_U1) as unknown as
      & { id: string }
      & Record<string, unknown>,
  );
  mock.setDatastoreItem(
    "voters",
    makeVoter(VOTER_U2) as unknown as
      & { id: string }
      & Record<string, unknown>,
  );
  // The crux: pre-seed the votes query to return [] even though the handler
  // just put U1's vote. The handler's mergedVotes MUST still include it
  // (SPEC §16.1).
  mock.setDatastoreQueryResults("votes", []);
  mock.setDatastoreQueryResults("vote_history", []);

  const restore = installFetchBridge(mock);
  try {
    await fn.blockActions(makeBlockActionsCtx("vote_yes", VOTER_U1));
  } finally {
    restore();
  }

  const updates = mock.getCallsFor("chat.update");
  assert(
    updates.length >= 1,
    "expected a chat.update reflecting the merged vote",
  );
  const status = statusTextsFromUpdate(updates[0].args);
  assert(
    status.includes("Votes:") && status.includes("1/2"),
    `expected merged Status to read "*Votes:* 1/2" despite stale query; got: ${status}`,
  );
  // The voted-mention list MUST include U1, the just-cast voter.
  assert(
    status.includes(`<@${VOTER_U1}>`),
    `expected merged Status to mention <@${VOTER_U1}>; got: ${status}`,
  );
});
