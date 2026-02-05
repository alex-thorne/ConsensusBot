# Trigger Troubleshooting Guide

This guide helps you troubleshoot issues with ConsensusBot triggers.

## Symptom: Voting Buttons Show Warning Triangle (⚠️)

### Problem
When clicking Yes/No/Abstain voting buttons, they spin and then show a warning triangle, and no logs appear.

### Root Cause (Fixed)
This issue has been resolved. Voting buttons now use block action handlers directly within the `create_decision` function, which is the recommended approach for Slack's ROSI platform.

The previous implementation used an event trigger with `slack#/events/block_actions`, which is not supported by Slack.

### Solution

If you're still experiencing this issue after the fix:

1. **Redeploy the app** to get the latest code:

```bash
slack deploy
```

Wait for deployment to complete successfully.

2. **Create a new decision** to test the updated code:

Use `/consensus` in Slack and create a new decision. The voting buttons on this new decision should work correctly.

### What Changed

**Before**: The app used a separate event trigger (`vote_button_trigger.ts`) to catch button clicks and route them to a workflow.

**After**: The `create_decision` function now includes a `.addBlockActionsHandler()` that handles button clicks directly. This is the correct pattern for interactive Block Kit elements in Slack's platform.

### Verification

After deploying, you should only see two triggers:

```bash
slack triggers list
```

Expected triggers:
- ✅ **Create Consensus Decision** (shortcut) - The /consensus command
- ✅ **Send Voter Reminders** (scheduled) - Automated reminders

**Note**: You will NOT see a "Record Vote on Decision" event trigger - this is correct! Voting is now handled by block action handlers, not triggers.
```

### Testing the Fix

1. In Slack, type `/consensus` to create a new decision
2. Fill out the form and create the decision
3. Click one of the voting buttons (Yes/No/Abstain)
4. You should receive an ephemeral confirmation message
5. The button should NOT show a warning triangle

### How It Works Now

Voting buttons are handled by block action handlers in the `create_decision` function:

- **Handler Type**: Block Actions Handler (`.addBlockActionsHandler()`)
- **Action IDs**: `vote_yes`, `vote_no`, `vote_abstain`
- **Function**: `CreateDecisionFunction`

When you click a voting button:

1. Slack sends a `block_actions` interaction payload
2. The block action handler in `CreateDecisionFunction` catches it
3. The handler:
   - Extracts button data (`action_id`, `value`, `user.id`, etc.)
   - Validates the decision is still active
   - Checks voter eligibility
   - Records the vote in the datastore
   - Sends an ephemeral confirmation
   - Checks if the decision should be finalized

This is the recommended approach per Slack's documentation for handling interactive Block Kit elements.

## Common Issues

### Issue: Buttons Still Don't Work After Deployment

**Possible Causes**:
1. Old decision created before the fix
2. Cached Slack client
3. Deployment didn't complete

**Fix**:
```bash
# Redeploy
slack deploy
# Wait for completion
# Then create a NEW decision and test voting
```

### Issue: Different Error Messages

**Error**: "Decision not found"
- The decision ID might be corrupted
- Try creating a new decision

**Error**: "You are not listed as a required voter"
- You weren't added as a required voter when the decision was created
- Only listed voters can vote on decisions

**Error**: "This decision is no longer active"
- Decision has already been finalized
- Check the decision status in the message

## Debugging Tips

### View Real-Time Logs
```bash
slack activity --tail
```

This shows:
- When triggers fire
- Function executions
- Datastore operations
- Errors and warnings

### Check Trigger Details
```bash
slack triggers info <trigger_id>
```

Replace `<trigger_id>` with the ID from `slack triggers list`.

### Local vs Hosted App

When running locally with `slack run`:
- Triggers are created with "(local)" suffix
- They only work while `slack run` is active
- Stopping `slack run` breaks the triggers

For production:
- Deploy with `slack deploy`
- Create triggers without `slack run` running
- Triggers persist and work 24/7

## Architecture Reference

### Complete Flow

```
User clicks voting button (Yes/No/Abstain)
       ↓
Slack sends block_actions interaction payload
       ↓
CreateDecisionFunction's block action handler catches it
       ↓
Validates decision is active
       ↓
Checks user is eligible voter
       ↓
Saves vote to VoteDatastore
       ↓
Sends ephemeral confirmation
       ↓
Checks if all votes are in
       ↓
Finalizes decision if complete
```

### Files Involved

| File | Purpose |
|------|---------|
| `functions/create_decision.ts` | Creates voting buttons AND handles button clicks |
| `datastores/votes.ts` | Stores individual votes |
| `datastores/decisions.ts` | Stores decision metadata |
| `datastores/voters.ts` | Stores eligible voters |

## Still Having Issues?

If voting buttons still don't work after following this guide:

1. Verify the buttons in `create_decision.ts` use the correct action IDs:
   ```typescript
   action_id: "vote_yes"    // ✅
   action_id: "vote_no"     // ✅
   action_id: "vote_abstain" // ✅
   ```

2. Check the Slack workspace requirements:
   - Must have a **paid Slack plan** (ROSI requires paid plans)
   - Must have **admin permissions** to install apps
   - Must have **Slack CLI** installed and authenticated

3. Review deployment logs for errors:
   ```bash
   slack deploy --verbose
   ```

4. Check that the block action handler is registered:
   Look for `.addBlockActionsHandler()` at the end of `functions/create_decision.ts`

## Additional Resources

- [Slack Block Actions Documentation](https://api.slack.com/automation/functions/custom-functions#interactivity)
- [Slack ROSI Documentation](https://api.slack.com/automation/run-on-slack)
- [Slack CLI Reference](https://api.slack.com/automation/cli)
- [Block Kit Reference](https://api.slack.com/block-kit)
- [ConsensusBot README](../README.md)
- [Development Guide](../DEVELOPMENT.md)
