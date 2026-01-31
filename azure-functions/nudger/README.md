# Azure Timer Trigger Function: Nudger

This directory contains the Azure Timer Trigger function that sends automated reminders to voters who haven't voted on active decisions.

## Function Overview

- **Name**: Nudger
- **Type**: Timer Trigger
- **Schedule**: Monday-Friday at 9:00 AM UTC
- **Cron Expression**: `0 0 9 * * 1-5`

## Configuration

### Required Environment Variables

- `SLACK_BOT_TOKEN`: Slack bot token (xoxb-*)
- `SLACK_SIGNING_SECRET`: Slack app signing secret
- `DATABASE_PATH`: Path to SQLite database (e.g., `/home/site/wwwroot/data/consensus.db`)

### Optional Environment Variables

- `NODE_ENV`: Environment (production/development)
- `LOG_LEVEL`: Logging level (ERROR/WARN/INFO/DEBUG)

## Deployment

See [REMINDER_DEPLOYMENT.md](../../docs/REMINDER_DEPLOYMENT.md) for complete deployment instructions.

### Quick Deploy to Azure

```bash
# Deploy using Azure Functions Core Tools
func azure functionapp publish <your-function-app-name>
```

## Local Testing

To test locally without deploying:

```bash
# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Start the function locally
cd azure-functions
func start
```

## Function Behavior

1. Triggers at 9:00 AM UTC on weekdays (Mon-Fri)
2. Queries database for active decisions with missing voters
3. Sends personalized DM reminders via Slack
4. Logs execution results to Azure Application Insights
5. Handles errors gracefully with retry logic

## Dependencies

The function reuses the core ConsensusBot modules:
- `src/utils/reminder.js` - Core reminder logic
- `src/utils/logger.js` - Logging utilities
- `src/database/db.js` - Database access
- `@slack/bolt` - Slack API client

## Monitoring

Monitor function execution through:
- Azure Portal > Function App > Monitor
- Application Insights dashboards
- Log Analytics queries
- Azure CLI: `az functionapp log tail --name <app-name> --resource-group <rg-name>`

## Error Handling

- **Configuration Errors**: Function throws immediately (missing env vars)
- **Slack API Errors**: Logged and tracked, function continues
- **Database Errors**: Logged, function returns error status
- **Critical Errors**: Thrown to trigger Azure retry mechanism
