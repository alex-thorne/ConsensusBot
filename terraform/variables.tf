variable "resource_group_name" {
  description = "Name of the Azure Resource Group"
  type        = string
  default     = "consensusbot-rg"
}

variable "location" {
  description = "Azure region for resources"
  type        = string
  default     = "East US"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  default     = "production"
}

variable "app_name" {
  description = "Name of the application (must be globally unique for Azure)"
  type        = string
  default     = "consensusbot"
}

variable "app_service_plan_sku" {
  description = "SKU for the App Service Plan"
  type        = string
  default     = "B1"
}

variable "slack_bot_token" {
  description = "Slack Bot User OAuth Token (xoxb-...)"
  type        = string
  sensitive   = true
  default     = "placeholder-set-via-ci-cd"
}

variable "slack_signing_secret" {
  description = "Slack App Signing Secret"
  type        = string
  sensitive   = true
  default     = "placeholder-set-via-ci-cd"
}

variable "azure_devops_pat" {
  description = "Azure DevOps Personal Access Token"
  type        = string
  sensitive   = true
  default     = "placeholder-set-via-ci-cd"
}

variable "azure_devops_org" {
  description = "Azure DevOps organization name"
  type        = string
  default     = "your-org"
}

variable "azure_devops_project" {
  description = "Azure DevOps project name"
  type        = string
  default     = "your-project"
}

variable "azure_devops_repo" {
  description = "Azure DevOps repository name for ADRs"
  type        = string
  default     = "KB.ProcessDocs"
}

variable "nudge_schedule" {
  description = "Cron schedule for nudge function (default: hourly)"
  type        = string
  default     = "0 0 * * * *"
}

variable "decision_channel_ids" {
  description = "Comma-separated list of Slack channel IDs to monitor for decisions"
  type        = string
  default     = ""
}
