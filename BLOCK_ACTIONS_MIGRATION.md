# Block Actions Handler Migration

## Summary

This document describes the migration from event triggers to block action handlers for voting buttons in ConsensusBot.

## Problem

The original implementation used an event trigger (`vote_button_trigger.ts`) configured with:
- **Type**: `event`
- **Event**: `slack#/events/block_actions`

**Issue**: Slack's ROSI platform does not support `block_actions` as an event trigger type. This caused the following error:

```
🚫 The provided event type is not allowed (invalid_trigger_event_type)
   event type 'slack#/events/block_actions' is not supported
   Source: /trigger/event_type
```

## Solution

Replaced the event trigger approach with block action handlers, which is the recommended pattern for interactive Block Kit elements in Slack's platform.

### Changes Made

#### 1. Removed Files
- `triggers/vote_button_trigger.ts` - Invalid event trigger
- `workflows/vote.ts` - No longer needed
- `tests/vote_button_trigger_test.ts` - Test for removed trigger

#### 2. Modified Files

**`functions/create_decision.ts`**:
- Added imports for vote handling dependencies:
  - `VoteDatastore`
  - `isDeadlinePassed` from date utilities
  - `calculateDecisionOutcome` from decision logic
  - ADR generation utilities
  - Type definitions (`DecisionRecord`, `VoteRecord`)
- Added `.addBlockActionsHandler()` to handle voting button clicks
- Implemented vote recording logic directly in the handler
- Added helper functions `checkIfShouldFinalize()` and `finalizeDecision()`

**`manifest.ts`**:
- Removed `VoteWorkflow` import
- Removed `VoteWorkflow` from workflows array

**`README.md`**:
- Removed instructions for creating vote button trigger
- Updated trigger list to show only 2 required triggers (was 3)
- Updated troubleshooting section
- Updated project structure diagram

**Documentation**:
- Updated `docs/TRIGGER_TROUBLESHOOTING.md` with new implementation details
- Added deprecation notices to historical docs:
  - `docs/IMPLEMENTATION_SUMMARY.md`
  - `docs/VOTE_BUTTON_DATA_FLOW.md`
  - `TRIGGER_VERIFICATION_REPORT.md`

## Implementation Details

### Block Actions Handler Pattern

The voting buttons are now handled using `.addBlockActionsHandler()`:

```typescript
export default SlackFunction(
  CreateDecisionFunction,
  async ({ inputs, client }) => {
    // ... create decision and post message with buttons
  }
).addBlockActionsHandler(
  ["vote_yes", "vote_no", "vote_abstain"],
  async ({ action, body, client }) => {
    // Handle button click
    const decision_id = action.value;
    const vote_type = action.action_id.replace(/^vote_/, "");
    const user_id = body.user.id;
    const channel_id = body.container.channel_id;
    const message_ts = body.container.message_ts;
    
    // Validate, record vote, and potentially finalize decision
  }
);
```

### Data Flow

**Before** (Event Trigger):
```
Button Click → block_actions Event → vote_button_trigger → VoteWorkflow → RecordVoteFunction
```

**After** (Block Action Handler):
```
Button Click → block_actions Payload → CreateDecisionFunction.addBlockActionsHandler → Vote Recorded
```

## Benefits

1. **Compliance**: Uses the correct Slack API pattern for interactive elements
2. **Simplicity**: Fewer files and moving parts (no separate workflow needed)
3. **Performance**: Direct handling without routing through workflow
4. **Maintainability**: All voting logic in one place

## Deployment

After deploying these changes:

1. Only 2 triggers needed (down from 3):
   ```bash
   slack triggers create --trigger-def triggers/consensus_command.ts
   slack triggers create --trigger-def triggers/reminder_schedule.ts
   ```

2. No separate vote button trigger needed - voting works automatically through block action handlers

## References

- Slack Block Actions Documentation: https://api.slack.com/automation/functions/custom-functions#interactivity
- Problem statement from issue describing the invalid trigger error
- PR #22 attempted to fix trigger issues but didn't address the root cause
