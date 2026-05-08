// ConsensusBot v2.0 — In-memory mock for `SlackClient` (SPEC §20).
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §20 (SlackClient surface)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21 (test contract)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-202
//
// `MockSlackClient` `implements SlackClient` end-to-end so unit and
// integration tests can drive the create/vote/finalise flows without ever
// touching the network. The mock records every call into `calls: MockCall[]`
// and exposes setter helpers so tests can pre-load:
//
//   - datastore rows (`setDatastoreItem`, `setDatastoreQueryResults`)
//   - usergroup membership (`setUsergroupMembers`, `setUsergroupsList`)
//   - channel members (`setChannelMembers`)
//   - per-user `users.info` payloads (`setUserInfo`, `setUserDeleted`)
//   - workspace tz (`setTeamTz`)
//   - cursor pagination on `conversations.members`, `usergroups.list`,
//     `usergroups.users.list` (`enableChannelMemberPagination`,
//     `enableUsergroupPagination`, `enableUsergroupUsersPagination`)
//   - forced failures keyed by method name (`forceFailure`, `clearFailures`)
//
// The mock keeps no `any` and asserts the full `SlackClient` surface; missing
// methods would fail `deno check` and block the wave gate (SPEC §20).

import type {
  ChatDeleteArgs,
  ChatPostEphemeralArgs,
  ChatPostMessageArgs,
  ChatResponse,
  ChatUpdateArgs,
  ConversationsMembersArgs,
  ConversationsMembersResponse,
  DatastoreDeleteArgs,
  DatastoreDeleteResponse,
  DatastoreGetArgs,
  DatastoreGetResponse,
  DatastorePutArgs,
  DatastorePutResponse,
  DatastoreQueryArgs,
  DatastoreQueryResponse,
  PinsAddArgs,
  PinsListArgs,
  PinsListResponse,
  PinsMutationResponse,
  PinsRemoveArgs,
  SlackClient,
  SlackUsergroupSummary,
  SlackUserInfo,
  TeamInfoResponse,
  UsergroupsListArgs,
  UsergroupsListResponse,
  UsergroupsUsersListArgs,
  UsergroupsUsersListResponse,
  UsersInfoArgs,
  UsersInfoResponse,
} from "../../types/slack_types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Single recorded API call. `args` is `unknown` to avoid widening the union
 * across every method; consumers narrow with `getCallsFor` + a type guard.
 */
export interface MockCall {
  method: string;
  args: unknown;
}

/**
 * Slack-shaped pin entry. The mock returns this verbatim from `pins.list`.
 */
export interface MockPinItem {
  message?: { ts?: string };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Slice an in-memory array using a Slack-style `cursor` and `limit` and
 * return the page along with the next cursor (or undefined if exhausted).
 *
 * The cursor is the zero-based start index serialised as a string. `undefined`
 * cursor means "first page". A returned `next_cursor === undefined` means the
 * caller has consumed the last page.
 */
function paginate<T>(
  items: T[],
  cursor: string | undefined,
  pageSize: number,
): { page: T[]; nextCursor: string | undefined } {
  const start = cursor ? Number.parseInt(cursor, 10) : 0;
  const end = Math.min(start + pageSize, items.length);
  const page = items.slice(start, end);
  const nextCursor = end < items.length ? String(end) : undefined;
  return { page, nextCursor };
}

// ---------------------------------------------------------------------------
// MockSlackClient
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of {@link SlackClient} used by tests.
 *
 * The mock owns an isolated state per instance so concurrent tests do not
 * interfere. Construct a fresh instance per `Deno.test` block.
 */
export class MockSlackClient implements SlackClient {
  /** Every recorded call, in invocation order. */
  readonly calls: MockCall[] = [];

  // Datastore state ---------------------------------------------------------
  /** datastoreName → primary-key id → row. */
  readonly #store = new Map<string, Map<string, Record<string, unknown>>>();
  /** datastoreName → explicit query result override (returned as-is). */
  readonly #queryResults = new Map<string, Record<string, unknown>[]>();

  // Workspace state ---------------------------------------------------------
  #teamTz = "Europe/London";

  // User cache --------------------------------------------------------------
  readonly #users = new Map<string, SlackUserInfo>();

  // Usergroup state ---------------------------------------------------------
  readonly #usergroupMembers = new Map<string, string[]>();
  #usergroupsList: SlackUsergroupSummary[] = [];
  #usergroupsListPageSize: number | undefined = undefined;
  readonly #usergroupUsersPageSize = new Map<string, number>();

  // Channel state -----------------------------------------------------------
  readonly #channelMembers = new Map<string, string[]>();
  /** Per-channel pagination page size. */
  readonly #channelPageSize = new Map<string, number>();
  /** Per-channel pin items. */
  readonly #pins = new Map<string, MockPinItem[]>();

  // Failure injection -------------------------------------------------------
  readonly #failures = new Map<string, string>();

  // Monotonic counter so chat.* `ts` values are unique within a test run.
  #tsCounter = 0;

  // ----- Datastore facade ---------------------------------------------------

  readonly apps = {
    datastore: {
      get: <T>(
        args: DatastoreGetArgs,
      ): Promise<DatastoreGetResponse<T>> => {
        this.#record("apps.datastore.get", args);
        const forced = this.#failures.get("apps.datastore.get");
        if (forced) return Promise.resolve({ ok: false, error: forced });
        const table = this.#store.get(args.datastore);
        const row = table?.get(args.id);
        if (!row) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: true, item: row as unknown as T });
      },

      put: <T>(
        args: DatastorePutArgs<T>,
      ): Promise<DatastorePutResponse<T>> => {
        this.#record("apps.datastore.put", args);
        const forced = this.#failures.get("apps.datastore.put");
        if (forced) return Promise.resolve({ ok: false, error: forced });
        const table = this.#store.get(args.datastore) ?? new Map();
        // The primary key is `id`. Slack datastores enforce this.
        const item = args.item as unknown as Record<string, unknown>;
        const id = item["id"];
        if (typeof id !== "string") {
          return Promise.resolve({
            ok: false,
            error: "missing primary key `id`",
          });
        }
        table.set(id, item);
        this.#store.set(args.datastore, table);
        return Promise.resolve({ ok: true, item: args.item });
      },

      query: <T>(
        args: DatastoreQueryArgs,
      ): Promise<DatastoreQueryResponse<T>> => {
        this.#record("apps.datastore.query", args);
        const forced = this.#failures.get("apps.datastore.query");
        if (forced) {
          return Promise.resolve({ ok: false, items: [], error: forced });
        }

        // Explicit override path.
        const override = this.#queryResults.get(args.datastore);
        if (override) {
          const limit = args.limit;
          if (typeof limit === "number" && limit > 0) {
            const { page, nextCursor } = paginate(override, args.cursor, limit);
            return Promise.resolve({
              ok: true,
              items: page as unknown as T[],
              response_metadata: nextCursor
                ? { next_cursor: nextCursor }
                : undefined,
            });
          }
          return Promise.resolve({
            ok: true,
            items: override as unknown as T[],
          });
        }

        // Fallback: return every row in the datastore. Filter expression
        // evaluation is intentionally a no-op; tests inject explicit results.
        const table = this.#store.get(args.datastore);
        const rows = table ? [...table.values()] : [];
        return Promise.resolve({ ok: true, items: rows as unknown as T[] });
      },

      delete: (
        args: DatastoreDeleteArgs,
      ): Promise<DatastoreDeleteResponse> => {
        this.#record("apps.datastore.delete", args);
        const forced = this.#failures.get("apps.datastore.delete");
        if (forced) return Promise.resolve({ ok: false, error: forced });
        const table = this.#store.get(args.datastore);
        table?.delete(args.id);
        return Promise.resolve({ ok: true });
      },
    },
  };

  // ----- Chat facade --------------------------------------------------------

  readonly chat = {
    postMessage: (args: ChatPostMessageArgs): Promise<ChatResponse> => {
      this.#record("chat.postMessage", args);
      const forced = this.#failures.get("chat.postMessage");
      if (forced) return Promise.resolve({ ok: false, error: forced });
      const ts = this.#nextTs();
      return Promise.resolve({ ok: true, channel: args.channel, ts });
    },

    postEphemeral: (args: ChatPostEphemeralArgs): Promise<ChatResponse> => {
      this.#record("chat.postEphemeral", args);
      const forced = this.#failures.get("chat.postEphemeral");
      if (forced) return Promise.resolve({ ok: false, error: forced });
      return Promise.resolve({ ok: true });
    },

    update: (args: ChatUpdateArgs): Promise<ChatResponse> => {
      this.#record("chat.update", args);
      const forced = this.#failures.get("chat.update");
      if (forced) return Promise.resolve({ ok: false, error: forced });
      return Promise.resolve({ ok: true, ts: args.ts, channel: args.channel });
    },

    delete: (args: ChatDeleteArgs): Promise<ChatResponse> => {
      this.#record("chat.delete", args);
      const forced = this.#failures.get("chat.delete");
      if (forced) return Promise.resolve({ ok: false, error: forced });
      return Promise.resolve({ ok: true, ts: args.ts, channel: args.channel });
    },
  };

  // ----- Users facade -------------------------------------------------------

  readonly users = {
    info: (args: UsersInfoArgs): Promise<UsersInfoResponse> => {
      this.#record("users.info", args);
      const forced = this.#failures.get("users.info");
      if (forced) return Promise.resolve({ ok: false, error: forced });
      const cached = this.#users.get(args.user);
      if (cached) return Promise.resolve({ ok: true, user: cached });
      // Default: a real, non-bot, non-deleted human.
      return Promise.resolve({
        ok: true,
        user: {
          id: args.user,
          is_bot: false,
          deleted: false,
          real_name: args.user,
          name: args.user,
        },
      });
    },
  };

  // ----- Conversations facade ----------------------------------------------

  readonly conversations = {
    members: (
      args: ConversationsMembersArgs,
    ): Promise<ConversationsMembersResponse> => {
      this.#record("conversations.members", args);
      const forced = this.#failures.get("conversations.members");
      if (forced) return Promise.resolve({ ok: false, error: forced });
      const all = this.#channelMembers.get(args.channel) ?? [];
      const pageSize = this.#channelPageSize.get(args.channel) ?? args.limit ??
        all.length;
      const effectiveLimit = pageSize > 0 ? pageSize : all.length;
      const { page, nextCursor } = paginate(all, args.cursor, effectiveLimit);
      return Promise.resolve({
        ok: true,
        members: page,
        response_metadata: nextCursor ? { next_cursor: nextCursor } : undefined,
      });
    },
  };

  // ----- Pins facade --------------------------------------------------------

  readonly pins = {
    list: (args: PinsListArgs): Promise<PinsListResponse> => {
      this.#record("pins.list", args);
      const forced = this.#failures.get("pins.list");
      if (forced) return Promise.resolve({ ok: false, error: forced });
      const items = this.#pins.get(args.channel) ?? [];
      return Promise.resolve({ ok: true, items });
    },

    add: (args: PinsAddArgs): Promise<PinsMutationResponse> => {
      this.#record("pins.add", args);
      const forced = this.#failures.get("pins.add");
      if (forced) return Promise.resolve({ ok: false, error: forced });
      const items = this.#pins.get(args.channel) ?? [];
      items.push({ message: { ts: args.timestamp } });
      this.#pins.set(args.channel, items);
      return Promise.resolve({ ok: true });
    },

    remove: (args: PinsRemoveArgs): Promise<PinsMutationResponse> => {
      this.#record("pins.remove", args);
      const forced = this.#failures.get("pins.remove");
      if (forced) return Promise.resolve({ ok: false, error: forced });
      const items = this.#pins.get(args.channel) ?? [];
      const filtered = items.filter((p) => p.message?.ts !== args.timestamp);
      this.#pins.set(args.channel, filtered);
      return Promise.resolve({ ok: true });
    },
  };

  // ----- Usergroups facade --------------------------------------------------

  readonly usergroups = {
    list: (
      args: UsergroupsListArgs = {},
    ): Promise<UsergroupsListResponse> => {
      this.#record("usergroups.list", args);
      const forced = this.#failures.get("usergroups.list");
      if (forced) return Promise.resolve({ ok: false, error: forced });
      const all = this.#usergroupsList;
      const pageSize = this.#usergroupsListPageSize ?? args.limit ?? all.length;
      const effectiveLimit = pageSize > 0 ? pageSize : all.length;
      const { page, nextCursor } = paginate(all, args.cursor, effectiveLimit);
      return Promise.resolve({
        ok: true,
        usergroups: page,
        response_metadata: nextCursor ? { next_cursor: nextCursor } : undefined,
      });
    },

    users: {
      list: (
        args: UsergroupsUsersListArgs,
      ): Promise<UsergroupsUsersListResponse> => {
        this.#record("usergroups.users.list", args);
        const forced = this.#failures.get("usergroups.users.list");
        if (forced) return Promise.resolve({ ok: false, error: forced });
        const all = this.#usergroupMembers.get(args.usergroup) ?? [];
        const pageSize = this.#usergroupUsersPageSize.get(args.usergroup) ??
          args.limit ?? all.length;
        const effectiveLimit = pageSize > 0 ? pageSize : all.length;
        const { page, nextCursor } = paginate(all, args.cursor, effectiveLimit);
        return Promise.resolve({
          ok: true,
          users: page,
          response_metadata: nextCursor
            ? { next_cursor: nextCursor }
            : undefined,
        });
      },
    },
  };

  // ----- Team facade --------------------------------------------------------

  readonly team = {
    info: (): Promise<TeamInfoResponse> => {
      this.#record("team.info", {});
      const forced = this.#failures.get("team.info");
      if (forced) return Promise.resolve({ ok: false, error: forced });
      return Promise.resolve({
        ok: true,
        team: { id: "T1", name: "Test", tz: this.#teamTz },
      });
    },
  };

  // ===========================================================================
  // Helpers — used by tests to pre-load state
  // ===========================================================================

  /** Configure the membership of a single usergroup. */
  setUsergroupMembers(usergroupId: string, members: string[]): void {
    this.#usergroupMembers.set(usergroupId, [...members]);
  }

  /** Configure the summary list returned by `usergroups.list`. */
  setUsergroupsList(summaries: SlackUsergroupSummary[]): void {
    this.#usergroupsList = [...summaries];
  }

  /** Configure the membership of a single channel. */
  setChannelMembers(channel: string, members: string[]): void {
    this.#channelMembers.set(channel, [...members]);
  }

  /**
   * Configure (or update) `users.info` for one user. Missing fields default
   * to a sensible non-bot, non-deleted human. The `id` field always matches
   * the cache key — a partial cannot smuggle in a different id.
   */
  setUserInfo(userId: string, info: Partial<SlackUserInfo>): void {
    const merged: SlackUserInfo = {
      is_bot: false,
      deleted: false,
      real_name: userId,
      name: userId,
      ...info,
      id: userId,
    };
    this.#users.set(userId, merged);
  }

  /** Mark a user as `deleted: true` — preserves any other cached fields. */
  setUserDeleted(userId: string): void {
    const existing = this.#users.get(userId);
    const merged: SlackUserInfo = {
      ...(existing ?? {
        id: userId,
        is_bot: false,
        real_name: userId,
        name: userId,
      }),
      id: userId,
      deleted: true,
    };
    this.#users.set(userId, merged);
  }

  /** Override the workspace tz returned by `team.info`. */
  setTeamTz(tz: string): void {
    this.#teamTz = tz;
  }

  /**
   * Enable cursor pagination on `conversations.members` for one channel,
   * splitting the configured member list into pages of `pageSize`.
   */
  enableChannelMemberPagination(channel: string, pageSize: number): void {
    this.#channelPageSize.set(channel, pageSize);
  }

  /** Enable cursor pagination on `usergroups.list`. */
  enableUsergroupPagination(pageSize: number): void {
    this.#usergroupsListPageSize = pageSize;
  }

  /**
   * Enable cursor pagination on `usergroups.users.list` for one usergroup,
   * splitting the configured member list into pages of `pageSize`.
   */
  enableUsergroupUsersPagination(usergroupId: string, pageSize: number): void {
    this.#usergroupUsersPageSize.set(usergroupId, pageSize);
  }

  /** Pre-load a single datastore row keyed by its `id` field. */
  setDatastoreItem(
    datastore: string,
    item: { id: string } & Record<string, unknown>,
  ): void {
    const table = this.#store.get(datastore) ?? new Map();
    table.set(item.id, item);
    this.#store.set(datastore, table);
  }

  /**
   * Set explicit query results for a datastore. Sticky until cleared by
   * `clearDatastoreQueryResults`. Pagination via `cursor`/`limit` is honoured.
   */
  setDatastoreQueryResults(
    datastore: string,
    items: Record<string, unknown>[],
  ): void {
    this.#queryResults.set(datastore, [...items]);
  }

  /** Clear an explicit query-results override. */
  clearDatastoreQueryResults(datastore: string): void {
    this.#queryResults.delete(datastore);
  }

  /**
   * Configure the next call(s) to `method` to return `{ ok: false, error }`.
   * Sticky — clear with {@link clearFailures}. Method names match the
   * `MockCall.method` strings (e.g. `"chat.postMessage"`,
   * `"apps.datastore.put"`).
   */
  forceFailure(method: string, error: string): void {
    this.#failures.set(method, error);
  }

  /** Clear forced failures. Without an arg, clears every method. */
  clearFailures(method?: string): void {
    if (method) this.#failures.delete(method);
    else this.#failures.clear();
  }

  /** Pre-load pins for a channel (used by cancel/delete tests). */
  setChannelPins(channel: string, items: MockPinItem[]): void {
    this.#pins.set(channel, [...items]);
  }

  /** All recorded calls for a single method, in order. */
  getCallsFor(method: string): MockCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /** Reset the recorded-call log (state otherwise unchanged). */
  clearCalls(): void {
    this.calls.length = 0;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  #record(method: string, args: unknown): void {
    this.calls.push({ method, args });
  }

  #nextTs(): string {
    this.#tsCounter += 1;
    return `MOCK_${Date.now()}_${this.#tsCounter}`;
  }
}
