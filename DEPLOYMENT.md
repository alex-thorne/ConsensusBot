## Deploying ConsensusBot to Slack

This guide walks through deploying ConsensusBot using Slack's native ROSI
infrastructure.

### Prerequisites

1. **Slack CLI** installed
   ([installation guide](https://api.slack.com/automation/cli/install))
2. **Deno** installed (v1.37+)
   ([installation guide](https://deno.land/manual/getting_started/installation))
3. Slack workspace with admin permissions
4. Paid Slack plan (required for Datastores and ROSI features)

### Step 1: Authenticate with Slack

```bash
slack login
```

This opens a browser window to authorize the CLI with your workspace.

### Step 2: Create the App

From the repository root:

```bash
slack create
```

Select your workspace when prompted. This creates a new app instance in your
workspace.

### Step 3: Deploy the Application

```bash
slack deploy
```

This command:

- Compiles TypeScript to JavaScript
- Deploys functions, workflows, and datastores
- Configures app permissions
- Sets up the runtime environment

### Step 4: Create Triggers

Create the slash command trigger:

```bash
slack triggers create --trigger-def triggers/consensus_command.ts
```

Create the voting button trigger (essential for voting functionality):

```bash
slack triggers create --trigger-def triggers/vote_button_trigger.ts
```

Create the scheduled reminder trigger:

```bash
slack triggers create --trigger-def triggers/reminder_schedule.ts
```

#### One-command deploy + trigger setup

This repo includes a helper script that deploys the app and ensures required
triggers exist:

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

What it does:

- Runs `slack deploy`
- Ensures the `/consensus` trigger exists (creates it if missing)
- Ensures the scheduled reminder trigger exists (creates it if missing)

##### Why the reminder trigger is generated at deploy time

Slack requires `schedule.start_time` to be **in the future** when creating a
scheduled trigger. A static date in `triggers/reminder_schedule.ts` can drift
into the past and fail with:

`invalid_start_before_now`

So `scripts/deploy.sh` computes a future start time (next weekday at 09:00 UTC)
and generates a temporary trigger definition file for creation.

### Step 5: Verify Installation

1. In Slack, type `/consensus`
2. You should see a modal to create a new decision
3. Create a test decision and verify all features work

### Managing Environment Variables

If you need to add environment variables (e.g., for API keys):

```bash
# Add a new environment variable
slack env add MY_VAR_NAME

# List all environment variables
slack env list

# Remove an environment variable
slack env remove MY_VAR_NAME
```

### Viewing Logs

Monitor application logs in real-time:

```bash
slack activity --tail
```

Or view recent activity:

```bash
slack activity
```

### Updating the App

After making code changes:

```bash
slack deploy
```

The app will be redeployed with your changes.

### Removing the App

To delete the app from your workspace:

```bash
slack delete
```

⚠️ **Warning**: This removes all data from Datastores!

### Troubleshooting

#### Trigger not working

```bash
# List all triggers
slack triggers list

# Delete and recreate
slack triggers delete --trigger-id <trigger-id>
slack triggers create --trigger-def triggers/consensus_command.ts
```

#### Datastore errors

Ensure your workspace has a paid plan. Datastores require:

- Slack Pro plan or higher
- OR Enterprise Grid

#### Permission errors

Check that your app has the required bot scopes:

- `commands`
- `chat:write`
- `chat:write.public`
- `datastore:read`
- `datastore:write`
- `pins:write`
- `users:read`
- `im:write`

These are defined in `manifest.ts`.

### Production Deployment

For production deployments:

1. **Use a dedicated workspace** for production
2. **Set up monitoring** via `slack activity`
3. **Configure scheduled backups** (export Datastore data periodically)
4. **Test thoroughly** in a development workspace first
5. **Document any custom configurations** for your team

### Cost Considerations

Monitor your usage to stay within budget:

- Workflow executions: ~$0.10 per execution
- Datastore operations: ~$0.005 per 1K reads
- Scheduled triggers: ~$0.50 per execution

For low volume (<50 decisions/month): **$20-40/month**

### Support

- [Slack Automation Documentation](https://api.slack.com/automation)
- [Slack CLI Reference](https://api.slack.com/automation/cli)
- [GitHub Issues](https://github.com/alex-thorne/ConsensusBot/issues)

---

_Last updated: February 2026_
