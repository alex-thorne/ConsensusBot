/**
 * Date Utility Functions for Slack ROSI
 * 
 * Provides date-related utilities for consensus decisions
 */

/**
 * Calculate a date N business days from now
 * @param days - Number of business days
 * @param startDate - Starting date (defaults to today)
 * @returns The calculated date
 */
export const addBusinessDays = (days: number, startDate: Date = new Date()): Date => {
  const result = new Date(startDate.getTime());
  let daysAdded = 0;
  
  while (daysAdded < days) {
    result.setDate(result.getDate() + 1);
    
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (result.getDay() !== 0 && result.getDay() !== 6) {
      daysAdded++;
    }
  }
  
  return result;
};

/**
 * Get default deadline (5 business days from now)
 * @returns Date in YYYY-MM-DD format
 */
export const getDefaultDeadline = (): string => {
  const deadline = addBusinessDays(5);
  return deadline.toISOString().split('T')[0];
};

/**
 * Format date to YYYY-MM-DD
 * @param date - Date to format
 * @returns Formatted date
 */
export const formatDate = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
};

/**
 * Check if a deadline has passed
 * @param deadline - Deadline date string
 * @returns Whether the deadline has passed
 */
export const isDeadlinePassed = (deadline: string): boolean => {
  const deadlineDate = new Date(deadline);
  const now = new Date();
  return deadlineDate < now;
};
