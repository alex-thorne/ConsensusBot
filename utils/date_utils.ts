// ConsensusBot v2.0 — Date & time utilities (tz-aware).
//
// SPEC source of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §19
//
// All timestamps in the system are ISO-8601 UTC instants. The non-trivial
// piece is `resolveDeadline`, which converts a `YYYY-MM-DD` calendar date
// in a workspace tz into the UTC instant for `23:59:59.999` end-of-day in
// that tz, DST-aware. We use `Intl.DateTimeFormat` (no Temporal polyfill,
// no external libraries) to derive the offset for the relevant date.

import type { SlackClient } from "../types/slack_types.ts";
import type { DecisionRecord } from "../types/decision_types.ts";

/**
 * §19.1 — Increment one calendar day at a time, only counting weekdays
 * (`getDay()` not 0 or 6) until `daysAdded === days`.
 *
 * Bank-holiday calendars are out of scope (§22.B1). The function mutates a
 * local clone of `startDate`, so the caller's `Date` is not affected.
 */
export function addBusinessDays(days: number, startDate?: Date): Date {
  const date = startDate ? new Date(startDate.getTime()) : new Date();
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      added++;
    }
  }
  return date;
}

/**
 * §19.2 — `addBusinessDays(5)`, then format as `YYYY-MM-DD` in workspaceTz.
 *
 * The form picker stores a date string; the resolution to a tz-aware
 * timestamp happens later on submission via `resolveDeadline`.
 */
export function getDefaultDeadline(workspaceTz: string): string {
  const target = addBusinessDays(5);
  return formatDateInTz(target, workspaceTz);
}

/**
 * §19.3 — Format a Date or ISO string as `YYYY-MM-DD` in UTC.
 *
 * SPEC verbatim:
 *   `(typeof d === "string" ? new Date(d) : d).toISOString().split("T")[0]`
 */
export function formatDate(d: Date | string): string {
  return (typeof d === "string" ? new Date(d) : d).toISOString().split("T")[0];
}

/**
 * §19.4 — Resolve a `YYYY-MM-DD` calendar date in `workspaceTz` to the UTC
 * instant for `23:59:59.999` end-of-day in that tz.
 *
 * Pattern (DST-aware, no external library): take a tentative UTC date for
 * `${deadlineDate}T23:59:59.999Z`, use `Intl.DateTimeFormat({ timeZone })`
 * with `formatToParts` to learn what local wall-clock that UTC instant maps
 * to, derive the tz's UTC offset for that date, then subtract the offset to
 * land on the correct UTC instant. Precision: ~1 second.
 */
export function resolveDeadline(
  deadlineDate: string,
  workspaceTz: string,
): { iso: string; tz: string; humanDisplay: string } {
  // 1. Tentative UTC instant treating the local wall-clock as if it were UTC.
  const [yearStr, monthStr, dayStr] = deadlineDate.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const tentativeUtcMs = Date.UTC(year, month - 1, day, 23, 59, 59, 999);

  // 2. Compute the tz offset (minutes east of UTC) for that date in workspaceTz.
  const offsetMinutes = getTzOffsetMinutes(
    new Date(tentativeUtcMs),
    workspaceTz,
  );

  // 3. Subtract the offset: tentativeUtcMs interprets wall-clock as UTC, so
  //    the actual UTC instant for "23:59:59.999 local" is earlier by `offset`
  //    when offset is positive (east of UTC).
  const actualUtcMs = tentativeUtcMs - offsetMinutes * 60_000;
  const actualDate = new Date(actualUtcMs);

  return {
    iso: actualDate.toISOString(),
    tz: workspaceTz,
    humanDisplay: formatDeadlineHuman(actualDate.toISOString(), workspaceTz),
  };
}

/**
 * §19.5 — Read the workspace IANA tz from `team.info`. Falls back to
 * `Europe/London` (the operator's primary tz) on failure or missing tz.
 */
export async function getWorkspaceTz(client: SlackClient): Promise<string> {
  try {
    const result = await client.team.info();
    const tz = result.team?.tz;
    if (tz && typeof tz === "string" && tz.length > 0) {
      return tz;
    }
    return "Europe/London";
  } catch {
    return "Europe/London";
  }
}

/**
 * §19.6 — Compare `deadline_resolved` (a UTC instant) to `now`. Tz-correct
 * because the offset was baked in by `resolveDeadline`.
 */
export function isDeadlinePassed(decision: DecisionRecord): boolean {
  return new Date(decision.deadline_resolved) < new Date();
}

/**
 * §19.7 — Render a deadline ISO string as e.g. `"9 May 2026 at 23:59 BST"`.
 *
 * SPEC §19.7 specifies `dateStyle: "long", timeStyle: "short", timeZoneName:
 * "short"`, but combining `dateStyle`/`timeStyle` with `timeZoneName` is
 * rejected by some V8/ICU builds with "Invalid option : option". We use
 * explicit field options that produce the same en-GB long/short format and
 * normalise the comma separator to " at " to match the SPEC's example.
 */
export function formatDeadlineHuman(
  deadlineResolved: string,
  tz: string,
): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(new Date(deadlineResolved));
  // en-GB tends to use ", " between the date and time; normalise to " at ".
  return formatted.replace(/, (?=\d{1,2}:\d{2})/, " at ");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Format a `Date` as `YYYY-MM-DD` in the given IANA tz using the en-CA
 * locale (which natively renders `YYYY-MM-DD`).
 */
function formatDateInTz(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Compute the offset (in minutes east of UTC) that `tz` is at on the given
 * UTC instant. DST-aware. E.g. `Europe/London` returns 60 in BST, 0 in GMT.
 */
function getTzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  const localYear = get("year");
  const localMonth = get("month");
  const localDay = get("day");
  // Intl renders 24:00:00 for midnight in some engines; normalise to 0.
  const hourRaw = get("hour");
  const localHour = hourRaw === 24 ? 0 : hourRaw;
  const localMinute = get("minute");
  const localSecond = get("second");

  const localAsUtcMs = Date.UTC(
    localYear,
    localMonth - 1,
    localDay,
    localHour,
    localMinute,
    localSecond,
  );
  // Difference between "local wall-clock interpreted as UTC" and the actual
  // UTC instant gives the offset east of UTC.
  return Math.round((localAsUtcMs - date.getTime()) / 60_000);
}
