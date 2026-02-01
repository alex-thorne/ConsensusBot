# Infrastructure Setup Guide

## Prerequisites

Before deploying ConsensusBot, ensure you have:

1. **Azure Account**: Active subscription with Owner or Contributor role
2. **Slack Workspace**: Admin access to create and configure apps
3. **Azure DevOps**: Organization with repository access
4. **Development Tools**:
   - Terraform >= 1.0
   - Azure CLI >= 2.40
   - Git
   - Python 3.11+ (for local development)

## Step-by-Step Deployment

### 1. Initial Setup

```bash
# Clone repository
git clone https://github.com/alex-thorne/ConsensusBot.git
cd ConsensusBot

# Login to Azure
az login
az account set --subscription "your-subscription-id"
```

### 2. Create Slack App

#### 2.1 Create App

1. Navigate to https://api.slack.com/apps
2. Click **Create New App** → **From scratch**
3. App Name: `ConsensusBot`
4. Workspace: Select your workspace
5. Click **Create App**

#### 2.2 Configure OAuth Scopes

Navigate to **OAuth & Permissions** → **Scopes**:

**Bot Token Scopes**:
```
channels:read       - List public channels
chat:write         - Send messages as bot
chat:write.public  - Send to channels without joining
commands           - Respond to slash commands
im:write           - Send direct messages
pins:read          - Read pinned messages
pins:write         - Pin/unpin messages
users:read         - Get user information
```

#### 2.3 Enable Interactive Components

Navigate to **Interactivity & Shortcuts**:
- Toggle **Interactivity**: ON
- **Request URL**: `https://<placeholder>.azurewebsites.net/slack/interactions`
  - ⚠️ We'll update this after deploying infrastructure

#### 2.4 Create Slash Command

Navigate to **Slash Commands** → **Create New Command**:
- **Command**: `/consensus`
- **Request URL**: `https://<placeholder>.azurewebsites.net/slack/commands`
  - ⚠️ We'll update this after deploying infrastructure
- **Short Description**: `Start a team decision`
- **Usage Hint**: `"decision text" @user1 @user2 --deadline YYYY-MM-DD`

#### 2.5 Install App

Navigate to **Install App**:
1. Click **Install to Workspace**
2. Review permissions and click **Allow**
3. **Save these values** (you'll need them soon):
   - **Bot User OAuth Token**: Starts with `xoxb-` (from OAuth & Permissions page)
   - **Signing Secret**: Found under Basic Information → App Credentials

### 3. Azure DevOps Setup

#### 3.1 Create Repository (if needed)

```bash
# Create new repo via Azure DevOps UI or CLI
az repos create --name KB.ProcessDocs --project YourProject --org https://dev.azure.com/YourOrg
```

#### 3.2 Create Personal Access Token

1. Go to https://dev.azure.com/YourOrg
2. Click user icon → **Personal access tokens**
3. Click **New Token**
4. Settings:
   - **Name**: ConsensusBot
   - **Organization**: Your org
   - **Scopes**: 
     - Code: **Read & Write**
5. Click **Create**
6. **Save the token** (you won't see it again)

#### 3.3 Create decisions folder

```bash
# Clone the repo
git clone https://YourOrg@dev.azure.com/YourOrg/YourProject/_git/KB.ProcessDocs
cd KB.ProcessDocs

# Create decisions directory
mkdir -p decisions
echo "# Architecture Decision Records" > decisions/README.md
git add decisions/
git commit -m "Add decisions folder for ADRs"
git push
```

### 4. Configure Terraform

#### 4.1 Create Variables File

Create `terraform/terraform.tfvars`:

```hcl
# Resource naming (must be globally unique for Azure)
resource_group_name = "consensusbot-rg"
app_name            = "consensusbot-yourorg"  # Change 'yourorg' to something unique

# Azure region
location = "East US"

# Environment
environment = "production"

# App Service Plan (B1 = Basic, S1 = Standard, P1V2 = Premium)
app_service_plan_sku = "B1"

# Slack configuration
# Note: These are placeholders. Real values set in Key Vault after deployment
slack_bot_token      = "placeholder"
slack_signing_secret = "placeholder"

# Azure DevOps configuration
azure_devops_org     = "YourOrg"
azure_devops_project = "YourProject"
azure_devops_repo    = "KB.ProcessDocs"
azure_devops_pat     = "placeholder"

# Nudger configuration
nudge_schedule = "0 0 * * * *"  # Every hour

# Comma-separated list of Slack channel IDs to monitor
# Get IDs by right-clicking channel → View channel details → Copy ID
decision_channel_ids = "C01234567,C89ABCDEF"
```

#### 4.2 Validate Configuration

```bash
cd terraform

# Initialize Terraform
terraform init

# Validate configuration
terraform validate

# Preview changes
terraform plan
```

Review the plan output. You should see resources being created:
- Resource Group
- App Service Plan
- Linux Web App (main bot)
- Storage Account
- Linux Function App (nudger)
- Key Vault
- Log Analytics Workspace
- Application Insights

**No database resources should appear.**

### 5. Deploy Infrastructure

```bash
# Apply configuration
terraform apply

# Type 'yes' when prompted
```

Deployment takes ~5-10 minutes. Save the outputs:

```bash
# After successful deployment
terraform output

# Example output:
# app_service_url = "consensusbot-yourorg.azurewebsites.net"
# key_vault_name = "consensusbot-yourorg-kv"
# nudger_function_url = "consensusbot-yourorg-nudger.azurewebsites.net"
```

### 6. Configure Secrets in Key Vault

#### 6.1 Get Key Vault Name

```bash
KV_NAME=$(cd terraform && terraform output -raw key_vault_name)
echo $KV_NAME
```

#### 6.2 Set Slack Secrets

```bash
# Set Slack Bot Token (from step 2.5)
az keyvault secret set \
  --vault-name $KV_NAME \
  --name slack-bot-token \
  --value "xoxb-your-actual-token-here"

# Set Slack Signing Secret (from step 2.5)
az keyvault secret set \
  --vault-name $KV_NAME \
  --name slack-signing-secret \
  --value "your-actual-signing-secret-here"
```

#### 6.3 Set Azure DevOps Secret

```bash
# Set Azure DevOps PAT (from step 3.2)
az keyvault secret set \
  --vault-name $KV_NAME \
  --name azure-devops-pat \
  --value "your-actual-pat-here"
```

#### 6.4 Verify Secrets

```bash
az keyvault secret list --vault-name $KV_NAME --query "[].name"

# Expected output:
# [
#   "azure-devops-pat",
#   "slack-bot-token",
#   "slack-signing-secret"
# ]
```

### 7. Update Slack App URLs

Now that infrastructure is deployed, update Slack app with real URLs:

```bash
APP_URL=$(cd terraform && terraform output -raw app_service_url)
echo "App Service URL: https://$APP_URL"
```

#### 7.1 Update Interactive Components

1. Go to https://api.slack.com/apps
2. Select your ConsensusBot app
3. Navigate to **Interactivity & Shortcuts**
4. Update **Request URL**: `https://$APP_URL/slack/interactions`
5. Click **Save Changes**

#### 7.2 Update Slash Command

1. Navigate to **Slash Commands**
2. Click on `/consensus` command
3. Update **Request URL**: `https://$APP_URL/slack/commands`
4. Click **Save**

### 8. Deploy Application Code

⚠️ **Note**: This repository contains infrastructure setup only. The application code deployment is separate.

For now, verify infrastructure is ready:

```bash
# Check App Service status
az webapp show \
  --name consensusbot-yourorg \
  --resource-group consensusbot-rg \
  --query "state"
# Should output: "Running"

# Check Function App status
az functionapp show \
  --name consensusbot-yourorg-nudger \
  --resource-group consensusbot-rg \
  --query "state"
# Should output: "Running"
```

When you have application code:

```bash
# Deploy to App Service (example)
cd src
zip -r app.zip .
az webapp deployment source config-zip \
  --resource-group consensusbot-rg \
  --name consensusbot-yourorg \
  --src app.zip

# Deploy Function App (example)
cd nudger
func azure functionapp publish consensusbot-yourorg-nudger
```

### 9. Verify Deployment

#### 9.1 Check Health Endpoints

```bash
# Test App Service health (once code is deployed)
curl https://$APP_URL/health

# Expected: {"status": "healthy"}
```

#### 9.2 Check Logs

```bash
# Stream App Service logs
az webapp log tail \
  --name consensusbot-yourorg \
  --resource-group consensusbot-rg

# Stream Function App logs
az functionapp log tail \
  --name consensusbot-yourorg-nudger \
  --resource-group consensusbot-rg
```

#### 9.3 Test in Slack

1. Open your Slack workspace
2. Go to any channel
3. Type: `/consensus "Test decision" @yourself --deadline 2026-02-15`
4. Click **Send**
5. Bot should respond with a pinned message and voting buttons

### 10. Configure Monitoring

#### 10.1 Set Up Alerts

```bash
# Get Application Insights name
AI_NAME=$(cd terraform && terraform output -raw application_insights_name || echo "consensusbot-yourorg-insights")

# Create alert for failed requests
az monitor metrics alert create \
  --name consensusbot-failed-requests \
  --resource-group consensusbot-rg \
  --scopes /subscriptions/$(az account show --query id -o tsv)/resourceGroups/consensusbot-rg/providers/Microsoft.Insights/components/$AI_NAME \
  --condition "count requests/failed > 10" \
  --description "Alert when failed requests exceed 10" \
  --evaluation-frequency 5m \
  --window-size 15m
```

#### 10.2 View Application Insights

1. Go to Azure Portal: https://portal.azure.com
2. Navigate to **Application Insights** → `consensusbot-yourorg-insights`
3. Explore:
   - **Live Metrics**: Real-time telemetry
   - **Failures**: Error analysis
   - **Performance**: Response times
   - **Logs**: Query application logs

## Post-Deployment Configuration

### Add ConsensusBot to Channels

1. In Slack, navigate to channels where you want decisions
2. Type: `/invite @ConsensusBot`
3. Bot will join the channel

### Configure Channel IDs for Nudger

Get channel IDs:
1. Right-click channel name → **View channel details**
2. Scroll to bottom → Copy **Channel ID**

Update environment variable:

```bash
az webapp config appsettings set \
  --name consensusbot-yourorg \
  --resource-group consensusbot-rg \
  --settings DECISION_CHANNEL_IDS="C01234567,C89ABCDEF"

az functionapp config appsettings set \
  --name consensusbot-yourorg-nudger \
  --resource-group consensusbot-rg \
  --settings DECISION_CHANNEL_IDS="C01234567,C89ABCDEF"
```

## Infrastructure Management

### View Current Infrastructure

```bash
cd terraform
terraform show
```

### Update Infrastructure

Edit `terraform.tfvars`, then:

```bash
terraform plan
terraform apply
```

### Destroy Infrastructure

⚠️ **WARNING**: This will delete all resources including Key Vault (with soft-delete).

```bash
cd terraform
terraform destroy
```

To completely remove Key Vault:

```bash
# List deleted Key Vaults
az keyvault list-deleted

# Purge specific vault
az keyvault purge --name $KV_NAME
```

## Cost Estimation

Estimated monthly costs (US East):

| Resource | SKU | Est. Cost |
|----------|-----|-----------|
| App Service Plan | B1 | ~$13 |
| Storage Account | Standard LRS | ~$1 |
| Key Vault | Standard | ~$0.50 |
| Application Insights | Pay-as-you-go | ~$5-20 |
| **Total** | | **~$20-35/month** |

Notes:
- No database costs! 🎉
- Costs scale with usage
- B1 plan suitable for small teams
- Upgrade to S1 or P1V2 for production at scale

## Troubleshooting Deployment

### Issue: Terraform "Name already exists"

**Symptom**: `Error: Name "consensusbot" already exists`

**Solution**: App Service names must be globally unique. Change `app_name` in `terraform.tfvars`:

```hcl
app_name = "consensusbot-yourorg-prod"  # Add unique suffix
```

### Issue: Key Vault access denied

**Symptom**: `Error: Authorization failed for Key Vault`

**Solution**: Ensure you have Key Vault Administrator role:

```bash
az role assignment create \
  --role "Key Vault Administrator" \
  --assignee your.email@company.com \
  --scope /subscriptions/$(az account show --query id -o tsv)
```

### Issue: Function App won't start

**Symptom**: Function App shows "Stopped" state

**Solution**:

```bash
# Start Function App
az functionapp start \
  --name consensusbot-yourorg-nudger \
  --resource-group consensusbot-rg

# Check logs for errors
az functionapp log tail \
  --name consensusbot-yourorg-nudger \
  --resource-group consensusbot-rg
```

### Issue: Secrets not loading

**Symptom**: App logs show "KeyVault secret not found"

**Solution**: Verify managed identity has access:

```bash
# Get App Service principal ID
PRINCIPAL_ID=$(az webapp identity show \
  --name consensusbot-yourorg \
  --resource-group consensusbot-rg \
  --query principalId -o tsv)

# Grant access
az keyvault set-policy \
  --name $KV_NAME \
  --object-id $PRINCIPAL_ID \
  --secret-permissions get list
```

## Next Steps

After infrastructure is deployed:

1. ✅ Slack app configured with correct URLs
2. ✅ Secrets stored in Key Vault
3. ✅ Azure DevOps PAT created
4. ⏭️ Deploy application code
5. ⏭️ Test complete decision flow
6. ⏭️ Configure monitoring alerts
7. ⏭️ Document team usage guidelines

See [TESTING.md](TESTING.md) for validation steps.