/**
 * Tests for Reminder System (Nudger)
 */

const {
  getDecisionsNeedingVotes,
  sendVoterReminder,
  sendRemindersForDecision,
  runNudger
} = require('../../src/utils/reminder');

const db = require('../../src/database/db');

// Mock the database module
jest.mock('../../src/database/db');

// Mock logger to avoid console output during tests
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('Reminder System (Nudger)', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('getDecisionsNeedingVotes', () => {
    
    test('should return empty array when no open decisions exist', () => {
      db.getOpenDecisions.mockReturnValue([]);
      
      const result = getDecisionsNeedingVotes();
      
      expect(result).toEqual([]);
      expect(db.getOpenDecisions).toHaveBeenCalledTimes(1);
    });
    
    test('should return empty array when all voters have voted', () => {
      const mockDecisions = [
        {
          id: 1,
          name: 'Test Decision',
          status: 'active',
          deadline: '2026-02-15'
        }
      ];
      
      db.getOpenDecisions.mockReturnValue(mockDecisions);
      db.getVoters.mockReturnValue([
        { user_id: 'U1', decision_id: 1 },
        { user_id: 'U2', decision_id: 1 }
      ]);
      db.getVotes.mockReturnValue([
        { user_id: 'U1', vote_type: 'yes' },
        { user_id: 'U2', vote_type: 'yes' }
      ]);
      db.getMissingVoters.mockReturnValue([]);
      
      const result = getDecisionsNeedingVotes();
      
      expect(result).toEqual([]);
    });
    
    test('should return decisions with missing voters', () => {
      const mockDecisions = [
        {
          id: 1,
          name: 'Test Decision',
          status: 'active',
          deadline: '2026-02-15',
          proposal: 'Test proposal'
        }
      ];
      
      const mockVoters = [
        { user_id: 'U1', decision_id: 1 },
        { user_id: 'U2', decision_id: 1 },
        { user_id: 'U3', decision_id: 1 }
      ];
      
      const mockVotes = [
        { user_id: 'U1', vote_type: 'yes' }
      ];
      
      const mockMissingVoters = [
        { user_id: 'U2', decision_id: 1 },
        { user_id: 'U3', decision_id: 1 }
      ];
      
      db.getOpenDecisions.mockReturnValue(mockDecisions);
      db.getVoters.mockReturnValue(mockVoters);
      db.getVotes.mockReturnValue(mockVotes);
      db.getMissingVoters.mockReturnValue(mockMissingVoters);
      
      const result = getDecisionsNeedingVotes();
      
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 1,
        name: 'Test Decision',
        requiredVotersCount: 3,
        actualVotesCount: 1,
        missingVotersCount: 2
      });
      expect(result[0].missingVoters).toEqual(mockMissingVoters);
    });
    
    test('should handle multiple decisions with varying vote status', () => {
      const mockDecisions = [
        { id: 1, name: 'Decision 1', status: 'active' },
        { id: 2, name: 'Decision 2', status: 'active' },
        { id: 3, name: 'Decision 3', status: 'active' }
      ];
      
      db.getOpenDecisions.mockReturnValue(mockDecisions);
      
      // Decision 1: has missing voters
      db.getVoters.mockReturnValueOnce([{ user_id: 'U1' }, { user_id: 'U2' }]);
      db.getVotes.mockReturnValueOnce([{ user_id: 'U1' }]);
      db.getMissingVoters.mockReturnValueOnce([{ user_id: 'U2' }]);
      
      // Decision 2: all voted
      db.getVoters.mockReturnValueOnce([{ user_id: 'U3' }]);
      db.getVotes.mockReturnValueOnce([{ user_id: 'U3' }]);
      db.getMissingVoters.mockReturnValueOnce([]);
      
      // Decision 3: has missing voters
      db.getVoters.mockReturnValueOnce([{ user_id: 'U4' }, { user_id: 'U5' }]);
      db.getVotes.mockReturnValueOnce([]);
      db.getMissingVoters.mockReturnValueOnce([{ user_id: 'U4' }, { user_id: 'U5' }]);
      
      const result = getDecisionsNeedingVotes();
      
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(3);
    });
    
    test('should handle database errors gracefully', () => {
      db.getOpenDecisions.mockImplementation(() => {
        throw new Error('Database error');
      });
      
      const result = getDecisionsNeedingVotes();
      
      expect(result).toEqual([]);
    });
  });
  
  describe('sendVoterReminder', () => {
    
    let mockSlackClient;
    
    beforeEach(() => {
      mockSlackClient = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({ ok: true })
        }
      };
    });
    
    test('should send reminder DM successfully', async () => {
      const decision = {
        id: 1,
        name: 'Test Decision',
        proposal: 'This is a test proposal',
        deadline: '2026-02-15',
        creator_id: 'U_CREATOR',
        channel_id: 'C123456',
        message_ts: '1234567890.123456'
      };
      
      const userId = 'U_VOTER';
      const messageUrl = 'https://slack.com/archives/C123456/p1234567890123456';
      
      const result = await sendVoterReminder(mockSlackClient, userId, decision, messageUrl);
      
      expect(result).toBe(true);
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledTimes(1);
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: userId,
          text: expect.stringContaining('Test Decision'),
          blocks: expect.any(Array)
        })
      );
      
      const callArgs = mockSlackClient.chat.postMessage.mock.calls[0][0];
      expect(callArgs.blocks).toHaveLength(5);
      expect(callArgs.blocks[1].text.text).toContain('Test Decision');
    });
    
    test('should format deadline urgency correctly for tomorrow', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const decision = {
        id: 1,
        name: 'Urgent Decision',
        proposal: 'Test',
        deadline: tomorrow.toISOString().split('T')[0],
        creator_id: 'U1',
        channel_id: 'C1',
        message_ts: '123.456'
      };
      
      await sendVoterReminder(mockSlackClient, 'U_VOTER', decision, 'http://url');
      
      const callArgs = mockSlackClient.chat.postMessage.mock.calls[0][0];
      const deadlineBlock = callArgs.blocks.find(b => b.text && b.text.text.includes('Deadline'));
      
      expect(deadlineBlock.text.text).toContain('Tomorrow');
    });
    
    test('should format deadline urgency for past deadline', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const decision = {
        id: 1,
        name: 'Overdue Decision',
        proposal: 'Test',
        deadline: yesterday.toISOString().split('T')[0],
        creator_id: 'U1',
        channel_id: 'C1',
        message_ts: '123.456'
      };
      
      await sendVoterReminder(mockSlackClient, 'U_VOTER', decision, 'http://url');
      
      const callArgs = mockSlackClient.chat.postMessage.mock.calls[0][0];
      const deadlineBlock = callArgs.blocks.find(b => b.text && b.text.text.includes('deadline'));
      
      expect(deadlineBlock.text.text).toContain('passed');
    });
    
    test('should handle Slack API errors gracefully', async () => {
      mockSlackClient.chat.postMessage.mockRejectedValue(new Error('Slack error'));
      
      const decision = {
        id: 1,
        name: 'Test',
        proposal: 'Test',
        deadline: '2026-02-15',
        creator_id: 'U1'
      };
      
      const result = await sendVoterReminder(mockSlackClient, 'U_VOTER', decision, 'http://url');
      
      expect(result).toBe(false);
    });
    
    test('should truncate long proposals in reminder', async () => {
      const longProposal = 'A'.repeat(300);
      const decision = {
        id: 1,
        name: 'Test',
        proposal: longProposal,
        deadline: '2026-02-15',
        creator_id: 'U1',
        channel_id: 'C1',
        message_ts: '123.456'
      };
      
      await sendVoterReminder(mockSlackClient, 'U_VOTER', decision, 'http://url');
      
      const callArgs = mockSlackClient.chat.postMessage.mock.calls[0][0];
      const proposalText = callArgs.blocks[1].text.text;
      
      expect(proposalText.length).toBeLessThan(longProposal.length + 100);
      expect(proposalText).toContain('...');
    });
  });
  
  describe('sendRemindersForDecision', () => {
    
    let mockSlackClient;
    
    beforeEach(() => {
      mockSlackClient = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({ ok: true })
        }
      };
    });
    
    test('should send reminders to all missing voters', async () => {
      const decision = {
        id: 1,
        name: 'Test Decision',
        proposal: 'Test proposal',
        status: 'active',
        deadline: '2026-02-15',
        creator_id: 'U_CREATOR',
        channel_id: 'C123',
        message_ts: '123.456'
      };
      
      const missingVoters = [
        { user_id: 'U1', decision_id: 1 },
        { user_id: 'U2', decision_id: 1 },
        { user_id: 'U3', decision_id: 1 }
      ];
      
      db.getDecision.mockReturnValue(decision);
      db.getMissingVoters.mockReturnValue(missingVoters);
      
      const result = await sendRemindersForDecision(mockSlackClient, 1);
      
      expect(result.success).toBe(true);
      expect(result.totalMissing).toBe(3);
      expect(result.remindersSent).toBe(3);
      expect(result.failed).toBe(0);
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledTimes(3);
    });
    
    test('should return success with 0 reminders when no missing voters', async () => {
      const decision = {
        id: 1,
        status: 'active',
        name: 'Test'
      };
      
      db.getDecision.mockReturnValue(decision);
      db.getMissingVoters.mockReturnValue([]);
      
      const result = await sendRemindersForDecision(mockSlackClient, 1);
      
      expect(result.success).toBe(true);
      expect(result.remindersSent).toBe(0);
      expect(mockSlackClient.chat.postMessage).not.toHaveBeenCalled();
    });
    
    test('should handle partial failures gracefully', async () => {
      const decision = {
        id: 1,
        name: 'Test',
        proposal: 'Test',
        status: 'active',
        deadline: '2026-02-15',
        creator_id: 'U1',
        channel_id: 'C1',
        message_ts: '123.456'
      };
      
      const missingVoters = [
        { user_id: 'U1', decision_id: 1 },
        { user_id: 'U2', decision_id: 1 }
      ];
      
      db.getDecision.mockReturnValue(decision);
      db.getMissingVoters.mockReturnValue(missingVoters);
      
      // First call succeeds, second fails
      mockSlackClient.chat.postMessage
        .mockResolvedValueOnce({ ok: true })
        .mockRejectedValueOnce(new Error('Slack error'));
      
      const result = await sendRemindersForDecision(mockSlackClient, 1);
      
      expect(result.success).toBe(true);
      expect(result.remindersSent).toBe(1);
      expect(result.failed).toBe(1);
    });
    
    test('should not send reminders for non-active decisions', async () => {
      const decision = {
        id: 1,
        status: 'approved',
        name: 'Test'
      };
      
      db.getDecision.mockReturnValue(decision);
      
      const result = await sendRemindersForDecision(mockSlackClient, 1);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not active');
      expect(mockSlackClient.chat.postMessage).not.toHaveBeenCalled();
    });
    
    test('should return error when decision not found', async () => {
      db.getDecision.mockReturnValue(null);
      
      const result = await sendRemindersForDecision(mockSlackClient, 999);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
  
  describe('runNudger', () => {
    
    let mockSlackClient;
    
    beforeEach(() => {
      mockSlackClient = {
        chat: {
          postMessage: jest.fn().mockResolvedValue({ ok: true })
        }
      };
    });
    
    test('should process all decisions needing reminders', async () => {
      const mockDecisions = [
        {
          id: 1,
          name: 'Decision 1',
          proposal: 'Test 1',
          status: 'active',
          deadline: '2026-02-15',
          creator_id: 'U1',
          channel_id: 'C1',
          message_ts: '123.456',
          missingVoters: [{ user_id: 'U2' }]
        },
        {
          id: 2,
          name: 'Decision 2',
          proposal: 'Test 2',
          status: 'active',
          deadline: '2026-02-16',
          creator_id: 'U1',
          channel_id: 'C1',
          message_ts: '123.457',
          missingVoters: [{ user_id: 'U3' }, { user_id: 'U4' }]
        }
      ];
      
      db.getOpenDecisions.mockReturnValue(mockDecisions);
      
      // First call for Decision 1 in getDecisionsNeedingVotes
      db.getVoters.mockReturnValueOnce([{ user_id: 'U2' }]);
      db.getVotes.mockReturnValueOnce([]);
      db.getMissingVoters.mockReturnValueOnce([{ user_id: 'U2' }]);
      
      // Second call for Decision 2 in getDecisionsNeedingVotes
      db.getVoters.mockReturnValueOnce([{ user_id: 'U3' }, { user_id: 'U4' }]);
      db.getVotes.mockReturnValueOnce([]);
      db.getMissingVoters.mockReturnValueOnce([{ user_id: 'U3' }, { user_id: 'U4' }]);
      
      // Calls for sendRemindersForDecision
      db.getDecision
        .mockReturnValueOnce(mockDecisions[0])
        .mockReturnValueOnce(mockDecisions[1]);
      
      db.getMissingVoters
        .mockReturnValueOnce([{ user_id: 'U2' }])
        .mockReturnValueOnce([{ user_id: 'U3' }, { user_id: 'U4' }]);
      
      const result = await runNudger(mockSlackClient);
      
      expect(result.success).toBe(true);
      expect(result.decisionsProcessed).toBe(2);
      expect(result.totalRemindersSent).toBe(3);
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledTimes(3);
    });
    
    test('should return success with 0 processed when no decisions need votes', async () => {
      db.getOpenDecisions.mockReturnValue([]);
      
      const result = await runNudger(mockSlackClient);
      
      expect(result.success).toBe(true);
      expect(result.decisionsProcessed).toBe(0);
      expect(result.totalRemindersSent).toBe(0);
      expect(mockSlackClient.chat.postMessage).not.toHaveBeenCalled();
    });
    
    test('should handle errors in getDecisionsNeedingVotes gracefully', async () => {
      db.getOpenDecisions.mockImplementation(() => {
        throw new Error('Database error');
      });
      
      const result = await runNudger(mockSlackClient);
      
      // When getDecisionsNeedingVotes catches an error, it returns []
      // So runNudger succeeds with 0 decisions processed
      expect(result.success).toBe(true);
      expect(result.decisionsProcessed).toBe(0);
      expect(result.totalRemindersSent).toBe(0);
    });
  });
});
