terraform {
  required_version = ">= 1.0"
  
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = true
    }
  }
}

# Resource Group
resource "azurerm_resource_group" "consensusbot" {
  name     = var.resource_group_name
  location = var.location
  
  tags = {
    Application = "ConsensusBot"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# App Service Plan for hosting the bot
resource "azurerm_service_plan" "consensusbot" {
  name                = "${var.app_name}-plan"
  resource_group_name = azurerm_resource_group.consensusbot.name
  location            = azurerm_resource_group.consensusbot.location
  os_type             = "Linux"
  sku_name            = var.app_service_plan_sku
  
  tags = {
    Application = "ConsensusBot"
    Environment = var.environment
  }
}

# App Service for the main bot application
resource "azurerm_linux_web_app" "consensusbot" {
  name                = var.app_name
  resource_group_name = azurerm_resource_group.consensusbot.name
  location            = azurerm_resource_group.consensusbot.location
  service_plan_id     = azurerm_service_plan.consensusbot.id
  
  site_config {
    always_on = true
    
    application_stack {
      python_version = "3.11"
    }
    
    cors {
      allowed_origins = ["https://slack.com"]
    }
  }
  
  app_settings = {
    "SLACK_BOT_TOKEN"           = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.slack_bot_token.id})"
    "SLACK_SIGNING_SECRET"      = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.slack_signing_secret.id})"
    "AZURE_DEVOPS_PAT"          = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.azure_devops_pat.id})"
    "AZURE_DEVOPS_ORG"          = var.azure_devops_org
    "AZURE_DEVOPS_PROJECT"      = var.azure_devops_project
    "AZURE_DEVOPS_REPO"         = var.azure_devops_repo
    "APPINSIGHTS_INSTRUMENTATIONKEY" = azurerm_application_insights.consensusbot.instrumentation_key
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.consensusbot.connection_string
  }
  
  identity {
    type = "SystemAssigned"
  }
  
  tags = {
    Application = "ConsensusBot"
    Environment = var.environment
  }
}

# Storage Account for Azure Functions
resource "azurerm_storage_account" "consensusbot" {
  name                     = "${var.app_name}storage"
  resource_group_name      = azurerm_resource_group.consensusbot.name
  location                 = azurerm_resource_group.consensusbot.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  
  tags = {
    Application = "ConsensusBot"
    Environment = var.environment
  }
}

# Azure Function for the Nudger (reminder system)
resource "azurerm_linux_function_app" "nudger" {
  name                       = "${var.app_name}-nudger"
  resource_group_name        = azurerm_resource_group.consensusbot.name
  location                   = azurerm_resource_group.consensusbot.location
  service_plan_id            = azurerm_service_plan.consensusbot.id
  storage_account_name       = azurerm_storage_account.consensusbot.name
  storage_account_access_key = azurerm_storage_account.consensusbot.primary_access_key
  
  site_config {
    application_stack {
      python_version = "3.11"
    }
  }
  
  app_settings = {
    "SLACK_BOT_TOKEN"           = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.slack_bot_token.id})"
    "SLACK_SIGNING_SECRET"      = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.slack_signing_secret.id})"
    "NUDGE_SCHEDULE"            = var.nudge_schedule
    "DECISION_CHANNEL_IDS"      = var.decision_channel_ids
    "APPINSIGHTS_INSTRUMENTATIONKEY" = azurerm_application_insights.consensusbot.instrumentation_key
    "FUNCTIONS_WORKER_RUNTIME" = "python"
  }
  
  identity {
    type = "SystemAssigned"
  }
  
  tags = {
    Application = "ConsensusBot"
    Environment = var.environment
    Component   = "Nudger"
  }
}

# Get current client configuration for Key Vault access
data "azurerm_client_config" "current" {}

# Azure Key Vault for secrets
resource "azurerm_key_vault" "consensusbot" {
  name                        = "${var.app_name}-kv"
  location                    = azurerm_resource_group.consensusbot.location
  resource_group_name         = azurerm_resource_group.consensusbot.name
  enabled_for_disk_encryption = true
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  soft_delete_retention_days  = 7
  purge_protection_enabled    = false
  sku_name                    = "standard"
  
  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = data.azurerm_client_config.current.object_id
    
    key_permissions = [
      "Get", "List", "Create", "Delete", "Update"
    ]
    
    secret_permissions = [
      "Get", "List", "Set", "Delete", "Purge"
    ]
  }
  
  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = azurerm_linux_web_app.consensusbot.identity[0].principal_id
    
    secret_permissions = [
      "Get", "List"
    ]
  }
  
  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = azurerm_linux_function_app.nudger.identity[0].principal_id
    
    secret_permissions = [
      "Get", "List"
    ]
  }
  
  tags = {
    Application = "ConsensusBot"
    Environment = var.environment
  }
}

# Key Vault Secrets (values to be set manually or via CI/CD)
resource "azurerm_key_vault_secret" "slack_bot_token" {
  name         = "slack-bot-token"
  value        = var.slack_bot_token
  key_vault_id = azurerm_key_vault.consensusbot.id
}

resource "azurerm_key_vault_secret" "slack_signing_secret" {
  name         = "slack-signing-secret"
  value        = var.slack_signing_secret
  key_vault_id = azurerm_key_vault.consensusbot.id
}

resource "azurerm_key_vault_secret" "azure_devops_pat" {
  name         = "azure-devops-pat"
  value        = var.azure_devops_pat
  key_vault_id = azurerm_key_vault.consensusbot.id
}

# Application Insights for monitoring
resource "azurerm_log_analytics_workspace" "consensusbot" {
  name                = "${var.app_name}-logs"
  location            = azurerm_resource_group.consensusbot.location
  resource_group_name = azurerm_resource_group.consensusbot.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  
  tags = {
    Application = "ConsensusBot"
    Environment = var.environment
  }
}

resource "azurerm_application_insights" "consensusbot" {
  name                = "${var.app_name}-insights"
  location            = azurerm_resource_group.consensusbot.location
  resource_group_name = azurerm_resource_group.consensusbot.name
  workspace_id        = azurerm_log_analytics_workspace.consensusbot.id
  application_type    = "web"
  
  tags = {
    Application = "ConsensusBot"
    Environment = var.environment
  }
}
