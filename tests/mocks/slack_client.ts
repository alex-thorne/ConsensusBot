/**
 * Mock Slack Client for Testing
 *
 * Provides a mock implementation of the Slack client for integration tests
 */

import { SlackBlock, SlackClient } from "../../types/slack_types.ts";

export interface MockCall {
  method: string;
  params: unknown;
}

/**
 * Mock Slack Client that tracks all calls made to it
 */
export class MockSlackClient implements SlackClient {
  calls: MockCall[] = [];

  // Mock datastore responses
  datastoreItems: Map<string, Record<string, unknown>> = new Map();
  datastoreQueryResults: Record<string, unknown>[] = [];

  apps = {
    datastore: {
      get: (params: { datastore: string; id: string }) => {
        this.calls.push({ method: "apps.datastore.get", params });
        const item = this.datastoreItems.get(params.id);
        return Promise.resolve({ ok: true, item: item || {} });
      },
      put: (params: { datastore: string; item: Record<string, unknown> }) => {
        this.calls.push({ method: "apps.datastore.put", params });
        if (params.item.id) {
          this.datastoreItems.set(params.item.id as string, params.item);
        }
        return Promise.resolve({ ok: true });
      },
      query: (params: {
        datastore: string;
        expression?: string;
        expression_attributes?: Record<string, string>;
        expression_values?: Record<string, unknown>;
      }) => {
        this.calls.push({ method: "apps.datastore.query", params });
        return Promise.resolve({ ok: true, items: this.datastoreQueryResults });
      },
      update: (params: {
        datastore: string;
        item: Record<string, unknown>;
      }) => {
        this.calls.push({ method: "apps.datastore.update", params });
        if (params.item.id) {
          const existing = this.datastoreItems.get(params.item.id as string) ||
            {};
          this.datastoreItems.set(params.item.id as string, {
            ...existing,
            ...params.item,
          });
        }
        return Promise.resolve({ ok: true });
      },
    },
  };

  chat = {
    postMessage: (params: {
      channel: string;
      text: string;
      blocks?: SlackBlock[];
      thread_ts?: string;
    }) => {
      this.calls.push({ method: "chat.postMessage", params });
      return Promise.resolve({
        ok: true,
        ts: "1234567890.123456",
        message: {
          blocks: params.blocks,
        },
      });
    },
    postEphemeral: (params: {
      channel: string;
      user: string;
      text: string;
      blocks?: SlackBlock[];
    }) => {
      this.calls.push({ method: "chat.postEphemeral", params });
      return Promise.resolve({ ok: true });
    },
    update: (params: {
      channel: string;
      ts: string;
      text?: string;
      blocks?: SlackBlock[];
    }) => {
      this.calls.push({ method: "chat.update", params });
      return Promise.resolve({ ok: true });
    },
  };

  conversations = {
    members: (params: { channel: string; cursor?: string }) => {
      this.calls.push({ method: "conversations.members", params });
      const allMembers = this.channelMembers.get(params.channel) || [
        "U123456",
        "U234567",
        "U345678",
      ];

      // Support simple pagination: split into pages of 2 for testing
      if (params.cursor) {
        // cursor encodes the starting index
        const startIdx = parseInt(params.cursor, 10);
        const pageSize = 2;
        const page = allMembers.slice(startIdx, startIdx + pageSize);
        const nextStart = startIdx + pageSize;
        const nextCursor = nextStart < allMembers.length
          ? String(nextStart)
          : undefined;
        return Promise.resolve({
          ok: true,
          members: page,
          response_metadata: { next_cursor: nextCursor },
        });
      }

      // First page (no cursor)
      const pageSize = 2;
      if (allMembers.length > pageSize && this.paginateChannelMembers) {
        const page = allMembers.slice(0, pageSize);
        return Promise.resolve({
          ok: true,
          members: page,
          response_metadata: { next_cursor: String(pageSize) },
        });
      }

      return Promise.resolve({
        ok: true,
        members: allMembers,
        response_metadata: { next_cursor: undefined },
      });
    },
  };

  users = {
    info: (params: { user: string }) => {
      this.calls.push({ method: "users.info", params });
      const userInfo = this.userInfoMap.get(params.user);
      return Promise.resolve({
        ok: true,
        user: {
          id: params.user,
          name: `user_${params.user}`,
          real_name: `Test User ${params.user}`,
          is_bot: userInfo?.is_bot ?? false,
        },
      });
    },
  };

  pins = {
    add: (params: {
      channel: string;
      timestamp: string;
    }) => {
      this.calls.push({ method: "pins.add", params });
      return Promise.resolve({ ok: true });
    },
    remove: (params: {
      channel: string;
      timestamp: string;
    }) => {
      this.calls.push({ method: "pins.remove", params });
      return Promise.resolve({ ok: true });
    },
  };

  // Mock usergroup members
  usergroupMembers: Map<string, string[]> = new Map();
  // Mock usergroups list (handle -> id mapping)
  usergroupsList: Array<{ id: string; handle: string }> = [];
  // Mock channel members (channelId -> memberIds)
  channelMembers: Map<string, string[]> = new Map();
  // Mock user info (userId -> { is_bot })
  userInfoMap: Map<string, { is_bot?: boolean }> = new Map();
  // Whether to paginate channel members responses
  paginateChannelMembers = false;

  usergroups = {
    list: (_params?: { include_disabled?: boolean }) => {
      this.calls.push({ method: "usergroups.list", params: _params });
      return Promise.resolve({ ok: true, usergroups: this.usergroupsList });
    },
    users: {
      list: (params: { usergroup: string }) => {
        this.calls.push({ method: "usergroups.users.list", params });
        const members = this.usergroupMembers.get(params.usergroup) || [];
        return Promise.resolve({ ok: true, users: members });
      },
    },
  };

  /**
   * Set mock members for a user group
   */
  setUsergroupMembers(usergroup: string, members: string[]): void {
    this.usergroupMembers.set(usergroup, members);
  }

  /**
   * Set mock usergroups list for handle resolution
   */
  setUsergroupsList(
    groups: Array<{ id: string; handle: string }>,
  ): void {
    this.usergroupsList = groups;
  }

  /**
   * Set mock members for a channel
   */
  setChannelMembers(channelId: string, memberIds: string[]): void {
    this.channelMembers.set(channelId, memberIds);
  }

  /**
   * Set mock user info for bot/non-bot detection
   */
  setUserInfo(userId: string, info: { is_bot?: boolean }): void {
    this.userInfoMap.set(userId, info);
  }

  /**
   * Enable paginated responses for conversations.members
   */
  enableChannelMemberPagination(): void {
    this.paginateChannelMembers = true;
  }

  /**
   * Get all calls made to a specific method
   */
  getCallsFor(method: string): MockCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  /**
   * Clear all recorded calls
   */
  clearCalls(): void {
    this.calls = [];
  }

  /**
   * Set mock data for datastore queries
   */
  setDatastoreQueryResults(items: Record<string, unknown>[]): void {
    this.datastoreQueryResults = items;
  }

  /**
   * Set a specific item in the mock datastore
   */
  setDatastoreItem(id: string, item: Record<string, unknown>): void {
    this.datastoreItems.set(id, item);
  }
}

/**
 * Create a new mock Slack client
 */
export function createMockSlackClient(): MockSlackClient {
  return new MockSlackClient();
}
