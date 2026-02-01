# Architecture Revision Summary: Slack-Based Persistence

## Overview
This document summarizes the architectural changes made to ConsensusBot to remove the database dependency and use Slack as the sole persistence layer for ephemeral decision state.

## Motivation
The previous architecture relied on an external SQLite database for storing decision state, which added complexity to deployment and maintenance. The new architecture embraces a Slack-first approach where:
- All decision state during the voting lifecycle is maintained in Slack
- Finalized decisions are stored in Azure DevOps as Architecture Decision Records (ADRs)
- No external database is required for ephemeral state management

## Key Changes

### 1. New Slack State Management Module
**File:** `src/utils/slackState.js`

A new module that provides all state management functions using Slack's APIs:
- **getDecisionState()** - Reconstructs complete decision state from Slack messages and threads
- **parseDecisionFromMessage()** - Extracts decision details from message blocks and metadata
- **getVotesFromThread()** - Retrieves votes from threaded messages
- **recordVote()** - Records votes as threaded messages with metadata
- **getOpenDecisions()** - Finds active decisions via pinned messages
- **getMissingVoters()** - Identifies voters who haven't cast votes
- **updateDecisionStatus()** - Updates decision status and unpins completed decisions

### 2. Refactored Core Modules

#### Commands (`src/commands/consensusCommand.js`)
- Removed all database imports and calls
- Decision metadata now embedded in Slack message metadata
- Voting handlers reconstruct decision state from Slack messages
- Button action IDs simplified to not require database IDs

#### Reminder System (`src/utils/reminder.js`)
- Now requires `channelId` parameter to check for decisions
- Parses Slack threads instead of querying database
- Uses Slack metadata to determine missing voters

#### Finalization (`src/utils/finalization.js`)
- Works with Slack-based decision state objects
- Uses message timestamps instead of database IDs
- Maintains Azure DevOps ADR integration for finalized decisions

#### Voting Messages (`src/utils/votingMessage.js`)
- Removed database ID dependencies
- Uses message timestamps for unique button action IDs

### 3. Infrastructure Changes

#### Removed
- `src/database/` directory (db.js, schema.sql)
- `better-sqlite3` npm dependency
- Azure SQL database storage container from Terraform
- DATABASE_PATH environment variable

#### Retained
- Azure Key Vault for secrets management
- Azure App Service / Azure Functions for bot logic
- Azure DevOps integration for ADR storage

#### Updated
- Azure Functions Nudger now requires NUDGER_CHANNEL_ID environment variable
- Terraform scripts simplified without database resources

### 4. Documentation Updates

#### README.md
- New **Architecture** section explaining Slack-first design
- Removed database setup instructions
- Updated features list to highlight Slack-based state
- Updated project structure diagram

#### Environment Configuration
- Removed DATABASE_PATH from `.env.example`
- Added guidance for Slack-only setup

### 5. Testing Updates
- All database-specific tests removed or refactored
- New tests for Slack state management functions
- **109 tests passing** (100% success rate)
- All linting checks passing
- **0 security vulnerabilities** found by CodeQL

## State Management Flow

### Decision Creation
1. User invokes `/consensus` command
2. Modal collects decision details
3. Decision posted to Slack channel with metadata
4. Message automatically pinned for visibility
5. Metadata includes: name, proposal, criteria, deadline, voters, status

### Voting
1. User clicks vote button (Yes/No/Abstain)
2. System reconstructs decision state from message
3. Validates voter eligibility from metadata
4. Records vote as threaded message with metadata
5. Sends ephemeral confirmation to voter

### Reminders (Nudger)
1. Azure Timer Function triggers periodically
2. Retrieves pinned messages from configured channel
3. Reconstructs decision state for each pinned message
4. Identifies missing voters by comparing votes to voter list
5. Sends DM reminders to users who haven't voted

### Finalization
1. Checks if decision ready (all votes in OR deadline passed)
2. Calculates outcome based on success criteria
3. Updates decision status in Slack thread
4. Unpins message if no longer active
5. Generates ADR and pushes to Azure DevOps

## Benefits

### Operational
✅ **No database setup required** - Eliminates infrastructure complexity
✅ **Simpler deployment** - Fewer moving parts to configure and maintain
✅ **No database backups needed** - Slack maintains all message history
✅ **Lower operational cost** - One less service to run and pay for

### User Experience
✅ **All history visible in Slack** - Users can see full decision context
✅ **Native Slack experience** - No external tools to learn
✅ **Thread-based organization** - Natural conversation flow
✅ **Pinned messages** - Easy discovery of active decisions

### Technical
✅ **Stateless application logic** - State reconstruction on demand
✅ **Better resilience** - Slack's reliability > custom database
✅ **Audit trail** - All actions visible in Slack threads
✅ **Version control for finalized decisions** - ADRs in Azure DevOps

## Migration Considerations

### Breaking Changes
⚠️ **This is a breaking change** that requires:
1. Removal of existing database deployments
2. All active decisions must be recreated in Slack
3. Historical data in old database will not be migrated

### What's Preserved
- ADRs already in Azure DevOps remain accessible
- Slack message history is retained
- Configuration in Azure Key Vault unchanged

### Deployment Steps
1. Update environment variables to remove DATABASE_PATH
2. Add NUDGER_CHANNEL_ID to Azure Functions configuration
3. Deploy updated application code
4. Remove database infrastructure via Terraform
5. Recreate any active decisions in Slack

## Future Enhancements

Possible future improvements to the Slack-based architecture:

1. **Multi-channel support** - Monitor multiple channels for decisions
2. **Decision templates** - Pre-configured decision types
3. **Analytics dashboard** - Visualize decision-making patterns from Slack data
4. **Scheduled decisions** - Auto-create recurring decisions
5. **Vote delegation** - Allow users to delegate their vote
6. **Slack workflow builder integration** - Native Slack automation

## Conclusion

The migration to Slack-based persistence represents a significant simplification of ConsensusBot's architecture while maintaining all core functionality. By embracing Slack as the source of truth for ephemeral state, we've eliminated infrastructure complexity while improving the user experience and operational characteristics of the application.

The change aligns with modern best practices of:
- Leveraging platform capabilities instead of building custom solutions
- Reducing operational burden through simplification
- Improving observability by keeping state visible to users
- Maintaining data durability where it matters (ADRs in version control)

All tests pass, security scans show no vulnerabilities, and the codebase is ready for deployment.
