import { Trigger } from "deno-slack-api/types.ts";
import VoteWorkflow from "../workflows/vote.ts";

/**
 * Event trigger for voting button clicks
 * Handles Yes, No, and Abstain button interactions
 */
const voteButtonTrigger: Trigger<typeof VoteWorkflow.definition> = {
  type: "event",
  name: "Record Vote on Decision",
  description: "Trigger workflow when users click voting buttons",
  workflow: `#/workflows/${VoteWorkflow.definition.callback_id}`,
  event: {
    event_type: "slack#/events/block_actions",
    action_ids: ["vote_yes", "vote_no", "vote_abstain"],
  },
  inputs: {
    interactivity: {
      value: "{{data.interactivity}}",
    },
    decision_id: {
      value: "{{data.value}}",
    },
    vote_type: {
      value: "{{data.action_id}}",
    },
    user_id: {
      value: "{{data.user_id}}",
    },
    channel_id: {
      value: "{{data.channel_id}}",
    },
    message_ts: {
      value: "{{data.message_ts}}",
    },
  },
};

export default voteButtonTrigger;
