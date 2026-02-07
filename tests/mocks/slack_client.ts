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
    members: (params: { channel: string }) => {
      this.calls.push({ method: "conversations.members", params });
      return Promise.resolve({
        ok: true,
        members: ["U123456", "U234567", "U345678"],
      });
    },
  };

  users = {
    info: (params: { user: string }) => {
      this.calls.push({ method: "users.info", params });
      return Promise.resolve({
        ok: true,
        user: {
          id: params.user,
          name: `user_${params.user}`,
          real_name: `Test User ${params.user}`,
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

  usergroups = {
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
