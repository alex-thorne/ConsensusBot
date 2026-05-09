// ConsensusBot v2.0 — Tests for `utils/escape_slack.ts`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §14.3 (escapeSlackText)
//   - docs/REDEVELOPMENT_SPECIFICATION.md §17.1 (neutraliseBackticks)
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-106
//
// These tests pin the spec: each escape rule, mention neutralisation,
// no-double-escape ordering, and triple-backtick fence-break defence.

import { assertEquals } from "@std/assert";
import { escapeSlackText, neutraliseBackticks } from "../utils/escape_slack.ts";

// ---------------------------------------------------------------------------
// escapeSlackText — primitive characters
// ---------------------------------------------------------------------------

Deno.test("escapeSlackText — `<` becomes `&lt;`", () => {
  assertEquals(escapeSlackText("<"), "&lt;");
});

Deno.test("escapeSlackText — `>` becomes `&gt;`", () => {
  assertEquals(escapeSlackText(">"), "&gt;");
});

Deno.test("escapeSlackText — `&` becomes `&amp;`", () => {
  assertEquals(escapeSlackText("&"), "&amp;");
});

Deno.test("escapeSlackText — empty string is preserved", () => {
  assertEquals(escapeSlackText(""), "");
});

Deno.test("escapeSlackText — plain ASCII passes through unchanged", () => {
  assertEquals(
    escapeSlackText("Hello world, no special chars here!"),
    "Hello world, no special chars here!",
  );
});

// ---------------------------------------------------------------------------
// escapeSlackText — Slack mention neutralisation (the whole point of §14.3)
// ---------------------------------------------------------------------------

Deno.test("escapeSlackText — neutralises user mention `<@U123>`", () => {
  assertEquals(escapeSlackText("<@U123>"), "&lt;@U123&gt;");
});

Deno.test("escapeSlackText — neutralises `<!channel>` broadcast", () => {
  assertEquals(escapeSlackText("<!channel>"), "&lt;!channel&gt;");
});

Deno.test("escapeSlackText — neutralises `<!here>` broadcast", () => {
  assertEquals(escapeSlackText("<!here>"), "&lt;!here&gt;");
});

Deno.test("escapeSlackText — neutralises `<!everyone>` broadcast", () => {
  assertEquals(escapeSlackText("<!everyone>"), "&lt;!everyone&gt;");
});

Deno.test("escapeSlackText — mixed mention + ampersand content", () => {
  assertEquals(
    escapeSlackText("Hello <@U123> & <!channel>"),
    "Hello &lt;@U123&gt; &amp; &lt;!channel&gt;",
  );
});

// ---------------------------------------------------------------------------
// escapeSlackText — ordering: no double-escape of the entities we introduce
// ---------------------------------------------------------------------------

Deno.test("escapeSlackText — `<&>` → `&lt;&amp;&gt;` (ordering correct, no double-escape of introduced `&`)", () => {
  // If `<` were escaped before `&`, the `&` introduced by `&lt;` would itself
  // be re-escaped, giving `&amp;lt;...`. The correct sequence (& first) leaves
  // the introduced ampersands alone.
  assertEquals(escapeSlackText("<&>"), "&lt;&amp;&gt;");
});

Deno.test("escapeSlackText — input `&amp;` deliberately becomes `&amp;amp;` (idempotency NOT a goal)", () => {
  // Per the task brief: this is the expected behaviour. The function is a
  // single-pass escape; a literal `&` in the input is escaped, regardless of
  // whether it happens to spell a pre-existing entity. Callers MUST NOT
  // double-escape by passing already-escaped text in.
  assertEquals(escapeSlackText("&amp;"), "&amp;amp;");
});

Deno.test("escapeSlackText — repeated calls compound (one-shot, not idempotent)", () => {
  // Documenting the contract: callers MUST escape exactly once.
  const once = escapeSlackText("<");
  assertEquals(once, "&lt;");
  assertEquals(escapeSlackText(once), "&amp;lt;");
});

// ---------------------------------------------------------------------------
// neutraliseBackticks — fence break-out defence
// ---------------------------------------------------------------------------

Deno.test("neutraliseBackticks — empty string is preserved", () => {
  assertEquals(neutraliseBackticks(""), "");
});

Deno.test("neutraliseBackticks — single backticks are NOT touched", () => {
  assertEquals(neutraliseBackticks("`code`"), "`code`");
});

Deno.test("neutraliseBackticks — double backticks are NOT touched", () => {
  assertEquals(neutraliseBackticks("``code``"), "``code``");
});

Deno.test("neutraliseBackticks — single triple-backtick fence is escaped", () => {
  assertEquals(
    neutraliseBackticks("```code```"),
    "\\`\\`\\`code\\`\\`\\`",
  );
});

Deno.test("neutraliseBackticks — multiple triple-backtick fences are all escaped", () => {
  assertEquals(
    neutraliseBackticks("foo ``` bar ``` baz"),
    "foo \\`\\`\\` bar \\`\\`\\` baz",
  );
});

Deno.test("neutraliseBackticks — quadruple backticks: triple is escaped, fourth left as a single", () => {
  // `````` (4 backticks) = ``` (escaped) + ` (untouched).
  assertEquals(neutraliseBackticks("````"), "\\`\\`\\``");
});

Deno.test("neutraliseBackticks — text without any backticks passes through unchanged", () => {
  assertEquals(
    neutraliseBackticks("Plain proposal text, no fences."),
    "Plain proposal text, no fences.",
  );
});
