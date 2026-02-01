import { Trigger } from "deno-slack-api/types.ts";
import SendRemindersWorkflow from "../workflows/send_reminders.ts";

/**
 * Scheduled trigger for sending voter reminders
 * Runs Monday-Friday at 9:00 AM UTC
 */
const reminderScheduleTrigger: Trigger<typeof SendRemindersWorkflow.definition> = {
  type: "scheduled",
  name: "Send Voter Reminders",
  description: "Send DM reminders to voters who haven't voted",
  workflow: `#/workflows/${SendRemindersWorkflow.definition.callback_id}`,
  schedule: {
    start_time: "2024-01-01T09:00:00Z",
    frequency: {
      type: "daily",
      repeats_every: 1,
      on_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
    timezone: "UTC",
  },
  inputs: {},
};

export default reminderScheduleTrigger;
