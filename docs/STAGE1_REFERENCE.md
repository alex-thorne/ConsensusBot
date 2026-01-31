# Stage 1: Application Scaffolding - Quick Reference

This document provides a quick reference for the Stage 1 implementation of ConsensusBot.

## What Was Implemented

### 1. Application Structure

The application now has a well-organized folder structure:

```
src/
├── commands/           # Slash command handlers
│   └── consensusCommand.js
├── modals/            # Modal definitions
│   └── consensusModal.js
├── utils/             # Utility modules
│   └── logger.js
└── index.js           # Main entry point
```

### 2. Core Features

#### `/consensus` Slash Command

The main entry point for users to interact with ConsensusBot.

**Subcommands:**
- `/consensus` - Display welcome message and button to create a decision
- `/consensus help` - Show help information
- `/consensus status` - Check pending decisions (placeholder)

**Response Format:**
```json
{
  "response_type": "ephemeral",
  "text": "Hello! ConsensusBot is ready to help your team make decisions.",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": ":wave: *Hello! Welcome to ConsensusBot*..."
      }
    },
    {
      "type": "divider"
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Quick Start:*..."
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "Create New Decision"
          },
          "action_id": "open_consensus_modal",
          "value": "create_decision"
        }
      ]
    }
  ]
}
```

#### Consensus Decision Modal

Modal for collecting decision inputs with the following fields:

1. **Decision Name** (required)
   - Type: `plain_text_input`
   - Max Length: 200 characters
   - Example: "Choose new project framework"

2. **Required Voters** (required)
   - Type: `multi_users_select`
   - Allows selection of team members who must vote

3. **Success Criteria** (required)
   - Type: `static_select`
   - Options:
     - Unanimous (100%)
     - Super Majority (75%)
     - Simple Majority (50%+1)

4. **Description** (optional)
   - Type: `plain_text_input` (multiline)
   - Max Length: 1000 characters
   - Additional context about the decision

**Modal Submission:**
Currently logs the submission data. Database integration will be added in Stage 2.

#### Structured Logging

The logger utility provides consistent, structured logging throughout the application:

**Log Levels:**
- `ERROR` - Error conditions
- `WARN` - Warning conditions
- `INFO` - Informational messages (default)
- `DEBUG` - Debug-level messages

**Usage:**
```javascript
const logger = require('./utils/logger');

logger.info('User action', { userId: 'U123', action: 'click' });
logger.error('Failed to process', { error: error.message, stack: error.stack });
```

**Output Format:**
```json
{
  "timestamp": "2024-01-31T12:00:00.000Z",
  "level": "INFO",
  "message": "User action",
  "userId": "U123",
  "action": "click"
}
```

**Configuration:**
Set `LOG_LEVEL` environment variable to control verbosity:
```bash
LOG_LEVEL=debug  # Show all logs
LOG_LEVEL=info   # Show info, warn, error (default)
LOG_LEVEL=warn   # Show warn, error
LOG_LEVEL=error  # Show only errors
```

### 3. Error Handling

Error handling is implemented at multiple levels:

1. **Global Error Handler** - Catches all unhandled Slack app errors
2. **Command Error Handling** - Try-catch blocks in all command handlers
3. **User-Friendly Messages** - Displays helpful error messages to users
4. **Structured Error Logging** - Logs errors with full context

### 4. Testing

Comprehensive test suite with 26 tests covering:

- **Modal Structure Tests** - Validates Slack JSON structure
- **Command Response Tests** - Verifies response formats
- **Logger Tests** - Tests logging functionality
- **Configuration Tests** - Ensures proper configuration loading

**Running Tests:**
```bash
npm test              # Run all tests with coverage
npm run test:watch    # Run tests in watch mode
```

**Coverage Report:**
- `src/modals/consensusModal.js` - 100% coverage
- `src/utils/logger.js` - 100% statement coverage

## Environment Configuration

Required environment variables (see `.env.example`):

```bash
# Slack App Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_APP_TOKEN=xapp-your-app-token-here

# Application Configuration
PORT=3000
NODE_ENV=development

# Logging Configuration
LOG_LEVEL=info
```

## Running the Application

### Local Development

```bash
# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Run in production mode
npm start
```

### Docker

```bash
# Build and run with Docker Compose
docker-compose up

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

## Code Quality

### Linting

ESLint is configured with recommended rules:

```bash
npm run lint        # Check code style
npm run lint:fix    # Auto-fix issues
```

### Testing

Jest is configured for testing:

```bash
npm test           # Run tests with coverage
npm run test:watch # Watch mode for development
```

## Architecture Decisions

Key architectural decisions made in this stage:

1. **Modular Structure** - Separate files for commands, modals, and utilities
2. **Structured Logging** - JSON-based logging for better observability
3. **Socket Mode** - Using Slack Socket Mode for development simplicity
4. **Bolt SDK** - Using official Slack Bolt framework for Node.js
5. **Modal-First Design** - Using modals for structured data collection

## Next Steps (Stage 2)

The following features will be implemented in Stage 2:

1. **Database Integration**
   - Design and implement database schema
   - Add persistence for decisions
   - Track votes and user interactions

2. **Enhanced Vote Tracking**
   - Store decision data
   - Track individual votes
   - Calculate consensus based on criteria

3. **Notification System**
   - Notify required voters
   - Send updates on vote changes
   - Final decision notifications

## Troubleshooting

### Application Won't Start

**Check environment variables:**
```bash
# Ensure all required variables are set
cat .env
```

**Verify Slack credentials:**
- Bot Token should start with `xoxb-`
- App Token should start with `xapp-`
- Socket Mode must be enabled in Slack app settings

### Tests Failing

**Clear Jest cache:**
```bash
npm test -- --clearCache
```

**Check Node version:**
```bash
node --version  # Should be >= 18.0.0
```

### Linting Errors

**Auto-fix issues:**
```bash
npm run lint:fix
```

**Check ESLint configuration:**
```bash
cat .eslintrc.json
```

## Resources

- [Slack Bolt SDK Documentation](https://slack.dev/bolt-js/)
- [Slack API Documentation](https://api.slack.com/)
- [Jest Testing Documentation](https://jestjs.io/)
- [ESLint Documentation](https://eslint.org/)
- [Docker Documentation](https://docs.docker.com/)
