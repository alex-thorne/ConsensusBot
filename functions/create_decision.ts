import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import DecisionDatastore from "../datastores/decisions.ts";
import VoteDatastore from "../datastores/votes.ts";
import VoterDatastore from "../datastores/voters.ts";
import { getDefaultDeadline } from "../utils/date_utils.ts";
import { isDeadlinePassed } from "../utils/date_utils.ts";
import {
  SlackBlock,
  SlackClient,
  SlackUsergroupSummary,
} from "../types/slack_types.ts";
import { calculateDecisionOutcome } from "../utils/decision_logic.ts";
import {
  formatADRForSlack,
  generateADRMarkdown,
} from "../utils/adr_generator.ts";
import { DecisionRecord, VoteRecord } from "../types/decision_types.ts";
import { parseUsergroupInput } from "../utils/slack_parse.ts";

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
        description: "Required voters selected from the user picker",
      },
      required_usergroups: {
        type: Schema.types.string,
        description:
          "Required user groups as mentions, handles, or IDs (comma/space separated). Also accepts a legacy array of usergroup IDs.",
      },
      success_criteria: {
        type: Schema.types.string,
        description: "Success criteria for the decision",
      },
      deadline: {
        type: Schema.slack.types.date,
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

    // Validate required_voters (array of user IDs from the user picker)
    const parsedVoterIds = inputs.required_voters.filter(Boolean);
    if (parsedVoterIds.length === 0) {
      return {
        error:
          "No valid voter IDs found. Please select at least one voter using the user picker.",
      };
    }

    // Parse required_usergroups (supports string or legacy array)
    let usergroupIds: string[] = [];
    if (inputs.required_usergroups) {
      const parsed = parseUsergroupInput(inputs.required_usergroups);
      usergroupIds = parsed.ids;

      // Resolve @handle references to IDs via the Slack API
      if (parsed.handles.length > 0) {
        try {
          const groupsResponse = await client.usergroups.list({});
          if (groupsResponse.ok && groupsResponse.usergroups) {
            for (const handle of parsed.handles) {
              const group = groupsResponse.usergroups.find(
                (g: SlackUsergroupSummary) => g.handle === handle,
              );
              if (group) {
                usergroupIds.push(group.id);
              } else {
                console.warn(
                  `Could not resolve usergroup handle: @${handle} — skipping`,
                );
              }
            }
          }
        } catch (error) {
          console.error(`Failed to resolve usergroup handles: ${error}`);
        }
      }
    }

    // Expand user groups to individual users
    const allVoters = new Set<string>();

    // Add individually specified voters first
    for (const voter of parsedVoterIds) {
      allVoters.add(voter);
    }

    // Expand user groups and add their members
    if (usergroupIds.length > 0) {
      for (const usergroup_id of usergroupIds) {
        try {
          const usergroupResponse = await client.usergroups.users.list({
            usergroup: usergroup_id,
          });

          if (!usergroupResponse.ok) {
            console.error(
              `Failed to fetch user group members: usergroup=${usergroup_id}, error=${usergroupResponse.error}`,
            );
            // Continue with other groups even if one fails
            continue;
          }

          if (
            usergroupResponse.users &&
            Array.isArray(usergroupResponse.users)
          ) {
            const groupMembers = usergroupResponse.users;

            // Add all members to the set (automatic deduplication)
            for (const member of groupMembers) {
              allVoters.add(member);
            }

            console.log(
              `Expanded user group: usergroup=${usergroup_id}, members=${groupMembers.length}`,
            );
          }
        } catch (error) {
          console.error(
            `Error fetching user group members: usergroup=${usergroup_id}, error=${error}`,
          );
          // Continue with other groups even if one fails
        }
      }
    }

    // Convert Set to Array for further processing
    const finalVoters = Array.from(allVoters);

    console.log(
      `Total unique voters after expansion: ${finalVoters.length}`,
    );

    // Validate that we have at least one voter
    if (finalVoters.length === 0) {
      return {
        error:
          "No voters specified. Please select at least one voter or user group with members.",
      };
    }

    // Post voting message to channel
    const criteriaDisplay = inputs.success_criteria
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l: string) => l.toUpperCase());

    const votersMentions = finalVoters
      .map((userId: string) => `<@${userId}>`)
      .join(", ");

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
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "🚫 Cancel",
                emoji: true,
              },
              action_id: "decision_cancel",
              value: "{{decision_id}}",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "🗑️ Delete",
                emoji: true,
              },
              action_id: "decision_delete",
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
      blocks: message.message?.blocks?.map((block: SlackBlock) => {
        if (block.type === "actions") {
          return {
            ...block,
            elements: block.elements?.map((element) => ({
              ...element,
              value: decision_id,
            })),
          };
        }
        return block;
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
    for (const voter_id of finalVoters) {
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

    // Keep workflow running to handle button clicks
    // Don't return outputs - workflow will complete when decision is finalized
    return {
      completed: false,
    };
  },
).addBlockActionsHandler(
  ["vote_yes", "vote_no", "vote_abstain"],
  async ({ action, body, client }) => {
    // Extract data from the button click
    const decision_id = action.value;
    const vote_type = action.action_id.replace(/^vote_/, "");
    const user_id = body.user.id;
    const channel_id = body.container.channel_id;
    const message_ts = body.container.message_ts;

    // Log button click
    console.log(
      `Vote button clicked: decision_id=${decision_id}, user_id=${user_id}, vote_type=${vote_type}`,
    );

    // Get decision
    const getDecision = await client.apps.datastore.get({
      datastore: DecisionDatastore.name,
      id: decision_id,
    });

    if (!getDecision.ok || !getDecision.item) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "Decision not found.",
      });
      return;
    }

    const decision = getDecision.item as DecisionRecord;

    console.log(
      `Decision validated: decision_id=${decision_id}, status=${decision.status}`,
    );

    // Check if decision is still active
    if (decision.status !== "active") {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "This decision is no longer active.",
      });
      return;
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
      return;
    }

    console.log(`Voter eligibility confirmed: user_id=${user_id}`);

    // Record or update vote
    const vote_id = `${decision_id}_${user_id}`;
    const now = new Date().toISOString();

    const putVote = await client.apps.datastore.put({
      datastore: VoteDatastore.name,
      item: {
        id: vote_id,
        decision_id: decision_id,
        user_id: user_id,
        vote_type: vote_type,
        voted_at: now,
      },
    });

    if (!putVote.ok) {
      console.error(
        `Failed to record vote: decision_id=${decision_id}, user_id=${user_id}, error=${putVote.error}`,
      );
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text:
          `❌ Failed to record your vote: ${putVote.error}. Please try again.`,
      });
      return;
    }

    console.log(
      `Vote recorded successfully: user_id=${user_id}, vote_type=${vote_type}, decision_id=${decision_id}`,
    );

    // Get all votes for this decision to update the message
    const votesResponse = await client.apps.datastore.query({
      datastore: VoteDatastore.name,
      expression: "#decision_id = :decision_id",
      expression_attributes: { "#decision_id": "decision_id" },
      expression_values: { ":decision_id": decision_id },
    });

    // Get all required voters for this decision
    const votersResponse = await client.apps.datastore.query({
      datastore: VoterDatastore.name,
      expression: "#decision_id = :decision_id",
      expression_attributes: { "#decision_id": "decision_id" },
      expression_values: { ":decision_id": decision_id },
    });

    // Update the decision message to show vote progress
    if (votesResponse.ok && votersResponse.ok) {
      const voteCount = votesResponse.items.length;
      const requiredCount = votersResponse.items.length;
      const votes = votesResponse.items as unknown as VoteRecord[];

      // Get voter names
      const voterNames: string[] = [];
      for (const vote of votes) {
        voterNames.push(`<@${vote.user_id}>`);
      }
      const votedText = voterNames.length > 0
        ? `\nVoted: ${voterNames.join(", ")}`
        : "";

      const updateResult = await client.chat.update({
        channel: channel_id,
        ts: message_ts,
        text: `New Decision: ${decision.name}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `🗳️ ${decision.name}`,
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Proposal:*\n${decision.proposal}`,
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Success Criteria:*\n${
                  (decision.success_criteria as string)
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (l: string) => l.toUpperCase())
                }`,
              },
              {
                type: "mrkdwn",
                text: `*Deadline:*\n${decision.deadline}`,
              },
              {
                type: "mrkdwn",
                text: `*Required Voters:*\n${requiredCount} voters`,
              },
              {
                type: "mrkdwn",
                text:
                  `*Status:*\n🟢 Active\n*Votes:* ${voteCount}/${requiredCount}${votedText}`,
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
                value: decision_id,
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
                value: decision_id,
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "⚪ Abstain",
                  emoji: true,
                },
                action_id: "vote_abstain",
                value: decision_id,
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "🚫 Cancel",
                  emoji: true,
                },
                action_id: "decision_cancel",
                value: decision_id,
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "🗑️ Delete",
                  emoji: true,
                },
                action_id: "decision_delete",
                value: decision_id,
              },
            ],
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text:
                  `Created by <@${decision.creator_id}> | Vote by ${decision.deadline}`,
              },
            ],
          },
        ],
      });

      if (!updateResult.ok) {
        console.error(
          `Failed to update decision message with vote progress: ${updateResult.error}`,
        );
      }
    } else {
      if (!votesResponse.ok) {
        console.error(
          `Failed to query votes for decision ${decision_id}: ${votesResponse.error}`,
        );
      }
      if (!votersResponse.ok) {
        console.error(
          `Failed to query voters for decision ${decision_id}: ${votersResponse.error}`,
        );
      }
    }

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

    console.log(`Should finalize decision: ${shouldFinalize}`);

    if (shouldFinalize) {
      await finalizeDecision(
        client,
        decision,
        channel_id,
        message_ts,
        decision_id,
      );
    }
  },
).addBlockActionsHandler(
  ["decision_cancel"],
  async ({ action, body, client }) => {
    const decision_id = action.value;
    const user_id = body.user.id;
    const channel_id = body.container.channel_id;
    const message_ts = body.container.message_ts;

    console.log(
      `Cancel button clicked: decision_id=${decision_id}, user_id=${user_id}`,
    );

    // Get decision
    const getDecision = await client.apps.datastore.get({
      datastore: DecisionDatastore.name,
      id: decision_id,
    });

    if (!getDecision.ok || !getDecision.item) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "Decision not found.",
      });
      return;
    }

    const decision = getDecision.item as DecisionRecord;

    if (decision.status !== "active") {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "This decision is no longer active.",
      });
      return;
    }

    // Update decision status to cancelled
    const now = new Date().toISOString();
    await client.apps.datastore.put({
      datastore: DecisionDatastore.name,
      item: {
        ...decision,
        status: "cancelled",
        updated_at: now,
      },
    });

    // Unpin the message
    await client.pins.remove({
      channel: channel_id,
      timestamp: message_ts,
    });

    // Update message to reflect cancelled status (no voting/management buttons)
    await client.chat.update({
      channel: channel_id,
      ts: message_ts,
      text: `Decision Cancelled: ${decision.name}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🚫 ${decision.name}`,
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Proposal:*\n${decision.proposal}`,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Status:*\n🚫 Cancelled`,
            },
            {
              type: "mrkdwn",
              text: `*Cancelled by:*\n<@${user_id}>`,
            },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text:
                `Created by <@${decision.creator_id}> | Cancelled at ${now}`,
            },
          ],
        },
      ],
    });

    // Post ephemeral confirmation
    await client.chat.postEphemeral({
      channel: channel_id,
      user: user_id,
      text: `🚫 Decision "${decision.name}" has been cancelled.`,
    });
  },
).addBlockActionsHandler(
  ["decision_delete"],
  async ({ action, body, client }) => {
    const decision_id = action.value;
    const user_id = body.user.id;
    const channel_id = body.container.channel_id;
    const message_ts = body.container.message_ts;

    console.log(
      `Delete button clicked: decision_id=${decision_id}, user_id=${user_id}`,
    );

    // Get decision
    const getDecision = await client.apps.datastore.get({
      datastore: DecisionDatastore.name,
      id: decision_id,
    });

    if (!getDecision.ok || !getDecision.item) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "Decision not found.",
      });
      return;
    }

    const decision = getDecision.item as DecisionRecord;

    // Only the creator may delete
    if (decision.creator_id !== user_id) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "⛔ Only the creator of this decision can delete it.",
      });
      return;
    }

    // Delete associated votes
    const votesResponse = await client.apps.datastore.query({
      datastore: VoteDatastore.name,
      expression: "#decision_id = :decision_id",
      expression_attributes: { "#decision_id": "decision_id" },
      expression_values: { ":decision_id": decision_id },
    });

    if (votesResponse.ok) {
      for (const vote of votesResponse.items) {
        await client.apps.datastore.delete({
          datastore: VoteDatastore.name,
          id: vote.id as string,
        });
      }
    }

    // Delete associated voters
    const votersResponse = await client.apps.datastore.query({
      datastore: VoterDatastore.name,
      expression: "#decision_id = :decision_id",
      expression_attributes: { "#decision_id": "decision_id" },
      expression_values: { ":decision_id": decision_id },
    });

    if (votersResponse.ok) {
      for (const voter of votersResponse.items) {
        await client.apps.datastore.delete({
          datastore: VoterDatastore.name,
          id: voter.id as string,
        });
      }
    }

    // Delete the decision record
    await client.apps.datastore.delete({
      datastore: DecisionDatastore.name,
      id: decision_id,
    });

    // Unpin the message
    await client.pins.remove({
      channel: channel_id,
      timestamp: message_ts,
    });

    // Try to delete the Slack message; fall back to updating it
    const deleteResult = await client.chat.delete({
      channel: channel_id,
      ts: message_ts,
    });

    if (!deleteResult.ok) {
      await client.chat.update({
        channel: channel_id,
        ts: message_ts,
        text: `Decision Deleted: ${decision.name}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `_This decision ("${decision.name}") was deleted by <@${user_id}>._`,
            },
          },
        ],
      });
    }

    // Post ephemeral confirmation
    await client.chat.postEphemeral({
      channel: channel_id,
      user: user_id,
      text: `🗑️ Decision "${decision.name}" has been deleted.`,
    });
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

  // Note: The workflow will remain running with completed: false
  // This is expected behavior for functions with block action handlers
}
