# GitHub Actions Workflows

This directory contains CI/CD workflows for ConsensusBot (Slack Native / ROSI).

## Active Workflows

### deno-lint.yml
Runs Deno's built-in linter and formatter on all TypeScript files.

**Checks:**
- `deno lint` - Linting rules
- `deno fmt --check` - Code formatting

### deno-check.yml
Validates TypeScript types across all source files.

**Checks:**
- Type checks manifest.ts
- Type checks all functions/*.ts
- Type checks all workflows/*.ts
- Type checks all utils/*.ts

### slack-validate.yml
Validates Slack app structure and configuration files.

**Checks:**
- Manifest.ts syntax validation
- Required files presence (manifest.ts, deno.json, slack.json)
- Required directories (datastores, functions, workflows, triggers)
- JSON file validity

## Archived Workflows

Old Node.js and Docker workflows have been moved to:
`archive/old-azure-architecture/.github/workflows/`

These include:
- test.yml (npm test - no longer applicable)
- lint.yml (ESLint - replaced by Deno lint)
- docker.yml (Docker build - no longer applicable)

## Running Checks Locally

```bash
# Install Deno (if not already installed)
curl -fsSL https://deno.land/install.sh | sh

# Run lint
deno lint

# Check formatting
deno fmt --check

# Type check
deno check manifest.ts
deno check functions/*.ts
deno check workflows/*.ts
deno check utils/*.ts

# Validate JSON
cat deno.json | jq empty
cat slack.json | jq empty
```

## CI Trigger Events

All workflows run on:
- Push to `development` branch
- Pull requests targeting `development` branch

## Notes

- No tests are configured yet (Deno test framework to be added in future)
- Slack CLI validation would require Slack credentials (not run in CI)
- Focus is on syntax validation and type checking
