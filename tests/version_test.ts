import { assertEquals, assertMatch } from "@std/assert";
import { VERSION } from "../utils/version.ts";

Deno.test("version - VERSION is a valid semver string", () => {
  assertMatch(VERSION, /^\d+\.\d+\.\d+$/);
});

Deno.test("version - VERSION is not empty", () => {
  assertEquals(VERSION.length > 0, true);
});
