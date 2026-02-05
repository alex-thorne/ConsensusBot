/**
 * Tests for vote button trigger configuration
 *
 * Validates that the trigger is properly configured to route
 * block_actions events to the VoteWorkflow
 */

import { assertEquals, assertExists } from "@std/assert";
import voteButtonTrigger from "../triggers/vote_button_trigger.ts";
import VoteWorkflow from "../workflows/vote.ts";

Deno.test("vote_button_trigger - exports a valid trigger object", () => {
  assertExists(voteButtonTrigger);
  assertEquals(typeof voteButtonTrigger, "object");
});

Deno.test("vote_button_trigger - has correct type", () => {
  assertEquals(voteButtonTrigger.type, "event");
});

Deno.test("vote_button_trigger - has descriptive name and description", () => {
  assertEquals(voteButtonTrigger.name, "Record Vote on Decision");
  assertEquals(
    voteButtonTrigger.description,
    "Trigger workflow when users click voting buttons",
  );
});

Deno.test("vote_button_trigger - references VoteWorkflow", () => {
  const expectedWorkflowRef = `#/workflows/${VoteWorkflow.definition.callback_id}`;
  assertEquals(voteButtonTrigger.workflow, expectedWorkflowRef);
  assertEquals(VoteWorkflow.definition.callback_id, "vote_workflow");
});

Deno.test("vote_button_trigger - listens for block_actions events", () => {
  assertExists(voteButtonTrigger.event);
  assertEquals(voteButtonTrigger.event.event_type, "slack#/events/block_actions");
});

Deno.test("vote_button_trigger - filters for voting action_ids", () => {
  assertExists(voteButtonTrigger.event?.action_ids);
  const actionIds = voteButtonTrigger.event.action_ids;
  
  assertEquals(actionIds.length, 3);
  assertEquals(actionIds.includes("vote_yes"), true);
  assertEquals(actionIds.includes("vote_no"), true);
  assertEquals(actionIds.includes("vote_abstain"), true);
});

Deno.test("vote_button_trigger - maps interactivity input", () => {
  assertExists(voteButtonTrigger.inputs?.interactivity);
  assertEquals(
    voteButtonTrigger.inputs.interactivity.value,
    "{{data.interactivity}}",
  );
});

Deno.test("vote_button_trigger - maps decision_id from button value", () => {
  assertExists(voteButtonTrigger.inputs?.decision_id);
  assertEquals(
    voteButtonTrigger.inputs.decision_id.value,
    "{{data.actions.0.value}}",
  );
});

Deno.test("vote_button_trigger - maps vote_type from action_id", () => {
  assertExists(voteButtonTrigger.inputs?.vote_type);
  assertEquals(
    voteButtonTrigger.inputs.vote_type.value,
    "{{data.actions.0.action_id}}",
  );
});

Deno.test("vote_button_trigger - maps user_id from event data", () => {
  assertExists(voteButtonTrigger.inputs?.user_id);
  assertEquals(
    voteButtonTrigger.inputs.user_id.value,
    "{{data.user.id}}",
  );
});

Deno.test("vote_button_trigger - maps channel_id from container", () => {
  assertExists(voteButtonTrigger.inputs?.channel_id);
  assertEquals(
    voteButtonTrigger.inputs.channel_id.value,
    "{{data.container.channel_id}}",
  );
});

Deno.test("vote_button_trigger - maps message_ts from container", () => {
  assertExists(voteButtonTrigger.inputs?.message_ts);
  assertEquals(
    voteButtonTrigger.inputs.message_ts.value,
    "{{data.container.message_ts}}",
  );
});

Deno.test("vote_button_trigger - has all required inputs for VoteWorkflow", () => {
  const triggerInputs = Object.keys(voteButtonTrigger.inputs || {});
  const workflowInputs = VoteWorkflow.definition.input_parameters.required || [];
  
  // Workflow requires: decision_id, vote_type, user_id, channel_id, message_ts
  // Trigger provides all of these plus interactivity (optional)
  for (const required of workflowInputs) {
    assertEquals(
      triggerInputs.includes(required),
      true,
      `Trigger missing required input: ${required}`,
    );
  }
});

Deno.test("vote_button_trigger - input mapping documentation", () => {
  // This test serves as documentation for how inputs flow from button click to workflow
  const inputFlow = {
    "button click": {
      action_id: "vote_yes | vote_no | vote_abstain",
      value: "decision_id (message timestamp)",
    },
    "block_actions event data": {
      "data.actions[0].action_id": "vote_yes",
      "data.actions[0].value": "1234567890.123456",
      "data.user.id": "U123456",
      "data.container.channel_id": "C123456",
      "data.container.message_ts": "1234567890.123456",
      "data.interactivity": "{...}",
    },
    "trigger mapping": {
      decision_id: "{{data.actions.0.value}}",
      vote_type: "{{data.actions.0.action_id}}",
      user_id: "{{data.user.id}}",
      channel_id: "{{data.container.channel_id}}",
      message_ts: "{{data.container.message_ts}}",
      interactivity: "{{data.interactivity}}",
    },
    "workflow receives": {
      decision_id: "1234567890.123456",
      vote_type: "vote_yes",
      user_id: "U123456",
      channel_id: "C123456",
      message_ts: "1234567890.123456",
      interactivity: "{...}",
    },
  };

  // Validate structure
  assertExists(inputFlow["button click"]);
  assertExists(inputFlow["block_actions event data"]);
  assertExists(inputFlow["trigger mapping"]);
  assertExists(inputFlow["workflow receives"]);
});
