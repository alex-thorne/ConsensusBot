/**
 * Consensus Slash Command Handler
 * 
 * Handles the /consensus slash command, which is the main entry point
 * for creating new consensus decisions. Responds with a welcome message
 * and opens a modal for collecting decision details.
 */

const logger = require('../utils/logger');
const { createConsensusModal } = require('../modals/consensusModal');

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
        userId: body.user.id
      });

      // Open the modal
      const modalView = createConsensusModal(body.trigger_id);
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
   * Handle modal submission (placeholder for future database integration)
   */
  app.view('consensus_decision_modal', async ({ ack, body, view }) => {
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
      const successCriteria = values.success_criteria_block.success_criteria_input.selected_option.value;
      const description = values.description_block.description_input.value || '';

      logger.info('Decision data collected', {
        decisionName,
        requiredVotersCount: requiredVoters.length,
        successCriteria,
        userId: body.user.id
      });

      // TODO: Save to database (placeholder for future implementation)
      // For now, just log the submission
      logger.info('Decision created (mock)', {
        decisionName,
        requiredVoters,
        successCriteria,
        description,
        createdBy: body.user.id
      });

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

module.exports = {
  registerConsensusCommand
};
