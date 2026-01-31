# ConsensusBot Documentation

This directory contains comprehensive documentation for the ConsensusBot project.

## Directory Structure

```
docs/
├── adr/                  # Architecture Decision Records
├── templates/            # Documentation templates
└── README.md            # This file
```

## Architecture Decision Records (ADRs)

ADRs document significant architectural and technical decisions made during the project. Each ADR follows a structured format and is numbered sequentially.

### Current ADRs

- [ADR-0001: Use Slack Bolt Framework](adr/0001-use-slack-bolt-framework.md)

### Creating a New ADR

1. Copy the template from `templates/adr-template.md`
2. Number it sequentially (e.g., `0002-your-decision.md`)
3. Place it in the `adr/` directory
4. Fill in all sections
5. Submit for review via pull request

## Templates

The `templates/` directory contains templates for various documentation types:

- **ADR Template**: For documenting architectural decisions
- **Feature Spec Template**: For specifying new features

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

```javascript
// Always include comments in code examples
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});
```

## Additional Resources

- [README.md](../README.md) - Project overview and setup
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
- [Slack Bolt Documentation](https://slack.dev/bolt-js/)

## Questions?

If you have questions about the documentation:

1. Check existing documentation thoroughly
2. Search for related GitHub issues
3. Create a new issue with the `documentation` label
4. Reach out to project maintainers
