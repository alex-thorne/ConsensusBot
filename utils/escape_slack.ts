// ConsensusBot v2.0 — Slack-text escape helpers (mrkdwn injection defence).
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §14.3 (escapeSlackText)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §17.1 (backtick neutralisation)
//
// User-supplied strings (decision name, proposal, etc.) flow into Slack
// surfaces (`chat.postMessage`, ADR markdown). Without escaping, a user could
// inject `<@U…>`/`<!channel>`/`<!here>`/`<!everyone>` mentions or break out of
// the ADR triple-backtick code-fence. These helpers are the choke point.

/**
 * §14.3 — Replace `<`, `>`, `&` with their HTML entity equivalents.
 *
 * Order is critical: `&` MUST be escaped FIRST. Otherwise the `&` introduced
 * by the `<` → `&lt;` replacement would itself be re-escaped, yielding
 * `&amp;lt;`. With the order `&`, then `<`, then `>`:
 *   - `<&>` → (& first) `<&amp;>` → (< then) `&lt;&amp;>` → (> then) `&lt;&amp;&gt;`
 *
 * This is sufficient to neutralise `<@U…>`, `<!channel>`, `<!here>`, and
 * `<!everyone>` mentions in user-supplied text.
 */
export function escapeSlackText(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * §17.1 — Replace every triple-backtick sequence with three backslash-escaped
 * backticks (`\`` × 3) to prevent code-fence break-out when user-supplied text
 * is wrapped in a fenced block (the ADR markdown).
 *
 * Single backticks are left untouched: only triples (which open/close fences)
 * are neutralised.
 */
export function neutraliseBackticks(input: string): string {
  return input.replaceAll("```", "\\`\\`\\`");
}
