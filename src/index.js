/**
 * ConsensusBot - Main Application Entry Point
 * 
 * This is the main entry point for the ConsensusBot Slack application.
 * It initializes the Slack Bolt app, sets up event listeners, and starts the server.
 * 
 * Features:
 * - Slash command handlers (/consensus)
 * - Modal interactions for decision creation
 * - Event listeners for app home and messages
 * - Centralized error handling and logging
 */

const { App } = require('@slack/bolt');
require('dotenv').config();

const logger = require('./utils/logger');
const { registerConsensusCommand, registerVotingHandlers } = require('./commands/consensusCommand');

// Initialize the Slack app with configuration from environment variables
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // Enable socket mode for development
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000,
});

logger.info('ConsensusBot initializing', {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000
});

/**
 * Health check middleware
 * Used by Docker and monitoring systems to verify the app is running
 */
app.use(async ({ next }) => {
  await next();
});

/**
 * Register command handlers
 */
registerConsensusCommand(app);
registerVotingHandlers(app);

/**
 * Home Tab - Display the app home screen
 */
app.event('app_home_opened', async ({ event, client }) => {
  try {
    logger.info('App home opened', { userId: event.user });

    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Welcome to ConsensusBot!* :wave:\n\nI help teams make decisions through collaborative consensus building.',
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Get started by using slash commands or mentioning me in a channel.',
            },
          },
        ],
      },
    });

    logger.info('App home published successfully', { userId: event.user });

  } catch (error) {
    logger.error('Error publishing home tab', {
      error: error.message,
      stack: error.stack,
      userId: event.user
    });
  }
});

/**
 * Message Handler - Respond to messages mentioning the bot
 */
app.message('hello', async ({ message, say }) => {
  try {
    logger.info('Hello message received', { userId: message.user });

    await say(`Hello <@${message.user}>! I'm ConsensusBot, ready to help your team make decisions.`);

    logger.info('Hello response sent', { userId: message.user });

  } catch (error) {
    logger.error('Error handling hello message', {
      error: error.message,
      stack: error.stack,
      userId: message.user
    });
  }
});

/**
 * Global error handler for the Slack app
 * Catches and logs all unhandled errors from Slack events
 */
app.error(async (error) => {
  logger.error('Slack app error', {
    error: error.message,
    stack: error.stack,
    code: error.code
  });
});

/**
 * Start the app
 */
(async () => {
  try {
    const port = process.env.PORT || 3000;
    await app.start(port);
    
    logger.info('ConsensusBot started successfully', {
      port,
      nodeEnv: process.env.NODE_ENV || 'development',
      socketMode: true
    });
    
    console.log(`⚡️ ConsensusBot is running on port ${port}!`);
  } catch (error) {
    logger.error('Failed to start ConsensusBot', {
      error: error.message,
      stack: error.stack
    });
    
    console.error('Failed to start app:', error);
    process.exit(1);
  }
})();

module.exports = app;
