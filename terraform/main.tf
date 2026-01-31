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
  features {}
}

# Placeholder for future infrastructure resources
# Example: App Service, Azure Container Instances, Azure Database, Storage Accounts, etc.
