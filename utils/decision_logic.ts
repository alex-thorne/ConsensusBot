/**
 * Decision Outcome Logic Module for Slack ROSI
 *
 * Implements calculation logic for determining decision outcomes based on
 * success criteria (Simple Majority, Supermajority, Unanimity).
 */

import { VoteRecord } from "../types/decision_types.ts";

// Re-export for backward compatibility
export type Vote = VoteRecord;

export interface VoteCounts {
  yes: number;
  no: number;
  abstain: number;
  total: number;
}

export interface DecisionResult {
  passed: boolean;
  reason: string;
  voteCounts: VoteCounts;
  percentage: number;
  requiredVotersCount?: number;
  missingVotes?: number;
  quorum?: number;
  quorumMet?: boolean;
  error?: boolean;
}

export interface DeadlockResult {
  isDeadlocked: boolean;
  reason: string;
  voteCounts: VoteCounts;
  remainingVotes: number;
}

/**
 * Calculate vote counts for a decision
 * @param votes - Array of vote objects
 * @returns Vote counts by type
 */
export const calculateVoteCounts = (votes: Vote[]): VoteCounts => {
  const counts: VoteCounts = {
    yes: 0,
    no: 0,
    abstain: 0,
    total: votes.length,
  };

  for (const vote of votes) {
    if (vote.vote_type === "yes") {
      counts.yes++;
    } else if (vote.vote_type === "no") {
      counts.no++;
    } else if (vote.vote_type === "abstain") {
      counts.abstain++;
    }
  }

  return counts;
};

/**
 * Calculate simple majority result
 * Simple Majority: votes_yes > 50% of total votes
 *
 * @param voteCounts - Vote counts object
 * @returns Result object with status and details
 */
export const calculateSimpleMajority = (
  voteCounts: VoteCounts,
): DecisionResult => {
  const { yes, total } = voteCounts;

  // Edge case: no votes cast
  if (total === 0) {
    return {
      passed: false,
      reason: "No votes have been cast",
      voteCounts,
      percentage: 0,
    };
  }

  // Calculate percentage (yes votes / total votes)
  const percentage = (yes / total) * 100;
  const passed = percentage > 50;

  return {
    passed,
    reason: passed
      ? `Simple majority achieved with ${percentage.toFixed(2)}% yes votes`
      : `Simple majority not achieved. Need >50%, got ${
        percentage.toFixed(2)
      }%`,
    voteCounts,
    percentage,
  };
};

/**
 * Calculate supermajority result
 * Supermajority: votes_yes >= 66% of voters_total_count
 *
 * @param voteCounts - Vote counts object
 * @param requiredVotersCount - Total number of required voters
 * @returns Result object with status and details
 */
export const calculateSupermajority = (
  voteCounts: VoteCounts,
  requiredVotersCount: number,
): DecisionResult => {
  const { yes, total } = voteCounts;

  // Edge case: no required voters defined
  if (requiredVotersCount === 0) {
    return {
      passed: false,
      reason: "No required voters defined for this decision",
      voteCounts,
      percentage: 0,
    };
  }

  // Calculate percentage (yes votes / total required voters)
  const percentage = (yes / requiredVotersCount) * 100;
  const passed = percentage >= 66;

  return {
    passed,
    reason: passed
      ? `Supermajority achieved with ${percentage.toFixed(2)}% yes votes`
      : `Supermajority not achieved. Need ≥66%, got ${percentage.toFixed(2)}%`,
    voteCounts,
    percentage,
    requiredVotersCount,
    missingVotes: requiredVotersCount - total,
  };
};

/**
 * Calculate unanimity result
 * Unanimity: All votes are Yes AND total_votes >= quorum
 *
 * @param voteCounts - Vote counts object
 * @param requiredVotersCount - Total number of required voters
 * @param quorum - Minimum number of votes required (defaults to requiredVotersCount)
 * @returns Result object with status and details
 */
export const calculateUnanimity = (
  voteCounts: VoteCounts,
  requiredVotersCount: number,
  quorum: number | null = null,
): DecisionResult => {
  const { yes, no, abstain, total } = voteCounts;

  // Default quorum to required voters count
  const effectiveQuorum = quorum !== null ? quorum : requiredVotersCount;

  // Edge case: no required voters defined
  if (requiredVotersCount === 0) {
    return {
      passed: false,
      reason: "No required voters defined for this decision",
      voteCounts,
      percentage: 0,
    };
  }

  // Check if quorum is met
  if (total < effectiveQuorum) {
    return {
      passed: false,
      reason: `Quorum not met. Need ${effectiveQuorum} votes, got ${total}`,
      voteCounts,
      percentage: (yes / requiredVotersCount) * 100,
      quorum: effectiveQuorum,
      quorumMet: false,
    };
  }

  // Check if all votes are Yes (no No votes)
  // Abstain votes don't count against unanimity
  const hasNoVotes = no > 0;

  if (hasNoVotes) {
    return {
      passed: false,
      reason: `Unanimity not achieved. ${no} vote(s) against`,
      voteCounts,
      percentage: (yes / total) * 100,
      quorum: effectiveQuorum,
      quorumMet: true,
    };
  }

  // Check if there are any Yes votes at all
  if (yes === 0) {
    return {
      passed: false,
      reason: "No yes votes cast",
      voteCounts,
      percentage: 0,
      quorum: effectiveQuorum,
      quorumMet: true,
    };
  }

  // All conditions met for unanimity
  const percentage = (yes / requiredVotersCount) * 100;
  return {
    passed: true,
    reason:
      `Unanimity achieved with ${yes} yes vote(s) and ${abstain} abstention(s)`,
    voteCounts,
    percentage,
    quorum: effectiveQuorum,
    quorumMet: true,
  };
};

/**
 * Calculate decision outcome based on success criteria
 *
 * @param votes - Array of vote objects
 * @param successCriteria - Success criteria (simple_majority, super_majority, unanimous)
 * @param requiredVotersCount - Total number of required voters
 * @param quorum - Optional quorum (for unanimity)
 * @returns Decision outcome result
 */
export const calculateDecisionOutcome = (
  votes: Vote[],
  successCriteria: string,
  requiredVotersCount: number,
  quorum: number | null = null,
): DecisionResult => {
  const voteCounts = calculateVoteCounts(votes);

  let result: DecisionResult;
  switch (successCriteria) {
    case "simple_majority":
      result = calculateSimpleMajority(voteCounts);
      break;
    case "super_majority":
      result = calculateSupermajority(voteCounts, requiredVotersCount);
      break;
    case "unanimous":
      result = calculateUnanimity(voteCounts, requiredVotersCount, quorum);
      break;
    default:
      return {
        passed: false,
        reason: `Invalid success criteria: ${successCriteria}`,
        voteCounts,
        percentage: 0,
        error: true,
      };
  }

  return result;
};

/**
 * Check if decision has reached a deadlock
 * Deadlock occurs when it's mathematically impossible to reach success criteria
 *
 * @param votes - Array of vote objects
 * @param successCriteria - Success criteria
 * @param requiredVotersCount - Total number of required voters
 * @returns Deadlock status
 */
export const checkDeadlock = (
  votes: Vote[],
  successCriteria: string,
  requiredVotersCount: number,
): DeadlockResult => {
  const voteCounts = calculateVoteCounts(votes);
  const { yes, no, total } = voteCounts;
  const remainingVotes = requiredVotersCount - total;

  let isDeadlocked = false;
  let reason = "";

  switch (successCriteria) {
    case "simple_majority": {
      // For simple majority, check if even with all remaining votes as yes, we can't reach >50%
      const maxPossibleYes = yes + remainingVotes;
      const totalAfterRemaining = total + remainingVotes;

      // Already passed - not a deadlock
      if ((yes / total) > 0.5) {
        isDeadlocked = false;
      } // Can't reach majority even with all remaining as yes
      else if ((maxPossibleYes / totalAfterRemaining) <= 0.5) {
        isDeadlocked = true;
        reason =
          "Cannot reach simple majority even if all remaining votes are yes";
      }
      break;
    }

    case "super_majority": {
      // Check if we can still reach 66% with remaining votes
      const maxYes = yes + remainingVotes;
      if ((maxYes / requiredVotersCount) < 0.66) {
        isDeadlocked = true;
        reason =
          "Cannot reach supermajority (66%) even if all remaining votes are yes";
      }
      break;
    }

    case "unanimous":
      // Any No vote creates a deadlock for unanimity
      if (no > 0) {
        isDeadlocked = true;
        reason = "Unanimity impossible due to existing no vote(s)";
      }
      break;
  }

  return {
    isDeadlocked,
    reason,
    voteCounts,
    remainingVotes,
  };
};
