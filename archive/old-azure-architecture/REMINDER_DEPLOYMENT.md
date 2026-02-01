# Reminder System (Nudger) Deployment Guide

## Overview

The Reminder System (Nudger) is a scheduled job that sends DM reminders to voters who haven't cast their votes on active decisions. This document describes the system architecture and deployment process.

## Architecture

### Components

1. **Nudger Core Logic** (`src/utils/reminder.js`)
   - Query open decisions needing votes
   - Identify missing voters
   - Send personalized DM reminders
   - Track reminder delivery success/failure

2. **Scheduler** (Azure Timer Function)
   - Triggers nudger at scheduled intervals
   - Provides execution context and logging
   - Handles failures and retries

3. **Database Queries**
   - `getOpenDecisions()` - Fetch all active decisions
   - `getMissingVoters(decisionId)` - Find voters who haven't voted
   - Vote count summaries

### Data Flow

```
┌─────────────────────┐
│ Azure Timer Function│
│  (Scheduled Trigger)│
└──────────┬──────────┘
           │
           │ Invokes
           ▼
┌─────────────────────┐
│   runNudger()       │
│  (Main Function)    │
└──────────┬──────────┘
           │
           │ Queries
           ▼
┌─────────────────────┐
│    Database         │
│ - Open Decisions    │
│ - Missing Voters    │
└──────────┬──────────┘
           │
           │ For each decision
           ▼
┌─────────────────────┐
│ sendRemindersFor    │
│    Decision()       │
└──────────┬──────────┘
           │
           │ For each missing voter
           ▼
┌─────────────────────┐
│ sendVoterReminder() │
│  (Slack DM via API) │
└─────────────────────┘
```

## Functions Overview

### 1. getDecisionsNeedingVotes()

**Purpose**: Identify all open decisions with missing votes

**Returns**: Array of decision objects with vote statistics

**Example Return Value**:
```javascript
[
  {
    id: 5,
    name: "Choose new framework",
    proposal: "We need to decide...",
    deadline: "2026-02-15",
    status: "active",
    channel_id: "C1234567890",
    creator_id: "U9876543210",
    requiredVotersCount: 5,
    actualVotesCount: 3,
    missingVotersCount: 2,
    missingVoters: [
      { user_id: "U1111111111", decision_id: 5 },
      { user_id: "U2222222222", decision_id: 5 }
    ]
  }
]
```

**SQL Query**:
```sql
-- Get all active decisions
SELECT * FROM decisions WHERE status = 'active' ORDER BY deadline ASC

-- For each decision, get missing voters
SELECT v.* 
FROM voters v
LEFT JOIN votes vt ON v.decision_id = vt.decision_id AND v.user_id = vt.user_id
WHERE v.decision_id = ? AND vt.id IS NULL
```

### 2. sendVoterReminder(client, userId, decision, messageUrl)

**Purpose**: Send a DM reminder to a single voter

**Parameters**:
- `client`: Slack Bolt client instance
- `userId`: Slack user ID to send reminder to
- `decision`: Decision object
- `messageUrl`: Link to original voting message

**Features**:
- Calculates days until deadline
- Formats deadline urgency message
- Includes decision summary
- Provides direct link to vote

**Message Template**:
```
👋 Hi! This is a friendly reminder that your vote is needed for the following decision:

📋 Choose new framework

We need to decide on a frontend framework for our new project...

⏰ Deadline: 3 days from now

[View Decision & Vote] (button with link)

Decision ID: 5 | Created by @alice
```

**Error Handling**:
- Returns `true` on success, `false` on failure
- Logs all errors with context
- Continues processing other voters if one fails

### 3. sendRemindersForDecision(client, decisionId)

**Purpose**: Send reminders to all missing voters for a specific decision

**Validation**:
- Decision must exist
- Decision must be active
- Must have missing voters

**Returns**: Summary object
```javascript
{
  success: true,
  totalMissing: 3,
  remindersSent: 2,
  failed: 1
}
```

**Rate Limiting**:
- 100ms delay between individual reminders
- Prevents Slack API rate limit issues

### 4. runNudger(client)

**Purpose**: Main function - process all open decisions

**Returns**: Summary of entire run
```javascript
{
  success: true,
  decisionsProcessed: 5,
  totalRemindersSent: 15,
  totalFailed: 2
}
```

**Flow**:
1. Get all decisions needing votes
2. For each decision:
   - Send reminders to all missing voters
   - Wait 500ms between decisions
3. Aggregate results
4. Return summary

**Logging**: Comprehensive logs at each step for monitoring

## Azure Timer Function Deployment

### Prerequisites

- Azure account with Functions capability
- Azure CLI installed
- Node.js 18+ runtime
- Slack Bot Token with permissions:
  - `chat:write` - Send DMs
  - `users:read` - Read user information

### Function Configuration

#### function.json

```json
{
  "bindings": [
    {
      "name": "myTimer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 0 9 * * *"
    }
  ],
  "scriptFile": "../dist/reminder-function/index.js"
}
```

**Schedule Format**: CRON expression
- `0 0 9 * * *` - Daily at 9:00 AM UTC
- `0 0 9,17 * * *` - Twice daily at 9 AM and 5 PM
- `0 0 9 * * 1-5` - Weekdays only at 9 AM

#### index.js (Azure Function Entry Point)

```javascript
const { App } = require('@slack/bolt');
const { runNudger } = require('../../src/utils/reminder');
const logger = require('../../src/utils/logger');

// Initialize Slack client
const slackClient = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

module.exports = async function (context, myTimer) {
  const timeStamp = new Date().toISOString();
  
  context.log('Nudger timer trigger function started at:', timeStamp);
  
  try {
    // Run the nudger
    const result = await runNudger(slackClient.client);
    
    context.log('Nudger completed successfully:', {
      decisionsProcessed: result.decisionsProcessed,
      remindersSent: result.totalRemindersSent,
      failed: result.totalFailed
    });
    
    logger.info('Nudger run completed', result);
  } catch (error) {
    context.log.error('Nudger failed:', error);
    logger.error('Nudger run failed', {
      error: error.message,
      stack: error.stack
    });
    
    throw error; // Let Azure retry
  }
};
```

### Environment Variables

Configure these in Azure Functions Application Settings:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
DATABASE_PATH=/home/site/wwwroot/data/consensus.db
NODE_ENV=production
LOG_LEVEL=INFO
```

### Deployment Steps

#### 1. Prepare Function App

```bash
# Create resource group
az group create --name consensus-bot-rg --location eastus

# Create storage account (required for Functions)
az storage account create \
  --name consensusbotstorage \
  --resource-group consensus-bot-rg \
  --location eastus \
  --sku Standard_LRS

# Create Function App
az functionapp create \
  --name consensusbot-nudger \
  --resource-group consensus-bot-rg \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4 \
  --storage-account consensusbotstorage
```

#### 2. Configure Application Settings

```bash
az functionapp config appsettings set \
  --name consensusbot-nudger \
  --resource-group consensus-bot-rg \
  --settings \
    SLACK_BOT_TOKEN=xoxb-your-token \
    SLACK_SIGNING_SECRET=your-secret \
    DATABASE_PATH=/home/site/wwwroot/data/consensus.db \
    NODE_ENV=production \
    LOG_LEVEL=INFO
```

#### 3. Deploy Function Code

```bash
# Build and package
npm run build  # If using TypeScript
npm prune --production

# Deploy using Azure CLI
func azure functionapp publish consensusbot-nudger
```

#### 4. Verify Deployment

```bash
# Check function status
az functionapp show \
  --name consensusbot-nudger \
  --resource-group consensus-bot-rg

# View logs
az functionapp log tail \
  --name consensusbot-nudger \
  --resource-group consensus-bot-rg

# Test function manually
az functionapp function invoke \
  --name consensusbot-nudger \
  --resource-group consensus-bot-rg \
  --function-name NudgerTimer
```

## Database Considerations

### Shared Database Access

The reminder function needs access to the same database as the main bot:

**Options**:

1. **Azure Storage Account** (Recommended)
   - Store SQLite database in Azure Blob Storage
   - Mount as file share to Function App
   - Main bot and function share same storage

2. **Azure SQL Database**
   - Migrate from SQLite to Azure SQL
   - Better for production scale
   - Supports concurrent access

3. **Cosmos DB**
   - NoSQL alternative
   - Globally distributed
   - Higher cost but better scalability

### File Share Setup (Option 1)

```bash
# Create file share
az storage share create \
  --name consensusbot-data \
  --account-name consensusbotstorage

# Mount to Function App
az functionapp config storage-account add \
  --name consensusbot-nudger \
  --resource-group consensus-bot-rg \
  --storage-account consensusbotstorage \
  --share-name consensusbot-data \
  --mount-path /data \
  --custom-id consensus-db
```

Then update DATABASE_PATH:
```bash
DATABASE_PATH=/data/consensus.db
```

## Monitoring and Alerts

### Application Insights

Enable Application Insights for comprehensive monitoring:

```bash
# Create Application Insights
az monitor app-insights component create \
  --app consensusbot-insights \
  --resource-group consensus-bot-rg \
  --location eastus

# Link to Function App
az functionapp config appsettings set \
  --name consensusbot-nudger \
  --resource-group consensus-bot-rg \
  --settings \
    APPINSIGHTS_INSTRUMENTATIONKEY=$(az monitor app-insights component show --app consensusbot-insights -g consensus-bot-rg --query instrumentationKey -o tsv)
```

### Key Metrics to Monitor

1. **Execution Count**: Number of successful runs
2. **Duration**: How long each run takes
3. **Failures**: Failed executions
4. **Reminders Sent**: Total DMs sent per run
5. **Missing Voters**: Trend over time

### Alert Configuration

```bash
# Alert on function failures
az monitor metrics alert create \
  --name nudger-failure-alert \
  --resource-group consensus-bot-rg \
  --scopes /subscriptions/{subscription-id}/resourceGroups/consensus-bot-rg/providers/Microsoft.Web/sites/consensusbot-nudger \
  --condition "count errors > 0" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --action /subscriptions/{subscription-id}/resourceGroups/consensus-bot-rg/providers/microsoft.insights/actionGroups/admin-notifications
```

### Custom Logging

Add Application Insights tracking:

```javascript
const appInsights = require('applicationinsights');
appInsights.setup(process.env.APPINSIGHTS_INSTRUMENTATIONKEY).start();
const client = appInsights.defaultClient;

// In runNudger function:
client.trackEvent({
  name: 'NudgerRun',
  properties: {
    decisionsProcessed: result.decisionsProcessed,
    remindersSent: result.totalRemindersSent,
    failed: result.totalFailed
  }
});
```

## Testing

### Local Testing

```javascript
// test-nudger.js
const { App } = require('@slack/bolt');
const { runNudger } = require('./src/utils/reminder');

async function testNudger() {
  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
  });

  console.log('Starting nudger test...');
  const result = await runNudger(app.client);
  console.log('Result:', result);
}

testNudger().catch(console.error);
```

Run:
```bash
node test-nudger.js
```

### Manual Trigger

Manually trigger via Azure Portal:
1. Navigate to Function App
2. Select "NudgerTimer" function
3. Click "Test/Run"
4. Click "Run"

Or via CLI:
```bash
az functionapp function invoke \
  --name consensusbot-nudger \
  --resource-group consensus-bot-rg \
  --function-name NudgerTimer
```

## Troubleshooting

### Common Issues

#### 1. No Reminders Being Sent

**Possible Causes**:
- No open decisions with missing voters
- Database connection issue
- Slack token invalid

**Debug**:
```bash
# Check logs
az functionapp log tail --name consensusbot-nudger -g consensus-bot-rg

# Verify environment variables
az functionapp config appsettings list --name consensusbot-nudger -g consensus-bot-rg
```

#### 2. Slack API Rate Limiting

**Symptoms**: Some reminders fail to send

**Solution**: 
- Increase delay between reminders in code
- Implement exponential backoff
- Check Slack API tier limits

#### 3. Function Timeout

**Symptoms**: Function execution exceeds time limit

**Solution**:
```bash
# Increase timeout (max 10 minutes for consumption plan)
az functionapp config set \
  --name consensusbot-nudger \
  --resource-group consensus-bot-rg \
  --timeout 600
```

#### 4. Database Lock Errors

**Symptoms**: SQLite database locked errors

**Solution**:
- Ensure only one function instance runs at a time
- Consider migrating to Azure SQL
- Implement retry logic with exponential backoff

### Log Analysis

Search logs for specific patterns:

```bash
# Failed reminders
az functionapp log tail --name consensusbot-nudger -g consensus-bot-rg | grep "Error sending voter reminder"

# Successful runs
az functionapp log tail --name consensusbot-nudger -g consensus-bot-rg | grep "Nudger run completed"

# Decisions processed
az functionapp log tail --name consensusbot-nudger -g consensus-bot-rg | grep "decisionsProcessed"
```

## Cost Optimization

### Consumption Plan Costs

Azure Functions Consumption Plan pricing:
- First 1M executions: Free
- Additional executions: $0.20 per million
- Execution time: $0.000016 per GB-second

**Estimated Cost** (for daily runs):
- 30 runs/month × 5 seconds average = Very minimal cost (~$0.01/month)

### Optimization Tips

1. **Schedule Wisely**: Run only during business hours
2. **Batch Processing**: Process multiple decisions efficiently
3. **Early Exit**: Skip processing if no decisions need votes
4. **Efficient Queries**: Use indexes, limit result sets

## Security Best Practices

1. **Managed Identity**: Use Azure Managed Identity instead of connection strings
2. **Key Vault**: Store secrets in Azure Key Vault
3. **Network Isolation**: Use VNet integration if handling sensitive data
4. **Least Privilege**: Grant minimum required permissions

### Using Key Vault

```bash
# Create Key Vault
az keyvault create \
  --name consensusbot-vault \
  --resource-group consensus-bot-rg \
  --location eastus

# Store secrets
az keyvault secret set \
  --vault-name consensusbot-vault \
  --name slack-bot-token \
  --value xoxb-your-token

# Grant Function App access
az functionapp identity assign \
  --name consensusbot-nudger \
  --resource-group consensus-bot-rg

# Reference in app settings
SLACK_BOT_TOKEN=@Microsoft.KeyVault(SecretUri=https://consensusbot-vault.vault.azure.net/secrets/slack-bot-token/)
```

## Maintenance

### Regular Tasks

1. **Monitor logs weekly**: Check for errors or anomalies
2. **Review metrics monthly**: Analyze trends in reminders sent
3. **Update dependencies quarterly**: Keep packages up to date
4. **Test manually before holidays**: Verify functionality before long breaks

### Backup and Recovery

1. **Database Backups**: Automated backups of SQLite file to Azure Blob Storage
2. **Function Code**: Version control in Git
3. **Configuration**: Export app settings regularly

```bash
# Backup configuration
az functionapp config appsettings list \
  --name consensusbot-nudger \
  --resource-group consensus-bot-rg \
  > function-config-backup.json
```

## Alternative Deployment Options

### 1. GitHub Actions Workflow

Instead of Azure Timer Function, use GitHub Actions cron:

```yaml
# .github/workflows/nudger.yml
name: Nudger
on:
  schedule:
    - cron: '0 9 * * *'  # Daily at 9 AM UTC
  workflow_dispatch:  # Allow manual trigger

jobs:
  run-nudger:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm ci
      - run: node scripts/run-nudger.js
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          DATABASE_PATH: ${{ secrets.DATABASE_PATH }}
```

### 2. Kubernetes CronJob

For Kubernetes deployments:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: consensusbot-nudger
spec:
  schedule: "0 9 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: nudger
            image: consensusbot:latest
            command: ["node", "scripts/run-nudger.js"]
            env:
            - name: SLACK_BOT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: slack-secrets
                  key: bot-token
          restartPolicy: OnFailure
```

### 3. AWS Lambda

Similar to Azure, using EventBridge for scheduling:

```javascript
// lambda-handler.js
exports.handler = async (event) => {
  const result = await runNudger(slackClient);
  return {
    statusCode: 200,
    body: JSON.stringify(result)
  };
};
```

## Conclusion

The Reminder System provides automated engagement to keep decisions moving forward. Proper deployment and monitoring ensure reliable operation and timely reminders to voters.

For questions or issues, refer to the main documentation or contact the development team.
