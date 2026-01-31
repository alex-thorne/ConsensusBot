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
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "consensusbot"
}

# Additional variables will be added as infrastructure needs are defined
