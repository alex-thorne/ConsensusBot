# Output values from Terraform

output "resource_group_name" {
  description = "Name of the resource group"
  value       = azurerm_resource_group.consensusbot.name
}

output "resource_group_location" {
  description = "Location of the resource group"
  value       = azurerm_resource_group.consensusbot.location
}

output "function_app_name" {
  description = "Name of the Azure Function App"
  value       = var.deploy_function_app ? azurerm_linux_function_app.consensusbot[0].name : null
}

output "function_app_default_hostname" {
  description = "Default hostname of the Function App"
  value       = var.deploy_function_app ? azurerm_linux_function_app.consensusbot[0].default_hostname : null
}

output "function_app_identity_principal_id" {
  description = "Principal ID of the Function App managed identity"
  value       = var.deploy_function_app ? azurerm_linux_function_app.consensusbot[0].identity[0].principal_id : null
}

output "storage_account_name" {
  description = "Name of the storage account"
  value       = azurerm_storage_account.consensusbot.name
}

output "storage_account_primary_endpoint" {
  description = "Primary blob endpoint of the storage account"
  value       = azurerm_storage_account.consensusbot.primary_blob_endpoint
}

output "key_vault_name" {
  description = "Name of the Key Vault"
  value       = azurerm_key_vault.consensusbot.name
}

output "key_vault_uri" {
  description = "URI of the Key Vault"
  value       = azurerm_key_vault.consensusbot.vault_uri
}

output "application_insights_instrumentation_key" {
  description = "Application Insights instrumentation key"
  value       = azurerm_application_insights.consensusbot.instrumentation_key
  sensitive   = true
}

output "application_insights_connection_string" {
  description = "Application Insights connection string"
  value       = azurerm_application_insights.consensusbot.connection_string
  sensitive   = true
}

output "application_insights_app_id" {
  description = "Application Insights application ID"
  value       = azurerm_application_insights.consensusbot.app_id
}

# Deployment instructions
output "next_steps" {
  description = "Next steps for deployment"
  value = <<-EOT
    
    ========================================
    ConsensusBot Infrastructure Deployed!
    ========================================
    
    Resource Group: ${azurerm_resource_group.consensusbot.name}
    Location: ${azurerm_resource_group.consensusbot.location}
    Environment: ${var.environment}
    
    Next Steps:
    
    1. Store secrets in Key Vault:
       az keyvault secret set --vault-name ${azurerm_key_vault.consensusbot.name} --name slack-bot-token --value "YOUR_TOKEN"
       az keyvault secret set --vault-name ${azurerm_key_vault.consensusbot.name} --name slack-signing-secret --value "YOUR_SECRET"
       az keyvault secret set --vault-name ${azurerm_key_vault.consensusbot.name} --name slack-app-token --value "YOUR_TOKEN"
       az keyvault secret set --vault-name ${azurerm_key_vault.consensusbot.name} --name azure-devops-pat --value "YOUR_PAT"
    
    2. Deploy the application code:
       ${var.deploy_function_app ? "func azure functionapp publish ${azurerm_linux_function_app.consensusbot[0].name}" : "N/A - Function App not deployed"}
    
    3. Configure Slack app settings:
       - Event Subscriptions URL: ${var.deploy_function_app ? "https://${azurerm_linux_function_app.consensusbot[0].default_hostname}/api/slack/events" : "N/A"}
       - Interactivity URL: ${var.deploy_function_app ? "https://${azurerm_linux_function_app.consensusbot[0].default_hostname}/api/slack/interactive" : "N/A"}
    
    4. Monitor logs:
       - Application Insights: https://portal.azure.com/#resource${azurerm_application_insights.consensusbot.id}/overview
    
    ========================================
  EOT
}

