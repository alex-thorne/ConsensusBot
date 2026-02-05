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
    filter: {
      version: 1,
      root: {
        statement: "{{data.action_id}} == 'vote_yes' OR {{data.action_id}} == 'vote_no' OR {{data.action_id}} == 'vote_abstain'",
      },
    },
  },
  inputs: {
    interactivity: {
      value: "{{data.interactivity}}",
    },
    decision_id: {
      value: "{{data.actions.0.value}}",
    },
    vote_type: {
      value: "{{data.actions.0.action_id}}",
    },
    user_id: {
      value: "{{data.user.id}}",
    },
    channel_id: {
      value: "{{data.container.channel_id}}",
    },
    message_ts: {
      value: "{{data.container.message_ts}}",
    },
  },
};

export default voteButtonTrigger;
