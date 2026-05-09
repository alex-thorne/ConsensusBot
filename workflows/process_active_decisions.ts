// ConsensusBot v2.0 — Process Active Decisions workflow.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §7.2 (ProcessActiveDecisionsWorkflow)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §6.2 (weekday 09:00 UTC tick)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md     T-402
//
// Single-step workflow that invokes the ProcessActiveDecisionsFunction.
// The function (T-302) does all the work: Phase A finalises past-deadline
// decisions, Phase B DMs reminders to non-voters on still-active decisions.
// This workflow exists purely as the trigger target for the §6.2 scheduled
// trigger (T-502).
//
// Note on imports: `functions/process_active_decisions.ts` default-exports
// the `SlackFunction(...)` wrapper, but `addStep` requires the
// `DefineFunction(...)` value. We therefore import the named export
// `ProcessActiveDecisionsFunction` rather than the default.
//
// Single-file ownership: this file does not modify any other file in the
// repo (T-402 owner discipline).

import { DefineWorkflow } from "deno-slack-sdk/mod.ts";
import { ProcessActiveDecisionsFunction } from "../functions/process_active_decisions.ts";

const ProcessActiveDecisionsWorkflow = DefineWorkflow({
  callback_id: "process_active_decisions_workflow",
  title: "Process Active Decisions",
  description: "Finalise past-deadline decisions and send voter reminders",
  input_parameters: {
    properties: {},
    required: [],
  },
});

ProcessActiveDecisionsWorkflow.addStep(ProcessActiveDecisionsFunction, {});

export default ProcessActiveDecisionsWorkflow;
