# Contributing to ConsensusBot

## Required Workflow

Before every commit you **must**:

1. Make your code changes.
2. Run `deno fmt` to auto-format all files.
3. Run `deno task ci` to verify formatting, lint, type-checking, and tests all
   pass.
4. Commit **only after** all checks pass.

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
