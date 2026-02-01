# CI/CD Update for Slack Native Architecture

## Summary

GitHub Actions workflows have been updated to reflect the migration from
Node.js/Azure to Slack Native (ROSI) with Deno.

## Changes Made

### Removed Workflows (Archived)

The following workflows were archived to
`archive/old-azure-architecture/.github/workflows/`:

1. **test.yml** - Node.js test suite with Jest
   - Ran `npm test` with coverage
   - Uploaded coverage to Codecov
   - No longer applicable (no package.json or Jest)

2. **lint.yml** - ESLint code quality checks
   - Ran `npm run lint` for JavaScript linting
   - No longer applicable (using Deno's built-in linter)

3. **docker.yml** - Docker image build validation
   - Built and validated Docker images
   - No longer applicable (Slack Native uses managed runtime)

### New Workflows (Active)

#### 1. deno-lint.yml

**Purpose:** Code quality and formatting validation

**Steps:**

- Checkout code
- Setup Deno v1.x
- Run `deno lint` (linting)
- Run `deno fmt --check` (formatting)

**Triggers:** Push to development, PRs to development

#### 2. deno-check.yml

**Purpose:** TypeScript type checking

**Steps:**

- Checkout code
- Setup Deno v1.x
- Cache Deno dependencies
- Type check manifest.ts
- Type check functions/*.ts
- Type check workflows/*.ts
- Type check utils/*.ts

**Triggers:** Push to development, PRs to development

#### 3. slack-validate.yml

**Purpose:** Slack app structure validation

**Steps:**

- Checkout code
- Setup Deno v1.x
- Validate manifest.ts syntax
- Verify required files exist
- Validate JSON files (deno.json, slack.json)

**Triggers:** Push to development, PRs to development

## Why These Changes?

### Before (Node.js/Azure)

- Required `npm ci` to install dependencies (~1-2 minutes)
- Used ESLint with custom configuration
- Used Jest for testing (166 tests)
- Built Docker images for validation
- Multiple matrix builds (Node 18.x, 20.x)

**Total CI time:** ~5-10 minutes per check

### After (Deno/Slack Native)

- No dependency installation needed
- Built-in Deno linter and formatter
- Type checking validates correctness
- No Docker builds needed
- Single runtime version (Deno v1.x)

**Total CI time:** ~30-60 seconds per check

## Benefits

1. **Faster CI runs:** 90% reduction in CI time
2. **Simpler configuration:** No dependency management
3. **Native tooling:** Deno provides all tools needed
4. **Consistent with architecture:** Matches Slack Native approach
5. **Type safety:** TypeScript validation ensures correctness

## Running Checks Locally

```bash
# Install Deno (one-time)
curl -fsSL https://deno.land/install.sh | sh

# Run all checks
deno lint                    # Linting
deno fmt --check            # Formatting
deno check manifest.ts      # Type check manifest
deno check functions/*.ts   # Type check functions
deno check workflows/*.ts   # Type check workflows
deno check utils/*.ts       # Type check utilities

# Auto-fix formatting
deno fmt
```

## Future Enhancements

### Planned

- [ ] Add Deno test framework for unit tests
- [ ] Add integration tests for workflows
- [ ] Add Slack CLI validation (requires credentials)
- [ ] Add deployment workflow for production

### Not Planned

- ❌ Jest tests (replaced by Deno test when implemented)
- ❌ ESLint (Deno lint is sufficient)
- ❌ Docker builds (not applicable to Slack Native)
- ❌ Codecov uploads (until Deno tests are added)

## Migration Notes

### For Contributors

If you were familiar with the old CI setup:

**Old workflow:**

```bash
npm install
npm test
npm run lint
```

**New workflow:**

```bash
deno fmt          # Format code
deno lint         # Lint code
deno check *.ts   # Type check
```

### Breaking Changes

- No `npm` commands work anymore (package.json archived)
- No Jest tests (will be replaced with Deno tests)
- No Docker builds (Slack manages runtime)
- CI only runs on `development` branch (not `main`)

### Compatibility

All new workflows are compatible with:

- GitHub Actions latest runners (ubuntu-latest)
- Deno v1.x (latest stable)
- No external dependencies required

## Troubleshooting

### Common Issues

**"deno: command not found"**

- Install Deno locally: `curl -fsSL https://deno.land/install.sh | sh`
- Add to PATH: `export PATH="$HOME/.deno/bin:$PATH"`

**Type check fails**

- Ensure all imports are correct
- Check Deno SDK version in deno.json
- Run `deno cache manifest.ts` to update cache

**Lint fails**

- Run `deno fmt` to auto-fix formatting
- Review lint errors: `deno lint --json`

**Workflow fails on GitHub**

- Check workflow logs in Actions tab
- Verify YAML syntax is valid
- Ensure all paths are correct

## References

- [Deno Manual](https://deno.land/manual)
- [Deno Lint Rules](https://lint.deno.land/)
- [Slack Automation Docs](https://api.slack.com/automation)
- [GitHub Actions Deno](https://github.com/denoland/setup-deno)

---

_Last Updated: February 2026_ _CI Architecture: Deno-based (Slack Native)_
