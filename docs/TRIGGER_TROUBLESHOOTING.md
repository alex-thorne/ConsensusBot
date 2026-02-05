# Trigger Troubleshooting Guide

This guide helps you troubleshoot issues with ConsensusBot triggers, particularly the voting button trigger.

## Symptom: Voting Buttons Show Warning Triangle (⚠️)

### Problem
When clicking Yes/No/Abstain voting buttons, they spin and then show a warning triangle, and no logs appear.

### Root Cause
The vote button trigger has not been installed in your Slack workspace.

### Verification
Check which triggers are installed:

```bash
slack triggers list
```

You should see three triggers:
- ✅ **Create Consensus Decision** (shortcut)
- ✅ **Record Vote on Decision** (event) ← This one handles voting buttons
- ✅ **Send Voter Reminders** (scheduled)

If you only see the shortcut trigger, the vote button trigger is missing.

### Solution

#### Step 1: Ensure App is Deployed
First, make sure the app is deployed:

```bash
slack deploy
```

Wait for deployment to complete successfully.

#### Step 2: Install the Vote Button Trigger
Create the event trigger for voting buttons:

```bash
slack triggers create --trigger-def triggers/vote_button_trigger.ts
```

You should see output like:
```
⚡ Trigger created
   Trigger ID:   Ft0ABC123DEF
   Trigger Type: event
   Trigger Name: Record Vote on Decision
```

#### Step 3: Verify Installation
List triggers again to confirm:

```bash
slack triggers list
```

You should now see the "Record Vote on Decision" event trigger.

#### Step 4: Test the Fix
1. In Slack, type `/consensus` to create a new decision
2. Fill out the form and create the decision
3. Click one of the voting buttons (Yes/No/Abstain)
4. You should receive an ephemeral confirmation message
5. The button should NOT show a warning triangle

### Understanding the Trigger

The vote button trigger (`triggers/vote_button_trigger.ts`) routes button clicks to the vote recording workflow:

- **Type**: Event trigger
- **Event**: `slack#/events/block_actions`
- **Action IDs**: `vote_yes`, `vote_no`, `vote_abstain`
- **Workflow**: `VoteWorkflow`

When you click a voting button:

1. Slack generates a `block_actions` event
2. The event contains:
   - `action_id`: Which button was clicked (e.g., "vote_yes")
   - `value`: The decision ID (message timestamp)
   - `user.id`: Who clicked the button
   - `container.channel_id`: Which channel
   - `container.message_ts`: Which message
3. The trigger routes this to `VoteWorkflow`
4. `VoteWorkflow` calls `RecordVoteFunction` to save the vote
5. The function sends an ephemeral confirmation

## Common Issues

### Issue: Trigger Creation Fails

**Error**: `workflow not found`

**Cause**: App not deployed or workflow not registered in manifest

**Fix**:
```bash
slack deploy
slack triggers create --trigger-def triggers/vote_button_trigger.ts
```

### Issue: Buttons Still Don't Work After Installing Trigger

**Possible Causes**:
1. Wrong app environment (local vs deployed)
2. Cached Slack client
3. Decision created before trigger was installed

**Fix**:
1. Run `slack triggers list` to verify trigger is installed
2. Restart Slack client or clear cache
3. Create a NEW decision and try voting on that
4. Check logs: `slack activity --tail`

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

### Delete and Recreate Trigger
If a trigger seems corrupted:

```bash
# List triggers to get ID
slack triggers list

# Delete the specific trigger
slack triggers delete <trigger_id>

# Recreate it
slack triggers create --trigger-def triggers/vote_button_trigger.ts
```

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
User clicks button
       ↓
Slack generates block_actions event
       ↓
voteButtonTrigger catches event (if installed)
       ↓
Routes to VoteWorkflow
       ↓
Calls RecordVoteFunction
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
Finalizes decision if complete (optional)
```

### Files Involved

| File | Purpose |
|------|---------|
| `triggers/vote_button_trigger.ts` | Routes button clicks to workflow |
| `workflows/vote.ts` | Orchestrates vote recording |
| `functions/record_vote.ts` | Records vote and finalizes if ready |
| `functions/create_decision.ts` | Creates voting buttons |
| `datastores/votes.ts` | Stores individual votes |
| `datastores/decisions.ts` | Stores decision metadata |
| `datastores/voters.ts` | Stores eligible voters |

## Still Having Issues?

If voting buttons still don't work after following this guide:

1. Check that all three trigger files exist:
   - `triggers/consensus_command.ts`
   - `triggers/vote_button_trigger.ts`
   - `triggers/reminder_schedule.ts`

2. Verify the vote button trigger has the correct action IDs:
   ```typescript
   action_ids: ["vote_yes", "vote_no", "vote_abstain"]
   ```

3. Verify buttons in `create_decision.ts` use matching action IDs:
   ```typescript
   action_id: "vote_yes"    // ✅ Matches
   action_id: "vote_no"     // ✅ Matches
   action_id: "vote_abstain" // ✅ Matches
   ```

4. Check the Slack workspace requirements:
   - Must have a **paid Slack plan** (ROSI requires paid plans)
   - Must have **admin permissions** to install apps
   - Must have **Slack CLI** installed and authenticated

5. Review deployment logs for errors:
   ```bash
   slack deploy --verbose
   ```

## Additional Resources

- [Slack ROSI Documentation](https://api.slack.com/automation/run-on-slack)
- [Slack CLI Reference](https://api.slack.com/automation/cli)
- [Block Kit Reference](https://api.slack.com/block-kit)
- [ConsensusBot README](../README.md)
- [Development Guide](../DEVELOPMENT.md)
