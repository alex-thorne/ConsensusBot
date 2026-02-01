/**
 * Type definitions for Decision records
 *
 * Unified type definitions for decision data to ensure consistency
 * across datastores and utility functions.
 */

/**
 * Complete Decision Record from Datastore
 * This type represents the full decision object with all fields
 * that are stored in the datastore and used throughout the application.
 *
 * @property id - Unique identifier (message timestamp)
 * @property name - Decision name/title
 * @property proposal - Detailed description of the decision
 * @property success_criteria - Voting criteria: "simple_majority", "super_majority", or "unanimous"
 * @property deadline - ISO 8601 formatted deadline (e.g., "2026-02-15T23:59:59.000Z")
 * @property channel_id - Slack channel ID where decision was posted
 * @property creator_id - Slack user ID of decision creator
 * @property message_ts - Slack message timestamp
 * @property status - Decision status: "active", "approved", or "rejected"
 * @property created_at - ISO 8601 formatted creation timestamp
 * @property updated_at - ISO 8601 formatted last update timestamp
 */
export interface DecisionRecord {
  id: string;
  name: string;
  proposal: string;
  success_criteria: string;
  deadline: string;
  channel_id: string;
  creator_id: string;
  message_ts: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Decision Item type for API responses
 * This is compatible with both datastore queries and utility functions
 */
export type DecisionItem = DecisionRecord;

/**
 * Vote Record from Datastore
 */
export interface VoteRecord {
  id: string;
  decision_id: string;
  user_id: string;
  vote_type: "yes" | "no" | "abstain";
  voted_at: string;
}

/**
 * Voter Record from Datastore
 */
export interface VoterRecord {
  id: string;
  decision_id: string;
  user_id: string;
  required: boolean;
  created_at: string;
}
