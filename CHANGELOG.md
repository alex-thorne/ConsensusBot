# Changelog

All notable changes to the ConsensusBot project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/alex-thorne/ConsensusBot/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alex-thorne/ConsensusBot/releases/tag/v0.1.0
