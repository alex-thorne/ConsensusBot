# Production Deployment Guide

This guide covers deploying ConsensusBot to production on Microsoft Azure.

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Azure Infrastructure Setup](#azure-infrastructure-setup)
3. [Application Deployment](#application-deployment)
4. [Post-Deployment Validation](#post-deployment-validation)
5. [Monitoring and Maintenance](#monitoring-and-maintenance)
6. [Rollback Procedures](#rollback-procedures)

---

## Pre-Deployment Checklist

### Prerequisites

- [ ] Azure subscription with sufficient permissions
- [ ] Azure CLI installed and configured
- [ ] Terraform installed (>= 1.0)
- [ ] Slack App configured (see [README.md](../README.md))
- [ ] Azure DevOps organization and repository (for ADR storage)
- [ ] All secrets ready (Slack tokens, Azure DevOps PAT)

### Required Tokens/Secrets

Gather the following before deployment:

1. **Slack Credentials**:
   - Bot Token (`SLACK_BOT_TOKEN`) - starts with `xoxb-`
   - Signing Secret (`SLACK_SIGNING_SECRET`)
   - App Token (`SLACK_APP_TOKEN`) - starts with `xapp-`

2. **Azure DevOps**:
   - Personal Access Token (`AZURE_DEVOPS_PAT`)
   - Organization name
   - Project name
   - Repository ID

3. **Azure**:
   - Subscription ID
   - Resource Group name (will be created)
   - Region (e.g., `eastus`)

### Code Preparation

1. **Ensure all tests pass**:
```bash
npm test
```

2. **Check code coverage**:
```bash
npm test -- --coverage
```
Target: >80% coverage ✅

3. **Verify build**:
```bash
npm run build
```

4. **Security audit**:
```bash
npm audit
```
Fix any high/critical vulnerabilities.

---

## Azure Infrastructure Setup

### Step 1: Login to Azure

```bash
az login
az account set --subscription "YOUR_SUBSCRIPTION_ID"
```

### Step 2: Initialize Terraform

```bash
cd terraform
terraform init
```

### Step 3: Configure Variables

Create `terraform.tfvars`:

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
# Basic Configuration
azure_region = "eastus"
environment  = "production"
project_name = "consensusbot"

# Application Insights
app_insights_retention_days = 365  # 1 year for production

# Storage
storage_replication_type = "GRS"  # Geo-redundant for production

# Function App
deploy_function_app   = true
app_service_plan_sku  = "P1v2"  # Premium plan for production

# Azure DevOps Configuration
azure_devops_organization = "your-organization"
azure_devops_project      = "your-project"
azure_devops_repository   = "your-repo-id"
```

**Important**: Do NOT set secrets in `terraform.tfvars`. They will be added to Key Vault after deployment.

### Step 4: Review Deployment Plan

```bash
terraform plan -out=tfplan
```

Review the plan carefully:
- Verify resource names
- Check SKUs and pricing
- Confirm no sensitive data is exposed

### Step 5: Deploy Infrastructure

```bash
terraform apply tfplan
```

This will create:
- Resource Group
- Storage Account
- Key Vault
- Application Insights
- App Service Plan
- Function App (with system-assigned managed identity)

**Deployment time**: ~5-10 minutes

### Step 6: Store Secrets in Key Vault

After infrastructure deployment:

```bash
# Get Key Vault name from Terraform output
KV_NAME=$(terraform output -raw key_vault_name)

# Store Slack secrets
az keyvault secret set \
  --vault-name $KV_NAME \
  --name slack-bot-token \
  --value "xoxb-YOUR-ACTUAL-TOKEN"

az keyvault secret set \
  --vault-name $KV_NAME \
  --name slack-signing-secret \
  --value "YOUR-SIGNING-SECRET"

az keyvault secret set \
  --vault-name $KV_NAME \
  --name slack-app-token \
  --value "xapp-YOUR-APP-TOKEN"

# Store Azure DevOps PAT
az keyvault secret set \
  --vault-name $KV_NAME \
  --name azure-devops-pat \
  --value "YOUR-AZURE-DEVOPS-PAT"
```

Verify secrets:
```bash
az keyvault secret list --vault-name $KV_NAME --query "[].name"
```

Expected output:
```json
[
  "azure-devops-pat",
  "slack-app-token",
  "slack-bot-token",
  "slack-signing-secret"
]
```

---

## Application Deployment

### Step 1: Install Azure Functions Core Tools

```bash
# macOS
brew tap azure/functions
brew install azure-functions-core-tools@4

# Windows
npm install -g azure-functions-core-tools@4

# Linux
curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg
sudo mv microsoft.gpg /etc/apt/trusted.gpg.d/microsoft.gpg
sudo sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/microsoft-ubuntu-$(lsb_release -cs)-prod $(lsb_release -cs) main" > /etc/apt/sources.list.d/dotnetdev.list'
sudo apt-get update
sudo apt-get install azure-functions-core-tools-4
```

### Step 2: Build Application Package

From project root:

```bash
# Install production dependencies
npm ci --only=production

# Create deployment package
zip -r consensusbot-deployment.zip \
  src/ \
  node_modules/ \
  package.json \
  package-lock.json \
  -x "*.test.js" \
  -x "test/*"
```

### Step 3: Deploy to Azure Functions

```bash
# Get Function App name from Terraform
FUNC_APP_NAME=$(terraform output -raw function_app_name)

# Deploy using Azure Functions Core Tools
cd ..  # Back to project root
func azure functionapp publish $FUNC_APP_NAME --javascript
```

**Alternative**: Deploy via Azure CLI:

```bash
az functionapp deployment source config-zip \
  --resource-group consensusbot-production-rg \
  --name $FUNC_APP_NAME \
  --src consensusbot-deployment.zip
```

**Deployment time**: ~2-5 minutes

### Step 4: Configure Function App Settings

Verify app settings are correctly configured:

```bash
az functionapp config appsettings list \
  --name $FUNC_APP_NAME \
  --resource-group consensusbot-production-rg \
  --query "[].{name:name, value:value}" \
  --output table
```

Key settings to verify:
- `SLACK_BOT_TOKEN` → Key Vault reference
- `SLACK_SIGNING_SECRET` → Key Vault reference
- `SLACK_APP_TOKEN` → Key Vault reference
- `AZURE_DEVOPS_PAT` → Key Vault reference
- `FUNCTIONS_WORKER_RUNTIME` → `node`
- `NODE_ENV` → `production`

---

## Post-Deployment Validation

### Step 1: Verify Function App is Running

```bash
# Check function app status
az functionapp show \
  --name $FUNC_APP_NAME \
  --resource-group consensusbot-production-rg \
  --query "state" \
  --output tsv
```

Expected: `Running`

### Step 2: Check Application Logs

```bash
# Stream logs
func azure functionapp logstream $FUNC_APP_NAME
```

Look for:
```
⚡️ Bolt app is running! (Socket Mode)
Database connection established
Consensus command registered successfully
Voting handlers registered successfully
```

### Step 3: Test Health Endpoint

```bash
FUNC_URL=$(terraform output -raw function_app_default_hostname)
curl https://$FUNC_URL/api/health
```

Expected: `{"status":"ok"}`

### Step 4: Test Slack Integration

In Slack:
1. Run `/consensus` command
2. Verify response message appears
3. Click "Create New Decision" button
4. Verify modal opens
5. Submit a test decision
6. Verify voting message is posted
7. Cast a vote
8. Verify vote is recorded

### Step 5: Verify Database

```bash
# SSH into Function App (Kudu)
az functionapp browse --name $FUNC_APP_NAME --resource-group consensusbot-production-rg

# Navigate to Debug Console → CMD
# Check database file exists
ls /home/data/consensus.db
```

### Step 6: Monitor Application Insights

```bash
# Get Application Insights ID
APP_INSIGHTS_ID=$(terraform output -raw application_insights_app_id)

# View recent exceptions
az monitor app-insights metrics show \
  --app $APP_INSIGHTS_ID \
  --metric exceptions/count \
  --interval PT1H
```

---

## Monitoring and Maintenance

### Application Insights Dashboard

Access via Azure Portal:
1. Navigate to Application Insights resource
2. Review:
   - **Failures**: Exceptions and failed requests
   - **Performance**: Response times and dependencies
   - **Metrics**: Request rate, availability
   - **Live Metrics**: Real-time performance

### Set Up Alerts

Create alerts for critical metrics:

```bash
# Alert on function failures
az monitor metrics alert create \
  --name consensusbot-function-failures \
  --resource-group consensusbot-production-rg \
  --scopes /subscriptions/SUBSCRIPTION_ID/resourceGroups/consensusbot-production-rg/providers/Microsoft.Web/sites/$FUNC_APP_NAME \
  --condition "count requests/failed > 10" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --action <action-group-id>
```

### Database Backup Strategy

**Automated Backups** (using Azure Function Timer Trigger):

Create `BackupDatabase/function.json`:
```json
{
  "bindings": [
    {
      "name": "timer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 0 2 * * *"
    }
  ]
}
```

Create backup script to copy database to Azure Storage.

**Manual Backup**:
```bash
# Download current database
az functionapp deployment source download \
  --name $FUNC_APP_NAME \
  --resource-group consensusbot-production-rg

# Or use Kudu to download /home/data/consensus.db
```

### Log Management

**View Logs**:
```bash
# Real-time logs
func azure functionapp logstream $FUNC_APP_NAME

# Historical logs via Application Insights
az monitor app-insights query \
  --app $APP_INSIGHTS_ID \
  --analytics-query "traces | where timestamp > ago(1h) | order by timestamp desc"
```

**Log Retention**:
- Application Insights: 365 days (configured in terraform)
- Function App logs: 7 days

### Cost Monitoring

**View current month costs**:
```bash
az consumption usage list \
  --start-date $(date -d "first day of this month" +%Y-%m-%d) \
  --end-date $(date +%Y-%m-%d) \
  --query "[?contains(instanceName, 'consensusbot')]" \
  --output table
```

**Expected monthly costs** (Production):
- Function App (P1v2): ~$146
- Storage: ~$10
- Application Insights: ~$20-100 (depends on usage)
- Key Vault: ~$0.03
- **Total**: ~$176-256/month

---

## Rollback Procedures

### Rollback to Previous Version

If deployment fails or causes issues:

**Option 1: Redeploy previous version**
```bash
# Deploy previous Git commit
git checkout <previous-commit-sha>
npm ci --only=production
func azure functionapp publish $FUNC_APP_NAME
```

**Option 2: Use deployment slots**
```bash
# Swap staging and production slots
az functionapp deployment slot swap \
  --name $FUNC_APP_NAME \
  --resource-group consensusbot-production-rg \
  --slot staging \
  --target-slot production
```

### Restore Database

```bash
# Stop Function App
az functionapp stop --name $FUNC_APP_NAME --resource-group consensusbot-production-rg

# Download backup
az storage blob download \
  --account-name consensusbotprodstorage \
  --container-name database-backups \
  --name consensus-backup-YYYY-MM-DD.db \
  --file consensus.db

# Upload to Function App (use Kudu or FTP)

# Restart Function App
az functionapp start --name $FUNC_APP_NAME --resource-group consensusbot-production-rg
```

### Emergency Shutdown

If critical issue detected:

```bash
# Stop Function App immediately
az functionapp stop \
  --name $FUNC_APP_NAME \
  --resource-group consensusbot-production-rg

# Notify team
# Investigate issue
# Fix and redeploy
# Restart when ready

az functionapp start \
  --name $FUNC_APP_NAME \
  --resource-group consensusbot-production-rg
```

---

## Security Best Practices

### Secrets Rotation

Rotate secrets every 90 days:

```bash
# Generate new PAT in Azure DevOps
# Update Key Vault
az keyvault secret set \
  --vault-name $KV_NAME \
  --name azure-devops-pat \
  --value "NEW-PAT"

# Restart Function App to pick up new secret
az functionapp restart \
  --name $FUNC_APP_NAME \
  --resource-group consensusbot-production-rg
```

### Network Security

For production, restrict Key Vault access:

```bash
# Get Function App outbound IP
OUTBOUND_IPS=$(az functionapp show \
  --name $FUNC_APP_NAME \
  --resource-group consensusbot-production-rg \
  --query "outboundIpAddresses" \
  --output tsv)

# Update Key Vault firewall
az keyvault network-rule add \
  --name $KV_NAME \
  --ip-address $OUTBOUND_IPS
```

### Access Control

Use Azure RBAC:

```bash
# Grant user Contributor access to resource group
az role assignment create \
  --assignee user@domain.com \
  --role Contributor \
  --resource-group consensusbot-production-rg
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing (166/166)
- [ ] Code review completed
- [ ] Security scan completed (no high/critical vulnerabilities)
- [ ] Secrets prepared
- [ ] Terraform plan reviewed
- [ ] Stakeholders notified

### During Deployment
- [ ] Infrastructure deployed via Terraform
- [ ] Secrets stored in Key Vault
- [ ] Application deployed to Function App
- [ ] Health check passes
- [ ] Slack integration tested
- [ ] Database created successfully

### Post-Deployment
- [ ] Application Insights configured
- [ ] Alerts set up
- [ ] Backup strategy implemented
- [ ] Documentation updated
- [ ] Team trained on monitoring
- [ ] Rollback plan tested

---

## Support and Escalation

### Issue Severity Levels

**P0 - Critical** (Response: Immediate)
- Application down
- Security breach
- Data loss

**P1 - High** (Response: <1 hour)
- Major feature broken
- Performance degradation >50%

**P2 - Medium** (Response: <4 hours)
- Minor feature broken
- Workaround available

**P3 - Low** (Response: <24 hours)
- Cosmetic issues
- Enhancement requests

### Contact Information

- **On-Call Engineer**: [Contact info]
- **Team Lead**: [Contact info]
- **Azure Support**: https://portal.azure.com/#blade/Microsoft_Azure_Support/HelpAndSupportBlade

### Escalation Path

1. Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. Review Application Insights logs
3. Contact on-call engineer
4. Escalate to team lead if not resolved in 30 minutes
5. Contact Azure Support for infrastructure issues

---

## Continuous Deployment

For automated deployments, see [.github/workflows/](../.github/workflows/) for CI/CD pipeline configuration.

---

## Additional Resources

- [Azure Functions Documentation](https://docs.microsoft.com/en-us/azure/azure-functions/)
- [Terraform Azure Provider](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs)
- [Slack App Management](https://api.slack.com/apps)
- [Application Insights](https://docs.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
