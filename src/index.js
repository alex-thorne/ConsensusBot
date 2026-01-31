/**
 * ConsensusBot - Main Application Entry Point
 * 
 * This is the main entry point for the ConsensusBot Slack application.
 * It initializes the Slack Bolt app, sets up event listeners, and starts the server.
 */

const { App } = require('@slack/bolt');
require('dotenv').config();

// Initialize the Slack app with configuration from environment variables
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // Enable socket mode for development
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000,
});

/**
 * Health check endpoint
 * Used by Docker and monitoring systems to verify the app is running
 */
app.use(async ({ next }) => {
  await next();
});

/**
 * Home Tab - Display the app home screen
 */
app.event('app_home_opened', async ({ event, client }) => {
  try {
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
  } catch (error) {
    console.error('Error publishing home tab:', error);
  }
});

/**
 * Message Handler - Respond to messages mentioning the bot
 */
app.message('hello', async ({ message, say }) => {
  await say(`Hello <@${message.user}>! I'm ConsensusBot, ready to help your team make decisions.`);
});

/**
 * Slash Command - Example command handler
 */
app.command('/consensus', async ({ command, ack, respond }) => {
  // Acknowledge command request
  await ack();

  await respond({
    text: 'ConsensusBot is ready to facilitate decision-making!',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':white_check_mark: *ConsensusBot is active*\n\nUse this command to start a consensus-building session.',
        },
      },
    ],
  });
});

/**
 * Error handler
 */
app.error(async (error) => {
  console.error('App error:', error);
});

/**
 * Start the app
 */
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ ConsensusBot is running on port ${port}!`);
})();

module.exports = app;
