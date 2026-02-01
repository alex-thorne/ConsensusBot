/**
 * Configuration module for ConsensusBot
 * 
 * This module exports configuration values used throughout the application.
 * Values are loaded from environment variables with sensible defaults.
 */

module.exports = {
  // Slack App Configuration
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
  },

  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Application Features (to be expanded)
  features: {
    // Feature flags can be added here
    enableVoting: true,
    enablePolls: true,
  },
};
