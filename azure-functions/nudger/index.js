/**
 * Azure Timer Trigger Function for ConsensusBot Nudger
 * 
 * This function runs on a schedule (Mon-Fri at 9:00 AM UTC) to send
 * reminder DMs to voters who haven't cast their votes on active decisions.
 * 
 * Schedule: "0 0 9 * * 1-5" (cron format)
 * - Second: 0
 * - Minute: 0
 * - Hour: 9 (9 AM UTC)
 * - Day of month: * (every day)
 * - Month: * (every month)
 * - Day of week: 1-5 (Monday to Friday)
 * 
 * Environment Variables Required:
 * - SLACK_BOT_TOKEN: Bot token for Slack API
 * - SLACK_SIGNING_SECRET: Signing secret for Slack verification
 * - NUDGER_CHANNEL_ID: Channel ID to check for active decisions (optional, can be configured per deployment)
 * 
 * @param {object} context - Azure Function context
 * @param {object} nudgerTimer - Timer trigger information
 */

const { App } = require('@slack/bolt');
const { runNudger } = require('../../src/utils/reminder');
const logger = require('../../src/utils/logger');

/**
 * Initialize Slack client
 * Reuses the same configuration as the main bot
 */
const initializeSlackClient = () => {
  try {
    const app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      // Azure Functions don't need Socket Mode
      socketMode: false
    });
    
    return app.client;
  } catch (error) {
    logger.error('Failed to initialize Slack client', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Main Azure Function handler
 */
module.exports = async function (context, nudgerTimer) {
  const timeStamp = new Date().toISOString();
  
  context.log('=========================================');
  context.log('Nudger Timer Trigger Function Started');
  context.log('Timestamp:', timeStamp);
  context.log('Next execution:', nudgerTimer.schedule.nextOccurrences(1));
  context.log('=========================================');
  
  try {
    // Validate environment variables
    if (!process.env.SLACK_BOT_TOKEN) {
      throw new Error('SLACK_BOT_TOKEN environment variable is not set');
    }
    if (!process.env.SLACK_SIGNING_SECRET) {
      throw new Error('SLACK_SIGNING_SECRET environment variable is not set');
    }
    
    // Get channel ID from environment or use a default
    const channelId = process.env.NUDGER_CHANNEL_ID;
    if (!channelId) {
      throw new Error('NUDGER_CHANNEL_ID environment variable is not set. Please configure the channel to monitor for decisions.');
    }
    
    // Initialize Slack client
    context.log('Initializing Slack client...');
    const slackClient = initializeSlackClient();
    
    // Run the nudger
    context.log(`Starting nudger run for channel: ${channelId}...`);
    const result = await runNudger(slackClient, channelId);
    
    if (result.success) {
      context.log('✅ Nudger completed successfully:', {
        decisionsProcessed: result.decisionsProcessed,
        totalRemindersSent: result.totalRemindersSent,
        totalFailed: result.totalFailed
      });
      
      logger.info('Nudger timer function completed', {
        timestamp: timeStamp,
        result
      });
    } else {
      context.log.error('❌ Nudger run failed:', {
        error: result.error
      });
      
      logger.error('Nudger timer function failed', {
        timestamp: timeStamp,
        error: result.error
      });
      
      // Don't throw - let Azure handle retries based on configuration
      context.res = {
        status: 500,
        body: `Nudger failed: ${result.error}`
      };
    }
    
    context.log('=========================================');
    context.log('Nudger Timer Trigger Function Completed');
    context.log('=========================================');
    
  } catch (error) {
    context.log.error('💥 Critical error in nudger timer function:', {
      error: error.message,
      stack: error.stack
    });
    
    logger.error('Critical error in nudger timer function', {
      error: error.message,
      stack: error.stack,
      timestamp: timeStamp
    });
    
    // Throw to trigger Azure's retry mechanism
    throw error;
  }
};
