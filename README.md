# ConsensusBot

A lightweight Slack application designed to facilitate team decision-making without requiring a database. ConsensusBot uses Slack threads and messages as ephemeral storage for active decisions and pushes finalized decisions to Azure DevOps as Architecture Decision Records (ADRs).

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Infrastructure Setup](#infrastructure-setup)
- [Slack App Configuration](#slack-app-configuration)
- [Usage](#usage)
- [How It Works](#how-it-works)
- [Edge Cases and Troubleshooting](#edge-cases-and-troubleshooting)
- [Development](#development)
- [Contributing](#contributing)

## Overview

ConsensusBot simplifies team decision-making by:
- **Eliminating Database Complexity**: All active decision state is managed through Slack
- **Facilitating Asynchronous Decisions**: Team members vote on their own schedule
- **Creating Permanent Records**: Finalized decisions are automatically documented as ADRs in Azure DevOps
- **Sending Reminders**: Automated nudges to team members who haven't voted

### What ConsensusBot Is NOT

ConsensusBot is **not** a system of record. It's a decision facilitator. Once a decision is finalized, the authoritative record exists in Azure DevOps, not in Slack.

## Architecture

### Core Components

1. **Slack Integration**: Handles commands, interactive buttons, and state management
2. **Azure App Service**: Hosts the main bot application
3. **Azure Function (Nudger)**: Timer-triggered function that sends reminders
4. **Azure Key Vault**: Securely stores secrets (Slack tokens, Azure DevOps PAT)
5. **Azure DevOps**: Final destination for ADRs

### State Management Model

ConsensusBot uses **Slack as the persistence layer**:

- **Pinned Messages**: Store decision metadata (ID, text, participants, deadline)
- **Thread Replies**: Store individual votes and comments
- **Message Timestamps**: Serve as unique decision IDs
- **Block Kit Buttons**: Provide interactive voting UI

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed design documentation.

### Data Flow

```
/consensus command → Pinned message created → Voting via buttons → 
Thread replies capture votes → Nudger checks for overdue decisions → 
Decision finalized → ADR pushed to Azure DevOps
```

## Features

### ✅ Core Features

- **`/consensus` Command**: Initiate decisions with custom text, participants, and deadlines
- **Interactive Voting**: Yes/No/Abstain buttons with real-time updates
- **Vote Tracking**: See who has voted and who hasn't in the pinned message
- **Automated Reminders**: Nudger function DMs users who haven't voted
- **ADR Generation**: Automatic creation and push of ADRs to Azure DevOps
- **No Database**: Zero database operational overhead

### 🎯 Decision Lifecycle

1. **Creation**: User runs `/consensus "Should we adopt microservices?" @user1 @user2 --deadline 2026-02-05`
2. **Voting**: Participants click Yes/No/Abstain buttons
3. **Tracking**: Pinned message shows current vote status
4. **Reminders**: Non-voters receive DMs before deadline
5. **Finalization**: When all vote or deadline passes, ADR is generated
6. **Archival**: ADR pushed to Azure DevOps `KB.ProcessDocs/decisions/`

## Infrastructure Setup

### Prerequisites

- Azure subscription
- Slack workspace with admin access
- Azure DevOps organization and repository
- Terraform >= 1.0

### Step 1: Clone Repository

```bash
git clone https://github.com/alex-thorne/ConsensusBot.git
cd ConsensusBot
```

### Step 2: Configure Terraform Variables

Create `terraform/terraform.tfvars`:

```hcl
resource_group_name = "consensusbot-rg"
location            = "East US"
environment         = "production"
app_name            = "consensusbot-yourorg"  # Must be globally unique

# These will be set via CI/CD or manually in Key Vault
slack_bot_token     = "xoxb-your-token"
slack_signing_secret = "your-signing-secret"
azure_devops_pat    = "your-pat"

# Azure DevOps configuration
azure_devops_org     = "your-org"
azure_devops_project = "your-project"
azure_devops_repo    = "KB.ProcessDocs"

# Slack channels to monitor (comma-separated IDs)
decision_channel_ids = "C01234567,C89ABCDEF"
```

### Step 3: Deploy Infrastructure

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

This creates:
- Azure Resource Group
- App Service Plan and App Service (for main bot)
- Function App (for nudger)
- Storage Account (for Function App)
- Key Vault (for secrets)
- Application Insights (for monitoring)

**Note**: No Azure SQL Database is created. All state is managed through Slack.

### Step 4: Configure Secrets

After deployment, update Key Vault secrets with real values:

```bash
# Get Key Vault name from Terraform output
KV_NAME=$(terraform output -raw key_vault_name)

# Set secrets
az keyvault secret set --vault-name $KV_NAME --name slack-bot-token --value "xoxb-..."
az keyvault secret set --vault-name $KV_NAME --name slack-signing-secret --value "..."
az keyvault secret set --vault-name $KV_NAME --name azure-devops-pat --value "..."
```

## Slack App Configuration

### Step 1: Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name: "ConsensusBot"
4. Select your workspace

### Step 2: Configure Bot Permissions

Under **OAuth & Permissions**, add these Bot Token Scopes:

- `chat:write` - Post messages
- `chat:write.public` - Post to channels bot isn't in
- `pins:write` - Pin messages
- `pins:read` - Read pinned messages
- `channels:read` - List channels
- `users:read` - Read user information
- `commands` - Receive slash commands
- `im:write` - Send DMs (for nudges)

### Step 3: Enable Interactive Components

Under **Interactivity & Shortcuts**:
- Enable Interactivity
- Request URL: `https://<your-app-service>.azurewebsites.net/slack/interactions`

### Step 4: Create Slash Command

Under **Slash Commands**, create:
- Command: `/consensus`
- Request URL: `https://<your-app-service>.azurewebsites.net/slack/commands`
- Short Description: "Start a team decision"
- Usage Hint: `"decision text" @user1 @user2 --deadline YYYY-MM-DD`

### Step 5: Install App to Workspace

Under **Install App**:
1. Click "Install to Workspace"
2. Authorize the app
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
4. Copy the **Signing Secret** from Basic Information

Update these in Azure Key Vault (see Step 4 of Infrastructure Setup).

## Usage

### Starting a Decision

Use the `/consensus` command in any Slack channel:

```
/consensus "Should we migrate to Kubernetes?" @alice @bob @charlie --deadline 2026-02-10
```

**Parameters**:
- Decision text (in quotes)
- Participants (using @mentions)
- `--deadline YYYY-MM-DD` (optional, defaults to 7 days)
- `--threshold` (optional: `majority`, `unanimous`, default: `majority`)

### Voting

1. ConsensusBot posts a pinned message with the decision
2. Participants click **Yes**, **No**, or **Abstain** buttons
3. Bot posts each vote as a thread reply
4. Pinned message updates with current status

### Checking Status

View the pinned message to see:
- Total votes: X/Y
- Yes: X, No: Y, Abstain: Z
- Missing voters: @user1, @user2
- Deadline: YYYY-MM-DD

### Receiving Reminders

The Nudger function runs hourly and:
1. Identifies decisions approaching deadline
2. Finds users who haven't voted
3. Sends DMs: "Reminder: Please vote on decision in #channel"

### Decision Finalization

When all participants vote OR the deadline is reached:
1. Bot generates an ADR Markdown file
2. ADR includes: decision, votes, rationale, participants
3. Bot pushes to Azure DevOps: `KB.ProcessDocs/decisions/YYYY-MM-DD-decision-name.md`
4. Bot unpins the message
5. Bot posts completion message with link to ADR

## How It Works

### Slack-Based State Management

Instead of a database, ConsensusBot reconstructs decision state from Slack:

```python
# Pseudocode for state reconstruction
def get_decision_state(channel_id, message_ts):
    # 1. Get pinned message for metadata
    pinned_msg = slack.get_message(channel_id, message_ts)
    decision_data = parse_metadata(pinned_msg)
    
    # 2. Get thread replies for votes
    thread_replies = slack.get_thread_replies(channel_id, message_ts)
    votes = [parse_vote(reply) for reply in thread_replies if is_vote(reply)]
    
    # 3. Calculate missing voters
    all_participants = decision_data['participants']
    voters = set(vote['user_id'] for vote in votes)
    missing = all_participants - voters
    
    # 4. Check deadline
    deadline = decision_data['deadline']
    is_overdue = datetime.now() > deadline
    
    return {
        'decision': decision_data,
        'votes': votes,
        'missing_voters': missing,
        'is_complete': len(missing) == 0 or is_overdue
    }
```

### Nudger Without Database

The Nudger Azure Function operates without database queries:

```python
# Timer-triggered function (runs hourly)
def nudger_function():
    channels = os.getenv('DECISION_CHANNEL_IDS').split(',')
    
    for channel_id in channels:
        # Get all pinned messages in channel
        pinned_messages = slack.pins_list(channel_id)
        
        for pin in pinned_messages:
            if is_consensusbot_decision(pin):
                state = get_decision_state(channel_id, pin.message.ts)
                
                # Check if decision is approaching deadline
                hours_remaining = (state['decision']['deadline'] - datetime.now()).hours
                
                if 0 < hours_remaining < 24:  # Last 24 hours
                    # Send DM to non-voters
                    for user_id in state['missing_voters']:
                        slack.send_dm(user_id, f"Reminder: Decision deadline in {hours_remaining} hours")
```

## Edge Cases and Troubleshooting

### Edge Case Handling

#### 1. **Simultaneous Votes**
- **Issue**: Two users vote at exactly the same time
- **Solution**: Each vote is a separate thread reply with unique timestamp. Bot processes all votes and uses latest per user.

#### 2. **Vote Changes**
- **Issue**: User wants to change their vote
- **Solution**: User clicks a different button. Bot identifies latest vote per user by timestamp.

#### 3. **User Leaves Workspace**
- **Issue**: Participant leaves Slack workspace before voting
- **Solution**: Bot detects inactive users via API, excludes from required count, notes in ADR.

#### 4. **Channel Deleted**
- **Issue**: Channel containing decision is deleted
- **Solution**: Bot receives deletion event, attempts to finalize pending decisions with "cancelled" status.

#### 5. **Bot Downtime**
- **Issue**: Bot is down during active decision
- **Solution**: No state is lost (all in Slack). On restart, bot rescans pinned messages and resumes operations.

#### 6. **Slack API Rate Limits**
- **Issue**: Too many API calls trigger rate limiting
- **Solution**: Implement exponential backoff, cache user/channel data, batch operations.

#### 7. **Missing Deadline**
- **Issue**: User forgets to set deadline
- **Solution**: Default to 7 days from creation.

### Troubleshooting

#### Bot Not Responding to `/consensus`

1. Check App Service logs in Application Insights
2. Verify Slack Request URL is correct
3. Test signing secret validation
4. Check bot is invited to channel

```bash
# View App Service logs
az webapp log tail --name consensusbot-yourorg --resource-group consensusbot-rg
```

#### Votes Not Recording

1. Check Interactive Components URL
2. Verify `chat:write` permission
3. Review Application Insights for errors
4. Test thread reply posting manually

#### Nudger Not Sending Reminders

1. Check Function App status: `az functionapp show --name consensusbot-yourorg-nudger`
2. Verify timer trigger configuration
3. Check `DECISION_CHANNEL_IDS` environment variable
4. Review Function logs

```bash
az functionapp log tail --name consensusbot-yourorg-nudger --resource-group consensusbot-rg
```

#### ADR Not Pushed to Azure DevOps

1. Verify Azure DevOps PAT has repository write permissions
2. Check PAT is not expired
3. Confirm repository path: `KB.ProcessDocs/decisions/`
4. Review Application Insights for Azure DevOps API errors

#### Pinned Message Limit Reached (400 per channel)

Slack limits pinned messages to 400 per channel. Solutions:
1. Use a dedicated channel per team/project
2. Archive old decisions (unpin after finalization)
3. Implement automatic cleanup of decisions older than X days

## Development

### Local Development Setup

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_SIGNING_SECRET="..."
export AZURE_DEVOPS_PAT="..."
export AZURE_DEVOPS_ORG="your-org"
export AZURE_DEVOPS_PROJECT="your-project"
export AZURE_DEVOPS_REPO="KB.ProcessDocs"

# Run locally
python src/bot/app.py
```

### Testing

```bash
# Run unit tests
pytest tests/

# Run with coverage
pytest --cov=src tests/
```

### Project Structure

```
ConsensusBot/
├── terraform/           # Infrastructure as Code
│   ├── main.tf         # Azure resources (no database)
│   ├── variables.tf    # Input variables
│   └── outputs.tf      # Output values
├── src/
│   ├── bot/            # Main bot application
│   ├── slack/          # Slack API integration
│   ├── azure_devops/   # ADR generation and push
│   └── utils/          # Shared utilities
├── tests/              # Unit and integration tests
├── docs/
│   └── ARCHITECTURE.md # Detailed architecture documentation
└── README.md           # This file
```

## Key Design Decisions

### Why No Database?

1. **Reduced Complexity**: No database schema, migrations, or backups
2. **Lower Costs**: No database hosting fees
3. **Simplified Operations**: No database monitoring or maintenance
4. **Slack is Sufficient**: Decision state is temporary; final state is in Azure DevOps
5. **Faster Development**: No ORM, fewer dependencies

### Why Slack Threads?

1. **Native Grouping**: Threads naturally group decision-related messages
2. **User Familiarity**: Teams already use threads for discussions
3. **Built-in Timestamps**: Every message has a unique, sortable timestamp
4. **No Extra Storage**: Leverage existing Slack infrastructure
5. **Audit Trail**: Slack retains message history

### Why Azure DevOps for ADRs?

1. **Version Control**: Git-based storage with full history
2. **Integration**: Likely already used by engineering teams
3. **Discoverability**: ADRs alongside code and documentation
4. **Standard Format**: Markdown files compatible with ADR tooling
5. **Long-term Storage**: Permanent record separate from ephemeral Slack state

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes following the architecture principles
4. Add tests for new functionality
5. Update documentation
6. Submit a pull request

## License

MIT License - See LICENSE file for details

## Support

- **Issues**: [GitHub Issues](https://github.com/alex-thorne/ConsensusBot/issues)
- **Documentation**: [Architecture Guide](docs/ARCHITECTURE.md)
- **Azure Support**: [Azure Portal](https://portal.azure.com)
- **Slack API**: [Slack API Documentation](https://api.slack.com)

---

**Remember**: ConsensusBot is a decision facilitator, not a system of record. All finalized decisions live in Azure DevOps as ADRs. Slack is for active decision-making only.
