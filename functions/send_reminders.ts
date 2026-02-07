import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import DecisionDatastore from "../datastores/decisions.ts";
import VoteDatastore from "../datastores/votes.ts";
import VoterDatastore from "../datastores/voters.ts";
import { isDeadlinePassed } from "../utils/date_utils.ts";
import { SlackClient } from "../types/slack_types.ts";
import {
  DecisionRecord,
  VoteRecord,
  VoterRecord,
} from "../types/decision_types.ts";

/**
 * Function to send reminders to voters who haven't voted
 */
export const SendRemindersFunction = DefineFunction({
  callback_id: "send_reminders_function",
  title: "Send Voter Reminders",
  description: "Send DM reminders to voters who haven't cast their votes",
  source_file: "functions/send_reminders.ts",
  input_parameters: {
    properties: {},
    required: [],
  },
  output_parameters: {
    properties: {
      reminders_sent: {
        type: Schema.types.number,
        description: "Number of reminders sent",
      },
    },
    required: ["reminders_sent"],
  },
});

export default SlackFunction(
  SendRemindersFunction,
  async ({ client }) => {
    let remindersSent = 0;

    // Get all active decisions
    const decisionsResponse = await client.apps.datastore.query({
      datastore: DecisionDatastore.name,
      expression: "#status = :status",
      expression_attributes: { "#status": "status" },
      expression_values: { ":status": "active" },
    });

    if (!decisionsResponse.ok) {
      console.error("Failed to get active decisions");
      return { outputs: { reminders_sent: 0 } };
    }

    const activeDecisions = decisionsResponse.items;

    // Process each active decision
    for (const decision of activeDecisions) {
      // Skip decisions with passed deadlines
      // Note: These decisions will be auto-finalized when any voter clicks a vote button,
      // as the button handler checks for expired deadlines
      if (isDeadlinePassed(decision.deadline as string)) {
        console.log(
          `Skipping decision ${decision.id} - deadline has passed. ` +
            `Decision will be finalized when a vote button is clicked.`,
        );
        continue;
      }

      // Get required voters
      const votersResponse = await client.apps.datastore.query({
        datastore: VoterDatastore.name,
        expression: "#decision_id = :decision_id",
        expression_attributes: { "#decision_id": "decision_id" },
        expression_values: { ":decision_id": decision.id },
      });

      if (!votersResponse.ok) {
        continue;
      }

      // Get votes cast
      const votesResponse = await client.apps.datastore.query({
        datastore: VoteDatastore.name,
        expression: "#decision_id = :decision_id",
        expression_attributes: { "#decision_id": "decision_id" },
        expression_values: { ":decision_id": decision.id },
      });

      const votedUserIds = new Set(
        votesResponse.ok
          ? votesResponse.items.map((v) => (v as VoteRecord).user_id)
          : [],
      );

      // Find missing voters
      const missingVoters = votersResponse.items.filter(
        (voter) => !votedUserIds.has((voter as VoterRecord).user_id),
      );

      // Send reminders to missing voters
      for (const voter of missingVoters) {
        const voterRecord = voter as VoterRecord;
        const decisionRecord = decision as DecisionRecord;
        const reminderSent = await sendReminderDM(
          client,
          voterRecord.user_id,
          decisionRecord,
        );

        if (reminderSent) {
          remindersSent++;
        }
      }
    }

    console.log(`Sent ${remindersSent} voter reminders`);

    return { outputs: { reminders_sent: remindersSent } };
  },
);

/**
 * Send a reminder DM to a voter
 */
async function sendReminderDM(
  client: SlackClient,
  userId: string,
  decision: DecisionRecord,
): Promise<boolean> {
  try {
    const result = await client.chat.postMessage({
      channel: userId,
      text: `Reminder: You have a pending vote for "${decision.name}"`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `👋 Hi! You have a pending vote on a consensus decision.`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `*Decision:* ${decision.name}\n*Deadline:* ${decision.deadline}\n\nPlease visit <#${decision.channel_id}> to cast your vote.`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `This is an automated reminder from ConsensusBot`,
            },
          ],
        },
      ],
    });

    return result.ok;
  } catch (error) {
    console.error(`Failed to send reminder to ${userId}:`, error);
    return false;
  }
}
