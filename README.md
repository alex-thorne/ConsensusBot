# ConsensusBot - Slack Native (ROSI)

A Slack App to facilitate team decision-making through collaborative consensus
building, built entirely on Slack's Run on Slack Infrastructure (ROSI).

## Overview

ConsensusBot is a native Slack application that helps teams make decisions
collaboratively using structured voting mechanisms, automated reminders, and
automatic generation of Architecture Decision Records (ADRs). The application
runs entirely on Slack's infrastructure with zero external dependencies.

## Architecture

### Slack Native (ROSI) Design

ConsensusBot uses a **100% Slack-native architecture** powered by Run on Slack
Infrastructure (ROSI):

- **Compute**: Deno runtime hosted on Slack's serverless platform
- **State Management**: Slack Datastores (DynamoDB-backed, fully managed)
- **Workflows**: Slack Workflow Builder with custom functions
- **Triggers**: Slash commands and scheduled triggers
- **Authentication**: Automatic OAuth token management by Slack
- **Secrets**: Managed via `slack env` CLI

### Key Benefits

✅ **Zero Infrastructure**: No servers, databases, or external services to
manage ✅ **90% Cost Reduction**: $10-50/month vs $171-266/month for Azure-based
architecture ✅ **85% Less Maintenance**: 1-2 hours/month vs 8-12 hours/month ✅
**No Secret Rotation**: Slack handles all authentication automatically ✅
**Auto-Scaling**: Platform handles load automatically ✅ **Built-in
Compliance**: SOC 2 Type II, ISO 27001 certified

## Features

- 🗳️ **Consensus Building**: Facilitate team decisions with three voting
  thresholds:
  - **Simple Majority** (>50% of votes must be yes)
  - **Supermajority** (≥66% of required voters must vote yes)
  - **Unanimity** (All votes must be yes, abstentions allowed)
- 💬 **Interactive Voting**: Block Kit buttons for Yes/No/Abstain votes
- 📊 **Slack Datastores**: All decision state maintained in managed datastores
- 🔔 **Automated Reminders**: Scheduled DMs to voters who haven't voted (Mon-Fri
  at 9 AM)
- 📝 **ADR Generation**: Automatic Architecture Decision Records posted to Slack
  for manual archival
- ⏰ **Deadline Enforcement**: Automatic decision finalization when all votes
  are in or deadline passes

## Prerequisites

Before you begin, ensure you have:

- **Deno** (v1.37 or higher) -
  [Install Deno](https://deno.land/manual/getting_started/installation)
- **Slack CLI** -
  [Install Slack CLI](https://api.slack.com/automation/cli/install)
- A **Slack Workspace** where you have admin permissions
- **Slack paid plan** (required for ROSI features)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/alex-thorne/ConsensusBot.git
cd ConsensusBot
```

### 2. Install Slack CLI

Follow the
[official installation guide](https://api.slack.com/automation/cli/install) for
your platform:

```bash
# macOS
brew install slack

# Windows (Scoop)
scoop install slack

# Linux
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash
```

### 3. Authenticate with Slack

```bash
slack login
```

This will open a browser window to authorize the CLI with your Slack workspace.

### 4. Create the App in Slack

```bash
slack create consensusbot --template https://github.com/alex-thorne/ConsensusBot
```

Or if you've already cloned:

```bash
slack create
```

Select your workspace when prompted.

### 5. Install Dependencies

The Deno runtime will automatically fetch dependencies on first run. No manual
installation needed!

### 6. Deploy to Slack

Deploy the app to your workspace:

```bash
slack deploy
```

This will:

- Deploy all workflows and functions to Slack's infrastructure
- Create the required Datastores
- Set up triggers (slash command and scheduled reminders)

### 7. Configure Triggers

After deployment, set up the triggers:

```bash
# Slash command trigger for creating decisions
slack triggers create --trigger-def triggers/consensus_command.ts

# Scheduled reminder trigger
slack triggers create --trigger-def triggers/reminder_schedule.ts
```

**Note**: Voting buttons work automatically through block action handlers - no
separate trigger is needed.

Verify all triggers are installed:

```bash
slack triggers list
```

You should see all three triggers listed.

### 8. Test the App

In your Slack workspace, type:

```
/consensus
```

You should see a modal to create a new consensus decision!

## Usage

### Creating a Decision

1. Type `/consensus` in any Slack channel
2. Fill out the modal with:
   - **Decision Name**: The title of the decision
   - **Proposal**: Details of what's being decided
   - **Required Voters**: Select team members whose votes are needed
   - **Success Criteria**: Choose Simple Majority, Supermajority, or Unanimity
   - **Deadline**: When votes must be submitted (defaults to 5 business days)
3. Click "Create Decision"

A voting message will be posted to the channel with Yes/No/Abstain buttons.

### Voting on a Decision

Click one of the voting buttons on the decision message:

- ✅ **Yes**: Approve the proposal
- ❌ **No**: Reject the proposal
- ⚪ **Abstain**: Abstain from voting

You'll receive an ephemeral confirmation message. You can change your vote at
any time before the deadline.

### Decision Finalization

Decisions are automatically finalized when:

- All required voters have cast their votes, OR
- The deadline is reached

When finalized:

1. The decision message is updated with the final result
2. The message is unpinned
3. An ADR (Architecture Decision Record) is posted in the thread
4. The ADR markdown can be copied and pasted to your documentation repository

### Voter Reminders

Every weekday at 9:00 AM UTC, the bot automatically:

1. Checks all active decisions
2. Identifies voters who haven't voted
3. Sends them a DM reminder with a link to the decision

## Development

### Local Development

Run the app locally for testing:

```bash
slack run
```

This starts a local development server that connects to your Slack workspace via
Socket Mode.

### View Logs

Monitor app logs in real-time:

```bash
slack activity
```

### Update the App

After making code changes:

```bash
slack deploy
```

### Managing Environment Variables

Add secrets or environment variables:

```bash
slack env add KEY_NAME
```

List all environment variables:

```bash
slack env list
```

### Code Quality & CI

The project uses GitHub Actions for continuous integration with comprehensive
testing and quality checks:

**Run checks locally:**

```bash
# Lint code
deno lint

# Check formatting
deno fmt --check

# Auto-format code
deno fmt

# Type check
deno check manifest.ts
deno check functions/*.ts
deno check workflows/*.ts
deno check utils/*.ts

# Run all tests
deno test --allow-all tests/

# Run unit tests only
deno test --allow-read --allow-env tests/*.ts

# Run integration tests only
deno test --allow-net --allow-read --allow-env tests/integration/

# Generate test coverage
deno test --coverage=coverage --allow-all tests/
deno coverage coverage
```

**CI/CD Workflows:**

- **ci-cd.yml**: Complete CI/CD pipeline (lint, format, type check, tests)
- **unit-tests.yml**: Unit tests with coverage reporting
- **integration-tests.yml**: Integration tests with mocked Slack client
- **deno-lint.yml**: Linting and formatting validation
- **deno-check.yml**: TypeScript type checking
- **slack-validate.yml**: Slack manifest validation

**Testing Documentation:**

See [docs/CI_CD_TESTING.md](docs/CI_CD_TESTING.md) for comprehensive testing
guide including:

- How to write and run tests
- Unit test examples
- Integration test examples with mocks
- Test coverage reporting
- CI/CD pipeline details

See [.github/workflows/README.md](.github/workflows/README.md) for workflow
details.

## Troubleshooting

### Voting Buttons Show Warning Triangle (⚠️)

If clicking voting buttons shows a warning triangle and no response:

**Note**: This issue was fixed. Voting buttons now use block action handlers
directly and don't require a separate trigger.

### Other Issues

- **Can't create decisions**: Ensure the consensus command trigger is installed
- **No reminders**: Ensure the scheduled reminder trigger is installed
- **Check logs**: Run `slack activity --tail` to see real-time logs
- **Redeploy**: Try `slack deploy` to refresh the deployment

## Project Structure

```
ConsensusBot/
├── .github/
│   └── workflows/           # CI/CD workflows
│       ├── ci-cd.yml       # Complete CI/CD pipeline
│       ├── unit-tests.yml  # Unit test workflow
│       ├── integration-tests.yml  # Integration test workflow
│       ├── deno-lint.yml   # Linting workflow
│       ├── deno-check.yml  # Type checking workflow
│       └── slack-validate.yml  # Manifest validation workflow
├── datastores/              # Slack Datastore definitions
│   ├── decisions.ts        # Decision metadata
│   ├── votes.ts            # Vote records
│   └── voters.ts           # Required voters per decision
├── docs/                    # Documentation
│   └── CI_CD_TESTING.md    # Testing guide
├── functions/               # Custom Slack functions
│   ├── create_decision.ts  # Create decision, post voting message, handle votes
│   ├── record_vote.ts      # Standalone vote recording (legacy)
│   └── send_reminders.ts   # Send DM reminders to voters
├── workflows/               # Slack workflows
│   ├── create_decision.ts  # Decision creation workflow
│   └── send_reminders.ts   # Reminder workflow
├── triggers/                # Workflow triggers
│   ├── consensus_command.ts    # /consensus slash command
│   └── reminder_schedule.ts    # Scheduled reminder trigger
├── utils/                   # Utility functions
│   ├── decision_logic.ts   # Vote counting and outcome calculation
│   ├── date_utils.ts       # Date/deadline utilities
│   └── adr_generator.ts    # ADR markdown generation
├── tests/                   # Test files
│   ├── *.ts                # Unit tests
│   ├── integration/        # Integration tests
│   │   ├── create_decision_test.ts
│   │   ├── record_vote_test.ts
│   │   └── send_reminders_test.ts
│   └── mocks/              # Mock implementations
│       └── slack_client.ts # Mock Slack client
├── manifest.ts              # Slack app manifest
├── deno.json                # Deno configuration
├── slack.json               # Slack CLI configuration
└── README.md                # This file
```

## Slack Datastores

### Decisions Datastore

Stores decision metadata:

- `id`: Decision ID (message timestamp)
- `name`: Decision title
- `proposal`: Proposal description
- `success_criteria`: Voting threshold
- `deadline`: Voting deadline
- `channel_id`: Channel where posted
- `creator_id`: User who created it
- `message_ts`: Message timestamp
- `status`: active, approved, or rejected
- `created_at`, `updated_at`: Timestamps

### Votes Datastore

Stores individual votes:

- `id`: Vote ID (decision_id + user_id)
- `decision_id`: Related decision
- `user_id`: User who voted
- `vote_type`: yes, no, or abstain
- `voted_at`: Timestamp

### Voters Datastore

Stores required voters:

- `id`: Voter ID (decision_id + user_id)
- `decision_id`: Related decision
- `user_id`: Required voter
- `required`: Whether vote is required
- `created_at`: Timestamp

## Migration from Azure

This application has been migrated from an Azure-based architecture to Slack
Native (ROSI). Key changes:

### Removed

- ❌ Azure App Service
- ❌ Azure Functions (Timer triggers)
- ❌ Azure Key Vault
- ❌ Azure DevOps integration (automated ADR push)
- ❌ Terraform infrastructure
- ❌ Node.js/npm dependencies
- ❌ Docker containers

### Added

- ✅ Deno runtime on Slack ROSI
- ✅ Slack Datastores
- ✅ Slack Workflows and Functions
- ✅ Slack scheduled triggers
- ✅ Manual ADR workflow (markdown posted to Slack)

### Benefits

- 90% cost reduction ($10-50/mo vs $171-266/mo)
- 85% less maintenance (1-2 hrs/mo vs 8-12 hrs/mo)
- Zero secret management overhead
- Automatic scaling and reliability
- Simplified deployment and operations

## Cost Estimate

### Low Volume (<50 decisions/month)

- Workflow executions: $5-15/month
- Datastore operations: $5-10/month
- Scheduled triggers: $10-15/month
- **Total: $20-40/month**

### Medium Volume (50-200 decisions/month)

- Workflow executions: $15-30/month
- Datastore operations: $10-20/month
- Scheduled triggers: $10-15/month
- **Total: $35-65/month**

_Note: Costs may be included in Enterprise Grid plans at no additional charge._

## Documentation

Additional documentation:

- [Architecture Re-evaluation](docs/SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md) -
  Detailed analysis of migration decision
- [Slack Automation Documentation](https://api.slack.com/automation) - Official
  Slack automation docs
- [Deno Manual](https://deno.land/manual) - Deno runtime documentation

## Troubleshooting

### Voting buttons showing warning triangle (⚠️)

This issue has been fixed. Voting buttons now use block action handlers
directly. If you still see warning triangles:

1. Redeploy the app:
   ```bash
   slack deploy
   ```

2. Create a new decision to test with the updated code.

### App not responding to /consensus command

1. Check that triggers are installed:
   ```bash
   slack triggers list
   ```

2. Recreate the trigger if needed:
   ```bash
   slack triggers create --trigger-def triggers/consensus_command.ts
   ```

### Datastores not working

Ensure your Slack plan supports Datastores (requires paid plan). Check datastore
status:

```bash
slack datastore list
```

### Reminders not sending

Check the scheduled trigger status:

```bash
slack triggers list
```

Look for the "Send Voter Reminders" trigger and verify it's active.

### View detailed logs

```bash
slack activity --tail
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for
guidelines.

## License

This project is licensed under the MIT License.

## Support

For questions or issues:

1. Check the documentation
2. Search [GitHub Issues](https://github.com/alex-thorne/ConsensusBot/issues)
3. Create a new issue if needed

## Roadmap

### Completed ✅

- [x] Slack Native ROSI migration
- [x] Datastore-based state management
- [x] Automated voter reminders
- [x] ADR generation for manual archival
- [x] Three consensus criteria (Simple, Super, Unanimous)
- [x] Deadline enforcement

### Future Enhancements 🚧

- [ ] Multi-channel support
- [ ] Decision templates
- [ ] Analytics dashboard
- [ ] Vote delegation
- [ ] Mobile app support
- [ ] Custom success criteria

---

Made with ❤️ for better team collaboration using Slack Native infrastructure
