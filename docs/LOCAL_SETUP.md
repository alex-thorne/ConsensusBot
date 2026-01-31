# Local Development Setup Guide

This guide will help you set up ConsensusBot for local development and testing.

## Prerequisites

Ensure you have the following installed:

- **Node.js** v18 or higher ([Download](https://nodejs.org/))
- **npm** v9 or higher (comes with Node.js)
- **Docker** and **Docker Compose** ([Download](https://www.docker.com/get-started))
- **Git** ([Download](https://git-scm.com/))

## Step-by-Step Setup

### 1. Clone the Repository

```bash
git clone https://github.com/alex-thorne/ConsensusBot.git
cd ConsensusBot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create a Slack App

1. **Visit the Slack API Dashboard**: Go to [https://api.slack.com/apps](https://api.slack.com/apps)

2. **Create New App**:
   - Click "Create New App"
   - Choose "From scratch"
   - Name your app (e.g., "ConsensusBot Dev")
   - Select your development workspace

3. **Configure OAuth & Permissions**:
   - Navigate to "OAuth & Permissions" in the sidebar
   - Add the following Bot Token Scopes:
     - `app_mentions:read` - View messages that directly mention the bot
     - `chat:write` - Send messages as the bot
     - `commands` - Add shortcuts and slash commands
     - `im:history` - View messages in direct messages
     - `im:read` - View basic information about direct messages
     - `im:write` - Start direct messages with people
     - `users:read` - View people in the workspace
   - Click "Install to Workspace" and authorize the app
   - Copy the **Bot User OAuth Token** (starts with `xoxb-`)

4. **Enable Socket Mode**:
   - Navigate to "Socket Mode" in the sidebar
   - Enable Socket Mode
   - Create an **App-Level Token** with the `connections:write` scope
   - Copy the **App-Level Token** (starts with `xapp-`)

5. **Get Signing Secret**:
   - Navigate to "Basic Information" in the sidebar
   - Under "App Credentials", copy the **Signing Secret**

6. **Enable Events**:
   - Navigate to "Event Subscriptions" in the sidebar
   - Enable Events
   - Subscribe to Bot Events:
     - `app_home_opened` - User opened the app's home tab
     - `app_mention` - Bot was mentioned in a message
     - `message.im` - Message was sent to the bot

7. **Add Slash Commands**:
   - Navigate to "Slash Commands" in the sidebar
   - Create a new command:
     - Command: `/consensus`
     - Description: "Start a consensus-building session"
     - Usage Hint: "[topic]"

8. **Configure App Home**:
   - Navigate to "App Home" in the sidebar
   - Enable the "Home Tab"
   - Enable "Messages Tab"

### 4. Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` and add your Slack credentials:

```env
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_APP_TOKEN=xapp-your-app-token-here
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

### 5. Run the Application

#### Option A: Run with Node.js (Development)

```bash
npm run dev
```

This will start the app with nodemon, which auto-restarts on file changes.

#### Option B: Run with Docker

```bash
docker-compose up
```

To run in detached mode:

```bash
docker-compose up -d
```

To view logs:

```bash
docker-compose logs -f
```

To stop:

```bash
docker-compose down
```

### 6. Test the Bot

1. **Open Slack**: Go to your development workspace
2. **Find the Bot**: Look for your bot in the Apps section
3. **Test Commands**:
   - Send a direct message: "hello"
   - Use the slash command: `/consensus`
   - Mention the bot: `@ConsensusBot hello`
4. **Check the Home Tab**: Click on the bot and view the Home tab

## Development Workflow

### Making Changes

1. **Edit Code**: Make changes in the `src/` directory
2. **Auto-Reload**: If using `npm run dev`, the app will restart automatically
3. **Test**: Test your changes in Slack
4. **Commit**: Commit your changes with a descriptive message

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Linting

```bash
# Check for linting issues
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

## Common Issues and Solutions

### Port Already in Use

**Error**: `Error: listen EADDRINUSE: address already in use :::3000`

**Solution**: Either stop the process using port 3000, or change the port in `.env`:

```env
PORT=3001
```

### Slack Connection Issues

**Error**: Bot not responding or events not being received

**Solutions**:
1. Verify all tokens are correct in `.env`
2. Ensure Socket Mode is enabled in Slack app settings
3. Check that the app is installed in your workspace
4. Verify event subscriptions are configured correctly

### Docker Build Fails

**Error**: Docker build fails or container won't start

**Solutions**:
1. Ensure Docker is running
2. Check that `.env` file exists and has correct values
3. Try rebuilding: `docker-compose build --no-cache`
4. Check logs: `docker-compose logs`

### Module Not Found Errors

**Error**: `Cannot find module 'some-package'`

**Solution**: Reinstall dependencies:

```bash
rm -rf node_modules package-lock.json
npm install
```

## Debugging

### Console Logging

Add debug logs in your code:

```javascript
console.log('Debug info:', someVariable);
```

### Using Node.js Debugger

```bash
node --inspect src/index.js
```

Then open Chrome and navigate to `chrome://inspect`.

### Checking Slack API Logs

- Go to your app's dashboard at [https://api.slack.com/apps](https://api.slack.com/apps)
- Click on your app
- Navigate to "Event Subscriptions" to see recent events
- Check "OAuth & Permissions" for token-related issues

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token | `xoxb-123-456-abc` |
| `SLACK_SIGNING_SECRET` | Used to verify requests from Slack | `abc123def456` |
| `SLACK_APP_TOKEN` | App-Level Token for Socket Mode | `xapp-1-ABC-123` |
| `PORT` | Port number for the server | `3000` |
| `NODE_ENV` | Environment (development/production) | `development` |
| `LOG_LEVEL` | Logging level | `info` |

## Next Steps

- Read the [CONTRIBUTING.md](../CONTRIBUTING.md) guide
- Review the [Architecture Decision Records](adr/)
- Start building features!

## Getting Help

If you encounter issues:

1. Check this guide thoroughly
2. Search existing GitHub issues
3. Review Slack's [Bolt documentation](https://slack.dev/bolt-js/)
4. Create a new issue with details about your problem
