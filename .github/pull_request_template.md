## Summary

<!-- What changed and why. Link to the SPEC section if behaviour-changing. -->

## SPEC alignment

- [ ] If this changes behaviour, the SPEC has been updated via a
      `spec-amend/...` PR or the PR description states why no amendment is
      needed.

## Checks

- [ ] `deno task fmt:check` ✅
- [ ] `deno task lint` ✅
- [ ] `deno task check` ✅
- [ ] `deno task test` ✅
- [ ] `deno task ci` ✅ (or each individual task ran clean)

## Test plan

<!-- How was this validated? Unit tests + integration tests + (if applicable) live workspace e2e. -->

## Risk

- [ ] No new `any` / `// @ts-ignore` / `Deno.env.get` introduced.
- [ ] No legacy artefacts re-introduced (`vote_button_trigger`,
      `record_vote_function`, `send_reminders_function`, etc.).
- [ ] No `{{decision_id}}` placeholder anywhere.
- [ ] Bot filter still applied uniformly across individual + usergroup + channel
      sources (§8.2.3).
