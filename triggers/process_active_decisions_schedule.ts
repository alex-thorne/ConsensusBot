// ConsensusBot v2.0 — Process Active Decisions scheduled trigger.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §6.2 (process_active_decisions_schedule)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md     T-404
//
// Cadence: weekly, Monday–Friday at 09:00 UTC (lands before UK working hours:
// 10:00 BST / 09:00 GMT). The target workflow runs the
// `process_active_decisions_function` which (Phase A) finalises past-deadline
// decisions and (Phase B) DMs reminders to non-voters on still-active
// decisions.
//
// IMPORTANT — `start_time` is a static placeholder.
// Slack rejects scheduled triggers whose `start_time` is in the past with
// `invalid_start_before_now` (SPEC §6.2). The literal date in this file WILL
// drift past "now" before deploy, so the real trigger is created at deploy
// time by `scripts/deploy.sh` (T-601), which generates a temporary trigger
// definition with a freshly computed start time (next weekday at 09:00 UTC)
// and feeds it to `slack triggers create`. This file is a documentation
// reference and a typecheck target, NOT a deploy artefact.
//
// Single-file ownership: this file does not modify any other file in the
// repo (T-404 owner discipline).

import { Trigger } from "deno-slack-api/types.ts";
import ProcessActiveDecisionsWorkflow from "../workflows/process_active_decisions.ts";

const processActiveDecisionsScheduleTrigger: Trigger<
  typeof ProcessActiveDecisionsWorkflow.definition
> = {
  type: "scheduled",
  name: "Process Active Decisions",
  description: "Finalise past-deadline decisions and send voter reminders",
  workflow:
    `#/workflows/${ProcessActiveDecisionsWorkflow.definition.callback_id}`,
  schedule: {
    // Static placeholder — far-future Monday at 09:00 UTC. The deploy script
    // (T-601) overrides this with a freshly computed next-weekday timestamp
    // before calling `slack triggers create`.
    start_time: "2099-01-05T09:00:00Z",
    frequency: {
      type: "weekly",
      repeats_every: 1,
      on_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
    timezone: "UTC",
  },
  inputs: {},
};

export default processActiveDecisionsScheduleTrigger;
