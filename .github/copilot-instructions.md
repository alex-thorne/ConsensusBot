# Copilot Instructions for ConsensusBot

## Project Overview

- **Runtime**: Deno (see `deno.jsonc` for configuration)
- **Task runner**: `deno task <name>` (tasks defined in `deno.jsonc`)
- **Language**: TypeScript

## Branching Strategy

- **`main`** = production. Deployed with `slack deploy`. Only @alex-thorne
  merges to `main`.
- **`develop`** = integration/testing. Tested locally with `slack run`. PRs
  target `develop` by default.
- **Feature branches** are created from `develop` and merged back into
  `develop`.
- The app version lives in `utils/version.ts` (semver). Bump it in `develop` →
  `main` PRs.
- After merging to `main`, tag the release:
  `git tag vX.Y.Z && git push origin vX.Y.Z`.

When creating PRs, **always target `develop`** unless explicitly told to target
`main`.

## File Structure

```
functions/          # Slack function handlers
workflows/          # Slack workflow definitions
utils/              # Shared utility modules
datastores/         # Slack datastore schemas
triggers/           # Slack trigger definitions
tests/              # Unit tests
tests/integration/  # Integration tests
tests/mocks/        # Test mocks and fixtures
manifest.ts         # Slack app manifest
deno.jsonc          # Deno config and task definitions
```

## MANDATORY: Run `deno fmt` Before Every Commit

You MUST run `deno fmt` (the auto-formatter) before every commit — not just
`deno fmt --check`. The formatter will rewrite files in-place to comply with
Deno's style rules. Never skip this step.

```sh
deno fmt
```

After formatting, stage the changes and then commit.

## MANDATORY: Run `deno lint` Before Every Commit

You MUST run `deno lint` before every commit and fix all lint errors before
proceeding.

```sh
deno lint
```

## MANDATORY: Run `deno task ci` After All Changes Are Complete

Before opening or updating a pull request, you MUST run the full CI suite
locally and ensure it passes:

```sh
deno task ci
```

This runs `fmt:check`, `lint`, `check` (type-checking), and `test` in sequence.
All checks must pass before you commit or push.

## Required Workflow

1. Make your code changes.
2. Run `deno fmt` to auto-format all files.
3. Run `deno task ci` to verify formatting, lint, type-checking, and tests all
   pass.
4. Commit **only after** all checks pass.

## Deno Formatting Rules

`deno fmt` enforces the following style (do not fight the formatter — let it
rewrite the file):

- **Indentation**: 2 spaces (no tabs)
- **Quotes**: double quotes for strings
- **Semicolons**: required at end of statements
- **Trailing commas**: required in multi-line arrays, objects, and parameter
  lists
- **Line length**: ~80 characters; `deno fmt` will automatically break long
  lines

### Long Lines — Accept the Formatter's Output

When `deno fmt` wants to break a long array literal, function call, or argument
list across multiple lines, you MUST accept that formatting. Do not try to keep
it on one line. Example:

```ts
// WRONG — line too long, will be reformatted by deno fmt
const result = await someFunction(argumentOne, argumentTwo, argumentThree);

// CORRECT — let deno fmt break it
const result = await someFunction(
  argumentOne,
  argumentTwo,
  argumentThree,
);
```

## Testing Requirements

- Unit tests go in `tests/`.
- Integration tests go in `tests/integration/`.
- Mocks and fixtures go in `tests/mocks/`.
- Run `deno task test` to execute the full test suite.

## CI Commands Reference

| Command               | Description                              |
| --------------------- | ---------------------------------------- |
| `deno task fmt`       | **RUN THIS BEFORE EVERY COMMIT**         |
| `deno task fmt:check` | Check formatting without modifying files |
| `deno task lint`      | Run the linter                           |
| `deno task check`     | Run TypeScript type checking             |
| `deno task test`      | Run the test suite                       |
| `deno task ci`        | Run all of the above checks in sequence  |

## PROHIBITED Behaviors

- **Do NOT** claim that checks are "blocked by network" or "will pass in CI" as
  a reason for skipping them. If you genuinely cannot run a command, say so
  explicitly and leave the corresponding PR checklist box **unchecked**.
- **Do NOT** check a PR checklist box unless you have actually run that command
  and it passed.
- **Do NOT** modify `.github/workflows/*.yml`, `deno.jsonc`, or
  `.github/pull_request_template.md`.
