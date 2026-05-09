// ConsensusBot v2.0 — ADR (Architecture Decision Record) generator.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §17.1 (markdown template)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §17.2 (three-block Slack format)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-201
//
// The §17.1 template is contractual: whitespace, trailing two-space soft
// breaks, and the exact reason / status / outcome strings are pinned by
// `tests/adr_generator_test.ts`. Do not paraphrase.
//
// User-supplied fields (`decision.name`, `decision.proposal`) MUST be passed
// through `escapeSlackText` AND `neutraliseBackticks` before rendering, so a
// malicious payload cannot inject Slack mentions or break out of the ADR
// triple-backtick code-fence (audit §B.30).

import type {
  DecisionRecord,
  VoteHistoryRecord,
  VoteRecord,
  VoterRecord,
} from "../types/decision_types.ts";
import type { SlackBlock } from "../types/slack_types.ts";
import { calculateVoteCounts, type DecisionResult } from "./decision_logic.ts";
import { escapeSlackText, neutraliseBackticks } from "./escape_slack.ts";
import { formatDeadlineHuman } from "./date_utils.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * §17.1 — Build the markdown ADR for a finalised decision.
 *
 * Whitespace and trailing two-space line breaks are significant. User-supplied
 * fields (`name`, `proposal`) are escaped via `escapeSlackText` AND have any
 * triple-backtick sequences neutralised via `neutraliseBackticks` to prevent
 * code-fence break-out when the markdown is wrapped in fences by
 * `formatADRForSlack`.
 *
 * The signature is extended over the SPEC by one optional positional parameter
 * `deactivatedVoters` so the caller in `process_active_decisions` can populate
 * the "Excluded Voters" section without a second datastore read here. When
 * empty (the default), the section renders `_None._` per the SPEC. This
 * extension is documented in the SPEC §17.1 fall-back ("any voters with
 * `is_active: false`") and is purely additive.
 */
export function generateADRMarkdown(
  decision: DecisionRecord,
  votes: VoteRecord[],
  voteHistory: VoteHistoryRecord[],
  outcome: DecisionResult,
  userMap: Map<string, string>,
  deactivatedVoters: VoterRecord[] = [],
): string {
  // --- Inputs derived from the SPEC §17.1 template -------------------------

  const escapedName = escapeSlackText(neutraliseBackticks(decision.name));
  const escapedProposal = escapeSlackText(
    neutraliseBackticks(decision.proposal),
  );

  // §8.5 — `criteriaDisplay` is `success_criteria.replace(/_/g, " ")` then
  // title-cased.
  const criteriaDisplay = formatCriteria(decision.success_criteria);

  // Front-matter date is YYYY-MM-DD (UTC) of `decision.created_at`.
  const dateOnly = decision.created_at.split("T")[0];

  // The outcome envelope already encodes counts/quorum/effective R; recompute
  // counts from the votes array as a defensive cross-check (and so the ADR
  // tally matches the actual votes argument the caller passed in).
  const counts = calculateVoteCounts(votes);
  const decisive = counts.yes + counts.no;
  const rEffective = outcome.effectiveRequiredVoters;
  const quorum = outcome.quorum;
  const quorumMetText = outcome.quorumMet ? "met" : "not met";

  // §19.7 — human-readable deadline e.g. "9 May 2026 at 23:59 BST".
  const deadlineDisplay = formatDeadlineHuman(
    decision.deadline_resolved,
    decision.deadline_tz,
  );

  // --- Section: Status / front-matter --------------------------------------

  const statusText = outcome.passed ? "Accepted" : "Rejected";
  const outcomeText = outcome.passed ? "✅ APPROVED" : "❌ REJECTED";

  // --- Section: Individual Votes ------------------------------------------
  //
  // The latest vote for each voter is what the votes array already represents
  // (votes are upserted in-place per §5.2). Render one bullet per row.

  const individualVotes = votes.map((v) => {
    const emoji = voteEmoji(v.vote_type);
    const display = userMap.get(v.user_id) ?? v.user_id;
    return `- ${emoji} ${display}: ${v.vote_type.toUpperCase()}`;
  }).join("\n");

  // --- Section: Vote History ----------------------------------------------
  //
  // §17.1: list every `event_kind === "changed"` row. If none, emit the
  // italicised placeholder. The SPEC's pseudo-code gates on
  // `voteHistory.length > votes.length` but the operational signal is
  // "any changed event present", which we use directly.

  const changedEvents = voteHistory.filter((h) => h.event_kind === "changed");
  const voteHistorySection = changedEvents.length > 0
    ? "The following voters changed their vote during the decision:\n\n" +
      changedEvents.map((h) => {
        const display = userMap.get(h.user_id) ?? h.user_id;
        const prev = (h.previous_vote_type ?? "").toUpperCase();
        const next = h.vote_type.toUpperCase();
        return `- ${display}: ${prev} → ${next} at ${h.voted_at}`;
      }).join("\n")
    : "_No voters changed their vote._";

  // --- Section: Excluded Voters -------------------------------------------

  const excludedSection = deactivatedVoters.length > 0
    ? "The following voters were deactivated during the decision and excluded from quorum:\n\n" +
      deactivatedVoters.map((v) => `- ${userMap.get(v.user_id) ?? v.user_id}`)
        .join("\n")
    : "_None._";

  // --- Sections: Consequences / Implementation Notes ----------------------

  const ifAccepted = outcome.passed
    ? "This decision has been approved and should be implemented as proposed."
    : "N/A — Decision was not approved.";
  const ifRejected = outcome.passed
    ? "N/A — Decision was approved."
    : "This decision was rejected. The team may revisit this proposal in the future with modifications or abandon it entirely.";
  const implNotes = outcome.passed
    ? "Teams should proceed with implementing the proposal as described in the Context section."
    : "No implementation required as decision was rejected.";

  // --- Section: References -------------------------------------------------
  //
  // "Total Participants" — SPEC §17.1 reads `${voters.length}` but the
  // function signature does not include `voters`. We derive the unique-user
  // count from the votes array (each voter has exactly one row in `votes`,
  // since re-votes upsert in place per §5.2). This matches the operational
  // intent: how many distinct users participated.

  const totalParticipants = new Set(votes.map((v) => v.user_id)).size;

  const finalisedDisplay = decision.finalized_at ?? "";

  // --- Suggested filename --------------------------------------------------

  const slug = slugify(decision.name);
  const idPrefix = decision.id.slice(0, 8);
  const suggestedFilename = `${dateOnly}-${slug}-${idPrefix}.md`;

  // --- Compose the markdown -----------------------------------------------
  //
  // SPEC §17.1 mandates a literal two-space soft break (`  \n`) at the end of
  // certain lines (front-matter rows L1152–1156, the Outcome row L1169, and
  // the auto-generated footer L1229). They render as `<br>` in markdown.
  // We declare `BR` as an explicit constant so editors / formatters cannot
  // accidentally strip the trailing whitespace.

  const BR = "  \n";

  return [
    `# ${escapedName}`,
    "",
    `**Status:** ${statusText}` + BR +
    `**Date:** ${dateOnly}` + BR +
    `**Decision ID:** ${decision.id}` + BR +
    `**Success Criteria:** ${criteriaDisplay}` + BR +
    `**Quorum:** ${quorum} of ${rEffective} required voters` + BR +
    `**Deadline:** ${deadlineDisplay}`,
    "",
    "## Context",
    "",
    escapedProposal,
    "",
    "## Decision",
    "",
    `This decision was put to a vote using the **${criteriaDisplay}** consensus criterion.`,
    "",
    "### Voting Results",
    "",
    `**Outcome:** ${outcomeText}` + BR +
    `**Reason:** ${outcome.reason}`,
    "",
    "**Vote Breakdown:**",
    `- Yes: ${counts.yes}`,
    `- No: ${counts.no}`,
    `- Abstain: ${counts.abstain}`,
    `- Total Votes: ${counts.total}`,
    `- Required Voters (effective): ${rEffective}`,
    `- Decisive Votes (yes+no): ${decisive}`,
    `- Quorum: ${quorum} (${quorumMetText})`,
    "",
    "### Individual Votes",
    "",
    individualVotes,
    "",
    "### Vote History",
    "",
    voteHistorySection,
    "",
    "### Excluded Voters",
    "",
    excludedSection,
    "",
    "## Consequences",
    "",
    "### If Accepted",
    "",
    ifAccepted,
    "",
    "### If Rejected",
    "",
    ifRejected,
    "",
    "## Implementation Notes",
    "",
    implNotes,
    "",
    "## References",
    "",
    `- **Decision Created:** ${decision.created_at}`,
    `- **Deadline Resolved:** ${decision.deadline_resolved} (${decision.deadline_tz})`,
    `- **Finalised:** ${finalisedDisplay}`,
    `- **Creator:** <@${decision.creator_id}>`,
    `- **Total Participants:** ${totalParticipants}`,
    "",
    "---",
    "",
    "*This ADR was automatically generated by ConsensusBot*" + BR +
    `*Suggested filename: \`${suggestedFilename}\`*`,
  ].join("\n");
}

/**
 * §17.2 — Wrap the rendered markdown in the three-block Slack layout.
 *
 * The exact strings are asserted by `tests/adr_generator_test.ts`; do not
 * reword. Backticks in the markdown body are expected to have been
 * neutralised by `generateADRMarkdown` so the fence cannot be broken.
 */
export function formatADRForSlack(adrMarkdown: string): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "📝 *Architecture Decision Record Generated*\n\nThe decision has been finalised. Below is the ADR markdown that can be copied to your documentation repository:",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "```\n" + adrMarkdown + "\n```",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            "💡 *To archive this ADR:* Copy the markdown above and paste it into your team's documentation repository or wiki.",
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map a `VoteType` to its leading emoji per §17.1 ("Individual Votes").
 *   yes → ✅, no → ❌, abstain → ⚪.
 */
function voteEmoji(voteType: string): string {
  if (voteType === "yes") return "✅";
  if (voteType === "no") return "❌";
  return "⚪";
}

/**
 * §8.5 — `success_criteria.replace(/_/g, " ").replace(/\b\w/g, l =>
 * l.toUpperCase())`. e.g. `simple_majority` → `Simple Majority`.
 */
function formatCriteria(criteria: string): string {
  return criteria
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * §17.1 — `name.toLowerCase().replace(/[^a-z0-9]+/g, "-")` plus a leading /
 * trailing `-` strip. ASCII-only fold; non-ASCII characters become a hyphen.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
