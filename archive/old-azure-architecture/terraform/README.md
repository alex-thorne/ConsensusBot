# Terraform Infrastructure for ConsensusBot

This directory contains the Infrastructure as Code (IaC) for deploying ConsensusBot to Microsoft Azure.

## Architecture

The infrastructure includes:

- **Resource Group**: Container for all resources
- **Azure Functions**: Serverless compute for the Slack bot and reminder scheduler
- **App Service Plan**: Hosting plan for Azure Functions (Consumption or Dedicated)
- **Storage Account**: For function code, database backups, and ADR archives
- **Key Vault**: Secure storage for secrets (Slack tokens, Azure DevOps PAT)
- **Application Insights**: Monitoring, logging, and diagnostics

## Prerequisites

1. **Azure CLI** - [Install Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli)
2. **Terraform** - [Install Terraform](https://www.terraform.io/downloads.html) (>= 1.0)
3. **Azure Subscription** - Active Azure subscription with appropriate permissions

## Quick Start

### 1. Login to Azure

```bash
az login
az account set --subscription "YOUR_SUBSCRIPTION_ID"
```

### 2. Initialize Terraform

```bash
cd terraform
terraform init
```

### 3. Configure Variables

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
```

**Important**: Never commit `terraform.tfvars` to version control!

### 4. Plan Deployment

```bash
terraform plan
```

Review the plan to ensure resources match expectations.

### 5. Deploy Infrastructure

```bash
terraform apply
```

Type `yes` when prompted to confirm deployment.

### 6. Configure Secrets

After infrastructure deployment, store secrets in Key Vault:

```bash
# Get Key Vault name from Terraform outputs
KV_NAME=$(terraform output -raw key_vault_name)

# Store Slack secrets
az keyvault secret set --vault-name $KV_NAME --name slack-bot-token --value "xoxb-..."
az keyvault secret set --vault-name $KV_NAME --name slack-signing-secret --value "..."
az keyvault secret set --vault-name $KV_NAME --name slack-app-token --value "xapp-..."

# Store Azure DevOps PAT
az keyvault secret set --vault-name $KV_NAME --name azure-devops-pat --value "..."
```

## Resource Naming Convention

Resources are named using the pattern: `{project_name}-{environment}-{resource_type}`

Examples:
- `consensusbot-production-rg` (Resource Group)
- `consensusbot-production-func` (Function App)
- `consensusbot-production-kv` (Key Vault)

## Environment Configuration

### Development
```hcl
environment             = "development"
app_service_plan_sku    = "Y1"  # Consumption plan (pay per execution)
storage_replication_type = "LRS"  # Locally redundant
app_insights_retention_days = 30
```

### Production
```hcl
environment             = "production"
app_service_plan_sku    = "P1v2"  # Premium plan (always on)
storage_replication_type = "GRS"  # Geo-redundant
app_insights_retention_days = 365
```

## Key Vault Integration

The Function App uses **system-assigned managed identity** to access Key Vault secrets. App settings reference secrets using this syntax:

```
@Microsoft.KeyVault(SecretUri=https://your-kv.vault.azure.net/secrets/secret-name/)
```

This provides:
- ✅ No hardcoded secrets in configuration
- ✅ Automatic secret rotation support
- ✅ Audit logging for secret access
- ✅ Centralized secret management

## Database Strategy

The application uses **SQLite** stored in the Function App's filesystem:
- Path: `/home/data/consensus.db`
- Backups: Scheduled to Azure Storage container `database-backups`
- Limitations: Single instance only (no horizontal scaling)

### Alternative: Azure SQL Database

For production scenarios requiring high availability, consider migrating to Azure SQL Database:

```hcl
resource "azurerm_mssql_server" "consensusbot" {
  # Configuration here
}
```

## Monitoring

Application Insights provides:
- Request/response logging
- Exception tracking
- Performance metrics
- Custom event telemetry
- Live metrics stream

Access via: Azure Portal → Application Insights → {app-name}

## Cost Estimation

### Development (Consumption Plan)
- Function App: ~$0-20/month (depends on executions)
- Storage Account: ~$1-5/month
- Key Vault: ~$0.03/month
- Application Insights: ~$2-10/month
- **Total**: ~$5-35/month

### Production (Premium Plan)
- Function App: ~$146/month (P1v2)
- Storage Account: ~$5-20/month
- Key Vault: ~$0.03/month
- Application Insights: ~$20-100/month
- **Total**: ~$171-266/month

*Costs are estimates based on East US region. Actual costs may vary.*

## Security Best Practices

1. **Secrets Management**
   - ✅ All secrets stored in Key Vault
   - ✅ Managed identity for authentication
   - ✅ No secrets in code or Terraform state

2. **Network Security**
   - Configure Key Vault firewall for production
   - Enable private endpoints for Function App
   - Restrict storage account access

3. **Access Control**
   - Use Azure RBAC for resource access
   - Limit Key Vault access policies
   - Enable audit logging

## Disaster Recovery

### Backup Strategy
1. **Database**: Automated backups to Azure Storage
2. **Code**: Version controlled in Git
3. **Infrastructure**: Terraform state (enable remote backend)

### Recovery Steps
1. Deploy infrastructure from Terraform
2. Restore database from backup
3. Deploy application code
4. Configure secrets in Key Vault

## Terraform State Management

For production, enable remote state storage:

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "consensusbot-terraform-state"
    storage_account_name = "consensusbottfstate"
    container_name       = "tfstate"
    key                  = "terraform.tfstate"
  }
}
```

Create the backend storage manually before initializing:

```bash
az group create --name consensusbot-terraform-state --location eastus
az storage account create --name consensusbottfstate --resource-group consensusbot-terraform-state --sku Standard_LRS
az storage container create --name tfstate --account-name consensusbottfstate
```

## Troubleshooting

### Issue: Key Vault access denied
**Solution**: Ensure you have `Secret Management` permissions in Key Vault access policies.

### Issue: Function App won't start
**Solution**: Check Application Insights logs for errors. Verify all Key Vault references are correct.

### Issue: Terraform state lock timeout
**Solution**: Check for existing locks in the storage account, or run `terraform force-unlock`.

## Cleanup

To destroy all resources:

```bash
terraform destroy
```

⚠️ **Warning**: This will delete ALL resources including data. Ensure you have backups!

## Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `azure_region` | Azure region for resources | `eastus` | No |
| `environment` | Environment name | `development` | No |
| `project_name` | Project name for resources | `consensusbot` | No |
| `deploy_function_app` | Deploy Function App | `true` | No |
| `app_service_plan_sku` | App Service Plan SKU | `Y1` | No |
| `storage_replication_type` | Storage replication | `LRS` | No |
| `app_insights_retention_days` | Log retention days | `90` | No |
| `azure_devops_organization` | Azure DevOps org | `""` | Yes* |
| `azure_devops_project` | Azure DevOps project | `""` | Yes* |
| `azure_devops_repository` | Azure DevOps repo ID | `""` | Yes* |
| `slack_bot_token` | Slack bot token | `""` | Yes* |
| `slack_signing_secret` | Slack signing secret | `""` | Yes* |
| `slack_app_token` | Slack app token | `""` | Yes* |
| `azure_devops_pat` | Azure DevOps PAT | `""` | Yes* |

*Required for full functionality but can be set after deployment via Key Vault.

## Outputs Reference

After deployment, Terraform provides:

- `resource_group_name` - Name of the resource group
- `function_app_name` - Name of the Function App
- `function_app_default_hostname` - Function App URL
- `key_vault_name` - Name of the Key Vault
- `key_vault_uri` - Key Vault URI
- `storage_account_name` - Storage account name
- `application_insights_app_id` - App Insights ID

View outputs:
```bash
terraform output
```

## Support

For issues or questions:
1. Check the main [README.md](../README.md)
2. Review [TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)
3. Open an issue on GitHub
