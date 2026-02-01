# Terraform configuration for ConsensusBot Infrastructure
# This file contains the main infrastructure as code definitions

terraform {
  required_version = ">= 1.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }

  # Backend configuration for state management
  # Uncomment and configure when ready to use remote state
  # backend "azurerm" {
  #   resource_group_name  = "consensusbot-terraform-state"
  #   storage_account_name = "consensusbottfstate"
  #   container_name       = "tfstate"
  #   key                  = "terraform.tfstate"
  # }
}

# Provider configuration
provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
      recover_soft_deleted_key_vaults = true
    }
  }
}

# Resource Group
resource "azurerm_resource_group" "consensusbot" {
  name     = "${var.project_name}-${var.environment}-rg"
  location = var.azure_region
  
  tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "Terraform"
  }
}

# Application Insights for monitoring and logging
resource "azurerm_application_insights" "consensusbot" {
  name                = "${var.project_name}-${var.environment}-appinsights"
  location            = azurerm_resource_group.consensusbot.location
  resource_group_name = azurerm_resource_group.consensusbot.name
  application_type    = "Node.JS"
  retention_in_days   = var.app_insights_retention_days
  
  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# Storage Account for Azure Functions
resource "azurerm_storage_account" "consensusbot" {
  name                     = "${var.project_name}${var.environment}storage"
  resource_group_name      = azurerm_resource_group.consensusbot.name
  location                 = azurerm_resource_group.consensusbot.location
  account_tier             = "Standard"
  account_replication_type = var.storage_replication_type
  
  # Enable blob encryption
  enable_https_traffic_only = true
  min_tls_version          = "TLS1_2"
  
  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# Storage Container for ADR documents (optional local backup)
resource "azurerm_storage_container" "adr_backup" {
  name                  = "adr-backup"
  storage_account_name  = azurerm_storage_account.consensusbot.name
  container_access_type = "private"
}

# Key Vault for secrets management
resource "azurerm_key_vault" "consensusbot" {
  name                       = "${var.project_name}-${var.environment}-kv"
  location                   = azurerm_resource_group.consensusbot.location
  resource_group_name        = azurerm_resource_group.consensusbot.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 7
  purge_protection_enabled   = var.environment == "production" ? true : false
  
  # Network ACLs
  network_acls {
    default_action = "Allow"  # Change to "Deny" in production with specific IP allowlist
    bypass         = "AzureServices"
  }
  
  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# Key Vault Access Policy for Function App (will be configured after Function App creation)
resource "azurerm_key_vault_access_policy" "function_app" {
  count        = var.deploy_function_app ? 1 : 0
  key_vault_id = azurerm_key_vault.consensusbot.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = azurerm_linux_function_app.consensusbot[0].identity[0].principal_id

  secret_permissions = [
    "Get",
    "List"
  ]
}

# Key Vault Access Policy for current user/service principal
resource "azurerm_key_vault_access_policy" "current_user" {
  key_vault_id = azurerm_key_vault.consensusbot.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = data.azurerm_client_config.current.object_id

  secret_permissions = [
    "Get",
    "List",
    "Set",
    "Delete",
    "Purge",
    "Recover"
  ]
}

# App Service Plan for Azure Functions
resource "azurerm_service_plan" "consensusbot" {
  count               = var.deploy_function_app ? 1 : 0
  name                = "${var.project_name}-${var.environment}-plan"
  location            = azurerm_resource_group.consensusbot.location
  resource_group_name = azurerm_resource_group.consensusbot.name
  os_type             = "Linux"
  sku_name            = var.app_service_plan_sku
  
  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# Linux Function App
resource "azurerm_linux_function_app" "consensusbot" {
  count               = var.deploy_function_app ? 1 : 0
  name                = "${var.project_name}-${var.environment}-func"
  location            = azurerm_resource_group.consensusbot.location
  resource_group_name = azurerm_resource_group.consensusbot.name
  service_plan_id     = azurerm_service_plan.consensusbot[0].id
  
  storage_account_name       = azurerm_storage_account.consensusbot.name
  storage_account_access_key = azurerm_storage_account.consensusbot.primary_access_key
  
  # Enable system-assigned managed identity
  identity {
    type = "SystemAssigned"
  }
  
  site_config {
    application_stack {
      node_version = "18"
    }
    
    application_insights_connection_string = azurerm_application_insights.consensusbot.connection_string
    application_insights_key              = azurerm_application_insights.consensusbot.instrumentation_key
    
    # CORS configuration for Slack
    cors {
      allowed_origins = ["https://api.slack.com"]
    }
    
    # Always on (if using non-consumption plan)
    always_on = var.app_service_plan_sku != "Y1"
  }
  
  app_settings = {
    # Application settings
    WEBSITE_RUN_FROM_PACKAGE = "1"
    FUNCTIONS_WORKER_RUNTIME = "node"
    NODE_ENV                 = var.environment
    
    # Application Insights
    APPINSIGHTS_INSTRUMENTATIONKEY        = azurerm_application_insights.consensusbot.instrumentation_key
    APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.consensusbot.connection_string
    
    # Slack configuration (use Key Vault references)
    SLACK_BOT_TOKEN      = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.consensusbot.vault_uri}secrets/slack-bot-token/)"
    SLACK_SIGNING_SECRET = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.consensusbot.vault_uri}secrets/slack-signing-secret/)"
    SLACK_APP_TOKEN      = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.consensusbot.vault_uri}secrets/slack-app-token/)"
    
    # Azure DevOps configuration
    AZURE_DEVOPS_PAT          = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.consensusbot.vault_uri}secrets/azure-devops-pat/)"
    AZURE_DEVOPS_ORGANIZATION = var.azure_devops_organization
    AZURE_DEVOPS_PROJECT      = var.azure_devops_project
    AZURE_DEVOPS_REPOSITORY   = var.azure_devops_repository
    
    # Storage configuration for backups
    AZURE_STORAGE_CONNECTION_STRING = azurerm_storage_account.consensusbot.primary_connection_string
  }
  
  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# Data source to get current Azure client configuration
data "azurerm_client_config" "current" {}

