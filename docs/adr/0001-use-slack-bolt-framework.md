# ADR-0001: Use Slack Bolt Framework for Bot Development

## Status

Accepted

## Context

ConsensusBot is a Slack application designed to facilitate team decision-making. We need to choose a framework for building the Slack bot that will:

- Handle Slack API interactions reliably
- Support modern Slack features (modals, blocks, shortcuts)
- Provide good developer experience
- Be well-maintained and documented
- Support both HTTP and Socket Mode

## Decision

We will use the **Slack Bolt Framework for JavaScript** (@slack/bolt) as the foundation for building ConsensusBot.

## Consequences

### Positive

- **Official Support**: Maintained by Slack, ensuring compatibility with new features
- **Modern API**: Built-in support for Block Kit, modals, shortcuts, and interactive components
- **Socket Mode**: Enables local development without exposing public endpoints
- **Excellent Documentation**: Comprehensive guides and examples
- **Active Community**: Large community and regular updates
- **Type Safety**: TypeScript definitions available
- **Middleware Support**: Easy to extend with custom middleware

### Negative

- **Framework Lock-in**: Tied to Slack's ecosystem (acceptable for a Slack-specific bot)
- **Learning Curve**: Developers must learn Bolt-specific patterns
- **Node.js Only**: Limits language choice to JavaScript/TypeScript

### Neutral

- Requires Node.js runtime environment
- Uses event-driven architecture

## Alternatives Considered

### Alternative 1: Custom Implementation with Slack Web API

- **Description**: Build directly on top of Slack's Web API and Events API
- **Pros**: 
  - Complete control over implementation
  - No framework dependencies
  - Can optimize for specific use cases
- **Cons**: 
  - Significant development overhead
  - Need to handle authentication, verification, and event routing manually
  - More maintenance burden
  - Reinventing the wheel
- **Reason for rejection**: Not worth the development effort when a well-maintained framework exists

### Alternative 2: Botkit

- **Description**: Use Botkit framework for building bots
- **Pros**: 
  - Multi-platform support (Slack, Teams, etc.)
  - Rich conversation flows
- **Cons**: 
  - Less focused on Slack-specific features
  - Smaller community than Bolt
  - Not officially maintained by Slack
- **Reason for rejection**: Bolt is the official framework and better suited for Slack-only applications

### Alternative 3: Hubot

- **Description**: Use GitHub's Hubot framework
- **Pros**: 
  - Proven track record
  - Many existing scripts
- **Cons**: 
  - Older framework, less actively maintained
  - Not optimized for modern Slack features
  - CoffeeScript heritage (though JavaScript supported)
- **Reason for rejection**: Bolt is more modern and better aligned with current Slack capabilities

## Implementation Notes

- Install @slack/bolt via npm
- Use Socket Mode for local development to avoid ngrok or similar tunneling
- Structure the application with clear separation of concerns:
  - Event handlers
  - Commands
  - Views/Modals
  - Middleware
- Consider upgrading to TypeScript in the future for better type safety

## References

- [Slack Bolt Framework Documentation](https://slack.dev/bolt-js/)
- [Slack API Documentation](https://api.slack.com/)
- [Bolt GitHub Repository](https://github.com/slackapi/bolt-js)

---

**Date**: 2026-01-31

**Author(s)**: ConsensusBot Team

**Reviewers**: N/A (Initial decision)
