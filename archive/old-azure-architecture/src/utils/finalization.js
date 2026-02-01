/**
 * Decision Finalization Module
 * 
 * Handles the finalization of decisions when:
 * 1. The deadline is reached, or
 * 2. All required voters have submitted their votes
 * 
 * Finalization process:
 * - Calculate decision outcome based on success criteria
 * - Update decision status in database (approved/rejected)
 * - Generate ADR and push to Azure DevOps (if configured)
 * - Notify participants of the outcome
 */

const logger = require('./logger');
const slackState = require('./slackState');
const { calculateDecisionOutcome } = require('./decisionLogic');
const { createAzureDevOpsClient, pushADRToRepository } = require('./azureDevOps');

/**
 * Check if decision should be finalized
 * Decision should be finalized when:
 * 1. All required voters have voted, OR
 * 2. Deadline has been reached
 * 
 * @param {object} decisionState - Decision state object from Slack
 * @returns {object} Finalization check result
 */
const shouldFinalizeDecision = (decisionState) => {
  logger.debug('Checking if decision should be finalized', {
    name: decisionState.name,
    messageTs: decisionState.messageTs,
    voterCount: decisionState.voters.length,
    voteCount: decisionState.votes.length
  });

  // Check if all voters have voted
  const allVotesSubmitted = decisionState.votes.length >= decisionState.voters.length;
  
  // Check if deadline has passed
  const deadline = new Date(decisionState.deadline);
  const now = new Date();
  const deadlineReached = now >= deadline;

  const shouldFinalize = allVotesSubmitted || deadlineReached;
  const reason = allVotesSubmitted 
    ? 'all votes submitted' 
    : deadlineReached 
      ? 'deadline reached' 
      : 'not yet ready';

  logger.debug('Finalization check result', {
    name: decisionState.name,
    shouldFinalize,
    reason,
    allVotesSubmitted,
    deadlineReached
  });

  return {
    shouldFinalize,
    reason,
    allVotesSubmitted,
    deadlineReached
  };
};

/**
 * Finalize a decision
 * 
 * @param {object} client - Slack client instance
 * @param {string} channelId - Channel ID
 * @param {string} messageTs - Message timestamp of the decision
 * @param {object} options - Finalization options
 * @param {boolean} options.pushToAzureDevOps - Whether to push ADR to Azure DevOps (default: true if configured)
 * @returns {Promise<object>} Finalization result
 */
const finalizeDecision = async (client, channelId, messageTs, options = {}) => {
  logger.info('Starting decision finalization', { channelId, messageTs });

  try {
    // Get decision state from Slack
    const decisionState = await slackState.getDecisionState(client, channelId, messageTs);
    
    // Check if decision is already finalized
    if (decisionState.status !== 'active') {
      logger.warn('Decision already finalized', {
        messageTs,
        status: decisionState.status
      });
      return {
        success: false,
        error: 'Decision already finalized',
        status: decisionState.status
      };
    }

    // Check if decision should be finalized
    const finalizationCheck = shouldFinalizeDecision(decisionState);
    if (!finalizationCheck.shouldFinalize) {
      logger.info('Decision not ready for finalization', {
        messageTs,
        reason: finalizationCheck.reason
      });
      return {
        success: false,
        error: 'Decision not ready for finalization',
        reason: finalizationCheck.reason
      };
    }

    // Calculate decision outcome
    const outcome = calculateDecisionOutcome(
      decisionState.votes,
      decisionState.successCriteria,
      decisionState.voters.length
    );

    // Add additional outcome metadata
    outcome.approved = outcome.passed;
    outcome.requiredVoters = decisionState.voters.length;

    logger.info('Decision outcome calculated', {
      messageTs,
      approved: outcome.approved,
      reason: outcome.reason
    });

    // Determine new status
    const newStatus = outcome.approved ? 'approved' : 'rejected';

    // Update decision status in Slack
    await slackState.updateDecisionStatus(client, channelId, messageTs, newStatus);

    logger.info('Decision status updated in Slack', {
      messageTs,
      status: newStatus
    });

    // Initialize result
    const result = {
      success: true,
      messageTs,
      channelId,
      status: newStatus,
      approved: outcome.approved,
      outcome,
      finalizationReason: finalizationCheck.reason,
      adr: null
    };

    // Push ADR to Azure DevOps if configured
    const shouldPushADR = options.pushToAzureDevOps !== false 
      && process.env.AZURE_DEVOPS_PAT;

    if (shouldPushADR) {
      try {
        logger.info('Pushing ADR to Azure DevOps', { messageTs });
        
        const adoClient = createAzureDevOpsClient();
        const adrResult = await pushADRToRepository(decisionState, decisionState.votes, outcome, adoClient);
        
        result.adr = adrResult;
        
        logger.info('ADR pushed successfully', {
          messageTs,
          filePath: adrResult.filePath
        });
      } catch (adrError) {
        logger.error('Failed to push ADR to Azure DevOps', {
          messageTs,
          error: adrError.message,
          stack: adrError.stack
        });
        
        // Don't fail finalization if ADR push fails
        result.adr = {
          success: false,
          error: adrError.message
        };
      }
    } else {
      logger.debug('ADR push skipped', {
        messageTs,
        reason: options.pushToAzureDevOps === false 
          ? 'disabled in options' 
          : 'Azure DevOps not configured'
      });
    }

    // Send Slack notification
    try {
      await notifyDecisionFinalized(
        client,
        decisionState,
        outcome,
        result.adr
      );
    } catch (notifyError) {
      logger.error('Failed to send Slack notification', {
        messageTs,
        error: notifyError.message
      });
      // Don't fail finalization if notification fails
    }

    logger.info('Decision finalization completed', {
      messageTs,
      status: newStatus,
      adrPushed: !!result.adr?.success
    });

    return result;

  } catch (error) {
    logger.error('Error finalizing decision', {
      messageTs,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Send Slack notification about finalized decision
 * 
 * @param {object} client - Slack client instance
 * @param {object} decisionState - Decision state object
 * @param {object} outcome - Decision outcome
 * @param {object|null} adrResult - ADR push result (optional)
 * @returns {Promise<void>}
 */
const notifyDecisionFinalized = async (client, decisionState, outcome, adrResult = null) => {
  logger.info('Sending finalization notification', {
    messageTs: decisionState.messageTs,
    channelId: decisionState.channelId
  });

  const emoji = outcome.approved ? '✅' : '❌';
  const status = outcome.approved ? 'Approved' : 'Rejected';
  
  let message = `${emoji} *Decision Finalized: ${status}*\n\n`;
  message += `*${decisionState.name}*\n\n`;
  message += `${outcome.reason}\n\n`;
  
  if (adrResult && adrResult.success) {
    message += `📝 ADR generated and pushed to Azure DevOps: ${adrResult.filename}`;
  }

  try {
    await client.chat.postMessage({
      channel: decisionState.channelId,
      thread_ts: decisionState.messageTs,
      text: message
    });

    logger.info('Finalization notification sent', {
      messageTs: decisionState.messageTs
    });
  } catch (error) {
    logger.error('Error sending notification', {
      error: error.message,
      messageTs: decisionState.messageTs
    });
    throw error;
  }
};

/**
 * Finalize all decisions that are ready
 * Checks all active decisions and finalizes those that meet the criteria
 * 
 * @param {object} client - Slack client instance
 * @param {string} channelId - Channel ID to check for decisions
 * @param {object} options - Finalization options
 * @returns {Promise<object>} Summary of finalization results
 */
const finalizeReadyDecisions = async (client, channelId, options = {}) => {
  logger.info('Starting batch decision finalization', { channelId });

  try {
    const openDecisions = await slackState.getOpenDecisions(client, channelId);
    
    logger.info('Found open decisions', { count: openDecisions.length });

    const results = {
      total: 0,
      finalized: 0,
      skipped: 0,
      errors: 0,
      decisions: []
    };

    for (const decisionState of openDecisions) {
      results.total++;

      try {
        const check = shouldFinalizeDecision(decisionState);
        
        if (check.shouldFinalize) {
          logger.info('Finalizing decision', {
            messageTs: decisionState.messageTs,
            reason: check.reason
          });

          const result = await finalizeDecision(
            client, 
            decisionState.channelId, 
            decisionState.messageTs, 
            options
          );
          
          if (result.success) {
            results.finalized++;
            results.decisions.push({
              messageTs: decisionState.messageTs,
              name: decisionState.name,
              status: result.status,
              success: true
            });
          } else {
            results.skipped++;
            results.decisions.push({
              messageTs: decisionState.messageTs,
              name: decisionState.name,
              success: false,
              error: result.error
            });
          }
        } else {
          logger.debug('Decision not ready for finalization', {
            messageTs: decisionState.messageTs,
            reason: check.reason
          });
          results.skipped++;
        }
      } catch (error) {
        logger.error('Error processing decision', {
          messageTs: decisionState.messageTs,
          error: error.message
        });
        results.errors++;
        results.decisions.push({
          messageTs: decisionState.messageTs,
          name: decisionState.name,
          success: false,
          error: error.message
        });
      }
    }

    logger.info('Batch finalization completed', {
      total: results.total,
      finalized: results.finalized,
      skipped: results.skipped,
      errors: results.errors
    });

    return results;

  } catch (error) {
    logger.error('Error in batch finalization', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

module.exports = {
  shouldFinalizeDecision,
  finalizeDecision,
  notifyDecisionFinalized,
  finalizeReadyDecisions
};
