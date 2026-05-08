// ConsensusBot v2.0 — Tests for `utils/concurrency.ts`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16.3 (`finalized_at` token)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16.4 (re-read-and-bail)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-107
//
// Acceptance:
//   deno check utils/concurrency.ts
//   deno test --allow-read --allow-env tests/concurrency_test.ts
//
// The integration `MockSlackClient` lives in `tests/mocks/slack_client.ts`
// (T-202, not yet produced). For T-107 we need only `apps.datastore.get` and
// `apps.datastore.put`, so this file ships its own minimal in-memory mock.
// Other client surface methods throw "not_implemented" — they are not
// exercised by these tests.

import { assert, assertEquals } from "@std/assert";
import { claimFinalisation, reReadAndCheck } from "../utils/concurrency.ts";
import type {
  DatastoreDeleteArgs,
  DatastoreDeleteResponse,
  DatastoreGetArgs,
  DatastoreGetResponse,
  DatastorePutArgs,
  DatastorePutResponse,
  DatastoreQueryArgs,
  DatastoreQueryResponse,
  SlackClient,
} from "../types/slack_types.ts";
import type { DecisionRecord } from "../types/decision_types.ts";

// ---------------------------------------------------------------------------
// Minimal in-memory mock — only datastore.get and datastore.put are real.
// ---------------------------------------------------------------------------

/**
 * A datastore name → primary-key → row store. Records are stored as
 * `Record<string, unknown>` (the SDK's wire-shape) so mixed-type datastores
 * coexist; callers cast to the row interface they expect.
 */
type Tables = Map<string, Map<string, Record<string, unknown>>>;

interface MockOpts {
  /** When set, `apps.datastore.get` returns `ok: false, error` for any id. */
  forceGetError?: string;
  /** When set, `apps.datastore.put` returns `ok: false, error` for any item. */
  forcePutError?: string;
}

/**
 * Builds a minimal `SlackClient` with a working in-memory datastore. The
 * non-datastore surface (chat/users/conversations/pins/usergroups/team)
 * is stubbed to throw — these tests don't exercise it.
 */
function makeClient(
  initial: Tables = new Map(),
  opts: MockOpts = {},
): { client: SlackClient; tables: Tables } {
  const tables: Tables = initial;

  function tableFor(name: string): Map<string, Record<string, unknown>> {
    let t = tables.get(name);
    if (!t) {
      t = new Map();
      tables.set(name, t);
    }
    return t;
  }

  const notImplemented = (): never => {
    throw new Error("not implemented in T-107 mock");
  };
  const notImplementedAsync = <R>(): Promise<R> => {
    return Promise.reject(new Error("not implemented in T-107 mock"));
  };

  const client: SlackClient = {
    apps: {
      datastore: {
        get<T>(args: DatastoreGetArgs): Promise<DatastoreGetResponse<T>> {
          if (opts.forceGetError) {
            return Promise.resolve({ ok: false, error: opts.forceGetError });
          }
          const row = tableFor(args.datastore).get(args.id);
          if (!row) {
            // Slack returns `ok: true` with no `item` when the row is absent.
            return Promise.resolve({ ok: true });
          }
          return Promise.resolve({ ok: true, item: row as T });
        },
        put<T>(args: DatastorePutArgs<T>): Promise<DatastorePutResponse<T>> {
          if (opts.forcePutError) {
            return Promise.resolve({ ok: false, error: opts.forcePutError });
          }
          const item = args.item as Record<string, unknown>;
          const id = item.id;
          if (typeof id !== "string") {
            return Promise.resolve({
              ok: false,
              error: "missing_id",
            });
          }
          tableFor(args.datastore).set(id, { ...item });
          return Promise.resolve({ ok: true, item: args.item });
        },
        query<T>(
          _args: DatastoreQueryArgs,
        ): Promise<DatastoreQueryResponse<T>> {
          return Promise.resolve({
            ok: false,
            items: [],
            error: "not_implemented",
          });
        },
        delete(_args: DatastoreDeleteArgs): Promise<DatastoreDeleteResponse> {
          return Promise.resolve({ ok: false, error: "not_implemented" });
        },
      },
    },
    chat: {
      postMessage: notImplementedAsync,
      postEphemeral: notImplementedAsync,
      update: notImplementedAsync,
      delete: notImplementedAsync,
    },
    users: { info: notImplementedAsync },
    conversations: { members: notImplementedAsync },
    pins: {
      list: notImplementedAsync,
      add: notImplementedAsync,
      remove: notImplementedAsync,
    },
    usergroups: {
      list: notImplementedAsync,
      users: { list: notImplementedAsync },
    },
    team: { info: notImplemented },
  };

  return { client, tables };
}

/** Construct a baseline DecisionRecord for tests. */
function makeDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: "decision-uuid-1",
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "simple_majority",
    quorum: 2,
    required_voters_count: 3,
    deadline: "2026-05-15",
    deadline_resolved: "2026-05-15T22:59:59.999Z",
    deadline_tz: "Europe/London",
    channel_id: "C0123456789",
    creator_id: "U0001",
    message_ts: "1715170800.000100",
    status: "active",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-08T09:00:00.000Z",
    ...overrides,
  };
}

/** Seed a decision row into the in-memory tables. */
function seedDecision(
  tables: Tables,
  decision: DecisionRecord,
): void {
  if (!tables.has("decisions")) {
    tables.set("decisions", new Map());
  }
  tables.get("decisions")!.set(decision.id, {
    ...(decision as unknown as Record<string, unknown>),
  });
}

/** Read the decision row directly out of the in-memory tables. */
function readDecision(
  tables: Tables,
  id: string,
): DecisionRecord | undefined {
  const row = tables.get("decisions")?.get(id);
  if (!row) return undefined;
  return row as unknown as DecisionRecord;
}

// ---------------------------------------------------------------------------
// reReadAndCheck
// ---------------------------------------------------------------------------

Deno.test("reReadAndCheck — happy path: row exists and predicate passes", async () => {
  const { client, tables } = makeClient();
  const decision = makeDecision({ status: "active" });
  seedDecision(tables, decision);

  const result = await reReadAndCheck<DecisionRecord>(
    client,
    "decisions",
    decision.id,
    (d) => d.status === "active",
  );

  assert(result.ok, "expected ok: true");
  if (result.ok) {
    assertEquals(result.item.id, decision.id);
    assertEquals(result.item.status, "active");
  }
});

Deno.test("reReadAndCheck — predicate fails: row exists but predicate returns false", async () => {
  const { client, tables } = makeClient();
  // Row exists but its status has moved on; the caller expected "active".
  const decision = makeDecision({ status: "cancelled" });
  seedDecision(tables, decision);

  const result = await reReadAndCheck<DecisionRecord>(
    client,
    "decisions",
    decision.id,
    (d) => d.status === "active",
  );

  assert(!result.ok, "expected ok: false");
  if (!result.ok) {
    assertEquals(result.reason, "predicate_failed");
  }
});

Deno.test("reReadAndCheck — not found: row absent yields reason=not_found", async () => {
  const { client } = makeClient();
  // No seed → the table is empty; the get returns ok:true with no item.
  const result = await reReadAndCheck<DecisionRecord>(
    client,
    "decisions",
    "missing-id",
    () => true,
  );

  assert(!result.ok, "expected ok: false");
  if (!result.ok) {
    assertEquals(result.reason, "not_found");
  }
});

Deno.test("reReadAndCheck — api_error: get returns ok:false yields reason=api_error", async () => {
  const { client } = makeClient(new Map(), { forceGetError: "internal_error" });

  const result = await reReadAndCheck<DecisionRecord>(
    client,
    "decisions",
    "decision-uuid-1",
    () => true,
  );

  assert(!result.ok, "expected ok: false");
  if (!result.ok) {
    assertEquals(result.reason, "api_error");
  }
});

// ---------------------------------------------------------------------------
// claimFinalisation
// ---------------------------------------------------------------------------

Deno.test("claimFinalisation — first call returns true and writes finalized_at to the store", async () => {
  const { client, tables } = makeClient();
  const decision = makeDecision({ finalized_at: undefined });
  seedDecision(tables, decision);

  const claimed = await claimFinalisation(client, decision);
  assertEquals(claimed, true);

  const stored = readDecision(tables, decision.id);
  assert(stored, "decision row should still exist");
  assert(
    typeof stored.finalized_at === "string" && stored.finalized_at.length > 0,
    "finalized_at should be set after first claim",
  );
  // updated_at should match finalized_at (same `now` per the helper contract).
  assertEquals(stored.updated_at, stored.finalized_at);
  // Other fields must be preserved.
  assertEquals(stored.id, decision.id);
  assertEquals(stored.name, decision.name);
  assertEquals(stored.status, decision.status);
});

Deno.test("claimFinalisation — second call returns false and does NOT overwrite the existing token", async () => {
  const { client, tables } = makeClient();
  const decision = makeDecision({ finalized_at: undefined });
  seedDecision(tables, decision);

  // First claim succeeds.
  const first = await claimFinalisation(client, decision);
  assertEquals(first, true);

  const afterFirst = readDecision(tables, decision.id);
  assert(afterFirst);
  const firstToken = afterFirst.finalized_at;
  assert(typeof firstToken === "string" && firstToken.length > 0);

  // Brief delay so a hypothetical second-write timestamp would differ from
  // the first; we want to prove the second call does NOT overwrite, so the
  // stored token must equal `firstToken` afterwards regardless of timing.
  await new Promise((resolve) => setTimeout(resolve, 5));

  // Pass the *original* (un-finalised) decision again to simulate a stale
  // caller racing the first claim. The helper re-reads before deciding.
  const second = await claimFinalisation(client, decision);
  assertEquals(second, false);

  const afterSecond = readDecision(tables, decision.id);
  assert(afterSecond);
  assertEquals(
    afterSecond.finalized_at,
    firstToken,
    "second claim must not overwrite the first finalized_at token",
  );
});

Deno.test("claimFinalisation — returns false when the decision row is missing", async () => {
  // Empty tables → the get returns ok:true with no item.
  const { client } = makeClient();
  const decision = makeDecision();

  const claimed = await claimFinalisation(client, decision);
  assertEquals(claimed, false);
});

Deno.test("claimFinalisation — returns false on API error during the get", async () => {
  const { client, tables } = makeClient(new Map(), {
    forceGetError: "internal_error",
  });
  const decision = makeDecision();
  seedDecision(tables, decision);

  const claimed = await claimFinalisation(client, decision);
  assertEquals(claimed, false);

  // The store must not have been mutated — we never reached the put.
  const stored = readDecision(tables, decision.id);
  assert(stored);
  assertEquals(stored.finalized_at, undefined);
});

Deno.test("claimFinalisation — returns false when the put fails", async () => {
  const { client, tables } = makeClient(new Map(), {
    forcePutError: "internal_error",
  });
  const decision = makeDecision({ finalized_at: undefined });
  seedDecision(tables, decision);

  const claimed = await claimFinalisation(client, decision);
  assertEquals(claimed, false);

  // The seeded row is unchanged because the put failed.
  const stored = readDecision(tables, decision.id);
  assert(stored);
  assertEquals(stored.finalized_at, undefined);
});

Deno.test("claimFinalisation — already-finalised row: returns false without overwriting", async () => {
  const existingToken = "2026-05-08T12:00:00.000Z";
  const { client, tables } = makeClient();
  const decision = makeDecision({ finalized_at: existingToken });
  seedDecision(tables, decision);

  // Even though the in-memory record carries a token, callers might pass a
  // stale `decision` with no token. The helper re-reads, so the stored
  // token wins regardless.
  const stale = makeDecision({ finalized_at: undefined });
  const claimed = await claimFinalisation(client, stale);
  assertEquals(claimed, false);

  const stored = readDecision(tables, decision.id);
  assert(stored);
  assertEquals(stored.finalized_at, existingToken);
});
