/**
 * Tests for Reminder (Nudger) Module (Slack-based)
 */

const { getMissingVoters } = require('../../src/utils/slackState');

// Mock logger to avoid console output during tests
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('Reminder Module', () => {
  describe('getMissingVoters (via slackState)', () => {
    test('should identify users who haven\'t voted', () => {
      const decisionState = {
        voters: ['U1', 'U2', 'U3', 'U4'],
        votes: [
          { userId: 'U1', voteType: 'yes' },
          { userId: 'U3', voteType: 'no' }
        ]
      };

      const missingVoters = getMissingVoters(decisionState);

      expect(missingVoters).toHaveLength(2);
      expect(missingVoters).toContain('U2');
      expect(missingVoters).toContain('U4');
    });

    test('should return empty array when all voters have voted', () => {
      const decisionState = {
        voters: ['U1', 'U2'],
        votes: [
          { userId: 'U1', voteType: 'yes' },
          { userId: 'U2', voteType: 'no' }
        ]
      };

      const missingVoters = getMissingVoters(decisionState);

      expect(missingVoters).toHaveLength(0);
    });

    test('should return all voters when no votes cast', () => {
      const decisionState = {
        voters: ['U1', 'U2', 'U3'],
        votes: []
      };

      const missingVoters = getMissingVoters(decisionState);

      expect(missingVoters).toHaveLength(3);
      expect(missingVoters).toEqual(['U1', 'U2', 'U3']);
    });
  });
});
