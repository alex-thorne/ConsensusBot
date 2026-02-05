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
      get: async (params: { datastore: string; id: string }) => {
        this.calls.push({ method: "apps.datastore.get", params });
        const item = this.datastoreItems.get(params.id);
        return { ok: true, item: item || {} };
      },
      put: async (params: { datastore: string; item: Record<string, unknown> }) => {
        this.calls.push({ method: "apps.datastore.put", params });
        if (params.item.id) {
          this.datastoreItems.set(params.item.id as string, params.item);
        }
        return { ok: true };
      },
      query: async (params: {
        datastore: string;
        expression?: string;
        expression_attributes?: Record<string, string>;
        expression_values?: Record<string, unknown>;
      }) => {
        this.calls.push({ method: "apps.datastore.query", params });
        return { ok: true, items: this.datastoreQueryResults };
      },
      update: async (params: {
        datastore: string;
        item: Record<string, unknown>;
      }) => {
        this.calls.push({ method: "apps.datastore.update", params });
        if (params.item.id) {
          const existing = this.datastoreItems.get(params.item.id as string) || {};
          this.datastoreItems.set(params.item.id as string, { ...existing, ...params.item });
        }
        return { ok: true };
      },
    },
  };

  chat = {
    postMessage: async (params: {
      channel: string;
      text: string;
      blocks?: SlackBlock[];
      thread_ts?: string;
    }) => {
      this.calls.push({ method: "chat.postMessage", params });
      return {
        ok: true,
        ts: "1234567890.123456",
        message: {
          blocks: params.blocks,
        },
      };
    },
    postEphemeral: async (params: {
      channel: string;
      user: string;
      text: string;
      blocks?: SlackBlock[];
    }) => {
      this.calls.push({ method: "chat.postEphemeral", params });
      return { ok: true };
    },
    update: async (params: {
      channel: string;
      ts: string;
      text?: string;
      blocks?: SlackBlock[];
    }) => {
      this.calls.push({ method: "chat.update", params });
      return { ok: true };
    },
  };

  conversations = {
    members: async (params: { channel: string }) => {
      this.calls.push({ method: "conversations.members", params });
      return {
        ok: true,
        members: ["U123456", "U234567", "U345678"],
      };
    },
  };

  users = {
    info: async (params: { user: string }) => {
      this.calls.push({ method: "users.info", params });
      return {
        ok: true,
        user: {
          id: params.user,
          name: `user_${params.user}`,
          real_name: `Test User ${params.user}`,
        },
      };
    },
  };

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
