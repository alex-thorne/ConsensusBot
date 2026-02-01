# Input variables for Terraform configuration

variable "azure_region" {
  description = "Azure region where resources will be created"
  type        = string
  default     = "eastus"
}

variable "environment" {
  description = "Environment name (development, staging, production)"
  type        = string
  default     = "development"
  
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "Environment must be development, staging, or production."
  }
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "consensusbot"
  
  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "Project name must contain only lowercase letters, numbers, and hyphens."
  }
}

variable "app_insights_retention_days" {
  description = "Number of days to retain Application Insights data"
  type        = number
  default     = 90
  
  validation {
    condition     = contains([30, 60, 90, 120, 180, 270, 365, 550, 730], var.app_insights_retention_days)
    error_message = "Retention days must be one of: 30, 60, 90, 120, 180, 270, 365, 550, 730."
  }
}

variable "storage_replication_type" {
  description = "Storage account replication type (LRS, GRS, RAGRS, ZRS)"
  type        = string
  default     = "LRS"
  
  validation {
    condition     = contains(["LRS", "GRS", "RAGRS", "ZRS", "GZRS", "RAGZRS"], var.storage_replication_type)
    error_message = "Must be one of: LRS, GRS, RAGRS, ZRS, GZRS, RAGZRS."
  }
}

variable "deploy_function_app" {
  description = "Whether to deploy the Azure Function App (set to false for local development)"
  type        = bool
  default     = true
}

variable "app_service_plan_sku" {
  description = "App Service Plan SKU (Y1 for consumption, B1/S1/P1v2 for dedicated)"
  type        = string
  default     = "Y1"  # Consumption plan
  
  validation {
    condition     = can(regex("^(Y1|B1|B2|B3|S1|S2|S3|P1v2|P2v2|P3v2)$", var.app_service_plan_sku))
    error_message = "Must be a valid App Service Plan SKU."
  }
}

variable "azure_devops_organization" {
  description = "Azure DevOps organization name"
  type        = string
  default     = ""
}

variable "azure_devops_project" {
  description = "Azure DevOps project name"
  type        = string
  default     = ""
}

variable "azure_devops_repository" {
  description = "Azure DevOps repository ID for ADR storage"
  type        = string
  default     = ""
}

# Secrets (should be provided via environment variables or secure parameter store)
# These are defined as variables for documentation but should NEVER have default values

variable "slack_bot_token" {
  description = "Slack Bot Token (xoxb-...)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "slack_signing_secret" {
  description = "Slack Signing Secret"
  type        = string
  default     = ""
  sensitive   = true
}

variable "slack_app_token" {
  description = "Slack App Token (xapp-...)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "azure_devops_pat" {
  description = "Azure DevOps Personal Access Token"
  type        = string
  default     = ""
  sensitive   = true
}

