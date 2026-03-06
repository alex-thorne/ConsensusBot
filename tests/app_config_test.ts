/**
 * Tests for app_config module
 *
 * Tests environment-aware APP_NAME and VERSION re-export.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { APP_NAME, VERSION } from "../utils/app_config.ts";
import { VERSION as VERSION_DIRECT } from "../utils/version.ts";

Deno.test("app_config - APP_NAME is a string", () => {
  assertEquals(typeof APP_NAME, "string");
});

Deno.test("app_config - APP_NAME defaults to 'ConsensusBot' when CONSENSUSBOT_ENV is not set to local", () => {
  // The test runner does not set CONSENSUSBOT_ENV=local, so we expect the
  // production default.  If the variable happens to be set to "local" or
  // "localtest" in the CI environment this assertion would need to be
  // adjusted, but that is not expected.
  assertStringIncludes(APP_NAME, "ConsensusBot");
});

Deno.test("app_config - VERSION is re-exported from version.ts", () => {
  assertEquals(VERSION, VERSION_DIRECT);
});

Deno.test("app_config - VERSION is a non-empty string", () => {
  assertEquals(typeof VERSION, "string");
  assertEquals(VERSION.length > 0, true);
});
