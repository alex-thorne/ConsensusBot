# Migration Guide: Azure to Slack Native (ROSI)

This document provides step-by-step instructions for migrating from the Azure-based ConsensusBot architecture to the new Slack Native (ROSI) architecture.

## Overview

The migration involves:
1. Deploying the new Slack Native app
2. Exporting existing decisions (if any)
3. Decommissioning Azure infrastructure
4. Updating documentation

## Prerequisites

- **Deno** installed (v1.37+)
- **Slack CLI** installed
- Admin access to Slack workspace
- Admin access to Azure resources (for decommissioning)
- Access to any active decisions that need to be migrated

## Migration Steps

### Phase 1: Preparation (Week 1)

#### 1. Install Required Tools

```bash
# Install Deno
curl -fsSL https://deno.land/install.sh | sh

# Install Slack CLI (macOS)
brew install slack

# Or Linux
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash
```

#### 2. Authenticate with Slack

```bash
slack login
```

#### 3. Export Active Decisions

If you have active decisions in the old system:

```bash
# Connect to the old database and export
node export-decisions.js > active_decisions.json
```

Save this file for manual recreation in the new system.

### Phase 2: Deploy Slack Native App (Week 1-2)

#### 1. Clone the Updated Repository

```bash
git clone https://github.com/alex-thorne/ConsensusBot.git
cd ConsensusBot
git checkout slack-native
```

#### 2. Create the Slack App

```bash
slack create
```

Select your workspace when prompted.

#### 3. Deploy to Slack

```bash
slack deploy
```

#### 4. Create Triggers

```bash
# Slash command trigger
slack triggers create --trigger-def triggers/consensus_command.ts

# Scheduled reminder trigger
slack triggers create --trigger-def triggers/reminder_schedule.ts
```

#### 5. Test the App

In Slack, run:

```
/consensus
```

Create a test decision and verify:
- Modal opens correctly
- Decision is posted with voting buttons
- Votes can be cast
- ADR is generated upon finalization

### Phase 3: Parallel Run (Week 2)

Run both systems in parallel for 48 hours:

1. **Old System**: Keep Azure infrastructure running
2. **New System**: Use for all new decisions
3. **Monitoring**: Watch for any issues with the new system

During this period:
- Create new decisions only in the new system
- Monitor logs: `slack activity --tail`
- Verify reminder emails are sending
- Test ADR generation

### Phase 4: Data Migration (Week 2)

Manually recreate any active decisions from the old system:

1. For each decision in `active_decisions.json`:
   - Create a new decision via `/consensus`
   - Notify voters to re-cast their votes
   - Adjust deadline if needed

2. Archive finalized decisions:
   - Export ADRs from Azure DevOps (if applicable)
   - Keep historical records as-is
   - No need to import old data into new system

### Phase 5: Decommission Azure (Week 3)

Once the new system is stable and all active decisions are migrated:

#### 1. Stop Azure Resources

```bash
cd terraform

# Stop App Service (don't delete yet)
az webapp stop --name consensusbot-app --resource-group consensus-bot-rg

# Disable Azure Functions
az functionapp stop --name consensusbot-nudger --resource-group consensus-bot-rg
```

#### 2. Wait 7 Days

Monitor for any issues. If everything is working, proceed to permanent deletion.

#### 3. Delete Azure Resources

```bash
# Destroy all Azure infrastructure
terraform destroy

# Confirm when prompted
```

This will delete:
- App Service
- Azure Functions
- Key Vault
- Storage Accounts
- Application Insights
- All related resources

#### 4. Clean Up Azure DevOps

If you were using Azure DevOps for ADR storage:
- Keep existing ADRs in the repository
- Remove the PAT (Personal Access Token) used by the bot
- Update your ADR workflow documentation to reflect manual process

### Phase 6: Update Documentation (Week 3)

#### 1. Update README

Replace the old README with the Slack Native version:

```bash
mv README.md README_AZURE_OLD.md
mv README_SLACK_NATIVE.md README.md
git add README.md README_AZURE_OLD.md
git commit -m "Update README for Slack Native architecture"
```

#### 2. Archive Old Documentation

```bash
mkdir docs/archive
mv docs/AZURE_DEVOPS.md docs/archive/
mv docs/REMINDER_DEPLOYMENT.md docs/archive/
mv docs/DOCKER.md docs/archive/
```

#### 3. Update Deployment Guides

Create new deployment guide focused on Slack CLI:
- Remove Terraform instructions
- Remove Docker instructions
- Add Slack CLI deployment steps

## Rollback Plan

If you need to rollback to the Azure-based system:

### Within 7 Days (While Azure Resources Are Stopped)

1. Restart Azure resources:
   ```bash
   az webapp start --name consensusbot-app --resource-group consensus-bot-rg
   az functionapp start --name consensusbot-nudger --resource-group consensus-bot-rg
   ```

2. Disable Slack Native app:
   ```bash
   slack delete
   ```

3. Export any decisions from Slack Datastores

4. Reimport to Azure SQL database

### After 7 Days (Azure Resources Deleted)

If you deleted Azure resources but need to rollback:

1. Re-provision Azure infrastructure:
   ```bash
   cd terraform
   terraform init
   terraform apply
   ```

2. Redeploy Node.js application:
   ```bash
   npm install
   npm run deploy
   ```

3. Export decisions from Slack Datastores and import to database

## Cost Comparison

### Before Migration (Azure)
- App Service: $55/month
- Azure Functions: $5-15/month
- Key Vault: $3-5/month
- Storage: $2-5/month
- Application Insights: $106-186/month
- **Total: $171-266/month**
- **Maintenance: 8-12 hours/month**

### After Migration (Slack ROSI)
- Workflow executions: $5-15/month
- Datastore operations: $5-10/month
- Scheduled triggers: $10-15/month
- **Total: $20-40/month**
- **Maintenance: 1-2 hours/month**

**Savings: 85-90% reduction in costs**

## Troubleshooting

### Slack Native App Not Working

**Problem**: `/consensus` command not responding

**Solution**:
```bash
# Check trigger status
slack triggers list

# Recreate trigger if missing
slack triggers create --trigger-def triggers/consensus_command.ts
```

### Datastores Not Accessible

**Problem**: Error accessing datastores

**Solution**: Ensure your Slack plan includes Datastores (paid plans only)

### Reminders Not Sending

**Problem**: Voters not receiving reminder DMs

**Solution**:
```bash
# Check scheduled trigger
slack triggers list

# View logs
slack activity --tail

# Recreate trigger
slack triggers create --trigger-def triggers/reminder_schedule.ts
```

### Migration Data Loss

**Problem**: Lost active decisions during migration

**Solution**: Use the exported `active_decisions.json` to manually recreate decisions

## Post-Migration Checklist

- [ ] Slack Native app deployed and working
- [ ] All triggers created and active
- [ ] Test decision created successfully
- [ ] Voting buttons working
- [ ] ADR generation working
- [ ] Reminders sending correctly
- [ ] Active decisions migrated
- [ ] Azure resources stopped
- [ ] 7-day waiting period completed
- [ ] Azure resources deleted
- [ ] Documentation updated
- [ ] Team trained on new workflow
- [ ] Old README archived
- [ ] Cost savings verified

## Support

For migration support:
- Check the [Slack Native README](README.md)
- Review [Architecture Re-evaluation](docs/SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md)
- Open a GitHub issue
- Contact Slack support for ROSI-specific questions

## Timeline Summary

| Week | Activities | Estimated Hours |
|------|-----------|-----------------|
| 1 | Preparation, deployment, testing | 12 hours |
| 2 | Parallel run, data migration | 8 hours |
| 3 | Decommission Azure, update docs | 4 hours |
| **Total** | | **24 hours** |

**Payback Period**: 7-8 months based on cost savings

---

*Last Updated: February 2026*
