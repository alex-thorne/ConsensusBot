/**
 * Unit tests for utils/slack_parse.ts
 *
 * Tests all supported input formats for user and usergroup parsing.
 */

import { assertEquals } from "@std/assert";
import { parseUsergroupInput, parseUserIds } from "../utils/slack_parse.ts";

// ---------------------------------------------------------------------------
// parseUserIds
// ---------------------------------------------------------------------------

Deno.test("parseUserIds - Slack mrkdwn mention <@UXXXXXXX>", () => {
  assertEquals(parseUserIds("<@U123ABC>"), ["U123ABC"]);
});

Deno.test("parseUserIds - Slack mrkdwn mention with display name <@UXXXXXXX|name>", () => {
  assertEquals(parseUserIds("<@U123ABC|alice>"), ["U123ABC"]);
});

Deno.test("parseUserIds - raw user ID starting with U", () => {
  assertEquals(parseUserIds("U123ABC"), ["U123ABC"]);
});

Deno.test("parseUserIds - raw user ID starting with W (enterprise grid)", () => {
  assertEquals(parseUserIds("W123ABC"), ["W123ABC"]);
});

Deno.test("parseUserIds - comma-separated list", () => {
  assertEquals(
    parseUserIds("<@U111AAA>,<@U222BBB>,U333CCC"),
    ["U111AAA", "U222BBB", "U333CCC"],
  );
});

Deno.test("parseUserIds - whitespace-separated list", () => {
  assertEquals(
    parseUserIds("<@U111AAA> <@U222BBB> U333CCC"),
    ["U111AAA", "U222BBB", "U333CCC"],
  );
});

Deno.test("parseUserIds - newline-separated list", () => {
  assertEquals(
    parseUserIds("<@U111AAA>\n<@U222BBB>\nU333CCC"),
    ["U111AAA", "U222BBB", "U333CCC"],
  );
});

Deno.test("parseUserIds - deduplicates repeated IDs", () => {
  assertEquals(
    parseUserIds("<@U111AAA>, U111AAA, <@U111AAA|bob>"),
    ["U111AAA"],
  );
});

Deno.test("parseUserIds - mixed formats with duplicates", () => {
  const result = parseUserIds(
    "<@U001AAA>, U002BBB, <@U001AAA|alice>, W003CCC",
  );
  assertEquals(result.sort(), ["U001AAA", "U002BBB", "W003CCC"]);
});

Deno.test("parseUserIds - empty string returns empty array", () => {
  assertEquals(parseUserIds(""), []);
});

Deno.test("parseUserIds - whitespace-only string returns empty array", () => {
  assertEquals(parseUserIds("   \n  "), []);
});

Deno.test("parseUserIds - ignores unrecognised tokens", () => {
  assertEquals(parseUserIds("notanid, @someone, #channel"), []);
});

Deno.test("parseUserIds - legacy array input (backward compat)", () => {
  assertEquals(
    parseUserIds(["U111AAA", "U222BBB", "U111AAA"]),
    ["U111AAA", "U222BBB"],
  );
});

Deno.test("parseUserIds - legacy empty array returns empty array", () => {
  assertEquals(parseUserIds([]), []);
});

// ---------------------------------------------------------------------------
// parseUsergroupInput
// ---------------------------------------------------------------------------

Deno.test("parseUsergroupInput - Slack mrkdwn subteam mention <!subteam^SXXXXXXX|handle>", () => {
  const result = parseUsergroupInput("<!subteam^S123ABC|eng>");
  assertEquals(result.ids, ["S123ABC"]);
  assertEquals(result.handles, []);
});

Deno.test("parseUsergroupInput - subteam mention without handle suffix", () => {
  const result = parseUsergroupInput("<!subteam^S123ABC>");
  assertEquals(result.ids, ["S123ABC"]);
  assertEquals(result.handles, []);
});

Deno.test("parseUsergroupInput - raw usergroup ID starting with S", () => {
  const result = parseUsergroupInput("S123ABC");
  assertEquals(result.ids, ["S123ABC"]);
  assertEquals(result.handles, []);
});

Deno.test("parseUsergroupInput - @handle is returned as unresolved", () => {
  const result = parseUsergroupInput("@eng");
  assertEquals(result.ids, []);
  assertEquals(result.handles, ["eng"]);
});

Deno.test("parseUsergroupInput - comma-separated mixed formats", () => {
  const result = parseUsergroupInput(
    "<!subteam^S111AAA|eng>, S222BBB, @backend",
  );
  assertEquals(result.ids.sort(), ["S111AAA", "S222BBB"]);
  assertEquals(result.handles, ["backend"]);
});

Deno.test("parseUsergroupInput - deduplicates repeated IDs", () => {
  const result = parseUsergroupInput(
    "<!subteam^S111AAA|eng>, S111AAA, <!subteam^S111AAA>",
  );
  assertEquals(result.ids, ["S111AAA"]);
  assertEquals(result.handles, []);
});

Deno.test("parseUsergroupInput - empty string returns empty result", () => {
  const result = parseUsergroupInput("");
  assertEquals(result.ids, []);
  assertEquals(result.handles, []);
});

Deno.test("parseUsergroupInput - ignores unrecognised tokens", () => {
  const result = parseUsergroupInput("notanid, <@U123ABC>, #channel");
  assertEquals(result.ids, []);
  assertEquals(result.handles, []);
});

Deno.test("parseUsergroupInput - legacy array input (backward compat)", () => {
  const result = parseUsergroupInput(["S111AAA", "S222BBB", "S111AAA"]);
  assertEquals(result.ids.sort(), ["S111AAA", "S222BBB"]);
  assertEquals(result.handles, []);
});

Deno.test("parseUsergroupInput - legacy empty array returns empty result", () => {
  const result = parseUsergroupInput([]);
  assertEquals(result.ids, []);
  assertEquals(result.handles, []);
});
