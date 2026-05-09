// ConsensusBot v2.0 — Slack mrkdwn parsing utilities.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §14.1 — parseUserIds
//   - docs/REDEVELOPMENT_SPECIFICATION.md §14.2 — parseUsergroupInput
//   - docs/REDEVELOPMENT_SPECIFICATION.md §8.1.3 — caller rejects broadcasts
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-103
//
// Two pure functions tokenise mrkdwn voter / usergroup inputs from the
// CreateDecisionWorkflow form. Both accept `string | string[]`; the array
// form is a backward-compatibility hatch for callers that already hold a
// list of raw IDs (e.g. legacy migrations).
//
// Shared tokeniser: split on commas and any whitespace (incl. newlines).
const TOKEN_SEPARATOR = /[\s,]+/;

// Slack user-mention mrkdwn: `<@U123ABC>` or `<@U123ABC|alice>`.
// Capture group 1: the bare user ID.
const USER_MENTION = /^<@([UW][A-Z0-9]+)(?:\|[^>]*)?>$/;

// Bare user ID: U… (workspace user) or W… (Enterprise Grid org user).
// Slack IDs are nine to twelve uppercase alphanumeric chars in practice;
// the SPEC anchors on `[UW][A-Z0-9]{5,}` (≥ 6 chars total) which is
// sufficient to reject most unrelated tokens (e.g. `Tnnnnn` team IDs).
const RAW_USER_ID = /^[UW][A-Z0-9]{5,}$/;

// Slack usergroup mrkdwn: `<!subteam^S123ABC>` or `<!subteam^S123ABC|engineers>`.
const USERGROUP_MENTION = /^<!subteam\^([A-Z0-9]+)(?:\|[^>]*)?>$/;

// Bare usergroup ID: S… (subteam ID).
const RAW_USERGROUP_ID = /^S[A-Z0-9]{5,}$/;

// Broadcast handles. Caller rejects these per SPEC §8.1.3.
const BROADCAST_HANDLE = /^@(here|channel|everyone)$/;

// Generic `@handle` (length > 1). MUST be checked AFTER BROADCAST_HANDLE so
// `@here` is classified as a broadcast, not a handle.
const USERGROUP_HANDLE = /^@(.+)$/;

/** Split a freeform string on commas / whitespace, drop empties. */
function tokenise(input: string): string[] {
  return input.split(TOKEN_SEPARATOR).filter((t) => t.length > 0);
}

/** Order-preserving dedup: returns unique tokens in first-seen order. */
function dedup(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Parse a Slack user-IDs input field.
 *
 * Accepts a freeform string (mrkdwn pasted from Slack, or comma /
 * whitespace / newline-separated raw IDs) or, for the legacy hatch, an
 * already-resolved `string[]`.
 *
 * For each token in the string form, in order:
 *   - `<@U123ABC>` / `<@U123ABC|alice>` → captured ID
 *   - bare `U123ABC` or `W123ABC`       → token itself
 *   - anything else                     → discarded
 *
 * Output is deduplicated, preserving first-seen order.
 *
 * SPEC §14.1.
 */
export function parseUserIds(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return [...new Set(input.filter(Boolean))];
  }

  const out: string[] = [];
  for (const token of tokenise(input)) {
    const mention = token.match(USER_MENTION);
    if (mention) {
      out.push(mention[1]);
      continue;
    }
    if (RAW_USER_ID.test(token)) {
      out.push(token);
      continue;
    }
    // Discard unrecognised tokens silently — the workflow form already
    // surfaces validation errors elsewhere; we don't want to fail-closed
    // on a stray comma.
  }
  return dedup(out);
}

/** Result shape for {@link parseUsergroupInput}. */
export interface UsergroupInput {
  /** Resolved usergroup IDs (S…) — both mrkdwn and bare. */
  ids: string[];
  /** Raw `@handle` strings (the leading `@` stripped). */
  handles: string[];
  /** Broadcast handles `here`, `channel`, `everyone`. Caller MUST reject. */
  broadcasts: string[];
}

/**
 * Parse a Slack usergroup input field.
 *
 * Accepts a freeform string or, for the legacy hatch, an already-resolved
 * `string[]` (treated as raw subteam IDs).
 *
 * For each token in the string form, in order:
 *   - `<!subteam^S123ABC>` / `<!subteam^S123ABC|engineers>` → `ids`
 *   - bare `S123ABC`                                       → `ids`
 *   - `@here` / `@channel` / `@everyone`                   → `broadcasts`
 *     (the bare word, no leading `@`)
 *   - other `@handle` (length > 1)                         → `handles`
 *     (leading `@` stripped)
 *   - anything else                                        → discarded
 *
 * All three output arrays are deduplicated in first-seen order.
 *
 * Broadcasts are surfaced for the caller to reject per SPEC §8.1.3 — they
 * are NOT a valid voter source.
 *
 * SPEC §14.2.
 */
export function parseUsergroupInput(input: string | string[]): UsergroupInput {
  if (Array.isArray(input)) {
    return {
      ids: [...new Set(input.filter(Boolean))],
      handles: [],
      broadcasts: [],
    };
  }

  const ids: string[] = [];
  const handles: string[] = [];
  const broadcasts: string[] = [];

  for (const token of tokenise(input)) {
    const mention = token.match(USERGROUP_MENTION);
    if (mention) {
      ids.push(mention[1]);
      continue;
    }
    if (RAW_USERGROUP_ID.test(token)) {
      ids.push(token);
      continue;
    }
    const broadcast = token.match(BROADCAST_HANDLE);
    if (broadcast) {
      broadcasts.push(broadcast[1]);
      continue;
    }
    const handle = token.match(USERGROUP_HANDLE);
    if (handle && handle[1].length > 0) {
      handles.push(handle[1]);
      continue;
    }
    // Discard unrecognised tokens.
  }

  return {
    ids: dedup(ids),
    handles: dedup(handles),
    broadcasts: dedup(broadcasts),
  };
}
