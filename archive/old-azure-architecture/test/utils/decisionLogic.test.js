/**
 * Tests for Decision Outcome Logic Module
 * 
 * Tests all decision calculation paths including:
 * - Simple Majority
 * - Supermajority
 * - Unanimity
 * - Edge cases and deadlocks
 */

const {
  calculateVoteCounts,
  calculateSimpleMajority,
  calculateSupermajority,
  calculateUnanimity,
  calculateDecisionOutcome,
  checkDeadlock
} = require('../../src/utils/decisionLogic');

describe('Decision Logic Module', () => {
  describe('calculateVoteCounts', () => {
    it('should calculate vote counts correctly', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'no' },
        { vote_type: 'abstain' }
      ];

      const counts = calculateVoteCounts(votes);

      expect(counts.yes).toBe(2);
      expect(counts.no).toBe(1);
      expect(counts.abstain).toBe(1);
      expect(counts.total).toBe(4);
    });

    it('should handle empty vote array', () => {
      const counts = calculateVoteCounts([]);

      expect(counts.yes).toBe(0);
      expect(counts.no).toBe(0);
      expect(counts.abstain).toBe(0);
      expect(counts.total).toBe(0);
    });

    it('should handle all yes votes', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'yes' }
      ];

      const counts = calculateVoteCounts(votes);

      expect(counts.yes).toBe(3);
      expect(counts.no).toBe(0);
      expect(counts.abstain).toBe(0);
      expect(counts.total).toBe(3);
    });
  });

  describe('calculateSimpleMajority', () => {
    it('should pass with >50% yes votes', () => {
      const voteCounts = { yes: 3, no: 2, abstain: 0, total: 5 };
      const result = calculateSimpleMajority(voteCounts);

      expect(result.passed).toBe(true);
      expect(result.percentage).toBe(60);
    });

    it('should fail with exactly 50% yes votes', () => {
      const voteCounts = { yes: 2, no: 2, abstain: 0, total: 4 };
      const result = calculateSimpleMajority(voteCounts);

      expect(result.passed).toBe(false);
      expect(result.percentage).toBe(50);
    });

    it('should fail with <50% yes votes', () => {
      const voteCounts = { yes: 2, no: 3, abstain: 0, total: 5 };
      const result = calculateSimpleMajority(voteCounts);

      expect(result.passed).toBe(false);
      expect(result.percentage).toBe(40);
    });

    it('should handle no votes case', () => {
      const voteCounts = { yes: 0, no: 0, abstain: 0, total: 0 };
      const result = calculateSimpleMajority(voteCounts);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('No votes');
      expect(result.percentage).toBe(0);
    });

    it('should handle abstain votes correctly', () => {
      const voteCounts = { yes: 3, no: 1, abstain: 2, total: 6 };
      const result = calculateSimpleMajority(voteCounts);

      expect(result.passed).toBe(false); // 3/6 = 50%, need >50%
      expect(result.percentage).toBe(50);
    });

    it('should pass with majority despite abstentions', () => {
      const voteCounts = { yes: 4, no: 1, abstain: 2, total: 7 };
      const result = calculateSimpleMajority(voteCounts);

      expect(result.passed).toBe(true); // 4/7 = 57.14%
      expect(result.percentage).toBeCloseTo(57.14, 1);
    });
  });

  describe('calculateSupermajority', () => {
    it('should pass with ≥66% yes votes', () => {
      const voteCounts = { yes: 7, no: 3, abstain: 0, total: 10 };
      const result = calculateSupermajority(voteCounts, 10);

      expect(result.passed).toBe(true);
      expect(result.percentage).toBe(70);
    });

    it('should pass with exactly 66% yes votes', () => {
      const voteCounts = { yes: 66, no: 34, abstain: 0, total: 100 };
      const result = calculateSupermajority(voteCounts, 100);

      expect(result.passed).toBe(true);
      expect(result.percentage).toBe(66);
    });

    it('should fail with <66% yes votes', () => {
      const voteCounts = { yes: 6, no: 4, abstain: 0, total: 10 };
      const result = calculateSupermajority(voteCounts, 10);

      expect(result.passed).toBe(false);
      expect(result.percentage).toBe(60);
    });

    it('should calculate percentage based on required voters, not total votes', () => {
      const voteCounts = { yes: 5, no: 0, abstain: 0, total: 5 };
      const result = calculateSupermajority(voteCounts, 10);

      expect(result.passed).toBe(false); // 5/10 = 50%, need 66%
      expect(result.percentage).toBe(50);
      expect(result.missingVotes).toBe(5);
    });

    it('should handle no required voters edge case', () => {
      const voteCounts = { yes: 5, no: 0, abstain: 0, total: 5 };
      const result = calculateSupermajority(voteCounts, 0);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('No required voters');
    });

    it('should show missing votes count', () => {
      const voteCounts = { yes: 4, no: 1, abstain: 1, total: 6 };
      const result = calculateSupermajority(voteCounts, 10);

      expect(result.missingVotes).toBe(4);
      expect(result.requiredVotersCount).toBe(10);
    });
  });

  describe('calculateUnanimity', () => {
    it('should pass with all yes votes and quorum met', () => {
      const voteCounts = { yes: 5, no: 0, abstain: 0, total: 5 };
      const result = calculateUnanimity(voteCounts, 5);

      expect(result.passed).toBe(true);
      expect(result.quorumMet).toBe(true);
    });

    it('should pass with yes votes and abstentions (no no votes)', () => {
      const voteCounts = { yes: 4, no: 0, abstain: 1, total: 5 };
      const result = calculateUnanimity(voteCounts, 5);

      expect(result.passed).toBe(true);
      expect(result.quorumMet).toBe(true);
    });

    it('should fail with any no votes', () => {
      const voteCounts = { yes: 4, no: 1, abstain: 0, total: 5 };
      const result = calculateUnanimity(voteCounts, 5);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('not achieved');
      expect(result.quorumMet).toBe(true);
    });

    it('should fail if quorum not met', () => {
      const voteCounts = { yes: 3, no: 0, abstain: 0, total: 3 };
      const result = calculateUnanimity(voteCounts, 5, 5);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('Quorum not met');
      expect(result.quorumMet).toBe(false);
    });

    it('should use required voters as default quorum', () => {
      const voteCounts = { yes: 3, no: 0, abstain: 0, total: 3 };
      const result = calculateUnanimity(voteCounts, 5); // No quorum specified

      expect(result.passed).toBe(false);
      expect(result.quorum).toBe(5); // Should use requiredVotersCount
      expect(result.quorumMet).toBe(false);
    });

    it('should allow custom quorum less than required voters', () => {
      const voteCounts = { yes: 3, no: 0, abstain: 0, total: 3 };
      const result = calculateUnanimity(voteCounts, 5, 3);

      expect(result.passed).toBe(true);
      expect(result.quorum).toBe(3);
      expect(result.quorumMet).toBe(true);
    });

    it('should fail with no yes votes', () => {
      const voteCounts = { yes: 0, no: 0, abstain: 5, total: 5 };
      const result = calculateUnanimity(voteCounts, 5);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('No yes votes');
    });

    it('should handle no required voters edge case', () => {
      const voteCounts = { yes: 5, no: 0, abstain: 0, total: 5 };
      const result = calculateUnanimity(voteCounts, 0);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('No required voters');
    });
  });

  describe('calculateDecisionOutcome', () => {
    it('should calculate simple majority correctly', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'no' },
        { vote_type: 'no' }
      ];

      const result = calculateDecisionOutcome(votes, 'simple_majority', 5);

      expect(result.passed).toBe(true);
      expect(result.voteCounts.yes).toBe(3);
    });

    it('should calculate supermajority correctly', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'yes' }
      ];

      const result = calculateDecisionOutcome(votes, 'super_majority', 10);

      expect(result.passed).toBe(true); // 7/10 = 70%
      expect(result.percentage).toBe(70);
    });

    it('should calculate unanimity correctly', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'abstain' }
      ];

      const result = calculateDecisionOutcome(votes, 'unanimous', 4);

      expect(result.passed).toBe(true);
    });

    it('should handle invalid success criteria', () => {
      const votes = [{ vote_type: 'yes' }];

      const result = calculateDecisionOutcome(votes, 'invalid_criteria', 5);

      expect(result.passed).toBe(false);
      expect(result.error).toBe(true);
      expect(result.reason).toContain('Invalid success criteria');
    });
  });

  describe('checkDeadlock', () => {
    it('should detect deadlock for simple majority when impossible to reach', () => {
      const votes = [
        { vote_type: 'no' },
        { vote_type: 'no' },
        { vote_type: 'no' },
        { vote_type: 'yes' }
      ];

      const result = checkDeadlock(votes, 'simple_majority', 5);

      expect(result.isDeadlocked).toBe(true);
      expect(result.reason).toContain('Cannot reach simple majority');
    });

    it('should not detect deadlock when majority still possible', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'no' }
      ];

      const result = checkDeadlock(votes, 'simple_majority', 5);

      expect(result.isDeadlocked).toBe(false);
    });

    it('should detect deadlock for supermajority when impossible', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'no' },
        { vote_type: 'no' },
        { vote_type: 'no' },
        { vote_type: 'no' }
      ];

      const result = checkDeadlock(votes, 'super_majority', 10);

      expect(result.isDeadlocked).toBe(true);
      expect(result.reason).toContain('Cannot reach supermajority');
    });

    it('should detect deadlock for unanimity with any no vote', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'no' }
      ];

      const result = checkDeadlock(votes, 'unanimous', 5);

      expect(result.isDeadlocked).toBe(true);
      expect(result.reason).toContain('Unanimity impossible');
    });

    it('should not detect deadlock for unanimity with only yes votes', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'yes' }
      ];

      const result = checkDeadlock(votes, 'unanimous', 5);

      expect(result.isDeadlocked).toBe(false);
    });

    it('should show remaining votes count', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'no' }
      ];

      const result = checkDeadlock(votes, 'simple_majority', 10);

      expect(result.remainingVotes).toBe(8);
    });
  });

  describe('Edge Cases', () => {
    it('should handle vote_type edge values', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'YES' }, // Wrong case - should not count
        { vote_type: 'no' },
        { vote_type: '' }  // Invalid
      ];

      const counts = calculateVoteCounts(votes);
      
      // Only properly formatted votes should count
      expect(counts.yes).toBe(1);
      expect(counts.no).toBe(1);
      expect(counts.total).toBe(4);
    });

    it('should handle single voter scenario', () => {
      const votes = [{ vote_type: 'yes' }];

      const result = calculateDecisionOutcome(votes, 'simple_majority', 1);

      expect(result.passed).toBe(true); // 100% > 50%
    });

    it('should handle tie in simple majority', () => {
      const votes = [
        { vote_type: 'yes' },
        { vote_type: 'yes' },
        { vote_type: 'no' },
        { vote_type: 'no' }
      ];

      const result = calculateDecisionOutcome(votes, 'simple_majority', 4);

      expect(result.passed).toBe(false); // 50% is not > 50%
    });

    it('should handle all abstain votes', () => {
      const votes = [
        { vote_type: 'abstain' },
        { vote_type: 'abstain' },
        { vote_type: 'abstain' }
      ];

      const result = calculateDecisionOutcome(votes, 'simple_majority', 3);

      expect(result.passed).toBe(false);
      expect(result.voteCounts.yes).toBe(0);
    });
  });
});
