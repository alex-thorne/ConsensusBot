-- ConsensusBot Database Schema
-- SQLite database for storing decisions, voters, and votes

-- Decisions table: stores all consensus decisions
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  proposal TEXT NOT NULL,
  success_criteria TEXT NOT NULL CHECK(success_criteria IN ('simple_majority', 'super_majority', 'unanimous')),
  deadline TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  message_ts TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'approved', 'rejected', 'expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Voters table: stores who is required to vote on each decision
CREATE TABLE IF NOT EXISTS voters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE,
  UNIQUE(decision_id, user_id)
);

-- Votes table: stores individual votes on decisions
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  vote_type TEXT NOT NULL CHECK(vote_type IN ('yes', 'no', 'abstain')),
  voted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE,
  UNIQUE(decision_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_channel ON decisions(channel_id);
CREATE INDEX IF NOT EXISTS idx_voters_decision ON voters(decision_id);
CREATE INDEX IF NOT EXISTS idx_votes_decision ON votes(decision_id);
