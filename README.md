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
   - **OAuth & Permissions**: Add required bot token scopes
   - **Socket Mode**: Enable Socket Mode and create an App-Level Token
   - **Event Subscriptions**: Subscribe to relevant events
   - **Slash Commands**: Create commands (e.g., `/consensus`)

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
```

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
  - **Decision Name**: The title of the decision to be made
  - **Required Voters**: Team members whose votes are needed
  - **Success Criteria**: The threshold for consensus (Unanimous, Super Majority, Simple Majority)
  - **Description**: Optional context about the decision

**Example Workflow:**

1. Type `/consensus` in any Slack channel
2. Click the "Create New Decision" button in the response
3. Fill out the modal with your decision details:
   - Decision Name: e.g., "Choose new project framework"
   - Required Voters: Select team members from dropdown
   - Success Criteria: Choose consensus threshold (e.g., "Simple Majority")
   - Description: Add any additional context
4. Click "Create" to submit the decision

### Features Currently Available

✅ **Slash Command Integration**
- `/consensus` command with hello world response
- Help and status subcommands
- Interactive button to open decision modal

✅ **Modal-Based Decision Creation**
- Structured form for collecting decision inputs
- User selection for required voters
- Configurable success criteria (voting thresholds)
- Optional description field

✅ **Enhanced Logging**
- Structured JSON logging
- Log levels (ERROR, WARN, INFO, DEBUG)
- Contextual information in all log entries

✅ **Error Handling**
- Global error handler for Slack events
- Try-catch blocks in all handlers
- User-friendly error messages

### Features In Development

🚧 **Database Integration** (Coming Soon)
- Persistence of decisions
- Vote tracking
- Decision history

🚧 **Voting Mechanisms** (Coming Soon)
- Vote submission interface
- Real-time vote counting
- Consensus calculation based on criteria

🚧 **Notifications** (Coming Soon)
- Notify required voters when decisions are created
- Updates when votes are cast
- Final decision notifications

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

### Stage 1: Application Scaffolding ✅ (Current)
- [x] Main entry point with Bolt SDK
- [x] Robust folder structure (commands/, modals/, utils/)
- [x] Environment management with dotenv
- [x] Basic `/consensus` slash command
- [x] Mock Modal for decision inputs
- [x] Logging and error handling
- [x] Docker setup and documentation
- [x] Initial test suite (26 tests passing)

### Stage 2: Database Integration 🚧 (Next)
- [ ] Database schema design
- [ ] Decision persistence
- [ ] Vote tracking system
- [ ] User and channel management

### Stage 3: Voting Mechanisms
- [ ] Vote submission interface
- [ ] Real-time vote counting
- [ ] Consensus calculation
- [ ] Decision status updates

### Stage 4: Advanced Features
- [ ] Smart notifications
- [ ] Decision analytics and reporting
- [ ] Integration with project management tools
- [ ] Support for multiple decision-making frameworks
- [ ] Admin controls and permissions

---

Made with ❤️ for better team collaboration
