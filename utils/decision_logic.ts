// ConsensusBot v2.0 — Decision logic (Robert's Rules + quorum).
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §15 (Decision logic)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-104
//
// This module is **pure**: no I/O, no datastore access, no async. All pass /
// fail conditions are computed with **integer arithmetic** so floating-point
// edge cases cannot drift the outcome. The only place a divide-and-multiply
// pattern is permitted is for *display* percentages (none rendered here).
//
// Reason strings are part of the contract — they are pinned by acceptance
// tests and surfaced in `decisions.outcome_reason`. Do not reword them.

import type { SuccessCriteria, VoteRecord } from "../types/decision_types.ts";

// ---------------------------------------------------------------------------
// Public types (§15.2)
// ---------------------------------------------------------------------------

/**
 * Per-criterion vote tally. Abstentions are counted but never contribute to
 * the decisive denominator (`yes + no`).
 */
export interface VoteCounts {
  yes: number;
  no: number;
  abstain: number;
  total: number;
}

/**
 * Outcome of a vote-resolution call. `outcome` is the discriminator used by
 * the finaliser:
 *   - `"approved"`   — pass condition met.
 *   - `"rejected"`   — quorum failed, no decisive votes, or threshold missed.
 *   - `"tied"`       — simple-majority only; equal yes / no with no remaining
 *                      voters that could change the outcome.
 *   - `"deadlocked"` — reserved for the finaliser when `checkDeadlock` fires;
 *                      the calculator functions never emit this directly.
 *
 * `error` is set only on the default branch of `calculateDecisionOutcome`
 * when an unrecognised `criteria` is supplied (§15.7).
 */
export interface DecisionResult {
  passed: boolean;
  reason: string;
  voteCounts: VoteCounts;
  decisiveVotes: number;
  effectiveRequiredVoters: number;
  quorum: number;
  quorumMet: boolean;
  outcome: "approved" | "rejected" | "tied" | "deadlocked";
  error?: boolean;
}

/**
 * Result of a deadlock check. Quorum is intentionally NOT a deadlock factor
 * (§15.8): even below quorum, more voters can still arrive.
 */
export interface DeadlockResult {
  isDeadlocked: boolean;
  reason: string;
  voteCounts: VoteCounts;
  remainingVotes: number;
}

// ---------------------------------------------------------------------------
// §15.3 — calculateVoteCounts
// ---------------------------------------------------------------------------

/**
 * Linear scan over the votes array. Increments per vote_type; `total` is the
 * length of the input. Unknown vote_type values are ignored at runtime; the
 * `VoteType` literal already constrains callers at compile time.
 */
export function calculateVoteCounts(votes: VoteRecord[]): VoteCounts {
  let yes = 0;
  let no = 0;
  let abstain = 0;
  for (const v of votes) {
    if (v.vote_type === "yes") yes++;
    else if (v.vote_type === "no") no++;
    else if (v.vote_type === "abstain") abstain++;
  }
  return { yes, no, abstain, total: votes.length };
}

// ---------------------------------------------------------------------------
// Internal helper — populate the shared envelope fields on every result.
// ---------------------------------------------------------------------------

function envelope(
  counts: VoteCounts,
  R: number,
  quorum: number,
): {
  decisiveVotes: number;
  effectiveRequiredVoters: number;
  quorum: number;
  quorumMet: boolean;
} {
  const decisive = counts.yes + counts.no;
  return {
    decisiveVotes: decisive,
    effectiveRequiredVoters: R,
    quorum,
    quorumMet: counts.total >= quorum,
  };
}

// ---------------------------------------------------------------------------
// §15.4 — calculateSimpleMajority
// ---------------------------------------------------------------------------

/**
 * Pass condition (integer-safe):
 *   `votes_cast >= quorum AND yes*2 > yes+no AND (yes+no) >= 1`.
 *
 * A 50/50 split with no remaining voters is reported as `outcome: "tied"`,
 * which is distinct from `"rejected"` so the finaliser can surface the
 * tie-specific reason in the ADR.
 */
export function calculateSimpleMajority(
  counts: VoteCounts,
  R: number,
  quorum: number,
): DecisionResult {
  const env = envelope(counts, R, quorum);
  const votesCast = counts.total;
  const decisive = counts.yes + counts.no;

  if (votesCast < quorum) {
    return {
      passed: false,
      outcome: "rejected",
      reason: `Quorum not met (${votesCast} of ${quorum} required)`,
      voteCounts: counts,
      ...env,
    };
  }
  if (decisive === 0) {
    return {
      passed: false,
      outcome: "rejected",
      reason: "No decisive votes (all abstentions)",
      voteCounts: counts,
      ...env,
    };
  }
  if (counts.yes * 2 > decisive) {
    return {
      passed: true,
      outcome: "approved",
      reason:
        `Simple majority achieved (${counts.yes} yes of ${decisive} decisive)`,
      voteCounts: counts,
      ...env,
    };
  }
  if (counts.yes === counts.no) {
    return {
      passed: false,
      outcome: "tied",
      reason: `Tied (${counts.yes} yes, ${counts.no} no)`,
      voteCounts: counts,
      ...env,
    };
  }
  return {
    passed: false,
    outcome: "rejected",
    reason:
      `Simple majority not achieved (${counts.yes} yes of ${decisive} decisive)`,
    voteCounts: counts,
    ...env,
  };
}

// ---------------------------------------------------------------------------
// §15.5 — calculateSupermajority
// ---------------------------------------------------------------------------

/**
 * Two-thirds threshold with the integer-safe rearrangement
 * `yes*3 >= (yes+no)*2`. The `>=` is deliberate: 2/3 is treated as inclusive
 * per Robert's Rules.
 */
export function calculateSupermajority(
  counts: VoteCounts,
  R: number,
  quorum: number,
): DecisionResult {
  const env = envelope(counts, R, quorum);
  const votesCast = counts.total;
  const decisive = counts.yes + counts.no;

  if (votesCast < quorum) {
    return {
      passed: false,
      outcome: "rejected",
      reason: `Quorum not met (${votesCast} of ${quorum} required)`,
      voteCounts: counts,
      ...env,
    };
  }
  if (decisive === 0) {
    return {
      passed: false,
      outcome: "rejected",
      reason: "No decisive votes (all abstentions)",
      voteCounts: counts,
      ...env,
    };
  }
  if (counts.yes * 3 >= decisive * 2) {
    return {
      passed: true,
      outcome: "approved",
      reason:
        `Two-thirds majority achieved (${counts.yes} yes of ${decisive} decisive)`,
      voteCounts: counts,
      ...env,
    };
  }
  return {
    passed: false,
    outcome: "rejected",
    reason:
      `Two-thirds majority not achieved (${counts.yes} yes of ${decisive} decisive)`,
    voteCounts: counts,
    ...env,
  };
}

// ---------------------------------------------------------------------------
// §15.6 — calculateUnanimity
// ---------------------------------------------------------------------------

/**
 * Unanimity: at least one yes, zero no votes. Abstentions never block
 * unanimity (§15.6 / audit §C.8).
 */
export function calculateUnanimity(
  counts: VoteCounts,
  R: number,
  quorum: number,
): DecisionResult {
  const env = envelope(counts, R, quorum);
  const votesCast = counts.total;

  if (votesCast < quorum) {
    return {
      passed: false,
      outcome: "rejected",
      reason: `Quorum not met (${votesCast} of ${quorum} required)`,
      voteCounts: counts,
      ...env,
    };
  }
  if (counts.yes === 0) {
    return {
      passed: false,
      outcome: "rejected",
      reason: "No yes votes cast",
      voteCounts: counts,
      ...env,
    };
  }
  if (counts.no > 0) {
    return {
      passed: false,
      outcome: "rejected",
      reason: `Unanimity not achieved (${counts.no} vote(s) against)`,
      voteCounts: counts,
      ...env,
    };
  }
  return {
    passed: true,
    outcome: "approved",
    reason:
      `Unanimity achieved (${counts.yes} yes, ${counts.abstain} abstention(s))`,
    voteCounts: counts,
    ...env,
  };
}

// ---------------------------------------------------------------------------
// §15.7 — calculateDecisionOutcome
// ---------------------------------------------------------------------------

/**
 * Top-level dispatcher. Switches on `criteria`; the default branch sets
 * `error: true` and a fixed reason so the caller can distinguish a
 * configuration bug from a normal rejection.
 *
 * `criteria` is widened to `string` here (rather than `SuccessCriteria`) so
 * that runtime-supplied values from the datastore can fall through to the
 * default branch without a cast-and-pray pattern.
 */
export function calculateDecisionOutcome(
  votes: VoteRecord[],
  criteria: SuccessCriteria | string,
  R: number,
  quorum: number,
): DecisionResult {
  const counts = calculateVoteCounts(votes);
  switch (criteria) {
    case "simple_majority":
      return calculateSimpleMajority(counts, R, quorum);
    case "super_majority":
      return calculateSupermajority(counts, R, quorum);
    case "unanimous":
      return calculateUnanimity(counts, R, quorum);
    default: {
      const env = envelope(counts, R, quorum);
      return {
        passed: false,
        outcome: "rejected",
        reason: `Invalid success criteria: ${criteria}`,
        voteCounts: counts,
        ...env,
        error: true,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// §15.8 — checkDeadlock
// ---------------------------------------------------------------------------

/**
 * Returns `isDeadlocked: true` only when the criterion's pass condition is
 * UNREACHABLE even if every remaining required voter votes yes. Quorum is
 * intentionally not part of this check — the deadline-finalisation path
 * handles quorum-not-met separately.
 *
 * `remainingVotes` is clamped at zero so an unexpected `total > R`
 * (deactivated voter still counted, etc.) cannot turn the best-case maths
 * negative.
 */
export function checkDeadlock(
  votes: VoteRecord[],
  criteria: SuccessCriteria | string,
  R: number,
  _quorum: number,
): DeadlockResult {
  const counts = calculateVoteCounts(votes);
  const remaining = Math.max(0, R - counts.total);

  switch (criteria) {
    case "simple_majority": {
      const maxYes = counts.yes + remaining;
      const maxDecisive = counts.yes + counts.no + remaining;
      if (maxYes * 2 <= maxDecisive) {
        return {
          isDeadlocked: true,
          reason: "Cannot achieve simple majority even with all remaining yes",
          voteCounts: counts,
          remainingVotes: remaining,
        };
      }
      break;
    }
    case "super_majority": {
      const maxYes = counts.yes + remaining;
      const maxDecisive = counts.yes + counts.no + remaining;
      if (maxYes * 3 < maxDecisive * 2) {
        return {
          isDeadlocked: true,
          reason:
            "Cannot achieve two-thirds majority even with all remaining yes",
          voteCounts: counts,
          remainingVotes: remaining,
        };
      }
      break;
    }
    case "unanimous": {
      if (counts.no > 0) {
        return {
          isDeadlocked: true,
          reason: "Unanimity impossible — at least one no vote already cast",
          voteCounts: counts,
          remainingVotes: remaining,
        };
      }
      break;
    }
  }

  return {
    isDeadlocked: false,
    reason: "",
    voteCounts: counts,
    remainingVotes: remaining,
  };
}
