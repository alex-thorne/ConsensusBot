import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import DecisionDatastore from "../datastores/decisions.ts";
import VoterDatastore from "../datastores/voters.ts";
import { getDefaultDeadline } from "../utils/date_utils.ts";
import { SlackBlock, SlackElement } from "../types/slack_types.ts";

/**
 * Function to create a new decision and post voting message
 */
export const CreateDecisionFunction = DefineFunction({
  callback_id: "create_decision_function",
  title: "Create Decision",
  description: "Create a decision record and post voting message to channel",
  source_file: "functions/create_decision.ts",
  input_parameters: {
    properties: {
      decision_name: {
        type: Schema.types.string,
        description: "Name of the decision",
      },
      proposal: {
        type: Schema.types.string,
        description: "Decision proposal details",
      },
      required_voters: {
        type: Schema.types.array,
        items: {
          type: Schema.slack.types.user_id,
        },
        description: "List of required voters",
      },
      success_criteria: {
        type: Schema.types.string,
        description: "Success criteria for the decision",
      },
      deadline: {
        type: Schema.types.string,
        description: "Deadline for voting",
      },
      channel_id: {
        type: Schema.slack.types.channel_id,
        description: "Channel to post the decision",
      },
      creator_id: {
        type: Schema.slack.types.user_id,
        description: "User who created the decision",
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
  output_parameters: {
    properties: {
      decision_id: {
        type: Schema.types.string,
        description: "ID of the created decision",
      },
      message_ts: {
        type: Schema.types.string,
        description: "Timestamp of the posted message",
      },
    },
    required: ["decision_id"],
  },
});

export default SlackFunction(
  CreateDecisionFunction,
  async ({ inputs, client }) => {
    const now = new Date().toISOString();
    const deadline = inputs.deadline || getDefaultDeadline();
    
    // Post voting message to channel
    const criteriaDisplay = inputs.success_criteria
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l: string) => l.toUpperCase());
    
    const votersMentions = inputs.required_voters
      .map((userId: string) => `<@${userId}>`)
      .join(', ');
    
    const message = await client.chat.postMessage({
      channel: inputs.channel_id,
      text: `New Decision: ${inputs.decision_name}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🗳️ ${inputs.decision_name}`,
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Proposal:*\n${inputs.proposal}`,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Success Criteria:*\n${criteriaDisplay}`,
            },
            {
              type: "mrkdwn",
              text: `*Deadline:*\n${deadline}`,
            },
            {
              type: "mrkdwn",
              text: `*Required Voters:*\n${votersMentions}`,
            },
            {
              type: "mrkdwn",
              text: `*Status:*\n🟢 Active`,
            },
          ],
        },
        {
          type: "divider",
        },
        {
          type: "actions",
          block_id: "voting_actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "✅ Yes",
                emoji: true,
              },
              style: "primary",
              action_id: "vote_yes",
              value: "{{decision_id}}",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "❌ No",
                emoji: true,
              },
              style: "danger",
              action_id: "vote_no",
              value: "{{decision_id}}",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "⚪ Abstain",
                emoji: true,
              },
              action_id: "vote_abstain",
              value: "{{decision_id}}",
            },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Created by <@${inputs.creator_id}> | Vote by ${deadline}`,
            },
          ],
        },
      ],
    });
    
    if (!message.ok) {
      return {
        error: `Failed to post message: ${message.error}`,
      };
    }
    
    const decision_id = message.ts as string;
    const message_ts = message.ts as string;
    
    // Update button values with actual decision_id
    await client.chat.update({
      channel: inputs.channel_id,
      ts: message_ts,
      text: `New Decision: ${inputs.decision_name}`,
      blocks: message.message?.blocks?.map((block) => {
        const typedBlock = block as SlackBlock;
        if (typedBlock.type === "actions") {
          return {
            ...typedBlock,
            elements: typedBlock.elements?.map((element) => ({
              ...element,
              value: decision_id,
            })),
          };
        }
        return typedBlock;
      }),
    });
    
    // Pin the message
    await client.pins.add({
      channel: inputs.channel_id,
      timestamp: message_ts,
    });
    
    // Store decision in datastore
    const putDecision = await client.apps.datastore.put({
      datastore: DecisionDatastore.name,
      item: {
        id: decision_id,
        name: inputs.decision_name,
        proposal: inputs.proposal,
        success_criteria: inputs.success_criteria,
        deadline: deadline,
        channel_id: inputs.channel_id,
        creator_id: inputs.creator_id,
        message_ts: message_ts,
        status: "active",
        created_at: now,
        updated_at: now,
      },
    });
    
    if (!putDecision.ok) {
      return {
        error: `Failed to store decision: ${putDecision.error}`,
      };
    }
    
    // Store required voters
    for (const voter_id of inputs.required_voters) {
      const putVoter = await client.apps.datastore.put({
        datastore: VoterDatastore.name,
        item: {
          id: `${decision_id}_${voter_id}`,
          decision_id: decision_id,
          user_id: voter_id,
          required: true,
          created_at: now,
        },
      });
      
      if (!putVoter.ok) {
        console.error(`Failed to store voter ${voter_id}: ${putVoter.error}`);
      }
    }
    
    return {
      outputs: {
        decision_id: decision_id,
        message_ts: message_ts,
      },
    };
  },
);
