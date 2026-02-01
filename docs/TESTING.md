# Testing Strategy for ConsensusBot

## Overview

This document outlines the testing strategy for ConsensusBot, focusing on validating the Slack-based state management model and Azure DevOps integration without relying on a database.

## Testing Principles

1. **Test Slack State Reconstruction**: Ensure the bot can accurately rebuild decision state from Slack messages
2. **Test Edge Cases**: Handle simultaneous votes, user departures, and API failures
3. **Mock External Services**: Use mocks for Slack API and Azure DevOps API
4. **Validate ADR Generation**: Ensure correct format and content

## Test Categories

### 1. Unit Tests

#### Slack Message Parser Tests
- Parse decision metadata from pinned message
- Extract vote information from thread replies
- Handle malformed messages gracefully
- Parse timestamps correctly

#### State Reconstruction Tests
- Reconstruct decision state from multiple thread replies
- Identify missing voters correctly
- Calculate vote tallies accurately
- Handle vote changes (latest vote wins)

#### ADR Generator Tests
- Generate valid Markdown format
- Include all required fields
- Format dates correctly
- Handle special characters in decision text

#### Deadline Logic Tests
- Parse deadline from command
- Calculate time remaining
- Identify overdue decisions
- Handle timezone conversions

### 2. Integration Tests

#### Slack API Integration Tests (Mocked)
- Post pinned messages
- Create thread replies
- Update message content
- Send direct messages
- Handle rate limiting

#### Azure DevOps Integration Tests (Mocked)
- Authenticate with PAT
- Push files to repository
- Handle API errors
- Retry logic

#### End-to-End Decision Flow Tests
```python
def test_complete_decision_flow():
    """Test full decision lifecycle"""
    # 1. Create decision
    response = create_decision(
        text="Test decision",
        participants=["U123", "U456"],
        deadline="2026-02-10"
    )
    assert response.status_code == 200
    
    # 2. Cast votes
    vote_yes("U123", response.message_ts)
    vote_no("U456", response.message_ts)
    
    # 3. Verify state
    state = get_decision_state(response.channel, response.message_ts)
    assert len(state['votes']) == 2
    assert len(state['missing_voters']) == 0
    
    # 4. Finalize decision
    adr = finalize_decision(response.channel, response.message_ts)
    assert adr.title == "Test decision"
    assert adr.status == "accepted"
```

### 3. Slack-Specific Tests

#### Thread Management Tests
- Create decision thread
- Append vote to thread
- Update pinned message summary
- Handle thread deletion

#### Button Interaction Tests
- Handle Yes button click
- Handle No button click
- Handle Abstain button click
- Prevent double voting in same action
- Allow vote changes

#### Voter Tracking Tests
```python
def test_voter_tracking():
    """Ensure bot tracks who voted correctly"""
    decision = create_test_decision(participants=["U1", "U2", "U3"])
    
    # User 1 votes
    cast_vote("U1", "yes", decision.message_ts)
    state = get_state(decision.message_ts)
    assert "U1" not in state['missing_voters']
    assert "U2" in state['missing_voters']
    
    # User 1 changes vote
    cast_vote("U1", "no", decision.message_ts)
    state = get_state(decision.message_ts)
    votes = [v for v in state['votes'] if v['user_id'] == "U1"]
    assert votes[-1]['choice'] == "no"
```

### 4. Nudger Tests

#### Overdue Decision Detection
```python
def test_find_overdue_decisions():
    """Test nudger finds decisions past deadline"""
    # Create decision with past deadline
    decision = create_test_decision(
        deadline=datetime.now() - timedelta(hours=1)
    )
    
    overdue = nudger.find_overdue_decisions("C12345")
    assert decision.message_ts in [d.message_ts for d in overdue]
```

#### Missing Voter Identification
```python
def test_identify_missing_voters():
    """Test nudger identifies who hasn't voted"""
    decision = create_test_decision(participants=["U1", "U2", "U3"])
    cast_vote("U1", "yes", decision.message_ts)
    
    missing = nudger.get_missing_voters(decision.message_ts)
    assert set(missing) == {"U2", "U3"}
```

#### Reminder Sending Tests
- Send DM to non-voters
- Don't spam voters who already voted
- Handle users who left workspace
- Respect rate limits

### 5. Edge Case Tests

#### Simultaneous Votes
```python
def test_simultaneous_votes():
    """Test handling of votes cast at nearly same time"""
    decision = create_test_decision()
    
    # Simulate two votes within milliseconds
    with concurrent.futures.ThreadPoolExecutor() as executor:
        future1 = executor.submit(cast_vote, "U1", "yes", decision.message_ts)
        future2 = executor.submit(cast_vote, "U2", "no", decision.message_ts)
        
        future1.result()
        future2.result()
    
    state = get_state(decision.message_ts)
    assert len(state['votes']) == 2
```

#### User Leaves Workspace
```python
def test_user_leaves_workspace():
    """Test handling when participant leaves Slack"""
    decision = create_test_decision(participants=["U1", "U2"])
    
    # Simulate user leaving
    mock_slack_api.deactivate_user("U2")
    
    # Bot should adjust required voter count
    state = get_state(decision.message_ts)
    assert state['required_votes'] == 1  # Down from 2
```

#### Channel Deletion
```python
def test_channel_deleted():
    """Test handling when channel is deleted during decision"""
    decision = create_test_decision()
    
    # Simulate channel deletion event
    handle_channel_deleted_event(decision.channel_id)
    
    # Bot should attempt to finalize with "cancelled" status
    adr = get_latest_adr()
    assert adr.status == "cancelled"
```

#### Bot Restart During Decision
```python
def test_bot_restart():
    """Test bot recovers state after restart"""
    decision = create_test_decision()
    cast_vote("U1", "yes", decision.message_ts)
    
    # Simulate bot restart
    restart_bot()
    
    # Bot should reconstruct state from Slack
    state = get_state(decision.message_ts)
    assert len(state['votes']) == 1
    assert state['votes'][0]['choice'] == "yes"
```

#### Slack API Rate Limiting
```python
def test_rate_limit_handling():
    """Test bot handles Slack rate limits gracefully"""
    # Mock rate limit response
    mock_slack_api.set_rate_limit(True)
    
    decision = create_test_decision()
    
    # Should retry with exponential backoff
    with assert_retries(min_retries=2):
        cast_vote("U1", "yes", decision.message_ts)
```

### 6. ADR Generation Tests

#### Format Validation
```python
def test_adr_format():
    """Test generated ADR follows template"""
    decision = create_and_complete_decision()
    adr = generate_adr(decision)
    
    assert "# Decision:" in adr.content
    assert "## Status" in adr.content
    assert "## Context" in adr.content
    assert "## Decision" in adr.content
    assert "## Consequences" in adr.content
    assert "## Votes" in adr.content
```

#### Filename Convention
```python
def test_adr_filename():
    """Test ADR filename follows convention"""
    decision = create_test_decision(text="Adopt Kubernetes")
    adr = generate_adr(decision)
    
    expected_pattern = r"\d{4}-\d{2}-\d{2}-adopt-kubernetes\.md"
    assert re.match(expected_pattern, adr.filename)
```

#### Vote Summary
```python
def test_adr_vote_summary():
    """Test ADR includes complete vote summary"""
    decision = create_test_decision()
    cast_vote("U1", "yes", decision.message_ts)
    cast_vote("U2", "no", decision.message_ts)
    cast_vote("U3", "abstain", decision.message_ts)
    
    adr = generate_adr(decision)
    
    assert "Yes: 1" in adr.content
    assert "No: 1" in adr.content
    assert "Abstain: 1" in adr.content
```

## Test Data

### Mock Slack Responses

```python
MOCK_PINNED_MESSAGE = {
    "ts": "1234567890.123456",
    "text": "",
    "blocks": [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "📊 *Decision: Should we adopt microservices?*"
            }
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": "*Participants:* <@U1>, <@U2>"},
                {"type": "mrkdwn", "text": "*Deadline:* 2026-02-10"},
            ]
        },
        {
            "type": "actions",
            "elements": [
                {"type": "button", "text": {"type": "plain_text", "text": "Yes"}},
                {"type": "button", "text": {"type": "plain_text", "text": "No"}},
                {"type": "button", "text": {"type": "plain_text", "text": "Abstain"}},
            ]
        }
    ]
}

MOCK_VOTE_REPLY = {
    "ts": "1234567890.123457",
    "thread_ts": "1234567890.123456",
    "user": "U1",
    "text": "voted",
    "metadata": {
        "event_type": "consensus_vote",
        "event_payload": {
            "vote": "yes",
            "user_id": "U1"
        }
    }
}
```

## Mock Services

### Slack API Mock
```python
class MockSlackClient:
    def __init__(self):
        self.messages = {}
        self.pins = {}
        self.dms = []
    
    def post_message(self, channel, text, blocks):
        ts = str(time.time())
        self.messages[ts] = {
            'channel': channel,
            'text': text,
            'blocks': blocks,
            'ts': ts
        }
        return {'ts': ts}
    
    def post_thread_reply(self, channel, thread_ts, text):
        ts = str(time.time())
        self.messages[ts] = {
            'channel': channel,
            'thread_ts': thread_ts,
            'text': text,
            'ts': ts
        }
        return {'ts': ts}
    
    def get_thread_replies(self, channel, thread_ts):
        return [m for m in self.messages.values() 
                if m.get('thread_ts') == thread_ts]
```

### Azure DevOps Mock
```python
class MockAzureDevOpsClient:
    def __init__(self):
        self.files = {}
    
    def push_file(self, repo, path, content):
        self.files[path] = content
        return {'success': True}
    
    def get_file(self, repo, path):
        return self.files.get(path)
```

## Continuous Integration Tests

### Pre-Deployment Tests
- All unit tests pass
- All integration tests pass
- Code coverage > 80%
- Linting passes
- Security scanning passes

### Post-Deployment Tests
- Health endpoint responds
- Slack webhook endpoint responds
- Azure DevOps connectivity verified
- Key Vault access verified

## Performance Tests

### Load Testing
- Handle 100 concurrent votes
- Process 50 simultaneous decisions
- Nudger scans 1000 pinned messages in < 60 seconds

### Slack API Rate Limits
- Verify backoff logic
- Test queue implementation
- Monitor API call frequency

## Manual Testing Checklist

Before releasing:

- [ ] Create decision via `/consensus` command
- [ ] Vote using Yes/No/Abstain buttons
- [ ] Verify vote appears in thread
- [ ] Change vote and verify update
- [ ] Wait for nudge DM
- [ ] Force deadline passage
- [ ] Verify ADR created in Azure DevOps
- [ ] Verify ADR content is correct
- [ ] Test with multiple simultaneous decisions
- [ ] Test with user leaving workspace
- [ ] Verify error messages are user-friendly

## Test Environment Setup

```bash
# Install test dependencies
pip install pytest pytest-cov pytest-mock pytest-asyncio

# Set test environment variables
export TESTING=true
export SLACK_BOT_TOKEN=xoxb-test-token
export AZURE_DEVOPS_PAT=test-pat

# Run all tests
pytest tests/ -v --cov=src

# Run specific test category
pytest tests/test_slack_state.py -v
pytest tests/test_nudger.py -v
pytest tests/test_adr_generation.py -v
```

## Coverage Goals

- Overall: > 80%
- Critical paths (voting, ADR generation): > 95%
- Edge case handling: > 70%

## Test Reporting

Generate coverage report:
```bash
pytest --cov=src --cov-report=html tests/
open htmlcov/index.html
```

## Conclusion

This testing strategy ensures ConsensusBot's Slack-based state management model works reliably without a database. Key focus areas:

1. State reconstruction accuracy
2. Edge case handling
3. External API integration
4. ADR quality and format
5. Nudger reliability