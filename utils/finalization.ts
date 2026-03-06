/**
 * Decision Finalization Utilities
 *
 * Shared logic for finalizing decisions and checking whether a decision
 * should be finalized. Extracted here so both create_decision.ts and
 * send_reminders.ts can call the same code path.
 */

import DecisionDatastore from "../datastores/decisions.ts";
import VoteDatastore from "../datastores/votes.ts";
import VoterDatastore from "../datastores/voters.ts";
import { isDeadlinePassed } from "./date_utils.ts";
import { SlackClient } from "../types/slack_types.ts";
import { calculateDecisionOutcome } from "./decision_logic.ts";
import { formatADRForSlack, generateADRMarkdown } from "./adr_generator.ts";
import { DecisionRecord, VoteRecord } from "../types/decision_types.ts";

/**
 * Check if a decision should be finalized.
 *
 * Returns true when:
 * - The deadline has passed, OR
 * - All required voters have cast a vote.
 *
 * Pass `knownVoteCount` (the merged local count) to avoid a redundant
 * datastore query in the vote handler where eventual-consistency means
 * the just-written vote may not yet appear in a fresh query.
 */
export async function checkIfShouldFinalize(
  client: SlackClient,
  decision_id: string,
  deadline: string,
  knownVoteCount?: number,
): Promise<boolean> {
  // Check deadline
  if (isDeadlinePassed(deadline)) {
    return true;
  }

  // Check if all required voters have voted
  const voters = await client.apps.datastore.query({
    datastore: VoterDatastore.name,
    expression: "#decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": decision_id },
  });

  if (!voters.ok) {
    return false;
  }

  // Use the provided vote count when available to avoid re-querying a
  // datastore that may not yet reflect the just-written vote (eventual
  // consistency). Fall back to a fresh query when no count is supplied.
  let voteCount: number;
  if (knownVoteCount !== undefined) {
    voteCount = knownVoteCount;
  } else {
    const votes = await client.apps.datastore.query({
      datastore: VoteDatastore.name,
      expression: "#decision_id = :decision_id",
      expression_attributes: { "#decision_id": "decision_id" },
      expression_values: { ":decision_id": decision_id },
    });
    if (!votes.ok) {
      return false;
    }
    voteCount = votes.items.length;
  }

  return voters.items.length === voteCount;
}

/**
 * Finalize a decision: calculate the outcome, update the datastore,
 * unpin the original message, post the result to the channel, and
 * generate the ADR in a thread reply.
 */
export async function finalizeDecision(
  client: SlackClient,
  decision: DecisionRecord,
  channel_id: string,
  message_ts: string,
  _decision_id: string,
) {
  // Get all votes
  const votesResponse = await client.apps.datastore.query({
    datastore: VoteDatastore.name,
    expression: "#decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": decision.id },
  });

  if (!votesResponse.ok) {
    console.error("Failed to get votes for finalization");
    return;
  }

  const votes = votesResponse.items as unknown as VoteRecord[];

  // Get required voters count
  const votersResponse = await client.apps.datastore.query({
    datastore: VoterDatastore.name,
    expression: "#decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": decision.id },
  });

  const requiredVotersCount = votersResponse.ok
    ? votersResponse.items.length
    : 0;

  // Calculate outcome
  const outcome = calculateDecisionOutcome(
    votes,
    decision.success_criteria,
    requiredVotersCount,
  );

  // Update decision status
  const newStatus = outcome.passed ? "approved" : "rejected";
  await client.apps.datastore.put({
    datastore: DecisionDatastore.name,
    item: {
      ...decision,
      status: newStatus,
      updated_at: new Date().toISOString(),
    },
  });

  // Unpin message
  await client.pins.remove({
    channel: channel_id,
    timestamp: message_ts,
  });

  // Update message with final result
  const statusEmoji = outcome.passed ? "✅" : "❌";
  const statusText = outcome.passed ? "APPROVED" : "REJECTED";

  await client.chat.update({
    channel: channel_id,
    ts: message_ts,
    text: `Decision Finalized: ${decision.name}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${statusEmoji} ${decision.name}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*Status:* ${statusEmoji} ${statusText}\n\n*Reason:* ${outcome.reason}`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Yes:* ${outcome.voteCounts.yes}`,
          },
          {
            type: "mrkdwn",
            text: `*No:* ${outcome.voteCounts.no}`,
          },
          {
            type: "mrkdwn",
            text: `*Abstain:* ${outcome.voteCounts.abstain}`,
          },
          {
            type: "mrkdwn",
            text: `*Total:* ${outcome.voteCounts.total}`,
          },
        ],
      },
    ],
  });

  // Get user names for ADR
  const userMap = new Map<string, string>();
  for (const vote of votes) {
    const userInfo = await client.users.info({ user: vote.user_id as string });
    if (userInfo.ok && userInfo.user) {
      userMap.set(
        vote.user_id as string,
        userInfo.user.real_name || userInfo.user.name || "Unknown User",
      );
    }
  }

  // Generate and post ADR
  const adrMarkdown = generateADRMarkdown(
    decision,
    votes,
    outcome,
    userMap,
  );
  const adrBlocks = formatADRForSlack(adrMarkdown);

  await client.chat.postMessage({
    channel: channel_id,
    thread_ts: message_ts,
    blocks: adrBlocks,
    text: "ADR Generated - See thread for details",
  });

  console.log(
    `Decision finalized: decision_id=${decision.id}, status=${newStatus}, outcome=${
      outcome.passed ? "passed" : "failed"
    }`,
  );

  // Note: The workflow will remain running with completed: false
  // This is expected behavior for functions with block action handlers
}
