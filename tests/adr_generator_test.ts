// ConsensusBot v2.0 — Tests for `utils/adr_generator.ts`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §17.1 (markdown template)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §17.2 (three-block Slack format)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-201
//
// Acceptance:
//   deno check utils/adr_generator.ts
//   deno test --allow-read --allow-env tests/adr_generator_test.ts
//
// These tests pin both the per-section content of the rendered markdown AND
// the three exact Slack-block strings. The reason / status / outcome strings
// flow into customer-visible ADRs and are therefore part of the contract.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type {
  DecisionRecord,
  VoteHistoryRecord,
  VoteRecord,
  VoterRecord,
} from "../types/decision_types.ts";
import type {
  SlackBlock,
  SlackContextBlock,
  SlackSectionBlock,
} from "../types/slack_types.ts";
import {
  formatADRForSlack,
  generateADRMarkdown,
} from "../utils/adr_generator.ts";
import type { DecisionResult } from "../utils/decision_logic.ts";

// ---------------------------------------------------------------------------
// Fixtures — build typed records without ceremony.
// ---------------------------------------------------------------------------

function makeDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    name: "Adopt Deno 2",
    proposal: "Migrate the codebase to Deno 2.x.",
    success_criteria: "simple_majority",
    quorum: 3,
    required_voters_count: 4,
    deadline: "2026-05-15",
    deadline_resolved: "2026-05-15T22:59:59.000Z",
    deadline_tz: "Europe/London",
    channel_id: "C0123456789",
    creator_id: "U0001",
    message_ts: "1715170800.000100",
    status: "approved",
    finalized_at: "2026-05-15T23:00:05.000Z",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-15T23:00:05.000Z",
    ...overrides,
  };
}

function makeVote(
  decisionId: string,
  userId: string,
  voteType: "yes" | "no" | "abstain",
  votedAt = "2026-05-10T10:00:00.000Z",
): VoteRecord {
  return {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    vote_type: voteType,
    voted_at: votedAt,
  };
}

function makeHistory(
  decisionId: string,
  userId: string,
  voteType: "yes" | "no" | "abstain",
  eventKind: "cast" | "changed",
  seq: string,
  votedAt: string,
  previous?: "yes" | "no" | "abstain",
): VoteHistoryRecord {
  return {
    id: `${decisionId}_${userId}_${seq}`,
    decision_id: decisionId,
    user_id: userId,
    vote_type: voteType,
    event_kind: eventKind,
    voted_at: votedAt,
    ...(previous !== undefined ? { previous_vote_type: previous } : {}),
  };
}

function makeVoter(
  decisionId: string,
  userId: string,
  isActive: boolean,
): VoterRecord {
  return {
    id: `${decisionId}_${userId}`,
    decision_id: decisionId,
    user_id: userId,
    is_active: isActive,
    created_at: "2026-05-08T09:00:00.000Z",
  };
}

function approvedSimpleMajority(
  yes: number,
  no: number,
  abstain: number,
  R = 4,
  quorum = 3,
): DecisionResult {
  return {
    passed: true,
    outcome: "approved",
    reason: `Simple majority achieved (${yes} yes of ${yes + no} decisive)`,
    voteCounts: { yes, no, abstain, total: yes + no + abstain },
    decisiveVotes: yes + no,
    effectiveRequiredVoters: R,
    quorum,
    quorumMet: (yes + no + abstain) >= quorum,
  };
}

function rejectedSimpleMajority(
  yes: number,
  no: number,
  abstain: number,
  R = 4,
  quorum = 3,
): DecisionResult {
  return {
    passed: false,
    outcome: "rejected",
    reason: `Simple majority not achieved (${yes} yes of ${yes + no} decisive)`,
    voteCounts: { yes, no, abstain, total: yes + no + abstain },
    decisiveVotes: yes + no,
    effectiveRequiredVoters: R,
    quorum,
    quorumMet: (yes + no + abstain) >= quorum,
  };
}

// ---------------------------------------------------------------------------
// generateADRMarkdown — approved decision (simple_majority, 3y/1n/0a)
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — approved simple_majority renders Status: Accepted and ✅ APPROVED", () => {
  const decision = makeDecision();
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "yes"),
    makeVote(decision.id, "U0002", "yes"),
    makeVote(decision.id, "U0003", "yes"),
    makeVote(decision.id, "U0004", "no"),
  ];
  const outcome = approvedSimpleMajority(3, 1, 0);
  const userMap = new Map([
    ["U0001", "Alice"],
    ["U0002", "Bob"],
    ["U0003", "Carol"],
    ["U0004", "Dave"],
  ]);

  const md = generateADRMarkdown(decision, votes, [], outcome, userMap);

  // Front-matter / status.
  assertStringIncludes(md, "# Adopt Deno 2");
  assertStringIncludes(md, "**Status:** Accepted");
  // Two-space soft break MUST follow the Status line per SPEC §17.1 L1152.
  assertStringIncludes(md, "**Status:** Accepted  \n");
  assertStringIncludes(md, "**Date:** 2026-05-08");
  assertStringIncludes(
    md,
    "**Decision ID:** 11111111-2222-3333-4444-555555555555",
  );
  assertStringIncludes(md, "**Success Criteria:** Simple Majority");
  assertStringIncludes(md, "**Quorum:** 3 of 4 required voters");
  assertStringIncludes(md, "**Deadline:** ");

  // Decision section uses the same criteriaDisplay.
  assertStringIncludes(
    md,
    "This decision was put to a vote using the **Simple Majority** consensus criterion.",
  );

  // Voting Results.
  assertStringIncludes(md, "**Outcome:** ✅ APPROVED");
  // Two-space soft break after the Outcome line per SPEC §17.1 L1169.
  assertStringIncludes(md, "**Outcome:** ✅ APPROVED  \n**Reason:** ");
  assertStringIncludes(
    md,
    "**Reason:** Simple majority achieved (3 yes of 4 decisive)",
  );

  // Vote Breakdown (per §17.1).
  assertStringIncludes(md, "- Yes: 3");
  assertStringIncludes(md, "- No: 1");
  assertStringIncludes(md, "- Abstain: 0");
  assertStringIncludes(md, "- Total Votes: 4");
  assertStringIncludes(md, "- Required Voters (effective): 4");
  assertStringIncludes(md, "- Decisive Votes (yes+no): 4");
  assertStringIncludes(md, "- Quorum: 3 (met)");

  // Individual Votes — every voter rendered with display name + emoji.
  assertStringIncludes(md, "- ✅ Alice: YES");
  assertStringIncludes(md, "- ✅ Bob: YES");
  assertStringIncludes(md, "- ✅ Carol: YES");
  assertStringIncludes(md, "- ❌ Dave: NO");

  // Consequences (approved branch).
  assertStringIncludes(
    md,
    "This decision has been approved and should be implemented as proposed.",
  );
  assertStringIncludes(md, "N/A — Decision was approved.");
  assertStringIncludes(
    md,
    "Teams should proceed with implementing the proposal as described in the Context section.",
  );

  // References.
  assertStringIncludes(md, "- **Decision Created:** 2026-05-08T09:00:00.000Z");
  assertStringIncludes(
    md,
    "- **Deadline Resolved:** 2026-05-15T22:59:59.000Z (Europe/London)",
  );
  assertStringIncludes(md, "- **Finalised:** 2026-05-15T23:00:05.000Z");
  assertStringIncludes(md, "- **Creator:** <@U0001>");
  assertStringIncludes(md, "- **Total Participants:** 4");

  // Footer with auto-generated tag (two-space soft break per L1229) and
  // suggested filename including first 8 chars of UUID.
  assertStringIncludes(
    md,
    "*This ADR was automatically generated by ConsensusBot*  \n*Suggested filename: `2026-05-08-adopt-deno-2-11111111.md`*",
  );
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — rejected decision
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — rejected decision renders Status: Rejected and ❌ REJECTED", () => {
  const decision = makeDecision({ status: "rejected" });
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "yes"),
    makeVote(decision.id, "U0002", "no"),
    makeVote(decision.id, "U0003", "no"),
  ];
  const outcome = rejectedSimpleMajority(1, 2, 0);
  const userMap = new Map([
    ["U0001", "Alice"],
    ["U0002", "Bob"],
    ["U0003", "Carol"],
  ]);

  const md = generateADRMarkdown(decision, votes, [], outcome, userMap);

  assertStringIncludes(md, "**Status:** Rejected");
  assertStringIncludes(md, "**Outcome:** ❌ REJECTED");
  assertStringIncludes(
    md,
    "**Reason:** Simple majority not achieved (1 yes of 3 decisive)",
  );
  // Rejected branch of Consequences / Implementation Notes.
  assertStringIncludes(md, "N/A — Decision was not approved.");
  assertStringIncludes(
    md,
    "This decision was rejected. The team may revisit this proposal in the future with modifications or abandon it entirely.",
  );
  assertStringIncludes(
    md,
    "No implementation required as decision was rejected.",
  );
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — abstain handling: voter with vote_type "abstain"
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — abstain voter shows ⚪ emoji and ABSTAIN literal", () => {
  const decision = makeDecision();
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "yes"),
    makeVote(decision.id, "U0002", "yes"),
    makeVote(decision.id, "U0003", "yes"),
    makeVote(decision.id, "U0004", "abstain"),
  ];
  const outcome = approvedSimpleMajority(3, 0, 1);
  const userMap = new Map([
    ["U0001", "Alice"],
    ["U0002", "Bob"],
    ["U0003", "Carol"],
    ["U0004", "Eve"],
  ]);

  const md = generateADRMarkdown(decision, votes, [], outcome, userMap);
  assertStringIncludes(md, "- ⚪ Eve: ABSTAIN");
  assertStringIncludes(md, "- Abstain: 1");
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — missing userMap entry falls back to user_id
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — missing userMap entry falls back to raw user_id", () => {
  const decision = makeDecision();
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "yes"),
    makeVote(decision.id, "U0099", "no"), // not in userMap
  ];
  const outcome = rejectedSimpleMajority(1, 1, 0);
  const userMap = new Map([["U0001", "Alice"]]);

  const md = generateADRMarkdown(decision, votes, [], outcome, userMap);
  assertStringIncludes(md, "- ✅ Alice: YES");
  assertStringIncludes(md, "- ❌ U0099: NO");
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — Vote History rendering when changes occurred
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — Vote History lists changed events as `name: PREV → NEW at iso`", () => {
  const decision = makeDecision();
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "no", "2026-05-12T11:00:00.000Z"),
    makeVote(decision.id, "U0002", "yes"),
    makeVote(decision.id, "U0003", "yes"),
  ];
  const voteHistory: VoteHistoryRecord[] = [
    makeHistory(
      decision.id,
      "U0001",
      "yes",
      "cast",
      "00000001",
      "2026-05-09T08:00:00.000Z",
    ),
    makeHistory(
      decision.id,
      "U0001",
      "no",
      "changed",
      "00000002",
      "2026-05-12T11:00:00.000Z",
      "yes",
    ),
    makeHistory(
      decision.id,
      "U0002",
      "yes",
      "cast",
      "00000003",
      "2026-05-10T10:00:00.000Z",
    ),
    makeHistory(
      decision.id,
      "U0003",
      "yes",
      "cast",
      "00000004",
      "2026-05-10T10:00:00.000Z",
    ),
  ];
  const outcome = rejectedSimpleMajority(2, 1, 0);
  const userMap = new Map([
    ["U0001", "Alice"],
    ["U0002", "Bob"],
    ["U0003", "Carol"],
  ]);

  const md = generateADRMarkdown(
    decision,
    votes,
    voteHistory,
    outcome,
    userMap,
  );

  assertStringIncludes(
    md,
    "The following voters changed their vote during the decision:",
  );
  assertStringIncludes(md, "- Alice: YES → NO at 2026-05-12T11:00:00.000Z");
  // No "_No voters changed_" placeholder when changes exist.
  assert(
    !md.includes("_No voters changed their vote._"),
    "should not emit the placeholder when changed events exist",
  );
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — "_No voters changed their vote._" when no changed
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — emits placeholder when no changed events in history", () => {
  const decision = makeDecision();
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "yes"),
    makeVote(decision.id, "U0002", "yes"),
    makeVote(decision.id, "U0003", "yes"),
  ];
  const voteHistory: VoteHistoryRecord[] = [
    makeHistory(
      decision.id,
      "U0001",
      "yes",
      "cast",
      "00000001",
      "2026-05-10T10:00:00.000Z",
    ),
    makeHistory(
      decision.id,
      "U0002",
      "yes",
      "cast",
      "00000002",
      "2026-05-10T10:00:00.000Z",
    ),
    makeHistory(
      decision.id,
      "U0003",
      "yes",
      "cast",
      "00000003",
      "2026-05-10T10:00:00.000Z",
    ),
  ];
  const outcome = approvedSimpleMajority(3, 0, 0);
  const userMap = new Map([
    ["U0001", "Alice"],
    ["U0002", "Bob"],
    ["U0003", "Carol"],
  ]);

  const md = generateADRMarkdown(
    decision,
    votes,
    voteHistory,
    outcome,
    userMap,
  );
  assertStringIncludes(md, "_No voters changed their vote._");
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — Excluded Voters rendering (deactivated set non-empty)
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — Excluded Voters lists deactivated voters", () => {
  const decision = makeDecision();
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "yes"),
    makeVote(decision.id, "U0002", "yes"),
  ];
  const outcome = approvedSimpleMajority(2, 0, 0, 3, 2);
  const userMap = new Map([
    ["U0001", "Alice"],
    ["U0002", "Bob"],
    ["U0003", "Carol-deactivated"],
  ]);
  const deactivated: VoterRecord[] = [
    makeVoter(decision.id, "U0003", false),
  ];

  const md = generateADRMarkdown(
    decision,
    votes,
    [],
    outcome,
    userMap,
    deactivated,
  );

  assertStringIncludes(
    md,
    "The following voters were deactivated during the decision and excluded from quorum:",
  );
  assertStringIncludes(md, "- Carol-deactivated");
  assert(
    !md.includes("### Excluded Voters\n\n_None._"),
    "should not emit _None._ when deactivated voters exist",
  );
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — Excluded Voters renders "_None._" by default
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — Excluded Voters renders _None._ when empty", () => {
  const decision = makeDecision();
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "yes"),
    makeVote(decision.id, "U0002", "yes"),
    makeVote(decision.id, "U0003", "yes"),
  ];
  const outcome = approvedSimpleMajority(3, 0, 0);
  const userMap = new Map([
    ["U0001", "Alice"],
    ["U0002", "Bob"],
    ["U0003", "Carol"],
  ]);

  const md = generateADRMarkdown(decision, votes, [], outcome, userMap);
  assertStringIncludes(md, "### Excluded Voters\n\n_None._");
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — backticks in name do not break the code-fence
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — triple-backticks in name are neutralised so they cannot break the code-fence", () => {
  const decision = makeDecision({ name: "Use ```bash``` everywhere" });
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "yes"),
    makeVote(decision.id, "U0002", "yes"),
    makeVote(decision.id, "U0003", "yes"),
  ];
  const outcome = approvedSimpleMajority(3, 0, 0);
  const userMap = new Map([
    ["U0001", "Alice"],
    ["U0002", "Bob"],
    ["U0003", "Carol"],
  ]);

  const md = generateADRMarkdown(decision, votes, [], outcome, userMap);

  // Triple backticks in the H1 are neutralised — markdown body must not
  // contain a raw ``` sequence (other than the absence of any).
  assert(
    !md.includes("```"),
    "rendered markdown must not contain a raw triple-backtick sequence",
  );
  assertStringIncludes(md, "\\`\\`\\`bash\\`\\`\\`");
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — suggested filename includes first 8 UUID chars + slug
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — suggested filename uses YYYY-MM-DD + slug + first 8 chars of UUID", () => {
  const decision = makeDecision({
    id: "deadbeef-cafe-babe-0000-000000000001",
    name: "Adopt   Deno 2!  ",
    created_at: "2026-05-08T09:00:00.000Z",
  });
  const outcome = approvedSimpleMajority(3, 0, 0);
  const md = generateADRMarkdown(decision, [], [], outcome, new Map());

  assertStringIncludes(
    md,
    "*Suggested filename: `2026-05-08-adopt-deno-2-deadbeef.md`*",
  );
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — deadlocked outcome reason flows through to Reason
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — deadlocked outcome reason renders verbatim in Reason", () => {
  const decision = makeDecision({ status: "rejected" });
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "no"),
    makeVote(decision.id, "U0002", "no"),
    makeVote(decision.id, "U0003", "no"),
    makeVote(decision.id, "U0004", "no"),
  ];
  const outcome: DecisionResult = {
    passed: false,
    outcome: "deadlocked",
    reason: "Cannot achieve simple majority even with all remaining yes",
    voteCounts: { yes: 0, no: 4, abstain: 0, total: 4 },
    decisiveVotes: 4,
    effectiveRequiredVoters: 4,
    quorum: 3,
    quorumMet: true,
  };
  const userMap = new Map([
    ["U0001", "Alice"],
    ["U0002", "Bob"],
    ["U0003", "Carol"],
    ["U0004", "Dave"],
  ]);

  const md = generateADRMarkdown(decision, votes, [], outcome, userMap);

  assertStringIncludes(md, "**Outcome:** ❌ REJECTED");
  assertStringIncludes(
    md,
    "**Reason:** Cannot achieve simple majority even with all remaining yes",
  );
  assertStringIncludes(md, "**Status:** Rejected");
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — proposal with Slack mentions is escaped
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — proposal with Slack mentions escapes <, >, &", () => {
  const decision = makeDecision({
    proposal: "Notify <@U999> & <!channel> about <X>",
  });
  const outcome = approvedSimpleMajority(3, 0, 0);
  const md = generateADRMarkdown(decision, [], [], outcome, new Map());

  assertStringIncludes(
    md,
    "Notify &lt;@U999&gt; &amp; &lt;!channel&gt; about &lt;X&gt;",
  );
  // No raw mention should survive.
  assert(!md.includes("<@U999>"), "user mention must be escaped");
  assert(!md.includes("<!channel>"), "channel broadcast must be escaped");
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — Total Participants derives unique count from votes
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — Total Participants is the unique-voter count from `votes`", () => {
  const decision = makeDecision();
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "yes"),
    makeVote(decision.id, "U0002", "yes"),
    makeVote(decision.id, "U0003", "no"),
  ];
  const outcome = approvedSimpleMajority(2, 1, 0);
  const md = generateADRMarkdown(decision, votes, [], outcome, new Map());
  assertStringIncludes(md, "- **Total Participants:** 3");
});

// ---------------------------------------------------------------------------
// formatADRForSlack — three-block layout with the exact §17.2 strings
// ---------------------------------------------------------------------------

Deno.test("formatADRForSlack — returns exactly three blocks with the SPEC §17.2 strings", () => {
  const md = "# Adopt Deno 2\n\n**Status:** Accepted";
  const blocks = formatADRForSlack(md);

  assertEquals(blocks.length, 3);

  // Block 1: header section.
  const b1 = blocks[0] as SlackSectionBlock;
  assertEquals(b1.type, "section");
  assertEquals(b1.text?.type, "mrkdwn");
  assertEquals(
    b1.text?.text,
    "📝 *Architecture Decision Record Generated*\n\nThe decision has been finalised. Below is the ADR markdown that can be copied to your documentation repository:",
  );

  // Block 2: fenced code section wrapping the markdown.
  const b2 = blocks[1] as SlackSectionBlock;
  assertEquals(b2.type, "section");
  assertEquals(b2.text?.type, "mrkdwn");
  assertEquals(b2.text?.text, "```\n" + md + "\n```");

  // Block 3: context with archive hint.
  const b3 = blocks[2] as SlackContextBlock;
  assertEquals(b3.type, "context");
  assertEquals(b3.elements.length, 1);
  const ctxText = b3.elements[0];
  assert("type" in ctxText && ctxText.type === "mrkdwn");
  assertEquals(
    (ctxText as { type: "mrkdwn"; text: string }).text,
    "💡 *To archive this ADR:* Copy the markdown above and paste it into your team's documentation repository or wiki.",
  );
});

Deno.test("formatADRForSlack — preserves markdown body inside the fenced block", () => {
  const md = "## Decision\n\nThis decision was put to a vote.";
  const blocks = formatADRForSlack(md);
  const b2 = blocks[1] as SlackSectionBlock;
  assertStringIncludes(b2.text?.text ?? "", "## Decision");
  // Sentinel: the leading and trailing fence sequences are present.
  assert(b2.text?.text.startsWith("```\n"));
  assert(b2.text?.text.endsWith("\n```"));
});

// ---------------------------------------------------------------------------
// generateADRMarkdown — quorum-not-met line renders correctly
// ---------------------------------------------------------------------------

Deno.test("generateADRMarkdown — quorum not met emits `(not met)` in vote breakdown", () => {
  const decision = makeDecision();
  const votes: VoteRecord[] = [
    makeVote(decision.id, "U0001", "yes"),
  ];
  const outcome: DecisionResult = {
    passed: false,
    outcome: "rejected",
    reason: "Quorum not met (1 of 3 required)",
    voteCounts: { yes: 1, no: 0, abstain: 0, total: 1 },
    decisiveVotes: 1,
    effectiveRequiredVoters: 4,
    quorum: 3,
    quorumMet: false,
  };
  const md = generateADRMarkdown(
    decision,
    votes,
    [],
    outcome,
    new Map([["U0001", "Alice"]]),
  );

  assertStringIncludes(md, "- Quorum: 3 (not met)");
  assertStringIncludes(md, "**Reason:** Quorum not met (1 of 3 required)");
});

// ---------------------------------------------------------------------------
// formatADRForSlack: tracks SlackBlock discriminated-union shape
// ---------------------------------------------------------------------------

Deno.test("formatADRForSlack — output is typed as SlackBlock[] (compile-time check)", () => {
  const blocks: SlackBlock[] = formatADRForSlack("# x");
  // Trivial runtime assertion to exercise the binding.
  assertEquals(blocks.length, 3);
});
