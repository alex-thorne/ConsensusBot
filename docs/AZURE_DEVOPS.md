# Azure DevOps Integration Guide

## Overview

ConsensusBot integrates with Azure DevOps to automatically generate and publish Architecture Decision Records (ADRs) based on finalized decisions. This integration helps teams maintain a knowledge base of important decisions made through the consensus process.

## Features

- **Automatic ADR Generation**: Convert finalized decisions into structured ADR markdown files
- **Repository Integration**: Push ADRs directly to Azure DevOps repositories
- **Vote Statistics**: Include detailed voting results and outcomes
- **Standard Format**: Follow ADR template conventions for consistency
- **Metadata Tracking**: Link ADRs back to original Slack messages and database records

## Architecture

```
┌─────────────────────┐
│  Finalized Decision │
│   (from Database)   │
└──────────┬──────────┘
           │
           │ Generate ADR
           ▼
┌─────────────────────┐
│  generateADRMarkdown│
│   (ADR Template)    │
└──────────┬──────────┘
           │
           │ Format & Validate
           ▼
┌─────────────────────┐
│ pushADRToRepository │
│  (Azure DevOps API) │
└──────────┬──────────┘
           │
           │ HTTP POST
           ▼
┌─────────────────────┐
│  Azure DevOps Repo  │
│   (KB.ProcessDocs)  │
└─────────────────────┘
```

## Configuration

### Environment Variables

Set the following environment variables to enable Azure DevOps integration:

```bash
# Azure DevOps Organization (required)
AZURE_DEVOPS_ORG=your-organization-name

# Azure DevOps Project (required)
AZURE_DEVOPS_PROJECT=your-project-name

# Target Repository (optional, defaults to KB.ProcessDocs)
AZURE_DEVOPS_REPO=KB.ProcessDocs

# Personal Access Token (required)
AZURE_DEVOPS_PAT=your-personal-access-token
```

### Personal Access Token Setup

1. Navigate to Azure DevOps User Settings
2. Select "Personal Access Tokens"
3. Click "New Token"
4. Configure token:
   - **Name**: ConsensusBot ADR Integration
   - **Expiration**: Custom (e.g., 90 days or 1 year)
   - **Scopes**: 
     - Code: Read & Write
     - Build: Read (optional, for CI/CD integration)
5. Copy the generated token immediately (it won't be shown again)
6. Store securely in environment variables or Azure Key Vault

## Usage

### Basic Usage

```javascript
const { 
  createAzureDevOpsClient, 
  generateADRMarkdown, 
  pushADRToRepository 
} = require('./src/utils/azureDevOps');
const db = require('./src/database/db');
const { calculateDecisionOutcome } = require('./src/utils/decisionLogic');

// Get decision data
const decisionId = 5;
const decision = db.getDecision(decisionId);
const votes = db.getVotes(decisionId);
const voters = db.getVoters(decisionId);

// Calculate outcome
const outcome = calculateDecisionOutcome(
  votes, 
  decision.success_criteria, 
  voters.length
);

// Create Azure DevOps client
const adoClient = createAzureDevOpsClient();

// Push ADR to repository
const result = await pushADRToRepository(decision, votes, outcome, adoClient);

console.log('ADR Created:', result.filePath);
console.log('Commit ID:', result.commitId);
```

### Generate ADR without Pushing

If you just want to generate the ADR markdown without pushing to Azure DevOps:

```javascript
const { generateADRMarkdown } = require('./src/utils/azureDevOps');

const adrContent = generateADRMarkdown(decision, votes, outcome);

// Save to file or process as needed
console.log(adrContent);
```

### Custom Client Configuration

```javascript
const { AzureDevOpsClient } = require('./src/utils/azureDevOps');

const customClient = new AzureDevOpsClient({
  organization: 'my-org',
  project: 'my-project',
  repository: 'CustomRepo',
  personalAccessToken: 'custom-pat'
});

// Use custom branch
const result = await customClient.pushFile(
  '/docs/adr/custom-adr.md',
  'ADR content here',
  'Commit message',
  'develop'  // branch name
);
```

## ADR Format

Generated ADRs follow this structure:

### Header
```markdown
# ADR-XXXX: Decision Title

## Status
Accepted | Rejected
```

### Context
- Decision proposal and background
- Decision framework parameters (success criteria, deadline, voters)
- Creator and creation date

### Decision
- Final outcome (Approved/Rejected)
- Vote counts and percentages
- Outcome reasoning

### Consequences
- **Positive**: Benefits of the decision
- **Negative**: Costs, trade-offs, or concerns
- **Neutral**: Observations about the decision process

### Alternatives Considered
- Discussion of alternatives based on "No" votes

### Implementation Notes
- Guidance for implementing approved decisions
- Next steps for rejected decisions

### References
- Decision ID
- Slack channel and message links
- Database references

## File Naming Convention

ADR files are automatically named using the pattern:

```
ADR-{number}-{sanitized-decision-name}.md
```

Where:
- `{number}` is the decision ID padded to 4 digits (e.g., `0005`, `0123`)
- `{sanitized-decision-name}` is the decision name converted to lowercase, spaces replaced with hyphens, special characters removed

**Examples:**
- Decision: "Adopt GraphQL API" → `ADR-0005-adopt-graphql-api.md`
- Decision: "Use React/TypeScript!" → `ADR-0010-use-reacttypescript.md`

## Commit Message Format

Commit messages follow a consistent format:

```
Add ADR-{number}: {Decision Name}

Decision {approved|rejected} via ConsensusBot
Status: {Accepted|Rejected}
Vote counts: X Yes, Y No, Z Abstain

Automatically generated from ConsensusBot decision ID {id}
```

## Integration Patterns

### Automatic ADR Creation on Decision Finalization

You can automate ADR creation when decisions are finalized:

```javascript
// In your decision finalization handler
async function finalizeDecision(decisionId) {
  const decision = db.getDecision(decisionId);
  const votes = db.getVotes(decisionId);
  const voters = db.getVoters(decisionId);
  
  // Calculate outcome
  const outcome = calculateDecisionOutcome(
    votes, 
    decision.success_criteria, 
    voters.length
  );
  
  // Update decision status
  db.updateDecisionStatus(decisionId, outcome.approved ? 'approved' : 'rejected');
  
  // Create ADR if Azure DevOps is configured
  if (process.env.AZURE_DEVOPS_PAT) {
    try {
      const adoClient = createAzureDevOpsClient();
      const result = await pushADRToRepository(decision, votes, outcome, adoClient);
      
      console.log(`✅ ADR created: ${result.filename}`);
      
      // Optionally notify in Slack
      await slackClient.chat.postMessage({
        channel: decision.channel_id,
        thread_ts: decision.message_ts,
        text: `📝 ADR generated and pushed to Azure DevOps: ${result.filename}`
      });
    } catch (error) {
      console.error('Failed to create ADR:', error);
      // Don't fail the decision finalization if ADR creation fails
    }
  }
}
```

### Batch ADR Generation

Generate ADRs for multiple finalized decisions:

```javascript
async function generateADRsForAllFinalizedDecisions() {
  const adoClient = createAzureDevOpsClient();
  const finalizedDecisions = db.getFinalizedDecisions();
  
  for (const decision of finalizedDecisions) {
    const votes = db.getVotes(decision.id);
    const voters = db.getVoters(decision.id);
    const outcome = calculateDecisionOutcome(
      votes, 
      decision.success_criteria, 
      voters.length
    );
    
    try {
      const result = await pushADRToRepository(decision, votes, outcome, adoClient);
      console.log(`✅ ${result.filename}`);
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Failed for decision ${decision.id}:`, error.message);
    }
  }
}
```

## Testing

The Azure DevOps integration includes comprehensive test coverage. Run tests with:

```bash
npm test test/utils/azureDevOps.test.js
```

### Mock Testing

Tests use mocks to avoid actual API calls:

```javascript
const mockClient = {
  organization: 'test-org',
  project: 'test-project',
  repository: 'test-repo',
  pushFile: jest.fn().mockResolvedValue({
    success: true,
    commitId: 'mock-commit-id',
    filePath: '/docs/adr/test.md'
  })
};

const result = await pushADRToRepository(decision, votes, outcome, mockClient);
expect(result.success).toBe(true);
```

## Troubleshooting

### Authentication Errors

**Symptom**: 401 Unauthorized errors

**Solutions**:
- Verify PAT is valid and not expired
- Check PAT has Code (Read & Write) permissions
- Ensure PAT is for the correct organization
- Regenerate PAT if compromised

**Test Authentication:**
```javascript
const { createAzureDevOpsClient } = require('./src/utils/azureDevOps');

async function testAuth() {
  try {
    const client = createAzureDevOpsClient();
    // This will test getting the latest commit SHA
    const sha = await client.getLatestCommitSha('main');
    console.log('✅ Authentication successful. Latest commit:', sha);
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
  }
}

testAuth();
```

### Repository Not Found

**Symptom**: 404 Not Found errors

**Solutions**:
- Verify organization, project, and repository names are correct
- Check repository exists in Azure DevOps
- Ensure PAT has access to the project and repository
- Verify repository name is case-sensitive match

**Verify Configuration:**
```bash
# Check environment variables
echo "Org: $AZURE_DEVOPS_ORG"
echo "Project: $AZURE_DEVOPS_PROJECT"  
echo "Repo: $AZURE_DEVOPS_REPO"

# Test URL (should return 200 OK with valid PAT)
curl -u :$AZURE_DEVOPS_PAT \
  "https://dev.azure.com/$AZURE_DEVOPS_ORG/$AZURE_DEVOPS_PROJECT/_apis/git/repositories/$AZURE_DEVOPS_REPO?api-version=7.0"
```

### File Already Exists

**Symptom**: Conflict errors when pushing ADR

**Solutions**:
- Each decision generates a unique filename based on decision ID
- If re-running for same decision, consider incrementing ID or using different branch
- Check existing ADRs in repository to avoid duplicates

**Note**: The current implementation uses `changeType: 'add'` which creates new files. To update existing files, change to `'edit'` and get the current file version.

### Rate Limiting

**Symptom**: 429 Too Many Requests errors

**Solutions**:
- Add delays between batch operations (recommended: 1 second between pushes)
- Implement exponential backoff for retries (already built-in with 3 retries)
- Consider upgrading Azure DevOps plan for higher rate limits
- Batch operations during off-peak hours

**Built-in Retry Logic:**
The Azure DevOps client automatically retries on network errors:
- Maximum 3 attempts
- Exponential backoff: 1s, 2s, 4s (capped at 5s)
- No retry on 401, 403, 400 errors (authentication/validation)

### Network/Timeout Errors

**Symptom**: `ECONNREFUSED`, `ETIMEDOUT`, or `getaddrinfo ENOTFOUND` errors

**Solutions**:
- Check network connectivity to `dev.azure.com`
- Verify firewall rules allow outbound HTTPS
- Check proxy settings if behind corporate proxy
- Increase timeout in client configuration (default: 30 seconds for push, 10 seconds for get)

**Test Connectivity:**
```bash
# Test network connectivity
curl -I https://dev.azure.com

# Test with authentication
curl -u :$AZURE_DEVOPS_PAT \
  "https://dev.azure.com/$AZURE_DEVOPS_ORG/$AZURE_DEVOPS_PROJECT/_apis/git/repositories?api-version=7.0"
```

### Branch Not Found

**Symptom**: Error getting latest commit SHA - branch not found

**Solutions**:
- Verify the branch exists in the repository
- Check branch name is correct (case-sensitive)
- Ensure you're using the correct branch name (default: 'main')
- Create the branch if it doesn't exist

**Create Branch:**
```bash
# In Azure DevOps, you can create a branch through the UI or API
# Or push an initial commit to create the branch
```

## Security Best Practices

1. **Store PAT Securely**
   - Use Azure Key Vault for production environments
   - Never commit PATs to source control
   - Use environment variables for local development

2. **Rotate PATs Regularly**
   - Set expiration dates on PATs (90-365 days)
   - Rotate before expiration
   - Revoke compromised tokens immediately

3. **Least Privilege**
   - Grant only required scopes (Code: Read & Write)
   - Create separate PATs for different purposes
   - Use service accounts for automated operations

4. **Audit Logging**
   - Enable audit logging in Azure DevOps
   - Review access logs regularly
   - Monitor for unusual activity

## Future Enhancements

- **Webhook Integration**: Trigger ADR generation via Azure DevOps webhooks
- **Pull Request Workflow**: Create PRs instead of direct commits
- **ADR Indexing**: Maintain index of all ADRs in repository
- **Versioning**: Support for updating existing ADRs
- **Multi-Repository**: Push to multiple repositories based on decision type
- **Rich Formatting**: Enhanced markdown with diagrams and charts

## Related Documentation

- [ADR Template](./templates/adr-template.md) - Standard ADR format
- [Reminder Deployment](./REMINDER_DEPLOYMENT.md) - Azure Timer Function setup
- [Voting Backend](./VOTING_BACKEND.md) - Decision outcome logic
- [Architecture Decision Records](./adr/) - Example ADRs

## Support

For issues or questions about Azure DevOps integration:

1. Check existing [GitHub Issues](https://github.com/alex-thorne/ConsensusBot/issues)
2. Review Azure DevOps [REST API documentation](https://docs.microsoft.com/en-us/rest/api/azure/devops/)
3. Create a new issue with:
   - Error messages and logs
   - Azure DevOps configuration (without sensitive data)
   - Steps to reproduce
