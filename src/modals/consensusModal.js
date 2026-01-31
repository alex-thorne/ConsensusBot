/**
 * Consensus Decision Modal Definition
 * 
 * This module defines the modal structure for collecting consensus decision inputs.
 * The modal collects: decision name, required voters, and success criteria.
 */

/**
 * Create a consensus decision modal
 * 
 * @param {string} triggerId - The trigger ID from the slash command
 * @returns {object} Modal view object for Slack API
 */
const createConsensusModal = (triggerId) => {
  return {
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'consensus_decision_modal',
      title: {
        type: 'plain_text',
        text: 'New Consensus Decision'
      },
      submit: {
        type: 'plain_text',
        text: 'Create'
      },
      close: {
        type: 'plain_text',
        text: 'Cancel'
      },
      blocks: [
        {
          type: 'input',
          block_id: 'decision_name_block',
          label: {
            type: 'plain_text',
            text: 'Decision Name'
          },
          element: {
            type: 'plain_text_input',
            action_id: 'decision_name_input',
            placeholder: {
              type: 'plain_text',
              text: 'e.g., Choose new project framework'
            },
            max_length: 200
          }
        },
        {
          type: 'input',
          block_id: 'required_voters_block',
          label: {
            type: 'plain_text',
            text: 'Required Voters'
          },
          element: {
            type: 'multi_users_select',
            action_id: 'required_voters_input',
            placeholder: {
              type: 'plain_text',
              text: 'Select team members who must vote'
            }
          },
          hint: {
            type: 'plain_text',
            text: 'Select the team members whose votes are required for this decision'
          }
        },
        {
          type: 'input',
          block_id: 'success_criteria_block',
          label: {
            type: 'plain_text',
            text: 'Success Criteria'
          },
          element: {
            type: 'static_select',
            action_id: 'success_criteria_input',
            placeholder: {
              type: 'plain_text',
              text: 'Select consensus threshold'
            },
            options: [
              {
                text: {
                  type: 'plain_text',
                  text: 'Unanimous (100%)'
                },
                value: 'unanimous'
              },
              {
                text: {
                  type: 'plain_text',
                  text: 'Super Majority (75%)'
                },
                value: 'super_majority'
              },
              {
                text: {
                  type: 'plain_text',
                  text: 'Simple Majority (50%+1)'
                },
                value: 'simple_majority'
              }
            ]
          },
          hint: {
            type: 'plain_text',
            text: 'Choose the percentage of votes required for the decision to pass'
          }
        },
        {
          type: 'input',
          block_id: 'description_block',
          label: {
            type: 'plain_text',
            text: 'Description (Optional)'
          },
          element: {
            type: 'plain_text_input',
            action_id: 'description_input',
            multiline: true,
            placeholder: {
              type: 'plain_text',
              text: 'Provide additional context or details about this decision...'
            },
            max_length: 1000
          },
          optional: true
        }
      ]
    }
  };
};

module.exports = {
  createConsensusModal
};
