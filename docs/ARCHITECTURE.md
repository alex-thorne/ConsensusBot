# ConsensusBot Architecture

## Overview

ConsensusBot is a Slack application designed to facilitate team decision-making through a lightweight, ephemeral state model. The bot is **not** a system of record but rather a decision facilitator that outputs finalized decisions to Azure DevOps as Architecture Decision Records (ADRs).

## Design Principles

1. **Slack as Persistence Layer**: Active decision state is managed entirely through Slack threads and messages
2. **Ephemeral State**: Decision tracking only exists while decisions are active
3. **Azure DevOps as System of Record**: Finalized decisions are stored as ADRs in Azure DevOps
4. **Minimal Infrastructure**: No database required, reducing operational overhead

## Architecture Components

### 1. Slack Integration Layer

#### Slash Command Handler (`/consensus`)
- Initiates new decision-making processes
- Creates pinned message in designated Slack channel
- Initializes decision thread with participants

#### State Management via Slack
- **Pinned Messages**: Store decision metadata and current status
- **Thread Replies**: Track votes and discussion
- **Message Metadata**: Store decision parameters (deadline, participants, etc.)
- **Block Kit Buttons**: Interactive voting UI (Yes, No, Abstain)

#### State Reconstruction
The bot reconstructs decision state by:
1. Reading pinned messages to identify active decisions
2. Parsing thread replies to collect votes
3. Comparing voters against participant list
4. Checking timestamps for deadline enforcement

### 2. Voting System

#### Interactive Components
- Slack Block Kit buttons for voting actions
- Real-time vote updates in thread
- Vote summary in pinned message

#### Vote Tracking
- Votes stored as thread replies with structured metadata
- Each vote includes: user ID, choice (Yes/No/Abstain), timestamp
- Vote changes allowed by updating user's latest vote in thread

### 3. Nudger (Reminder System)

#### Without Database
The nudger operates by:
1. **Discovery**: Scans pinned messages in designated channels
2. **Deadline Check**: Compares message timestamps against deadline metadata
3. **Voter Identification**: Parses thread to identify missing voters
4. **Direct Messages**: Sends reminders to users who haven't voted

#### Scheduling
- Azure Function with timer trigger (hourly/daily check)
- No database queries needed - all state from Slack API

### 4. Azure DevOps Integration

#### ADR Generation
When a decision is finalized:
1. Collect decision details from Slack thread
2. Generate Markdown ADR file
3. Format: `YYYY-MM-DD-decision-name.md`
4. Include: decision, votes, participants, rationale

#### Repository Push
- Push ADR to `KB.ProcessDocs/decisions/` in Azure DevOps
- Use Azure DevOps REST API
- Credentials stored in Azure Key Vault

### 5. Infrastructure

#### Azure Resources
- **Azure App Service / Azure Functions**: Host bot logic
- **Azure Key Vault**: Store secrets (Slack tokens, Azure DevOps PAT)
- **Application Insights**: Monitoring and logging

#### No Database Required
- Removed: Azure SQL Database
- State management entirely through Slack API
- Reduced operational complexity and cost

## Data Flow

### Decision Creation Flow
```
1. User runs /consensus command in Slack
2. Bot validates command parameters
3. Bot creates pinned message with decision details
4. Bot initializes thread with voting buttons
5. Bot mentions participant users
```

### Voting Flow
```
1. User clicks Yes/No/Abstain button
2. Bot receives interaction event
3. Bot posts vote as thread reply
4. Bot updates pinned message summary
5. Bot checks if all votes collected
```

### Nudger Flow
```
1. Timer trigger activates Azure Function
2. Function queries Slack for pinned messages
3. Function identifies overdue decisions
4. Function parses threads to find missing voters
5. Function sends DMs to non-voters
```

### Finalization Flow
```
1. All votes collected OR deadline reached
2. Bot generates ADR Markdown
3. Bot pushes ADR to Azure DevOps
4. Bot unpins message and closes thread
5. Bot posts completion message
```

## State Model

### Decision State
Stored in Slack pinned message metadata:
- Decision ID (message timestamp)
- Decision text
- Initiator user ID
- Participant user IDs
- Deadline timestamp
- Required threshold (e.g., majority, unanimous)

### Vote State
Stored in Slack thread replies:
- User ID
- Vote choice (Yes/No/Abstain)
- Vote timestamp
- Optional comment

### Reconstruction Algorithm
```python
def get_decision_state(channel_id, decision_message_ts):
    # 1. Get pinned message for decision metadata
    decision_msg = slack_client.get_message(channel_id, decision_message_ts)
    metadata = parse_decision_metadata(decision_msg)
    
    # 2. Get all thread replies for votes
    replies = slack_client.get_thread_replies(channel_id, decision_message_ts)
    votes = parse_votes_from_replies(replies)
    
    # 3. Identify missing voters
    participants = metadata['participants']
    voters = set(vote['user_id'] for vote in votes)
    missing = participants - voters
    
    # 4. Check deadline
    is_overdue = datetime.now() > metadata['deadline']
    
    return {
        'decision': metadata,
        'votes': votes,
        'missing_voters': missing,
        'is_overdue': is_overdue
    }
```

## Edge Cases and Handling

### 1. Simultaneous Votes
- Each vote is a separate thread reply
- Latest vote per user takes precedence
- Timestamps used for ordering

### 2. User Leaves Team
- Bot detects user no longer in workspace
- Excludes from required voter count
- Documents in ADR notes

### 3. Channel Deletion
- Bot receives channel deletion event
- Attempts to finalize pending decisions
- Generates ADRs with "cancelled" status

### 4. Bot Downtime
- No state lost (all in Slack)
- On restart, bot rescans pinned messages
- Resumes nudging and monitoring

### 5. Slack API Rate Limits
- Implement exponential backoff
- Cache message data when possible
- Batch operations where allowed

## Security Considerations

### Secrets Management
- Slack Bot Token: Azure Key Vault
- Slack Signing Secret: Azure Key Vault
- Azure DevOps PAT: Azure Key Vault
- All secrets injected as environment variables

### Access Control
- Slack workspace-level permissions
- Bot scopes: `chat:write`, `pins:write`, `users:read`, `channels:read`
- Azure DevOps permissions: Repository write access

### Audit Trail
- All decisions recorded in Azure DevOps ADRs
- Slack provides message history
- Application Insights logs all bot actions

## Scalability

### Limits
- Slack pinned messages: 400 per channel
- Consider archiving old decisions
- One channel per team/project recommended

### Performance
- Slack API calls are rate-limited
- Cache user and channel information
- Batch processing for nudges

## Monitoring

### Health Checks
- Azure Function health endpoint
- Slack API connectivity check
- Azure DevOps API connectivity check

### Metrics
- Decisions created per day
- Average time to decision
- Vote participation rate
- Nudge effectiveness

### Alerts
- Failed ADR pushes
- Slack API errors
- Key Vault access failures
