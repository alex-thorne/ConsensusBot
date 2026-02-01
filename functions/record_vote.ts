import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import DecisionDatastore from "../datastores/decisions.ts";
import VoteDatastore from "../datastores/votes.ts";
import VoterDatastore from "../datastores/voters.ts";
import { calculateDecisionOutcome } from "../utils/decision_logic.ts";
import {
  formatADRForSlack,
  generateADRMarkdown,
} from "../utils/adr_generator.ts";
import { isDeadlinePassed } from "../utils/date_utils.ts";
import { SlackClient } from "../types/slack_types.ts";
import { DecisionRecord, VoteRecord } from "../types/decision_types.ts";

/**
 * Function to record a vote on a decision
 */
export const RecordVoteFunction = DefineFunction({
  callback_id: "record_vote_function",
  title: "Record Vote",
  description: "Record a user's vote and check if decision can be finalized",
  source_file: "functions/record_vote.ts",
  input_parameters: {
    properties: {
      decision_id: {
        type: Schema.types.string,
        description: "ID of the decision",
      },
      vote_type: {
        type: Schema.types.string,
        description: "Type of vote: yes, no, or abstain",
      },
      user_id: {
        type: Schema.slack.types.user_id,
        description: "User casting the vote",
      },
      channel_id: {
        type: Schema.slack.types.channel_id,
        description: "Channel where decision was posted",
      },
      message_ts: {
        type: Schema.types.string,
        description: "Timestamp of the voting message",
      },
    },
    required: [
      "decision_id",
      "vote_type",
      "user_id",
      "channel_id",
      "message_ts",
    ],
  },
  output_parameters: {
    properties: {
      success: {
        type: Schema.types.boolean,
        description: "Whether vote was recorded successfully",
      },
    },
    required: ["success"],
  },
});

export default SlackFunction(
  RecordVoteFunction,
  async ({ inputs, client }) => {
    const { decision_id, vote_type, user_id, channel_id, message_ts } = inputs;

    // Get decision
    const getDecision = await client.apps.datastore.get({
      datastore: DecisionDatastore.name,
      id: decision_id,
    });

    if (!getDecision.ok || !getDecision.item) {
      return { error: "Decision not found" };
    }

    const decision = getDecision.item as DecisionRecord;

    // Check if decision is still active
    if (decision.status !== "active") {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "This decision is no longer active.",
      });
      return { outputs: { success: false } };
    }

    // Check if voter is eligible
    const getVoter = await client.apps.datastore.get({
      datastore: VoterDatastore.name,
      id: `${decision_id}_${user_id}`,
    });

    if (!getVoter.ok || !getVoter.item) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "You are not listed as a required voter for this decision.",
      });
      return { outputs: { success: false } };
    }

    // Record or update vote
    const vote_id = `${decision_id}_${user_id}`;
    const now = new Date().toISOString();

    await client.apps.datastore.put({
      datastore: VoteDatastore.name,
      item: {
        id: vote_id,
        decision_id: decision_id,
        user_id: user_id,
        vote_type: vote_type,
        voted_at: now,
      },
    });

    // Send confirmation
    const voteEmoji = vote_type === "yes"
      ? "✅"
      : vote_type === "no"
      ? "❌"
      : "⚪";
    await client.chat.postEphemeral({
      channel: channel_id,
      user: user_id,
      text:
        `${voteEmoji} Your vote (${vote_type.toUpperCase()}) has been recorded for "${decision.name}"`,
    });

    // Check if all votes are in or deadline passed
    const shouldFinalize = await checkIfShouldFinalize(
      client,
      decision_id,
      decision.deadline as string,
    );

    if (shouldFinalize) {
      await finalizeDecision(client, decision, channel_id, message_ts);
    }

    return { outputs: { success: true } };
  },
);

/**
 * Check if decision should be finalized
 */
async function checkIfShouldFinalize(
  client: SlackClient,
  decision_id: string,
  deadline: string,
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

  const votes = await client.apps.datastore.query({
    datastore: VoteDatastore.name,
    expression: "#decision_id = :decision_id",
    expression_attributes: { "#decision_id": "decision_id" },
    expression_values: { ":decision_id": decision_id },
  });

  if (voters.ok && votes.ok) {
    return voters.items.length === votes.items.length;
  }

  return false;
}

/**
 * Finalize a decision and generate ADR
 */
async function finalizeDecision(
  client: SlackClient,
  decision: DecisionRecord,
  channel_id: string,
  message_ts: string,
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
}
