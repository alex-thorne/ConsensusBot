# CI/CD Testing Guide

This document describes the CI/CD testing strategy implemented for ConsensusBot.

## Overview

ConsensusBot uses a comprehensive CI/CD pipeline that includes:

1. **Unit Tests** - Test utility functions and business logic in isolation
2. **Integration Tests** - Test function workflows with mocked Slack APIs
3. **Automated CI Checks** - Linting, formatting, type checking, and validation
4. **Test Coverage** - Coverage reports generated for all tests

## Running Tests Locally

### Run All Tests

```bash
deno test --allow-all tests/
```

### Run Unit Tests Only

```bash
deno test --allow-read --allow-env tests/*.ts
```

### Run Integration Tests Only

```bash
deno test --allow-net --allow-read --allow-env tests/integration/
```

### Run Tests with Coverage

```bash
# Generate coverage data
deno test --coverage=coverage --allow-all tests/

# View coverage report
deno coverage coverage

# Generate LCOV report
deno coverage coverage --lcov > coverage.lcov
```

### Run Specific Test File

```bash
deno test --allow-all tests/decision_logic_test.ts
```

## Test Structure

```
tests/
├── *.ts                           # Unit tests for utilities and core logic
├── integration/                   # Integration tests
│   ├── create_decision_test.ts   # Tests for decision creation flow
│   ├── record_vote_test.ts       # Tests for vote recording flow
│   └── send_reminders_test.ts    # Tests for reminder flow
└── mocks/                         # Mock implementations
    └── slack_client.ts            # Mock Slack client for testing
```

## Unit Tests

Unit tests validate individual utility functions without external dependencies:

- **decision_logic_test.ts** - Vote counting, outcome calculation, deadlock
  detection
- **date_utils_test.ts** - Deadline calculations, date formatting
- **adr_generator_test.ts** - ADR markdown generation
- **types_test.ts** - Type definitions and validations

### Writing Unit Tests

```typescript
import { assertEquals } from "@std/assert";
import { myFunction } from "../utils/my_module.ts";

Deno.test("myFunction should do something", () => {
  const result = myFunction(input);
  assertEquals(result, expected);
});
```

## Integration Tests

Integration tests validate complete workflows with mocked Slack APIs:

- **create_decision_test.ts** - Full decision creation flow
- **record_vote_test.ts** - Vote recording and message updates
- **send_reminders_test.ts** - Reminder scheduling and sending

### Using Mock Slack Client

```typescript
import { createMockSlackClient } from "../mocks/slack_client.ts";

Deno.test("should post message to Slack", async () => {
  const mockClient = createMockSlackClient();

  // Perform actions with mock client
  await mockClient.chat.postMessage({
    channel: "C123456",
    text: "Test message",
  });

  // Verify interactions
  const calls = mockClient.getCallsFor("chat.postMessage");
  assertEquals(calls.length, 1);
});
```

## CI/CD Workflows

### Workflow Files

Located in `.github/workflows/`:

- **ci-cd.yml** - Main CI/CD pipeline (runs all checks)
- **unit-tests.yml** - Unit tests only
- **integration-tests.yml** - Integration tests only
- **deno-lint.yml** - Linting and formatting
- **deno-check.yml** - Type checking
- **slack-validate.yml** - Slack manifest validation

### CI/CD Pipeline Stages

The main CI/CD pipeline (`ci-cd.yml`) runs the following stages in order:

1. **Lint and Format** - Code quality checks
2. **Type Check** - TypeScript type validation
3. **Slack Validate** - Manifest and file structure validation
4. **Unit Tests** - Run all unit tests (requires stages 1-2)
5. **Integration Tests** - Run integration tests (requires stage 4)
6. **CI Success** - Overall pipeline status

### Triggering CI/CD

The pipeline runs automatically on:

- **Push to `development` branch** - Full pipeline
- **Push to `main` branch** - Full pipeline
- **Pull requests to `development`** - Full pipeline
- **Pull requests to `main`** - Full pipeline

### Viewing CI Results

1. Go to the repository on GitHub
2. Click the "Actions" tab
3. Select a workflow run to view details
4. Click on individual jobs to see logs

## Test Coverage

Test coverage is automatically generated during CI runs and uploaded as
artifacts.

### Viewing Coverage Locally

```bash
# Generate coverage
deno test --coverage=coverage --allow-all tests/

# View summary in terminal
deno coverage coverage

# Generate HTML report (requires lcov tools)
deno coverage coverage --lcov > coverage.lcov
genhtml coverage.lcov -o coverage_html
```

### Coverage Reports in CI

Coverage reports are uploaded as artifacts in the CI pipeline:

1. Go to the workflow run in GitHub Actions
2. Scroll to "Artifacts" section at the bottom
3. Download `unit-test-coverage` artifact
4. Extract and view the `coverage.lcov` file

## Best Practices

### Writing Tests

1. **Test one thing per test** - Each test should validate a single behavior
2. **Use descriptive names** - Test names should clearly describe what's being
   tested
3. **Follow AAA pattern** - Arrange, Act, Assert
4. **Keep tests independent** - Tests should not depend on each other
5. **Use mocks appropriately** - Mock external dependencies, not internal logic

### Test Coverage Goals

- **Aim for 80%+ coverage** on utility functions
- **Cover edge cases** - Test boundary conditions and error cases
- **Test happy path first** - Then add tests for error conditions

### Running Tests Before Committing

Always run tests locally before pushing:

```bash
# Run all checks that CI will run
deno lint
deno fmt --check
deno check manifest.ts functions/*.ts workflows/*.ts utils/*.ts
deno test --allow-all tests/
```

## Future Enhancements

The following testing capabilities can be added in the future:

### End-to-End Tests

E2E tests would test the complete application in a real Slack workspace:

- Requires a dedicated test Slack workspace
- Needs Slack API tokens configured as secrets
- Tests actual workflow triggers and user interactions

### Automated Deployment

Automatic deployment to test/production workspaces:

- Deploy to test workspace on `development` branch
- Deploy to production on `main` branch (with approvals)
- Requires `SLACK_TEST_TOKEN` and `SLACK_PROD_TOKEN` secrets

### Visual Regression Testing

Test Slack message block layouts:

- Snapshot testing for message blocks
- Ensure UI changes don't break unexpectedly

## Troubleshooting

### Tests Fail Locally But Pass in CI

- Check Deno version: `deno --version`
- Update Deno to latest: Follow instructions at https://deno.land/
- Clear Deno cache: `deno cache --reload manifest.ts`

### Permission Errors

Ensure you're running tests with correct permissions:

```bash
# Most tests need these permissions
deno test --allow-read --allow-env --allow-net tests/
```

### Import Errors

If you see module not found errors:

```bash
# Cache all dependencies
deno cache manifest.ts
deno cache tests/**/*.ts
```

## Additional Resources

- [Deno Testing Documentation](https://deno.land/manual/testing)
- [Deno Standard Library Assertions](https://deno.land/std/assert)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Slack API Testing Best Practices](https://api.slack.com/best-practices/testing)

## Questions or Issues?

If you encounter issues with the testing infrastructure:

1. Check this documentation first
2. Review existing test files for examples
3. Check CI logs for specific error messages
4. Open an issue with details about the problem
