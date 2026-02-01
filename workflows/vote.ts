import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { RecordVoteFunction } from "../functions/record_vote.ts";

/**
 * Workflow for recording a vote on a decision
 * Triggered by voting button clicks
 */
const VoteWorkflow = DefineWorkflow({
  callback_id: "vote_workflow",
  title: "Record Vote",
  description: "Record a user's vote on a decision",
  input_parameters: {
    properties: {
      interactivity: {
        type: Schema.slack.types.interactivity,
      },
      decision_id: {
        type: Schema.types.string,
        description: "ID of the decision being voted on",
      },
      vote_type: {
        type: Schema.types.string,
        description: "Type of vote: yes, no, or abstain",
      },
      user_id: {
        type: Schema.slack.types.user_id,
      },
      channel_id: {
        type: Schema.slack.types.channel_id,
      },
      message_ts: {
        type: Schema.types.string,
        description: "Timestamp of the voting message",
      },
    },
    required: ["decision_id", "vote_type", "user_id", "channel_id", "message_ts"],
  },
});

// Record the vote in datastore
VoteWorkflow.addStep(RecordVoteFunction, {
  decision_id: VoteWorkflow.inputs.decision_id,
  vote_type: VoteWorkflow.inputs.vote_type,
  user_id: VoteWorkflow.inputs.user_id,
  channel_id: VoteWorkflow.inputs.channel_id,
  message_ts: VoteWorkflow.inputs.message_ts,
});

export default VoteWorkflow;
