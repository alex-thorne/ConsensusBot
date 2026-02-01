/**
 * Logger Utility
 * 
 * Provides structured logging for the ConsensusBot application.
 * Handles different log levels and formats log messages consistently.
 */

const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

/**
 * Get the current log level from environment or default to INFO
 */
const getCurrentLogLevel = () => {
  const level = process.env.LOG_LEVEL || 'info';
  return level.toUpperCase();
};

/**
 * Check if a message should be logged based on current log level
 */
const shouldLog = (messageLevel) => {
  const levels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
  const currentLevel = getCurrentLogLevel();
  return levels.indexOf(messageLevel) <= levels.indexOf(currentLevel);
};

/**
 * Format log message with timestamp and level
 */
const formatMessage = (level, message, data = {}) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...data
  };
  return logEntry;
};

/**
 * Log error messages
 */
const error = (message, data = {}) => {
  if (shouldLog(LOG_LEVELS.ERROR)) {
    const formatted = formatMessage(LOG_LEVELS.ERROR, message, data);
    console.error(JSON.stringify(formatted));
  }
};

/**
 * Log warning messages
 */
const warn = (message, data = {}) => {
  if (shouldLog(LOG_LEVELS.WARN)) {
    const formatted = formatMessage(LOG_LEVELS.WARN, message, data);
    console.warn(JSON.stringify(formatted));
  }
};

/**
 * Log info messages
 */
const info = (message, data = {}) => {
  if (shouldLog(LOG_LEVELS.INFO)) {
    const formatted = formatMessage(LOG_LEVELS.INFO, message, data);
    console.log(JSON.stringify(formatted));
  }
};

/**
 * Log debug messages
 */
const debug = (message, data = {}) => {
  if (shouldLog(LOG_LEVELS.DEBUG)) {
    const formatted = formatMessage(LOG_LEVELS.DEBUG, message, data);
    console.log(JSON.stringify(formatted));
  }
};

module.exports = {
  error,
  warn,
  info,
  debug,
  LOG_LEVELS
};
