# ConsensusBot

A Slack App to facilitate team decision-making through collaborative consensus building.

## Overview

ConsensusBot is a Slack application designed to help teams make decisions collaboratively. It provides tools for creating proposals, gathering feedback, and reaching consensus through structured decision-making processes.

## Features

- 🗳️ **Consensus Building**: Facilitate team decisions with structured voting mechanisms
- 💬 **Interactive Discussions**: Enable threaded conversations around proposals
- 📊 **Decision Tracking**: Keep a record of all team decisions
- 🔔 **Smart Notifications**: Get notified about pending decisions and updates

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **npm** (v9 or higher)
- **Docker** and **Docker Compose** (for containerized deployment)
- A **Slack Workspace** where you have admin permissions

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/alex-thorne/ConsensusBot.git
cd ConsensusBot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Slack App

1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Create a new app or use an existing one
3. Configure the following settings:

   **OAuth & Permissions** - Add required bot token scopes:
   - `chat:write` - Post messages to channels
   - `chat:write.public` - Post messages to public channels without joining
   - `commands` - Add slash commands
   - `pins:write` - Pin messages to channels
   - `users:read` - View users in the workspace
   
   **Socket Mode**: 
   - Enable Socket Mode
   - Create an App-Level Token with `connections:write` scope
   
   **Event Subscriptions**: 
   - Subscribe to `app_home_opened` event
   - Subscribe to `message.channels` event (optional, for message handling)
   
   **Slash Commands**: 
   - Create `/consensus` command
   - Request URL can be blank when using Socket Mode
   - Description: "Create a new consensus decision"
   - Usage hint: "[help|status]"

   **App Home**:
   - Enable the Home Tab
   - Enable the Messages Tab

### 4. Set Up Environment Variables

Copy the example environment file and fill in your Slack credentials:

```bash
cp .env.example .env
```

Edit `.env` and add your Slack tokens:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
DATABASE_PATH=./data/consensus.db  # Optional: defaults to ./data/consensus.db
```

**Note:** The database will be automatically created on first run. No manual database setup is required.

### 5. Run the Application

#### Option A: Run Locally with Node.js

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

#### Option B: Run with Docker

Build and run the Docker container:

```bash
npm run docker:build
npm run docker:run
```

Or use Docker Compose directly:

```bash
docker-compose up
```

To stop the container:

```bash
npm run docker:down
```

## Development

### Running Tests

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

### Linting

Check code style:

```bash
npm run lint
```

Auto-fix linting issues:

```bash
npm run lint:fix
```

### Project Structure

```
ConsensusBot/
├── .github/
│   └── workflows/           # GitHub Actions CI/CD workflows
├── config/                  # Configuration files
│   └── default.js          # Default configuration
├── docs/                    # Documentation
│   ├── adr/                # Architecture Decision Records
│   ├── templates/          # Documentation templates
│   ├── DOCKER.md           # Docker deployment guide
│   └── LOCAL_SETUP.md      # Local setup guide
├── src/                     # Application source code
│   ├── commands/           # Slash command handlers
│   │   └── consensusCommand.js
│   ├── modals/             # Modal definitions
│   │   └── consensusModal.js
│   ├── utils/              # Utility modules
│   │   └── logger.js       # Structured logging
│   └── index.js            # Main entry point
├── terraform/               # Infrastructure as Code
├── test/                    # Test files
│   ├── commands/           # Command tests
│   ├── utils/              # Utility tests
│   └── index.test.js       # Integration tests
├── .dockerignore            # Docker ignore file
├── .env.example             # Example environment variables
├── .eslintrc.json           # ESLint configuration
├── .gitignore               # Git ignore file
├── docker-compose.yml       # Docker Compose configuration
├── Dockerfile               # Docker image definition
├── jest.config.js           # Jest testing configuration
└── package.json             # Node.js dependencies and scripts
```

## Docker Setup and Testing

### Building the Docker Image

```bash
docker build -t consensusbot .
```

### Running the Container

```bash
docker run -p 3000:3000 --env-file .env consensusbot
```

### Using Docker Compose

Docker Compose provides an easier way to manage the container:

```bash
# Start the application
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

### Connecting to Slack

1. Ensure your `.env` file has valid Slack credentials
2. Start the application using any of the methods above
3. The bot will connect to Slack via Socket Mode
4. Test by sending a message to the bot or using a slash command

## Using ConsensusBot

### Available Commands

ConsensusBot supports the following slash commands:

#### `/consensus`

The main command to interact with ConsensusBot.

**Usage:**

```
/consensus              # Start a new consensus decision (shows welcome message with button to open modal)
/consensus help         # Display help information
/consensus status       # Check your pending decisions
```

**What it does:**

- Displays a welcome message explaining ConsensusBot's purpose
- Provides a button to create a new consensus decision
- Opens a modal to collect:
  - **Decision Name**: The title of the decision to be made (required)
  - **Required Voters**: Team members whose votes are needed (required, multi-select)
  - **The Proposal**: Details of the target outcome and strategic alignment (required, max 2000 characters)
  - **Success Criteria**: The threshold for consensus - Unanimity (100%), Supermajority (75%), or Simple Majority (50%+1) (required)
  - **Deadline**: The date by which votes must be cast (defaults to 5 business days from now)

**Example Workflow:**

1. Type `/consensus` in any Slack channel
2. Click the "Create New Decision" button in the response
3. Fill out the modal with your decision details:
   - **Decision Name**: e.g., "Choose new project framework"
   - **Required Voters**: Select team members from dropdown (e.g., @alice, @bob, @charlie)
   - **The Proposal**: "We need to decide on a frontend framework for our new project. React has strong community support and aligns with our team's existing skills."
   - **Success Criteria**: Choose consensus threshold (e.g., "Simple Majority")
   - **Deadline**: Select a date or use the default (5 business days)
4. Click "Create" to submit the decision
5. A voting message will be posted to the channel with Yes/No/Abstain buttons
6. The message will be automatically pinned for visibility
7. Team members can cast their votes by clicking the buttons
8. Votes are recorded in the database and can be changed until the deadline

### Features Currently Available

✅ **Slash Command Integration**
- `/consensus` command with interactive welcome message
- Help and status subcommands
- Interactive button to open decision modal

✅ **Modal-Based Decision Creation**
- Structured form for collecting decision inputs
- Multi-user selection for required voters
- Proposal field with support for detailed descriptions
- Configurable success criteria (voting thresholds)
- Date picker for deadline with smart default (5 business days)
- Input validation and constraints

✅ **Database Integration**
- SQLite database for decision persistence
- Decisions table storing all decision metadata
- Voters table linking users to decisions
- Votes table tracking individual votes
- Automatic schema initialization
- Transaction support for data consistency

✅ **Voting Mechanisms**
- Interactive voting message with Block Kit buttons
- Yes/No/Abstain voting options
- Vote recording and update capability (users can change their votes)
- Automatic message pinning for visibility
- Vote confirmation messages

✅ **Enhanced Logging**
- Structured JSON logging
- Log levels (ERROR, WARN, INFO, DEBUG)
- Contextual information in all log entries

✅ **Error Handling**
- Global error handler for Slack events
- Try-catch blocks in all handlers
- User-friendly error messages

### Database Schema

ConsensusBot uses SQLite to store decision data. The database is automatically created on first run.

**Decisions Table:**
- `id`: Unique identifier
- `name`: Decision name/title
- `proposal`: Detailed proposal description
- `success_criteria`: Voting threshold (simple_majority, super_majority, unanimous)
- `deadline`: Voting deadline date
- `channel_id`: Slack channel where decision was created
- `creator_id`: User who created the decision
- `message_ts`: Timestamp of the voting message (for updates)
- `status`: Current status (active, approved, rejected, expired)
- `created_at`, `updated_at`: Timestamps

**Voters Table:**
- `id`: Unique identifier
- `decision_id`: Reference to the decision
- `user_id`: Slack user ID of the voter
- `required`: Whether this user's vote is required
- `created_at`: Timestamp

**Votes Table:**
- `id`: Unique identifier
- `decision_id`: Reference to the decision
- `user_id`: Slack user ID of the voter
- `vote_type`: The vote cast (yes, no, abstain)
- `voted_at`: Timestamp of when the vote was cast

### Features In Development

🚧 **Notifications** (Coming Soon)
- Notify required voters when decisions are created
- Updates when votes are cast
- Final decision notifications

🚧 **Decision Analytics** (Coming Soon)
- Real-time vote counting and progress tracking
- Consensus calculation based on criteria
- Decision status updates (approved/rejected)
- Historical decision analytics

## Infrastructure

Infrastructure is managed using Terraform. See the `terraform/` directory for:

- Azure resource definitions
- Environment configurations
- State management setup

To initialize Terraform:

```bash
cd terraform
terraform init
terraform plan
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

## Documentation

Additional documentation can be found in the `docs/` directory:

- Architecture Decision Records (ADRs)
- API documentation
- Deployment guides

## License

This project is licensed under the MIT License.

## Support

For questions or issues, please:

1. Check the documentation in the `docs/` directory
2. Search existing [GitHub Issues](https://github.com/alex-thorne/ConsensusBot/issues)
3. Create a new issue if needed

## Roadmap

### Stage 1: Application Scaffolding ✅ (Completed)
- [x] Main entry point with Bolt SDK
- [x] Robust folder structure (commands/, modals/, utils/, database/)
- [x] Environment management with dotenv
- [x] Basic `/consensus` slash command
- [x] Interactive modal for decision inputs
- [x] Logging and error handling
- [x] Docker setup and documentation
- [x] Initial test suite (26 tests passing)

### Stage 2: Database Integration ✅ (Completed)
- [x] Database schema design (SQLite)
- [x] Decision persistence
- [x] Vote tracking system
- [x] Voter management
- [x] Database utilities and queries
- [x] Comprehensive test coverage (54 tests passing)

### Stage 3: Voting Mechanisms ✅ (Completed)
- [x] Vote submission interface with Block Kit buttons
- [x] Interactive Yes/No/Abstain voting
- [x] Vote recording and updates
- [x] Message pinning for visibility
- [x] Enhanced modal with proposal and deadline fields

### Stage 4: Advanced Features (In Progress)
- [ ] Real-time vote counting and progress updates
- [ ] Consensus calculation and decision status updates
- [ ] Smart notifications for voters and decision creators
- [ ] Decision analytics and reporting
- [ ] Deadline enforcement and automatic status updates
- [ ] Integration with project management tools
- [ ] Support for multiple decision-making frameworks
- [ ] Admin controls and permissions

---

Made with ❤️ for better team collaboration
