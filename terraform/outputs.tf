output "app_service_url" {
  description = "URL of the ConsensusBot App Service"
  value       = azurerm_linux_web_app.consensusbot.default_hostname
}

output "app_service_principal_id" {
  description = "Principal ID of the App Service managed identity"
  value       = azurerm_linux_web_app.consensusbot.identity[0].principal_id
}

output "nudger_function_url" {
  description = "URL of the Nudger Function App"
  value       = azurerm_linux_function_app.nudger.default_hostname
}

output "nudger_principal_id" {
  description = "Principal ID of the Nudger Function managed identity"
  value       = azurerm_linux_function_app.nudger.identity[0].principal_id
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
