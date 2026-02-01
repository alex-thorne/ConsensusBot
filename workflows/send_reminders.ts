import { DefineWorkflow } from "deno-slack-sdk/mod.ts";
import { SendRemindersFunction } from "../functions/send_reminders.ts";

/**
 * Workflow for sending reminders to voters who haven't voted
 * Triggered by scheduled trigger (Mon-Fri at 9:00 AM)
 */
const SendRemindersWorkflow = DefineWorkflow({
  callback_id: "send_reminders_workflow",
  title: "Send Voter Reminders",
  description: "Send DM reminders to voters who haven't cast their votes",
  input_parameters: {
    properties: {},
    required: [],
  },
});

// Send reminders to missing voters
SendRemindersWorkflow.addStep(SendRemindersFunction, {});

export default SendRemindersWorkflow;
