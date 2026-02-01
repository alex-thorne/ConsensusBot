/**
 * End-to-End Integration Tests
 * 
 * Tests the complete workflow from command to voting to finalization
 */

const fs = require('fs');
const path = require('path');
const { registerConsensusCommand, registerVotingHandlers } = require('../../src/commands/consensusCommand');
const db = require('../../src/database/db');
const { finalizeDecision } = require('../../src/utils/finalization');
const { calculateDecisionOutcome } = require('../../src/utils/decisionLogic');

// Use a test database
const TEST_DB_PATH = path.join(__dirname, '../../data/test-e2e-consensus.db');

// Mock Bolt app
const createMockApp = () => {
  const handlers = {
    command: {},
    action: {},
    view: {},
    message: {}
  };

  const app = {
    command: jest.fn((cmd, handler) => {
      handlers.command[cmd] = handler;
    }),
    action: jest.fn((actionId, handler) => {
      handlers.action[actionId] = handler;
    }),
    view: jest.fn((viewId, handler) => {
      handlers.view[viewId] = handler;
    }),
    message: jest.fn((pattern, handler) => {
      handlers.message[pattern] = handler;
    }),
    client: {
      chat: {
        postMessage: jest.fn().mockResolvedValue({ ts: '1234567890.123456', ok: true }),
        update: jest.fn().mockResolvedValue({ ok: true })
      },
      pins: {
        add: jest.fn().mockResolvedValue({ ok: true })
      },
      views: {
        open: jest.fn().mockResolvedValue({ ok: true })
      },
      conversations: {
        open: jest.fn().mockResolvedValue({ ok: true, channel: { id: 'D12345678' } })
      }
    },
    _handlers: handlers
  };

  return app;
};

describe('End-to-End Integration Tests', () => {
  let app;
  
  beforeAll(() => {
    // Set test database path
    process.env.DATABASE_PATH = TEST_DB_PATH;
  });

  beforeEach(() => {
    // Clean up test database before each test
    db.closeDatabase();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    app = createMockApp();
    registerConsensusCommand(app);
    registerVotingHandlers(app);
  });

  afterAll(() => {
    // Clean up test database after all tests
    db.closeDatabase();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('Complete Decision Lifecycle', () => {
    it('should handle full workflow: create -> vote -> finalize', async () => {
      // Step 1: Simulate /consensus command
      const commandHandler = app._handlers.command['/consensus'];
      expect(commandHandler).toBeDefined();

      const ack = jest.fn();
      const respond = jest.fn();
      const command = {
        user_id: 'U12345',
        channel_id: 'C12345',
        text: ''
      };

      await commandHandler({ command, ack, respond });

      expect(ack).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          blocks: expect.any(Array)
        })
      );

      // Verify button action was registered
      expect(app._handlers.action['open_consensus_modal']).toBeDefined();

      // Step 2: Simulate button click to open modal
      const buttonHandler = app._handlers.action['open_consensus_modal'];
      const buttonAck = jest.fn();
      const body = {
        user: { id: 'U12345' },
        channel: { id: 'C12345' },
        trigger_id: 'trigger123'
      };

      await buttonHandler({ ack: buttonAck, body, client: app.client });

      expect(buttonAck).toHaveBeenCalled();
      expect(app.client.views.open).toHaveBeenCalled();

      // Step 3: Simulate modal submission
      const modalHandler = app._handlers.view['consensus_decision_modal'];
      expect(modalHandler).toBeDefined();

      const modalAck = jest.fn();
      const view = {
        state: {
          values: {
            decision_name_block: {
              decision_name_input: { value: 'Test Decision' }
            },
            required_voters_block: {
              required_voters_input: { selected_users: ['U12345', 'U67890', 'UABCDE'] }
            },
            proposal_block: {
              proposal_input: { value: 'Test proposal for testing' }
            },
            success_criteria_block: {
              success_criteria_input: { selected_option: { value: 'simple_majority' } }
            },
            deadline_block: {
              deadline_input: { selected_date: '2024-12-31' }
            }
          }
        },
        private_metadata: 'C12345'
      };

      await modalHandler({ ack: modalAck, body, view, client: app.client });

      expect(modalAck).toHaveBeenCalled();

      // Verify decision was created in database
      const decisions = db.getOpenDecisions();
      expect(decisions.length).toBe(1);
      expect(decisions[0].name).toBe('Test Decision');
      expect(decisions[0].status).toBe('active');

      // Verify voters were added
      const voters = db.getVoters(decisions[0].id);
      expect(voters.length).toBe(3);

      // Verify voting message was posted
      expect(app.client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C12345'
        })
      );

      // Step 4: Simulate voting
      const voteYesHandler = app._handlers.action[/^vote_yes_(\d+)$/];
      expect(voteYesHandler).toBeDefined();

      const decisionId = decisions[0].id;
      
      // First voter votes yes
      const voteAck1 = jest.fn();
      const voteBody1 = {
        user: { id: 'U12345' },
        action: { value: `${decisionId}` },
        message: { ts: '1234567890.123456' },
        channel: { id: 'C12345' }
      };

      await voteYesHandler({ ack: voteAck1, body: voteBody1, client: app.client, action: { value: `${decisionId}` } });
      expect(voteAck1).toHaveBeenCalled();

      // Verify vote was recorded
      let votes = db.getVotes(decisionId);
      let vote = votes.find(v => v.user_id === 'U12345');
      expect(vote).toBeDefined();
      expect(vote.vote_type).toBe('yes');

      // Second voter votes yes
      const voteAck2 = jest.fn();
      const voteBody2 = {
        user: { id: 'U67890' },
        action: { value: `${decisionId}` },
        message: { ts: '1234567890.123456' },
        channel: { id: 'C12345' }
      };

      await voteYesHandler({ ack: voteAck2, body: voteBody2, client: app.client, action: { value: `${decisionId}` } });

      // Third voter votes no
      const voteNoHandler = app._handlers.action[/^vote_no_(\d+)$/];
      const voteAck3 = jest.fn();
      const voteBody3 = {
        user: { id: 'UABCDE' },
        action: { value: `${decisionId}` },
        message: { ts: '1234567890.123456' },
        channel: { id: 'C12345' }
      };

      await voteNoHandler({ ack: voteAck3, body: voteBody3, client: app.client, action: { value: `${decisionId}` } });

      // Step 5: Verify decision outcome
      const updatedDecision = db.getDecision(decisionId);
      const allVotes = db.getVotes(decisionId);
      expect(allVotes.length).toBe(3);

      const outcome = calculateDecisionOutcome(
        allVotes,
        updatedDecision.success_criteria,
        voters.length
      );

      expect(outcome.passed).toBe(true);
      expect(outcome.percentage).toBeGreaterThan(50);
    });

    it('should handle voting with different success criteria', async () => {
      // Test unanimity
      const decisionId1 = db.insertDecision({
        name: 'Unanimity Test',
        proposal: 'Test',
        success_criteria: 'unanimous',
        deadline: '2024-12-31',
        channel_id: 'C12345',
        creator_id: 'U12345'
      });
      db.insertVoters(decisionId1, ['U1', 'U2', 'U3']);
      
      db.upsertVote({ decision_id: decisionId1, user_id: 'U1', vote_type: 'yes' });
      db.upsertVote({ decision_id: decisionId1, user_id: 'U2', vote_type: 'yes' });
      db.upsertVote({ decision_id: decisionId1, user_id: 'U3', vote_type: 'no' });

      const votes1 = db.getVotes(decisionId1);
      const voters1 = db.getVoters(decisionId1);
      const outcome1 = calculateDecisionOutcome(
        votes1,
        'unanimous',
        voters1.length
      );

      expect(outcome1.passed).toBe(false);

      // Test supermajority
      const decisionId2 = db.insertDecision({
        name: 'Supermajority Test',
        proposal: 'Test',
        success_criteria: 'super_majority',
        deadline: '2024-12-31',
        channel_id: 'C12345',
        creator_id: 'U12345'
      });
      db.insertVoters(decisionId2, ['U1', 'U2', 'U3', 'U4']);
      
      db.upsertVote({ decision_id: decisionId2, user_id: 'U1', vote_type: 'yes' });
      db.upsertVote({ decision_id: decisionId2, user_id: 'U2', vote_type: 'yes' });
      db.upsertVote({ decision_id: decisionId2, user_id: 'U3', vote_type: 'yes' });
      db.upsertVote({ decision_id: decisionId2, user_id: 'U4', vote_type: 'no' });

      const votes2 = db.getVotes(decisionId2);
      const voters2 = db.getVoters(decisionId2);
      const outcome2 = calculateDecisionOutcome(
        votes2,
        'super_majority',
        voters2.length
      );

      expect(outcome2.passed).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should prevent non-eligible voters from voting', async () => {
      const decisionId = db.insertDecision({
        name: 'Test Decision',
        proposal: 'Test',
        success_criteria: 'simple_majority',
        deadline: '2024-12-31',
        channel_id: 'C12345',
        creator_id: 'U12345',
        message_ts: '1234567890.123456'
      });
      db.insertVoters(decisionId, ['U12345', 'U67890']);

      const voteHandler = app._handlers.action[/^vote_yes_(\d+)$/];
      const ack = jest.fn();
      const respond = jest.fn();
      const body = {
        user: { id: 'U99999' }, // Not in voter list
        action: { value: `${decisionId}` },
        message: { ts: '1234567890.123456' },
        channel: { id: 'C12345' }
      };

      // Mock postEphemeral for error message
      app.client.chat.postEphemeral = jest.fn();

      await voteHandler({ ack, body, client: app.client, action: { value: `${decisionId}` } });

      expect(ack).toHaveBeenCalled();
      expect(app.client.chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('not eligible')
        })
      );

      // Verify vote was NOT recorded
      const votes = db.getVotes(decisionId);
      const vote = votes.find(v => v.user_id === 'U99999');
      expect(vote).toBeUndefined();
    });

    it('should handle vote changes', async () => {
      const decisionId = db.insertDecision({
        name: 'Test Decision',
        proposal: 'Test',
        success_criteria: 'simple_majority',
        deadline: '2024-12-31',
        channel_id: 'C12345',
        creator_id: 'U12345',
        message_ts: '1234567890.123456'
      });
      db.insertVoters(decisionId, ['U12345']);

      // First vote: yes
      const voteYesHandler = app._handlers.action[/^vote_yes_(\d+)$/];
      const ackYes = jest.fn();
      const bodyYes = {
        user: { id: 'U12345' },
        action: { value: `${decisionId}` },
        message: { ts: '1234567890.123456' },
        channel: { id: 'C12345' }
      };

      await voteYesHandler({ ack: ackYes, body: bodyYes, client: app.client, action: { value: `${decisionId}` } });

      let votes = db.getVotes(decisionId);
      let vote = votes.find(v => v.user_id === 'U12345');
      expect(vote.vote_type).toBe('yes');

      // Change vote to no
      const voteNoHandler = app._handlers.action[/^vote_no_(\d+)$/];
      const ackNo = jest.fn();
      const bodyNo = {
        user: { id: 'U12345' },
        action: { value: `${decisionId}` },
        message: { ts: '1234567890.123456' },
        channel: { id: 'C12345' }
      };

      await voteNoHandler({ ack: ackNo, body: bodyNo, client: app.client, action: { value: `${decisionId}` } });

      votes = db.getVotes(decisionId);
      vote = votes.find(v => v.user_id === 'U12345');
      expect(vote.vote_type).toBe('no');
    });

    it('should handle simultaneous votes (concurrency)', async () => {
      const decisionId = db.insertDecision({
        name: 'Test Decision',
        proposal: 'Test',
        success_criteria: 'simple_majority',
        deadline: '2024-12-31',
        channel_id: 'C12345',
        creator_id: 'U12345',
        message_ts: '1234567890.123456'
      });
      db.insertVoters(decisionId, ['U1', 'U2', 'U3', 'U4', 'U5']);

      const voteYesHandler = app._handlers.action[/^vote_yes_(\d+)$/];
      
      // Simulate 5 users voting simultaneously
      const votePromises = ['U1', 'U2', 'U3', 'U4', 'U5'].map(userId => {
        const ack = jest.fn();
        const body = {
          user: { id: userId },
          action: { value: `${decisionId}` },
          message: { ts: '1234567890.123456' },
          channel: { id: 'C12345' }
        };
        return voteYesHandler({ ack, body, client: app.client, action: { value: `${decisionId}` } });
      });

      await Promise.all(votePromises);

      // Verify all votes were recorded
      const votes = db.getVotes(decisionId);
      expect(votes.length).toBe(5);
      expect(votes.every(v => v.vote_type === 'yes')).toBe(true);
    });

    it('should handle missing voter lists gracefully', async () => {
      const decisionId = db.insertDecision({
        name: 'Test Decision',
        proposal: 'Test',
        success_criteria: 'simple_majority',
        deadline: '2024-12-31',
        channel_id: 'C12345',
        creator_id: 'U12345',
        message_ts: '1234567890.123456'
      });
      // Don't add any voters

      const voters = db.getVoters(decisionId);
      expect(voters.length).toBe(0);

      // Outcome calculation should handle empty voter list
      const outcome = calculateDecisionOutcome(
        [],
        'simple_majority',
        0
      );

      expect(outcome.passed).toBe(false);
    });

    it('should detect deadlock situations', async () => {
      const decisionId = db.insertDecision({
        name: 'Test Decision',
        proposal: 'Test',
        success_criteria: 'super_majority',
        deadline: '2024-12-31',
        channel_id: 'C12345',
        creator_id: 'U12345'
      });
      db.insertVoters(decisionId, ['U1', 'U2', 'U3', 'U4']);

      // 2 yes, 2 no - deadlock for supermajority
      db.upsertVote({ decision_id: decisionId, user_id: 'U1', vote_type: 'yes' });
      db.upsertVote({ decision_id: decisionId, user_id: 'U2', vote_type: 'yes' });
      db.upsertVote({ decision_id: decisionId, user_id: 'U3', vote_type: 'no' });
      db.upsertVote({ decision_id: decisionId, user_id: 'U4', vote_type: 'no' });

      const votes = db.getVotes(decisionId);
      const voters = db.getVoters(decisionId);
      
      const outcome = calculateDecisionOutcome(
        votes,
        'super_majority',
        voters.length
      );

      expect(outcome.passed).toBe(false);
    });
  });

  describe('Command Variations', () => {
    it('should handle /consensus help command', async () => {
      const commandHandler = app._handlers.command['/consensus'];
      const ack = jest.fn();
      const respond = jest.fn();
      const command = {
        user_id: 'U12345',
        channel_id: 'C12345',
        text: 'help'
      };

      await commandHandler({ command, ack, respond });

      expect(ack).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          text: 'ConsensusBot Help'
        })
      );
    });

    it('should handle /consensus status command', async () => {
      const commandHandler = app._handlers.command['/consensus'];
      const ack = jest.fn();
      const respond = jest.fn();
      const command = {
        user_id: 'U12345',
        channel_id: 'C12345',
        text: 'status'
      };

      await commandHandler({ command, ack, respond });

      expect(ack).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          text: expect.stringContaining('pending decisions')
        })
      );
    });
  });
});
