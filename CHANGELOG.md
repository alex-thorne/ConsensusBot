# Changelog

All notable changes to the ConsensusBot project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-02-01

### BREAKING CHANGES
- **Complete migration to Slack Native (ROSI) architecture**
- Removed all Azure dependencies (App Service, Functions, Key Vault, SQL)
- Removed Node.js runtime in favor of Deno
- Removed Terraform infrastructure provisioning
- Removed Docker deployment option

### Added
- **Slack Native (ROSI) Infrastructure**
  - Deno-based runtime on Slack's serverless platform
  - Slack Datastores for state management (decisions, votes, voters)
  - Slack Workflows for decision creation, voting, and reminders
  - Slack Functions (create_decision, record_vote, send_reminders)
- **Triggers**
  - Slash command trigger for `/consensus`
  - Scheduled trigger for voter reminders (Mon-Fri at 9 AM UTC)
- **Core Features**
  - Decision creation with modal form
  - Interactive voting with Yes/No/Abstain buttons
  - Automatic decision finalization on deadline or all votes cast
  - ADR generation posted to Slack threads for manual archival
  - Automated voter reminder DMs
- **Utilities**
  - decision_logic.ts - Vote counting and outcome calculation
  - date_utils.ts - Date/deadline utilities
  - adr_generator.ts - ADR markdown generation
- **Documentation**
  - Comprehensive README for Slack Native deployment
  - Migration guide from Azure to Slack ROSI
  - Architecture re-evaluation document

### Changed
- **Simplified ADR Workflow**
  - Removed Azure DevOps automated push integration
  - ADRs now posted as formatted markdown in Slack threads
  - Users manually copy/paste ADRs to documentation repositories
- **Cost Reduction**
  - 90% infrastructure cost reduction ($10-50/mo vs $171-266/mo)
  - 85% maintenance reduction (1-2 hrs/mo vs 8-12 hrs/mo)
- **Operational Simplification**
  - Zero secret rotation required (Slack handles OAuth)
  - Single platform deployment via Slack CLI
  - No database setup or management needed

### Removed
- Azure infrastructure (App Service, Functions, Key Vault, Storage, Application Insights)
- Terraform configurations and state management
- Node.js/npm dependencies and package.json
- Docker deployment (Dockerfile, docker-compose.yml)
- Jest testing framework (to be replaced with Deno test)
- Azure DevOps integration for automated ADR push
- All Node.js source code (src/, azure-functions/, config/)

### Archived
- Old Azure-based implementation moved to `archive/old-azure-architecture/`
- All Node.js tests, infrastructure code, and documentation preserved for reference

## [1.0.0] - 2026-01-31

### Azure-Based Implementation (Now Archived)
- Complete Node.js implementation with Azure infrastructure
- SQLite database for ephemeral state (later migrated to Slack-based state)
- Azure Functions for scheduled reminders
- Docker deployment support
- Comprehensive test suite (166 tests, 84% coverage)
- Azure DevOps integration for ADR automation

## [0.1.0] - 2026-01-31

### Initial Release
### Added
- Initial project foundation and structure
- Foundational directory structure (src, config, docs, terraform, test)
- Core configuration files (.gitignore, .dockerignore, .eslintrc.json)
- Package.json with Slack Bolt SDK and development dependencies
- Docker support (Dockerfile, docker-compose.yml)
- Environment variable template (.env.example)
- Jest testing framework configuration
- ESLint for code linting
- GitHub Actions workflows for CI/CD
  - Linting workflow
  - Testing workflow with coverage
  - Docker build and validation workflow
- Comprehensive documentation
  - Project README with setup instructions
  - CONTRIBUTING.md with contribution guidelines
  - LOCAL_SETUP.md with detailed local development guide
  - DOCKER.md with Docker deployment guide
  - Documentation templates (ADR, Feature Spec)
  - Sample ADR for Slack Bolt framework decision
- Basic Slack Bot application structure
  - Main entry point with Slack Bolt initialization
  - Example slash command handler (/consensus)
  - App home tab handler
  - Message handler
- Terraform infrastructure placeholders
  - Main configuration file
  - Variables and outputs files
- NPM scripts for common development tasks
- Basic test suite structure

## [0.1.0] - 2026-01-31

### Initial Release
- Project foundation established
- Development environment configured
- Documentation framework in place

[Unreleased]: https://github.com/alex-thorne/ConsensusBot/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/alex-thorne/ConsensusBot/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/alex-thorne/ConsensusBot/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/alex-thorne/ConsensusBot/releases/tag/v0.1.0
