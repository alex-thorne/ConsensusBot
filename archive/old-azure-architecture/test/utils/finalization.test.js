/**
 * Tests for Decision Finalization Module (Slack-based)
 */

const { shouldFinalizeDecision } = require('../../src/utils/finalization');

// Mock logger to avoid console output during tests
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('Decision Finalization Module', () => {
  describe('shouldFinalizeDecision', () => {
    test('should return true when all voters have voted', () => {
      const decisionState = {
        name: 'Test Decision',
        messageTs: '1234567890.123456',
        voters: ['U1', 'U2', 'U3'],
        votes: [
          { userId: 'U1', voteType: 'yes' },
          { userId: 'U2', voteType: 'no' },
          { userId: 'U3', voteType: 'yes' }
        ],
        deadline: '2026-12-31'
      };

      const result = shouldFinalizeDecision(decisionState);

      expect(result.shouldFinalize).toBe(true);
      expect(result.reason).toBe('all votes submitted');
      expect(result.allVotesSubmitted).toBe(true);
    });

    test('should return true when deadline has passed', () => {
      const decisionState = {
        name: 'Test Decision',
        messageTs: '1234567890.123456',
        voters: ['U1', 'U2', 'U3'],
        votes: [
          { userId: 'U1', voteType: 'yes' }
        ],
        deadline: '2020-01-01' // Past date
      };

      const result = shouldFinalizeDecision(decisionState);

      expect(result.shouldFinalize).toBe(true);
      expect(result.reason).toBe('deadline reached');
      expect(result.deadlineReached).toBe(true);
    });

    test('should return false when votes incomplete and deadline not reached', () => {
      const decisionState = {
        name: 'Test Decision',
        messageTs: '1234567890.123456',
        voters: ['U1', 'U2', 'U3'],
        votes: [
          { userId: 'U1', voteType: 'yes' }
        ],
        deadline: '2099-12-31' // Future date
      };

      const result = shouldFinalizeDecision(decisionState);

      expect(result.shouldFinalize).toBe(false);
      expect(result.reason).toBe('not yet ready');
      expect(result.allVotesSubmitted).toBe(false);
      expect(result.deadlineReached).toBe(false);
    });
  });
});
