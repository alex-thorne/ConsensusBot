# Contributing to ConsensusBot

## Required Workflow

Before every commit you **must**:

1. Make your code changes.
2. Run `deno fmt` to auto-format all files.
3. Run `deno task ci` to verify formatting, lint, type-checking, and tests all
   pass.
4. Commit **only after** all checks pass.

## Branching Strategy

This project uses a **develop → main** branching model:

| Branch    | Purpose                                                    |
| --------- | ---------------------------------------------------------- |
| `main`    | Production — deployed via `slack deploy`                   |
| `develop` | Integration — tested locally via `slack run`               |
| feature/* | Feature branches — branched from and merged into `develop` |

### Rules

1. **Never push directly to `main`.** All changes reach `main` via a PR from
   `develop`.
2. **Feature branches** are created from `develop` and merged back into
   `develop` via PR.
3. After shakedown testing on `develop` (using `slack run`), open a PR from
   `develop` → `main`.
4. Only the repository owner (@alex-thorne) can merge PRs into `main`.
5. **Releases** are tagged on `main` after merging from `develop`. Update
   `utils/version.ts` in the `develop` → `main` PR.

### Version Tagging

- The app version is stored in `utils/version.ts` and follows semantic
  versioning (`MAJOR.MINOR.PATCH`).
- The version appears in all Slack messages as a footnote.
- When preparing a release PR (`develop` → `main`), bump the version in
  `utils/version.ts`.
- After merging to `main`, create a git tag:
  `git tag vX.Y.Z && git push origin vX.Y.Z`.

## CI Commands

The project uses [Deno](https://deno.land/) tasks defined in `deno.jsonc` as the
canonical way to run checks:

| Command               | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `deno task fmt`       | **RUN THIS BEFORE EVERY COMMIT** — auto-format all source files |
| `deno task fmt:check` | Check formatting without modifying files                        |
| `deno task lint`      | Run the linter                                                  |
| `deno task check`     | Run TypeScript type checking                                    |
| `deno task test`      | Run the test suite                                              |
| `deno task ci`        | Run all of the above checks in sequence                         |

Run `deno task ci` before opening a pull request to catch formatting, lint, and
type errors locally.

## Common Formatting Pitfalls

`deno fmt` enforces ~80-character line wrapping. When the formatter wants to
break a long line, you must accept its output. Common cases:

- **Long array literals**: multi-element arrays that exceed the line limit will
  be broken onto separate lines with a trailing comma after the last element.
- **Long function arguments**: calls with many or long arguments will be
  rewritten with one argument per line and a trailing comma.
- **Trailing commas**: required after the last item in any multi-line array,
  object, or parameter list.
- **String quotes**: always use double quotes (`"`), not single quotes.

Example — let `deno fmt` break long calls:

```ts
// Before (too long)
const result = await client.apiCall("chat.postMessage", {
  channel,
  text,
  blocks,
});

// After deno fmt (correct)
const result = await client.apiCall("chat.postMessage", {
  channel,
  text,
  blocks,
});
```

## Git Hooks

Branch-local git hooks live in `.githooks/`. The `pre-commit` hook auto-formats
with `deno fmt`, then fails if any files were modified (so you can review and
re-stage them), then runs `lint` and `check`.

Enable the hooks once after cloning:

```sh
git config core.hooksPath .githooks
```

> **Note:** The hook script must be executable. It is committed with the
> executable bit set (`chmod +x .githooks/pre-commit`). If it loses that bit
> after a fresh clone on some systems, restore it with:
>
> ```sh
> chmod +x .githooks/pre-commit
> ```
