/**
 * Reminder System Module (Nudger)
 * 
 * Implements placeholder logic for the voter reminder system.
 * This module can be triggered by an Azure Timer Function or other scheduler.
 * 
 * Features:
 * - Query open decisions needing votes
 * - Identify missing voters for each decision
 * - Send DM reminders to voters who haven't voted
 * 
 * NOTE: This is a placeholder implementation. Integration with Azure Timer Function
 * requires deployment configuration (see REMINDER_DEPLOYMENT.md)
 */

const logger = require('./logger');
const slackState = require('./slackState');

/**
 * Get all open decisions that need votes
 * Returns decisions with incomplete voting
 * 
 * @param {object} client - Slack client instance
 * @param {string} channelId - Channel ID to check for decisions
 * @returns {Promise<Array<object>>} Array of decisions with vote status
 */
const getDecisionsNeedingVotes = async (client, channelId) => {
  logger.info('Fetching decisions needing votes from Slack');
  
  try {
    // Get all open (active) decisions from pinned messages
    const openDecisions = await slackState.getOpenDecisions(client, channelId);
    
    const decisionsNeedingVotes = [];
    
    for (const decision of openDecisions) {
      // Check for missing voters
      const missingVoters = slackState.getMissingVoters(decision);
      
      // If there are missing voters, include this decision
      if (missingVoters.length > 0) {
        decisionsNeedingVotes.push({
          ...decision,
          requiredVotersCount: decision.voters.length,
          actualVotesCount: decision.votes.length,
          missingVotersCount: missingVoters.length,
          missingVoters: missingVoters
        });
      }
    }
    
    logger.info('Decisions needing votes retrieved from Slack', {
      count: decisionsNeedingVotes.length
    });
    
    return decisionsNeedingVotes;
  } catch (error) {
    logger.error('Error fetching decisions needing votes from Slack', {
      error: error.message,
      stack: error.stack
    });
    return [];
  }
};

/**
 * Send reminder DM to a single voter
 * 
 * @param {object} client - Slack client instance
 * @param {string} userId - User ID to send reminder to
 * @param {object} decision - Decision object
 * @param {string} messageUrl - URL to the original Slack message
 * @returns {Promise<boolean>} Success status
 */
const sendVoterReminder = async (client, userId, decision, messageUrl) => {
  try {
    logger.info('Sending voter reminder', {
      userId,
      decisionName: decision.name,
      messageTs: decision.messageTs
    });
    
    // Calculate time until deadline
    const deadline = new Date(decision.deadline);
    const now = new Date();
    const daysUntilDeadline = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
    
    // Format deadline message
    let deadlineText = '';
    if (daysUntilDeadline <= 0) {
      deadlineText = '⚠️ *The deadline has passed!*';
    } else if (daysUntilDeadline === 1) {
      deadlineText = '⏰ *Deadline: Tomorrow*';
    } else {
      deadlineText = `⏰ *Deadline: ${daysUntilDeadline} days from now*`;
    }
    
    // Send DM
    await client.chat.postMessage({
      channel: userId,
      text: `Reminder: Your vote is needed for "${decision.name}"`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '👋 Hi! This is a friendly reminder that your vote is needed for the following decision:'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*📋 ${decision.name}*\n\n${decision.proposal.substring(0, 200)}${decision.proposal.length > 200 ? '...' : ''}`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: deadlineText
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'View Decision & Vote',
                emoji: true
              },
              url: messageUrl,
              style: 'primary'
            }
          ]
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Created by <@${decision.creatorId}>`
            }
          ]
        }
      ]
    });
    
    logger.info('Reminder sent successfully', {
      userId,
      messageTs: decision.messageTs
    });
    
    return true;
  } catch (error) {
    logger.error('Error sending voter reminder', {
      error: error.message,
      stack: error.stack,
      userId,
      messageTs: decision.messageTs
    });
    return false;
  }
};

/**
 * Send reminders to all missing voters for a decision
 * 
 * @param {object} client - Slack client instance
 * @param {object} decision - Decision object (from Slack state)
 * @returns {Promise<object>} Summary of reminders sent
 */
const sendRemindersForDecision = async (client, decision) => {
  try {
    logger.info('Sending reminders for decision', { 
      messageTs: decision.messageTs,
      name: decision.name
    });
    
    // Only send reminders for active decisions
    if (decision.status !== 'active') {
      logger.warn('Cannot send reminders for non-active decision', {
        messageTs: decision.messageTs,
        status: decision.status
      });
      return { success: false, error: 'Decision is not active' };
    }
    
    const missingVoters = slackState.getMissingVoters(decision);
    
    if (missingVoters.length === 0) {
      logger.info('No missing voters for decision', { messageTs: decision.messageTs });
      return { success: true, remindersSent: 0 };
    }
    
    // Construct message URL
    const messageUrl = decision.messageTs 
      ? `https://slack.com/archives/${decision.channelId}/p${decision.messageTs.replace('.', '')}`
      : null;
    
    let successCount = 0;
    let failureCount = 0;
    
    for (const voterId of missingVoters) {
      const success = await sendVoterReminder(
        client, 
        voterId, 
        decision, 
        messageUrl
      );
      
      if (success) {
        successCount++;
      } else {
        failureCount++;
      }
      
      // Add small delay between messages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.info('Reminders completed for decision', {
      messageTs: decision.messageTs,
      totalMissing: missingVoters.length,
      successCount,
      failureCount
    });
    
    return {
      success: true,
      totalMissing: missingVoters.length,
      remindersSent: successCount,
      failed: failureCount
    };
  } catch (error) {
    logger.error('Error sending reminders for decision', {
      error: error.message,
      stack: error.stack,
      messageTs: decision.messageTs
    });
    return { success: false, error: error.message };
  }
};

/**
 * Main nudger function - sends reminders for all open decisions
 * This function should be called by a scheduler (e.g., Azure Timer Function)
 * 
 * @param {object} client - Slack client instance
 * @param {string} channelId - Channel ID to check for decisions
 * @returns {Promise<object>} Summary of all reminders sent
 */
const runNudger = async (client, channelId) => {
  logger.info('Starting nudger run for channel', { channelId });
  
  try {
    const decisionsNeedingVotes = await getDecisionsNeedingVotes(client, channelId);
    
    if (decisionsNeedingVotes.length === 0) {
      logger.info('No decisions need reminders');
      return {
        success: true,
        decisionsProcessed: 0,
        totalRemindersSent: 0
      };
    }
    
    logger.info('Processing decisions for reminders', {
      count: decisionsNeedingVotes.length
    });
    
    let totalRemindersSent = 0;
    let totalFailed = 0;
    
    for (const decision of decisionsNeedingVotes) {
      const result = await sendRemindersForDecision(client, decision);
      
      if (result.success) {
        totalRemindersSent += result.remindersSent || 0;
        totalFailed += result.failed || 0;
      }
      
      // Add delay between decisions
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    logger.info('Nudger run completed', {
      decisionsProcessed: decisionsNeedingVotes.length,
      totalRemindersSent,
      totalFailed
    });
    
    return {
      success: true,
      decisionsProcessed: decisionsNeedingVotes.length,
      totalRemindersSent,
      totalFailed
    };
  } catch (error) {
    logger.error('Error in nudger run', {
      error: error.message,
      stack: error.stack
    });
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * PLACEHOLDER: Azure Timer Function handler
 * 
 * This is a placeholder showing how the nudger would be triggered
 * by an Azure Timer Function. Actual implementation requires Azure
 * Function deployment.
 * 
 * Example Azure Function configuration (function.json):
 * {
 *   "bindings": [
 *     {
 *       "name": "myTimer",
 *       "type": "timerTrigger",
 *       "direction": "in",
 *       "schedule": "0 0 9 * * *"  // Run daily at 9 AM
 *     }
 *   ]
 * }
 */
const azureTimerHandler = async (context) => {
  context.log('Nudger timer trigger function started');
  
  // Initialize Slack client (would need to be configured)
  // const client = initializeSlackClient();
  
  // Run the nudger
  // const result = await runNudger(client);
  
  // context.log('Nudger completed', result);
  
  context.log('NOTE: This is a placeholder. Actual implementation requires Slack client setup.');
};

module.exports = {
  getDecisionsNeedingVotes,
  sendVoterReminder,
  sendRemindersForDecision,
  runNudger,
  azureTimerHandler
};
