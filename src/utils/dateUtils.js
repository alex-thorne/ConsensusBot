/**
 * Date Utility Functions
 * 
 * Provides date-related utilities for consensus decisions
 */

/**
 * Calculate a date N business days from now
 * @param {number} days - Number of business days
 * @param {Date} startDate - Starting date (defaults to today)
 * @returns {Date} The calculated date
 */
const addBusinessDays = (days, startDate = new Date()) => {
  const result = new Date(startDate);
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
 * @returns {string} Date in YYYY-MM-DD format
 */
const getDefaultDeadline = () => {
  const deadline = addBusinessDays(5);
  return deadline.toISOString().split('T')[0];
};

/**
 * Format date to YYYY-MM-DD
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date
 */
const formatDate = (date) => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
};

module.exports = {
  addBusinessDays,
  getDefaultDeadline,
  formatDate
};
