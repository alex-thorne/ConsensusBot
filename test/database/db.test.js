/**
 * Tests for Database Module
 * 
 * Tests database operations for decisions, voters, and votes
 */

const fs = require('fs');
const path = require('path');
const db = require('../../src/database/db');

// Use a test database
const TEST_DB_PATH = path.join(__dirname, '../../data/test-consensus.db');

describe('Database Module', () => {
  beforeAll(() => {
    // Set test database path
    process.env.DATABASE_PATH = TEST_DB_PATH;
  });

  beforeEach(() => {
    // Clean up test database before each test
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  afterAll(() => {
    // Clean up test database after all tests
    db.closeDatabase();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('Decision Operations', () => {
    it('should insert a new decision', () => {
      const decision = {
        name: 'Test Decision',
        proposal: 'This is a test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        channel_id: 'C1234567890',
        creator_id: 'U1234567890'
      };

      const decisionId = db.insertDecision(decision);

      expect(decisionId).toBeGreaterThan(0);
      expect(typeof decisionId).toBe('number');
    });

    it('should retrieve a decision by ID', () => {
      const decision = {
        name: 'Test Decision',
        proposal: 'This is a test proposal',
        success_criteria: 'unanimous',
        deadline: '2026-02-15',
        channel_id: 'C1234567890',
        creator_id: 'U1234567890'
      };

      const decisionId = db.insertDecision(decision);
      const retrieved = db.getDecision(decisionId);

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(decisionId);
      expect(retrieved.name).toBe(decision.name);
      expect(retrieved.proposal).toBe(decision.proposal);
      expect(retrieved.success_criteria).toBe(decision.success_criteria);
      expect(retrieved.deadline).toBe(decision.deadline);
      expect(retrieved.channel_id).toBe(decision.channel_id);
      expect(retrieved.creator_id).toBe(decision.creator_id);
      expect(retrieved.status).toBe('active');
    });

    it('should return undefined for non-existent decision', () => {
      const retrieved = db.getDecision(99999);
      expect(retrieved).toBeUndefined();
    });

    it('should update decision message timestamp', () => {
      const decision = {
        name: 'Test Decision',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        channel_id: 'C1234567890',
        creator_id: 'U1234567890'
      };

      const decisionId = db.insertDecision(decision);
      const messageTs = '1234567890.123456';

      db.updateDecisionMessage(decisionId, messageTs);

      const retrieved = db.getDecision(decisionId);
      expect(retrieved.message_ts).toBe(messageTs);
    });

    it('should update decision status', () => {
      const decision = {
        name: 'Test Decision',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        channel_id: 'C1234567890',
        creator_id: 'U1234567890'
      };

      const decisionId = db.insertDecision(decision);

      db.updateDecisionStatus(decisionId, 'approved');

      const retrieved = db.getDecision(decisionId);
      expect(retrieved.status).toBe('approved');
    });
  });

  describe('Voter Operations', () => {
    it('should insert voters for a decision', () => {
      const decision = {
        name: 'Test Decision',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        channel_id: 'C1234567890',
        creator_id: 'U1234567890'
      };

      const decisionId = db.insertDecision(decision);
      const voterIds = ['U1111111111', 'U2222222222', 'U3333333333'];

      db.insertVoters(decisionId, voterIds);

      const voters = db.getVoters(decisionId);
      expect(voters).toHaveLength(3);
      expect(voters[0].decision_id).toBe(decisionId);
      expect(voters[0].required).toBe(1);
    });

    it('should retrieve voters for a decision', () => {
      const decision = {
        name: 'Test Decision',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        channel_id: 'C1234567890',
        creator_id: 'U1234567890'
      };

      const decisionId = db.insertDecision(decision);
      const voterIds = ['U1111111111', 'U2222222222'];

      db.insertVoters(decisionId, voterIds);

      const voters = db.getVoters(decisionId);
      expect(voters).toHaveLength(2);

      const userIds = voters.map(v => v.user_id);
      expect(userIds).toContain('U1111111111');
      expect(userIds).toContain('U2222222222');
    });

    it('should return empty array for decision with no voters', () => {
      const decision = {
        name: 'Test Decision',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        channel_id: 'C1234567890',
        creator_id: 'U1234567890'
      };

      const decisionId = db.insertDecision(decision);
      const voters = db.getVoters(decisionId);

      expect(voters).toHaveLength(0);
    });
  });

  describe('Vote Operations', () => {
    it('should insert a vote', () => {
      const decision = {
        name: 'Test Decision',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        channel_id: 'C1234567890',
        creator_id: 'U1234567890'
      };

      const decisionId = db.insertDecision(decision);

      const vote = {
        decision_id: decisionId,
        user_id: 'U1111111111',
        vote_type: 'yes'
      };

      db.upsertVote(vote);

      const votes = db.getVotes(decisionId);
      expect(votes).toHaveLength(1);
      expect(votes[0].user_id).toBe('U1111111111');
      expect(votes[0].vote_type).toBe('yes');
    });

    it('should update an existing vote', () => {
      const decision = {
        name: 'Test Decision',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        channel_id: 'C1234567890',
        creator_id: 'U1234567890'
      };

      const decisionId = db.insertDecision(decision);

      // First vote
      db.upsertVote({
        decision_id: decisionId,
        user_id: 'U1111111111',
        vote_type: 'yes'
      });

      // Update vote
      db.upsertVote({
        decision_id: decisionId,
        user_id: 'U1111111111',
        vote_type: 'no'
      });

      const votes = db.getVotes(decisionId);
      expect(votes).toHaveLength(1);
      expect(votes[0].vote_type).toBe('no');
    });

    it('should store multiple votes for different users', () => {
      const decision = {
        name: 'Test Decision',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        channel_id: 'C1234567890',
        creator_id: 'U1234567890'
      };

      const decisionId = db.insertDecision(decision);

      db.upsertVote({
        decision_id: decisionId,
        user_id: 'U1111111111',
        vote_type: 'yes'
      });

      db.upsertVote({
        decision_id: decisionId,
        user_id: 'U2222222222',
        vote_type: 'no'
      });

      db.upsertVote({
        decision_id: decisionId,
        user_id: 'U3333333333',
        vote_type: 'abstain'
      });

      const votes = db.getVotes(decisionId);
      expect(votes).toHaveLength(3);

      const voteTypes = votes.reduce((acc, vote) => {
        acc[vote.user_id] = vote.vote_type;
        return acc;
      }, {});

      expect(voteTypes['U1111111111']).toBe('yes');
      expect(voteTypes['U2222222222']).toBe('no');
      expect(voteTypes['U3333333333']).toBe('abstain');
    });
  });
});
