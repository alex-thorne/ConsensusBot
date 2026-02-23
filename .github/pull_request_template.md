## Pull Request Checklist

Before marking this PR as ready for review, please confirm:

- [ ] `deno task ci` passes locally (runs fmt:check, lint, check, and test)
- [ ] `deno task fmt:check` — no formatting issues
- [ ] `deno task lint` — no lint warnings or errors
- [ ] `deno task check` — no TypeScript type errors
- [ ] `deno task test` — all tests pass
- [ ] Changes are documented (README / AGENTS.md / inline comments) where
      appropriate
