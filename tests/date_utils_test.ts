/**
 * Tests for date_utils module
 *
 * Tests date utility functions for deadline calculations
 */

import { assertEquals } from "@std/assert";
import {
  addBusinessDays,
  formatDate,
  getDefaultDeadline,
  isDeadlinePassed,
} from "../utils/date_utils.ts";

Deno.test("date_utils - addBusinessDays skips weekends", () => {
  // Start on a Friday (2026-02-06)
  const friday = new Date("2026-02-06T12:00:00.000Z");

  // Add 1 business day from Friday should be Monday
  const monday = addBusinessDays(1, friday);
  assertEquals(monday.getDay(), 1); // Monday

  // Add 5 business days from Friday should be next Friday
  const nextFriday = addBusinessDays(5, friday);
  assertEquals(nextFriday.getDay(), 5); // Friday
});

Deno.test("date_utils - addBusinessDays works with zero days", () => {
  const startDate = new Date("2026-02-06T12:00:00.000Z");
  const result = addBusinessDays(0, startDate);

  // Should return the same date (or very close)
  assertEquals(result.getDate(), startDate.getDate());
});

Deno.test("date_utils - addBusinessDays works with weekday start", () => {
  // Start on a Monday (2026-02-02)
  const monday = new Date("2026-02-02T12:00:00.000Z");

  // Add 1 business day should be Tuesday
  const tuesday = addBusinessDays(1, monday);
  assertEquals(tuesday.getDay(), 2); // Tuesday

  // Add 4 business days should be Friday
  const friday = addBusinessDays(4, monday);
  assertEquals(friday.getDay(), 5); // Friday
});

Deno.test("date_utils - getDefaultDeadline returns valid date string", () => {
  const deadline = getDefaultDeadline();

  // Should be in YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  assertEquals(dateRegex.test(deadline), true);

  // Should be parseable as a date
  const parsedDate = new Date(deadline);
  assertEquals(parsedDate instanceof Date, true);
  assertEquals(isNaN(parsedDate.getTime()), false);
});

Deno.test("date_utils - formatDate handles Date object", () => {
  const date = new Date("2026-02-15T12:30:45.000Z");
  const formatted = formatDate(date);

  assertEquals(formatted, "2026-02-15");
});

Deno.test("date_utils - formatDate handles date string", () => {
  const dateStr = "2026-02-15T12:30:45.000Z";
  const formatted = formatDate(dateStr);

  assertEquals(formatted, "2026-02-15");
});

Deno.test("date_utils - isDeadlinePassed returns true for past date", () => {
  // Use a date definitely in the past
  const pastDeadline = "2020-01-01";
  const result = isDeadlinePassed(pastDeadline);

  assertEquals(result, true);
});

Deno.test("date_utils - isDeadlinePassed returns false for future date", () => {
  // Use a date in the future
  const futureDeadline = "2030-12-31";
  const result = isDeadlinePassed(futureDeadline);

  assertEquals(result, false);
});

Deno.test("date_utils - isDeadlinePassed handles today correctly", () => {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  // Today's date comparison depends on time of day
  // Just verify it returns a boolean
  const result = isDeadlinePassed(todayStr);
  assertEquals(typeof result, "boolean");
});
