// ConsensusBot v2.0 — `create_decision` function and block-action handlers.
//
// SPEC sources of truth (read these BEFORE editing this file):
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8  (function definition, persistence,
//                                              Block Kit message, handler chain)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §9  (vote handler)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §10 (cancel handler)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §11 (delete handler)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §12 (`checkIfShouldFinalize`)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §13 (`finalizeDecision`)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §14 (parsing / escape utilities)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16 (concurrency, eventual consistency,
//                                              `finalized_at` token)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §17 (ADR generation)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §19 (date utilities)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md  T-301 (this task)
//
// Audit invariants enforced here (PLAN §2):
//   12. Datastore-write-before-message-post ordering with rollback on failure.
//   13. UUID-keyed decisions; no `{{decision_id}}` placeholder in button values.
//   14. Bot filter is uniform — applied to individual voters, usergroup members,
//       and channel members, all via cached `users.info`.
//   15. Workspace-tz deadlines: pickers resolve to end-of-day in workspace tz.
//   16. Quorum-protected vote resolution flows through `decision_logic.ts`.
//   17. Vote history on every change (`event_kind: "cast" | "changed"`).
//   18. Structured logging on every state transition via `utils/log.ts`.
//
// Single-file ownership: T-301 owns ONLY this file. Helpers used by T-302
// (`process_active_decisions`) are exported from here:
//   - `finalizeDecision` — invoked by T-302's Phase A.
//   - `checkIfShouldFinalize` — exported for symmetry with T-302's tests.

import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";

import type {
  DecisionRecord,
  SuccessCriteria,
  VoteHistoryRecord,
  VoteRecord,
  VoterRecord,
  VoteType,
} from "../types/decision_types.ts";
import type {
  ChatPostMessageArgs,
  SlackBlock,
  SlackButtonElement,
  SlackClient,
  SlackTextObject,
  SlackUserInfo,
} from "../types/slack_types.ts";

import {
  formatDeadlineHuman,
  getDefaultDeadline,
  getWorkspaceTz,
  isDeadlinePassed,
  resolveDeadline,
} from "../utils/date_utils.ts";
import { parseUsergroupInput } from "../utils/slack_parse.ts";
import { escapeSlackText } from "../utils/escape_slack.ts";
import {
  calculateDecisionOutcome,
  checkDeadlock,
  type DecisionResult,
} from "../utils/decision_logic.ts";
import { reReadAndCheck } from "../utils/concurrency.ts";
import {
  formatADRForSlack,
  generateADRMarkdown,
} from "../utils/adr_generator.ts";
import { log } from "../utils/log.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SPEC §8.2.4 — hard cap on channel-member-derived voters. */
const MAX_CHANNEL_VOTERS = 500;

/** SPEC §9 step 9 — voter-mention list truncation in the live message. */
const VOTER_MENTION_TRUNCATE_AT = 30;

/** SPEC §8.1.4 — input length limits. */
const MAX_DECISION_NAME_LENGTH = 200;
const MAX_PROPOSAL_LENGTH = 2500;

// ---------------------------------------------------------------------------
// Function definition (SPEC §8)
// ---------------------------------------------------------------------------

/**
 * `create_decision_function` — the workflow's second step.
 *
 * Inputs mirror the §7.1 form, plus `channel_id` and `creator_id` from the
 * workflow's slash-command trigger. There are no `output_parameters` (§8.7);
 * the function returns `{ completed: false }` so the chained block-action
 * handlers continue to receive button clicks for the lifetime of the workflow
 * run.
 */
export const CreateDecisionFunction = DefineFunction({
  callback_id: "create_decision_function",
  title: "Create Decision",
  description: "Create a decision record and post the voting message.",
  source_file: "functions/create_decision.ts",
  input_parameters: {
    properties: {
      decision_name: {
        type: Schema.types.string,
        description: "Title of the decision (≤ 200 chars).",
      },
      proposal: {
        type: Schema.types.string,
        description: "Decision proposal body (≤ 2500 chars).",
      },
      required_voters: {
        type: Schema.types.array,
        items: { type: Schema.slack.types.user_id },
        description: "Required voters from the user picker.",
      },
      required_usergroups: {
        type: Schema.types.string,
        description:
          "Optional usergroups (mentions, IDs, or @handles, comma/whitespace separated).",
      },
      include_channel_members: {
        type: Schema.types.boolean,
        description:
          "When true, all eligible (non-bot, non-deactivated) channel members are added as voters.",
      },
      success_criteria: {
        type: Schema.types.string,
        description:
          "One of: simple_majority, super_majority, unanimous (validated downstream).",
      },
      deadline: {
        type: Schema.slack.types.date,
        description:
          "Voting deadline (YYYY-MM-DD). Defaults to 5 business days when blank.",
      },
      quorum_override: {
        type: Schema.types.number,
        description:
          "Optional explicit quorum (1 ≤ override ≤ required_voters_count).",
      },
      channel_id: {
        type: Schema.slack.types.channel_id,
        description: "Channel where the voting message is posted.",
      },
      creator_id: {
        type: Schema.slack.types.user_id,
        description: "User who ran /consensus.",
      },
    },
    required: [
      "decision_name",
      "proposal",
      "required_voters",
      "success_criteria",
      "channel_id",
      "creator_id",
    ],
  },
  // No `output_parameters` by design — see SPEC §8.7.
});

// ---------------------------------------------------------------------------
// Voter resolution helpers (SPEC §8.2)
// ---------------------------------------------------------------------------

/**
 * Cache-aware bot/USLACKBOT/deleted filter (SPEC §8.2.3).
 *
 * Returns true ONLY for users where `is_bot !== true`, `deleted !== true`,
 * AND `id !== "USLACKBOT"`. The cache is supplied by the caller so individual,
 * usergroup, and channel-member loops share a single set of `users.info`
 * lookups.
 */
async function isHumanUser(
  client: SlackClient,
  userId: string,
  cache: Map<string, SlackUserInfo>,
): Promise<boolean> {
  if (userId === "USLACKBOT") return false;
  let info = cache.get(userId);
  if (!info) {
    try {
      const res = await client.users.info({ user: userId });
      if (!res.ok || !res.user) return false;
      info = res.user;
      cache.set(userId, info);
    } catch {
      return false;
    }
  }
  if (info.is_bot === true) return false;
  if (info.deleted === true) return false;
  return true;
}

/**
 * Page through `usergroups.list` until exhausted. Tolerates per-page failure
 * by stopping the loop and returning what we have (SPEC §8.2.2).
 */
async function fetchAllUsergroups(
  client: SlackClient,
): Promise<Array<{ id: string; handle?: string; name?: string }>> {
  const out: Array<{ id: string; handle?: string; name?: string }> = [];
  let cursor: string | undefined;
  do {
    let res;
    try {
      res = await client.usergroups.list(cursor ? { cursor } : {});
    } catch (err) {
      log.error({
        event: "usergroups_list_failed",
        error: String(err),
      });
      break;
    }
    if (!res.ok || !res.usergroups) {
      if (res.error) {
        log.error({
          event: "usergroups_list_failed",
          error: res.error,
        });
      }
      break;
    }
    out.push(...res.usergroups);
    cursor = res.response_metadata?.next_cursor;
  } while (cursor);
  return out;
}

/**
 * Page through `usergroups.users.list` for a single group; tolerates failure.
 */
async function fetchUsergroupMembers(
  client: SlackClient,
  usergroupId: string,
): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    let res;
    try {
      res = await client.usergroups.users.list({
        usergroup: usergroupId,
        ...(cursor ? { cursor } : {}),
      });
    } catch (err) {
      log.error({
        event: "usergroup_members_failed",
        usergroup: usergroupId,
        error: String(err),
      });
      break;
    }
    if (!res.ok || !res.users) {
      if (res.error) {
        log.error({
          event: "usergroup_members_failed",
          usergroup: usergroupId,
          error: res.error,
        });
      }
      break;
    }
    out.push(...res.users);
    cursor = res.response_metadata?.next_cursor;
  } while (cursor);
  return out;
}

/**
 * Page through `conversations.members`; raw IDs only — caller filters.
 * Returns a flat array (SPEC §8.2.4).
 */
async function fetchAllChannelMembers(
  client: SlackClient,
  channel: string,
): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.conversations.members({
      channel,
      ...(cursor ? { cursor } : {}),
    });
    if (!res.ok || !res.members) {
      if (res.error) {
        log.error({
          event: "conversations_members_failed",
          channel,
          error: res.error,
        });
      }
      break;
    }
    out.push(...res.members);
    cursor = res.response_metadata?.next_cursor;
  } while (cursor);
  return out;
}

// ---------------------------------------------------------------------------
// Block Kit builders (SPEC §8.5, §9 step 9, §10 step 5, §13 step 7)
// ---------------------------------------------------------------------------

/**
 * SPEC §8.5 — `success_criteria.replace(/_/g, " ").replace(/\b\w/g, l =>
 * l.toUpperCase())`. e.g. `simple_majority` → `Simple Majority`.
 */
function formatCriteria(criteria: string): string {
  return criteria
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * SPEC §8.5 — five-button actions row. Every button's `value` is the
 * server-generated decision UUID (no placeholder). Order matters: the
 * spec pins `[Yes, No, Abstain, Cancel, Delete]`.
 */
function buildActionsRow(decisionId: string): SlackBlock {
  const buttons: SlackButtonElement[] = [
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
  ];
  return {
    type: "actions",
    block_id: "voting_actions",
    elements: buttons,
  };
}

/**
 * SPEC §8.5 — initial six-block layout for an active decision (post-create).
 *
 * The "Required Voters" field renders one mention per voter; once a vote is
 * cast (§9 step 9), the layout switches to the count form via
 * `buildVotingBlocks`.
 */
function buildInitialBlocks(args: {
  decisionId: string;
  escapedName: string;
  escapedProposal: string;
  criteriaDisplay: string;
  deadlineDisplay: string;
  finalVoters: string[];
  quorum: number;
  R: number;
  creatorId: string;
}): SlackBlock[] {
  const {
    decisionId,
    escapedName,
    escapedProposal,
    criteriaDisplay,
    deadlineDisplay,
    finalVoters,
    quorum,
    R,
    creatorId,
  } = args;

  const voterMentions = finalVoters.map((id) => `<@${id}>`).join(", ");

  const fields: SlackTextObject[] = [
    {
      type: "mrkdwn",
      text: `*Success Criteria:*\n${criteriaDisplay}`,
    },
    {
      type: "mrkdwn",
      text: `*Deadline:*\n${deadlineDisplay}`,
    },
    {
      type: "mrkdwn",
      text: `*Required Voters:*\n${voterMentions}`,
    },
    {
      type: "mrkdwn",
      text: `*Status:*\n🟢 Active — quorum ${quorum} of ${R}`,
    },
  ];

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `🗳️ ${escapedName}`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Proposal:*\n${escapedProposal}` },
    },
    {
      type: "section",
      fields,
    },
    { type: "divider" },
    buildActionsRow(decisionId),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Created by <@${creatorId}> | Vote by ${deadlineDisplay}`,
        },
      ],
    },
  ];
}

/**
 * SPEC §9 step 9 — six-block layout post-vote.
 *
 * Differences vs. `buildInitialBlocks`:
 *   - `Required Voters` → `${R} voters` (label, not mentions).
 *   - `Status` → multi-line with vote count + voter mentions (≤ 30, then
 *     `+N more`).
 */
function buildVotingBlocks(args: {
  decisionId: string;
  escapedName: string;
  escapedProposal: string;
  criteriaDisplay: string;
  deadlineDisplay: string;
  R: number;
  quorum: number;
  mergedVotes: VoteRecord[];
  creatorId: string;
}): SlackBlock[] {
  const {
    decisionId,
    escapedName,
    escapedProposal,
    criteriaDisplay,
    deadlineDisplay,
    R,
    quorum,
    mergedVotes,
    creatorId,
  } = args;

  const voteCount = mergedVotes.length;
  const head = mergedVotes.slice(0, VOTER_MENTION_TRUNCATE_AT);
  const overflow = mergedVotes.length - head.length;
  const voterMentionsList = head.map((v) => `<@${v.user_id}>`).join(", ");
  const truncationSuffix = overflow > 0 ? ` +${overflow} more` : "";
  const statusText =
    `🟢 Active — quorum ${quorum} of ${R}\n*Votes:* ${voteCount}/${R}\nVoted: ${voterMentionsList}${truncationSuffix}`;

  const fields: SlackTextObject[] = [
    {
      type: "mrkdwn",
      text: `*Success Criteria:*\n${criteriaDisplay}`,
    },
    {
      type: "mrkdwn",
      text: `*Deadline:*\n${deadlineDisplay}`,
    },
    {
      type: "mrkdwn",
      text: `*Required Voters:*\n${R} voters`,
    },
    {
      type: "mrkdwn",
      text: `*Status:*\n${statusText}`,
    },
  ];

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `🗳️ ${escapedName}`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Proposal:*\n${escapedProposal}` },
    },
    {
      type: "section",
      fields,
    },
    { type: "divider" },
    buildActionsRow(decisionId),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Created by <@${creatorId}> | Vote by ${deadlineDisplay}`,
        },
      ],
    },
  ];
}

/**
 * SPEC §10 step 5 — three-block layout post-cancel. No buttons.
 */
function buildCancelledBlocks(args: {
  escapedName: string;
  escapedProposal: string;
  cancelledByUserId: string;
  creatorId: string;
  cancelledAtDisplay: string;
}): SlackBlock[] {
  const {
    escapedName,
    escapedProposal,
    cancelledByUserId,
    creatorId,
    cancelledAtDisplay,
  } = args;

  const fields: SlackTextObject[] = [
    { type: "mrkdwn", text: "*Status:*\n🚫 Cancelled" },
    { type: "mrkdwn", text: `*Cancelled by:*\n<@${cancelledByUserId}>` },
  ];

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `🚫 ${escapedName}`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Proposal:*\n${escapedProposal}` },
    },
    { type: "section", fields },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            `Created by <@${creatorId}> | Cancelled at ${cancelledAtDisplay}`,
        },
      ],
    },
  ];
}

/**
 * SPEC §13 step 7 — finalised-decision message layout. No buttons.
 *
 * Surface tied/deadlocked outcomes explicitly via the `Status:` line per
 * SPEC: `outcome.outcome` carries the discriminator (`approved`, `rejected`,
 * `tied`, `deadlocked`).
 */
function buildFinalisedBlocks(args: {
  escapedName: string;
  escapedProposal: string;
  outcome: DecisionResult;
  rEffective: number;
  creatorId: string;
  deadlineDisplay: string;
}): SlackBlock[] {
  const {
    escapedName,
    escapedProposal,
    outcome,
    rEffective,
    creatorId,
    deadlineDisplay,
  } = args;

  const headerEmoji = outcome.passed ? "✅" : "❌";
  const statusLabel = outcome.passed ? "✅ Approved" : statusForFailed(outcome);

  const counts = outcome.voteCounts;
  const totals: SlackTextObject[] = [
    { type: "mrkdwn", text: `*Yes:*\n${counts.yes}` },
    { type: "mrkdwn", text: `*No:*\n${counts.no}` },
    { type: "mrkdwn", text: `*Abstain:*\n${counts.abstain}` },
    { type: "mrkdwn", text: `*Total:*\n${counts.total}` },
    {
      type: "mrkdwn",
      text: `*Required (effective):*\n${rEffective}`,
    },
  ];

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${headerEmoji} ${escapedName}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Proposal:*\n${escapedProposal}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Status:* ${statusLabel}\n*Reason:* ${outcome.reason}`,
      },
    },
    { type: "section", fields: totals },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Created by <@${creatorId}> | Vote by ${deadlineDisplay}`,
        },
      ],
    },
  ];
}

/**
 * Map a non-passing `DecisionResult` to its display label. Tied / deadlocked
 * outcomes are surfaced explicitly (SPEC §13 step 7).
 */
function statusForFailed(outcome: DecisionResult): string {
  switch (outcome.outcome) {
    case "tied":
      return "🟰 Tied";
    case "deadlocked":
      return "🪦 Deadlocked";
    default:
      return "❌ Rejected";
  }
}

/**
 * SPEC §13 step 3 — minimal "no eligible voters" terminal layout.
 */
function buildNoVotersBlocks(args: {
  escapedName: string;
  escapedProposal: string;
  creatorId: string;
  deadlineDisplay: string;
}): SlackBlock[] {
  const { escapedName, escapedProposal, creatorId, deadlineDisplay } = args;
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `❌ ${escapedName}`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Proposal:*\n${escapedProposal}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Status:* ❌ Cancelled\n*Reason:* no eligible voters remain",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Created by <@${creatorId}> | Vote by ${deadlineDisplay}`,
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Datastore query helpers (SPEC §16: client-side filter for EC + mock parity)
// ---------------------------------------------------------------------------

/**
 * Query a datastore filtered by `decision_id`. Slack Datastores accept
 * DynamoDB-style FilterExpressions; we pass one to the production API and
 * additionally filter client-side so the result is correct even if the
 * backend / mock returns an unfiltered page.
 */
async function queryByDecisionId<T extends { decision_id: string }>(
  client: SlackClient,
  datastore: string,
  decisionId: string,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.apps.datastore.query<T>({
      datastore,
      expression: "#did = :did",
      expression_attributes: { "#did": "decision_id" },
      expression_values: { ":did": decisionId },
      ...(cursor ? { cursor } : {}),
    });
    if (!res.ok) {
      log.error({
        event: "datastore_query_failed",
        datastore,
        decision_id: decisionId,
        error: res.error,
      });
      break;
    }
    for (const item of res.items) {
      if (item.decision_id === decisionId) out.push(item);
    }
    cursor = res.response_metadata?.next_cursor;
  } while (cursor);
  return out;
}

/**
 * SPEC §9 step 7 — count vote_history rows for `(decision_id, user_id)` and
 * return the next zero-padded event_seq.
 */
async function nextEventSeq(
  client: SlackClient,
  decisionId: string,
  userId: string,
): Promise<string> {
  const rows = await queryByDecisionId<VoteHistoryRecord>(
    client,
    "vote_history",
    decisionId,
  );
  const existingForUser = rows.filter((r) => r.user_id === userId).length;
  return String(existingForUser + 1).padStart(4, "0");
}

// ---------------------------------------------------------------------------
// Pin probe helper (SPEC §10 step 4 / §13 step 6)
// ---------------------------------------------------------------------------

/**
 * Best-effort: if `messageTs` is currently pinned in `channel`, remove it.
 * Tolerates failure of either call (logs and returns).
 */
async function unpinIfPinned(
  client: SlackClient,
  channel: string,
  messageTs: string,
): Promise<void> {
  let listed;
  try {
    listed = await client.pins.list({ channel });
  } catch (err) {
    log.warn({ event: "pins_list_failed", channel, error: String(err) });
    return;
  }
  if (!listed.ok) {
    log.warn({ event: "pins_list_failed", channel, error: listed.error });
    return;
  }
  const items = listed.items ?? [];
  const isPinned = items.some((it) => it.message?.ts === messageTs);
  if (!isPinned) return;
  try {
    const removed = await client.pins.remove({
      channel,
      timestamp: messageTs,
    });
    if (!removed.ok) {
      log.warn({
        event: "pins_remove_failed",
        channel,
        error: removed.error,
      });
    }
  } catch (err) {
    log.warn({ event: "pins_remove_failed", channel, error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// SPEC §12 — `checkIfShouldFinalize`
// ---------------------------------------------------------------------------

/**
 * Decide whether `finalizeDecision` should run now.
 *
 * The signature accepts the loaded `decision` row PLUS the `mergedVotes` array
 * computed by the vote handler under §16.1 (read-after-write merge). The
 * `client` and `decision_id` parameters are accepted for symmetry with the
 * SPEC §12 helper shape and possible future extensions — this implementation
 * does not require an extra fetch and so returns a pre-resolved promise.
 */
export function checkIfShouldFinalize(
  _client: SlackClient,
  _decisionId: string,
  decision: DecisionRecord,
  mergedVotes: VoteRecord[],
): Promise<boolean> {
  // 1. Already finalised — never re-finalise.
  if (
    typeof decision.finalized_at === "string" &&
    decision.finalized_at.length > 0
  ) {
    return Promise.resolve(false);
  }
  // 2. Past deadline — finalise with whatever we have.
  if (isDeadlinePassed(decision)) return Promise.resolve(true);

  // 3. All required voters voted.
  const voted = mergedVotes.length;
  const R = decision.required_voters_count;
  if (voted >= R) return Promise.resolve(true);

  // 4. Deadlock — outcome cannot change with remaining yes votes.
  const dl = checkDeadlock(
    mergedVotes,
    decision.success_criteria,
    R,
    decision.quorum,
  );
  if (dl.isDeadlocked) return Promise.resolve(true);

  return Promise.resolve(false);
}

// ---------------------------------------------------------------------------
// SPEC §13 — `finalizeDecision`
// ---------------------------------------------------------------------------

/**
 * Finalise a decision: refresh voter activity, compute the outcome, write the
 * idempotency token, update the in-channel message, and post the ADR thread
 * reply. Idempotent: re-runs after `finalized_at` is set are no-ops.
 *
 * Exported so T-302 (`process_active_decisions`) can invoke this as Phase A.
 */
export async function finalizeDecision(
  client: SlackClient,
  decision: DecisionRecord,
  mergedVotes: VoteRecord[],
): Promise<void> {
  // 1. Re-read; bail silently if already finalised or no longer active.
  const fresh = await client.apps.datastore.get<DecisionRecord>({
    datastore: "decisions",
    id: decision.id,
  });
  if (!fresh.ok || !fresh.item) {
    log.warn({
      event: "finalize_reread_failed",
      decision_id: decision.id,
      error: fresh.error,
    });
    return;
  }
  const live = fresh.item;
  if (live.status !== "active") return;
  if (
    typeof live.finalized_at === "string" && live.finalized_at.length > 0
  ) {
    return;
  }

  // 2. Refresh voter activity. For each is_active voter, hit users.info; if
  //    deleted, flip the row. Track who was deactivated for the ADR.
  const voters = await queryByDecisionId<VoterRecord>(
    client,
    "voters",
    live.id,
  );
  const userInfoCache = new Map<string, SlackUserInfo>();
  const deactivatedDuringFinalise: VoterRecord[] = [];

  for (const v of voters) {
    if (!v.is_active) continue;
    let info: SlackUserInfo | undefined;
    try {
      const res = await client.users.info({ user: v.user_id });
      if (res.ok && res.user) info = res.user;
    } catch (err) {
      log.warn({
        event: "users_info_failed",
        user_id: v.user_id,
        error: String(err),
      });
    }
    if (info) userInfoCache.set(v.user_id, info);
    if (info?.deleted === true) {
      const flipped: VoterRecord = { ...v, is_active: false };
      const put = await client.apps.datastore.put<VoterRecord>({
        datastore: "voters",
        item: flipped,
      });
      if (put.ok) {
        v.is_active = false; // local view stays consistent.
        deactivatedDuringFinalise.push(flipped);
        log.info({
          event: "voter_deactivated",
          decision_id: live.id,
          user_id: v.user_id,
        });
      } else {
        log.warn({
          event: "voter_deactivate_put_failed",
          decision_id: live.id,
          user_id: v.user_id,
          error: put.error,
        });
      }
    }
  }

  const activeVoters = voters.filter((v) => v.is_active);
  const rEffective = activeVoters.length;
  const nowIso = new Date().toISOString();

  // SPEC §8.5 escapes (re-used in the finalised layout).
  const escapedName = escapeSlackText(live.name);
  const escapedProposal = escapeSlackText(live.proposal);
  const deadlineDisplay = formatDeadlineHuman(
    live.deadline_resolved,
    live.deadline_tz,
  );

  // 3. No eligible voters — auto-cancel.
  if (rEffective === 0) {
    const cancelled: DecisionRecord = {
      ...live,
      status: "cancelled",
      outcome_reason: "no eligible voters remain",
      finalized_at: nowIso,
      updated_at: nowIso,
    };
    const put = await client.apps.datastore.put<DecisionRecord>({
      datastore: "decisions",
      item: cancelled,
    });
    if (!put.ok) {
      log.error({
        event: "finalize_cancel_put_failed",
        decision_id: live.id,
        error: put.error,
      });
      return;
    }
    await unpinIfPinned(client, live.channel_id, live.message_ts);
    const blocks = buildNoVotersBlocks({
      escapedName,
      escapedProposal,
      creatorId: live.creator_id,
      deadlineDisplay,
    });
    if (live.message_ts) {
      const upd = await client.chat.update({
        channel: live.channel_id,
        ts: live.message_ts,
        text: `Decision cancelled: ${escapedName}`,
        blocks,
      });
      if (!upd.ok) {
        log.warn({
          event: "finalize_cancel_message_update_failed",
          decision_id: live.id,
          error: upd.error,
        });
      }
    }
    log.info({
      event: "decision_finalised",
      decision_id: live.id,
      result: "cancelled_no_voters",
    });
    return;
  }

  // 4. Compute the outcome on the merged votes (audit §A.4 — required count
  //    comes from the row, the *effective* count comes from voter activity).
  const outcome = calculateDecisionOutcome(
    mergedVotes,
    live.success_criteria,
    rEffective,
    live.quorum,
  );

  // 5. Write the idempotency token + status flip + reason in one put.
  const finalStatus: DecisionRecord["status"] = outcome.passed
    ? "approved"
    : "rejected";
  const finalised: DecisionRecord = {
    ...live,
    status: finalStatus,
    outcome_reason: outcome.reason,
    finalized_at: nowIso,
    updated_at: nowIso,
  };
  const flipPut = await client.apps.datastore.put<DecisionRecord>({
    datastore: "decisions",
    item: finalised,
  });
  if (!flipPut.ok) {
    log.error({
      event: "finalize_status_put_failed",
      decision_id: live.id,
      error: flipPut.error,
    });
    return;
  }

  // 6. Pin probe + remove (cosmetic).
  await unpinIfPinned(client, live.channel_id, live.message_ts);

  // 7. Update the in-channel message with the finalised layout.
  const finalBlocks = buildFinalisedBlocks({
    escapedName,
    escapedProposal,
    outcome,
    rEffective,
    creatorId: live.creator_id,
    deadlineDisplay,
  });
  if (live.message_ts) {
    const upd = await client.chat.update({
      channel: live.channel_id,
      ts: live.message_ts,
      text: `Decision finalised: ${escapedName}`,
      blocks: finalBlocks,
    });
    if (!upd.ok) {
      log.warn({
        event: "finalize_message_update_failed",
        decision_id: live.id,
        error: upd.error,
      });
    }
  }

  // 8. Build userMap for the ADR. Prefer cached SlackUserInfo from §13 step 2.
  const userMap = new Map<string, string>();
  for (const [uid, info] of userInfoCache.entries()) {
    const display = info.real_name ?? info.name ?? uid;
    userMap.set(uid, display);
  }

  // 9. Re-read for double finalisation; if a peer wrote a strictly earlier
  //    `finalized_at`, skip the ADR post.
  let skipAdr = false;
  const recheck = await client.apps.datastore.get<DecisionRecord>({
    datastore: "decisions",
    id: live.id,
  });
  if (recheck.ok && recheck.item) {
    const peerToken = recheck.item.finalized_at ?? "";
    if (peerToken && peerToken !== nowIso && peerToken < nowIso) {
      // A peer's earlier-stamped finalisation wins; we skip the ADR.
      skipAdr = true;
      log.info({
        event: "finalize_adr_skipped_peer_won",
        decision_id: live.id,
        peer_finalized_at: peerToken,
        ours: nowIso,
      });
    }
  }

  // 10. Generate + post the ADR thread reply.
  if (!skipAdr) {
    let voteHistory: VoteHistoryRecord[] = [];
    try {
      voteHistory = await queryByDecisionId<VoteHistoryRecord>(
        client,
        "vote_history",
        live.id,
      );
    } catch (err) {
      log.warn({
        event: "vote_history_query_failed",
        decision_id: live.id,
        error: String(err),
      });
    }
    const adrMarkdown = generateADRMarkdown(
      finalised,
      mergedVotes,
      voteHistory,
      outcome,
      userMap,
      deactivatedDuringFinalise,
    );
    const blocks = formatADRForSlack(adrMarkdown);
    const adrPost: ChatPostMessageArgs = {
      channel: live.channel_id,
      thread_ts: live.message_ts,
      text: "ADR Generated - See thread for details",
      blocks,
    };
    const post = await client.chat.postMessage(adrPost);
    if (!post.ok) {
      log.warn({
        event: "adr_post_failed",
        decision_id: live.id,
        error: post.error,
      });
    }
  }

  log.info({
    event: "decision_finalised",
    decision_id: live.id,
    result: finalStatus,
    reason: outcome.reason,
    r_effective: rEffective,
  });
}

// ---------------------------------------------------------------------------
// Block-action handler types (private, for SDK bridging)
// ---------------------------------------------------------------------------

/**
 * Handler context shape used by the three `addBlockActionsHandler` chains.
 *
 * The SDK's actual `client` parameter is broader than our hand-written
 * `SlackClient`; an `as unknown as SlackClient` cast at handler entry bridges
 * the gap (per task brief).
 */
interface HandlerCtx {
  action: { action_id: string; value?: string; [k: string]: unknown };
  body: {
    user: { id: string };
    container: { channel_id: string; message_ts: string };
    [k: string]: unknown;
  };
  client: unknown;
}

// ---------------------------------------------------------------------------
// SPEC §9 — Vote handler
// ---------------------------------------------------------------------------

async function voteHandler(ctx: HandlerCtx): Promise<void> {
  const client = ctx.client as SlackClient;
  const decisionId = typeof ctx.action.value === "string"
    ? ctx.action.value
    : "";
  const voteType = ctx.action.action_id.replace(/^vote_/, "") as VoteType;
  const userId = ctx.body.user.id;
  const channelId = ctx.body.container.channel_id;
  const messageTs = ctx.body.container.message_ts;

  // 1. Log vote_clicked.
  log.info({
    event: "vote_clicked",
    decision_id: decisionId,
    actor_id: userId,
    vote_type: voteType,
  });

  // 2. Load decision.
  const decisionGet = await client.apps.datastore.get<DecisionRecord>({
    datastore: "decisions",
    id: decisionId,
  });
  if (!decisionGet.ok || !decisionGet.item) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "Decision not found.",
    });
    return;
  }
  const decision = decisionGet.item;

  // 3. Status guard.
  if (decision.status !== "active") {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `This decision is no longer active (${decision.status}).`,
    });
    return;
  }

  // 4. Eligibility guard.
  const voterId = `${decisionId}_${userId}`;
  const voterGet = await client.apps.datastore.get<VoterRecord>({
    datastore: "voters",
    id: voterId,
  });
  if (!voterGet.ok || !voterGet.item || voterGet.item.is_active === false) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "You are not listed as an eligible voter for this decision.",
    });
    return;
  }

  // 5. Past-deadline guard. Triggers finalisation WITHOUT recording the vote.
  if (isDeadlinePassed(decision)) {
    const deadlineDisplay = formatDeadlineHuman(
      decision.deadline_resolved,
      decision.deadline_tz,
    );
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `⏰ Voting closed at ${deadlineDisplay}. Finalising now.`,
    });
    await finalizeDecision(client, decision, []);
    return;
  }

  const nowIso = new Date().toISOString();

  // 6. Read previous vote (if any) so we can attach `previous_vote_type`.
  const previousGet = await client.apps.datastore.get<VoteRecord>({
    datastore: "votes",
    id: voterId,
  });
  const previousVoteType = previousGet.ok
    ? previousGet.item?.vote_type
    : undefined;

  // Persist the new vote (overwrites in place per §5.2).
  const newVote: VoteRecord = {
    id: voterId,
    decision_id: decisionId,
    user_id: userId,
    vote_type: voteType,
    voted_at: nowIso,
  };
  const putVote = await client.apps.datastore.put<VoteRecord>({
    datastore: "votes",
    item: newVote,
  });
  if (!putVote.ok) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text:
        `❌ Failed to record your vote: ${putVote.error}. Please try again.`,
    });
    return;
  }

  // 7. Append vote_history (best-effort; failures don't block the vote).
  try {
    const eventSeq = await nextEventSeq(client, decisionId, userId);
    const eventKind: VoteHistoryRecord["event_kind"] = previousVoteType
      ? "changed"
      : "cast";
    const historyRow: VoteHistoryRecord = {
      id: `${decisionId}_${userId}_${eventSeq}`,
      decision_id: decisionId,
      user_id: userId,
      vote_type: voteType,
      ...(previousVoteType ? { previous_vote_type: previousVoteType } : {}),
      event_kind: eventKind,
      voted_at: nowIso,
    };
    const histPut = await client.apps.datastore.put<VoteHistoryRecord>({
      datastore: "vote_history",
      item: historyRow,
    });
    if (!histPut.ok) {
      log.warn({
        event: "vote_history_put_failed",
        decision_id: decisionId,
        actor_id: userId,
        error: histPut.error,
      });
    }
  } catch (err) {
    log.warn({
      event: "vote_history_put_threw",
      decision_id: decisionId,
      actor_id: userId,
      error: String(err),
    });
  }

  // 8. Eventually-consistent merge per SPEC §16.1.
  const queriedVotes = await queryByDecisionId<VoteRecord>(
    client,
    "votes",
    decisionId,
  );
  const mergedVotes: VoteRecord[] = [
    ...queriedVotes.filter((v) => v.user_id !== userId),
    newVote,
  ];

  // Log the state transition.
  log.info({
    event: previousVoteType ? "vote_changed" : "vote_cast",
    decision_id: decisionId,
    actor_id: userId,
    vote_type: voteType,
    previous_vote_type: previousVoteType,
    voted_at: nowIso,
  });

  // 9. Update the message in place with the post-vote layout.
  const escapedName = escapeSlackText(decision.name);
  const escapedProposal = escapeSlackText(decision.proposal);
  const criteriaDisplay = formatCriteria(decision.success_criteria);
  const deadlineDisplay = formatDeadlineHuman(
    decision.deadline_resolved,
    decision.deadline_tz,
  );
  const blocks = buildVotingBlocks({
    decisionId,
    escapedName,
    escapedProposal,
    criteriaDisplay,
    deadlineDisplay,
    R: decision.required_voters_count,
    quorum: decision.quorum,
    mergedVotes,
    creatorId: decision.creator_id,
  });
  const upd = await client.chat.update({
    channel: channelId,
    ts: messageTs,
    text: `New Decision: ${escapedName}`,
    blocks,
  });
  if (!upd.ok) {
    log.warn({
      event: "vote_message_update_failed",
      decision_id: decisionId,
      error: upd.error,
    });
  }

  // 10. Ephemeral confirm to the voter.
  const emoji = voteType === "yes" ? "✅" : voteType === "no" ? "❌" : "⚪";
  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text:
      `${emoji} Your vote (${voteType.toUpperCase()}) has been recorded for "${escapedName}"`,
  });

  // 11. Maybe finalise.
  if (await checkIfShouldFinalize(client, decisionId, decision, mergedVotes)) {
    await finalizeDecision(client, decision, mergedVotes);
  }
}

// ---------------------------------------------------------------------------
// SPEC §10 — Cancel handler
// ---------------------------------------------------------------------------

async function cancelHandler(ctx: HandlerCtx): Promise<void> {
  const client = ctx.client as SlackClient;
  const decisionId = typeof ctx.action.value === "string"
    ? ctx.action.value
    : "";
  const userId = ctx.body.user.id;
  const channelId = ctx.body.container.channel_id;
  const messageTs = ctx.body.container.message_ts;

  log.info({
    event: "decision_cancel_clicked",
    decision_id: decisionId,
    actor_id: userId,
  });

  // Load decision.
  const got = await client.apps.datastore.get<DecisionRecord>({
    datastore: "decisions",
    id: decisionId,
  });
  if (!got.ok || !got.item) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "Decision not found.",
    });
    return;
  }
  const decision = got.item;

  // Status guard.
  if (decision.status !== "active") {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `This decision is no longer active (${decision.status}).`,
    });
    return;
  }

  // Re-read & predicate per SPEC §10 step 3.
  const recheck = await reReadAndCheck<DecisionRecord>(
    client,
    "decisions",
    decisionId,
    (d) => d.status === "active",
  );
  if (!recheck.ok) {
    if (recheck.reason === "predicate_failed") {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "This decision was just finalised — cannot cancel.",
      });
    } else if (recheck.reason === "not_found") {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "Decision not found.",
      });
    } else {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "Failed to re-read decision before cancelling — please retry.",
      });
    }
    return;
  }

  const nowIso = new Date().toISOString();
  const cancelled: DecisionRecord = {
    ...recheck.item,
    status: "cancelled",
    outcome_reason: `cancelled by <@${userId}>`,
    updated_at: nowIso,
  };
  const put = await client.apps.datastore.put<DecisionRecord>({
    datastore: "decisions",
    item: cancelled,
  });
  if (!put.ok) {
    log.error({
      event: "decision_cancel_put_failed",
      decision_id: decisionId,
      error: put.error,
    });
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `Failed to cancel: ${put.error ?? "unknown error"}.`,
    });
    return;
  }

  // Pin probe.
  await unpinIfPinned(client, channelId, messageTs);

  // Replace the message.
  const escapedName = escapeSlackText(decision.name);
  const escapedProposal = escapeSlackText(decision.proposal);
  const cancelledAtDisplay = formatDeadlineHuman(nowIso, decision.deadline_tz);
  const blocks = buildCancelledBlocks({
    escapedName,
    escapedProposal,
    cancelledByUserId: userId,
    creatorId: decision.creator_id,
    cancelledAtDisplay,
  });
  const upd = await client.chat.update({
    channel: channelId,
    ts: messageTs,
    text: `Decision cancelled: ${escapedName}`,
    blocks,
  });
  if (!upd.ok) {
    log.warn({
      event: "cancel_message_update_failed",
      decision_id: decisionId,
      error: upd.error,
    });
  }

  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text: `🚫 Decision "${escapedName}" has been cancelled.`,
  });

  log.info({
    event: "decision_cancelled",
    decision_id: decisionId,
    actor_id: userId,
  });
}

// ---------------------------------------------------------------------------
// SPEC §11 — Delete handler
// ---------------------------------------------------------------------------

async function deleteHandler(ctx: HandlerCtx): Promise<void> {
  const client = ctx.client as SlackClient;
  const decisionId = typeof ctx.action.value === "string"
    ? ctx.action.value
    : "";
  const userId = ctx.body.user.id;
  const channelId = ctx.body.container.channel_id;
  const messageTs = ctx.body.container.message_ts;

  log.info({
    event: "decision_delete_clicked",
    decision_id: decisionId,
    actor_id: userId,
  });

  // Load decision.
  const got = await client.apps.datastore.get<DecisionRecord>({
    datastore: "decisions",
    id: decisionId,
  });
  if (!got.ok || !got.item) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "Decision not found.",
    });
    return;
  }
  const decision = got.item;

  // Authorisation — creator only.
  if (decision.creator_id !== userId) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "⛔ Only the creator of this decision can delete it.",
    });
    return;
  }

  // Cascade-delete in the order specified by §11 step 3.
  const cascadeDatastores: Array<
    "vote_history" | "votes" | "voters"
  > = ["vote_history", "votes", "voters"];
  for (const datastore of cascadeDatastores) {
    const rows = await queryByDecisionId<{ id: string; decision_id: string }>(
      client,
      datastore,
      decisionId,
    );
    for (const row of rows) {
      const del = await client.apps.datastore.delete({
        datastore,
        id: row.id,
      });
      if (!del.ok) {
        log.warn({
          event: "cascade_delete_failed",
          datastore,
          row_id: row.id,
          error: del.error,
        });
      }
    }
  }
  // Finally delete the decision row itself.
  const decisionDel = await client.apps.datastore.delete({
    datastore: "decisions",
    id: decisionId,
  });
  if (!decisionDel.ok) {
    log.warn({
      event: "cascade_delete_decision_failed",
      decision_id: decisionId,
      error: decisionDel.error,
    });
  }

  // Pin probe.
  await unpinIfPinned(client, channelId, messageTs);

  // Best-effort message removal; fall back to chat.update if too old.
  const escapedName = escapeSlackText(decision.name);
  let chatDel;
  try {
    chatDel = await client.chat.delete({
      channel: channelId,
      ts: messageTs,
    });
  } catch (err) {
    chatDel = { ok: false, error: String(err) };
  }
  if (!chatDel.ok) {
    log.warn({
      event: "chat_delete_failed_falling_back",
      decision_id: decisionId,
      error: chatDel.error,
    });
    const upd = await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `_This decision ("${escapedName}") was deleted by <@${userId}>._`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `_This decision ("${escapedName}") was deleted by <@${userId}>._`,
          },
        },
      ],
    });
    if (!upd.ok) {
      log.warn({
        event: "delete_fallback_update_failed",
        decision_id: decisionId,
        error: upd.error,
      });
    }
  }

  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text: `🗑️ Decision "${escapedName}" has been deleted.`,
  });

  log.info({
    event: "decision_deleted",
    decision_id: decisionId,
    actor_id: userId,
  });
}

// ---------------------------------------------------------------------------
// Function entry — initial execution + handler chain
// ---------------------------------------------------------------------------

/**
 * Default export: the SlackFunction-wrapped initial-execution handler with
 * three `addBlockActionsHandler` chains. Returns `{ completed: false }` so
 * the workflow run stays alive for button clicks (SPEC §8.7).
 *
 * The handler parameters (`inputs`, `client`) are inferred by the SDK from
 * `CreateDecisionFunction`. The SDK's `client` is broader than our
 * hand-written `SlackClient`; an `as unknown as SlackClient` cast at entry
 * bridges the typing without resorting to `any` (per task brief).
 */
export default SlackFunction(
  CreateDecisionFunction,
  async ({ inputs, client: sdkClient }) => {
    const client = sdkClient as unknown as SlackClient;

    // ----- §8.1 Pre-flight validation ---------------------------------------

    // 1. Channel type guard. DM channel IDs start with `D`.
    if (
      !inputs.channel_id ||
      (!inputs.channel_id.startsWith("C") &&
        !inputs.channel_id.startsWith("G"))
    ) {
      return { error: "ConsensusBot must be used in a channel, not a DM." };
    }

    // 2. Voter input check.
    const parsedVoterIds = (inputs.required_voters ?? []).filter((v) =>
      typeof v === "string" && v.length > 0
    );
    const usergroupRaw = inputs.required_usergroups ?? "";
    const usergroupsBlank = usergroupRaw.trim().length === 0;
    if (
      parsedVoterIds.length === 0 &&
      inputs.include_channel_members !== true &&
      usergroupsBlank
    ) {
      return {
        error:
          "No voters selected. Please pick at least one voter, usergroup, or check 'Include all channel members'.",
      };
    }

    // 3. Broadcast handles. parseUsergroupInput tolerates an empty string.
    const usergroupParsed = parseUsergroupInput(usergroupRaw);
    if (usergroupParsed.broadcasts.length > 0) {
      return {
        error:
          "Broadcast handles (@here, @channel, @everyone) are not supported as voter sources.",
      };
    }

    // 4. Length guards.
    if ((inputs.decision_name ?? "").length > MAX_DECISION_NAME_LENGTH) {
      return { error: "Decision name too long (max 200 characters)." };
    }
    if ((inputs.proposal ?? "").length > MAX_PROPOSAL_LENGTH) {
      return { error: "Proposal too long (max 2500 characters)." };
    }

    // 5. Resolve the deadline (must run BEFORE the past-deadline check).
    const tz = await getWorkspaceTz(client);
    const deadlineRaw =
      typeof inputs.deadline === "string" && inputs.deadline.length > 0
        ? inputs.deadline
        : getDefaultDeadline(tz);
    let deadlineResolved: { iso: string; tz: string; humanDisplay: string };
    try {
      deadlineResolved = resolveDeadline(deadlineRaw, tz);
    } catch (err) {
      log.error({
        event: "deadline_resolve_failed",
        deadline: deadlineRaw,
        tz,
        error: String(err),
      });
      return { error: `Failed to resolve deadline: ${String(err)}` };
    }
    if (new Date(deadlineResolved.iso) < new Date()) {
      return { error: "Deadline must be in the future." };
    }

    // ----- §8.2 Voter resolution -------------------------------------------

    const userInfoCache = new Map<string, SlackUserInfo>();
    const allVoters = new Set<string>();

    // 1. Individual voters — bot filter applied (PLAN §2 invariant 14).
    for (const id of parsedVoterIds) {
      if (await isHumanUser(client, id, userInfoCache)) {
        allVoters.add(id);
      }
    }

    // 2. Usergroups — resolve handles → ids, expand each to members.
    const allUsergroupIds: string[] = [...usergroupParsed.ids];
    if (usergroupParsed.handles.length > 0) {
      const summaries = await fetchAllUsergroups(client);
      for (const handle of usergroupParsed.handles) {
        const match = summaries.find((s) => s.handle === handle);
        if (match) {
          allUsergroupIds.push(match.id);
        } else {
          log.warn({
            event: "usergroup_handle_unresolved",
            handle,
          });
        }
      }
    }
    for (const groupId of allUsergroupIds) {
      const members = await fetchUsergroupMembers(client, groupId);
      for (const memberId of members) {
        if (await isHumanUser(client, memberId, userInfoCache)) {
          allVoters.add(memberId);
        }
      }
    }

    // 3. Channel members — only if explicitly opted in.
    if (inputs.include_channel_members === true) {
      const rawChannelMembers = await fetchAllChannelMembers(
        client,
        inputs.channel_id,
      );
      if (rawChannelMembers.length > MAX_CHANNEL_VOTERS) {
        return {
          error:
            `Channel has too many members (${rawChannelMembers.length}). Maximum allowed is ${MAX_CHANNEL_VOTERS} voters. Please use individual user selection or user groups instead.`,
        };
      }
      for (const memberId of rawChannelMembers) {
        if (await isHumanUser(client, memberId, userInfoCache)) {
          allVoters.add(memberId);
        }
      }
    }

    // 5. Final validation.
    if (allVoters.size === 0) {
      return {
        error:
          "No eligible voters found after expansion. All candidates were bots or deactivated.",
      };
    }

    const finalVoters = Array.from(allVoters);
    const R = finalVoters.length;

    // ----- §8.3 Deadline + quorum ------------------------------------------

    const criterion = inputs.success_criteria as SuccessCriteria | string;
    let quorum: number;
    switch (criterion) {
      case "simple_majority":
        quorum = Math.ceil(R / 2);
        break;
      case "super_majority":
        quorum = Math.ceil((R * 2) / 3);
        break;
      case "unanimous":
        quorum = R;
        break;
      default:
        return {
          error: `Invalid success_criteria: ${
            String(criterion)
          }. Expected one of simple_majority, super_majority, unanimous.`,
        };
    }

    if (typeof inputs.quorum_override === "number") {
      const ov = inputs.quorum_override;
      if (ov > 0) {
        if (!Number.isInteger(ov) || ov > R) {
          return {
            error: `quorum_override must be between 1 and ${R} (inclusive).`,
          };
        }
        quorum = ov;
      }
    }

    // ----- §8.4 Persist + post (datastore-write-before-message-post) --------

    const decisionId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const decisionRow: DecisionRecord = {
      id: decisionId,
      name: inputs.decision_name,
      proposal: inputs.proposal,
      success_criteria: criterion as SuccessCriteria,
      quorum,
      required_voters_count: R,
      deadline: deadlineRaw,
      deadline_resolved: deadlineResolved.iso,
      deadline_tz: deadlineResolved.tz,
      channel_id: inputs.channel_id,
      creator_id: inputs.creator_id,
      message_ts: "",
      status: "active",
      finalized_at: "",
      created_at: nowIso,
      updated_at: nowIso,
    };

    // 3. Put the decision row.
    const decisionPut = await client.apps.datastore.put<DecisionRecord>({
      datastore: "decisions",
      item: decisionRow,
    });
    if (!decisionPut.ok) {
      log.error({
        event: "decision_put_failed",
        decision_id: decisionId,
        error: decisionPut.error,
      });
      return { error: `Failed to create decision: ${decisionPut.error}` };
    }

    // 4. Voter rows. Track what we wrote so we can roll back on any failure.
    const writtenVoterIds: string[] = [];
    for (const userId of finalVoters) {
      const voterRowId = `${decisionId}_${userId}`;
      const voterRow: VoterRecord = {
        id: voterRowId,
        decision_id: decisionId,
        user_id: userId,
        is_active: true,
        created_at: nowIso,
      };
      const voterPut = await client.apps.datastore.put<VoterRecord>({
        datastore: "voters",
        item: voterRow,
      });
      if (!voterPut.ok) {
        log.error({
          event: "voter_put_failed",
          decision_id: decisionId,
          user_id: userId,
          error: voterPut.error,
        });
        // Roll back: delete every voter row written so far + the decision.
        for (const writtenId of writtenVoterIds) {
          await client.apps.datastore.delete({
            datastore: "voters",
            id: writtenId,
          });
        }
        await client.apps.datastore.delete({
          datastore: "decisions",
          id: decisionId,
        });
        return {
          error: `Failed to register voter ${userId}. Decision aborted.`,
        };
      }
      writtenVoterIds.push(voterRowId);
    }

    // 5. Post the message.
    const escapedName = escapeSlackText(decisionRow.name);
    const escapedProposal = escapeSlackText(decisionRow.proposal);
    const criteriaDisplay = formatCriteria(criterion);
    const deadlineDisplay = deadlineResolved.humanDisplay;
    const blocks = buildInitialBlocks({
      decisionId,
      escapedName,
      escapedProposal,
      criteriaDisplay,
      deadlineDisplay,
      finalVoters,
      quorum,
      R,
      creatorId: inputs.creator_id,
    });
    const post = await client.chat.postMessage({
      channel: inputs.channel_id,
      text: `New Decision: ${escapedName}`,
      blocks,
    });
    if (!post.ok || !post.ts) {
      log.error({
        event: "decision_message_post_failed",
        decision_id: decisionId,
        error: post.error,
      });
      // Roll back every row written above.
      for (const writtenId of writtenVoterIds) {
        await client.apps.datastore.delete({
          datastore: "voters",
          id: writtenId,
        });
      }
      await client.apps.datastore.delete({
        datastore: "decisions",
        id: decisionId,
      });
      return {
        error: `Failed to post decision message: ${post.error ?? "unknown"}.`,
      };
    }
    const messageTs = post.ts;

    // 6. Update the decision row with the real `message_ts`. Failure here is
    //    logged but NOT rolled back per SPEC §8.4 step 6 — the message is
    //    live, the row is recoverable manually.
    const updatedRow: DecisionRecord = {
      ...decisionRow,
      message_ts: messageTs,
      updated_at: new Date().toISOString(),
    };
    const tsPut = await client.apps.datastore.put<DecisionRecord>({
      datastore: "decisions",
      item: updatedRow,
    });
    if (!tsPut.ok) {
      log.error({
        event: "decision_message_ts_put_failed",
        decision_id: decisionId,
        message_ts: messageTs,
        error: tsPut.error,
      });
    }

    // 7. Pin (cosmetic).
    try {
      const pin = await client.pins.add({
        channel: inputs.channel_id,
        timestamp: messageTs,
      });
      if (!pin.ok) {
        log.warn({
          event: "pins_add_failed",
          decision_id: decisionId,
          error: pin.error,
        });
      }
    } catch (err) {
      log.warn({
        event: "pins_add_threw",
        decision_id: decisionId,
        error: String(err),
      });
    }

    log.info({
      event: "decision_created",
      decision_id: decisionId,
      actor_id: inputs.creator_id,
      channel_id: inputs.channel_id,
      voter_count: R,
      success_criteria: criterion,
      quorum,
      deadline_resolved: deadlineResolved.iso,
      deadline_tz: deadlineResolved.tz,
    });

    // §8.7 — keep the workflow alive for block-action handlers.
    return { completed: false } as const;
  },
)
  // SPEC §8.6 — three handler chains, in this exact order. The SDK passes a
  // wider `ctx` than our `HandlerCtx`; we let the SDK infer and cast through
  // `unknown` at the bridge.
  .addBlockActionsHandler(
    ["vote_yes", "vote_no", "vote_abstain"],
    async (ctx) => {
      await voteHandler(ctx as unknown as HandlerCtx);
    },
  )
  .addBlockActionsHandler(["decision_cancel"], async (ctx) => {
    await cancelHandler(ctx as unknown as HandlerCtx);
  })
  .addBlockActionsHandler(["decision_delete"], async (ctx) => {
    await deleteHandler(ctx as unknown as HandlerCtx);
  });
