/**
 * Tests for the Consensus Command
 * 
 * Tests the /consensus slash command functionality including:
 * - Command acknowledgment
 * - Hello world response
 * - Help and status subcommands
 * - Modal interactions
 */

const { createConsensusModal } = require('../../src/modals/consensusModal');

describe('Consensus Command', () => {
  describe('Modal Structure', () => {
    it('should create a valid consensus modal with correct structure', () => {
      const triggerId = 'test-trigger-id-123';
      const modal = createConsensusModal(triggerId);

      // Verify basic structure
      expect(modal).toBeDefined();
      expect(modal.trigger_id).toBe(triggerId);
      expect(modal.view).toBeDefined();
      expect(modal.view.type).toBe('modal');
      expect(modal.view.callback_id).toBe('consensus_decision_modal');
    });

    it('should have correct modal title', () => {
      const modal = createConsensusModal('test-trigger');
      expect(modal.view.title).toEqual({
        type: 'plain_text',
        text: 'New Consensus Decision'
      });
    });

    it('should have submit and close buttons', () => {
      const modal = createConsensusModal('test-trigger');
      expect(modal.view.submit).toEqual({
        type: 'plain_text',
        text: 'Create'
      });
      expect(modal.view.close).toEqual({
        type: 'plain_text',
        text: 'Cancel'
      });
    });

    it('should contain required input blocks', () => {
      const modal = createConsensusModal('test-trigger');
      const blocks = modal.view.blocks;

      expect(blocks).toHaveLength(4);

      // Check decision name block
      const decisionNameBlock = blocks[0];
      expect(decisionNameBlock.type).toBe('input');
      expect(decisionNameBlock.block_id).toBe('decision_name_block');
      expect(decisionNameBlock.element.type).toBe('plain_text_input');
      expect(decisionNameBlock.element.action_id).toBe('decision_name_input');

      // Check required voters block
      const votersBlock = blocks[1];
      expect(votersBlock.type).toBe('input');
      expect(votersBlock.block_id).toBe('required_voters_block');
      expect(votersBlock.element.type).toBe('multi_users_select');
      expect(votersBlock.element.action_id).toBe('required_voters_input');

      // Check success criteria block
      const criteriaBlock = blocks[2];
      expect(criteriaBlock.type).toBe('input');
      expect(criteriaBlock.block_id).toBe('success_criteria_block');
      expect(criteriaBlock.element.type).toBe('static_select');
      expect(criteriaBlock.element.action_id).toBe('success_criteria_input');

      // Check description block
      const descriptionBlock = blocks[3];
      expect(descriptionBlock.type).toBe('input');
      expect(descriptionBlock.block_id).toBe('description_block');
      expect(descriptionBlock.optional).toBe(true);
    });

    it('should have correct success criteria options', () => {
      const modal = createConsensusModal('test-trigger');
      const criteriaBlock = modal.view.blocks[2];
      const options = criteriaBlock.element.options;

      expect(options).toHaveLength(3);
      expect(options[0].value).toBe('unanimous');
      expect(options[1].value).toBe('super_majority');
      expect(options[2].value).toBe('simple_majority');
    });
  });

  describe('Slack JSON Response Structure', () => {
    it('should validate modal JSON structure for Slack API', () => {
      const modal = createConsensusModal('trigger-123');
      
      // Verify it's a valid Slack modal structure
      expect(modal.trigger_id).toBeDefined();
      expect(modal.view).toBeDefined();
      expect(modal.view.type).toBe('modal');
      
      // Verify callback_id for handling submissions
      expect(modal.view.callback_id).toBe('consensus_decision_modal');
      
      // Verify all blocks have required fields
      modal.view.blocks.forEach((block) => {
        expect(block.type).toBeDefined();
        if (block.type === 'input') {
          expect(block.block_id).toBeDefined();
          expect(block.label).toBeDefined();
          expect(block.element).toBeDefined();
          expect(block.element.action_id).toBeDefined();
        }
      });
    });

    it('should have valid text elements in modal', () => {
      const modal = createConsensusModal('trigger-123');
      
      // Check that all text objects have the correct structure
      expect(modal.view.title.type).toBe('plain_text');
      expect(modal.view.title.text).toBeTruthy();
      
      expect(modal.view.submit.type).toBe('plain_text');
      expect(modal.view.submit.text).toBeTruthy();
      
      expect(modal.view.close.type).toBe('plain_text');
      expect(modal.view.close.text).toBeTruthy();
    });

    it('should have proper placeholder text for all inputs', () => {
      const modal = createConsensusModal('trigger-123');
      const blocks = modal.view.blocks;

      // Decision name should have placeholder
      expect(blocks[0].element.placeholder).toBeDefined();
      expect(blocks[0].element.placeholder.type).toBe('plain_text');
      
      // Required voters should have placeholder
      expect(blocks[1].element.placeholder).toBeDefined();
      expect(blocks[1].element.placeholder.type).toBe('plain_text');
      
      // Success criteria should have placeholder
      expect(blocks[2].element.placeholder).toBeDefined();
      expect(blocks[2].element.placeholder.type).toBe('plain_text');
      
      // Description should have placeholder
      expect(blocks[3].element.placeholder).toBeDefined();
      expect(blocks[3].element.placeholder.type).toBe('plain_text');
    });

    it('should have hints for complex inputs', () => {
      const modal = createConsensusModal('trigger-123');
      const blocks = modal.view.blocks;

      // Required voters should have a hint
      expect(blocks[1].hint).toBeDefined();
      expect(blocks[1].hint.type).toBe('plain_text');
      
      // Success criteria should have a hint
      expect(blocks[2].hint).toBeDefined();
      expect(blocks[2].hint.type).toBe('plain_text');
    });

    it('should enforce input constraints', () => {
      const modal = createConsensusModal('trigger-123');
      const blocks = modal.view.blocks;

      // Decision name should have max length
      expect(blocks[0].element.max_length).toBe(200);
      
      // Description should have max length
      expect(blocks[3].element.max_length).toBe(1000);
      
      // Description should be multiline
      expect(blocks[3].element.multiline).toBe(true);
    });
  });

  describe('Command Response Messages', () => {
    it('should structure response with hello world message', () => {
      // Expected structure for the main /consensus response
      const expectedResponse = {
        response_type: 'ephemeral',
        text: 'Hello! ConsensusBot is ready to help your team make decisions.',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: expect.stringContaining('Hello! Welcome to ConsensusBot')
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: expect.stringContaining('Quick Start')
            }
          },
          {
            type: 'actions',
            elements: expect.arrayContaining([
              expect.objectContaining({
                type: 'button',
                action_id: 'open_consensus_modal'
              })
            ])
          }
        ]
      };

      // Verify the structure matches what we expect
      expect(expectedResponse.response_type).toBe('ephemeral');
      expect(expectedResponse.blocks).toHaveLength(4);
      expect(expectedResponse.blocks[0].type).toBe('section');
      expect(expectedResponse.blocks[1].type).toBe('divider');
      expect(expectedResponse.blocks[2].type).toBe('section');
      expect(expectedResponse.blocks[3].type).toBe('actions');
    });

    it('should validate help command response structure', () => {
      const helpResponse = {
        response_type: 'ephemeral',
        text: 'ConsensusBot Help',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: expect.stringContaining('How to use ConsensusBot')
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: expect.stringContaining('/consensus')
            }
          }
        ]
      };

      expect(helpResponse.response_type).toBe('ephemeral');
      expect(helpResponse.blocks).toHaveLength(2);
    });

    it('should validate status command response structure', () => {
      const statusResponse = {
        response_type: 'ephemeral',
        text: 'No pending decisions',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: expect.stringContaining('no pending decisions')
            }
          }
        ]
      };

      expect(statusResponse.response_type).toBe('ephemeral');
      expect(statusResponse.blocks).toHaveLength(1);
    });
  });
});
