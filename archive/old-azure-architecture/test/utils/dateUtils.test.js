/**
 * Tests for Date Utilities
 */

const { addBusinessDays, getDefaultDeadline, formatDate } = require('../../src/utils/dateUtils');

describe('Date Utilities', () => {
  describe('addBusinessDays', () => {
    it('should add business days correctly', () => {
      // Start on a Monday (2026-02-02)
      const startDate = new Date('2026-02-02');
      const result = addBusinessDays(5, startDate);
      
      // 5 business days from Monday (M, T, W, Th, F) is the next Monday (2026-02-09)
      // This includes the weekend, so it's 7 calendar days total
      expect(result.getDay()).not.toBe(0); // Not Sunday
      expect(result.getDay()).not.toBe(6); // Not Saturday
    });

    it('should skip weekends', () => {
      // Start on a Friday (2026-02-06)
      const startDate = new Date('2026-02-06');
      const result = addBusinessDays(1, startDate);
      
      // 1 business day from Friday should be Monday
      expect(result.getDay()).toBe(1); // Monday
    });

    it('should handle multiple weeks', () => {
      const startDate = new Date('2026-02-02');
      const result = addBusinessDays(10, startDate);
      
      // Result should not be a weekend
      expect(result.getDay()).not.toBe(0);
      expect(result.getDay()).not.toBe(6);
    });
  });

  describe('getDefaultDeadline', () => {
    it('should return a date string in YYYY-MM-DD format', () => {
      const deadline = getDefaultDeadline();
      
      // Check format using regex
      expect(deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return a future date', () => {
      const deadline = getDefaultDeadline();
      const deadlineDate = new Date(deadline);
      const today = new Date();
      
      expect(deadlineDate > today).toBe(true);
    });
  });

  describe('formatDate', () => {
    it('should format Date object to YYYY-MM-DD', () => {
      const date = new Date('2026-02-15');
      const formatted = formatDate(date);
      
      expect(formatted).toBe('2026-02-15');
    });

    it('should format date string to YYYY-MM-DD', () => {
      const formatted = formatDate('2026-02-15');
      
      expect(formatted).toBe('2026-02-15');
    });
  });
});
