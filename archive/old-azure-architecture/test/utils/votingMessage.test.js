/**
 * Tests for Voting Message Builder
 */

const { createVotingMessage, formatSuccessCriteria, formatDeadline } = require('../../src/utils/votingMessage');

describe('Voting Message Builder', () => {
  describe('createVotingMessage', () => {
    it('should create a valid voting message structure', () => {
      const decision = {
        id: 1,
        name: 'Test Decision',
        proposal: 'This is a test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        creator_id: 'U1234567890'
      };
      const voterIds = ['U1111111111', 'U2222222222'];

      const message = createVotingMessage(decision, voterIds);

      expect(message).toBeDefined();
      expect(message.blocks).toBeDefined();
      expect(message.text).toBeDefined();
    });

    it('should include decision name in header', () => {
      const decision = {
        id: 1,
        name: 'Choose Framework',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        creator_id: 'U1234567890'
      };
      const voterIds = ['U1111111111'];

      const message = createVotingMessage(decision, voterIds);
      const headerBlock = message.blocks.find(b => b.type === 'header');

      expect(headerBlock).toBeDefined();
      expect(headerBlock.text.text).toContain('Choose Framework');
    });

    it('should include proposal in message', () => {
      const decision = {
        id: 1,
        name: 'Test Decision',
        proposal: 'We should use React for our frontend',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        creator_id: 'U1234567890'
      };
      const voterIds = ['U1111111111'];

      const message = createVotingMessage(decision, voterIds);
      const proposalBlock = message.blocks.find(b => 
        b.type === 'section' && b.text && b.text.text.includes('Proposal')
      );

      expect(proposalBlock).toBeDefined();
      expect(proposalBlock.text.text).toContain('We should use React for our frontend');
    });

    it('should include voting buttons', () => {
      const decision = {
        id: 1,
        name: 'Test Decision',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        creator_id: 'U1234567890'
      };
      const voterIds = ['U1111111111'];

      const message = createVotingMessage(decision, voterIds);
      const actionsBlock = message.blocks.find(b => b.type === 'actions');

      expect(actionsBlock).toBeDefined();
      expect(actionsBlock.elements).toHaveLength(3);

      const yesButton = actionsBlock.elements.find(e => e.action_id.includes('vote_yes'));
      const noButton = actionsBlock.elements.find(e => e.action_id.includes('vote_no'));
      const abstainButton = actionsBlock.elements.find(e => e.action_id.includes('vote_abstain'));

      expect(yesButton).toBeDefined();
      expect(noButton).toBeDefined();
      expect(abstainButton).toBeDefined();
    });

    it('should include voter mentions', () => {
      const decision = {
        id: 1,
        name: 'Test Decision',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-15',
        creator_id: 'U1234567890'
      };
      const voterIds = ['U1111111111', 'U2222222222'];

      const message = createVotingMessage(decision, voterIds);
      const votersBlock = message.blocks.find(b => 
        b.type === 'section' && b.text && b.text.text.includes('Required Voters')
      );

      expect(votersBlock).toBeDefined();
      expect(votersBlock.text.text).toContain('<@U1111111111>');
      expect(votersBlock.text.text).toContain('<@U2222222222>');
    });
  });

  describe('formatSuccessCriteria', () => {
    it('should format simple_majority correctly', () => {
      const formatted = formatSuccessCriteria('simple_majority');
      expect(formatted).toBe('Simple Majority (50%+1)');
    });

    it('should format super_majority correctly', () => {
      const formatted = formatSuccessCriteria('super_majority');
      expect(formatted).toBe('Supermajority (75%)');
    });

    it('should format unanimous correctly', () => {
      const formatted = formatSuccessCriteria('unanimous');
      expect(formatted).toBe('Unanimity (100%)');
    });
  });

  describe('formatDeadline', () => {
    it('should format deadline date', () => {
      const formatted = formatDeadline('2026-02-15');
      
      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should include day of week', () => {
      const formatted = formatDeadline('2026-02-15');
      
      // Should include a weekday name
      const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const hasWeekday = weekdays.some(day => formatted.includes(day));
      
      expect(hasWeekday).toBe(true);
    });
  });
});
