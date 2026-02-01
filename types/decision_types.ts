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
  vote_type: 'yes' | 'no' | 'abstain';
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
