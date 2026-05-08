// ConsensusBot v2.0 — Type-shape tests for `create_decision`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8.5  (Block Kit message layout)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §20   (SlackClient surface)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §21.1 (`create_decision_test.ts` row)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-203
//
// These tests pin the *shape* contract for the create_decision function. The
// function itself is produced in T-301, so this file MUST NOT import
// `functions/create_decision.ts`. Every fixture (Block Kit blocks, the
// `SlackClient` mock, the actions-block transform) is built inline.
//
// Acceptance:
//   deno test --allow-read --allow-env tests/create_decision_test.ts

import { assert, assertEquals } from "@std/assert";
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
  SlackActionsBlock,
  SlackBlock,
  SlackButtonElement,
  SlackClient,
  SlackContextBlock,
  SlackDividerBlock,
  SlackElement,
  SlackHeaderBlock,
  SlackSectionBlock,
  SlackTextObject,
  TeamInfoResponse,
  UsergroupsListArgs,
  UsergroupsListResponse,
  UsergroupsUsersListArgs,
  UsergroupsUsersListResponse,
  UsersInfoArgs,
  UsersInfoResponse,
} from "../types/slack_types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** RFC-4122 UUID v4-ish shape; `crypto.randomUUID()` always emits this form. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The five action_ids per SPEC §8.5, in display order. */
const EXPECTED_ACTION_IDS = [
  "vote_yes",
  "vote_no",
  "vote_abstain",
  "decision_cancel",
  "decision_delete",
] as const;

// ---------------------------------------------------------------------------
// SlackClient shape — a minimal inline mock with `satisfies SlackClient`
// ---------------------------------------------------------------------------

Deno.test("SlackClient — minimal inline mock satisfies the interface", () => {
  // Stub helpers — these throw if invoked; the test only verifies the surface
  // type-checks. No method is called below.
  const okChatResponse = (): Promise<ChatResponse> =>
    Promise.resolve({ ok: true, ts: "1.0", channel: "C0" });
  const okPinsResponse = (): Promise<PinsMutationResponse> =>
    Promise.resolve({ ok: true });

  const client = {
    apps: {
      datastore: {
        get<T>(_args: DatastoreGetArgs): Promise<DatastoreGetResponse<T>> {
          return Promise.resolve({ ok: true });
        },
        put<T>(args: DatastorePutArgs<T>): Promise<DatastorePutResponse<T>> {
          return Promise.resolve({ ok: true, item: args.item });
        },
        query<T>(
          _args: DatastoreQueryArgs,
        ): Promise<DatastoreQueryResponse<T>> {
          return Promise.resolve({ ok: true, items: [] });
        },
        delete(_args: DatastoreDeleteArgs): Promise<DatastoreDeleteResponse> {
          return Promise.resolve({ ok: true });
        },
      },
    },
    chat: {
      postMessage(_args: ChatPostMessageArgs): Promise<ChatResponse> {
        return okChatResponse();
      },
      postEphemeral(_args: ChatPostEphemeralArgs): Promise<ChatResponse> {
        return okChatResponse();
      },
      update(_args: ChatUpdateArgs): Promise<ChatResponse> {
        return okChatResponse();
      },
      delete(_args: ChatDeleteArgs): Promise<ChatResponse> {
        return okChatResponse();
      },
    },
    users: {
      info(_args: UsersInfoArgs): Promise<UsersInfoResponse> {
        return Promise.resolve({ ok: true });
      },
    },
    conversations: {
      members(
        _args: ConversationsMembersArgs,
      ): Promise<ConversationsMembersResponse> {
        return Promise.resolve({ ok: true, members: [] });
      },
    },
    pins: {
      list(_args: PinsListArgs): Promise<PinsListResponse> {
        return Promise.resolve({ ok: true, items: [] });
      },
      add(_args: PinsAddArgs): Promise<PinsMutationResponse> {
        return okPinsResponse();
      },
      remove(_args: PinsRemoveArgs): Promise<PinsMutationResponse> {
        return okPinsResponse();
      },
    },
    usergroups: {
      list(_args?: UsergroupsListArgs): Promise<UsergroupsListResponse> {
        return Promise.resolve({ ok: true, usergroups: [] });
      },
      users: {
        list(
          _args: UsergroupsUsersListArgs,
        ): Promise<UsergroupsUsersListResponse> {
          return Promise.resolve({ ok: true, users: [] });
        },
      },
    },
    team: {
      info(): Promise<TeamInfoResponse> {
        return Promise.resolve({ ok: true });
      },
    },
  } satisfies SlackClient;

  // The `satisfies` clause is the type-level assertion. Three runtime checks
  // pin that every documented sub-namespace is present.
  assertEquals(typeof client.apps.datastore.get, "function");
  assertEquals(typeof client.chat.postMessage, "function");
  assertEquals(typeof client.team.info, "function");
});

// ---------------------------------------------------------------------------
// SlackBlock shapes — header, section (text), section (fields), divider,
// actions, context
// ---------------------------------------------------------------------------

Deno.test("SlackBlock — header block carries a plain_text title", () => {
  const block: SlackHeaderBlock = {
    type: "header",
    text: {
      type: "plain_text",
      text: "🗳️ Adopt Deno 2",
      emoji: true,
    },
  };
  // Discriminated-union narrowing.
  const asBlock: SlackBlock = block;
  if (asBlock.type === "header") {
    assertEquals(asBlock.text.type, "plain_text");
    assertEquals(asBlock.text.text, "🗳️ Adopt Deno 2");
    assertEquals(asBlock.text.emoji, true);
  } else {
    throw new Error("expected header");
  }
});

Deno.test("SlackBlock — section block with `text` (mrkdwn body)", () => {
  const block: SlackSectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Proposal:*\nMigrate the codebase to Deno 2.x.",
    },
  };
  assertEquals(block.type, "section");
  assert(block.text !== undefined);
  assertEquals(block.text.type, "mrkdwn");
  assertEquals(block.fields, undefined);
});

Deno.test("SlackBlock — section block with `fields[]` (four mrkdwn columns)", () => {
  const fields: SlackTextObject[] = [
    { type: "mrkdwn", text: "*Success Criteria:*\nSimple Majority" },
    { type: "mrkdwn", text: "*Deadline:*\n9 May 2026 at 23:59 GMT" },
    { type: "mrkdwn", text: "*Required Voters:*\n<@U001>, <@U002>" },
    { type: "mrkdwn", text: "*Status:*\n🟢 Active — quorum 2 of 3" },
  ];
  const block: SlackSectionBlock = {
    type: "section",
    fields,
  };
  assertEquals(block.fields?.length, 4);
  assertEquals(block.fields?.[0].type, "mrkdwn");
  assertEquals(block.text, undefined);
});

Deno.test("SlackBlock — divider block has only a type tag", () => {
  const block: SlackDividerBlock = { type: "divider" };
  const asBlock: SlackBlock = block;
  assertEquals(asBlock.type, "divider");
});

Deno.test("SlackBlock — actions block has five voting/management buttons", () => {
  // Inline UUID stand-in; real UUIDs are exercised below.
  const decisionId = "11111111-2222-3333-4444-555555555555";
  const block: SlackActionsBlock = {
    type: "actions",
    block_id: "voting_actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "✅ Yes", emoji: true },
        action_id: "vote_yes",
        value: decisionId,
        style: "primary",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "❌ No", emoji: true },
        action_id: "vote_no",
        value: decisionId,
        style: "danger",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "⚪ Abstain", emoji: true },
        action_id: "vote_abstain",
        value: decisionId,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🚫 Cancel", emoji: true },
        action_id: "decision_cancel",
        value: decisionId,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🗑️ Delete", emoji: true },
        action_id: "decision_delete",
        value: decisionId,
      },
    ],
  };

  assertEquals(block.type, "actions");
  assertEquals(block.block_id, "voting_actions");
  assertEquals(block.elements.length, 5);
});

Deno.test("SlackBlock — context block carries mrkdwn elements", () => {
  const block: SlackContextBlock = {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "Created by <@U0001> | Vote by 9 May 2026 at 23:59 GMT",
      },
    ],
  };
  assertEquals(block.type, "context");
  assertEquals(block.elements.length, 1);
  // Discriminate the element union: it's a SlackTextObject here, not an image.
  const first = block.elements[0];
  if ("text" in first) {
    assertEquals(first.type, "mrkdwn");
    assert(first.text.startsWith("Created by"));
  } else {
    throw new Error("expected mrkdwn text element");
  }
});

// ---------------------------------------------------------------------------
// Five-button actions block transform — placeholder → real UUID
// ---------------------------------------------------------------------------

/**
 * Build a five-button actions block whose `value` is the legacy
 * `"{{decision_id}}"` placeholder string. This pre-T-301 shape exists only
 * inside this test; the real `create_decision` skips the placeholder dance and
 * emits the UUID directly (SPEC §8.5).
 */
function makePlaceholderActionsBlock(): SlackActionsBlock {
  return {
    type: "actions",
    block_id: "voting_actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "✅ Yes", emoji: true },
        action_id: "vote_yes",
        value: "{{decision_id}}",
        style: "primary",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "❌ No", emoji: true },
        action_id: "vote_no",
        value: "{{decision_id}}",
        style: "danger",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "⚪ Abstain", emoji: true },
        action_id: "vote_abstain",
        value: "{{decision_id}}",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🚫 Cancel", emoji: true },
        action_id: "decision_cancel",
        value: "{{decision_id}}",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🗑️ Delete", emoji: true },
        action_id: "decision_delete",
        value: "{{decision_id}}",
      },
    ],
  };
}

/**
 * Type guard narrowing a `SlackElement` to `SlackButtonElement`. The discriminator
 * `type === "button"` alone is insufficient because the `SlackElement` union
 * contains an open-ended fallback (`{ type: string; ... }`) whose `type` field
 * also accepts `"button"`. Probing for the required `action_id` field disambiguates.
 */
function isSlackButton(el: SlackElement): el is SlackButtonElement {
  return el.type === "button" &&
    typeof (el as { action_id?: unknown }).action_id ===
      "string";
}

/**
 * Map over the elements of an actions block and rewrite each button's `value`
 * to the supplied UUID. Non-button elements pass through unchanged. Pure;
 * returns a new block.
 */
function rewriteButtonValues(
  block: SlackActionsBlock,
  decisionId: string,
): SlackActionsBlock {
  const elements: SlackElement[] = block.elements.map((el): SlackElement => {
    if (isSlackButton(el)) {
      const button: SlackButtonElement = {
        ...el,
        value: decisionId,
      };
      return button;
    }
    return el;
  });
  return {
    ...block,
    elements,
  };
}

Deno.test("actions transform — rewrites every button value to the supplied UUID", () => {
  const placeholderBlock = makePlaceholderActionsBlock();
  const decisionId = crypto.randomUUID();

  const rewritten = rewriteButtonValues(placeholderBlock, decisionId);

  assertEquals(rewritten.elements.length, 5);
  for (const el of rewritten.elements) {
    if (!isSlackButton(el)) {
      throw new Error(`expected button, got ${el.type}`);
    }
    assertEquals(el.value, decisionId);
  }
});

Deno.test("actions transform — no `{{decision_id}}` placeholder remains after rewrite", () => {
  const placeholderBlock = makePlaceholderActionsBlock();
  const decisionId = crypto.randomUUID();

  // Sanity: the input DOES contain the placeholder.
  assert(JSON.stringify(placeholderBlock).includes("{{decision_id}}"));

  const rewritten = rewriteButtonValues(placeholderBlock, decisionId);

  // Post-transform: the placeholder MUST be absent.
  assertEquals(
    JSON.stringify(rewritten).includes("{{decision_id}}"),
    false,
  );
});

// ---------------------------------------------------------------------------
// UUID-shaped values — `crypto.randomUUID()` and per-button regex
// ---------------------------------------------------------------------------

Deno.test("UUID — `crypto.randomUUID()` matches the canonical regex", () => {
  for (let i = 0; i < 5; i++) {
    const id = crypto.randomUUID();
    assert(
      UUID_RE.test(id),
      `crypto.randomUUID() output ${id} did not match ${UUID_RE}`,
    );
  }
});

Deno.test("UUID — every rewritten button value matches the UUID regex", () => {
  const decisionId = crypto.randomUUID();
  const rewritten = rewriteButtonValues(
    makePlaceholderActionsBlock(),
    decisionId,
  );

  for (const el of rewritten.elements) {
    if (!isSlackButton(el)) {
      throw new Error(`expected button, got ${el.type}`);
    }
    assert(typeof el.value === "string", "button.value should be a string");
    assert(
      UUID_RE.test(el.value),
      `button value ${el.value} did not match ${UUID_RE}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Action IDs — exact order per SPEC §8.5
// ---------------------------------------------------------------------------

/**
 * Build the canonical SPEC §8.5 actions block with five buttons and a real
 * UUID stamped into each `value`. Used by the action_id-order and
 * button-style tests below.
 */
function makeCanonicalActionsBlock(decisionId: string): SlackActionsBlock {
  return {
    type: "actions",
    block_id: "voting_actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "✅ Yes", emoji: true },
        action_id: "vote_yes",
        value: decisionId,
        style: "primary",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "❌ No", emoji: true },
        action_id: "vote_no",
        value: decisionId,
        style: "danger",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "⚪ Abstain", emoji: true },
        action_id: "vote_abstain",
        value: decisionId,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🚫 Cancel", emoji: true },
        action_id: "decision_cancel",
        value: decisionId,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🗑️ Delete", emoji: true },
        action_id: "decision_delete",
        value: decisionId,
      },
    ],
  };
}

Deno.test("action_id order — exactly [vote_yes, vote_no, vote_abstain, decision_cancel, decision_delete]", () => {
  const block = makeCanonicalActionsBlock(crypto.randomUUID());

  const ids = block.elements.map((el): string => {
    if (!isSlackButton(el)) {
      throw new Error(`expected button, got ${el.type}`);
    }
    return el.action_id;
  });

  assertEquals(ids, [...EXPECTED_ACTION_IDS]);
});

// ---------------------------------------------------------------------------
// Button styles — Yes=primary, No=danger, others=undefined
// ---------------------------------------------------------------------------

Deno.test("button styles — Yes=primary, No=danger, Abstain/Cancel/Delete have no style", () => {
  const block = makeCanonicalActionsBlock(crypto.randomUUID());
  const buttons: SlackButtonElement[] = block.elements.map(
    (el): SlackButtonElement => {
      if (!isSlackButton(el)) {
        throw new Error(`expected button, got ${el.type}`);
      }
      return el;
    },
  );

  // Index-based assertions track the SPEC §8.5 ordering.
  const [yes, no, abstain, cancel, del] = buttons;

  assertEquals(yes.action_id, "vote_yes");
  assertEquals(yes.style, "primary");

  assertEquals(no.action_id, "vote_no");
  assertEquals(no.style, "danger");

  assertEquals(abstain.action_id, "vote_abstain");
  assertEquals(abstain.style, undefined);

  assertEquals(cancel.action_id, "decision_cancel");
  assertEquals(cancel.style, undefined);

  assertEquals(del.action_id, "decision_delete");
  assertEquals(del.style, undefined);
});
