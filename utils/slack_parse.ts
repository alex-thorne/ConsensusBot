/**
 * Utilities for parsing Slack user/usergroup mentions and IDs from free-text strings.
 *
 * Supports the following input formats (comma, whitespace, or newline separated):
 *   Users:
 *     - Slack mrkdwn mention: <@U123ABC> or <@U123ABC|name>
 *     - Raw user IDs starting with U or W (e.g. U123ABC, W123ABC)
 *   Usergroups:
 *     - Slack mrkdwn subteam mention: <!subteam^S123ABC|eng>
 *     - Raw usergroup IDs starting with S (e.g. S123ABC)
 *     - Usergroup handles: @eng (returned separately for API resolution)
 */

/**
 * Parse a string (or legacy array) of Slack user mentions/IDs into an array of
 * deduplicated user IDs.
 *
 * If given an array (backward compat), returns deduplicated items as-is.
 */
export function parseUserIds(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return [...new Set(input.filter(Boolean))];
  }

  const ids = new Set<string>();

  // Split on commas, whitespace (including newlines)
  const tokens = input.split(/[\s,]+/);

  for (const token of tokens) {
    const t = token.trim();
    if (!t) continue;

    // Match <@UXXXXXXX> or <@UXXXXXXX|displayname>
    const mentionMatch = t.match(/^<@([UW][A-Z0-9]+)(?:\|[^>]*)?>$/);
    if (mentionMatch) {
      ids.add(mentionMatch[1]);
      continue;
    }

    // Raw user ID: starts with U or W, followed by alphanumeric chars
    if (/^[UW][A-Z0-9]{5,}$/.test(t)) {
      ids.add(t);
      continue;
    }
  }

  return Array.from(ids);
}

/**
 * Result of parsing a usergroup input string.
 */
export interface ParsedUsergroupInput {
  /** Resolved usergroup IDs (e.g. S123ABC) */
  ids: string[];
  /** Unresolved handles that need API lookup (e.g. "eng" from @eng) */
  handles: string[];
}

/**
 * Parse a string (or legacy array) of Slack usergroup mentions/IDs into deduplicated
 * usergroup IDs and unresolved handles.
 *
 * If given an array (backward compat), returns deduplicated items as ids with no handles.
 */
export function parseUsergroupInput(
  input: string | string[],
): ParsedUsergroupInput {
  if (Array.isArray(input)) {
    return { ids: [...new Set(input.filter(Boolean))], handles: [] };
  }

  const ids = new Set<string>();
  const handles = new Set<string>();

  // Split on commas, whitespace (including newlines)
  const tokens = input.split(/[\s,]+/);

  for (const token of tokens) {
    const t = token.trim();
    if (!t) continue;

    // Match <!subteam^SXXXXXXX|handle> (Slack mrkdwn usergroup mention)
    const subteamMatch = t.match(/^<!subteam\^([A-Z0-9]+)(?:\|[^>]*)?>$/);
    if (subteamMatch) {
      ids.add(subteamMatch[1]);
      continue;
    }

    // Raw usergroup ID: starts with S followed by alphanumeric chars
    if (/^S[A-Z0-9]{5,}$/.test(t)) {
      ids.add(t);
      continue;
    }

    // @handle — needs API resolution
    if (t.startsWith("@") && t.length > 1) {
      handles.add(t.slice(1));
      continue;
    }
  }

  return { ids: Array.from(ids), handles: Array.from(handles) };
}
