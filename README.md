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
│   └── workflows/        # GitHub Actions CI/CD workflows
├── config/               # Configuration files
├── docs/                 # Documentation
│   ├── adr/             # Architecture Decision Records
│   └── templates/       # Documentation templates
├── src/                  # Application source code
├── terraform/            # Infrastructure as Code
├── test/                 # Test files
├── .dockerignore         # Docker ignore file
├── .env.example          # Example environment variables
├── .eslintrc.json        # ESLint configuration
├── .gitignore            # Git ignore file
├── docker-compose.yml    # Docker Compose configuration
├── Dockerfile            # Docker image definition
├── jest.config.js        # Jest testing configuration
└── package.json          # Node.js dependencies and scripts
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

## Infrastructure

Infrastructure is managed using Terraform. See the `terraform/` directory for:

- AWS resource definitions
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

- [ ] Implement proposal creation workflow
- [ ] Add voting mechanisms
- [ ] Integrate with project management tools
- [ ] Add analytics and reporting
- [ ] Support for multiple decision-making frameworks

---

Made with ❤️ for better team collaboration
