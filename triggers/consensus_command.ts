import { Trigger } from "deno-slack-api/types.ts";
import CreateDecisionWorkflow from "../workflows/create_decision.ts";

/**
 * Trigger for /consensus slash command
 */
const consensusCommandTrigger: Trigger<
  typeof CreateDecisionWorkflow.definition
> = {
  type: "shortcut",
  name: "Create Consensus Decision",
  description: "Start a new consensus decision",
  workflow: `#/workflows/${CreateDecisionWorkflow.definition.callback_id}`,
  inputs: {
    interactivity: {
      value: "{{data.interactivity}}",
    },
    channel_id: {
      value: "{{data.channel_id}}",
    },
    user_id: {
      value: "{{data.user_id}}",
    },
  },
};

export default consensusCommandTrigger;
