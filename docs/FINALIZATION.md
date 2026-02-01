# Decision Finalization Workflow

## Overview

The Decision Finalization Workflow automatically finalizes consensus decisions when they are ready, calculates the outcome, updates the database status, and optionally generates an Architecture Decision Record (ADR) that is pushed to Azure DevOps.

## Architecture

```
┌─────────────────────────┐
│   Active Decision       │
│  (In Database)          │
└──────────┬──────────────┘
           │
           │ Trigger Check
           ▼
┌─────────────────────────┐
│ shouldFinalizeDecision()│
│ - All votes in?         │
│ - Deadline reached?     │
└──────────┬──────────────┘
           │
           │ Yes
           ▼
┌─────────────────────────┐
│  finalizeDecision()     │
│ - Calculate outcome     │
│ - Update status         │
└──────────┬──────────────┘
           │
           ├──────────────────┐
           │                  │
           ▼                  ▼
┌──────────────────┐  ┌────────────────────┐
│  Database Update │  │ pushADRToRepository│
│  status: approved│  │  (if configured)   │
│  or rejected     │  └────────────────────┘
└──────────────────┘           │
           │                   │
           │                   ▼
           │          ┌────────────────────┐
           │          │ Azure DevOps Repo  │
           │          │  KB.ProcessDocs    │
           │          └────────────────────┘
           │
           ▼
┌──────────────────────────┐
│ Slack Notification       │
│ (optional)               │
└──────────────────────────┘
```

## Finalization Triggers

A decision is automatically finalized when **either** of these conditions is met:

### 1. All Votes Submitted
When all required voters have cast their votes, the decision is immediately ready for finalization.

**Example:**
```javascript
Decision: 5 required voters
Votes cast: 5 (all voters participated)
Result: ✅ Ready for finalization
```

### 2. Deadline Reached
When the deadline date/time has passed, the decision is finalized with whatever votes have been cast.

**Example:**
```javascript
Decision deadline: 2026-02-15
Current date: 2026-02-16
Result: ✅ Ready for finalization (even if not all votes are in)
```

## Finalization Process

### Step 1: Decision Validation

The system validates that:
- Decision exists in database
- Decision status is `active` (not already finalized)
- Finalization criteria are met

### Step 2: Outcome Calculation

The system calculates the outcome using the configured success criteria:

| Success Criteria | Approval Logic |
|------------------|----------------|
| **Simple Majority** | Yes votes > 50% of total votes cast |
| **Supermajority** | Yes votes ≥ 66% of required voters |
| **Unanimity** | All votes are Yes (abstentions allowed, no No votes) |

### Step 3: Status Update

The decision status is updated in the database:
- ✅ **Approved**: Success criteria met
- ❌ **Rejected**: Success criteria not met

### Step 4: ADR Generation (Optional)

If Azure DevOps is configured, an ADR markdown file is generated and pushed to the repository:

1. Generate ADR content from decision data
2. Create filename: `ADR-{number}-{sanitized-name}.md`
3. Push to Azure DevOps via REST API
4. Store commit ID for reference

### Step 5: Notification (Optional)

If a Slack client is provided, a notification is posted to the original decision thread with:
- Final outcome (Approved/Rejected)
- Vote statistics
- Link to ADR (if generated)

## Usage

### Manual Finalization

Finalize a specific decision by ID:

```javascript
const { finalizeDecision } = require('./src/utils/finalization');

// Basic usage
const result = await finalizeDecision(decisionId);

console.log(result);
// {
//   success: true,
//   decisionId: 5,
//   status: 'approved',
//   approved: true,
//   outcome: { /* outcome details */ },
//   finalizationReason: 'all votes submitted',
//   adr: { success: true, filePath: '/docs/adr/...', commitId: '...' }
// }
```

### With Slack Notification

```javascript
const { finalizeDecision } = require('./src/utils/finalization');
const { App } = require('@slack/bolt');

const app = new App({ /* Slack config */ });

const result = await finalizeDecision(decisionId, {
  slackClient: app.client
});
```

### Skip ADR Push

```javascript
const result = await finalizeDecision(decisionId, {
  pushToAzureDevOps: false
});
```

### Batch Finalization

Finalize all ready decisions at once:

```javascript
const { finalizeReadyDecisions } = require('./src/utils/finalization');

const results = await finalizeReadyDecisions({
  slackClient: app.client,  // Optional
  pushToAzureDevOps: true   // Optional (default: true if configured)
});

console.log(results);
// {
//   total: 10,
//   finalized: 7,
//   skipped: 2,
//   errors: 1,
//   decisions: [ /* array of results */ ]
// }
```

## Scheduled Finalization

### Using Cron (Linux/macOS)

Create a script that runs periodically to finalize ready decisions:

**finalize-decisions.js:**
```javascript
const { finalizeReadyDecisions } = require('./src/utils/finalization');
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

(async () => {
  try {
    const results = await finalizeReadyDecisions({
      slackClient: app.client
    });
    
    console.log(`Finalized ${results.finalized} decisions`);
    console.log(`Skipped ${results.skipped} decisions`);
    console.log(`Errors: ${results.errors}`);
    
    process.exit(results.errors > 0 ? 1 : 0);
  } catch (error) {
    console.error('Finalization failed:', error);
    process.exit(1);
  }
})();
```

**Crontab entry (runs every hour):**
```bash
0 * * * * cd /path/to/ConsensusBot && node finalize-decisions.js >> /var/log/consensusbot-finalize.log 2>&1
```

### Using Azure Timer Function

Deploy as an Azure Function that runs on a schedule:

**function.json:**
```json
{
  "bindings": [
    {
      "name": "timer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 0 * * * *"
    }
  ]
}
```

**index.js:**
```javascript
const { finalizeReadyDecisions } = require('../../src/utils/finalization');

module.exports = async function (context, timer) {
  context.log('Decision finalization timer triggered');
  
  try {
    const results = await finalizeReadyDecisions();
    
    context.log(`Finalized ${results.finalized} decisions`);
    context.log(`Skipped ${results.skipped} decisions`);
    
    if (results.errors > 0) {
      context.log.error(`${results.errors} errors occurred`);
    }
    
    context.res = {
      status: 200,
      body: results
    };
  } catch (error) {
    context.log.error('Finalization failed:', error);
    throw error;
  }
};
```

### Using GitHub Actions

**.github/workflows/finalize-decisions.yml:**
```yaml
name: Finalize Decisions

on:
  schedule:
    - cron: '0 * * * *'  # Every hour
  workflow_dispatch:  # Manual trigger

jobs:
  finalize:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run finalization
        env:
          DATABASE_PATH: ${{ secrets.DATABASE_PATH }}
          AZURE_DEVOPS_ORG: ${{ secrets.AZURE_DEVOPS_ORG }}
          AZURE_DEVOPS_PROJECT: ${{ secrets.AZURE_DEVOPS_PROJECT }}
          AZURE_DEVOPS_REPO: ${{ secrets.AZURE_DEVOPS_REPO }}
          AZURE_DEVOPS_PAT: ${{ secrets.AZURE_DEVOPS_PAT }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          SLACK_SIGNING_SECRET: ${{ secrets.SLACK_SIGNING_SECRET }}
        run: node finalize-decisions.js
```

## Configuration

### Required Environment Variables

```bash
# Database
DATABASE_PATH=/path/to/consensus.db

# Azure DevOps (optional - for ADR push)
AZURE_DEVOPS_ORG=your-organization
AZURE_DEVOPS_PROJECT=your-project
AZURE_DEVOPS_REPO=KB.ProcessDocs
AZURE_DEVOPS_PAT=your-personal-access-token

# Slack (optional - for notifications)
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
```

### Azure DevOps Configuration

To enable ADR push to Azure DevOps:

1. **Create Personal Access Token (PAT)**
   - Navigate to Azure DevOps → User Settings → Personal Access Tokens
   - Click "New Token"
   - Name: ConsensusBot Finalization
   - Scopes: **Code (Read & Write)**
   - Expiration: 90-365 days
   - Click "Create" and copy the token

2. **Set Environment Variable**
   ```bash
   export AZURE_DEVOPS_PAT="your-token-here"
   ```

3. **Verify Repository Access**
   - Ensure the PAT has access to the target repository
   - Default repository: `KB.ProcessDocs`
   - Can be changed via `AZURE_DEVOPS_REPO` environment variable

## Error Handling

### Decision Not Found
```javascript
// Error: Decision 999 not found
const result = await finalizeDecision(999);
// Throws: Error: Decision 999 not found
```

**Solution:** Verify the decision ID exists in the database.

### Already Finalized
```javascript
const result = await finalizeDecision(5);
// { success: false, error: 'Decision already finalized', status: 'approved' }
```

**Solution:** Decision has already been finalized. No action needed.

### Not Ready for Finalization
```javascript
const result = await finalizeDecision(5);
// { success: false, error: 'Decision not ready for finalization', reason: 'not yet ready' }
```

**Solution:** Wait for deadline or for all voters to submit votes.

### Azure DevOps Push Failure

ADR push failures do **not** fail the finalization:

```javascript
const result = await finalizeDecision(5);
// {
//   success: true,
//   status: 'approved',
//   adr: {
//     success: false,
//     error: 'Azure DevOps API error'
//   }
// }
```

**Solution:** 
- Check Azure DevOps configuration
- Verify PAT is valid and has correct permissions
- Check network connectivity
- Review Azure DevOps API logs

### Common Azure DevOps Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `401 Unauthorized` | Invalid or expired PAT | Regenerate PAT and update environment variable |
| `403 Forbidden` | Insufficient permissions | Ensure PAT has Code (Read & Write) scope |
| `404 Not Found` | Repository not found | Verify organization, project, and repository names |
| `Network error` | Connectivity issue | Check internet connection, firewall rules |

## Monitoring

### Log Levels

The finalization module uses structured logging:

```javascript
// INFO level
logger.info('Decision finalization completed', {
  decisionId: 5,
  status: 'approved',
  adrPushed: true
});

// ERROR level
logger.error('Failed to push ADR to Azure DevOps', {
  decisionId: 5,
  error: 'Network timeout'
});
```

### Key Metrics to Monitor

1. **Finalization Success Rate**
   - Track `results.finalized / results.total`
   - Alert if success rate < 90%

2. **ADR Push Success Rate**
   - Track successful ADR pushes
   - Alert if failures > 10%

3. **Finalization Latency**
   - Time from trigger to completion
   - Alert if > 30 seconds

4. **Error Rate**
   - Track `results.errors`
   - Alert if errors > 0

### Example Monitoring Script

```javascript
const { finalizeReadyDecisions } = require('./src/utils/finalization');

async function monitorFinalization() {
  const startTime = Date.now();
  
  const results = await finalizeReadyDecisions();
  
  const latency = Date.now() - startTime;
  const successRate = results.total > 0 
    ? (results.finalized / results.total) * 100 
    : 100;
  
  // Send metrics to monitoring service
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    total: results.total,
    finalized: results.finalized,
    skipped: results.skipped,
    errors: results.errors,
    successRate: successRate,
    latency: latency
  }));
  
  // Alert conditions
  if (successRate < 90) {
    console.error('ALERT: Low finalization success rate:', successRate);
  }
  if (results.errors > 0) {
    console.error('ALERT: Finalization errors detected:', results.errors);
  }
}

monitorFinalization().catch(console.error);
```

## Testing

### Unit Tests

All finalization functions have comprehensive unit tests:

```bash
npm test test/utils/finalization.test.js
```

### Integration Testing

Test the full finalization workflow:

```javascript
const db = require('./src/database/db');
const { finalizeDecision } = require('./src/utils/finalization');

// 1. Create a test decision
const decisionId = db.insertDecision({
  name: 'Test Decision',
  proposal: 'Test proposal',
  success_criteria: 'simple_majority',
  deadline: '2020-01-01',  // Past deadline
  channel_id: 'C123',
  creator_id: 'U123'
});

// 2. Add voters
db.insertVoters(decisionId, ['U1', 'U2', 'U3']);

// 3. Cast votes
db.upsertVote({ decision_id: decisionId, user_id: 'U1', vote_type: 'yes' });
db.upsertVote({ decision_id: decisionId, user_id: 'U2', vote_type: 'yes' });
db.upsertVote({ decision_id: decisionId, user_id: 'U3', vote_type: 'no' });

// 4. Finalize
const result = await finalizeDecision(decisionId, {
  pushToAzureDevOps: false  // Skip Azure DevOps in testing
});

// 5. Verify
console.assert(result.success === true);
console.assert(result.status === 'approved');
console.assert(result.approved === true);
```

## Troubleshooting

### Decision Not Finalizing Automatically

**Check:**
1. Is the deadline in the past? `SELECT deadline FROM decisions WHERE id = ?`
2. Have all voters voted? Compare vote count to voter count
3. Is the decision status still `active`?
4. Is the finalization scheduler running?

**Solution:**
```javascript
// Check decision readiness
const { shouldFinalizeDecision } = require('./src/utils/finalization');
const db = require('./src/database/db');

const decision = db.getDecision(decisionId);
const voters = db.getVoters(decisionId);
const votes = db.getVotes(decisionId);

const check = shouldFinalizeDecision(decision, voters, votes);
console.log(check);
// { shouldFinalize: true/false, reason: '...', ... }
```

### ADR Not Being Created

**Check:**
1. Is `AZURE_DEVOPS_PAT` environment variable set?
2. Are all Azure DevOps environment variables correct?
3. Does the PAT have correct permissions?
4. Is the repository name correct?

**Solution:**
```bash
# Test Azure DevOps connectivity
node -e "
const { createAzureDevOpsClient } = require('./src/utils/azureDevOps');
const client = createAzureDevOpsClient();
console.log('Client config:', {
  org: client.organization,
  project: client.project,
  repo: client.repository,
  hasPAT: !!client.pat
});
"
```

### Slow Finalization

**Possible Causes:**
1. Network latency to Azure DevOps
2. Large number of decisions to finalize
3. Database performance issues

**Solutions:**
- Monitor finalization latency
- Add database indexes if needed
- Consider batch processing limits
- Implement timeouts for Azure DevOps API calls

## Best Practices

1. **Schedule Regular Checks**
   - Run finalization hourly or more frequently
   - Don't rely on real-time triggers for deadline-based finalization

2. **Monitor Errors**
   - Set up alerts for finalization failures
   - Log all errors with context for debugging

3. **Test PAT Expiration**
   - Set calendar reminders for PAT renewal
   - Implement PAT validation checks

4. **Handle Partial Failures**
   - Decision finalization succeeds even if ADR push fails
   - Manual ADR creation can be done later if needed

5. **Database Backups**
   - Back up database before bulk finalization
   - Keep audit trail of status changes

## API Reference

### `shouldFinalizeDecision(decision, voters, votes)`

Check if a decision should be finalized.

**Parameters:**
- `decision` (Object): Decision object from database
- `voters` (Array): Array of voter objects
- `votes` (Array): Array of vote objects

**Returns:**
```javascript
{
  shouldFinalize: boolean,
  reason: string,
  allVotesSubmitted: boolean,
  deadlineReached: boolean
}
```

### `finalizeDecision(decisionId, options)`

Finalize a specific decision.

**Parameters:**
- `decisionId` (Number): Decision ID to finalize
- `options` (Object): Optional configuration
  - `slackClient` (Object): Slack client for notifications
  - `pushToAzureDevOps` (Boolean): Whether to push ADR (default: true if configured)

**Returns:**
```javascript
{
  success: boolean,
  decisionId: number,
  status: string,  // 'approved' or 'rejected'
  approved: boolean,
  outcome: object,
  finalizationReason: string,
  adr: object | null
}
```

### `finalizeReadyDecisions(options)`

Finalize all decisions that are ready.

**Parameters:**
- `options` (Object): Optional configuration
  - `slackClient` (Object): Slack client for notifications
  - `pushToAzureDevOps` (Boolean): Whether to push ADRs

**Returns:**
```javascript
{
  total: number,
  finalized: number,
  skipped: number,
  errors: number,
  decisions: Array<object>
}
```

## Related Documentation

- [Azure DevOps Integration](./AZURE_DEVOPS.md)
- [Decision Outcome Logic](./VOTING_BACKEND.md)
- [Reminder System](./REMINDER_DEPLOYMENT.md)
- [ADR Template](./templates/adr-template.md)

## Support

For issues or questions:

1. Check existing [GitHub Issues](https://github.com/alex-thorne/ConsensusBot/issues)
2. Review logs for error messages
3. Verify configuration and environment variables
4. Create a new issue with:
   - Error messages and logs
   - Configuration (without sensitive data)
   - Steps to reproduce
