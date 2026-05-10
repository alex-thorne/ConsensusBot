// ConsensusBot v2.0 — `CreateDecisionWorkflow` definition.
//
// SPEC sources of truth (read these BEFORE editing this file):
//   - docs/REDEVELOPMENT_SPECIFICATION.md §7.1 (CreateDecisionWorkflow form schema)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8   (CreateDecisionFunction inputs)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md  T-401 (this task)
//
// Single-file ownership: T-401 owns ONLY this file.
//
// `CreateDecisionFunction` (the `DefineFunction` value) is what `addStep`
// expects; we import the named export from `functions/create_decision.ts`
// (the default export there is the `SlackFunction` wrapper, which is the
// runtime-handler form).

import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { CreateDecisionFunction } from "../functions/create_decision.ts";

const CreateDecisionWorkflow = DefineWorkflow({
  callback_id: "create_decision_workflow",
  title: "Create Consensus Decision",
  description: "Start a new consensus decision",
  input_parameters: {
    properties: {
      interactivity: { type: Schema.slack.types.interactivity },
      channel_id: { type: Schema.slack.types.channel_id },
      user_id: { type: Schema.slack.types.user_id },
    },
    required: ["interactivity", "channel_id", "user_id"],
  },
});

// Step 1 — `Schema.slack.functions.OpenForm` (SPEC §7.1).
//
// Eight fields, in the spec's order. The `required` list is exactly
// `["decision_name","proposal","required_voters","success_criteria"]`.
const formStep = CreateDecisionWorkflow.addStep(
  Schema.slack.functions.OpenForm,
  {
    title: "Create a Decision",
    interactivity: CreateDecisionWorkflow.inputs.interactivity,
    submit_label: "Create",
    description:
      "Set up the proposal, voters, success criterion, and deadline.",
    fields: {
      elements: [
        {
          name: "decision_name",
          title: "Decision Name",
          type: Schema.types.string,
        },
        {
          name: "proposal",
          title: "Proposal",
          type: Schema.types.string,
          long: true,
        },
        {
          name: "required_voters",
          title: "Required Voters",
          type: Schema.types.array,
          items: { type: Schema.slack.types.user_id },
        },
        {
          name: "required_usergroups",
          title: "Required Usergroups",
          type: Schema.types.string,
          long: true,
        },
        {
          name: "include_channel_members",
          title: "Include all channel members",
          type: Schema.types.boolean,
        },
        {
          name: "success_criteria",
          title: "Success Criteria",
          type: Schema.types.string,
          enum: ["simple_majority", "super_majority", "unanimous"],
          choices: [
            {
              value: "simple_majority",
              title: "Simple Majority",
              description:
                "More yes than no votes; abstentions excluded; ≥50% participation required.",
            },
            {
              value: "super_majority",
              title: "Two-Thirds Majority",
              description:
                "Yes votes ≥ 2/3 of decisive (yes+no) votes; abstentions excluded; ≥66% participation required.",
            },
            {
              value: "unanimous",
              title: "Unanimity",
              description:
                "All decisive votes are yes; abstentions allowed; full participation required.",
            },
          ],
        },
        {
          name: "deadline",
          title: "Deadline",
          type: Schema.slack.types.date,
        },
        {
          name: "quorum_override",
          title: "Quorum Override",
          type: Schema.types.integer,
          description:
            "Minimum total votes required before resolution. Leave blank to use defaults (simple-majority: ceil(R/2), super-majority: ceil(2R/3), unanimous: R).",
        },
      ],
      required: [
        "decision_name",
        "proposal",
        "required_voters",
        "success_criteria",
      ],
    },
  },
);

// Step 2 — invoke `CreateDecisionFunction` (SPEC §7.1, §8).
//
// Form outputs map 1:1 to the function's per-§8.1 inputs; `channel_id` and
// `creator_id` come from the workflow's slash-command trigger inputs.
CreateDecisionWorkflow.addStep(CreateDecisionFunction, {
  decision_name: formStep.outputs.fields.decision_name,
  proposal: formStep.outputs.fields.proposal,
  required_voters: formStep.outputs.fields.required_voters,
  required_usergroups: formStep.outputs.fields.required_usergroups,
  include_channel_members: formStep.outputs.fields.include_channel_members,
  success_criteria: formStep.outputs.fields.success_criteria,
  deadline: formStep.outputs.fields.deadline,
  quorum_override: formStep.outputs.fields.quorum_override,
  channel_id: CreateDecisionWorkflow.inputs.channel_id,
  creator_id: CreateDecisionWorkflow.inputs.user_id,
});

export default CreateDecisionWorkflow;
