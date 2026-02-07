# Vote Button Data Flow Documentation

> **⚠️ OUTDATED**: This document describes the old implementation using event
> triggers and workflows. As of the latest update, voting buttons use block
> action handlers (`.addBlockActionsHandler()`) directly in the
> `create_decision` function. See
> [TRIGGER_TROUBLESHOOTING.md](TRIGGER_TROUBLESHOOTING.md) for current
> implementation.

This document explains how data **used to flow** from a button click through the
trigger, workflow, and function to record a vote (historical reference only).

## Overview (Historical)

When a user clicks a voting button (Yes/No/Abstain), the following sequence
**now** occurs:

```
User clicks button
    ↓
Slack sends block_actions interaction payload
    ↓
CreateDecisionFunction's block action handler catches it
    ↓
Handler validates and records vote directly
```

### Old Flow (for reference):

```
User clicks button
    ↓
Slack generates block_actions event
    ↓
voteButtonTrigger catches event
    ↓
Trigger extracts data and routes to VoteWorkflow
    ↓
VoteWorkflow passes data to RecordVoteFunction
    ↓
RecordVoteFunction validates and records vote
    ↓
User receives confirmation
```

## Detailed Data Flow

### 1. Button Click

In `functions/create_decision.ts`, voting buttons are defined with:

```typescript
{
  type: "button",
  text: { type: "plain_text", text: "✅ Yes" },
  action_id: "vote_yes",        // Identifies which button was clicked
  value: "1234567890.123456"    // Decision ID (message timestamp)
}
```

### 2. Slack Block Actions Event

When clicked, Slack generates a `block_actions` event with this structure:

```json
{
  "type": "block_actions",
  "user": {
    "id": "U123456"
  },
  "actions": [
    {
      "action_id": "vote_yes",
      "value": "1234567890.123456"
    }
  ],
  "container": {
    "channel_id": "C123456",
    "message_ts": "1234567890.123456"
  },
  "interactivity": { ... }
}
```

### 3. Trigger Input Mapping

The `vote_button_trigger.ts` extracts data using template variables:

| Trigger Input   | Data Path                       | Example Value         |
| --------------- | ------------------------------- | --------------------- |
| `decision_id`   | `{{data.actions.0.value}}`      | `"1234567890.123456"` |
| `vote_type`     | `{{data.actions.0.action_id}}`  | `"vote_yes"`          |
| `user_id`       | `{{data.user.id}}`              | `"U123456"`           |
| `channel_id`    | `{{data.container.channel_id}}` | `"C123456"`           |
| `message_ts`    | `{{data.container.message_ts}}` | `"1234567890.123456"` |
| `interactivity` | `{{data.interactivity}}`        | `{ ... }`             |

### 4. VoteWorkflow Receives

The workflow (`workflows/vote.ts`) receives these inputs:

```typescript
{
  decision_id: "1234567890.123456",
  vote_type: "vote_yes",
  user_id: "U123456",
  channel_id: "C123456",
  message_ts: "1234567890.123456",
  interactivity: { ... }
}
```

### 5. RecordVoteFunction Processes

The function (`functions/record_vote.ts`) receives the same inputs and:

1. **Normalizes vote_type**: Strips "vote_" prefix
   - Input: `"vote_yes"` → Output: `"yes"`

2. **Validates decision**:
   - Fetches from DecisionDatastore using `decision_id`
   - Checks status is "active"

3. **Validates voter**:
   - Fetches from VoterDatastore using `{decision_id}_{user_id}`
   - Ensures user is an eligible voter

4. **Records vote**:
   - Stores in VoteDatastore with ID `{decision_id}_{user_id}`
   - Fields: `decision_id`, `user_id`, `vote_type` (normalized), `voted_at`

5. **Sends confirmation**:
   - Ephemeral message: "✅ Your vote (YES) has been recorded for 'Decision
     Name'"

6. **Checks finalization**:
   - If all votes are in OR deadline passed, finalizes decision

## Data Transformations

### vote_type Normalization

The function normalizes vote_type to remove the "vote_" prefix:

```typescript
const vote_type = inputs.vote_type.replace(/^vote_/, "");
```

| action_id (input) | vote_type (stored) |
| ----------------- | ------------------ |
| `vote_yes`        | `yes`              |
| `vote_no`         | `no`               |
| `vote_abstain`    | `abstain`          |

This normalization ensures the datastore contains clean, standardized values.

### Decision ID

The decision ID is the message timestamp from when the voting message was
posted:

- Created in `create_decision.ts` as `message.ts`
- Used as primary key in DecisionDatastore
- Used in button `value` field
- Used to construct vote and voter IDs: `{decision_id}_{user_id}`

## Trigger Configuration Requirements

For the trigger to work correctly:

1. **Event type must match**: `slack#/events/block_actions`
2. **Action IDs must match button definitions**:
   - Trigger: `["vote_yes", "vote_no", "vote_abstain"]`
   - Buttons: `action_id: "vote_yes"`, etc.
3. **Input mappings must use correct data paths**:
   - `{{data.actions.0.value}}` for button value
   - `{{data.actions.0.action_id}}` for button ID
   - `{{data.user.id}}` for user who clicked
   - `{{data.container.channel_id}}` for channel
   - `{{data.container.message_ts}}` for message
4. **Workflow callback_id must match**: `vote_workflow`

## Common Issues

### Wrong Data Path

❌ **Incorrect**: `{{data.action.value}}` (missing `s` and `[0]`)\
✅ **Correct**: `{{data.actions.0.value}}`

Slack's block_actions event has an `actions` array (plural). The first action is
at index 0.

### Missing Action ID

If a button doesn't have an `action_id` that matches the trigger's `action_ids`
filter, the trigger won't catch the event.

### Mismatched Decision ID

If the button `value` doesn't contain the correct decision ID, the vote will
fail because the decision won't be found in the datastore.

## Verification

Run the validation script to verify configuration:

```bash
./scripts/validate-trigger.sh
```

This checks:

- ✅ Trigger exists and has correct type
- ✅ Event type is `slack#/events/block_actions`
- ✅ Action IDs match button definitions
- ✅ Input mappings are present
- ✅ Workflow and function have matching parameters
- ✅ VoteWorkflow is registered in manifest

## References

- [Slack Block Actions Events](https://api.slack.com/reference/interaction-payloads/block-actions)
- [Slack ROSI Triggers](https://api.slack.com/automation/triggers/event)
- [Slack Block Kit](https://api.slack.com/block-kit)
