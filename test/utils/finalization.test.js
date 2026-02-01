/**
 * Tests for Decision Finalization Module
 */

const {
  shouldFinalizeDecision,
  finalizeDecision,
  notifyDecisionFinalized,
  finalizeReadyDecisions
} = require('../../src/utils/finalization');

const db = require('../../src/database/db');
const { calculateDecisionOutcome } = require('../../src/utils/decisionLogic');
const { createAzureDevOpsClient, pushADRToRepository } = require('../../src/utils/azureDevOps');

// Mock dependencies
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../src/database/db');
jest.mock('../../src/utils/decisionLogic');
jest.mock('../../src/utils/azureDevOps');

describe('Decision Finalization Module', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment
    delete process.env.AZURE_DEVOPS_PAT;
  });

  describe('shouldFinalizeDecision', () => {
    
    test('should return true when all voters have voted', () => {
      const decision = {
        id: 1,
        deadline: '2026-12-31'
      };
      const voters = [
        { user_id: 'U1' },
        { user_id: 'U2' },
        { user_id: 'U3' }
      ];
      const votes = [
        { user_id: 'U1', vote_type: 'yes' },
        { user_id: 'U2', vote_type: 'no' },
        { user_id: 'U3', vote_type: 'yes' }
      ];

      const result = shouldFinalizeDecision(decision, voters, votes);

      expect(result.shouldFinalize).toBe(true);
      expect(result.reason).toBe('all votes submitted');
      expect(result.allVotesSubmitted).toBe(true);
    });

    test('should return true when deadline has passed', () => {
      const decision = {
        id: 1,
        deadline: '2020-01-01' // Past date
      };
      const voters = [
        { user_id: 'U1' },
        { user_id: 'U2' },
        { user_id: 'U3' }
      ];
      const votes = [
        { user_id: 'U1', vote_type: 'yes' }
      ];

      const result = shouldFinalizeDecision(decision, voters, votes);

      expect(result.shouldFinalize).toBe(true);
      expect(result.reason).toBe('deadline reached');
      expect(result.deadlineReached).toBe(true);
    });

    test('should return false when votes incomplete and deadline not reached', () => {
      const decision = {
        id: 1,
        deadline: '2099-12-31' // Future date
      };
      const voters = [
        { user_id: 'U1' },
        { user_id: 'U2' },
        { user_id: 'U3' }
      ];
      const votes = [
        { user_id: 'U1', vote_type: 'yes' }
      ];

      const result = shouldFinalizeDecision(decision, voters, votes);

      expect(result.shouldFinalize).toBe(false);
      expect(result.reason).toBe('not yet ready');
      expect(result.allVotesSubmitted).toBe(false);
      expect(result.deadlineReached).toBe(false);
    });

    test('should handle more votes than voters (edge case)', () => {
      const decision = {
        id: 1,
        deadline: '2099-12-31'
      };
      const voters = [
        { user_id: 'U1' },
        { user_id: 'U2' }
      ];
      const votes = [
        { user_id: 'U1', vote_type: 'yes' },
        { user_id: 'U2', vote_type: 'yes' },
        { user_id: 'U3', vote_type: 'yes' }
      ];

      const result = shouldFinalizeDecision(decision, voters, votes);

      expect(result.shouldFinalize).toBe(true);
      expect(result.allVotesSubmitted).toBe(true);
    });
  });

  describe('finalizeDecision', () => {
    
    test('should finalize an approved decision successfully', async () => {
      const decision = {
        id: 5,
        name: 'Test Decision',
        status: 'active',
        success_criteria: 'simple_majority',
        deadline: '2020-01-01'
      };
      const voters = [
        { user_id: 'U1' },
        { user_id: 'U2' },
        { user_id: 'U3' }
      ];
      const votes = [
        { user_id: 'U1', vote_type: 'yes' },
        { user_id: 'U2', vote_type: 'yes' },
        { user_id: 'U3', vote_type: 'no' }
      ];
      const outcome = {
        passed: true,
        reason: 'Simple majority achieved',
        voteCounts: { yes: 2, no: 1, abstain: 0, total: 3 }
      };

      db.getDecision.mockReturnValue(decision);
      db.getVoters.mockReturnValue(voters);
      db.getVotes.mockReturnValue(votes);
      calculateDecisionOutcome.mockReturnValue(outcome);
      db.updateDecisionStatus.mockReturnValue(undefined);

      const result = await finalizeDecision(5);

      expect(result.success).toBe(true);
      expect(result.status).toBe('approved');
      expect(result.approved).toBe(true);
      expect(db.updateDecisionStatus).toHaveBeenCalledWith(5, 'approved');
    });

    test('should finalize a rejected decision successfully', async () => {
      const decision = {
        id: 6,
        name: 'Test Decision',
        status: 'active',
        success_criteria: 'super_majority',
        deadline: '2020-01-01'
      };
      const voters = [
        { user_id: 'U1' },
        { user_id: 'U2' },
        { user_id: 'U3' }
      ];
      const votes = [
        { user_id: 'U1', vote_type: 'yes' },
        { user_id: 'U2', vote_type: 'no' },
        { user_id: 'U3', vote_type: 'no' }
      ];
      const outcome = {
        passed: false,
        reason: 'Supermajority not achieved',
        voteCounts: { yes: 1, no: 2, abstain: 0, total: 3 }
      };

      db.getDecision.mockReturnValue(decision);
      db.getVoters.mockReturnValue(voters);
      db.getVotes.mockReturnValue(votes);
      calculateDecisionOutcome.mockReturnValue(outcome);
      db.updateDecisionStatus.mockReturnValue(undefined);

      const result = await finalizeDecision(6);

      expect(result.success).toBe(true);
      expect(result.status).toBe('rejected');
      expect(result.approved).toBe(false);
      expect(db.updateDecisionStatus).toHaveBeenCalledWith(6, 'rejected');
    });

    test('should not finalize already finalized decision', async () => {
      const decision = {
        id: 7,
        name: 'Already Finalized',
        status: 'approved'
      };

      db.getDecision.mockReturnValue(decision);

      const result = await finalizeDecision(7);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Decision already finalized');
      expect(db.updateDecisionStatus).not.toHaveBeenCalled();
    });

    test('should throw error if decision not found', async () => {
      db.getDecision.mockReturnValue(null);

      await expect(finalizeDecision(999)).rejects.toThrow('Decision 999 not found');
    });

    test('should not finalize decision that is not ready', async () => {
      const decision = {
        id: 8,
        name: 'Not Ready',
        status: 'active',
        deadline: '2099-12-31'
      };
      const voters = [
        { user_id: 'U1' },
        { user_id: 'U2' }
      ];
      const votes = [
        { user_id: 'U1', vote_type: 'yes' }
      ];

      db.getDecision.mockReturnValue(decision);
      db.getVoters.mockReturnValue(voters);
      db.getVotes.mockReturnValue(votes);

      const result = await finalizeDecision(8);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Decision not ready for finalization');
      expect(db.updateDecisionStatus).not.toHaveBeenCalled();
    });

    test('should push ADR to Azure DevOps when configured', async () => {
      process.env.AZURE_DEVOPS_PAT = 'test-pat';

      const decision = {
        id: 9,
        name: 'ADR Test',
        status: 'active',
        success_criteria: 'simple_majority',
        deadline: '2020-01-01'
      };
      const voters = [{ user_id: 'U1' }];
      const votes = [{ user_id: 'U1', vote_type: 'yes' }];
      const outcome = {
        passed: true,
        voteCounts: { yes: 1, no: 0, abstain: 0, total: 1 }
      };
      const adrResult = {
        success: true,
        filePath: '/docs/adr/ADR-0009-adr-test.md',
        commitId: 'abc123'
      };

      db.getDecision.mockReturnValue(decision);
      db.getVoters.mockReturnValue(voters);
      db.getVotes.mockReturnValue(votes);
      calculateDecisionOutcome.mockReturnValue(outcome);
      db.updateDecisionStatus.mockReturnValue(undefined);
      
      const mockClient = {};
      createAzureDevOpsClient.mockReturnValue(mockClient);
      pushADRToRepository.mockResolvedValue(adrResult);

      const result = await finalizeDecision(9);

      expect(result.success).toBe(true);
      expect(result.adr).toEqual(adrResult);
      expect(pushADRToRepository).toHaveBeenCalledWith(
        decision,
        votes,
        expect.objectContaining({ approved: true }),
        mockClient
      );
    });

    test('should skip ADR push when not configured', async () => {
      delete process.env.AZURE_DEVOPS_PAT;

      const decision = {
        id: 10,
        name: 'No ADR',
        status: 'active',
        success_criteria: 'simple_majority',
        deadline: '2020-01-01'
      };
      const voters = [{ user_id: 'U1' }];
      const votes = [{ user_id: 'U1', vote_type: 'yes' }];
      const outcome = {
        passed: true,
        voteCounts: { yes: 1, no: 0, abstain: 0, total: 1 }
      };

      db.getDecision.mockReturnValue(decision);
      db.getVoters.mockReturnValue(voters);
      db.getVotes.mockReturnValue(votes);
      calculateDecisionOutcome.mockReturnValue(outcome);
      db.updateDecisionStatus.mockReturnValue(undefined);

      const result = await finalizeDecision(10);

      expect(result.success).toBe(true);
      expect(result.adr).toBeNull();
      expect(pushADRToRepository).not.toHaveBeenCalled();
    });

    test('should not fail finalization if ADR push fails', async () => {
      process.env.AZURE_DEVOPS_PAT = 'test-pat';

      const decision = {
        id: 11,
        name: 'ADR Fail',
        status: 'active',
        success_criteria: 'simple_majority',
        deadline: '2020-01-01'
      };
      const voters = [{ user_id: 'U1' }];
      const votes = [{ user_id: 'U1', vote_type: 'yes' }];
      const outcome = {
        passed: true,
        voteCounts: { yes: 1, no: 0, abstain: 0, total: 1 }
      };

      db.getDecision.mockReturnValue(decision);
      db.getVoters.mockReturnValue(voters);
      db.getVotes.mockReturnValue(votes);
      calculateDecisionOutcome.mockReturnValue(outcome);
      db.updateDecisionStatus.mockReturnValue(undefined);
      
      const mockClient = {};
      createAzureDevOpsClient.mockReturnValue(mockClient);
      pushADRToRepository.mockRejectedValue(new Error('Azure DevOps API error'));

      const result = await finalizeDecision(11);

      expect(result.success).toBe(true);
      expect(result.status).toBe('approved');
      expect(result.adr.success).toBe(false);
      expect(result.adr.error).toContain('Azure DevOps API error');
    });

    test('should skip ADR push when explicitly disabled', async () => {
      process.env.AZURE_DEVOPS_PAT = 'test-pat';

      const decision = {
        id: 12,
        name: 'Skip ADR',
        status: 'active',
        success_criteria: 'simple_majority',
        deadline: '2020-01-01'
      };
      const voters = [{ user_id: 'U1' }];
      const votes = [{ user_id: 'U1', vote_type: 'yes' }];
      const outcome = {
        passed: true,
        voteCounts: { yes: 1, no: 0, abstain: 0, total: 1 }
      };

      db.getDecision.mockReturnValue(decision);
      db.getVoters.mockReturnValue(voters);
      db.getVotes.mockReturnValue(votes);
      calculateDecisionOutcome.mockReturnValue(outcome);
      db.updateDecisionStatus.mockReturnValue(undefined);

      const result = await finalizeDecision(12, { pushToAzureDevOps: false });

      expect(result.success).toBe(true);
      expect(result.adr).toBeNull();
      expect(pushADRToRepository).not.toHaveBeenCalled();
    });

    test('should send Slack notification when client provided', async () => {
      const decision = {
        id: 13,
        name: 'Slack Notify',
        status: 'active',
        success_criteria: 'simple_majority',
        deadline: '2020-01-01',
        channel_id: 'C123',
        message_ts: '1234567890.123'
      };
      const voters = [{ user_id: 'U1' }];
      const votes = [{ user_id: 'U1', vote_type: 'yes' }];
      const outcome = {
        passed: true,
        reason: 'Approved',
        voteCounts: { yes: 1, no: 0, abstain: 0, total: 1 }
      };

      db.getDecision.mockReturnValue(decision);
      db.getVoters.mockReturnValue(voters);
      db.getVotes.mockReturnValue(votes);
      calculateDecisionOutcome.mockReturnValue(outcome);
      db.updateDecisionStatus.mockReturnValue(undefined);

      const mockSlackClient = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({})
        }
      };

      const result = await finalizeDecision(13, { slackClient: mockSlackClient });

      expect(result.success).toBe(true);
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123',
          thread_ts: '1234567890.123'
        })
      );
    });
  });

  describe('notifyDecisionFinalized', () => {
    
    test('should send notification for approved decision', async () => {
      const mockClient = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({})
        }
      };
      const decision = {
        id: 1,
        name: 'Test Decision',
        channel_id: 'C123',
        message_ts: '1234567890.123'
      };
      const outcome = {
        approved: true,
        reason: 'Decision approved'
      };

      await notifyDecisionFinalized(mockClient, decision, outcome);

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123',
          thread_ts: '1234567890.123',
          text: expect.stringContaining('✅')
        })
      );
    });

    test('should send notification for rejected decision', async () => {
      const mockClient = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({})
        }
      };
      const decision = {
        id: 2,
        name: 'Rejected Decision',
        channel_id: 'C456',
        message_ts: '9876543210.321'
      };
      const outcome = {
        approved: false,
        reason: 'Decision rejected'
      };

      await notifyDecisionFinalized(mockClient, decision, outcome);

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C456',
          thread_ts: '9876543210.321',
          text: expect.stringContaining('❌')
        })
      );
    });

    test('should include ADR info in notification when provided', async () => {
      const mockClient = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({})
        }
      };
      const decision = {
        id: 3,
        name: 'With ADR',
        channel_id: 'C789',
        message_ts: '1111111111.111'
      };
      const outcome = {
        approved: true,
        reason: 'Approved'
      };
      const adrResult = {
        success: true,
        filename: 'ADR-0003-with-adr.md'
      };

      await notifyDecisionFinalized(mockClient, decision, outcome, adrResult);

      const call = mockClient.chat.postMessage.mock.calls[0][0];
      expect(call.text).toContain('ADR generated');
      expect(call.text).toContain('ADR-0003-with-adr.md');
    });
  });

  describe('finalizeReadyDecisions', () => {
    
    test('should finalize all ready decisions', async () => {
      const decisions = [
        {
          id: 1,
          name: 'Decision 1',
          status: 'active',
          success_criteria: 'simple_majority',
          deadline: '2020-01-01'
        },
        {
          id: 2,
          name: 'Decision 2',
          status: 'active',
          success_criteria: 'simple_majority',
          deadline: '2099-12-31'
        }
      ];

      db.getOpenDecisions.mockReturnValue(decisions);
      
      // First call for shouldFinalize check on Decision 1
      db.getVoters.mockReturnValueOnce([{ user_id: 'U1' }]);
      db.getVotes.mockReturnValueOnce([{ user_id: 'U1', vote_type: 'yes' }]);
      
      // Decision 1: ready (deadline passed) - finalize it
      db.getDecision.mockReturnValueOnce(decisions[0]);
      db.getVoters.mockReturnValueOnce([{ user_id: 'U1' }]);
      db.getVotes.mockReturnValueOnce([{ user_id: 'U1', vote_type: 'yes' }]);
      calculateDecisionOutcome.mockReturnValueOnce({
        passed: true,
        voteCounts: { yes: 1, no: 0, abstain: 0, total: 1 }
      });
      db.updateDecisionStatus.mockReturnValueOnce(undefined);
      
      // Second call for shouldFinalize check on Decision 2
      db.getVoters.mockReturnValueOnce([{ user_id: 'U1' }, { user_id: 'U2' }]);
      db.getVotes.mockReturnValueOnce([{ user_id: 'U1', vote_type: 'yes' }]);

      const result = await finalizeReadyDecisions();

      expect(result.total).toBe(2);
      expect(result.finalized).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.errors).toBe(0);
    });

    test('should handle errors gracefully', async () => {
      const decisions = [
        {
          id: 1,
          name: 'Decision 1',
          status: 'active',
          deadline: '2020-01-01'
        }
      ];

      db.getOpenDecisions.mockReturnValue(decisions);
      db.getVoters.mockReturnValue([{ user_id: 'U1' }]);
      db.getVotes.mockReturnValue([{ user_id: 'U1', vote_type: 'yes' }]);
      db.getDecision.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await finalizeReadyDecisions();

      expect(result.total).toBe(1);
      expect(result.finalized).toBe(0);
      expect(result.errors).toBe(1);
      expect(result.decisions[0].success).toBe(false);
    });

    test('should return empty result when no open decisions', async () => {
      db.getOpenDecisions.mockReturnValue([]);

      const result = await finalizeReadyDecisions();

      expect(result.total).toBe(0);
      expect(result.finalized).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
    });
  });
});
