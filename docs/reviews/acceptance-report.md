# T-702 Acceptance Report — ConsensusBot v2.0

**Verifier:** automated acceptance suite per PLAN §9 (T-702 scope). **Date:**
2026-05-09. **Branch:** rebuild/v2.0-redevelopment. **Commit:** 8197d71.

## Summary

T-702 scope is **green**. All five acceptance criteria executable without a live
Slack workspace (§25 #1, #2, #8, #11, #12) pass. `deno task ci` exits 0 from a
clean tree, with 310 tests passing across 22 files (fmt:check, lint, type-check,
and test all green). The 1-of-10 simple-majority failure is pinned in
`tests/decision_logic_test.ts`, the `event_kind: "changed"` vote-history flow is
pinned end-to-end across `tests/integration/vote_handler_test.ts` and
`tests/adr_generator_test.ts` (with the corresponding rendering in
`utils/adr_generator.ts`), and a tree-wide grep confirms the source contains
zero `Deno.env.get` (or equivalent) calls. Criteria #3–#7, #9, #10 are deferred
to T-703, which requires a live Slack workspace.

## SPEC §25 acceptance criteria

| #  | Criterion                                       | T-702 status                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -- | ----------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1  | `deno task ci` green from fresh clone           | PASS                                  | exit 0; `git status` reports working tree clean; `ok                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2  | Every test in §21 passes                        | PASS                                  | 310 tests across 22 files; 0 failures; same fixtures and assertions as §21                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3  | `slack deploy` succeeds                         | DEFERRED — T-703                      | requires live Slack workspace (Pro plan or higher)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4  | `/consensus` modal + 6-block message            | DEFERRED — T-703                      | requires live Slack workspace; unit-level shape tests in `tests/integration/create_decision_test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5  | Vote behaviour                                  | DEFERRED — T-703                      | requires live Slack workspace; unit-level coverage in `tests/integration/vote_handler_test.ts` (11 tests)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6  | Finalisation behaviour                          | DEFERRED — T-703                      | requires live Slack workspace; unit-level coverage in `tests/integration/deadline_finalisation_test.ts` and `tests/integration/race_test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 7  | Reminders                                       | DEFERRED — T-703                      | requires live Slack workspace; unit-level coverage in `tests/integration/process_active_decisions_test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8  | Vote resolution + 1-of-10 fails simple_majority | PASS                                  | `tests/decision_logic_test.ts:94` — `simple_majority — 1 yes / 0 no / 0 abstain on R=10 quorum=5 fails on quorum`; assertion: `r.outcome === "rejected"`, `r.reason === "Quorum not met (1 of 5 required)"`. `utils/decision_logic.ts` enforces quorum (`votes_cast < quorum` → reject) and excludes abstentions from the decisive denominator. All three criteria covered (35 tests in this file).                                                                                                                                                                                        |
| 9  | Deadline tz resolves correctly                  | DEFERRED — T-703 (live workspace e2e) | unit covered in `tests/date_utils_test.ts` (22 tests, including DST boundaries)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 10 | Voter deactivation handling                     | DEFERRED — T-703                      | unit covered in `tests/integration/deactivation_test.ts` (4 tests)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 11 | Vote history surfaced in ADR                    | PASS                                  | Integration: `tests/integration/vote_handler_test.ts:470` (`vote handler — update path: votes overwritten in place; history records "changed" with previous_vote_type`) — asserts `histRow.event_kind === "changed"` and `previous_vote_type === "yes"`. Rendering: `tests/adr_generator_test.ts:327` asserts the ADR includes `"The following voters changed their vote during the decision:"` and `"- Alice: YES → NO at 2026-05-12T11:00:00.000Z"`. Implementation: `utils/adr_generator.ts:108` filters `voteHistory.filter(h => h.event_kind === "changed")` and renders the section. |
| 12 | Zero secrets                                    | PASS                                  | tree-wide grep for `Deno.env`, `process.env`, `getenv`, `env.get` returns zero hits across the source tree (excluding `archive/`); no env-derived configuration exists for the runtime to depend on                                                                                                                                                                                                                                                                                                                                                                                        |

## `deno task ci` output

```
Task ci deno task fmt:check && deno task lint && deno task check && deno task test
Task fmt:check deno fmt --check
Checked 61 files
Task lint deno lint
Checked 43 files
Task check deno check manifest.ts
Task test deno test --allow-all tests/
...
ok | 310 passed | 0 failed (688ms)
```

Exit code: 0.

## Test count

310 tests passing, 0 failures, across 22 files:

| File                                                    |   Tests |
| ------------------------------------------------------- | ------: |
| `tests/adr_generator_test.ts`                           |      17 |
| `tests/channel_members_test.ts`                         |      13 |
| `tests/concurrency_test.ts`                             |      10 |
| `tests/create_decision_test.ts`                         |      13 |
| `tests/date_utils_test.ts`                              |      22 |
| `tests/decision_logic_test.ts`                          |      35 |
| `tests/escape_slack_test.ts`                            |      20 |
| `tests/integration/cancel_delete_test.ts`               |       9 |
| `tests/integration/channel_members_integration_test.ts` |       6 |
| `tests/integration/create_decision_test.ts`             |       9 |
| `tests/integration/deactivation_test.ts`                |       4 |
| `tests/integration/deadline_finalisation_test.ts`       |       4 |
| `tests/integration/process_active_decisions_test.ts`    |       7 |
| `tests/integration/race_test.ts`                        |       3 |
| `tests/integration/usergroup_integration_test.ts`       |       8 |
| `tests/integration/vote_handler_test.ts`                |      11 |
| `tests/log_test.ts`                                     |      12 |
| `tests/process_active_decisions_test.ts`                |      18 |
| `tests/slack_parse_test.ts`                             |      47 |
| `tests/types_test.ts`                                   |       9 |
| `tests/usergroup_expansion_test.ts`                     |      14 |
| `tests/vote_handler_test.ts`                            |      19 |
| **Total**                                               | **310** |

## Forbidden-pattern grep

```
$ grep -rn "Deno.env" --include="*.ts" --include="*.tsx" \
    --include="*.js" --include="*.jsx" \
    --exclude-dir=archive --exclude-dir=node_modules --exclude-dir=.git .
(no matches)

$ grep -rn "process\.env\|getenv\|env\.get" --include="*.ts" --include="*.tsx" \
    --include="*.js" --include="*.jsx" \
    --exclude-dir=archive --exclude-dir=node_modules --exclude-dir=.git .
(no matches)
```

Zero matches for any environment-variable access pattern in the source tree. The
runtime depends on no env vars; criterion #12 holds.

## Sign-off

I sign off T-702 with the listed scope: §25 criteria #1, #2, #8, #11, #12 all
pass against commit 8197d71 on `rebuild/v2.0-redevelopment`. T-703 (live
workspace acceptance: criteria #3, #4, #5, #6, #7, #9, #10) remains open and
requires Slack workspace credentials and a `slack deploy` against a Pro-plan
workspace.
