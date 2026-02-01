# ConsensusBot Documentation

This directory contains comprehensive documentation for ConsensusBot (Slack Native / ROSI).

## Directory Structure

```
docs/
├── adr/                               # Architecture Decision Records
├── templates/                         # Documentation templates
├── SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md  # Architecture migration analysis
└── README.md                          # This file
```

## Getting Started

- **Main README**: See [../README.md](../README.md) for deployment instructions
- **Migration Guide**: See [../MIGRATION_GUIDE.md](../MIGRATION_GUIDE.md) for migrating from Azure
- **Slack CLI**: [Install guide](https://api.slack.com/automation/cli/install)

## Architecture Documentation

### Slack Native (ROSI) Architecture

- [Slack Native Architecture Re-evaluation](SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md) - Comprehensive analysis of the migration decision from Azure to Slack ROSI
- [Main README](../README.md) - Overview of Slack Native architecture and features
- [Migration Guide](../MIGRATION_GUIDE.md) - Step-by-step migration from Azure

### Key Benefits

✅ 90% cost reduction ($10-50/mo vs $171-266/mo)  
✅ 85% less maintenance (1-2 hrs/mo vs 8-12 hrs/mo)  
✅ Zero secret management overhead  
✅ Simplified deployment with Slack CLI  
✅ Native Slack integration

## Architecture Decision Records (ADRs)

ADRs document significant architectural and technical decisions made during the project.

### Current ADRs

- [ADR-0001: Use Slack Bolt Framework](adr/0001-use-slack-bolt-framework.md) (Azure era, now archived)
- [Architecture Re-evaluation: Migrate to Slack Native](SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md) (Current)

### Creating a New ADR

1. Copy the template from `templates/adr-template.md`
2. Number it sequentially (e.g., `0002-your-decision.md`)
3. Place it in the `adr/` directory
4. Fill in all sections
5. Submit for review via pull request

## Templates

The `templates/` directory contains templates for:

- **ADR Template**: For documenting architectural decisions
- **Feature Spec Template**: For specifying new features

## Archived Documentation (Azure Era)

Documentation for the old Azure-based architecture has been moved to:

📁 `../archive/old-azure-architecture/`

This includes:
- Azure deployment guides
- Docker setup
- Azure Functions documentation
- Node.js implementation details
- Terraform infrastructure guides
- Old test results

## External Resources

### Slack Development
- [Slack Automation Platform](https://api.slack.com/automation) - Official Slack automation documentation
- [Deno Slack SDK](https://api.slack.com/automation/functions) - SDK documentation
- [Slack CLI Guide](https://api.slack.com/automation/cli) - CLI usage and commands
- [Slack Datastores](https://api.slack.com/automation/datastores) - Datastore documentation
- [Slack Workflows](https://api.slack.com/automation/workflows) - Workflow documentation

### Deno Runtime
- [Deno Manual](https://deno.land/manual) - Deno runtime documentation
- [Deno Standard Library](https://deno.land/std) - Standard library modules
- [Deno Deploy](https://deno.com/deploy) - Deno hosting platform

## Quick Reference

### Deployment Commands

```bash
# Deploy the app
slack deploy

# View logs
slack activity --tail

# Create triggers
slack triggers create --trigger-def triggers/consensus_command.ts
slack triggers create --trigger-def triggers/reminder_schedule.ts

# Manage environment variables
slack env add KEY_NAME
slack env list
```

### Project Structure

```
ConsensusBot/
├── datastores/          # Slack Datastore schemas
├── functions/           # Custom Slack functions
├── workflows/           # Slack workflow definitions
├── triggers/            # Workflow triggers
├── utils/               # TypeScript utility functions
├── manifest.ts          # Slack app manifest
├── deno.json           # Deno configuration
└── README.md           # Main documentation
```

## Contributing to Documentation

We welcome documentation improvements! When contributing:

1. **Clarity**: Write clearly and concisely
2. **Accuracy**: Ensure technical accuracy
3. **Examples**: Include examples where helpful
4. **Structure**: Follow existing templates and patterns
5. **Links**: Link to related documentation

## Documentation Standards

### Writing Style

- Use clear, simple language
- Write in present tense
- Use active voice
- Include code examples
- Add diagrams where helpful

### Markdown Formatting

- Use proper heading hierarchy
- Include code blocks with language specification
- Use tables for structured data
- Add links to external resources

### Code Examples

```typescript
// Example: Creating a Slack function
export default SlackFunction(
  MyFunction,
  async ({ inputs, client }) => {
    // Implementation
    return { outputs: {} };
  }
);
```

## Questions?

If you have questions about the documentation:

1. Check the [Main README](../README.md)
2. Review [Slack's official docs](https://api.slack.com/automation)
3. Search [GitHub Issues](https://github.com/alex-thorne/ConsensusBot/issues)
4. Create a new issue with the `documentation` label
5. Reach out to project maintainers

## Migration from Azure

If you're migrating from the Azure-based version:

1. Read the [Migration Guide](../MIGRATION_GUIDE.md)
2. Review the [Architecture Re-evaluation](SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md)
3. Check the archived Azure documentation in `../archive/old-azure-architecture/`
4. Follow deployment steps in the [Main README](../README.md)

---

*Last Updated: February 2026*  
*Architecture: Slack Native (ROSI)*
