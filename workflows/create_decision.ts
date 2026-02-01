import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { CreateDecisionFunction } from "../functions/create_decision.ts";

/**
 * Workflow for creating a new consensus decision
 * Triggered by /consensus slash command
 */
const CreateDecisionWorkflow = DefineWorkflow({
  callback_id: "create_decision_workflow",
  title: "Create Consensus Decision",
  description: "Create a new decision and initiate voting",
  input_parameters: {
    properties: {
      interactivity: {
        type: Schema.slack.types.interactivity,
      },
      channel_id: {
        type: Schema.slack.types.channel_id,
      },
      user_id: {
        type: Schema.slack.types.user_id,
      },
    },
    required: ["interactivity", "channel_id", "user_id"],
  },
});

// Step 1: Open modal to collect decision details
const decisionForm = CreateDecisionWorkflow.addStep(
  Schema.slack.functions.OpenForm,
  {
    title: "Create Consensus Decision",
    interactivity: CreateDecisionWorkflow.inputs.interactivity,
    submit_label: "Create Decision",
    fields: {
      elements: [
        {
          name: "decision_name",
          title: "Decision Name",
          type: Schema.types.string,
          description: "A clear title for this decision",
          maxLength: 100,
        },
        {
          name: "proposal",
          title: "The Proposal",
          type: Schema.types.string,
          description: "Details of the target outcome and strategic alignment",
          long: true,
          maxLength: 2000,
        },
        {
          name: "required_voters",
          title: "Required Voters",
          type: Schema.types.array,
          items: {
            type: Schema.slack.types.user_id,
          },
          description: "Select team members whose votes are required",
        },
        {
          name: "success_criteria",
          title: "Success Criteria",
          type: Schema.types.string,
          description: "Threshold for consensus",
          enum: ["simple_majority", "super_majority", "unanimous"],
          choices: [
            {
              value: "simple_majority",
              title: "Simple Majority (>50%)",
              description: "More than half of votes must be yes",
            },
            {
              value: "super_majority",
              title: "Supermajority (≥66%)",
              description: "At least 66% of required voters must vote yes",
            },
            {
              value: "unanimous",
              title: "Unanimity (100%)",
              description: "All votes must be yes (abstentions allowed)",
            },
          ],
        },
        {
          name: "deadline",
          title: "Deadline",
          type: Schema.types.string,
          description: "Date by which votes must be cast (YYYY-MM-DD)",
        },
      ],
      required: ["decision_name", "proposal", "required_voters", "success_criteria"],
    },
  },
);

// Step 2: Create the decision and post voting message
CreateDecisionWorkflow.addStep(CreateDecisionFunction, {
  decision_name: decisionForm.outputs.fields.decision_name,
  proposal: decisionForm.outputs.fields.proposal,
  required_voters: decisionForm.outputs.fields.required_voters,
  success_criteria: decisionForm.outputs.fields.success_criteria,
  deadline: decisionForm.outputs.fields.deadline,
  channel_id: CreateDecisionWorkflow.inputs.channel_id,
  creator_id: CreateDecisionWorkflow.inputs.user_id,
});

export default CreateDecisionWorkflow;
