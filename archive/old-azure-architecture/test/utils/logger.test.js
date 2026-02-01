/**
 * Tests for the Logger Utility
 * 
 * Tests logging functionality including:
 * - Log levels
 * - Message formatting
 * - Structured logging
 */

const logger = require('../../src/utils/logger');

// Mock console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

describe('Logger Utility', () => {
  let consoleOutput = [];

  beforeEach(() => {
    consoleOutput = [];
    
    // Mock console methods to capture output
    console.log = jest.fn((msg) => consoleOutput.push({ level: 'log', msg }));
    console.error = jest.fn((msg) => consoleOutput.push({ level: 'error', msg }));
    console.warn = jest.fn((msg) => consoleOutput.push({ level: 'warn', msg }));
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  describe('Log Levels', () => {
    it('should export LOG_LEVELS constants', () => {
      expect(logger.LOG_LEVELS).toBeDefined();
      expect(logger.LOG_LEVELS.ERROR).toBe('ERROR');
      expect(logger.LOG_LEVELS.WARN).toBe('WARN');
      expect(logger.LOG_LEVELS.INFO).toBe('INFO');
      expect(logger.LOG_LEVELS.DEBUG).toBe('DEBUG');
    });
  });

  describe('Error Logging', () => {
    it('should log error messages', () => {
      logger.error('Test error message');
      
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(consoleOutput).toHaveLength(1);
      
      const logEntry = JSON.parse(consoleOutput[0].msg);
      expect(logEntry.level).toBe('ERROR');
      expect(logEntry.message).toBe('Test error message');
      expect(logEntry.timestamp).toBeDefined();
    });

    it('should log error messages with additional data', () => {
      logger.error('Test error', { userId: '123', code: 'ERR001' });
      
      const logEntry = JSON.parse(consoleOutput[0].msg);
      expect(logEntry.level).toBe('ERROR');
      expect(logEntry.message).toBe('Test error');
      expect(logEntry.userId).toBe('123');
      expect(logEntry.code).toBe('ERR001');
    });
  });

  describe('Warning Logging', () => {
    it('should log warning messages', () => {
      logger.warn('Test warning message');
      
      expect(console.warn).toHaveBeenCalledTimes(1);
      
      const logEntry = JSON.parse(consoleOutput[0].msg);
      expect(logEntry.level).toBe('WARN');
      expect(logEntry.message).toBe('Test warning message');
    });

    it('should log warning messages with additional data', () => {
      logger.warn('Test warning', { retries: 3 });
      
      const logEntry = JSON.parse(consoleOutput[0].msg);
      expect(logEntry.retries).toBe(3);
    });
  });

  describe('Info Logging', () => {
    it('should log info messages', () => {
      logger.info('Test info message');
      
      expect(console.log).toHaveBeenCalledTimes(1);
      
      const logEntry = JSON.parse(consoleOutput[0].msg);
      expect(logEntry.level).toBe('INFO');
      expect(logEntry.message).toBe('Test info message');
    });

    it('should log info messages with additional data', () => {
      logger.info('User logged in', { userId: 'U123', channel: 'C456' });
      
      const logEntry = JSON.parse(consoleOutput[0].msg);
      expect(logEntry.userId).toBe('U123');
      expect(logEntry.channel).toBe('C456');
    });
  });

  describe('Debug Logging', () => {
    it('should log debug messages when LOG_LEVEL allows', () => {
      // Set log level to DEBUG
      process.env.LOG_LEVEL = 'debug';
      
      logger.debug('Test debug message');
      
      expect(console.log).toHaveBeenCalled();
      
      const logEntry = JSON.parse(consoleOutput[0].msg);
      expect(logEntry.level).toBe('DEBUG');
      expect(logEntry.message).toBe('Test debug message');
      
      // Clean up
      delete process.env.LOG_LEVEL;
    });
  });

  describe('Message Formatting', () => {
    it('should include timestamp in all log entries', () => {
      logger.info('Test message');
      
      const logEntry = JSON.parse(consoleOutput[0].msg);
      expect(logEntry.timestamp).toBeDefined();
      expect(new Date(logEntry.timestamp)).toBeInstanceOf(Date);
    });

    it('should format log entries as JSON', () => {
      logger.info('Test message', { key: 'value' });
      
      const logMessage = consoleOutput[0].msg;
      expect(() => JSON.parse(logMessage)).not.toThrow();
      
      const logEntry = JSON.parse(logMessage);
      expect(logEntry.timestamp).toBeDefined();
      expect(logEntry.level).toBe('INFO');
      expect(logEntry.message).toBe('Test message');
      expect(logEntry.key).toBe('value');
    });

    it('should merge additional data into log entry', () => {
      const additionalData = {
        userId: 'U123',
        action: 'click',
        timestamp_custom: '2024-01-01'
      };
      
      logger.info('User action', additionalData);
      
      const logEntry = JSON.parse(consoleOutput[0].msg);
      expect(logEntry.userId).toBe('U123');
      expect(logEntry.action).toBe('click');
      expect(logEntry.timestamp_custom).toBe('2024-01-01');
    });
  });
});
