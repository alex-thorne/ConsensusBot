# ConsensusBot - Deployment and Infrastructure Guide

## Quick Start

This repository contains the infrastructure and documentation for ConsensusBot, a Slack-based decision-making facilitator.

## What's Included

- ✅ **Terraform Infrastructure** - Azure resources (no database!)
- ✅ **Architecture Documentation** - Complete design with Slack-based state management
- ✅ **Setup Guide** - Step-by-step deployment instructions
- ✅ **Troubleshooting Guide** - Edge cases and debugging
- ✅ **Testing Strategy** - Validation approach
- ✅ **ADR Template** - Format for generated Architecture Decision Records

## Key Design Decisions

### No Database 🎉

ConsensusBot does **not** use a database. Instead:
- **Active decisions**: Stored in Slack (pinned messages and threads)
- **Finalized decisions**: Stored in Azure DevOps as ADRs
- **Benefits**: Simpler, cheaper, less maintenance

### Infrastructure Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Slack Workspace                      │
│  (Persistence layer for active decisions)                   │
│  • Pinned messages = Decision metadata                      │
│  • Thread replies = Votes                                   │
│  • Block Kit buttons = Voting UI                            │
└─────────────────────────────────────────────────────────────┘
                           ▲
                           │ Slack API
                           │
┌──────────────────────────┼─────────────────────────────────┐
│                      Azure                                  │
│                                                             │
│  ┌────────────────────┐         ┌──────────────────────┐  │
│  │  App Service       │         │  Function App        │  │
│  │  (Main Bot)        │         │  (Nudger/Reminders)  │  │
│  └────────────────────┘         └──────────────────────┘  │
│            │                              │                │
│            └──────────┬───────────────────┘                │
│                       │                                    │
│             ┌─────────▼──────────┐                        │
│             │   Key Vault        │                        │
│             │   (Secrets)        │                        │
│             └────────────────────┘                        │
│                                                            │
│             ┌────────────────────┐                        │
│             │ App Insights       │                        │
│             │ (Monitoring)       │                        │
│             └────────────────────┘                        │
└────────────────────────────────────────────────────────────┘
                           │
                           │ Azure DevOps API
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Azure DevOps                              │
│  KB.ProcessDocs/decisions/                                   │
│  • 2026-02-01-decision-name.md (ADR)                        │
│  • 2026-02-15-another-decision.md (ADR)                     │
│  (System of Record for finalized decisions)                 │
└─────────────────────────────────────────────────────────────┘
```

## Repository Structure

```
ConsensusBot/
├── terraform/                    # Infrastructure as Code
│   ├── main.tf                  # Azure resources (NO database!)
│   ├── variables.tf             # Configuration variables
│   └── outputs.tf               # Deployment outputs
├── docs/                        # Documentation
│   ├── ARCHITECTURE.md          # Detailed design
│   ├── SETUP.md                 # Deployment guide
│   ├── TROUBLESHOOTING.md       # Debug guide
│   ├── TESTING.md               # Testing strategy
│   └── ADR_TEMPLATE.md          # ADR format reference
├── src/                         # Application code (to be implemented)
│   ├── bot/                     # Main bot logic
│   ├── slack/                   # Slack API integration
│   ├── azure_devops/            # ADR generation and push
│   └── utils/                   # Shared utilities
├── tests/                       # Tests (to be implemented)
├── requirements.txt             # Python dependencies
├── README.md                    # This file
└── .gitignore                   # Git ignore rules
```

## Deployment Steps

### 1. Prerequisites

- Azure subscription
- Slack workspace (admin access)
- Azure DevOps organization
- Terraform installed

### 2. Configure and Deploy

```bash
# Configure Terraform
cd terraform
cp variables.tf terraform.tfvars
# Edit terraform.tfvars with your values

# Deploy
terraform init
terraform plan
terraform apply
```

### 3. Configure Slack App

See [docs/SETUP.md](docs/SETUP.md) for detailed instructions.

### 4. Set Secrets

```bash
# Get Key Vault name
KV_NAME=$(cd terraform && terraform output -raw key_vault_name)

# Set secrets
az keyvault secret set --vault-name $KV_NAME --name slack-bot-token --value "xoxb-..."
az keyvault secret set --vault-name $KV_NAME --name slack-signing-secret --value "..."
az keyvault secret set --vault-name $KV_NAME --name azure-devops-pat --value "..."
```

## Documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - Complete architecture design
- **[SETUP.md](docs/SETUP.md)** - Step-by-step setup guide
- **[TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** - Debug and edge cases
- **[TESTING.md](docs/TESTING.md)** - Testing strategy
- **[ADR_TEMPLATE.md](docs/ADR_TEMPLATE.md)** - ADR format

## Key Features

✅ **Slack-based State Management** - No database required  
✅ **Interactive Voting** - Yes/No/Abstain buttons  
✅ **Automated Reminders** - Nudge non-voters  
✅ **ADR Generation** - Auto-create decision records  
✅ **Azure DevOps Integration** - Push ADRs to repo  
✅ **Edge Case Handling** - User leaves, simultaneous votes, etc.  

## Infrastructure Costs

Estimated: **$20-35/month** (no database costs!)

- App Service Plan (B1): ~$13/mo
- Storage Account: ~$1/mo
- Key Vault: ~$0.50/mo
- Application Insights: ~$5-20/mo

## Next Steps

1. ✅ Review documentation
2. ✅ Deploy infrastructure with Terraform
3. ✅ Configure Slack app
4. ✅ Set secrets in Key Vault
5. ⏭️ Implement application code
6. ⏭️ Deploy code to App Service
7. ⏭️ Test complete flow
8. ⏭️ Monitor and iterate

## Support

- **Issues**: [GitHub Issues](https://github.com/alex-thorne/ConsensusBot/issues)
- **Architecture Questions**: See [ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Setup Help**: See [SETUP.md](docs/SETUP.md)
- **Troubleshooting**: See [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Contributing

Contributions welcome! See individual documentation files for implementation details.

## License

MIT License - See LICENSE file for details.

---

**Key Principle**: ConsensusBot is a decision *facilitator*, not a system of record. Active decisions live in Slack. Finalized decisions live in Azure DevOps. No database needed!