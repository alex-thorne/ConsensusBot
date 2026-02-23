# Contributing to ConsensusBot

## CI Commands

The project uses [Deno](https://deno.land/) tasks defined in `deno.jsonc` as the canonical way to run checks:

| Command | Description |
|---|---|
| `deno task fmt` | Auto-format all source files |
| `deno task fmt:check` | Check formatting without modifying files |
| `deno task lint` | Run the linter |
| `deno task check` | Run TypeScript type checking |
| `deno task test` | Run the test suite |
| `deno task ci` | Run all of the above checks in sequence |

Run `deno task ci` before opening a pull request to catch formatting, lint, and type errors locally.

## Git Hooks

Branch-local git hooks live in `.githooks/`. The `pre-commit` hook runs
`fmt:check`, `lint`, and `check` automatically before every commit.

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
