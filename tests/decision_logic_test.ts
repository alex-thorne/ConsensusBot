// ConsensusBot v2.0 — Tests for `utils/decision_logic.ts`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §15
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-104 / audit §D.1
//
// These tests pin the behaviour AND the reason strings. The reason strings
// are surfaced in `decisions.outcome_reason` and rendered in ADRs, so any
// change to wording is a contract break.

import { assert, assertEquals } from "@std/assert";
import type { VoteRecord, VoteType } from "../types/decision_types.ts";
import {
  calculateDecisionOutcome,
  calculateSimpleMajority,
  calculateSupermajority,
  calculateUnanimity,
  calculateVoteCounts,
  checkDeadlock,
  type DecisionResult,
  type VoteCounts,
} from "../utils/decision_logic.ts";

// ---------------------------------------------------------------------------
// Helpers — build typed vote arrays without ceremony.
// ---------------------------------------------------------------------------

let _seq = 0;
function makeVote(vote_type: VoteType): VoteRecord {
  _seq++;
  return {
    id: `decision_user${_seq}`,
    decision_id: "decision",
    user_id: `U${_seq}`,
    vote_type,
    voted_at: "2026-05-08T10:00:00.000Z",
  };
}

function votes(yes: number, no: number, abstain: number): VoteRecord[] {
  const out: VoteRecord[] = [];
  for (let i = 0; i < yes; i++) out.push(makeVote("yes"));
  for (let i = 0; i < no; i++) out.push(makeVote("no"));
  for (let i = 0; i < abstain; i++) out.push(makeVote("abstain"));
  return out;
}

function counts(yes: number, no: number, abstain: number): VoteCounts {
  return { yes, no, abstain, total: yes + no + abstain };
}

function assertEnvelope(
  r: DecisionResult,
  expected: { R: number; quorum: number; quorumMet: boolean },
) {
  assertEquals(r.effectiveRequiredVoters, expected.R);
  assertEquals(r.quorum, expected.quorum);
  assertEquals(r.quorumMet, expected.quorumMet);
  assertEquals(
    r.decisiveVotes,
    r.voteCounts.yes + r.voteCounts.no,
  );
}

// ---------------------------------------------------------------------------
// calculateVoteCounts (§15.3)
// ---------------------------------------------------------------------------

Deno.test("calculateVoteCounts — empty input returns zeros", () => {
  assertEquals(calculateVoteCounts([]), {
    yes: 0,
    no: 0,
    abstain: 0,
    total: 0,
  });
});

Deno.test("calculateVoteCounts — mixed vote types tally correctly", () => {
  const c = calculateVoteCounts(votes(3, 2, 1));
  assertEquals(c, { yes: 3, no: 2, abstain: 1, total: 6 });
});

Deno.test("calculateVoteCounts — total equals input length", () => {
  const input = votes(7, 4, 2);
  const c = calculateVoteCounts(input);
  assertEquals(c.total, input.length);
  assertEquals(c.total, 13);
});

// ---------------------------------------------------------------------------
// calculateSimpleMajority (§15.4)
// ---------------------------------------------------------------------------

Deno.test("simple_majority — 1 yes / 0 no / 0 abstain on R=10 quorum=5 fails on quorum", () => {
  // Audit §D.1: 1-of-10 must fail simple_majority on quorum.
  const r = calculateSimpleMajority(counts(1, 0, 0), 10, 5);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "rejected");
  assertEquals(r.reason, "Quorum not met (1 of 5 required)");
  assertEnvelope(r, { R: 10, quorum: 5, quorumMet: false });
});

Deno.test("simple_majority — 0/0/5 on R=10 quorum=5 fails with 'no decisive votes'", () => {
  const r = calculateSimpleMajority(counts(0, 0, 5), 10, 5);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "rejected");
  assertEquals(r.reason, "No decisive votes (all abstentions)");
  assertEnvelope(r, { R: 10, quorum: 5, quorumMet: true });
});

Deno.test("simple_majority — 3/2/0 on R=5 quorum=3 passes (yes*2=6 > decisive=5)", () => {
  const r = calculateSimpleMajority(counts(3, 2, 0), 5, 3);
  assertEquals(r.passed, true);
  assertEquals(r.outcome, "approved");
  assertEquals(r.reason, "Simple majority achieved (3 yes of 5 decisive)");
  assertEnvelope(r, { R: 5, quorum: 3, quorumMet: true });
});

Deno.test("simple_majority — 5/5/0 on R=10 quorum=5 ties (outcome: 'tied')", () => {
  // Audit §D.1: 5/5 must produce outcome: "tied", not "rejected".
  const r = calculateSimpleMajority(counts(5, 5, 0), 10, 5);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "tied");
  assertEquals(r.reason, "Tied (5 yes, 5 no)");
  assertEnvelope(r, { R: 10, quorum: 5, quorumMet: true });
});

Deno.test("simple_majority — 2/3/0 fails (yes*2=4 not > decisive=5; not tied)", () => {
  const r = calculateSimpleMajority(counts(2, 3, 0), 5, 3);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "rejected");
  assertEquals(
    r.reason,
    "Simple majority not achieved (2 yes of 5 decisive)",
  );
});

Deno.test("simple_majority — abstentions excluded from denominator (3/1/3 passes)", () => {
  // 3 yes, 1 no, 3 abstain → decisive=4, yes*2=6 > 4 → pass.
  const r = calculateSimpleMajority(counts(3, 1, 3), 10, 5);
  assertEquals(r.passed, true);
  assertEquals(r.outcome, "approved");
  assertEquals(r.reason, "Simple majority achieved (3 yes of 4 decisive)");
});

// ---------------------------------------------------------------------------
// calculateSupermajority (§15.5) — integer-arithmetic boundary tests
// ---------------------------------------------------------------------------

Deno.test("super_majority — 67/33/0 on R=100 quorum=67 PASSES (yes*3=201 >= decisive*2=200)", () => {
  // Audit §D.1: 67/33 must pass super_majority — exact integer boundary.
  const r = calculateSupermajority(counts(67, 33, 0), 100, 67);
  assertEquals(r.passed, true);
  assertEquals(r.outcome, "approved");
  assertEquals(
    r.reason,
    "Two-thirds majority achieved (67 yes of 100 decisive)",
  );
  // Sanity: confirm the integer inequality the assertion is pinning.
  assert(67 * 3 >= 100 * 2, "boundary maths must hold");
});

Deno.test("super_majority — 66/34/0 on R=100 quorum=67 FAILS (yes*3=198 < decisive*2=200)", () => {
  // Audit §D.1: 66/34 must fail super_majority — one shy of the boundary.
  const r = calculateSupermajority(counts(66, 34, 0), 100, 67);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "rejected");
  assertEquals(
    r.reason,
    "Two-thirds majority not achieved (66 yes of 100 decisive)",
  );
  assert(66 * 3 < 100 * 2, "boundary maths must hold");
});

Deno.test("super_majority — 1/0/0 on R=10 quorum=5 fails on quorum", () => {
  const r = calculateSupermajority(counts(1, 0, 0), 10, 5);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "rejected");
  assertEquals(r.reason, "Quorum not met (1 of 5 required)");
});

Deno.test("super_majority — all-abstain fails with 'no decisive votes'", () => {
  const r = calculateSupermajority(counts(0, 0, 7), 10, 5);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "rejected");
  assertEquals(r.reason, "No decisive votes (all abstentions)");
});

Deno.test("super_majority — 2/1/0 passes at exact 2/3 (yes*3=6 >= decisive*2=6)", () => {
  const r = calculateSupermajority(counts(2, 1, 0), 3, 2);
  assertEquals(r.passed, true);
  assertEquals(r.outcome, "approved");
  assertEquals(r.reason, "Two-thirds majority achieved (2 yes of 3 decisive)");
});

// ---------------------------------------------------------------------------
// calculateUnanimity (§15.6)
// ---------------------------------------------------------------------------

Deno.test("unanimous — 5/0/2 on R=7 quorum=7 PASSES (abstentions never block)", () => {
  // Audit §D.1: unanimity with abstentions must pass.
  const r = calculateUnanimity(counts(5, 0, 2), 7, 7);
  assertEquals(r.passed, true);
  assertEquals(r.outcome, "approved");
  assertEquals(r.reason, "Unanimity achieved (5 yes, 2 abstention(s))");
  assertEnvelope(r, { R: 7, quorum: 7, quorumMet: true });
});

Deno.test("unanimous — 5/1/0 on R=6 quorum=6 FAILS on a single no vote", () => {
  const r = calculateUnanimity(counts(5, 1, 0), 6, 6);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "rejected");
  assertEquals(r.reason, "Unanimity not achieved (1 vote(s) against)");
});

Deno.test("unanimous — 0/0/3 on R=3 quorum=3 fails with 'No yes votes cast'", () => {
  const r = calculateUnanimity(counts(0, 0, 3), 3, 3);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "rejected");
  assertEquals(r.reason, "No yes votes cast");
});

Deno.test("unanimous — quorum-not-met short-circuits before 'No yes votes cast'", () => {
  // votes_cast=2, quorum=5 → quorum reason wins over 'no yes votes'.
  const r = calculateUnanimity(counts(0, 0, 2), 5, 5);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "rejected");
  assertEquals(r.reason, "Quorum not met (2 of 5 required)");
});

Deno.test("unanimous — 3/0/0 on R=3 quorum=3 passes with zero abstentions", () => {
  const r = calculateUnanimity(counts(3, 0, 0), 3, 3);
  assertEquals(r.passed, true);
  assertEquals(r.outcome, "approved");
  assertEquals(r.reason, "Unanimity achieved (3 yes, 0 abstention(s))");
});

// ---------------------------------------------------------------------------
// calculateDecisionOutcome (§15.7) — dispatcher + invalid criteria
// ---------------------------------------------------------------------------

Deno.test("calculateDecisionOutcome — dispatches to simple_majority", () => {
  const r = calculateDecisionOutcome(votes(3, 2, 0), "simple_majority", 5, 3);
  assertEquals(r.passed, true);
  assertEquals(r.outcome, "approved");
  assertEquals(r.reason, "Simple majority achieved (3 yes of 5 decisive)");
  assertEquals(r.error, undefined);
});

Deno.test("calculateDecisionOutcome — dispatches to super_majority", () => {
  const r = calculateDecisionOutcome(
    votes(67, 33, 0),
    "super_majority",
    100,
    67,
  );
  assertEquals(r.passed, true);
  assertEquals(r.outcome, "approved");
  assertEquals(
    r.reason,
    "Two-thirds majority achieved (67 yes of 100 decisive)",
  );
});

Deno.test("calculateDecisionOutcome — dispatches to unanimous", () => {
  const r = calculateDecisionOutcome(votes(5, 0, 2), "unanimous", 7, 7);
  assertEquals(r.passed, true);
  assertEquals(r.outcome, "approved");
  assertEquals(r.reason, "Unanimity achieved (5 yes, 2 abstention(s))");
});

Deno.test("calculateDecisionOutcome — invalid criteria sets error: true with full envelope", () => {
  const r = calculateDecisionOutcome(votes(3, 2, 1), "two_thirds", 6, 3);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "rejected");
  assertEquals(r.reason, "Invalid success criteria: two_thirds");
  assertEquals(r.error, true);
  assertEquals(r.voteCounts, { yes: 3, no: 2, abstain: 1, total: 6 });
  assertEquals(r.decisiveVotes, 5);
  assertEquals(r.effectiveRequiredVoters, 6);
  assertEquals(r.quorum, 3);
  assertEquals(r.quorumMet, true);
});

Deno.test("calculateDecisionOutcome — non-default branches do NOT set error flag", () => {
  // Quorum-not-met still uses the rejected outcome but error must remain unset.
  const r = calculateDecisionOutcome(votes(1, 0, 0), "simple_majority", 10, 5);
  assertEquals(r.passed, false);
  assertEquals(r.outcome, "rejected");
  assertEquals(r.reason, "Quorum not met (1 of 5 required)");
  assertEquals(r.error, undefined);
});

// ---------------------------------------------------------------------------
// checkDeadlock (§15.8) — simple_majority
// ---------------------------------------------------------------------------

Deno.test("deadlock simple_majority — 1/5/0 on R=10 IS deadlocked (max_yes=5, max_decisive=10, 5*2=10 not > 10)", () => {
  // Audit §D.1: classic simple-majority deadlock.
  const r = checkDeadlock(votes(1, 5, 0), "simple_majority", 10, 5);
  assertEquals(r.isDeadlocked, true);
  assertEquals(
    r.reason,
    "Cannot achieve simple majority even with all remaining yes",
  );
  assertEquals(r.remainingVotes, 4);
  assertEquals(r.voteCounts, { yes: 1, no: 5, abstain: 0, total: 6 });
});

Deno.test("deadlock simple_majority — 1/0/0 on R=10 NOT deadlocked (max_yes=10 of 10 decisive)", () => {
  // max_yes=10, max_decisive=10. 10*2=20 > 10 → still possible.
  const r = checkDeadlock(votes(1, 0, 0), "simple_majority", 10, 5);
  assertEquals(r.isDeadlocked, false);
  assertEquals(r.reason, "");
  assertEquals(r.remainingVotes, 9);
});

Deno.test("deadlock simple_majority — abstentions are not in best-case yes count", () => {
  // 0 yes, 1 no, 5 abstain on R=6: max_yes=0, max_decisive=1, 0*2=0 <= 1 → deadlocked.
  const r = checkDeadlock(votes(0, 1, 5), "simple_majority", 6, 4);
  assertEquals(r.isDeadlocked, true);
  assertEquals(
    r.reason,
    "Cannot achieve simple majority even with all remaining yes",
  );
});

// ---------------------------------------------------------------------------
// checkDeadlock — super_majority
// ---------------------------------------------------------------------------

Deno.test("deadlock super_majority — 1/0/0 on R=10 NOT deadlocked at the boundary", () => {
  // max_yes=10, max_decisive=10. 10*3=30 >= 10*2=20 → still possible.
  const r = checkDeadlock(votes(1, 0, 0), "super_majority", 10, 7);
  assertEquals(r.isDeadlocked, false);
  assertEquals(r.reason, "");
  assertEquals(r.remainingVotes, 9);
});

Deno.test("deadlock super_majority — 0/4/0 on R=10 IS deadlocked (max_yes=6, max_decisive=10, 6*3=18 < 10*2=20)", () => {
  const r = checkDeadlock(votes(0, 4, 0), "super_majority", 10, 7);
  assertEquals(r.isDeadlocked, true);
  assertEquals(
    r.reason,
    "Cannot achieve two-thirds majority even with all remaining yes",
  );
  assertEquals(r.remainingVotes, 6);
});

Deno.test("deadlock super_majority — 0/3/0 on R=10 NOT deadlocked (max_yes=7, max_decisive=10, 7*3=21 >= 20)", () => {
  const r = checkDeadlock(votes(0, 3, 0), "super_majority", 10, 7);
  assertEquals(r.isDeadlocked, false);
  assertEquals(r.reason, "");
});

// ---------------------------------------------------------------------------
// checkDeadlock — unanimous
// ---------------------------------------------------------------------------

Deno.test("deadlock unanimous — single no vote IS deadlocked (em-dash reason)", () => {
  const r = checkDeadlock(votes(2, 1, 0), "unanimous", 5, 5);
  assertEquals(r.isDeadlocked, true);
  // Note the EM DASH (U+2014), not a hyphen.
  assertEquals(
    r.reason,
    "Unanimity impossible — at least one no vote already cast",
  );
  // Confirm the codepoint is exactly U+2014 (not a hyphen-minus).
  assertEquals(r.reason.charCodeAt(21), 0x2014);
  assert(!r.reason.includes("-"), "must not contain a hyphen-minus");
});

Deno.test("deadlock unanimous — zero no votes NOT deadlocked even if not yet at quorum", () => {
  const r = checkDeadlock(votes(2, 0, 1), "unanimous", 5, 5);
  assertEquals(r.isDeadlocked, false);
  assertEquals(r.reason, "");
  assertEquals(r.remainingVotes, 2);
});

// ---------------------------------------------------------------------------
// checkDeadlock — invariants
// ---------------------------------------------------------------------------

Deno.test("deadlock — quorum is irrelevant; 0 votes on R=10 NOT deadlocked", () => {
  // SPEC §15.8 last paragraph: quorum is NOT a deadlock factor.
  const r = checkDeadlock([], "simple_majority", 10, 100);
  assertEquals(r.isDeadlocked, false);
  assertEquals(r.remainingVotes, 10);
});

Deno.test("deadlock — unknown criteria returns NOT deadlocked rather than throwing", () => {
  const r = checkDeadlock(votes(1, 1, 0), "two_thirds", 5, 3);
  assertEquals(r.isDeadlocked, false);
  assertEquals(r.reason, "");
  assertEquals(r.remainingVotes, 3);
});

Deno.test("deadlock — remainingVotes never goes negative if total > R", () => {
  // Defensive: deactivated voters could in theory leave total > R.
  const r = checkDeadlock(votes(3, 2, 1), "simple_majority", 4, 3);
  assertEquals(r.remainingVotes, 0);
});
