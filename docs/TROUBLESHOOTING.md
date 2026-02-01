# Troubleshooting Guide

## Overview

This guide covers common issues and edge cases when running ConsensusBot with Slack-based state management (no database).

## Table of Contents

1. [Bot Not Responding](#bot-not-responding)
2. [Voting Issues](#voting-issues)
3. [Nudger/Reminder Problems](#nudger-reminder-problems)
4. [ADR Generation Failures](#adr-generation-failures)
5. [Slack API Issues](#slack-api-issues)
6. [Edge Cases](#edge-cases)
7. [Infrastructure Issues](#infrastructure-issues)
8. [Monitoring and Debugging](#monitoring-and-debugging)

---

## Bot Not Responding

### Symptom: `/consensus` command does nothing

**Possible Causes:**

1. **Slack Request URL incorrect**
   - Check: Slack App → Slash Commands → Request URL
   - Should be: `https://your-app.azurewebsites.net/slack/commands`
   - Fix: Update URL in Slack App configuration

2. **App Service not running**
   ```bash
   # Check status
   az webapp show --name consensusbot-yourorg --resource-group consensusbot-rg --query "state"
   
   # Start if stopped
   az webapp start --name consensusbot-yourorg --resource-group consensusbot-rg
   ```

3. **Signing secret mismatch**
   ```bash
   # Verify secret in Key Vault
   az keyvault secret show --vault-name consensusbot-yourorg-kv --name slack-signing-secret
   
   # Compare with Slack App → Basic Information → Signing Secret
   # Update if mismatched
   az keyvault secret set --vault-name consensusbot-yourorg-kv --name slack-signing-secret --value "new-secret"
   
   # Restart app to reload secrets
   az webapp restart --name consensusbot-yourorg --resource-group consensusbot-rg
   ```

4. **Bot not in channel**
   - Fix: Invite bot to channel: `/invite @ConsensusBot`

**Debugging:**

```bash
# View real-time logs
az webapp log tail --name consensusbot-yourorg --resource-group consensusbot-rg

# Check for errors around the time you sent the command
# Look for: "Signature verification failed", "404 Not Found", etc.
```

### Symptom: Bot responds but shows error

**Check Application Insights:**

1. Go to Azure Portal → Application Insights → `consensusbot-yourorg-insights`
2. Navigate to **Failures**
3. Filter by timestamp when command was sent
4. Review exception details and stack trace

---

## Voting Issues

### Symptom: Vote buttons don't work

**Possible Causes:**

1. **Interactive Components URL incorrect**
   - Check: Slack App → Interactivity & Shortcuts → Request URL
   - Should be: `https://your-app.azurewebsites.net/slack/interactions`
   - Fix: Update URL

2. **Button action IDs not recognized**
   ```bash
   # Check logs for "Unknown action" or "Invalid action_id"
   az webapp log tail --name consensusbot-yourorg --resource-group consensusbot-rg
   ```

**Debugging:**

Enable Slack request logging:
1. Slack App → Event Subscriptions → Enable
2. Temporarily add Request URL
3. View incoming payload in logs
4. Verify `actions[0].action_id` matches expected values

### Symptom: Vote recorded but not showing in thread

**Check thread permissions:**

```bash
# Verify bot has chat:write scope
# Slack App → OAuth & Permissions → Scopes
# Ensure: chat:write, chat:write.public
```

**State reconstruction check:**

Since there's no database, votes are stored as thread replies. Verify:

1. Go to Slack channel
2. Find the decision message
3. View thread (click on reply count)
4. Each vote should appear as a separate reply

If votes are missing from thread:
- Bot may not have thread_ts from original message
- Check logs for "Failed to post thread reply"

### Symptom: User voted but count didn't update

**Possible Cause:** Message update failed

**Debug:**

```python
# In logs, look for:
# "Failed to update pinned message"
# "Rate limit exceeded"
```

**Fix:**

1. Bot should retry automatically with exponential backoff
2. If persistent, check Slack API status: https://status.slack.com
3. Verify bot has `pins:write` permission

### Symptom: Vote changed but showing old vote

**Expected Behavior:** Latest vote per user should win

**Verify:**

```python
# Bot's vote resolution logic should:
# 1. Get all thread replies
# 2. Filter to vote messages
# 3. Group by user_id
# 4. Sort by timestamp
# 5. Take most recent per user
```

**If old vote persists:**
- Check thread replies directly in Slack
- Verify timestamp ordering
- Review vote parsing logic in logs

---

## Nudger Reminder Problems

### Symptom: No reminder DMs sent

**Possible Causes:**

1. **Function App not running**
   ```bash
   az functionapp show --name consensusbot-yourorg-nudger --resource-group consensusbot-rg --query "state"
   
   # Start if stopped
   az functionapp start --name consensusbot-yourorg-nudger --resource-group consensusbot-rg
   ```

2. **Timer trigger not configured**
   ```bash
   # Check Function App settings
   az functionapp config appsettings list --name consensusbot-yourorg-nudger --resource-group consensusbot-rg
   
   # Verify NUDGE_SCHEDULE is set (e.g., "0 0 * * * *" for hourly)
   ```

3. **Channel IDs not set**
   ```bash
   # Check DECISION_CHANNEL_IDS
   az functionapp config appsettings list --name consensusbot-yourorg-nudger --resource-group consensusbot-rg | grep DECISION_CHANNEL_IDS
   
   # Set if missing
   az functionapp config appsettings set \
     --name consensusbot-yourorg-nudger \
     --resource-group consensusbot-rg \
     --settings DECISION_CHANNEL_IDS="C123,C456"
   ```

4. **Bot lacks im:write permission**
   - Fix: Slack App → OAuth & Permissions → Add `im:write` scope
   - Reinstall app to workspace

**Debugging:**

```bash
# View Function logs
az functionapp log tail --name consensusbot-yourorg-nudger --resource-group consensusbot-rg

# Look for:
# - "Scanning channel X for decisions"
# - "Found N overdue decisions"
# - "Sent reminder to user Y"
# - Errors: "API call failed", "Rate limited", etc.
```

### Symptom: Reminders sent to users who already voted

**Issue:** State reconstruction logic error

**Debug:**

1. Check the decision thread in Slack
2. Verify user's vote appears as a thread reply
3. Review nudger's vote parsing logic

**Common cause:** Vote message format changed, parser doesn't recognize it

**Fix:** Ensure vote messages have consistent metadata:

```python
# Expected vote message structure
{
    "text": "User voted Yes",
    "metadata": {
        "event_type": "consensus_vote",
        "event_payload": {
            "user_id": "U123",
            "vote": "yes"
        }
    }
}
```

### Symptom: Reminders sent multiple times

**Issue:** Nudger running too frequently or not tracking sent reminders

**Solutions:**

1. **Check cron schedule:**
   ```bash
   # Should be hourly or less frequent
   # Hourly: "0 0 * * * *"
   # Daily at 9am: "0 0 9 * * *"
   ```

2. **Implement sent-reminder tracking:**
   - Add metadata to DM messages
   - Check if reminder already sent today
   - Use Slack message timestamp as "last reminded" indicator

---

## ADR Generation Failures

### Symptom: Decision finalized but no ADR in Azure DevOps

**Possible Causes:**

1. **Azure DevOps PAT expired or invalid**
   ```bash
   # Test PAT manually
   curl -u :YOUR_PAT https://dev.azure.com/YourOrg/_apis/projects
   
   # If 401 Unauthorized, PAT is invalid
   # Generate new PAT and update Key Vault
   az keyvault secret set --vault-name consensusbot-yourorg-kv --name azure-devops-pat --value "new-pat"
   ```

2. **Repository path incorrect**
   ```bash
   # Verify environment variable
   az webapp config appsettings list --name consensusbot-yourorg --resource-group consensusbot-rg | grep AZURE_DEVOPS
   
   # Expected:
   # AZURE_DEVOPS_ORG: "YourOrg"
   # AZURE_DEVOPS_PROJECT: "YourProject"
   # AZURE_DEVOPS_REPO: "KB.ProcessDocs"
   ```

3. **PAT lacks Code Write permission**
   - Go to Azure DevOps → User Settings → Personal Access Tokens
   - Edit PAT → Ensure **Code (Read & Write)** is selected
   - Save and update Key Vault

**Debugging:**

```bash
# Check logs for Azure DevOps API errors
az webapp log tail --name consensusbot-yourorg --resource-group consensusbot-rg | grep -i "devops"

# Common errors:
# - "403 Forbidden" → PAT permissions insufficient
# - "404 Not Found" → Repository/path doesn't exist
# - "401 Unauthorized" → PAT invalid/expired
```

### Symptom: ADR created but content is malformed

**Verify ADR format:**

1. Clone Azure DevOps repository locally
2. Navigate to `decisions/` folder
3. Open latest ADR file

**Expected format:**

```markdown
# Decision: [Decision Text]

Date: YYYY-MM-DD

## Status

Accepted / Rejected / Cancelled

## Context

Decision initiated by @user on YYYY-MM-DD in #channel.

## Decision

[Decision text]

## Votes

- Yes: N
- No: N
- Abstain: N

### Detailed Votes

- @user1: Yes
- @user2: No
- @user3: Abstain

## Consequences

[Generated from vote discussion or N/A]
```

**If format is wrong:**
- Review ADR generation template in code
- Check for encoding issues (special characters)
- Verify Slack thread parsing logic

---

## Slack API Issues

### Symptom: "Rate limit exceeded" errors

**Slack enforces rate limits:**
- Tier 3: 50+ requests per minute
- Tier 4: 100+ requests per minute

**Solutions:**

1. **Implement exponential backoff:**
   ```python
   @retry_on_rate_limit(max_retries=5)
   def post_message(channel, text):
       response = slack_client.chat_postMessage(channel=channel, text=text)
       if response.get('error') == 'rate_limited':
           retry_after = response.headers.get('Retry-After', 60)
           time.sleep(retry_after)
           raise RateLimitError()
       return response
   ```

2. **Batch operations:**
   - Don't send individual DMs in tight loop
   - Batch nudges with delays between
   - Cache user/channel data to reduce API calls

3. **Monitor rate limit headers:**
   ```python
   # Check response headers
   rate_limit_remaining = response.headers.get('X-Rate-Limit-Remaining')
   rate_limit_reset = response.headers.get('X-Rate-Limit-Reset')
   ```

### Symptom: "Token revoked" error

**Cause:** Slack Bot Token was regenerated or app uninstalled

**Fix:**

1. Go to Slack App → OAuth & Permissions
2. Regenerate token if needed
3. Update Key Vault:
   ```bash
   az keyvault secret set --vault-name consensusbot-yourorg-kv --name slack-bot-token --value "xoxb-new-token"
   ```
4. Restart app:
   ```bash
   az webapp restart --name consensusbot-yourorg --resource-group consensusbot-rg
   ```

### Symptom: "channel_not_found" error

**Cause:** Bot not in channel or channel deleted

**Fixes:**

1. **Bot not in channel:**
   - User must invite bot: `/invite @ConsensusBot`
   - Or bot needs `chat:write.public` scope to post without joining

2. **Channel deleted:**
   - Bot should handle gracefully
   - Finalize pending decisions with "cancelled" status
   - Log warning and continue

---

## Edge Cases

### Edge Case: User Leaves Workspace During Decision

**Expected Behavior:**
1. Bot detects user is no longer active
2. Excludes user from required voter count
3. Continues with remaining participants
4. Notes in ADR: "User X left workspace"

**Implementation:**

```python
def get_active_participants(participant_ids):
    active = []
    for user_id in participant_ids:
        try:
            user_info = slack_client.users_info(user=user_id)
            if not user_info['user']['deleted']:
                active.append(user_id)
        except SlackApiError:
            # User not found, exclude
            continue
    return active
```

**Debugging:**

If decision stuck because user left:
- Manually check decision thread
- Verify participant list in pinned message
- Bot should auto-adjust on next nudge cycle

### Edge Case: Simultaneous Votes

**Scenario:** Two users click vote button at exact same time

**Expected Behavior:**
- Both votes recorded as separate thread replies
- Both appear in decision state
- No data loss

**Potential Issue:** Race condition on message update

**Solution:** Each vote is atomic (separate API call). Slack handles concurrency.

**Verification:**

```python
# After both votes, state should show:
assert len(votes) == 2
assert vote_user_ids == {'U123', 'U456'}
```

### Edge Case: Channel Deleted During Decision

**Scenario:** Admin deletes channel with active decision

**Expected Behavior:**
1. Slack sends `channel_deleted` event
2. Bot receives event
3. Bot finalizes all pending decisions in that channel
4. ADR status: "Cancelled - Channel deleted"

**Implementation:**

```python
@app.event("channel_deleted")
def handle_channel_deleted(event):
    channel_id = event['channel']
    
    # Get all active decisions in channel (from recent pins)
    decisions = get_active_decisions(channel_id)
    
    for decision in decisions:
        finalize_decision(
            decision,
            status="cancelled",
            reason="Channel deleted"
        )
```

### Edge Case: Bot Downtime During Decision

**Scenario:** Bot crashes/restarts while decisions active

**Expected Behavior:**
- No data loss (all state in Slack)
- On restart, bot rescans channels
- Resumes monitoring and nudging

**Recovery Steps:**

1. Bot starts
2. Queries channels for pinned messages
3. Identifies ConsensusBot decisions
4. Rebuilds in-memory state
5. Resumes operations

**No database needed!** All state reconstructed from Slack.

### Edge Case: Vote After Deadline

**Scenario:** User votes after deadline passed

**Expected Behavior:**
1. Decision already finalized
2. Vote still recorded in thread (for transparency)
3. Does not change ADR outcome
4. Bot sends ephemeral message: "Decision already finalized"

**Implementation:**

```python
def handle_vote(user_id, vote, decision_ts):
    decision = get_decision_state(decision_ts)
    
    if decision['is_finalized']:
        send_ephemeral_message(
            user_id,
            "This decision was finalized. Your vote is recorded but won't change the outcome."
        )
        # Still post to thread for record
        post_vote_to_thread(user_id, vote, decision_ts)
        return
    
    # Normal vote processing
    ...
```

---

## Infrastructure Issues

### Issue: Key Vault access denied

**Symptom:** "Forbidden: Key Vault access denied"

**Cause:** Managed Identity doesn't have access policy

**Fix:**

```bash
# Get App Service principal ID
PRINCIPAL_ID=$(az webapp identity show --name consensusbot-yourorg --resource-group consensusbot-rg --query principalId -o tsv)

# Grant Key Vault access
az keyvault set-policy \
  --name consensusbot-yourorg-kv \
  --object-id $PRINCIPAL_ID \
  --secret-permissions get list
```

### Issue: High memory usage

**Symptom:** App Service using > 80% memory

**Cause:** Likely loading too many Slack messages into memory

**Solutions:**

1. **Implement pagination:**
   ```python
   # Don't load all thread replies at once
   # Use Slack's cursor-based pagination
   def get_thread_replies_paginated(channel, thread_ts, limit=100):
       cursor = None
       while True:
           response = slack_client.conversations_replies(
               channel=channel,
               ts=thread_ts,
               limit=limit,
               cursor=cursor
           )
           yield from response['messages']
           
           cursor = response.get('response_metadata', {}).get('next_cursor')
           if not cursor:
               break
   ```

2. **Upgrade App Service Plan:**
   ```bash
   # Scale up to S1 (1.75 GB RAM)
   az appservice plan update \
     --name consensusbot-yourorg-plan \
     --resource-group consensusbot-rg \
     --sku S1
   ```

---

## Monitoring and Debugging

### Enable Detailed Logging

```bash
# Enable App Service logging
az webapp log config \
  --name consensusbot-yourorg \
  --resource-group consensusbot-rg \
  --application-logging filesystem \
  --level information

# Enable Function App logging
az functionapp config appsettings set \
  --name consensusbot-yourorg-nudger \
  --resource-group consensusbot-rg \
  --settings "FUNCTIONS_WORKER_RUNTIME=python" "AzureWebJobsStorage=..." "APPINSIGHTS_INSTRUMENTATION_KEY=..."
```

### Query Application Insights

```kusto
// Failed requests in last hour
requests
| where timestamp > ago(1h)
| where success == false
| project timestamp, name, resultCode, duration
| order by timestamp desc

// Exceptions in last hour
exceptions
| where timestamp > ago(1h)
| project timestamp, type, outerMessage, innermostMessage
| order by timestamp desc

// Slack API calls
dependencies
| where timestamp > ago(1h)
| where target contains "slack.com"
| project timestamp, name, duration, resultCode, success
| order by timestamp desc
```

### Test State Reconstruction Manually

```python
# Connect to Slack API directly
from slack_sdk import WebClient

client = WebClient(token="xoxb-...")

# Get decision message
channel_id = "C01234567"
message_ts = "1234567890.123456"

# Get thread replies
response = client.conversations_replies(
    channel=channel_id,
    ts=message_ts
)

# Inspect messages
for msg in response['messages']:
    print(f"User: {msg.get('user')}, Text: {msg.get('text')}, TS: {msg['ts']}")
    if 'metadata' in msg:
        print(f"Metadata: {msg['metadata']}")
```

### Common Log Messages

**Normal Operations:**
```
INFO: Received /consensus command from U123 in C456
INFO: Created decision message with ts 1234567890.123456
INFO: User U123 voted 'yes' on decision 1234567890.123456
INFO: Decision 1234567890.123456 finalized with status 'accepted'
INFO: Pushed ADR to Azure DevOps: decisions/2026-02-01-decision-name.md
```

**Warnings:**
```
WARN: User U789 not found, excluding from voter list
WARN: Rate limit approaching, backing off for 30s
WARN: Failed to send reminder to U456, user has DMs disabled
```

**Errors:**
```
ERROR: Failed to post message to C123: channel_not_found
ERROR: Azure DevOps API returned 403: insufficient permissions
ERROR: Key Vault secret not found: slack-bot-token
```

---

## Getting Help

If issue persists:

1. **Check logs:** Application Insights and App Service logs
2. **Verify configuration:** Secrets, environment variables, Slack app settings
3. **Test manually:** Use Slack API tester, curl Azure DevOps endpoints
4. **Review architecture:** [ARCHITECTURE.md](ARCHITECTURE.md)
5. **Open issue:** [GitHub Issues](https://github.com/alex-thorne/ConsensusBot/issues)

Include in issue report:
- Error messages from logs
- Steps to reproduce
- Expected vs actual behavior
- Terraform outputs
- Slack app configuration (sanitized)