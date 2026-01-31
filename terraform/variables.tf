# Input variables for Terraform configuration

variable "aws_region" {
  description = "AWS region where resources will be created"
  type        = string
  default     = "us-east-1"
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
