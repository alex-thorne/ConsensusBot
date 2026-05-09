// ConsensusBot v2.0 — Tests for `utils/slack_parse.ts`.
//
// SPEC sources of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §14.1, §14.2
//   - docs/REDEVELOPMENT_BUILD_PLAN.md T-103
//
// These tests pin the parsing contracts. Re-development must keep every
// assertion green.

import { assertEquals } from "@std/assert";
import { parseUsergroupInput, parseUserIds } from "../utils/slack_parse.ts";

// ---------------------------------------------------------------------------
// parseUserIds — string inputs
// ---------------------------------------------------------------------------

Deno.test("parseUserIds — single mrkdwn mention <@U…> returns the captured ID", () => {
  assertEquals(parseUserIds("<@U123ABCDEF>"), ["U123ABCDEF"]);
});

Deno.test("parseUserIds — single bare U-prefixed ID is kept as-is", () => {
  assertEquals(parseUserIds("U123ABC"), ["U123ABC"]);
});

Deno.test("parseUserIds — single bare W-prefixed (Enterprise Grid) ID is kept as-is", () => {
  assertEquals(parseUserIds("W123ABC"), ["W123ABC"]);
});

Deno.test("parseUserIds — mention with display name <@U…|alice> strips the label", () => {
  assertEquals(parseUserIds("<@U123ABC|alice>"), ["U123ABC"]);
});

Deno.test("parseUserIds — comma-separated tokens are all parsed", () => {
  assertEquals(
    parseUserIds("<@U1ABCDE>, <@U2ABCDE>, U3ABCDE"),
    ["U1ABCDE", "U2ABCDE", "U3ABCDE"],
  );
});

Deno.test("parseUserIds — whitespace-separated tokens are all parsed", () => {
  assertEquals(
    parseUserIds("<@U1ABCDE> <@U2ABCDE> U3ABCDE"),
    ["U1ABCDE", "U2ABCDE", "U3ABCDE"],
  );
});

Deno.test("parseUserIds — newline-separated tokens are all parsed", () => {
  assertEquals(
    parseUserIds("<@U1ABCDE>\n<@U2ABCDE>\nU3ABCDE"),
    ["U1ABCDE", "U2ABCDE", "U3ABCDE"],
  );
});

Deno.test("parseUserIds — mixed comma + whitespace + newline separators are all parsed", () => {
  assertEquals(
    parseUserIds("<@U1ABCDE>,\t<@U2ABCDE|alice>\n  U3ABCDE,W4ABCDE"),
    ["U1ABCDE", "U2ABCDE", "U3ABCDE", "W4ABCDE"],
  );
});

Deno.test("parseUserIds — duplicates collapse, first-seen order preserved", () => {
  assertEquals(
    parseUserIds("<@U1ABCDE> U1ABCDE U1ABCDE"),
    ["U1ABCDE"],
  );
});

Deno.test("parseUserIds — duplicates across mention and raw form collapse to one", () => {
  assertEquals(
    parseUserIds("<@U1ABCDE|alice> U1ABCDE <@U1ABCDE>"),
    ["U1ABCDE"],
  );
});

Deno.test("parseUserIds — empty string returns []", () => {
  assertEquals(parseUserIds(""), []);
});

Deno.test("parseUserIds — pure whitespace returns []", () => {
  assertEquals(parseUserIds("   \t \n  "), []);
});

Deno.test("parseUserIds — discards garbage tokens", () => {
  assertEquals(parseUserIds("garbage"), []);
});

Deno.test("parseUserIds — discards team IDs (T…) and other non-user prefixes", () => {
  assertEquals(parseUserIds("T1ABCDE C1ABCDE S1ABCDE"), []);
});

Deno.test("parseUserIds — discards lower-case ids (ID format is case-sensitive)", () => {
  assertEquals(parseUserIds("u123abc"), []);
});

Deno.test("parseUserIds — discards malformed mentions", () => {
  // Missing closing `>`, missing `@`, lower-case prefix, etc.
  assertEquals(
    parseUserIds("<@U1ABCDE <U1ABCDE> <@u1abcde> @U1ABCDE"),
    [],
  );
});

Deno.test("parseUserIds — discards too-short bare IDs (< 6 chars after prefix marker)", () => {
  // `[UW][A-Z0-9]{5,}` requires ≥ 6 chars total. `U1` and `UA` are too short.
  assertEquals(parseUserIds("U1 UA U12 U1234"), []);
});

Deno.test("parseUserIds — keeps valid IDs interleaved with garbage", () => {
  assertEquals(
    parseUserIds("garbage <@U1ABCDE> noise U2ABCDE T3ABCDE W4ABCDE"),
    ["U1ABCDE", "U2ABCDE", "W4ABCDE"],
  );
});

// ---------------------------------------------------------------------------
// parseUserIds — array hatch
// ---------------------------------------------------------------------------

Deno.test("parseUserIds — array hatch: dedups and drops falsy values", () => {
  assertEquals(
    parseUserIds(["U1ABCDE", "U2ABCDE", "", "U2ABCDE"]),
    ["U1ABCDE", "U2ABCDE"],
  );
});

Deno.test("parseUserIds — empty array returns []", () => {
  assertEquals(parseUserIds([]), []);
});

Deno.test("parseUserIds — array hatch: passes through whatever it's given (no token validation)", () => {
  // The array hatch is a backward-compat path for callers that already
  // hold raw IDs. It does NOT re-validate format — only filters falsy
  // and dedups.
  assertEquals(
    parseUserIds(["U1ABCDE", "garbage", "U1ABCDE"]),
    ["U1ABCDE", "garbage"],
  );
});

// ---------------------------------------------------------------------------
// parseUsergroupInput — string inputs (IDs)
// ---------------------------------------------------------------------------

Deno.test("parseUsergroupInput — mrkdwn group <!subteam^S…> populates ids only", () => {
  assertEquals(parseUsergroupInput("<!subteam^S123ABC>"), {
    ids: ["S123ABC"],
    handles: [],
    broadcasts: [],
  });
});

Deno.test("parseUsergroupInput — mrkdwn group with handle <!subteam^S…|engineers> strips the label", () => {
  assertEquals(parseUsergroupInput("<!subteam^S123ABC|engineers>"), {
    ids: ["S123ABC"],
    handles: [],
    broadcasts: [],
  });
});

Deno.test("parseUsergroupInput — bare S-prefixed ID populates ids", () => {
  assertEquals(parseUsergroupInput("S123ABC"), {
    ids: ["S123ABC"],
    handles: [],
    broadcasts: [],
  });
});

Deno.test("parseUsergroupInput — multiple ids dedup across mrkdwn and bare forms", () => {
  assertEquals(
    parseUsergroupInput(
      "<!subteam^S1ABCDE|engineers> S1ABCDE <!subteam^S2ABCDE>",
    ),
    {
      ids: ["S1ABCDE", "S2ABCDE"],
      handles: [],
      broadcasts: [],
    },
  );
});

// ---------------------------------------------------------------------------
// parseUsergroupInput — handles
// ---------------------------------------------------------------------------

Deno.test("parseUsergroupInput — single handle @engineers populates handles", () => {
  assertEquals(parseUsergroupInput("@engineers"), {
    ids: [],
    handles: ["engineers"],
    broadcasts: [],
  });
});

Deno.test("parseUsergroupInput — multiple handles populate handles in order", () => {
  assertEquals(
    parseUsergroupInput("@engineers @design @qa"),
    {
      ids: [],
      handles: ["engineers", "design", "qa"],
      broadcasts: [],
    },
  );
});

Deno.test("parseUsergroupInput — handles dedup, first-seen order preserved", () => {
  assertEquals(
    parseUsergroupInput("@engineers @engineers @design"),
    {
      ids: [],
      handles: ["engineers", "design"],
      broadcasts: [],
    },
  );
});

Deno.test("parseUsergroupInput — bare `@` (length 1) is discarded, not classed as a handle", () => {
  assertEquals(parseUsergroupInput("@"), {
    ids: [],
    handles: [],
    broadcasts: [],
  });
});

// ---------------------------------------------------------------------------
// parseUsergroupInput — mixed handles and ids
// ---------------------------------------------------------------------------

Deno.test("parseUsergroupInput — mixed handles + ids classify correctly", () => {
  assertEquals(
    parseUsergroupInput(
      "@engineers, <!subteam^S1ABCDE|design>, @qa, S2ABCDE",
    ),
    {
      ids: ["S1ABCDE", "S2ABCDE"],
      handles: ["engineers", "qa"],
      broadcasts: [],
    },
  );
});

Deno.test("parseUsergroupInput — mixed across newlines + commas + whitespace", () => {
  assertEquals(
    parseUsergroupInput(
      "@engineers\n<!subteam^S1ABCDE>,@design\tS2ABCDE\n@qa",
    ),
    {
      ids: ["S1ABCDE", "S2ABCDE"],
      handles: ["engineers", "design", "qa"],
      broadcasts: [],
    },
  );
});

// ---------------------------------------------------------------------------
// parseUsergroupInput — broadcasts
// ---------------------------------------------------------------------------

Deno.test("parseUsergroupInput — @here is a broadcast (NOT a handle)", () => {
  assertEquals(parseUsergroupInput("@here"), {
    ids: [],
    handles: [],
    broadcasts: ["here"],
  });
});

Deno.test("parseUsergroupInput — @channel is a broadcast", () => {
  assertEquals(parseUsergroupInput("@channel"), {
    ids: [],
    handles: [],
    broadcasts: ["channel"],
  });
});

Deno.test("parseUsergroupInput — @everyone is a broadcast", () => {
  assertEquals(parseUsergroupInput("@everyone"), {
    ids: [],
    handles: [],
    broadcasts: ["everyone"],
  });
});

Deno.test("parseUsergroupInput — all three broadcasts populate broadcasts in order", () => {
  assertEquals(
    parseUsergroupInput("@here @channel @everyone"),
    {
      ids: [],
      handles: [],
      broadcasts: ["here", "channel", "everyone"],
    },
  );
});

Deno.test("parseUsergroupInput — broadcasts dedup", () => {
  assertEquals(
    parseUsergroupInput("@here @here @channel @here"),
    {
      ids: [],
      handles: [],
      broadcasts: ["here", "channel"],
    },
  );
});

Deno.test("parseUsergroupInput — broadcasts mixed with real handles classify correctly", () => {
  assertEquals(
    parseUsergroupInput("@here @engineers @channel @design @everyone"),
    {
      ids: [],
      handles: ["engineers", "design"],
      broadcasts: ["here", "channel", "everyone"],
    },
  );
});

Deno.test("parseUsergroupInput — broadcasts mixed with ids and handles", () => {
  assertEquals(
    parseUsergroupInput(
      "@here, <!subteam^S1ABCDE|engineers>, @design, S2ABCDE, @channel",
    ),
    {
      ids: ["S1ABCDE", "S2ABCDE"],
      handles: ["design"],
      broadcasts: ["here", "channel"],
    },
  );
});

// ---------------------------------------------------------------------------
// parseUsergroupInput — array hatch
// ---------------------------------------------------------------------------

Deno.test("parseUsergroupInput — array hatch: treats as ids only", () => {
  assertEquals(
    parseUsergroupInput(["S1ABC", "S2ABC"]),
    {
      ids: ["S1ABC", "S2ABC"],
      handles: [],
      broadcasts: [],
    },
  );
});

Deno.test("parseUsergroupInput — array hatch: dedups and drops falsy", () => {
  assertEquals(
    parseUsergroupInput(["S1ABC", "", "S2ABC", "S1ABC"]),
    {
      ids: ["S1ABC", "S2ABC"],
      handles: [],
      broadcasts: [],
    },
  );
});

Deno.test("parseUsergroupInput — empty array returns all empty arrays", () => {
  assertEquals(parseUsergroupInput([]), {
    ids: [],
    handles: [],
    broadcasts: [],
  });
});

// ---------------------------------------------------------------------------
// parseUsergroupInput — empty / unrecognised tokens
// ---------------------------------------------------------------------------

Deno.test("parseUsergroupInput — empty string returns all empty arrays", () => {
  assertEquals(parseUsergroupInput(""), {
    ids: [],
    handles: [],
    broadcasts: [],
  });
});

Deno.test("parseUsergroupInput — pure whitespace returns all empty arrays", () => {
  assertEquals(parseUsergroupInput("   \t \n  "), {
    ids: [],
    handles: [],
    broadcasts: [],
  });
});

Deno.test("parseUsergroupInput — discards garbage tokens", () => {
  assertEquals(parseUsergroupInput("garbage"), {
    ids: [],
    handles: [],
    broadcasts: [],
  });
});

Deno.test("parseUsergroupInput — discards user IDs and team IDs (wrong prefix)", () => {
  assertEquals(parseUsergroupInput("U1ABCDE T1ABCDE C1ABCDE"), {
    ids: [],
    handles: [],
    broadcasts: [],
  });
});

Deno.test("parseUsergroupInput — discards malformed mrkdwn", () => {
  assertEquals(
    parseUsergroupInput("<!subteam^S1 <subteam^S1ABCDE> <!team^S1ABCDE>"),
    {
      ids: [],
      handles: [],
      broadcasts: [],
    },
  );
});

Deno.test("parseUsergroupInput — keeps valid tokens interleaved with garbage", () => {
  assertEquals(
    parseUsergroupInput(
      "garbage @engineers noise <!subteam^S1ABCDE> T1ABCDE @here",
    ),
    {
      ids: ["S1ABCDE"],
      handles: ["engineers"],
      broadcasts: ["here"],
    },
  );
});
