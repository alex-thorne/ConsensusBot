# Development Guide

Guide for developing and testing ConsensusBot locally.

## Setup

### 1. Install Prerequisites

```bash
# Install Deno
curl -fsSL https://deno.land/install.sh | sh

# Install Slack CLI (macOS)
brew install slack

# Or Linux
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash
```

### 2. Authenticate

```bash
slack login
```

### 3. Clone and Initialize

```bash
git clone https://github.com/alex-thorne/ConsensusBot.git
cd ConsensusBot
slack create
```

## Branching Workflow

```
feature/my-feature  ──PR──▶  develop  ──PR──▶  main
                              │                  │
                         slack run           slack deploy
                        (shakedown)         (production)
```

1. Create a feature branch from `develop`
2. Make changes and open a PR targeting `develop`
3. After CI passes and review, merge to `develop`
4. Test locally: `git checkout develop && slack run`
5. When ready for release, open a PR from `develop` → `main`
6. After merging to `main`, tag the release and deploy:
   ```bash
   git tag vX.Y.Z # e.g., v1.0.0
   git push origin vX.Y.Z
   slack deploy
   ```

## Local Development

### Running Locally

Start the app in development mode:

```bash
slack run
```

This:

- Connects to your workspace via Socket Mode
- Enables hot-reloading on file changes
- Shows real-time logs in the terminal

### Making Changes

1. Edit files in `functions/`, `workflows/`, `utils/`, etc.
2. Save changes (auto-reloads with `slack run`)
3. Test in Slack
4. Iterate

### Testing Changes

```bash
# In Slack, test the /consensus command
/consensus

# Check logs
slack activity --tail
```

## Project Structure

```
ConsensusBot/
├── datastores/          # Datastore schemas
│   ├── decisions.ts
│   ├── votes.ts
│   └── voters.ts
├── functions/           # Custom functions
│   ├── create_decision.ts
│   ├── record_vote.ts
│   └── send_reminders.ts
├── workflows/           # Workflow definitions
│   ├── create_decision.ts
│   ├── vote.ts
│   └── send_reminders.ts
├── triggers/            # Trigger definitions
│   ├── consensus_command.ts
│   └── reminder_schedule.ts
├── utils/               # Utility functions
│   ├── decision_logic.ts
│   ├── date_utils.ts
│   └── adr_generator.ts
├── manifest.ts          # App manifest
├── deno.json           # Deno configuration
└── slack.json          # Slack CLI config
```

## Adding New Features

### 1. Create a New Function

```typescript
// functions/my_function.ts
import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";

export const MyFunction = DefineFunction({
  callback_id: "my_function",
  title: "My Function",
  source_file: "functions/my_function.ts",
  input_parameters: {
    properties: {
      my_input: {
        type: Schema.types.string,
      },
    },
    required: ["my_input"],
  },
  output_parameters: {
    properties: {
      my_output: {
        type: Schema.types.string,
      },
    },
    required: ["my_output"],
  },
});

export default SlackFunction(
  MyFunction,
  async ({ inputs, client }) => {
    // Implementation
    return {
      outputs: {
        my_output: "result",
      },
    };
  },
);
```

### 2. Create a Workflow

```typescript
// workflows/my_workflow.ts
import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { MyFunction } from "../functions/my_function.ts";

const MyWorkflow = DefineWorkflow({
  callback_id: "my_workflow",
  title: "My Workflow",
  input_parameters: {
    properties: {
      channel_id: {
        type: Schema.slack.types.channel_id,
      },
    },
    required: ["channel_id"],
  },
});

MyWorkflow.addStep(MyFunction, {
  my_input: "test",
});

export default MyWorkflow;
```

### 3. Add to Manifest

```typescript
// manifest.ts
import MyWorkflow from "./workflows/my_workflow.ts";

export default Manifest({
  // ...
  workflows: [
    CreateDecisionWorkflow,
    VoteWorkflow,
    SendRemindersWorkflow,
    MyWorkflow, // Add here
  ],
  // ...
});
```

### 4. Deploy

```bash
slack deploy
```

## Debugging

### View Logs

```bash
# Real-time logs
slack activity --tail

# Recent activity
slack activity

# Filter by workflow
slack activity --workflow create_decision_workflow
```

### Common Issues

**Function not found:**

- Check that function is imported in workflow
- Verify `source_file` path is correct
- Re-deploy: `slack deploy`

**Datastore error:**

- Ensure paid Slack plan
- Check datastore name matches definition
- Verify permissions in manifest

**Trigger not working:**

- List triggers: `slack triggers list`
- Recreate: `slack triggers create --trigger-def triggers/my_trigger.ts`

## Code Quality

### TypeScript

Deno has built-in TypeScript support. No compilation step needed!

### Formatting

```bash
# Format code
deno fmt

# Check formatting
deno fmt --check
```

### Linting

```bash
# Lint code
deno lint
```

## Testing

### Manual Testing

1. Deploy to development workspace
2. Test via Slack UI
3. Check logs for errors

### Future: Automated Testing

Deno has a built-in test runner. Tests can be added like:

```typescript
// my_function_test.ts
import { assertEquals } from "https://deno.land/std/assert/mod.ts";

Deno.test("my function works", () => {
  // Test implementation
  assertEquals(1 + 1, 2);
});
```

Run with:

```bash
deno test
```

## Deployment

### Development

```bash
slack run  # Local development
```

### Staging

```bash
slack deploy  # Deploy to workspace
```

### Production

1. Create separate Slack app for production
2. Deploy: `slack deploy`
3. Configure triggers
4. Monitor: `slack activity`

## Contributing

1. Create a feature branch
2. Make changes
3. Test locally with `slack run`
4. Deploy and test in dev workspace
5. Submit PR

## Resources

- [Deno Manual](https://deno.land/manual)
- [Deno Slack SDK](https://api.slack.com/automation/functions)
- [Slack CLI Guide](https://api.slack.com/automation/cli)
- [Slack Workflows](https://api.slack.com/automation/workflows)

---

_Happy coding! 🚀_
