// ConsensusBot v2.0 — Tests for `utils/date_utils.ts` (tz-aware date utilities).
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §19
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-102
//
// Acceptance:
//   deno check utils/date_utils.ts
//   deno test --allow-read --allow-env tests/date_utils_test.ts

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  addBusinessDays,
  formatDate,
  formatDeadlineHuman,
  getDefaultDeadline,
  getWorkspaceTz,
  isDeadlinePassed,
  resolveDeadline,
} from "../utils/date_utils.ts";
import type { SlackClient, TeamInfoResponse } from "../types/slack_types.ts";
import type { DecisionRecord } from "../types/decision_types.ts";

// ---------------------------------------------------------------------------
// addBusinessDays
// ---------------------------------------------------------------------------

Deno.test("addBusinessDays — Friday + 1 = Monday (skips weekend)", () => {
  // Friday 8 May 2026 (UTC date irrelevant; we work with weekday).
  const friday = new Date("2026-05-08T12:00:00Z");
  assertEquals(friday.getDay(), 5);

  const result = addBusinessDays(1, friday);
  assertEquals(result.getDay(), 1, "should land on Monday");
  // Three calendar days later: Fri -> Sat -> Sun -> Mon.
  assertEquals(
    Math.round((result.getTime() - friday.getTime()) / 86_400_000),
    3,
  );
});

Deno.test("addBusinessDays — Monday + 5 lands on the following Monday (skips one weekend)", () => {
  // Monday 4 May 2026.
  const monday = new Date("2026-05-04T12:00:00Z");
  assertEquals(monday.getDay(), 1);

  const result = addBusinessDays(5, monday);
  assertEquals(result.getDay(), 1, "should land on next Monday");
  // Seven calendar days later (5 weekdays + 1 weekend).
  assertEquals(
    Math.round((result.getTime() - monday.getTime()) / 86_400_000),
    7,
  );
});

Deno.test("addBusinessDays — does not mutate the input Date", () => {
  const start = new Date("2026-05-08T12:00:00Z");
  const startMs = start.getTime();
  addBusinessDays(3, start);
  assertEquals(start.getTime(), startMs);
});

Deno.test("addBusinessDays — Saturday start: +1 lands on Monday (weekend day not counted)", () => {
  const saturday = new Date("2026-05-09T12:00:00Z");
  assertEquals(saturday.getDay(), 6);

  const result = addBusinessDays(1, saturday);
  assertEquals(result.getDay(), 1, "Sat -> Sun (skip) -> Mon (count) = Monday");
});

// ---------------------------------------------------------------------------
// getDefaultDeadline
// ---------------------------------------------------------------------------

Deno.test("getDefaultDeadline — returns YYYY-MM-DD format for Europe/London", () => {
  const deadline = getDefaultDeadline("Europe/London");
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(deadline),
    `expected YYYY-MM-DD, got ${deadline}`,
  );
});

Deno.test("getDefaultDeadline — returns YYYY-MM-DD format for America/New_York", () => {
  const deadline = getDefaultDeadline("America/New_York");
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(deadline),
    `expected YYYY-MM-DD, got ${deadline}`,
  );
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

Deno.test("formatDate — Date input round-trips to YYYY-MM-DD", () => {
  const date = new Date("2026-05-09T22:59:59.999Z");
  assertEquals(formatDate(date), "2026-05-09");
});

Deno.test("formatDate — ISO string input round-trips to YYYY-MM-DD", () => {
  assertEquals(formatDate("2026-05-09T22:59:59.999Z"), "2026-05-09");
});

Deno.test("formatDate — UTC date with no time", () => {
  assertEquals(formatDate("2026-12-09T23:59:59.999Z"), "2026-12-09");
});

// ---------------------------------------------------------------------------
// resolveDeadline — BST (Europe/London in May)
// ---------------------------------------------------------------------------

Deno.test("resolveDeadline — Europe/London BST: 2026-05-09 → UTC 22:59:59.999Z", () => {
  const result = resolveDeadline("2026-05-09", "Europe/London");
  // BST is UTC+1, so 23:59:59.999 BST = 22:59:59.999 UTC.
  assert(
    result.iso.endsWith("22:59:59.999Z"),
    `iso should end with 22:59:59.999Z, got ${result.iso}`,
  );
  assertEquals(result.tz, "Europe/London");
  assertStringIncludes(result.humanDisplay, "BST");
  assertStringIncludes(result.humanDisplay, "23:59");
});

// ---------------------------------------------------------------------------
// resolveDeadline — GMT (Europe/London in December)
// ---------------------------------------------------------------------------

Deno.test("resolveDeadline — Europe/London GMT: 2026-12-09 → UTC 23:59:59.999Z", () => {
  const result = resolveDeadline("2026-12-09", "Europe/London");
  // GMT is UTC+0, so 23:59:59.999 GMT = 23:59:59.999 UTC.
  assert(
    result.iso.endsWith("23:59:59.999Z"),
    `iso should end with 23:59:59.999Z, got ${result.iso}`,
  );
  assertEquals(result.tz, "Europe/London");
  assertStringIncludes(result.humanDisplay, "GMT");
  assertStringIncludes(result.humanDisplay, "23:59");
});

// ---------------------------------------------------------------------------
// resolveDeadline — verify ISO is parseable back to the same UTC instant.
// ---------------------------------------------------------------------------

Deno.test("resolveDeadline — iso is a valid ISO-8601 UTC instant", () => {
  const bst = resolveDeadline("2026-05-09", "Europe/London");
  const gmt = resolveDeadline("2026-12-09", "Europe/London");
  assert(!Number.isNaN(new Date(bst.iso).getTime()));
  assert(!Number.isNaN(new Date(gmt.iso).getTime()));
  assert(bst.iso.endsWith("Z"));
  assert(gmt.iso.endsWith("Z"));
});

// ---------------------------------------------------------------------------
// resolveDeadline — non-Europe/London tz still works (DST-aware sanity check).
// ---------------------------------------------------------------------------

Deno.test("resolveDeadline — America/New_York EDT: 2026-05-09 → UTC 03:59:59.999Z next day", () => {
  // EDT is UTC-4, so 23:59:59.999 EDT on 2026-05-09 = 03:59:59.999 UTC on 2026-05-10.
  const result = resolveDeadline("2026-05-09", "America/New_York");
  assertEquals(result.tz, "America/New_York");
  assert(
    result.iso.startsWith("2026-05-10T03:59:59"),
    `expected 2026-05-10T03:59:59…Z, got ${result.iso}`,
  );
});

// ---------------------------------------------------------------------------
// isDeadlinePassed
// ---------------------------------------------------------------------------

function makeDecision(overrides: Partial<DecisionRecord>): DecisionRecord {
  return {
    id: "decision-uuid",
    name: "Test",
    proposal: "Test proposal",
    success_criteria: "simple_majority",
    quorum: 1,
    required_voters_count: 1,
    deadline: "2026-05-09",
    deadline_resolved: "2026-05-09T22:59:59.999Z",
    deadline_tz: "Europe/London",
    channel_id: "C0123456789",
    creator_id: "U0001",
    message_ts: "1715170800.000100",
    status: "active",
    created_at: "2026-05-08T09:00:00.000Z",
    updated_at: "2026-05-08T09:00:00.000Z",
    ...overrides,
  };
}

Deno.test("isDeadlinePassed — true for a past tz-resolved deadline", () => {
  const past = makeDecision({
    deadline_resolved: "2020-01-01T00:00:00.000Z",
  });
  assertEquals(isDeadlinePassed(past), true);
});

Deno.test("isDeadlinePassed — false for a future tz-resolved deadline", () => {
  // A century in the future is safely beyond any reasonable test clock.
  const future = makeDecision({
    deadline_resolved: "2126-01-01T00:00:00.000Z",
  });
  assertEquals(isDeadlinePassed(future), false);
});

// ---------------------------------------------------------------------------
// formatDeadlineHuman
// ---------------------------------------------------------------------------

Deno.test("formatDeadlineHuman — BST: contains year, time, BST abbreviation", () => {
  const human = formatDeadlineHuman(
    "2026-05-09T22:59:59.999Z",
    "Europe/London",
  );
  assertStringIncludes(human, "2026");
  assertStringIncludes(human, "May");
  assertStringIncludes(human, "23:59");
  assertStringIncludes(human, "BST");
});

Deno.test("formatDeadlineHuman — GMT: contains year, time, GMT abbreviation", () => {
  const human = formatDeadlineHuman(
    "2026-12-09T23:59:59.999Z",
    "Europe/London",
  );
  assertStringIncludes(human, "2026");
  assertStringIncludes(human, "December");
  assertStringIncludes(human, "23:59");
  assertStringIncludes(human, "GMT");
});

Deno.test("formatDeadlineHuman — uses ' at ' separator (per SPEC §19.4 example)", () => {
  const human = formatDeadlineHuman(
    "2026-05-09T22:59:59.999Z",
    "Europe/London",
  );
  // SPEC example: "9 May 2026 at 23:59 BST".
  assertStringIncludes(human, " at 23:59");
});

// ---------------------------------------------------------------------------
// getWorkspaceTz — minimal SlackClient stub
// ---------------------------------------------------------------------------

/**
 * Builds a stub `SlackClient` that only implements `team.info`. All other
 * surface methods throw if invoked; `getWorkspaceTz` does not touch them.
 */
function makeClientWithTeamInfo(
  response: TeamInfoResponse | (() => Promise<TeamInfoResponse>),
): SlackClient {
  const teamInfo = typeof response === "function"
    ? response
    : () => Promise.resolve(response);
  const notImplemented = (): never => {
    throw new Error("not implemented in stub");
  };
  return {
    apps: {
      datastore: {
        get: notImplemented,
        put: notImplemented,
        query: notImplemented,
        delete: notImplemented,
      },
    },
    chat: {
      postMessage: notImplemented,
      postEphemeral: notImplemented,
      update: notImplemented,
      delete: notImplemented,
    },
    users: { info: notImplemented },
    conversations: { members: notImplemented },
    pins: {
      list: notImplemented,
      add: notImplemented,
      remove: notImplemented,
    },
    usergroups: {
      list: notImplemented,
      users: { list: notImplemented },
    },
    team: { info: teamInfo },
  };
}

Deno.test("getWorkspaceTz — returns team.tz when present", async () => {
  const client = makeClientWithTeamInfo({
    ok: true,
    team: { id: "T1", name: "Acme", tz: "America/Los_Angeles" },
  });
  assertEquals(await getWorkspaceTz(client), "America/Los_Angeles");
});

Deno.test("getWorkspaceTz — falls back to Europe/London when team.tz missing", async () => {
  const client = makeClientWithTeamInfo({ ok: true, team: { id: "T1" } });
  assertEquals(await getWorkspaceTz(client), "Europe/London");
});

Deno.test("getWorkspaceTz — falls back to Europe/London when team.info throws", async () => {
  const client = makeClientWithTeamInfo(() => {
    throw new Error("network down");
  });
  assertEquals(await getWorkspaceTz(client), "Europe/London");
});

Deno.test("getWorkspaceTz — falls back to Europe/London when team is undefined", async () => {
  const client = makeClientWithTeamInfo({ ok: false, error: "not_authed" });
  assertEquals(await getWorkspaceTz(client), "Europe/London");
});
