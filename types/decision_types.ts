// ConsensusBot v2.0 — Datastore record types.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §5.1 (decisions)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §5.2 (votes)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §5.3 (voters)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §5.4 (vote_history)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §5.5 (TypeScript record types)

/**
 * Domain literal for `vote_type` across votes and vote_history (§5.2, §5.4).
 * Stored without any `vote_` prefix.
 */
export type VoteType = "yes" | "no" | "abstain";

/**
 * Domain literal for `success_criteria` on a decision (§5.1).
 */
export type SuccessCriteria =
  | "simple_majority"
  | "super_majority"
  | "unanimous";

/**
 * Domain literal for `status` on a decision (§5.1).
 * Note that `"deleted"` is NOT a status; deletion removes the row (§11).
 */
export type DecisionStatus = "active" | "approved" | "rejected" | "cancelled";

/**
 * Domain literal for `event_kind` on a vote_history row (§5.4).
 */
export type VoteHistoryEventKind = "cast" | "changed";

/**
 * Row in the `decisions` datastore (§5.1).
 *
 * The primary key `id` is generated server-side via `crypto.randomUUID()` and
 * is decoupled from `message_ts`. `quorum` and `required_voters_count` are
 * snapshots at create time so the vote handler does not requery.
 */
export interface DecisionRecord {
  /** UUID primary key. Decoupled from `message_ts`. */
  id: string;
  /** User-supplied title; escaped on render. */
  name: string;
  /** User-supplied proposal body; escaped on render. */
  proposal: string;
  /** One of the three success criteria. */
  success_criteria: SuccessCriteria;
  /** Effective quorum at create time (see §15). */
  quorum: number;
  /** Snapshot at create time so the vote handler doesn't requery. */
  required_voters_count: number;
  /** Raw `YYYY-MM-DD` picked by the user; retained for audit. */
  deadline: string;
  /** Resolved end-of-day timestamp in workspace tz; ISO-8601 with offset. */
  deadline_resolved: string;
  /** IANA tz name used to resolve the deadline (e.g. `Europe/London`). */
  deadline_tz: string;
  /** Channel where the voting message was posted. */
  channel_id: string;
  /** Slack user id of the person who ran `/consensus`. */
  creator_id: string;
  /** Slack `message.ts` of the voting message; updated post-create. */
  message_ts: string;
  /** Lifecycle status of the decision. */
  status: DecisionStatus;
  /**
   * Human-readable reason set on finalisation (e.g. `"tied"`, `"deadlocked"`,
   * `"quorum not met"`). Optional while `status === "active"`.
   */
  outcome_reason?: string;
  /**
   * ISO-8601 timestamp set immediately before the ADR post; nil while active.
   * Acts as the idempotency token preventing double-finalisation (§16.3).
   */
  finalized_at?: string;
  /** ISO-8601 timestamp at create time. */
  created_at: string;
  /** ISO-8601 timestamp updated on every status transition. */
  updated_at: string;
}

/**
 * Row in the `votes` datastore — latest state (§5.2).
 *
 * The primary key is `${decision_id}_${user_id}`; re-voting overwrites in
 * place. Every change is also appended to `vote_history`.
 */
export interface VoteRecord {
  /** Composite key `${decision_id}_${user_id}`. */
  id: string;
  /** Foreign key to `decisions.id`. */
  decision_id: string;
  /** Slack user id of the voter. */
  user_id: string;
  /** The current vote selection. */
  vote_type: VoteType;
  /** ISO-8601 timestamp of the most recent vote. */
  voted_at: string;
}

/**
 * Row in the `voters` datastore (§5.3).
 *
 * The voters list is a point-in-time snapshot taken at decision creation;
 * usergroup/channel membership is not re-evaluated. `is_active` flips to
 * `false` when `users.info` later reports `deleted: true` (§18).
 */
export interface VoterRecord {
  /** Composite key `${decision_id}_${user_id}`. */
  id: string;
  /** Foreign key to `decisions.id`. */
  decision_id: string;
  /** Slack user id of a required voter. */
  user_id: string;
  /** `true` at create; `false` after detected deactivation. */
  is_active: boolean;
  /** ISO-8601 timestamp at insert time. */
  created_at: string;
}

/**
 * Row in the `vote_history` datastore — append-only event log (§5.4).
 *
 * The primary key encodes a zero-padded event sequence so each click yields
 * a distinct row. `previous_vote_type` is absent on the first vote.
 */
export interface VoteHistoryRecord {
  /** Composite key `${decision_id}_${user_id}_${event_seq}`. */
  id: string;
  /** Foreign key to `decisions.id`. */
  decision_id: string;
  /** Slack user id. */
  user_id: string;
  /** The vote selection recorded for this event. */
  vote_type: VoteType;
  /** The prior `vote_type`; absent on first vote (§5.4: `null` on first vote). */
  previous_vote_type?: VoteType;
  /** `"cast"` for the first vote, `"changed"` for an overwrite. */
  event_kind: VoteHistoryEventKind;
  /** ISO-8601 timestamp of the event. */
  voted_at: string;
}

/**
 * Backward-compatibility alias for `DecisionRecord` (§5.5).
 *
 * Older modules referenced `DecisionItem`; new code SHOULD use
 * `DecisionRecord` directly.
 */
export type DecisionItem = DecisionRecord;
