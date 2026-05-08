// ConsensusBot v2.0 — `consensus_command` slash-command shortcut trigger.
//
// SPEC sources of truth (read these BEFORE editing this file):
//   - docs/REDEVELOPMENT_SPECIFICATION.md §6.1 (consensus_command trigger)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md  T-403 (this task)
//
// Single-file ownership: T-403 owns ONLY this file.
//
// The user-facing `/consensus` slash command is bound to this shortcut at
// trigger-creation time via `slack triggers create --trigger-def
// triggers/consensus_command.ts` (see SPEC §6.1; deploy automation in T-601).
//
// `Trigger<>` is exported from `deno-slack-api/types.ts`, which re-exports
// the type from `typed-method-types/workflows/triggers/mod.ts`. The shorthand
// `deno-slack-api/` is mapped to the pinned 2.8.0 release in `deno.jsonc`.

import { Trigger } from "deno-slack-api/types.ts";
import CreateDecisionWorkflow from "../workflows/create_decision.ts";

const consensusCommandTrigger: Trigger<
  typeof CreateDecisionWorkflow.definition
> = {
  type: "shortcut",
  name: "Create Consensus Decision",
  description: "Start a new consensus decision",
  workflow: `#/workflows/${CreateDecisionWorkflow.definition.callback_id}`,
  inputs: {
    interactivity: { value: "{{data.interactivity}}" },
    channel_id: { value: "{{data.channel_id}}" },
    user_id: { value: "{{data.user_id}}" },
  },
};

export default consensusCommandTrigger;
