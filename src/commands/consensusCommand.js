/**
 * Consensus Slash Command Handler
 * 
 * Handles the /consensus slash command, which is the main entry point
 * for creating new consensus decisions. Responds with a welcome message
 * and opens a modal for collecting decision details.
 */

const logger = require('../utils/logger');
const { createConsensusModal } = require('../modals/consensusModal');
const db = require('../database/db');
const { createVotingMessage } = require('../utils/votingMessage');

/**
 * Register the /consensus command handler
 * 
 * @param {object} app - The Bolt app instance
 */
const registerConsensusCommand = (app) => {
  app.command('/consensus', async ({ command, ack, respond }) => {
    try {
      // Acknowledge the command request immediately
      await ack();

      logger.info('Consensus command received', {
        userId: command.user_id,
        channelId: command.channel_id,
        text: command.text
      });

      // Check if the user provided any text with the command
      const commandText = command.text.trim();

      // If text is 'help', show help message
      if (commandText === 'help') {
        await respond({
          response_type: 'ephemeral',
          text: 'ConsensusBot Help',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*How to use ConsensusBot* :books:'
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '• `/consensus` - Start a new consensus decision\n• `/consensus help` - Show this help message\n• `/consensus status` - Check your pending decisions'
              }
            }
          ]
        });
        return;
      }

      // If text is 'status', show status message (placeholder for future implementation)
      if (commandText === 'status') {
        await respond({
          response_type: 'ephemeral',
          text: 'No pending decisions',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: ':white_check_mark: You have no pending decisions at the moment.'
              }
            }
          ]
        });
        return;
      }

      // Default behavior: Send a hello world message and show modal option
      await respond({
        response_type: 'ephemeral',
        text: 'Hello! ConsensusBot is ready to help your team make decisions.',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: ':wave: *Hello! Welcome to ConsensusBot*\n\nI\'m here to help your team make collaborative decisions through structured consensus building.'
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Quick Start:*\n• Click the button below to create a new decision\n• Use `/consensus help` for more information\n• Use `/consensus status` to check pending decisions'
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Create New Decision',
                  emoji: true
                },
                style: 'primary',
                action_id: 'open_consensus_modal',
                value: 'create_decision'
              }
            ]
          }
        ]
      });

      logger.info('Consensus command response sent', {
        userId: command.user_id
      });

    } catch (error) {
      logger.error('Error handling consensus command', {
        error: error.message,
        stack: error.stack,
        userId: command.user_id
      });

      // Send error message to user
      try {
        await respond({
          response_type: 'ephemeral',
          text: 'Sorry, an error occurred while processing your request. Please try again.'
        });
      } catch (respondError) {
        logger.error('Error sending error response', {
          error: respondError.message
        });
      }
    }
  });

  /**
   * Handle the button action to open the consensus modal
   */
  app.action('open_consensus_modal', async ({ ack, body, client }) => {
    try {
      // Acknowledge the action
      await ack();

      logger.info('Opening consensus modal', {
        userId: body.user.id,
        channelId: body.channel?.id
      });

      // Open the modal, passing channel ID in private_metadata
      const modalView = createConsensusModal(body.trigger_id);
      modalView.view.private_metadata = body.channel?.id || '';
      
      await client.views.open(modalView);

      logger.info('Consensus modal opened successfully', {
        userId: body.user.id
      });

    } catch (error) {
      logger.error('Error opening consensus modal', {
        error: error.message,
        stack: error.stack,
        userId: body.user.id
      });
    }
  });

  /**
   * Handle modal submission
   */
  app.view('consensus_decision_modal', async ({ ack, body, view, client }) => {
    try {
      // Acknowledge the view submission
      await ack();

      logger.info('Consensus modal submitted', {
        userId: body.user.id
      });

      // Extract values from the modal
      const values = view.state.values;
      const decisionName = values.decision_name_block.decision_name_input.value;
      const requiredVoters = values.required_voters_block.required_voters_input.selected_users;
      const proposal = values.proposal_block.proposal_input.value;
      const successCriteria = values.success_criteria_block.success_criteria_input.selected_option.value;
      const deadline = values.deadline_block.deadline_input.selected_date;

      logger.info('Decision data collected', {
        decisionName,
        requiredVotersCount: requiredVoters.length,
        successCriteria,
        deadline,
        userId: body.user.id
      });

      // Get channel ID from the private metadata
      // The channel ID is passed through from the button action
      const channelId = view.private_metadata;
      
      if (!channelId) {
        logger.error('No channel ID available in modal submission', {
          userId: body.user.id
        });
        throw new Error('Channel ID not available');
      }

      // Save decision to database
      const decisionId = db.insertDecision({
        name: decisionName,
        proposal: proposal,
        success_criteria: successCriteria,
        deadline: deadline,
        channel_id: channelId,
        creator_id: body.user.id
      });

      // Save voters to database
      db.insertVoters(decisionId, requiredVoters);

      // Get the full decision from database
      const decision = db.getDecision(decisionId);

      logger.info('Decision created successfully', {
        decisionId,
        name: decisionName
      });

      // Post voting message to channel
      const votingMessage = createVotingMessage(decision, requiredVoters);
      
      try {
        const result = await client.chat.postMessage({
          channel: channelId,
          ...votingMessage
        });

        // Update decision with message timestamp
        db.updateDecisionMessage(decisionId, result.ts);

        // Pin the message
        await client.pins.add({
          channel: channelId,
          timestamp: result.ts
        });

        logger.info('Voting message posted and pinned', {
          decisionId,
          messageTs: result.ts,
          channelId
        });

      } catch (postError) {
        logger.error('Error posting voting message', {
          error: postError.message,
          decisionId
        });
        // Decision is saved, but message posting failed
        // Could implement retry logic here
      }

    } catch (error) {
      logger.error('Error processing modal submission', {
        error: error.message,
        stack: error.stack,
        userId: body.user.id
      });
    }
  });

  logger.info('Consensus command registered successfully');
};

/**
 * Register voting action handlers
 * @param {object} app - The Bolt app instance
 */
const registerVotingHandlers = (app) => {
  // Handle Yes vote
  app.action(/^vote_yes_(\d+)$/, async ({ ack, body, client, action }) => {
    try {
      await ack();
      
      const decisionId = parseInt(action.value);
      const userId = body.user.id;
      
      // Check if user is eligible to vote
      const isEligible = db.isUserEligibleToVote(decisionId, userId);
      
      if (!isEligible) {
        logger.warn('Ineligible user attempted to vote', {
          decisionId,
          userId,
          voteType: 'yes'
        });
        
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: userId,
          text: '⚠️ You are not eligible to vote on this decision. Only required voters can cast votes.'
        });
        return;
      }
      
      // Get decision to check if it's still active
      const decision = db.getDecision(decisionId);
      
      if (!decision) {
        logger.error('Decision not found', { decisionId });
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: userId,
          text: '❌ Decision not found.'
        });
        return;
      }
      
      if (decision.status !== 'active') {
        logger.warn('Vote attempted on non-active decision', {
          decisionId,
          userId,
          status: decision.status
        });
        
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: userId,
          text: `⚠️ This decision is no longer active (status: ${decision.status}). Votes cannot be changed.`
        });
        return;
      }
      
      logger.info('Vote cast', {
        decisionId,
        userId,
        voteType: 'yes'
      });
      
      // Save vote to database
      db.upsertVote({
        decision_id: decisionId,
        user_id: userId,
        vote_type: 'yes'
      });
      
      // Send confirmation
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: userId,
        text: `✅ Your vote "Yes" has been recorded for: ${decision.name}`
      });
      
    } catch (error) {
      logger.error('Error handling yes vote', {
        error: error.message,
        stack: error.stack
      });
      
      // Send error message to user
      try {
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: body.user.id,
          text: '❌ An error occurred while recording your vote. Please try again.'
        });
      } catch (ephemeralError) {
        logger.error('Error sending error message', {
          error: ephemeralError.message
        });
      }
    }
  });
  
  // Handle No vote
  app.action(/^vote_no_(\d+)$/, async ({ ack, body, client, action }) => {
    try {
      await ack();
      
      const decisionId = parseInt(action.value);
      const userId = body.user.id;
      
      // Check if user is eligible to vote
      const isEligible = db.isUserEligibleToVote(decisionId, userId);
      
      if (!isEligible) {
        logger.warn('Ineligible user attempted to vote', {
          decisionId,
          userId,
          voteType: 'no'
        });
        
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: userId,
          text: '⚠️ You are not eligible to vote on this decision. Only required voters can cast votes.'
        });
        return;
      }
      
      // Get decision to check if it's still active
      const decision = db.getDecision(decisionId);
      
      if (!decision) {
        logger.error('Decision not found', { decisionId });
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: userId,
          text: '❌ Decision not found.'
        });
        return;
      }
      
      if (decision.status !== 'active') {
        logger.warn('Vote attempted on non-active decision', {
          decisionId,
          userId,
          status: decision.status
        });
        
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: userId,
          text: `⚠️ This decision is no longer active (status: ${decision.status}). Votes cannot be changed.`
        });
        return;
      }
      
      logger.info('Vote cast', {
        decisionId,
        userId,
        voteType: 'no'
      });
      
      // Save vote to database
      db.upsertVote({
        decision_id: decisionId,
        user_id: userId,
        vote_type: 'no'
      });
      
      // Send confirmation
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: userId,
        text: `❌ Your vote "No" has been recorded for: ${decision.name}`
      });
      
    } catch (error) {
      logger.error('Error handling no vote', {
        error: error.message,
        stack: error.stack
      });
      
      // Send error message to user
      try {
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: body.user.id,
          text: '❌ An error occurred while recording your vote. Please try again.'
        });
      } catch (ephemeralError) {
        logger.error('Error sending error message', {
          error: ephemeralError.message
        });
      }
    }
  });
  
  // Handle Abstain vote
  app.action(/^vote_abstain_(\d+)$/, async ({ ack, body, client, action }) => {
    try {
      await ack();
      
      const decisionId = parseInt(action.value);
      const userId = body.user.id;
      
      // Check if user is eligible to vote
      const isEligible = db.isUserEligibleToVote(decisionId, userId);
      
      if (!isEligible) {
        logger.warn('Ineligible user attempted to vote', {
          decisionId,
          userId,
          voteType: 'abstain'
        });
        
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: userId,
          text: '⚠️ You are not eligible to vote on this decision. Only required voters can cast votes.'
        });
        return;
      }
      
      // Get decision to check if it's still active
      const decision = db.getDecision(decisionId);
      
      if (!decision) {
        logger.error('Decision not found', { decisionId });
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: userId,
          text: '❌ Decision not found.'
        });
        return;
      }
      
      if (decision.status !== 'active') {
        logger.warn('Vote attempted on non-active decision', {
          decisionId,
          userId,
          status: decision.status
        });
        
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: userId,
          text: `⚠️ This decision is no longer active (status: ${decision.status}). Votes cannot be changed.`
        });
        return;
      }
      
      logger.info('Vote cast', {
        decisionId,
        userId,
        voteType: 'abstain'
      });
      
      // Save vote to database
      db.upsertVote({
        decision_id: decisionId,
        user_id: userId,
        vote_type: 'abstain'
      });
      
      // Send confirmation
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: userId,
        text: `⏸️ Your vote "Abstain" has been recorded for: ${decision.name}`
      });
      
    } catch (error) {
      logger.error('Error handling abstain vote', {
        error: error.message,
        stack: error.stack
      });
      
      // Send error message to user
      try {
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: body.user.id,
          text: '❌ An error occurred while recording your vote. Please try again.'
        });
      } catch (ephemeralError) {
        logger.error('Error sending error message', {
          error: ephemeralError.message
        });
      }
    }
  });
  
  logger.info('Voting handlers registered successfully');
};

module.exports = {
  registerConsensusCommand,
  registerVotingHandlers
};
