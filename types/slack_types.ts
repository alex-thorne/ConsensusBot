// ConsensusBot v2.0 — Hand-written Slack client surface and Block Kit types.
//
// SPEC source of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §20 (Slack types)
//
// Rationale: the SDK's `client` is opaquely typed. We narrow it to exactly
// the surface the app uses so the integration MockSlackClient and every
// utility/function file consume the same contract. Avoid `any`.

// ---------------------------------------------------------------------------
// Block Kit primitives
// ---------------------------------------------------------------------------

/**
 * Block Kit text object — `mrkdwn` for rich text, `plain_text` for emoji-aware
 * literal text. `emoji` only applies to `plain_text`.
 */
export interface SlackTextObject {
  type: "mrkdwn" | "plain_text";
  text: string;
  emoji?: boolean;
}

/**
 * Block Kit button element. The voting buttons set `action_id` to the vote
 * verb and `value` to the decision UUID.
 */
export interface SlackButtonElement {
  type: "button";
  text: SlackTextObject;
  action_id: string;
  value?: string;
  style?: "primary" | "danger";
  url?: string;
}

/**
 * Block Kit element. Buttons are statically known; everything else is
 * extensible — overflow, datepicker, image, etc. — and goes through the
 * fallback record shape.
 */
export type SlackElement =
  | SlackButtonElement
  | { type: string; [k: string]: unknown };

/**
 * Block Kit `header` block.
 */
export interface SlackHeaderBlock {
  type: "header";
  text: SlackTextObject;
  block_id?: string;
}

/**
 * Block Kit `section` block. `text` is the body; `fields` is an optional list
 * of side-by-side text blocks.
 */
export interface SlackSectionBlock {
  type: "section";
  text?: SlackTextObject;
  fields?: SlackTextObject[];
  block_id?: string;
}

/**
 * Block Kit `divider` block.
 */
export interface SlackDividerBlock {
  type: "divider";
  block_id?: string;
}

/**
 * Block Kit `actions` block — typically the row of vote/cancel/delete buttons.
 */
export interface SlackActionsBlock {
  type: "actions";
  elements: SlackElement[];
  block_id?: string;
}

/**
 * Block Kit `context` block. Elements are `mrkdwn` text or `image` references.
 */
export interface SlackContextBlock {
  type: "context";
  elements: Array<
    | SlackTextObject
    | {
      type: "image";
      image_url: string;
      alt_text: string;
    }
  >;
  block_id?: string;
}

/**
 * Block Kit block — discriminated union of the blocks the app emits.
 */
export type SlackBlock =
  | SlackHeaderBlock
  | SlackSectionBlock
  | SlackDividerBlock
  | SlackActionsBlock
  | SlackContextBlock;

// ---------------------------------------------------------------------------
// Web API response payloads
// ---------------------------------------------------------------------------

/**
 * Subset of `users.info` user payload the app reads (§20).
 *
 * `deleted: true` indicates the user has been deactivated; the bot filter
 * applies `is_bot && !USLACKBOT && !deleted` uniformly across voter sources.
 */
export interface SlackUserInfo {
  id: string;
  real_name?: string;
  name?: string;
  is_bot?: boolean;
  deleted?: boolean;
}

/**
 * Subset of a `usergroups.list` entry the app reads (§20).
 */
export interface SlackUsergroupSummary {
  id: string;
  handle?: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Datastore method argument / response shapes
// ---------------------------------------------------------------------------

/**
 * `apps.datastore.get` argument — id is the primary key.
 */
export interface DatastoreGetArgs {
  datastore: string;
  id: string;
}

/**
 * `apps.datastore.put` argument — `item` is the full row to upsert.
 */
export interface DatastorePutArgs<T> {
  datastore: string;
  item: T;
}

/**
 * `apps.datastore.query` argument — Slack expression-language query with
 * cursor pagination. `expression_values` accepts arbitrary scalars typed by
 * the datastore schema, hence `unknown`.
 */
export interface DatastoreQueryArgs {
  datastore: string;
  expression?: string;
  expression_attributes?: Record<string, string>;
  expression_values?: Record<string, unknown>;
  cursor?: string;
  limit?: number;
}

/**
 * `apps.datastore.delete` argument — id is the primary key.
 */
export interface DatastoreDeleteArgs {
  datastore: string;
  id: string;
}

export interface DatastoreGetResponse<T> {
  ok: boolean;
  item?: T;
  error?: string;
}

export interface DatastorePutResponse<T> {
  ok: boolean;
  item?: T;
  error?: string;
}

export interface DatastoreQueryResponse<T> {
  ok: boolean;
  items: T[];
  response_metadata?: { next_cursor?: string };
  error?: string;
}

export interface DatastoreDeleteResponse {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Chat method argument / response shapes
// ---------------------------------------------------------------------------

export interface ChatPostMessageArgs {
  channel: string;
  text?: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}

export interface ChatPostEphemeralArgs {
  channel: string;
  user: string;
  text?: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
}

export interface ChatUpdateArgs {
  channel: string;
  ts: string;
  text?: string;
  blocks?: SlackBlock[];
}

export interface ChatDeleteArgs {
  channel: string;
  ts: string;
}

export interface ChatResponse {
  ok: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Users / conversations / pins / usergroups / team
// ---------------------------------------------------------------------------

export interface UsersInfoArgs {
  user: string;
}

export interface UsersInfoResponse {
  ok: boolean;
  user?: SlackUserInfo;
  error?: string;
}

export interface ConversationsMembersArgs {
  channel: string;
  cursor?: string;
  limit?: number;
}

export interface ConversationsMembersResponse {
  ok: boolean;
  members?: string[];
  response_metadata?: { next_cursor?: string };
  error?: string;
}

export interface PinsListArgs {
  channel: string;
}

export interface PinsListResponse {
  ok: boolean;
  items?: Array<{ message?: { ts?: string } }>;
  error?: string;
}

export interface PinsAddArgs {
  channel: string;
  timestamp: string;
}

export interface PinsRemoveArgs {
  channel: string;
  timestamp: string;
}

export interface PinsMutationResponse {
  ok: boolean;
  error?: string;
}

export interface UsergroupsListArgs {
  cursor?: string;
  limit?: number;
}

export interface UsergroupsListResponse {
  ok: boolean;
  usergroups?: SlackUsergroupSummary[];
  response_metadata?: { next_cursor?: string };
  error?: string;
}

export interface UsergroupsUsersListArgs {
  usergroup: string;
  cursor?: string;
  limit?: number;
}

export interface UsergroupsUsersListResponse {
  ok: boolean;
  users?: string[];
  response_metadata?: { next_cursor?: string };
  error?: string;
}

export interface TeamInfoResponse {
  ok: boolean;
  team?: {
    id?: string;
    name?: string;
    tz?: string;
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// SlackClient — narrow surface the app actually uses
// ---------------------------------------------------------------------------

/**
 * The Slack web-client surface the app consumes (§20).
 *
 * Implementations: the SDK-provided client at runtime, and `MockSlackClient`
 * in `tests/mocks/slack_client.ts`. The mock MUST implement every method on
 * this interface; new methods are wave-gate blockers if missing in the mock.
 */
export interface SlackClient {
  apps: {
    datastore: {
      get<T>(args: DatastoreGetArgs): Promise<DatastoreGetResponse<T>>;
      put<T>(args: DatastorePutArgs<T>): Promise<DatastorePutResponse<T>>;
      query<T>(args: DatastoreQueryArgs): Promise<DatastoreQueryResponse<T>>;
      delete(args: DatastoreDeleteArgs): Promise<DatastoreDeleteResponse>;
    };
  };
  chat: {
    postMessage(args: ChatPostMessageArgs): Promise<ChatResponse>;
    postEphemeral(args: ChatPostEphemeralArgs): Promise<ChatResponse>;
    update(args: ChatUpdateArgs): Promise<ChatResponse>;
    delete(args: ChatDeleteArgs): Promise<ChatResponse>;
  };
  users: {
    info(args: UsersInfoArgs): Promise<UsersInfoResponse>;
  };
  conversations: {
    members(
      args: ConversationsMembersArgs,
    ): Promise<ConversationsMembersResponse>;
  };
  pins: {
    list(args: PinsListArgs): Promise<PinsListResponse>;
    add(args: PinsAddArgs): Promise<PinsMutationResponse>;
    remove(args: PinsRemoveArgs): Promise<PinsMutationResponse>;
  };
  usergroups: {
    list(args?: UsergroupsListArgs): Promise<UsergroupsListResponse>;
    users: {
      list(args: UsergroupsUsersListArgs): Promise<UsergroupsUsersListResponse>;
    };
  };
  team: {
    info(): Promise<TeamInfoResponse>;
  };
}
