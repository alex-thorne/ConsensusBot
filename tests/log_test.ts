// ConsensusBot v2.0 — Tests for `utils/log.ts`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §23.5
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-106
//
// We monkey-patch `console.log`/`console.warn`/`console.error`, capture the
// emitted line, parse it as JSON, and assert shape. Each test restores the
// original console method in a `try/finally` so a failed assertion cannot
// leave the global console in a captured state.

import { assert, assertEquals } from "@std/assert";
import { log } from "../utils/log.ts";

type ConsoleMethod = "log" | "warn" | "error";

/**
 * Run `fn` with `console[method]` replaced by a capture function. Returns the
 * captured argument list. Restores the original method even if `fn` throws.
 */
function captureConsole(
  method: ConsoleMethod,
  fn: () => void,
): unknown[] {
  const original = console[method];
  const captured: unknown[] = [];
  console[method] = (...args: unknown[]) => {
    captured.push(...args);
  };
  try {
    fn();
  } finally {
    console[method] = original;
  }
  return captured;
}

// ---------------------------------------------------------------------------
// log.info — emits one valid JSON line on stdout (`console.log`)
// ---------------------------------------------------------------------------

Deno.test("log.info — emits exactly one argument to console.log", () => {
  const captured = captureConsole("log", () => {
    log.info({ event: "vote_recorded" });
  });
  assertEquals(captured.length, 1);
});

Deno.test("log.info — emits valid JSON parseable to an object", () => {
  const captured = captureConsole("log", () => {
    log.info({ event: "vote_recorded" });
  });
  const line = captured[0];
  assert(typeof line === "string", "log line should be a string");
  const parsed = JSON.parse(line);
  assert(typeof parsed === "object" && parsed !== null);
});

Deno.test("log.info — JSON has level=info and the supplied event", () => {
  const captured = captureConsole("log", () => {
    log.info({ event: "vote_recorded" });
  });
  const parsed = JSON.parse(captured[0] as string);
  assertEquals(parsed.level, "info");
  assertEquals(parsed.event, "vote_recorded");
});

Deno.test("log.info — merges arbitrary context fields into the JSON object", () => {
  const captured = captureConsole("log", () => {
    log.info({
      event: "vote_recorded",
      decision_id: "11111111-2222-3333-4444-555555555555",
      user_id: "U0001",
      vote_type: "yes",
      voted_at: "2026-05-08T09:00:00.000Z",
    });
  });
  const parsed = JSON.parse(captured[0] as string);
  assertEquals(parsed.level, "info");
  assertEquals(parsed.event, "vote_recorded");
  assertEquals(parsed.decision_id, "11111111-2222-3333-4444-555555555555");
  assertEquals(parsed.user_id, "U0001");
  assertEquals(parsed.vote_type, "yes");
  assertEquals(parsed.voted_at, "2026-05-08T09:00:00.000Z");
});

Deno.test("log.info — line contains no embedded newlines (single-object-per-line invariant)", () => {
  const captured = captureConsole("log", () => {
    log.info({ event: "vote_recorded", decision_id: "abc" });
  });
  const line = captured[0] as string;
  // `console.log` itself adds a trailing newline, but the argument we pass it
  // (the JSON string) must contain no embedded newlines so each log entry
  // remains a single physical line.
  assert(!line.includes("\n"), `log argument contained newline: ${line}`);
});

// ---------------------------------------------------------------------------
// log.warn — uses console.warn (stderr)
// ---------------------------------------------------------------------------

Deno.test("log.warn — emits to console.warn, not console.log", () => {
  const warnCaptured = captureConsole("warn", () => {
    log.warn({ event: "usergroup_handle_unresolved", handle: "@team-eng" });
  });
  assertEquals(warnCaptured.length, 1);
});

Deno.test("log.warn — does NOT emit to console.log", () => {
  const logCaptured = captureConsole("log", () => {
    log.warn({ event: "usergroup_handle_unresolved", handle: "@team-eng" });
  });
  assertEquals(logCaptured.length, 0);
});

Deno.test("log.warn — JSON has level=warn and merged context", () => {
  const captured = captureConsole("warn", () => {
    log.warn({ event: "usergroup_handle_unresolved", handle: "@team-eng" });
  });
  const parsed = JSON.parse(captured[0] as string);
  assertEquals(parsed.level, "warn");
  assertEquals(parsed.event, "usergroup_handle_unresolved");
  assertEquals(parsed.handle, "@team-eng");
});

// ---------------------------------------------------------------------------
// log.error — uses console.error (stderr)
// ---------------------------------------------------------------------------

Deno.test("log.error — emits to console.error, not console.log or console.warn", () => {
  const errorCaptured = captureConsole("error", () => {
    log.error({
      event: "datastore_put_failed",
      datastore: "decisions",
      id: "abc",
      error: "boom",
    });
  });
  assertEquals(errorCaptured.length, 1);
});

Deno.test("log.error — JSON has level=error and merged context", () => {
  const captured = captureConsole("error", () => {
    log.error({
      event: "datastore_put_failed",
      datastore: "decisions",
      id: "abc",
      error: "boom",
    });
  });
  const parsed = JSON.parse(captured[0] as string);
  assertEquals(parsed.level, "error");
  assertEquals(parsed.event, "datastore_put_failed");
  assertEquals(parsed.datastore, "decisions");
  assertEquals(parsed.id, "abc");
  assertEquals(parsed.error, "boom");
});

// ---------------------------------------------------------------------------
// Cross-cutting — non-string context values serialise correctly
// ---------------------------------------------------------------------------

Deno.test("log.info — numeric and boolean context values are preserved as JSON types", () => {
  const captured = captureConsole("log", () => {
    log.info({
      event: "decision_finalised",
      yes_count: 3,
      no_count: 1,
      passed: true,
    });
  });
  const parsed = JSON.parse(captured[0] as string);
  assertEquals(parsed.event, "decision_finalised");
  assertEquals(parsed.yes_count, 3);
  assertEquals(parsed.no_count, 1);
  assertEquals(parsed.passed, true);
});

Deno.test("log.info — null context values are preserved", () => {
  const captured = captureConsole("log", () => {
    log.info({ event: "reminder_sent", error: null });
  });
  const parsed = JSON.parse(captured[0] as string);
  assertEquals(parsed.event, "reminder_sent");
  assertEquals(parsed.error, null);
});
