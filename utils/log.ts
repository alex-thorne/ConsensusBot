// ConsensusBot v2.0 — Structured logger.
//
// SPEC source of truth:
//   - docs/REDEVELOPMENT_SPECIFICATION.md §23.5
//
// A thin wrapper around `console.log`/`console.warn`/`console.error` that
// emits ONE line of valid JSON per call, with `level`, plus the caller's
// merged context (which must include an `event` discriminator).
//
// Usage:
//   log.info({ event: "vote_recorded", decision_id, user_id, vote_type, voted_at });
//   log.warn({ event: "usergroup_handle_unresolved", handle });
//   log.error({ event: "datastore_put_failed", datastore, id, error });
//
// `slack activity` exposes these JSON lines as queryable structured logs.

/**
 * The shape of any log call's context. Every log line MUST include an
 * `event` discriminator (per SPEC §23.5); the type is intentionally
 * permissive on remaining fields so callers can merge in arbitrary
 * decision_id, user_id, error, etc.
 */
export type LogContext = Record<string, unknown>;

type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, ctx: LogContext): void {
  const line = JSON.stringify({ level, ...ctx });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Structured logger. Each method emits one JSON object per line on the
 * appropriate console stream:
 *
 *   - `info` → stdout (`console.log`)
 *   - `warn` → stderr (`console.warn`)
 *   - `error` → stderr (`console.error`)
 */
export const log = {
  info: (ctx: LogContext): void => emit("info", ctx),
  warn: (ctx: LogContext): void => emit("warn", ctx),
  error: (ctx: LogContext): void => emit("error", ctx),
};
