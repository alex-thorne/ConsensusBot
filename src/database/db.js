/**
 * Database Module
 * 
 * Manages database connections and provides functions for
 * persisting and retrieving consensus decisions, voters, and votes.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// Initialize database connection
let db;

/**
 * Get database path
 * @returns {string} Database file path
 */
const getDBPath = () => {
  return process.env.DATABASE_PATH || path.join(__dirname, '../../data/consensus.db');
};

/**
 * Ensure data directory exists
 */
const ensureDataDirectory = () => {
  const DB_PATH = getDBPath();
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    logger.info('Created data directory', { path: dataDir });
  }
};

/**
 * Get database connection
 * @returns {Database} SQLite database instance
 */
const getDatabase = () => {
  if (!db) {
    ensureDataDirectory();
    const DB_PATH = getDBPath();
    db = new Database(DB_PATH, { verbose: logger.debug });
    logger.info('Database connection established', { path: DB_PATH });
    
    // Initialize schema
    initializeSchema();
  }
  return db;
};

/**
 * Initialize database schema
 */
const initializeSchema = () => {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  
  // Execute schema statements
  db.exec(schema);
  logger.info('Database schema initialized');
};

/**
 * Insert a new decision into the database
 * @param {object} decision - Decision data
 * @returns {number} ID of the inserted decision
 */
const insertDecision = (decision) => {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    INSERT INTO decisions (name, proposal, success_criteria, deadline, channel_id, creator_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    decision.name,
    decision.proposal,
    decision.success_criteria,
    decision.deadline,
    decision.channel_id,
    decision.creator_id
  );
  
  logger.info('Decision inserted', { 
    decisionId: result.lastInsertRowid,
    name: decision.name 
  });
  
  return result.lastInsertRowid;
};

/**
 * Insert voters for a decision
 * @param {number} decisionId - Decision ID
 * @param {Array<string>} userIds - Array of user IDs
 */
const insertVoters = (decisionId, userIds) => {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    INSERT INTO voters (decision_id, user_id, required)
    VALUES (?, ?, 1)
  `);
  
  const insertMany = db.transaction((voters) => {
    for (const userId of voters) {
      stmt.run(decisionId, userId);
    }
  });
  
  insertMany(userIds);
  
  logger.info('Voters inserted', { 
    decisionId, 
    count: userIds.length 
  });
};

/**
 * Get a decision by ID
 * @param {number} decisionId - Decision ID
 * @returns {object|null} Decision object or null if not found
 */
const getDecision = (decisionId) => {
  const db = getDatabase();
  
  const stmt = db.prepare('SELECT * FROM decisions WHERE id = ?');
  const decision = stmt.get(decisionId);
  
  if (decision) {
    logger.debug('Decision retrieved', { decisionId });
  }
  
  return decision;
};

/**
 * Get voters for a decision
 * @param {number} decisionId - Decision ID
 * @returns {Array<object>} Array of voter objects
 */
const getVoters = (decisionId) => {
  const db = getDatabase();
  
  const stmt = db.prepare('SELECT * FROM voters WHERE decision_id = ?');
  const voters = stmt.all(decisionId);
  
  logger.debug('Voters retrieved', { 
    decisionId, 
    count: voters.length 
  });
  
  return voters;
};

/**
 * Insert or update a vote
 * @param {object} vote - Vote data
 */
const upsertVote = (vote) => {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    INSERT INTO votes (decision_id, user_id, vote_type)
    VALUES (?, ?, ?)
    ON CONFLICT(decision_id, user_id) 
    DO UPDATE SET vote_type = excluded.vote_type, voted_at = datetime('now')
  `);
  
  stmt.run(vote.decision_id, vote.user_id, vote.vote_type);
  
  logger.info('Vote recorded', {
    decisionId: vote.decision_id,
    userId: vote.user_id,
    voteType: vote.vote_type
  });
};

/**
 * Get votes for a decision
 * @param {number} decisionId - Decision ID
 * @returns {Array<object>} Array of vote objects
 */
const getVotes = (decisionId) => {
  const db = getDatabase();
  
  const stmt = db.prepare('SELECT * FROM votes WHERE decision_id = ?');
  const votes = stmt.all(decisionId);
  
  logger.debug('Votes retrieved', { 
    decisionId, 
    count: votes.length 
  });
  
  return votes;
};

/**
 * Update decision message timestamp
 * @param {number} decisionId - Decision ID
 * @param {string} messageTs - Slack message timestamp
 */
const updateDecisionMessage = (decisionId, messageTs) => {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    UPDATE decisions 
    SET message_ts = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  
  stmt.run(messageTs, decisionId);
  
  logger.info('Decision message timestamp updated', {
    decisionId,
    messageTs
  });
};

/**
 * Update decision status
 * @param {number} decisionId - Decision ID
 * @param {string} status - New status
 */
const updateDecisionStatus = (decisionId, status) => {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    UPDATE decisions 
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  
  stmt.run(status, decisionId);
  
  logger.info('Decision status updated', {
    decisionId,
    status
  });
};

/**
 * Get all open decisions
 * @returns {Array<object>} Array of open decisions
 */
const getOpenDecisions = () => {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT * FROM decisions 
    WHERE status = 'active' 
    ORDER BY deadline ASC
  `);
  const decisions = stmt.all();
  
  logger.debug('Open decisions retrieved', { count: decisions.length });
  
  return decisions;
};

/**
 * Get missing voters for a decision
 * Returns voters who haven't cast their vote yet
 * @param {number} decisionId - Decision ID
 * @returns {Array<object>} Array of voters who haven't voted
 */
const getMissingVoters = (decisionId) => {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT v.* 
    FROM voters v
    LEFT JOIN votes vt ON v.decision_id = vt.decision_id AND v.user_id = vt.user_id
    WHERE v.decision_id = ? AND vt.id IS NULL
  `);
  
  const missingVoters = stmt.all(decisionId);
  
  logger.debug('Missing voters retrieved', { 
    decisionId, 
    count: missingVoters.length 
  });
  
  return missingVoters;
};

/**
 * Get vote summary for a decision
 * @param {number} decisionId - Decision ID
 * @returns {object} Vote summary with counts and percentages
 */
const getVoteSummary = (decisionId) => {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT 
      COUNT(*) as total_votes,
      SUM(CASE WHEN vote_type = 'yes' THEN 1 ELSE 0 END) as yes_votes,
      SUM(CASE WHEN vote_type = 'no' THEN 1 ELSE 0 END) as no_votes,
      SUM(CASE WHEN vote_type = 'abstain' THEN 1 ELSE 0 END) as abstain_votes
    FROM votes
    WHERE decision_id = ?
  `);
  
  const summary = stmt.get(decisionId);
  
  logger.debug('Vote summary retrieved', { decisionId, summary });
  
  return summary;
};

/**
 * Check if user is eligible to vote on a decision
 * @param {number} decisionId - Decision ID
 * @param {string} userId - User ID to check
 * @returns {boolean} True if user is eligible
 */
const isUserEligibleToVote = (decisionId, userId) => {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM voters
    WHERE decision_id = ? AND user_id = ?
  `);
  
  const result = stmt.get(decisionId, userId);
  const isEligible = result.count > 0;
  
  logger.debug('User eligibility checked', { 
    decisionId, 
    userId, 
    isEligible 
  });
  
  return isEligible;
};

/**
 * Get decision with vote counts and voter information
 * @param {number} decisionId - Decision ID
 * @returns {object} Decision with additional vote statistics
 */
const getDecisionWithStats = (decisionId) => {
  const decision = getDecision(decisionId);
  if (!decision) {
    return null;
  }

  const voters = getVoters(decisionId);
  const votes = getVotes(decisionId);
  const voteSummary = getVoteSummary(decisionId);
  const missingVoters = getMissingVoters(decisionId);

  return {
    ...decision,
    requiredVotersCount: voters.length,
    voteSummary,
    missingVotersCount: missingVoters.length,
    voters,
    votes
  };
};

/**
 * Close database connection
 */
const closeDatabase = () => {
  if (db) {
    db.close();
    logger.info('Database connection closed');
    db = null;
  }
};

module.exports = {
  getDatabase,
  insertDecision,
  insertVoters,
  getDecision,
  getVoters,
  upsertVote,
  getVotes,
  updateDecisionMessage,
  updateDecisionStatus,
  getOpenDecisions,
  getMissingVoters,
  getVoteSummary,
  isUserEligibleToVote,
  getDecisionWithStats,
  closeDatabase
};
