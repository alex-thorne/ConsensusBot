# Contributor workflow

This document is the contract every contributor — human or agent — agrees to
when committing to this repository. The build itself is described in
**[docs/REDEVELOPMENT_BUILD_PLAN.md](docs/REDEVELOPMENT_BUILD_PLAN.md)**, which
defines the swarm execution model (waves, tasks, single-file ownership). This
file is the per-commit checklist.

## The contract

1. **Run `deno fmt` before every commit.** The pre-commit hook in
   `.githooks/pre-commit` does this automatically once you've enabled it with:
   ```bash
   git config core.hooksPath .githooks
   ```
   The hook runs `deno fmt`, fails the commit if formatting modified any tracked
   file (so you can re-stage), then runs `deno task lint` and `deno task check`.
   Tests are intentionally excluded from the hook to keep commits fast.

2. **Run `deno task ci` before opening a PR.** This runs `fmt:check`, `lint`,
   `check`, and `test` — the same gates as the CI workflow. CI will fail
   otherwise.

3. **Strict TypeScript.** No `any`, no `// @ts-ignore`, no `// @ts-nocheck`. If
   the type system gets in your way, fix the type model rather than
   escape-hatching. `deno.jsonc` enables `strict: true` for a reason.

4. **Single-file ownership.** During the swarm rebuild, no two
   parallel-in-flight tasks are permitted to touch the same file. Wave-gate
   violations of this rule are blockers. If your task needs to modify a file
   owned by another in-flight task, raise it with the coordinator and wait.

5. **All user-supplied text is escaped.** Anything entered by a Slack user —
   proposal title, proposal body, free-text usergroup mentions, etc. — MUST pass
   through `escapeSlackText` from
   [`utils/escape_slack.ts`](utils/escape_slack.ts) before being rendered into a
   Slack mrkdwn payload. The function is the only sanctioned barrier against
   mrkdwn injection. If you find a render path that bypasses it, treat that as a
   bug, not an optimisation.

6. **Vote-resolution invariants.** Pass / fail decisions in
   `utils/decision_logic.ts` MUST use **integer arithmetic only** —
   `yes * 2 > yes + no`, not `yes / (yes + no) > 0.5`. Floating-point
   comparisons are forbidden in the decision path. Abstentions are excluded from
   both the numerator AND the denominator across all three criteria (Robert's
   Rules / ISO Directives / UK Companies Act baseline). See
   **[docs/REDEVELOPMENT_SPECIFICATION.md §15](docs/REDEVELOPMENT_SPECIFICATION.md)**.

7. **Zero secrets.** Do not introduce `Deno.env.get(...)`. Do not add anything
   to `outgoingDomains`. Do not add a credentials file, an environment-variable
   load, or a signing-secret check. The app holds no secrets and that posture is
   defended at PR time. See **[SECURITY.md](SECURITY.md)**.

8. **Don't modify the gatekeepers.** `.github/workflows/ci.yml`, `deno.jsonc`,
   and the PR template are owned by the repository's contract. Do not change
   them as part of an unrelated PR. If they genuinely need to change, raise it
   as its own task.

9. **No "checks blocked by network" excuse.** All required checks are local
   (`deno task ci`). If you are unable to run them, do not open the PR.

## Commit hygiene

- Atomic commits with imperative-mood messages (`feat: add ...`,
  `fix: handle ...`, `docs: clarify ...`).
- Reference the SPEC section that motivates the change where it isn't obvious
  from context (`per SPEC §15.4`).
- Don't bundle reformatting with logic changes — `deno fmt` reformats should
  land in their own commit, or be stable across the diff.

## Where to look first

- **Behaviour.**
  [`docs/REDEVELOPMENT_SPECIFICATION.md`](docs/REDEVELOPMENT_SPECIFICATION.md) —
  the source of truth for everything the app does.
- **Execution.**
  [`docs/REDEVELOPMENT_BUILD_PLAN.md`](docs/REDEVELOPMENT_BUILD_PLAN.md) — task
  list, dependencies, wave gates, ownership.
- **Local dev.** [`DEVELOPMENT.md`](DEVELOPMENT.md) — toolchain, hot reload, and
  test invocation.
- **Deploy.** [`DEPLOYMENT.md`](DEPLOYMENT.md) — `slack create`, `slack deploy`,
  and the `./scripts/deploy.sh` schedule-trigger dance.
- **Posture.** [`SECURITY.md`](SECURITY.md) — zero-secret design and the
  rationale for each scope.
