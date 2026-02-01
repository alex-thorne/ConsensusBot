/**
 * Voting Message Builder
 * 
 * Creates Slack Block Kit messages for consensus voting
 */

/**
 * Create a voting message with Yes/No/Abstain buttons
 * @param {object} decision - Decision data
 * @param {Array<string>} voterIds - Array of user IDs who should vote
 * @returns {object} Slack message blocks
 */
const createVotingMessage = (decision, voterIds) => {
  // Format voter mentions
  const voterMentions = voterIds.map(id => `<@${id}>`).join(', ');
  
  // Use message timestamp as unique ID if available, otherwise use sanitized name
  // Message timestamp is guaranteed unique within a channel
  const uniqueId = decision.messageTs 
    ? decision.messageTs.replace('.', '_')
    : decision.name.replace(/\s+/g, '_').toLowerCase();
  
  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📋 ${decision.name}`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Proposal:*\n${decision.proposal}`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Success Criteria:*\n${formatSuccessCriteria(decision.success_criteria)}`
          },
          {
            type: 'mrkdwn',
            text: `*Deadline:*\n${formatDeadline(decision.deadline)}`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Required Voters:*\n${voterMentions}`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Cast your vote:*'
        }
      },
      {
        type: 'actions',
        block_id: `voting_actions_${uniqueId}`,
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '✅ Yes',
              emoji: true
            },
            style: 'primary',
            action_id: `vote_yes_${uniqueId}`,
            value: 'yes'
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '❌ No',
              emoji: true
            },
            style: 'danger',
            action_id: `vote_no_${uniqueId}`,
            value: 'no'
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '⏸️ Abstain',
              emoji: true
            },
            action_id: `vote_abstain_${uniqueId}`,
            value: 'abstain'
          }
        ]
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Created by <@${decision.creator_id}>`
          }
        ]
      }
    ],
    text: `New consensus decision: ${decision.name}` // Fallback text
  };
};

/**
 * Format success criteria for display
 * @param {string} criteria - Success criteria value
 * @returns {string} Formatted criteria text
 */
const formatSuccessCriteria = (criteria) => {
  const criteriaMap = {
    'simple_majority': 'Simple Majority (50%+1)',
    'super_majority': 'Supermajority (75%)',
    'unanimous': 'Unanimity (100%)'
  };
  return criteriaMap[criteria] || criteria;
};

/**
 * Format deadline for display
 * @param {string} deadline - Deadline date (YYYY-MM-DD)
 * @returns {string} Formatted deadline text
 */
const formatDeadline = (deadline) => {
  const date = new Date(deadline);
  return date.toLocaleDateString('en-US', { 
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

/**
 * Create a vote confirmation message
 * @param {string} voteType - Type of vote (yes, no, abstain)
 * @param {string} decisionName - Name of the decision
 * @returns {object} Slack message object
 */
const createVoteConfirmation = (voteType, decisionName) => {
  const voteEmojis = {
    'yes': '✅',
    'no': '❌',
    'abstain': '⏸️'
  };
  
  const voteLabels = {
    'yes': 'Yes',
    'no': 'No',
    'abstain': 'Abstain'
  };
  
  return {
    response_type: 'ephemeral',
    replace_original: false,
    text: `${voteEmojis[voteType]} Your vote "${voteLabels[voteType]}" has been recorded for: ${decisionName}`
  };
};

module.exports = {
  createVotingMessage,
  createVoteConfirmation,
  formatSuccessCriteria,
  formatDeadline
};
