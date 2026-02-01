/**
 * Type definitions for Slack API client and related types
 * 
 * These types provide proper typing for the Slack Bolt SDK client
 * and Block Kit elements to replace usage of `any` types.
 */

/**
 * Slack API Client Type
 * Represents the Slack client with methods for apps, chat, users, pins, etc.
 */
export interface SlackClient {
  apps: {
    datastore: {
      get: (params: {
        datastore: string;
        id: string;
      }) => Promise<{
        ok: boolean;
        item?: Record<string, unknown>;
        error?: string;
      }>;
      put: (params: {
        datastore: string;
        item: Record<string, unknown>;
      }) => Promise<{
        ok: boolean;
        error?: string;
      }>;
      query: (params: {
        datastore: string;
        expression?: string;
        expression_attributes?: Record<string, string>;
        expression_values?: Record<string, unknown>;
      }) => Promise<{
        ok: boolean;
        items: Array<Record<string, unknown>>;
        error?: string;
      }>;
    };
  };
  chat: {
    postMessage: (params: {
      channel: string;
      text: string;
      blocks?: SlackBlock[];
      thread_ts?: string;
    }) => Promise<{
      ok: boolean;
      ts?: string;
      message?: {
        blocks?: SlackBlock[];
      };
      error?: string;
    }>;
    postEphemeral: (params: {
      channel: string;
      user: string;
      text: string;
      blocks?: SlackBlock[];
    }) => Promise<{
      ok: boolean;
      error?: string;
    }>;
    update: (params: {
      channel: string;
      ts: string;
      text: string;
      blocks?: SlackBlock[];
    }) => Promise<{
      ok: boolean;
      error?: string;
    }>;
  };
  users: {
    info: (params: {
      user: string;
    }) => Promise<{
      ok: boolean;
      user?: {
        real_name?: string;
        name?: string;
      };
      error?: string;
    }>;
  };
  pins: {
    add: (params: {
      channel: string;
      timestamp: string;
    }) => Promise<{
      ok: boolean;
      error?: string;
    }>;
    remove: (params: {
      channel: string;
      timestamp: string;
    }) => Promise<{
      ok: boolean;
      error?: string;
    }>;
  };
}

/**
 * Slack Block Kit Text Object
 */
export interface SlackTextObject {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

/**
 * Slack Block Kit Button Element
 */
export interface SlackButtonElement {
  type: "button";
  text: SlackTextObject;
  action_id: string;
  value?: string;
  style?: "primary" | "danger";
}

/**
 * Slack Block Kit Element
 */
export interface SlackElement {
  type: string;
  text?: string;
  value?: string;
  [key: string]: unknown;
}

/**
 * Slack Block Kit Block
 */
export interface SlackBlock {
  type: string;
  text?: SlackTextObject;
  elements?: Array<SlackElement | SlackButtonElement>;
  fields?: SlackTextObject[];
  block_id?: string;
  [key: string]: unknown;
}
