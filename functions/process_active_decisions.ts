// ConsensusBot v2.0 — Process Active Decisions function.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §18    (Process Active Decisions)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §13    (finalizeDecision semantics)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §16.3  (`finalized_at` idempotency)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md     T-302
//
// Runs on the weekday 09:00 UTC tick (§6.2). Two phases, in order:
//
//   Phase A (§18.1) — Finalise every `active` decision whose deadline has
//                     passed. Uses the §13 finaliser and the `finalized_at`
//                     idempotency token (§16.3) to guarantee at-most-once ADR
//                     posting under contention with a vote handler.
//
//   Phase B (§18.2) — For each remaining active decision, refresh voter
//                     activity (`users.info(deleted)` flips `is_active=false`),
//                     compute the missing-voter set-difference, and DM each
//                     non-voter via `chat.postMessage(channel: userId, …)`
//                     using the `im:write` scope.
//
// Soft cap: 1000 active decisions per tick (§18.3). Pagination via
// `response_metadata.next_cursor` on every datastore query.
//
// IMPORTANT (T-302 vs T-301 timing): T-301 is the canonical implementer of
// `finalizeDecision`. At the time this file was authored T-301 had not landed,
// so we cannot import `finalizeDecision` from `./create_decision.ts` without
// `deno check` failing. We RE-IMPLEMENT finalisation locally (full §13
// fidelity) inside this file, marked clearly below. When T-301 lands and
// exports `finalizeDecision`, a follow-up MAY collapse the local copy to a
// re-export; the SPEC §18 prompt explicitly admits "imported from
// `functions/create_decision.ts` OR re-implemented locally if cleaner".
//
// Single-file ownership: this file does not modify any other file in the
// repo (T-302 owner discipline).

import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import type {
  DecisionRecord,
  VoteHistoryRecord,
  VoteRecord,
  VoterRecord,
} from "../types/decision_types.ts";
import type {
  ChatPostMessageArgs,
  ChatResponse,
  DatastoreQueryResponse,
  SlackBlock,
  SlackClient,
} from "../types/slack_types.ts";
import { formatDeadlineHuman, isDeadlinePassed } from "../utils/date_utils.ts";
import { escapeSlackText, neutraliseBackticks } from "../utils/escape_slack.ts";
import { calculateDecisionOutcome } from "../utils/decision_logic.ts";
import {
  formatADRForSlack,
  generateADRMarkdown,
} from "../utils/adr_generator.ts";
import { log } from "../utils/log.ts";

// ---------------------------------------------------------------------------
// Function definition (§18 + §6.2)
// ---------------------------------------------------------------------------

/**
 * `callback_id: "process_active_decisions_function"`. No inputs.
 * Outputs a small observability shape so `slack activity` can graph it
 * (§18.5).
 */
export const ProcessActiveDecisionsFunction = DefineFunction({
  callback_id: "process_active_decisions_function",
  title: "Process Active Decisions",
  description:
    "Finalise past-deadline decisions and DM reminders to non-voters on still-active decisions.",
  source_file: "functions/process_active_decisions.ts",
  input_parameters: {
    properties: {},
    required: [],
  },
  output_parameters: {
    properties: {
      reminders_sent: { type: Schema.types.integer },
      decisions_finalised: { type: Schema.types.integer },
    },
    required: ["reminders_sent", "decisions_finalised"],
  },
});

// ---------------------------------------------------------------------------
// Constants (§18.3)
// ---------------------------------------------------------------------------

/**
 * §18.3 — Process at most this many active decisions per tick. Above the
 * cap we log a warning and slice. The cap exists to keep the function inside
 * the Slack ROSI execution-time envelope; bigger workspaces should bump it
 * via SPEC amendment.
 */
const MAX_ACTIVE_DECISIONS_PER_TICK = 1000;

// ---------------------------------------------------------------------------
// Function body
// ---------------------------------------------------------------------------

export default SlackFunction(
  ProcessActiveDecisionsFunction,
  async ({ client }) => {
    // The SDK's client is opaquely typed; narrow once so the rest of the file
    // consumes the same hand-written `SlackClient` surface as the unit tests.
    const slack = client as unknown as SlackClient;

    let remindersSent = 0;
    let decisionsFinalised = 0;

    // -------- Phase A — finalise past-deadline decisions (§18.1) ----------

    log.info({ event: "phase_a_start" });

    // Drain all `active` decisions, paginated. We then split them into
    // past-deadline (Phase A) and still-active (Phase B) inside the same
    // pass to avoid a second top-level query.
    const activeDecisionsRaw = await queryActiveDecisions(slack);

    let activeDecisions = activeDecisionsRaw;
    if (activeDecisions.length > MAX_ACTIVE_DECISIONS_PER_TICK) {
      log.warn({
        event: "decisions_cap_exceeded",
        count: activeDecisions.length,
        cap: MAX_ACTIVE_DECISIONS_PER_TICK,
      });
      activeDecisions = activeDecisions.slice(
        0,
        MAX_ACTIVE_DECISIONS_PER_TICK,
      );
    }

    // §18.1 — `finalized_at` may be set by a racing vote handler; the SPEC
    // permits filtering that condition in code rather than in the expression.
    const candidatesForFinalisation: DecisionRecord[] = [];
    const stillActive: DecisionRecord[] = [];
    for (const decision of activeDecisions) {
      if (
        typeof decision.finalized_at === "string" &&
        decision.finalized_at.length > 0
      ) {
        // A finaliser already claimed this row; skip both phases.
        continue;
      }
      if (isDeadlinePassed(decision)) {
        candidatesForFinalisation.push(decision);
      } else {
        stillActive.push(decision);
      }
    }

    for (const decision of candidatesForFinalisation) {
      try {
        const votes = await queryVotesForDecision(slack, decision.id);
        await finalizeDecision(slack, decision, votes);
        decisionsFinalised += 1;
        log.info({
          event: "decision_finalised_by_tick",
          decision_id: decision.id,
        });
      } catch (err) {
        // §18.1 — never break the outer loop on a single failure.
        log.error({
          event: "phase_a_decision_failed",
          decision_id: decision.id,
          error: stringifyError(err),
        });
      }
    }

    log.info({
      event: "phase_a_complete",
      decisions_finalised: decisionsFinalised,
      candidates: candidatesForFinalisation.length,
    });

    // -------- Phase B — reminders (§18.2) ---------------------------------

    log.info({ event: "phase_b_start", still_active: stillActive.length });

    for (const decision of stillActive) {
      try {
        // 1. Voters list for this decision.
        const voters = await queryVotersForDecision(slack, decision.id);

        // 2. Refresh voter activity. For each `is_active=true` voter, call
        //    `users.info`; on `deleted: true`, flip the row to
        //    `is_active=false` and exclude from the missing set.
        const refreshedVoters: VoterRecord[] = [];
        for (const voter of voters) {
          if (!voter.is_active) {
            refreshedVoters.push(voter);
            continue;
          }
          let stillActiveUser = true;
          try {
            const info = await slack.users.info({ user: voter.user_id });
            if (info.ok && info.user?.deleted === true) {
              stillActiveUser = false;
            }
          } catch (err) {
            // Tolerate API failure: keep the voter as active and proceed.
            log.warn({
              event: "users_info_failed_phase_b",
              decision_id: decision.id,
              user_id: voter.user_id,
              error: stringifyError(err),
            });
          }

          if (!stillActiveUser) {
            const updated: VoterRecord = { ...voter, is_active: false };
            try {
              await slack.apps.datastore.put<VoterRecord>({
                datastore: "voters",
                item: updated,
              });
              log.info({
                event: "voter_deactivated",
                decision_id: decision.id,
                user_id: voter.user_id,
              });
            } catch (err) {
              log.error({
                event: "voter_deactivate_put_failed",
                decision_id: decision.id,
                user_id: voter.user_id,
                error: stringifyError(err),
              });
            }
            refreshedVoters.push(updated);
          } else {
            refreshedVoters.push(voter);
          }
        }

        // 3. Votes recorded for this decision.
        const votes = await queryVotesForDecision(slack, decision.id);

        // 4. Set-difference: active voters not yet voted (§18.2).
        const votedUserIds = new Set(votes.map((v) => v.user_id));
        const missingVoters = refreshedVoters.filter(
          (v) => v.is_active && !votedUserIds.has(v.user_id),
        );

        // 5. DM each missing voter.
        for (const voter of missingVoters) {
          try {
            const ok = await sendReminderDM(slack, voter.user_id, decision);
            if (ok) {
              remindersSent += 1;
              log.info({
                event: "reminder_sent",
                decision_id: decision.id,
                user_id: voter.user_id,
              });
            }
          } catch (err) {
            log.error({
              event: "reminder_send_failed",
              decision_id: decision.id,
              user_id: voter.user_id,
              error: stringifyError(err),
            });
          }
        }
      } catch (err) {
        // Never break the outer loop on a single decision's failure.
        log.error({
          event: "phase_b_decision_failed",
          decision_id: decision.id,
          error: stringifyError(err),
        });
      }
    }

    log.info({
      event: "phase_b_complete",
      reminders_sent: remindersSent,
      decisions_processed: stillActive.length,
    });

    // §18.5 — return outputs and complete the run. There are no chained
    // handlers (no buttons), so we return a normal completion (NOT
    // `{ completed: false }`).
    return {
      outputs: {
        reminders_sent: remindersSent,
        decisions_finalised: decisionsFinalised,
      },
    };
  },
);

// ---------------------------------------------------------------------------
// Datastore drainers (§18.3 pagination)
// ---------------------------------------------------------------------------

/**
 * Drain every `decisions` row with `status === "active"`, paginated via
 * `response_metadata.next_cursor`. The `expression`/`expression_attributes`/
 * `expression_values` triple is shaped exactly per SPEC §18.1.
 */
async function queryActiveDecisions(
  client: SlackClient,
): Promise<DecisionRecord[]> {
  const out: DecisionRecord[] = [];
  let cursor: string | undefined;
  // Cap iterations defensively. The soft cap is 1000 decisions; pages of
  // 100 yield at most 10 round-trips, plus a generous buffer for
  // headroom on bigger workspaces.
  const MAX_PAGES = 50;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await client.apps.datastore.query<DecisionRecord>({
      datastore: "decisions",
      expression: "#status = :status",
      expression_attributes: { "#status": "status" },
      expression_values: { ":status": "active" },
      cursor,
    });
    if (!res.ok) {
      log.error({
        event: "active_decisions_query_failed",
        error: res.error ?? "unknown",
      });
      return out;
    }
    out.push(...res.items);
    cursor = res.response_metadata?.next_cursor;
    if (!cursor || cursor.length === 0) return out;
  }
  log.warn({ event: "active_decisions_query_max_pages", pages: MAX_PAGES });
  return out;
}

/**
 * Drain every `voters` row for a single decision, paginated. Schema-keyed
 * on `decision_id`.
 */
async function queryVotersForDecision(
  client: SlackClient,
  decisionId: string,
): Promise<VoterRecord[]> {
  return await drainQuery<VoterRecord>(client, {
    datastore: "voters",
    expression: "#decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": decisionId },
  });
}

/**
 * Drain every `votes` row for a single decision, paginated.
 */
async function queryVotesForDecision(
  client: SlackClient,
  decisionId: string,
): Promise<VoteRecord[]> {
  return await drainQuery<VoteRecord>(client, {
    datastore: "votes",
    expression: "#decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": decisionId },
  });
}

/**
 * Drain every `vote_history` row for a decision (used inside finalisation
 * to populate the ADR's "Vote History" section).
 */
async function queryVoteHistoryForDecision(
  client: SlackClient,
  decisionId: string,
): Promise<VoteHistoryRecord[]> {
  return await drainQuery<VoteHistoryRecord>(client, {
    datastore: "vote_history",
    expression: "#decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": decisionId },
  });
}

/**
 * Generic paginated drain. Stops on `next_cursor` empty / absent OR on a
 * failed response (logged and surfaces whatever has been accumulated).
 */
async function drainQuery<T>(
  client: SlackClient,
  args: {
    datastore: string;
    expression?: string;
    expression_attributes?: Record<string, string>;
    expression_values?: Record<string, unknown>;
  },
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  const MAX_PAGES = 100;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: DatastoreQueryResponse<T> = await client.apps.datastore.query<T>(
      { ...args, cursor },
    );
    if (!res.ok) {
      log.error({
        event: "datastore_query_failed",
        datastore: args.datastore,
        error: res.error ?? "unknown",
      });
      return out;
    }
    out.push(...res.items);
    cursor = res.response_metadata?.next_cursor;
    if (!cursor || cursor.length === 0) return out;
  }
  log.warn({
    event: "datastore_query_max_pages",
    datastore: args.datastore,
    pages: MAX_PAGES,
  });
  return out;
}

// ---------------------------------------------------------------------------
// Reminder DM (§18.4)
// ---------------------------------------------------------------------------

/**
 * §18.4 — Open a DM by passing `userId` as the `channel` argument (Slack
 * accepts this given the `im:write` scope listed in §4 / `manifest.ts`).
 *
 * Returns `result.ok` (boolean). Catches and logs every error; never throws.
 */
async function sendReminderDM(
  client: SlackClient,
  userId: string,
  decision: DecisionRecord,
): Promise<boolean> {
  const escapedName = escapeSlackText(decision.name);
  const deadlineDisplay = formatDeadlineHuman(
    decision.deadline_resolved,
    decision.deadline_tz,
  );

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "👋 Hi! You have a pending vote on a consensus decision.",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Decision:* ${escapedName}\n*Deadline:* ${deadlineDisplay}\n\nPlease visit <#${decision.channel_id}> to cast your vote.`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "This is an automated reminder from ConsensusBot",
        },
      ],
    },
  ];

  const args: ChatPostMessageArgs = {
    channel: userId,
    text: `Reminder: You have a pending vote for "${escapedName}"`,
    blocks,
  };

  try {
    const result: ChatResponse = await client.chat.postMessage(args);
    if (!result.ok) {
      log.warn({
        event: "reminder_dm_not_ok",
        user_id: userId,
        decision_id: decision.id,
        error: result.error ?? "unknown",
      });
    }
    return result.ok === true;
  } catch (err) {
    log.error({
      event: "reminder_dm_threw",
      user_id: userId,
      decision_id: decision.id,
      error: stringifyError(err),
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// finalizeDecision — local re-implementation (SPEC §13)
// ---------------------------------------------------------------------------
//
// Rationale: see file header. T-301 has not exported `finalizeDecision` at
// the time this file was authored, so we cannot import it without breaking
// `deno check`. The implementation below mirrors §13 step-for-step.

/**
 * §13 — Idempotent finaliser. The order of operations is contractual: we
 * write `finalized_at` BEFORE posting the ADR so a partial run still leaves
 * the decision in a finalised state on a subsequent re-read.
 */
async function finalizeDecision(
  client: SlackClient,
  decision: DecisionRecord,
  mergedVotes: VoteRecord[],
): Promise<void> {
  // 1. Re-read decision. Abort silently on bad state (§13 step 1).
  const reread = await client.apps.datastore.get<DecisionRecord>({
    datastore: "decisions",
    id: decision.id,
  });
  if (!reread.ok || !reread.item) {
    log.warn({
      event: "finalize_reread_missing",
      decision_id: decision.id,
    });
    return;
  }
  const current = reread.item;
  if (current.status !== "active") {
    log.info({
      event: "finalize_skip_not_active",
      decision_id: decision.id,
      status: current.status,
    });
    return;
  }
  if (
    typeof current.finalized_at === "string" &&
    current.finalized_at.length > 0
  ) {
    log.info({
      event: "finalize_skip_already_finalized",
      decision_id: decision.id,
      finalized_at: current.finalized_at,
    });
    return;
  }

  // 2. Refresh voter activity (§13 step 2).
  const voters = await queryVotersForDecision(client, decision.id);
  const refreshedVoters: VoterRecord[] = [];
  const newlyDeactivated: VoterRecord[] = [];
  for (const voter of voters) {
    if (!voter.is_active) {
      refreshedVoters.push(voter);
      continue;
    }
    let stillActiveUser = true;
    try {
      const info = await client.users.info({ user: voter.user_id });
      if (info.ok && info.user?.deleted === true) {
        stillActiveUser = false;
      }
    } catch (err) {
      log.warn({
        event: "users_info_failed_finalise",
        decision_id: decision.id,
        user_id: voter.user_id,
        error: stringifyError(err),
      });
    }

    if (!stillActiveUser) {
      const updated: VoterRecord = { ...voter, is_active: false };
      try {
        await client.apps.datastore.put<VoterRecord>({
          datastore: "voters",
          item: updated,
        });
        log.info({
          event: "voter_deactivated",
          decision_id: decision.id,
          user_id: voter.user_id,
          phase: "finalise",
        });
      } catch (err) {
        log.error({
          event: "voter_deactivate_put_failed",
          decision_id: decision.id,
          user_id: voter.user_id,
          error: stringifyError(err),
        });
      }
      refreshedVoters.push(updated);
      newlyDeactivated.push(updated);
    } else {
      refreshedVoters.push(voter);
    }
  }

  // 3. Recompute R_effective (§13 step 3). Zero → cancel branch.
  const rEffective = refreshedVoters.filter((v) => v.is_active).length;
  const nowIso = new Date().toISOString();

  if (rEffective === 0) {
    const cancelled: DecisionRecord = {
      ...current,
      status: "cancelled",
      outcome_reason: "no eligible voters remain",
      finalized_at: nowIso,
      updated_at: nowIso,
    };
    try {
      await client.apps.datastore.put<DecisionRecord>({
        datastore: "decisions",
        item: cancelled,
      });
    } catch (err) {
      log.error({
        event: "finalize_cancel_put_failed",
        decision_id: decision.id,
        error: stringifyError(err),
      });
      return;
    }

    await pinProbeAndRemove(client, cancelled);
    await updateMessageForCancelled(client, cancelled);
    await postCancelledADRThread(client, cancelled, mergedVotes, []);
    log.info({
      event: "finalize_cancelled_no_voters",
      decision_id: decision.id,
    });
    return;
  }

  // 4. Compute outcome (§13 step 4). The decision row's `quorum` is the
  //    snapshot at create time; SPEC §13 uses it verbatim for the
  //    finalisation calculation (§15 also takes it as a parameter).
  const outcome = calculateDecisionOutcome(
    mergedVotes,
    current.success_criteria,
    rEffective,
    current.quorum,
  );

  // 5. Set the idempotency token (§13 step 5).
  const finalisedRow: DecisionRecord = {
    ...current,
    status: outcome.passed ? "approved" : "rejected",
    outcome_reason: outcome.reason,
    finalized_at: nowIso,
    updated_at: nowIso,
  };
  try {
    await client.apps.datastore.put<DecisionRecord>({
      datastore: "decisions",
      item: finalisedRow,
    });
  } catch (err) {
    log.error({
      event: "finalize_put_failed",
      decision_id: decision.id,
      error: stringifyError(err),
    });
    return;
  }

  // 6. Pin probe + remove (§13 step 6 / §10 step 4).
  await pinProbeAndRemove(client, finalisedRow);

  // 7. Update the message in place with the "decided" layout (§13 step 7).
  await updateMessageForDecided(
    client,
    finalisedRow,
    outcome,
    mergedVotes,
    rEffective,
  );

  // 8. Build the userMap (§13 step 8): prefer cached names from
  //    `vote_history`, fall back to `users.info`.
  const voteHistory = await queryVoteHistoryForDecision(client, decision.id);
  const userMap = await buildUserMap(
    client,
    finalisedRow,
    refreshedVoters,
    mergedVotes,
    voteHistory,
  );

  // 9. Re-check for double finalisation (§13 step 9).
  const reread2 = await client.apps.datastore.get<DecisionRecord>({
    datastore: "decisions",
    id: decision.id,
  });
  if (reread2.ok && reread2.item) {
    const peer = reread2.item.finalized_at;
    if (
      typeof peer === "string" &&
      peer.length > 0 &&
      peer < nowIso
    ) {
      log.info({
        event: "finalize_skip_peer_won",
        decision_id: decision.id,
        peer_finalized_at: peer,
        ours: nowIso,
      });
      return;
    }
  }

  // 10. Generate + post the ADR to the thread (§13 step 10).
  try {
    const md = generateADRMarkdown(
      finalisedRow,
      mergedVotes,
      voteHistory,
      outcome,
      userMap,
      newlyDeactivated,
    );
    const blocks = formatADRForSlack(md);
    const res = await client.chat.postMessage({
      channel: finalisedRow.channel_id,
      thread_ts: finalisedRow.message_ts,
      text: "ADR Generated - See thread for details",
      blocks,
    });
    if (!res.ok) {
      log.warn({
        event: "adr_post_not_ok",
        decision_id: decision.id,
        error: res.error ?? "unknown",
      });
    }
  } catch (err) {
    log.error({
      event: "adr_post_threw",
      decision_id: decision.id,
      error: stringifyError(err),
    });
  }
}

/**
 * §10 step 4 / §13 step 6 — list the channel pins; remove the decision's
 * voting message if it's pinned. Best-effort and silently swallows misses.
 */
async function pinProbeAndRemove(
  client: SlackClient,
  decision: DecisionRecord,
): Promise<void> {
  try {
    const pins = await client.pins.list({ channel: decision.channel_id });
    if (!pins.ok || !pins.items) return;
    const isPinned = pins.items.some((p) =>
      p.message?.ts === decision.message_ts
    );
    if (!isPinned) return;
    await client.pins.remove({
      channel: decision.channel_id,
      timestamp: decision.message_ts,
    });
  } catch (err) {
    log.warn({
      event: "pin_probe_failed",
      decision_id: decision.id,
      error: stringifyError(err),
    });
  }
}

/**
 * §13 step 7 — render the "decided" layout (no buttons) and `chat.update`.
 */
async function updateMessageForDecided(
  client: SlackClient,
  decision: DecisionRecord,
  outcome: { passed: boolean; reason: string },
  votes: VoteRecord[],
  rEffective: number,
): Promise<void> {
  const escapedName = escapeSlackText(decision.name);
  const headerEmoji = outcome.passed ? "✅" : "❌";
  const statusUpper = outcome.passed ? "APPROVED" : "REJECTED";

  // Vote totals — recompute defensively from the merged votes.
  let yes = 0, no = 0, abstain = 0;
  for (const v of votes) {
    if (v.vote_type === "yes") yes++;
    else if (v.vote_type === "no") no++;
    else if (v.vote_type === "abstain") abstain++;
  }
  const total = votes.length;

  const blocks: SlackBlock[] = [
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
      text: {
        type: "mrkdwn",
        text: `*Status:* ${statusUpper}\n*Reason:* ${outcome.reason}`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Yes:*\n${yes}` },
        { type: "mrkdwn", text: `*No:*\n${no}` },
        { type: "mrkdwn", text: `*Abstain:*\n${abstain}` },
        { type: "mrkdwn", text: `*Total:*\n${total}` },
        {
          type: "mrkdwn",
          text: `*Required (effective):*\n${rEffective}`,
        },
      ],
    },
  ];

  try {
    const res = await client.chat.update({
      channel: decision.channel_id,
      ts: decision.message_ts,
      text: `Decision finalised: ${escapedName}`,
      blocks,
    });
    if (!res.ok) {
      log.warn({
        event: "message_update_not_ok",
        decision_id: decision.id,
        error: res.error ?? "unknown",
      });
    }
  } catch (err) {
    log.error({
      event: "message_update_threw",
      decision_id: decision.id,
      error: stringifyError(err),
    });
  }
}

/**
 * §13 step 3 — render the "no eligible voters remain" cancel layout.
 */
async function updateMessageForCancelled(
  client: SlackClient,
  decision: DecisionRecord,
): Promise<void> {
  const escapedName = escapeSlackText(decision.name);
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🚫 ${escapedName}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Status:* 🚫 Cancelled\n*Reason:* ${
          decision.outcome_reason ?? "no eligible voters remain"
        }`,
      },
    },
  ];
  try {
    const res = await client.chat.update({
      channel: decision.channel_id,
      ts: decision.message_ts,
      text: `Decision cancelled: ${escapedName}`,
      blocks,
    });
    if (!res.ok) {
      log.warn({
        event: "cancel_message_update_not_ok",
        decision_id: decision.id,
        error: res.error ?? "unknown",
      });
    }
  } catch (err) {
    log.error({
      event: "cancel_message_update_threw",
      decision_id: decision.id,
      error: stringifyError(err),
    });
  }
}

/**
 * §13 step 3 — for the cancel-no-voters branch, post a minimal ADR thread
 * marker so the message thread remains discoverable in archive searches.
 */
async function postCancelledADRThread(
  client: SlackClient,
  decision: DecisionRecord,
  _votes: VoteRecord[],
  _voters: VoterRecord[],
): Promise<void> {
  const escapedName = escapeSlackText(neutraliseBackticks(decision.name));
  const reason = decision.outcome_reason ?? "no eligible voters remain";
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `🚫 *Decision Cancelled*\n\n*${escapedName}*\n\n*Reason:* ${reason}`,
      },
    },
  ];
  try {
    await client.chat.postMessage({
      channel: decision.channel_id,
      thread_ts: decision.message_ts,
      text: `Decision cancelled: ${escapedName}`,
      blocks,
    });
  } catch (err) {
    log.warn({
      event: "cancel_thread_post_failed",
      decision_id: decision.id,
      error: stringifyError(err),
    });
  }
}

/**
 * §13 step 8 — build a `userMap` of `user_id → display name` for the ADR.
 *
 * Strategy: collect the set of user IDs we need names for (every voter,
 * every voter in `mergedVotes`, plus the creator), and call `users.info`
 * once per id. There is no in-flight cache from `vote_history` v1 (the
 * §5.4 schema does not denormalise display names yet — the SPEC marks
 * this as a forward optimisation in §13 step 8); we therefore use a
 * defensive `users.info` fan-out, tolerating per-user failures.
 */
async function buildUserMap(
  client: SlackClient,
  decision: DecisionRecord,
  voters: VoterRecord[],
  votes: VoteRecord[],
  voteHistory: VoteHistoryRecord[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  ids.add(decision.creator_id);
  for (const v of voters) ids.add(v.user_id);
  for (const v of votes) ids.add(v.user_id);
  for (const h of voteHistory) ids.add(h.user_id);

  const map = new Map<string, string>();
  for (const id of ids) {
    try {
      const info = await client.users.info({ user: id });
      if (info.ok && info.user) {
        const display = info.user.real_name ?? info.user.name ?? id;
        map.set(id, display);
      } else {
        map.set(id, id);
      }
    } catch (err) {
      // Best-effort: fall back to the raw id and continue.
      log.warn({
        event: "users_info_failed_user_map",
        user_id: id,
        error: stringifyError(err),
      });
      map.set(id, id);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Coerce an `unknown` thrown value to a JSON-friendly string for log.error.
 * `Error` instances surface their `.message`; everything else is `String()`.
 */
function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
