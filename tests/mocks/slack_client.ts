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

// Type interfaces for mock client call parameters
export interface DatastoreGetParams {
  datastore: string;
  id: string;
}

export interface DatastorePutParams {
  datastore: string;
  item: Record<string, unknown>;
}

export interface DatastoreQueryParams {
  datastore: string;
  expression?: string;
  expression_attributes?: Record<string, string>;
  expression_values?: Record<string, unknown>;
}

export interface DatastoreUpdateParams {
  datastore: string;
  item: Record<string, unknown>;
}

export interface ChatPostMessageParams {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
}

export interface ChatPostEphemeralParams {
  channel: string;
  user: string;
  text: string;
  blocks?: SlackBlock[];
}

export interface ChatUpdateParams {
  channel: string;
  ts: string;
  text?: string;
  blocks?: SlackBlock[];
}

export interface ConversationsMembersParams {
  channel: string;
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
          const existing = this.datastoreItems.get(params.item.id as string) || {};
          this.datastoreItems.set(params.item.id as string, { ...existing, ...params.item });
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
