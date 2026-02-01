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
const db = require('../database/db');
const { calculateDecisionOutcome } = require('./decisionLogic');
const { createAzureDevOpsClient, pushADRToRepository } = require('./azureDevOps');

/**
 * Check if decision should be finalized
 * Decision should be finalized when:
 * 1. All required voters have voted, OR
 * 2. Deadline has been reached
 * 
 * @param {object} decision - Decision object
 * @param {Array<object>} voters - Array of required voters
 * @param {Array<object>} votes - Array of votes cast
 * @returns {object} Finalization check result
 */
const shouldFinalizeDecision = (decision, voters, votes) => {
  logger.debug('Checking if decision should be finalized', {
    decisionId: decision.id,
    voterCount: voters.length,
    voteCount: votes.length
  });

  // Check if all voters have voted
  const allVotesSubmitted = votes.length >= voters.length;
  
  // Check if deadline has passed
  const deadline = new Date(decision.deadline);
  const now = new Date();
  const deadlineReached = now >= deadline;

  const shouldFinalize = allVotesSubmitted || deadlineReached;
  const reason = allVotesSubmitted 
    ? 'all votes submitted' 
    : deadlineReached 
      ? 'deadline reached' 
      : 'not yet ready';

  logger.debug('Finalization check result', {
    decisionId: decision.id,
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
 * @param {number} decisionId - Decision ID to finalize
 * @param {object} options - Finalization options
 * @param {object} options.slackClient - Optional Slack client for notifications
 * @param {boolean} options.pushToAzureDevOps - Whether to push ADR to Azure DevOps (default: true if configured)
 * @returns {Promise<object>} Finalization result
 */
const finalizeDecision = async (decisionId, options = {}) => {
  logger.info('Starting decision finalization', { decisionId });

  try {
    // Get decision data
    const decision = db.getDecision(decisionId);
    if (!decision) {
      throw new Error(`Decision ${decisionId} not found`);
    }

    // Check if decision is already finalized
    if (decision.status !== 'active') {
      logger.warn('Decision already finalized', {
        decisionId,
        status: decision.status
      });
      return {
        success: false,
        error: 'Decision already finalized',
        status: decision.status
      };
    }

    // Get voters and votes
    const voters = db.getVoters(decisionId);
    const votes = db.getVotes(decisionId);

    // Check if decision should be finalized
    const finalizationCheck = shouldFinalizeDecision(decision, voters, votes);
    if (!finalizationCheck.shouldFinalize) {
      logger.info('Decision not ready for finalization', {
        decisionId,
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
      votes,
      decision.success_criteria,
      voters.length
    );

    // Add additional outcome metadata
    outcome.approved = outcome.passed;
    outcome.requiredVoters = voters.length;

    logger.info('Decision outcome calculated', {
      decisionId,
      approved: outcome.approved,
      reason: outcome.reason
    });

    // Determine new status
    const newStatus = outcome.approved ? 'approved' : 'rejected';

    // Update decision status in database
    db.updateDecisionStatus(decisionId, newStatus);

    logger.info('Decision status updated', {
      decisionId,
      status: newStatus
    });

    // Initialize result
    const result = {
      success: true,
      decisionId,
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
        logger.info('Pushing ADR to Azure DevOps', { decisionId });
        
        const adoClient = createAzureDevOpsClient();
        const adrResult = await pushADRToRepository(decision, votes, outcome, adoClient);
        
        result.adr = adrResult;
        
        logger.info('ADR pushed successfully', {
          decisionId,
          filePath: adrResult.filePath
        });
      } catch (adrError) {
        logger.error('Failed to push ADR to Azure DevOps', {
          decisionId,
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
        decisionId,
        reason: options.pushToAzureDevOps === false 
          ? 'disabled in options' 
          : 'Azure DevOps not configured'
      });
    }

    // Send Slack notification if client provided
    if (options.slackClient && decision.channel_id && decision.message_ts) {
      try {
        await notifyDecisionFinalized(
          options.slackClient,
          decision,
          outcome,
          result.adr
        );
      } catch (notifyError) {
        logger.error('Failed to send Slack notification', {
          decisionId,
          error: notifyError.message
        });
        // Don't fail finalization if notification fails
      }
    }

    logger.info('Decision finalization completed', {
      decisionId,
      status: newStatus,
      adrPushed: !!result.adr?.success
    });

    return result;

  } catch (error) {
    logger.error('Error finalizing decision', {
      decisionId,
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
 * @param {object} decision - Decision object
 * @param {object} outcome - Decision outcome
 * @param {object|null} adrResult - ADR push result (optional)
 * @returns {Promise<void>}
 */
const notifyDecisionFinalized = async (client, decision, outcome, adrResult = null) => {
  logger.info('Sending finalization notification', {
    decisionId: decision.id,
    channelId: decision.channel_id
  });

  const emoji = outcome.approved ? '✅' : '❌';
  const status = outcome.approved ? 'Approved' : 'Rejected';
  
  let message = `${emoji} *Decision Finalized: ${status}*\n\n`;
  message += `*${decision.name}*\n\n`;
  message += `${outcome.reason}\n\n`;
  
  if (adrResult && adrResult.success) {
    message += `📝 ADR generated and pushed to Azure DevOps: ${adrResult.filename}`;
  }

  try {
    await client.chat.postMessage({
      channel: decision.channel_id,
      thread_ts: decision.message_ts,
      text: message
    });

    logger.info('Finalization notification sent', {
      decisionId: decision.id
    });
  } catch (error) {
    logger.error('Error sending notification', {
      error: error.message,
      decisionId: decision.id
    });
    throw error;
  }
};

/**
 * Finalize all decisions that are ready
 * Checks all active decisions and finalizes those that meet the criteria
 * 
 * @param {object} options - Finalization options
 * @returns {Promise<object>} Summary of finalization results
 */
const finalizeReadyDecisions = async (options = {}) => {
  logger.info('Starting batch decision finalization');

  try {
    const openDecisions = db.getOpenDecisions();
    
    logger.info('Found open decisions', { count: openDecisions.length });

    const results = {
      total: 0,
      finalized: 0,
      skipped: 0,
      errors: 0,
      decisions: []
    };

    for (const decision of openDecisions) {
      results.total++;

      try {
        const voters = db.getVoters(decision.id);
        const votes = db.getVotes(decision.id);
        
        const check = shouldFinalizeDecision(decision, voters, votes);
        
        if (check.shouldFinalize) {
          logger.info('Finalizing decision', {
            decisionId: decision.id,
            reason: check.reason
          });

          const result = await finalizeDecision(decision.id, options);
          
          if (result.success) {
            results.finalized++;
            results.decisions.push({
              id: decision.id,
              name: decision.name,
              status: result.status,
              success: true
            });
          } else {
            results.skipped++;
            results.decisions.push({
              id: decision.id,
              name: decision.name,
              success: false,
              error: result.error
            });
          }
        } else {
          logger.debug('Decision not ready for finalization', {
            decisionId: decision.id,
            reason: check.reason
          });
          results.skipped++;
        }
      } catch (error) {
        logger.error('Error processing decision', {
          decisionId: decision.id,
          error: error.message
        });
        results.errors++;
        results.decisions.push({
          id: decision.id,
          name: decision.name,
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
