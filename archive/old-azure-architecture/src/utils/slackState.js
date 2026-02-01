/**
 * Slack State Management Module
 * 
 * Manages ephemeral state for ConsensusBot using Slack threads and metadata.
 * Replaces database persistence with Slack API-based state reconstruction.
 */

const logger = require('./logger');

/**
 * Parse decision state from a Slack message and thread
 * Reconstructs the current decision state by analyzing the message structure
 * 
 * @param {object} client - Slack Web API client
 * @param {string} channelId - Channel ID where decision was posted
 * @param {string} messageTs - Message timestamp of the decision
 * @returns {Promise<object>} Decision state object
 */
const getDecisionState = async (client, channelId, messageTs) => {
  try {
    // Fetch the original decision message
    const result = await client.conversations.history({
      channel: channelId,
      latest: messageTs,
      inclusive: true,
      limit: 1
    });

    if (!result.messages || result.messages.length === 0) {
      throw new Error('Decision message not found');
    }

    const message = result.messages[0];
    
    // Parse decision details from message blocks
    const decision = parseDecisionFromMessage(message);
    
    // Fetch thread replies to get votes
    const votes = await getVotesFromThread(client, channelId, messageTs);
    
    // Calculate vote summary
    const voteSummary = calculateVoteSummary(votes);
    
    return {
      ...decision,
      messageTs,
      channelId,
      votes,
      voteSummary
    };
  } catch (error) {
    logger.error('Failed to get decision state from Slack', { error, channelId, messageTs });
    throw error;
  }
};

/**
 * Parse decision details from Slack message structure
 * 
 * @param {object} message - Slack message object
 * @returns {object} Parsed decision details
 */
const parseDecisionFromMessage = (message) => {
  try {
    // Extract metadata from message
    const metadata = message.metadata || {};
    const blocks = message.blocks || [];
    
    // Try to get decision data from metadata first (if stored there)
    if (metadata.event_payload) {
      return {
        name: metadata.event_payload.name || '',
        proposal: metadata.event_payload.proposal || '',
        successCriteria: metadata.event_payload.success_criteria || 'simple_majority',
        deadline: metadata.event_payload.deadline || '',
        creatorId: metadata.event_payload.creator_id || message.user,
        voters: metadata.event_payload.voters || [],
        status: metadata.event_payload.status || 'active'
      };
    }
    
    // Fallback: Parse from message blocks
    let name = '';
    let proposal = '';
    let successCriteria = 'simple_majority';
    let deadline = '';
    let voters = [];
    
    for (const block of blocks) {
      if (block.type === 'header' && block.text) {
        name = block.text.text || '';
      }
      if (block.type === 'section' && block.text) {
        const text = block.text.text || '';
        if (text.includes('*Proposal:*')) {
          proposal = text.split('*Proposal:*')[1]?.trim() || '';
        }
        if (text.includes('*Success Criteria:*')) {
          const criteria = text.split('*Success Criteria:*')[1]?.trim() || '';
          // Extract the raw criteria value if present in parentheses
          const match = criteria.match(/\((.*?)\)/);
          if (match && match[1]) {
            successCriteria = match[1].toLowerCase().replace(/\s+/g, '_');
          } else {
            successCriteria = criteria.toLowerCase().replace(/\s+/g, '_');
          }
        }
        if (text.includes('*Deadline:*')) {
          deadline = text.split('*Deadline:*')[1]?.trim() || '';
        }
        if (text.includes('*Required Voters:*')) {
          const voterText = text.split('*Required Voters:*')[1]?.trim() || '';
          // Parse voter mentions like <@U123>, <@U456> - allow both upper and lowercase
          voters = (voterText.match(/<@[A-Za-z0-9]+>/g) || [])
            .map(mention => mention.replace(/<@|>/g, ''));
        }
      }
    }
    
    return {
      name,
      proposal,
      successCriteria,
      deadline,
      creatorId: message.user,
      voters,
      status: 'active'
    };
  } catch (error) {
    logger.error('Failed to parse decision from message', { error });
    return {
      name: '',
      proposal: '',
      successCriteria: 'simple_majority',
      deadline: '',
      creatorId: '',
      voters: [],
      status: 'active'
    };
  }
};

/**
 * Get votes from a Slack thread by analyzing reactions and thread replies
 * 
 * @param {object} client - Slack Web API client
 * @param {string} channelId - Channel ID
 * @param {string} threadTs - Thread timestamp
 * @returns {Promise<Array>} Array of vote objects
 */
const getVotesFromThread = async (client, channelId, threadTs) => {
  try {
    // Fetch thread replies
    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 1000
    });

    const votes = [];
    const messages = result.messages || [];
    
    // Skip the first message (the decision itself)
    for (let i = 1; i < messages.length; i++) {
      const msg = messages[i];
      
      // Look for vote actions in message metadata
      if (msg.metadata && msg.metadata.event_type === 'vote_action') {
        const voteData = msg.metadata.event_payload || {};
        votes.push({
          userId: msg.user,
          voteType: voteData.vote_type || 'abstain',
          votedAt: msg.ts
        });
      }
      
      // Fallback: Parse from message text (e.g., "voted Yes", "voted No")
      if (msg.text) {
        const voteMatch = msg.text.match(/voted\s+(Yes|No|Abstain)/i);
        if (voteMatch) {
          votes.push({
            userId: msg.user,
            voteType: voteMatch[1].toLowerCase(),
            votedAt: msg.ts
          });
        }
      }
    }
    
    // Remove duplicate votes (keep the latest vote per user)
    const latestVotes = {};
    for (const vote of votes) {
      if (!latestVotes[vote.userId] || vote.votedAt > latestVotes[vote.userId].votedAt) {
        latestVotes[vote.userId] = vote;
      }
    }
    
    return Object.values(latestVotes);
  } catch (error) {
    logger.error('Failed to get votes from thread', { error, channelId, threadTs });
    return [];
  }
};

/**
 * Calculate vote summary from votes array
 * 
 * @param {Array} votes - Array of vote objects
 * @returns {object} Vote summary with counts
 */
const calculateVoteSummary = (votes) => {
  const summary = {
    total_votes: votes.length,
    yes_votes: 0,
    no_votes: 0,
    abstain_votes: 0
  };
  
  for (const vote of votes) {
    if (vote.voteType === 'yes') {
      summary.yes_votes++;
    } else if (vote.voteType === 'no') {
      summary.no_votes++;
    } else if (vote.voteType === 'abstain') {
      summary.abstain_votes++;
    }
  }
  
  return summary;
};

/**
 * Store decision metadata in Slack message
 * 
 * Note: Slack's chat.update API does not support updating metadata after message creation.
 * Decision metadata is stored during message creation via the metadata field.
 * This function exists for potential future use if Slack adds metadata update capability.
 * 
 * @param {object} client - Slack Web API client
 * @param {string} channelId - Channel ID
 * @param {string} messageTs - Message timestamp
 * @param {object} decisionData - Decision data to store
 * @returns {Promise<void>}
 */
const storeDecisionMetadata = async (client, channelId, messageTs, decisionData) => {
  // Note: This is a placeholder as Slack doesn't currently support metadata updates
  // Metadata must be included during message creation
  logger.debug('Decision metadata stored during message creation', { 
    channelId, 
    messageTs,
    name: decisionData.name 
  });
};

/**
 * Record a vote in the Slack thread
 * Posts a threaded message indicating the vote
 * 
 * @param {object} client - Slack Web API client
 * @param {string} channelId - Channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {string} userId - User ID who voted
 * @param {string} voteType - Vote type (yes, no, abstain)
 * @returns {Promise<void>}
 */
const recordVote = async (client, channelId, threadTs, userId, voteType) => {
  try {
    // Post a threaded message with vote metadata
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `<@${userId}> voted ${voteType.charAt(0).toUpperCase() + voteType.slice(1)}`,
      metadata: {
        event_type: 'vote_action',
        event_payload: {
          vote_type: voteType,
          user_id: userId,
          timestamp: new Date().toISOString()
        }
      }
    });
    
    logger.info('Vote recorded in Slack thread', { channelId, threadTs, userId, voteType });
  } catch (error) {
    logger.error('Failed to record vote in Slack', { error, channelId, threadTs, userId, voteType });
    throw error;
  }
};

/**
 * Get all open decisions from pinned messages in a channel
 * 
 * @param {object} client - Slack Web API client
 * @param {string} channelId - Channel ID
 * @returns {Promise<Array>} Array of open decision states
 */
const getOpenDecisions = async (client, channelId) => {
  try {
    // Get pinned messages in the channel
    const result = await client.pins.list({
      channel: channelId
    });
    
    const decisions = [];
    
    if (result.items) {
      for (const item of result.items) {
        if (item.message) {
          const decision = await getDecisionState(client, channelId, item.message.ts);
          
          // Only include active decisions
          if (decision.status === 'active') {
            decisions.push(decision);
          }
        }
      }
    }
    
    logger.info('Open decisions retrieved from Slack', { channelId, count: decisions.length });
    return decisions;
  } catch (error) {
    logger.error('Failed to get open decisions from Slack', { error, channelId });
    return [];
  }
};

/**
 * Get missing voters for a decision
 * Returns voters who haven't cast their vote yet
 * 
 * @param {object} decisionState - Decision state object
 * @returns {Array} Array of user IDs who haven't voted
 */
const getMissingVoters = (decisionState) => {
  const voters = decisionState.voters || [];
  const votes = decisionState.votes || [];
  
  const votedUserIds = new Set(votes.map(v => v.userId));
  const missingVoters = voters.filter(voterId => !votedUserIds.has(voterId));
  
  logger.debug('Missing voters calculated', { 
    totalVoters: voters.length,
    votedCount: votes.length,
    missingCount: missingVoters.length
  });
  
  return missingVoters;
};

/**
 * Check if user is eligible to vote on a decision
 * 
 * @param {object} decisionState - Decision state object
 * @param {string} userId - User ID to check
 * @returns {boolean} True if user is eligible
 */
const isUserEligibleToVote = (decisionState, userId) => {
  const voters = decisionState.voters || [];
  return voters.includes(userId);
};

/**
 * Update decision status by posting a status update in the thread
 * 
 * @param {object} client - Slack Web API client
 * @param {string} channelId - Channel ID
 * @param {string} messageTs - Message timestamp
 * @param {string} status - New status (approved, rejected, expired)
 * @returns {Promise<void>}
 */
const updateDecisionStatus = async (client, channelId, messageTs, status) => {
  try {
    // Post a status update message in the thread
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      text: `:white_check_mark: Decision status updated to: *${status.toUpperCase()}*`,
      metadata: {
        event_type: 'status_update',
        event_payload: {
          status,
          timestamp: new Date().toISOString()
        }
      }
    });
    
    // Unpin the message if decision is no longer active
    if (status !== 'active') {
      try {
        await client.pins.remove({
          channel: channelId,
          timestamp: messageTs
        });
      } catch (unpinError) {
        logger.warn('Failed to unpin decision message', { error: unpinError, channelId, messageTs });
      }
    }
    
    logger.info('Decision status updated in Slack', { channelId, messageTs, status });
  } catch (error) {
    logger.error('Failed to update decision status in Slack', { error, channelId, messageTs, status });
    throw error;
  }
};

module.exports = {
  getDecisionState,
  parseDecisionFromMessage,
  getVotesFromThread,
  calculateVoteSummary,
  storeDecisionMetadata,
  recordVote,
  getOpenDecisions,
  getMissingVoters,
  isUserEligibleToVote,
  updateDecisionStatus
};
