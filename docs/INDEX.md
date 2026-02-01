# ConsensusBot Project Index

## Quick Navigation

This document provides quick links to all key documentation and resources for ConsensusBot.

## 📚 Documentation

### Getting Started
- **[README.md](../README.md)** - Main project overview and features
- **[DEPLOYMENT.md](../DEPLOYMENT.md)** - Quick deployment guide

### Architecture & Design
- **[docs/ARCHITECTURE.md](ARCHITECTURE.md)** - Complete architecture documentation
  - Design principles
  - Component descriptions
  - Data flow diagrams
  - State model details
  - Security considerations

### Setup & Configuration
- **[docs/SETUP.md](SETUP.md)** - Detailed setup instructions
  - Azure prerequisites
  - Slack app configuration
  - Terraform deployment
  - Secret management
  - Post-deployment steps

### Operations
- **[docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Debug guide
  - Common issues and solutions
  - Edge case handling
  - Monitoring and logging
  - Performance tuning

### Development
- **[docs/TESTING.md](TESTING.md)** - Testing strategy
  - Unit tests
  - Integration tests
  - Edge case tests
  - Mock services

### Reference
- **[docs/ADR_TEMPLATE.md](ADR_TEMPLATE.md)** - ADR format specification
- **[docs/WHATS_NOT_INCLUDED.md](WHATS_NOT_INCLUDED.md)** - Removed components rationale

## 🏗️ Infrastructure

### Terraform Files
- **[terraform/main.tf](../terraform/main.tf)** - Azure resources
- **[terraform/variables.tf](../terraform/variables.tf)** - Configuration variables
- **[terraform/outputs.tf](../terraform/outputs.tf)** - Output values

### Key Resources Created
1. Azure Resource Group
2. App Service Plan (Linux, Python 3.11)
3. App Service (Main bot)
4. Function App (Nudger/reminders)
5. Storage Account (for Functions)
6. Key Vault (secrets storage)
7. Log Analytics Workspace
8. Application Insights (monitoring)

**Note**: No database resources! ✅

## 🔑 Key Concepts

### State Management
ConsensusBot uses **Slack as the persistence layer**:
- Pinned messages = Decision metadata
- Thread replies = Individual votes
- No database required

### Decision Lifecycle
```
/consensus → Pinned message → Voting → Nudges → Finalization → ADR
```

### Data Storage
- **Ephemeral State**: Slack (active decisions)
- **Permanent Records**: Azure DevOps (ADRs)

## 📋 Checklists

### Deployment Checklist
- [ ] Azure subscription ready
- [ ] Slack workspace admin access
- [ ] Azure DevOps organization access
- [ ] Terraform installed
- [ ] Azure CLI installed
- [ ] Configure terraform.tfvars
- [ ] Run terraform apply
- [ ] Create Slack app
- [ ] Set Key Vault secrets
- [ ] Update Slack URLs
- [ ] Test /consensus command

### Testing Checklist
- [ ] Create test decision
- [ ] Vote with Yes/No/Abstain
- [ ] Verify thread updates
- [ ] Check pinned message
- [ ] Wait for nudge
- [ ] Force finalization
- [ ] Verify ADR in Azure DevOps
- [ ] Test edge cases

## 🚀 Quick Commands

### Terraform
```bash
# Initialize
cd terraform && terraform init

# Validate
terraform validate

# Plan
terraform plan

# Deploy
terraform apply

# Destroy
terraform destroy
```

### Azure CLI
```bash
# Set secrets
az keyvault secret set --vault-name <kv-name> --name slack-bot-token --value "xoxb-..."
az keyvault secret set --vault-name <kv-name> --name slack-signing-secret --value "..."
az keyvault secret set --vault-name <kv-name> --name azure-devops-pat --value "..."

# View logs
az webapp log tail --name <app-name> --resource-group <rg-name>
az functionapp log tail --name <function-name> --resource-group <rg-name>

# Restart services
az webapp restart --name <app-name> --resource-group <rg-name>
az functionapp restart --name <function-name> --resource-group <rg-name>
```

### Slack Commands
```
# Start decision
/consensus "Decision text" @user1 @user2 --deadline 2026-02-15

# Invite bot to channel
/invite @ConsensusBot
```

## 📊 Architecture Diagram

```
┌─────────────────┐
│  Slack (State)  │ ← Users interact here
└────────┬────────┘
         │
         ▼
┌────────────────────────────────────────────┐
│           Azure Infrastructure              │
│                                            │
│  ┌──────────────┐    ┌─────────────────┐ │
│  │ App Service  │    │  Function App   │ │
│  │  (Main Bot)  │    │    (Nudger)     │ │
│  └──────┬───────┘    └────────┬────────┘ │
│         │                     │          │
│         └──────┬──────────────┘          │
│                ▼                         │
│         ┌─────────────┐                  │
│         │ Key Vault   │                  │
│         │  (Secrets)  │                  │
│         └─────────────┘                  │
│                                          │
│         ┌──────────────────┐             │
│         │ App Insights     │             │
│         │   (Monitoring)   │             │
│         └──────────────────┘             │
└────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐
│  Azure DevOps       │ ← Finalized ADRs
│  KB.ProcessDocs/    │
│    decisions/       │
└─────────────────────┘
```

## 🎯 Design Principles

1. **Slack as Persistence** - No database needed
2. **Ephemeral State** - Active decisions in Slack
3. **Permanent Records** - ADRs in Azure DevOps
4. **Minimal Infrastructure** - Only essential Azure resources
5. **Facilitator, Not System of Record** - Output ADRs, don't store everything

## 💰 Cost Breakdown

| Component | SKU | Est. Monthly Cost |
|-----------|-----|-------------------|
| App Service Plan | B1 | ~$13 |
| Storage Account | Standard LRS | ~$1 |
| Key Vault | Standard | ~$0.50 |
| Application Insights | Pay-as-you-go | ~$5-20 |
| **Total** | | **~$20-35** |

**Savings from no database**: $50-200/month ✅

## 🔍 Quick Search

Looking for something specific?

- **Slack configuration** → [SETUP.md#slack-app-configuration](SETUP.md#slack-app-configuration)
- **Terraform variables** → [terraform/variables.tf](../terraform/variables.tf)
- **State reconstruction** → [ARCHITECTURE.md#state-model](ARCHITECTURE.md#state-model)
- **Edge cases** → [TROUBLESHOOTING.md#edge-cases](TROUBLESHOOTING.md#edge-cases)
- **Testing strategy** → [TESTING.md](TESTING.md)
- **ADR format** → [ADR_TEMPLATE.md](ADR_TEMPLATE.md)
- **Cost analysis** → [WHATS_NOT_INCLUDED.md#cost-savings](WHATS_NOT_INCLUDED.md#cost-savings)

## 🆘 Support

Having issues?

1. Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
2. Review [ARCHITECTURE.md](ARCHITECTURE.md) for design details
3. Verify [SETUP.md](SETUP.md) steps were followed
4. Open a GitHub issue with logs

## 📝 Contributing

Want to contribute?

1. Read [ARCHITECTURE.md](ARCHITECTURE.md) to understand design
2. Review [TESTING.md](TESTING.md) for testing requirements
3. Follow the established patterns
4. Update documentation for any changes

## ✅ Status

- ✅ Architecture documented
- ✅ Infrastructure defined (Terraform)
- ✅ Setup guide complete
- ✅ Testing strategy documented
- ✅ Troubleshooting guide complete
- ✅ No database required
- ⏭️ Application code implementation pending
- ⏭️ CI/CD pipeline pending

## 📅 Version

- **Version**: 1.0.0
- **Last Updated**: 2026-02-01
- **Architecture**: Database-free, Slack-based state management

---

**Remember**: ConsensusBot is a decision facilitator. Active state lives in Slack. Final state lives in Azure DevOps. No database needed!