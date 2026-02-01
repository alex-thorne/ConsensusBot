# Voting Backend Documentation

## Overview

This document describes the voting interaction backend and decision outcome logic implemented for ConsensusBot. The system provides robust vote validation, outcome calculation, and reminder functionality.

## Voting Validation Logic

### Eligibility Checks

When a user attempts to vote on a decision, the system performs the following validation:

1. **Voter Eligibility**: The user must be listed as a required voter for the decision
   - Implemented via `isUserEligibleToVote(decisionId, userId)` database function
   - Only users added to the `voters` table for the decision can cast votes

2. **Decision Status**: The decision must be in "active" status
   - Votes cannot be cast on decisions that are approved, rejected, or expired
   - Users receive a clear error message if trying to vote on inactive decisions

3. **Vote Uniqueness**: Each user can only vote once per decision
   - Enforced by UNIQUE constraint on (decision_id, user_id) in the votes table
   - Users can change their vote - the system uses UPSERT logic to update existing votes

### Validation Flow

```javascript
// Validation steps in voting handlers:
1. Extract decisionId and userId from button interaction
2. Check if user is eligible: isUserEligibleToVote(decisionId, userId)
3. If not eligible → Send error message, return
4. Retrieve decision from database
5. Check if decision.status === 'active'
6. If not active → Send error message, return
7. Record/Update vote in database
8. Send confirmation message to user
```

### Error Messages

The system provides user-friendly error messages for various scenarios:

- **Not Eligible**: "⚠️ You are not eligible to vote on this decision. Only required voters can cast votes."
- **Decision Not Active**: "⚠️ This decision is no longer active (status: {status}). Votes cannot be changed."
- **Decision Not Found**: "❌ Decision not found."
- **General Error**: "❌ An error occurred while recording your vote. Please try again."

## Decision Outcome Calculation

The system implements three success criteria types with different calculation rules:

### 1. Simple Majority

**Rule**: `votes_yes > 50%` of total votes cast

**Calculation**:
- Percentage = (yes_votes / total_votes) × 100
- Passes if percentage > 50%

**Edge Cases**:
- No votes cast → Fails with reason "No votes have been cast"
- Tie (50%) → Fails (must be >50%, not ≥50%)

**Example**:
```javascript
Votes: 3 Yes, 2 No
Total: 5 votes
Percentage: (3/5) × 100 = 60%
Result: PASSED (60% > 50%)
```

### 2. Supermajority

**Rule**: `votes_yes ≥ 66%` of required voters (not total votes)

**Calculation**:
- Percentage = (yes_votes / required_voters_count) × 100
- Passes if percentage ≥ 66%

**Key Difference**: Calculated against required voters, not just votes cast. This means:
- Missing votes count against the decision
- Even if all current votes are "yes," the decision can fail if not enough voters participated

**Edge Cases**:
- No required voters → Fails with reason "No required voters defined"
- Partial participation → Can fail even with 100% yes votes if <66% of required voters voted yes

**Example**:
```javascript
Required Voters: 10
Votes: 7 Yes, 1 No, 2 haven't voted
Percentage: (7/10) × 100 = 70%
Result: PASSED (70% ≥ 66%)
```

### 3. Unanimity

**Rule**: All votes are Yes AND total_votes ≥ quorum

**Calculation**:
- Check if any "No" votes exist
- Check if quorum is met
- Abstentions are allowed and don't prevent unanimity

**Quorum Handling**:
- Default quorum = required voters count
- Can specify custom quorum value
- If quorum not met → Fails regardless of vote distribution

**Edge Cases**:
- No required voters → Fails
- Quorum not met → Fails with reason "Quorum not met. Need {quorum} votes, got {total}"
- Any "No" vote → Fails immediately
- All abstentions (no yes votes) → Fails with reason "No yes votes cast"

**Example - Passes**:
```javascript
Required Voters: 5
Quorum: 5
Votes: 4 Yes, 0 No, 1 Abstain
Result: PASSED (no No votes, quorum met)
```

**Example - Fails (Quorum)**:
```javascript
Required Voters: 10
Quorum: 10
Votes: 6 Yes, 0 No, 4 haven't voted
Result: FAILED (quorum not met: need 10, got 6)
```

## Deadlock Detection

The system can detect when a decision has reached a deadlock - a state where it's mathematically impossible to reach the success criteria.

### Simple Majority Deadlock

Occurs when even if all remaining votes are "yes," the percentage won't exceed 50%.

**Example**:
```javascript
Votes: 1 Yes, 3 No, 1 remaining
Max possible yes: 1 + 1 = 2
Total after remaining: 5
Max percentage: (2/5) = 40%
Result: DEADLOCKED (can't reach >50%)
```

### Supermajority Deadlock

Occurs when even if all remaining voters vote "yes," the percentage won't reach 66%.

**Example**:
```javascript
Required voters: 10
Votes: 3 Yes, 4 No, 3 remaining
Max yes: 3 + 3 = 6
Max percentage: (6/10) = 60%
Result: DEADLOCKED (can't reach ≥66%)
```

### Unanimity Deadlock

Occurs immediately when any "No" vote is cast.

**Example**:
```javascript
Votes: 3 Yes, 1 No, 1 remaining
Result: DEADLOCKED (unanimity impossible with No vote)
```

## Database Schema Enhancements

### Votes Table

The votes table includes the following fields for tracking:

```sql
votes (
  id INTEGER PRIMARY KEY,
  decision_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  vote_type TEXT NOT NULL CHECK(vote_type IN ('yes', 'no', 'abstain')),
  voted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(decision_id, user_id)  -- One vote per user per decision
)
```

**Key Features**:
- `voted_at` automatically tracks when vote was cast/updated
- `CHECK` constraint ensures only valid vote types
- `UNIQUE` constraint prevents duplicate votes (enables vote changes)
- Foreign key maintains referential integrity

### New Query Functions

#### Get Open Decisions
```javascript
getOpenDecisions()
// Returns all decisions with status='active', ordered by deadline
```

#### Get Missing Voters
```javascript
getMissingVoters(decisionId)
// Returns voters who haven't cast their vote yet
// Uses LEFT JOIN to find voters without matching vote records
```

#### Get Vote Summary
```javascript
getVoteSummary(decisionId)
// Returns aggregated counts: total_votes, yes_votes, no_votes, abstain_votes
```

#### Check Voter Eligibility
```javascript
isUserEligibleToVote(decisionId, userId)
// Returns boolean - true if user is in voters table for this decision
```

#### Get Decision with Stats
```javascript
getDecisionWithStats(decisionId)
// Returns decision with:
// - requiredVotersCount
// - voteSummary (aggregated counts)
// - missingVotersCount
// - voters array
// - votes array
```

## Error Handling and Retry Logic

### Vote Recording Errors

**Error Scenarios**:
1. Database connection failure
2. Constraint violation (should not happen with UPSERT)
3. Network errors communicating with Slack

**Handling**:
- All vote handlers wrapped in try-catch blocks
- Errors logged with full context (decisionId, userId, error details)
- User receives ephemeral error message
- No partial state - database transaction ensures atomicity

**Retry Strategy**:
- Currently: User must retry manually by clicking button again
- Vote buttons remain active, allowing re-attempts
- Previous vote attempts don't affect database state (UPSERT semantics)

### Slack API Errors

**Scenarios**:
1. Failed to send confirmation message
2. Failed to send error message

**Handling**:
- Vote is still recorded even if confirmation fails
- Confirmation sending wrapped in try-catch
- Errors logged but don't prevent vote recording
- Separate error handling for sending error messages themselves

### Database Query Errors

**Protection**:
- All database operations wrapped in try-catch
- Functions return null/empty array on errors rather than throwing
- Errors logged with context
- Graceful degradation - system continues functioning

**Example**:
```javascript
const getMissingVoters = (decisionId) => {
  try {
    // Query database
    return stmt.all(decisionId);
  } catch (error) {
    logger.error('Error retrieving missing voters', { error, decisionId });
    return []; // Return empty array, don't crash
  }
};
```

## Performance Considerations

### Database Indexes

The schema includes indexes on frequently queried columns:
- `idx_decisions_status` - For querying open decisions
- `idx_decisions_channel` - For channel-specific queries
- `idx_voters_decision` - For voter lookups
- `idx_votes_decision` - For vote retrievals

### Query Optimization

- Use of prepared statements for all queries
- Transactions for multi-insert operations (voters)
- Efficient LEFT JOIN for missing voters query
- Aggregation in SQL rather than application code

### Caching Considerations

Currently no caching implemented. Future enhancements could include:
- Cache decision data during active voting period
- Cache voter lists (invalidate on voter changes)
- Cache vote counts (invalidate on new votes)

## Testing Coverage

### Unit Tests - Decision Logic

Comprehensive test coverage for all calculation paths:
- ✅ Simple majority: pass/fail scenarios, edge cases
- ✅ Supermajority: pass/fail, partial participation
- ✅ Unanimity: quorum handling, abstentions, no votes
- ✅ Deadlock detection: all three criteria types
- ✅ Edge cases: no votes, ties, all abstentions

### Unit Tests - Database

Full coverage of enhanced query functions:
- ✅ Get open decisions
- ✅ Get missing voters
- ✅ Get vote summary  
- ✅ Check voter eligibility
- ✅ Get decision with stats

### Integration Tests

Voting flow validation:
- ✅ Vote recording and retrieval
- ✅ Vote updates (changing votes)
- ✅ Multiple voters
- ✅ Different vote types

## Monitoring and Logging

### Log Levels

- **ERROR**: Database failures, Slack API errors
- **WARN**: Ineligible vote attempts, votes on inactive decisions
- **INFO**: Successful votes, decision outcomes, eligibility checks
- **DEBUG**: Vote counts, query results

### Key Metrics to Monitor

1. **Vote Recording Success Rate**: % of votes successfully recorded
2. **Eligibility Rejections**: Number of ineligible vote attempts
3. **Decision Outcome Calculations**: Frequency and distribution
4. **Database Query Performance**: Query execution times

### Log Examples

```json
// Successful vote
{"level":"INFO","message":"Vote cast","decisionId":5,"userId":"U123","voteType":"yes"}

// Ineligible attempt
{"level":"WARN","message":"Ineligible user attempted to vote","decisionId":5,"userId":"U999","voteType":"yes"}

// Decision outcome
{"level":"INFO","message":"Decision outcome calculated","successCriteria":"simple_majority","passed":true,"percentage":60}
```

## Security Considerations

### Input Validation

- Vote type validated via database CHECK constraint
- Decision ID validated (must be integer)
- User ID validated (must exist in voters table)

### Authorization

- Only eligible voters can vote (enforced at application level)
- Slack user IDs verified through Slack API interaction

### Data Integrity

- UNIQUE constraints prevent duplicate votes
- Foreign keys maintain referential integrity
- Transactions ensure atomic operations

### Audit Trail

- All votes timestamped with `voted_at`
- Comprehensive logging of all voting actions
- Vote changes tracked (timestamp updated on UPSERT)

## Future Enhancements

### Planned Features

1. **Vote Change Notifications**: Notify when someone changes their vote
2. **Vote Analytics**: Real-time progress tracking, visualization
3. **Vote Locking**: Prevent vote changes after certain point
4. **Weighted Voting**: Support for different vote weights
5. **Delegated Voting**: Allow users to delegate their vote

### Performance Improvements

1. **Caching Layer**: Redis for active decisions and vote counts
2. **Background Processing**: Async outcome calculations
3. **Read Replicas**: Separate read/write database connections

### Enhanced Validation

1. **Time-based Restrictions**: Prevent voting after deadline
2. **Conditional Logic**: Complex success criteria
3. **Multi-stage Voting**: Support for runoff elections
