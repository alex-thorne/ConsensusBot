# Terraform configuration for ConsensusBot Infrastructure
# This file contains the main infrastructure as code definitions

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Backend configuration for state management
  # Uncomment and configure when ready to use remote state
  # backend "s3" {
  #   bucket = "consensusbot-terraform-state"
  #   key    = "terraform.tfstate"
  #   region = "us-east-1"
  # }
}

# Provider configuration
provider "aws" {
  region = var.aws_region
}

# Placeholder for future infrastructure resources
# Example: ECS cluster, RDS database, S3 buckets, etc.
