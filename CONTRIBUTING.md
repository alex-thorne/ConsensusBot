# Contributing to ConsensusBot

Thank you for your interest in contributing to ConsensusBot! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Enhancements](#suggesting-enhancements)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

### Our Standards

- Be respectful and considerate of others
- Welcome diverse perspectives and experiences
- Focus on what's best for the community and project
- Show empathy towards other community members

## Getting Started

1. **Fork the Repository**
   ```bash
   # Click the 'Fork' button on GitHub, then clone your fork
   git clone https://github.com/YOUR-USERNAME/ConsensusBot.git
   cd ConsensusBot
   ```

2. **Set Up Development Environment**
   ```bash
   # Install dependencies
   npm install
   
   # Copy environment variables
   cp .env.example .env
   # Edit .env with your Slack credentials
   ```

3. **Create a Branch**
   ```bash
   # Create a feature branch
   git checkout -b feature/your-feature-name
   ```

## How to Contribute

### Types of Contributions

We welcome various types of contributions:

- **Bug Fixes**: Fix issues identified in the issue tracker
- **New Features**: Implement new functionality
- **Documentation**: Improve or add documentation
- **Tests**: Add or improve test coverage
- **Refactoring**: Improve code quality and structure
- **Infrastructure**: Enhance CI/CD, deployment, or tooling

## Development Workflow

### 1. Local Development

```bash
# Run the application in development mode
npm run dev

# Run tests
npm test

# Run linting
npm run lint
```

### 2. Make Your Changes

- Write clean, readable code
- Follow the existing code style
- Add comments for complex logic
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run the full test suite
npm test

# Run linting
npm run lint

# Test with Docker
docker-compose up
```

### 4. Commit Your Changes

```bash
# Stage your changes
git add .

# Commit with a descriptive message
git commit -m "feat: add new voting mechanism"
```

#### Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

Examples:
```
feat: add approval voting option
fix: resolve issue with proposal submission
docs: update README with Docker instructions
test: add tests for consensus calculation
```

## Coding Standards

### JavaScript/Node.js

- Use ES6+ features where appropriate
- Follow the ESLint configuration (`.eslintrc.json`)
- Use meaningful variable and function names
- Keep functions small and focused on a single task
- Add JSDoc comments for public APIs

```javascript
/**
 * Calculate consensus percentage for a proposal
 * @param {Object} proposal - The proposal object
 * @param {Array} votes - Array of vote objects
 * @returns {number} - Consensus percentage (0-100)
 */
function calculateConsensus(proposal, votes) {
  // Implementation
}
```

### File Organization

- Place source code in `src/`
- Place tests in `test/` mirroring the `src/` structure
- Place configuration in `config/`
- Place documentation in `docs/`

## Testing Guidelines

### Writing Tests

- Write tests for all new features
- Ensure tests are isolated and repeatable
- Use descriptive test names
- Aim for high code coverage (minimum 80%)

```javascript
describe('ConsensusCalculator', () => {
  describe('calculateConsensus', () => {
    it('should return 100 when all votes are in favor', () => {
      // Test implementation
    });

    it('should return 0 when no votes are in favor', () => {
      // Test implementation
    });
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm test -- --coverage
```

## Pull Request Process

### Before Submitting

1. **Update Documentation**: Ensure README and other docs reflect your changes
2. **Run Tests**: All tests must pass
3. **Run Linting**: Code must pass linting checks
4. **Update CHANGELOG**: Add your changes to the changelog (if applicable)

### Submitting a Pull Request

1. **Push to Your Fork**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create Pull Request**
   - Go to the original repository on GitHub
   - Click "New Pull Request"
   - Select your fork and branch
   - Fill in the PR template

3. **PR Title and Description**
   - Use a clear, descriptive title
   - Explain what changes you made and why
   - Reference any related issues (e.g., "Fixes #123")

4. **PR Checklist**
   - [ ] Code follows the project's coding standards
   - [ ] Tests have been added or updated
   - [ ] Documentation has been updated
   - [ ] All tests pass
   - [ ] Linting passes
   - [ ] No merge conflicts

### Review Process

- Maintainers will review your PR
- Address any feedback or requested changes
- Once approved, a maintainer will merge your PR

## Reporting Bugs

### Before Reporting

- Check if the bug has already been reported
- Verify you're using the latest version
- Collect relevant information

### Bug Report Template

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment**
- OS: [e.g., Ubuntu 22.04]
- Node.js version: [e.g., 18.16.0]
- ConsensusBot version: [e.g., 0.1.0]

**Additional context**
Any other relevant information.
```

## Suggesting Enhancements

### Enhancement Proposal Template

```markdown
**Is your feature request related to a problem?**
A clear description of the problem.

**Describe the solution you'd like**
What you want to happen.

**Describe alternatives you've considered**
Alternative solutions or features.

**Additional context**
Any other context, mockups, or examples.
```

## Development Tips

### Useful Commands

```bash
# Install a new dependency
npm install package-name

# Update dependencies
npm update

# Check for outdated packages
npm outdated

# Run security audit
npm audit

# Build Docker image
docker build -t consensusbot .
```

### Debugging

- Use `console.log()` for simple debugging
- Use Node.js debugger for complex issues
- Check Slack API logs in your app dashboard
- Review application logs in Docker

### Working with Slack

- Test in a development Slack workspace
- Use Socket Mode for local development
- Review Slack's [API documentation](https://api.slack.com/)
- Test all slash commands and interactions

## Architecture Decision Records (ADRs)

For significant architectural decisions:

1. Create an ADR using the template in `docs/templates/adr-template.md`
2. Place it in `docs/adr/`
3. Number it sequentially (e.g., `0001-decision-title.md`)
4. Include in your PR for discussion

## Questions?

If you have questions:

- Check the documentation in `docs/`
- Review existing issues and PRs
- Ask in the project discussions
- Reach out to maintainers

## Recognition

Contributors will be recognized in:
- The project README
- Release notes
- GitHub contributors page

Thank you for contributing to ConsensusBot! 🎉
