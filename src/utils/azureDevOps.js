/**
 * Azure DevOps Integration Module
 * 
 * Provides functionality to integrate ConsensusBot with Azure DevOps,
 * including generating ADR (Architecture Decision Record) markdown files
 * and pushing them to the KB.ProcessDocs repository.
 * 
 * Features:
 * - Generate ADR markdown from finalized decisions
 * - Push ADR files to Azure DevOps repository
 * - Azure DevOps REST API client
 */

const logger = require('./logger');

/**
 * Azure DevOps REST API client configuration
 */
class AzureDevOpsClient {
  /**
   * Create Azure DevOps client
   * @param {object} config - Configuration object
   * @param {string} config.organization - Azure DevOps organization name
   * @param {string} config.project - Project name
   * @param {string} config.repository - Repository name
   * @param {string} config.personalAccessToken - PAT for authentication
   */
  constructor(config) {
    this.organization = config.organization;
    this.project = config.project;
    this.repository = config.repository;
    this.pat = config.personalAccessToken;
    this.baseUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis`;
    
    logger.info('Azure DevOps client initialized', {
      organization: this.organization,
      project: this.project,
      repository: this.repository
    });
  }
  
  /**
   * Get authorization header for API requests
   * @returns {object} Authorization headers
   */
  getAuthHeaders() {
    const auth = Buffer.from(`:${this.pat}`).toString('base64');
    return {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    };
  }
  
  /**
   * Push a file to the repository
   * @param {string} filePath - Path where file should be created in repo
   * @param {string} content - File content
   * @param {string} commitMessage - Commit message
   * @param {string} branch - Branch name (default: 'main')
   * @returns {Promise<object>} Push result
   */
  async pushFile(filePath, content, commitMessage, branch = 'main') {
    try {
      logger.info('Pushing file to Azure DevOps', {
        repository: this.repository,
        filePath,
        branch
      });
      
      // This is a placeholder for the actual API call
      // Real implementation would use Azure DevOps REST API
      // Reference: https://docs.microsoft.com/en-us/rest/api/azure/devops/git/pushes/create
      
      const pushPayload = {
        refUpdates: [
          {
            name: `refs/heads/${branch}`,
            oldObjectId: '0000000000000000000000000000000000000000' // Would need to get actual commit SHA
          }
        ],
        commits: [
          {
            comment: commitMessage,
            changes: [
              {
                changeType: 'add',
                item: {
                  path: filePath
                },
                newContent: {
                  content: content,
                  contentType: 'rawtext'
                }
              }
            ]
          }
        ]
      };
      
      // Placeholder: In production, this would make the actual HTTP request
      logger.info('Push payload prepared', {
        changeCount: pushPayload.commits[0].changes.length,
        commitMessage
      });
      
      // Simulated success response
      return {
        success: true,
        commitId: 'simulated-commit-id',
        repository: this.repository,
        branch,
        filePath
      };
      
    } catch (error) {
      logger.error('Error pushing file to Azure DevOps', {
        error: error.message,
        stack: error.stack,
        filePath,
        repository: this.repository
      });
      throw error;
    }
  }
  
  /**
   * Get a file from the repository
   * @param {string} filePath - Path to file in repo
   * @param {string} branch - Branch name (default: 'main')
   * @returns {Promise<string>} File content
   */
  async getFile(filePath, branch = 'main') {
    // Placeholder for Azure DevOps API call
    logger.info('Getting file from Azure DevOps', {
      repository: this.repository,
      filePath,
      branch
    });
    
    throw new Error('Not implemented - placeholder for Azure DevOps integration');
  }
  
  /**
   * List files in a directory
   * @param {string} directoryPath - Directory path in repo
   * @param {string} branch - Branch name (default: 'main')
   * @returns {Promise<Array>} List of files
   */
  async listFiles(directoryPath, branch = 'main') {
    // Placeholder for Azure DevOps API call
    logger.info('Listing files in Azure DevOps', {
      repository: this.repository,
      directoryPath,
      branch
    });
    
    throw new Error('Not implemented - placeholder for Azure DevOps integration');
  }
}

/**
 * Generate ADR (Architecture Decision Record) markdown from a decision
 * @param {object} decision - Decision object from database
 * @param {Array<object>} votes - Votes for the decision
 * @param {object} outcome - Decision outcome result
 * @returns {string} Formatted ADR markdown content
 */
const generateADRMarkdown = (decision, votes, outcome) => {
  logger.info('Generating ADR markdown', {
    decisionId: decision.id,
    decisionName: decision.name
  });
  
  try {
    // Format decision date
    const decisionDate = new Date(decision.updated_at || decision.created_at);
    const formattedDate = decisionDate.toISOString().split('T')[0];
    
    // Calculate vote statistics
    const voteCounts = {
      yes: votes.filter(v => v.vote_type === 'yes').length,
      no: votes.filter(v => v.vote_type === 'no').length,
      abstain: votes.filter(v => v.vote_type === 'abstain').length
    };
    
    const totalVotes = voteCounts.yes + voteCounts.no + voteCounts.abstain;
    const yesPercentage = totalVotes > 0 ? ((voteCounts.yes / totalVotes) * 100).toFixed(1) : '0.0';
    const noPercentage = totalVotes > 0 ? ((voteCounts.no / totalVotes) * 100).toFixed(1) : '0.0';
    const abstainPercentage = totalVotes > 0 ? ((voteCounts.abstain / totalVotes) * 100).toFixed(1) : '0.0';
    
    // Determine status
    const status = outcome.approved ? 'Accepted' : 'Rejected';
    
    // Format success criteria
    const criteriaMap = {
      'simple_majority': 'Simple Majority (>50%)',
      'super_majority': 'Supermajority (≥66%)',
      'unanimous': 'Unanimity (100%)'
    };
    const formattedCriteria = criteriaMap[decision.success_criteria] || decision.success_criteria;
    
    // Generate ADR number (based on decision ID)
    const adrNumber = String(decision.id).padStart(4, '0');
    
    // Build the ADR content
    const adrContent = `# ADR-${adrNumber}: ${decision.name}

## Status

${status}

## Context

${decision.proposal}

### Decision Framework

This decision was made using ConsensusBot with the following parameters:
- **Success Criteria**: ${formattedCriteria}
- **Required Voters**: ${outcome.requiredVoters || 'N/A'}
- **Deadline**: ${decision.deadline}
- **Created**: ${formattedDate}
- **Creator**: ${decision.creator_id}

## Decision

**Outcome**: ${outcome.approved ? '✅ Approved' : '❌ Rejected'}

The team has ${outcome.approved ? 'approved' : 'rejected'} this decision through a consensus voting process.

### Voting Results

- **Yes**: ${voteCounts.yes} (${yesPercentage}%)
- **No**: ${voteCounts.no} (${noPercentage}%)
- **Abstain**: ${voteCounts.abstain} (${abstainPercentage}%)
- **Total Votes**: ${totalVotes}

${outcome.reason ? `\n**Outcome Reason**: ${outcome.reason}\n` : ''}

## Consequences

### Positive

${outcome.approved ? 
    '- The proposed approach has been validated by the team through consensus\n- Clear direction for implementation' :
    '- Alternative approaches can be explored\n- Concerns raised during voting can inform next steps'}

### Negative

${outcome.approved ? 
    '- Implementation commitments and resource allocation required\n- May require changes to existing systems or processes' :
    '- The proposed solution was not accepted\n- Additional time needed to find alternative solutions'}

### Neutral

- This decision was made using structured consensus voting
- All team members had the opportunity to participate
- The decision can be revisited if circumstances change significantly

## Alternatives Considered

${voteCounts.no > 0 ? 
    `The ${voteCounts.no} "No" vote${voteCounts.no > 1 ? 's' : ''} indicate${voteCounts.no === 1 ? 's' : ''} alternative approaches or concerns were considered by the team.` :
    'No significant alternatives were proposed during the voting period.'}

## Implementation Notes

${outcome.approved ? 
    'Implementation should proceed according to the proposal outlined in the Context section.' :
    'This decision was not approved. Review the voting feedback and concerns before proposing alternatives.'}

## References

- **Decision ID**: ${decision.id}
- **Slack Channel**: ${decision.channel_id}
- **Slack Message**: ${decision.message_ts}
- **ConsensusBot Database**: decisions table, ID ${decision.id}

---

**Date**: ${formattedDate}

**Author(s)**: Team consensus via ConsensusBot

**Reviewers**: All required voters (${outcome.requiredVoters || 'N/A'})
`;
    
    logger.info('ADR markdown generated successfully', {
      decisionId: decision.id,
      adrNumber,
      status,
      length: adrContent.length
    });
    
    return adrContent;
    
  } catch (error) {
    logger.error('Error generating ADR markdown', {
      error: error.message,
      stack: error.stack,
      decisionId: decision.id
    });
    throw error;
  }
};

/**
 * Push an ADR to the Azure DevOps KB.ProcessDocs repository
 * @param {object} decision - Decision object
 * @param {Array<object>} votes - Votes for the decision
 * @param {object} outcome - Decision outcome
 * @param {AzureDevOpsClient} adoClient - Azure DevOps client instance
 * @returns {Promise<object>} Result of push operation
 */
const pushADRToRepository = async (decision, votes, outcome, adoClient) => {
  try {
    logger.info('Pushing ADR to repository', {
      decisionId: decision.id,
      decisionName: decision.name,
      repository: adoClient.repository
    });
    
    // Generate ADR markdown
    const adrContent = generateADRMarkdown(decision, votes, outcome);
    
    // Generate filename
    const adrNumber = String(decision.id).padStart(4, '0');
    const sanitizedName = decision.name
      .toLowerCase()
      .replace(/\s+/g, '-')           // Replace spaces with hyphens
      .replace(/[^a-z0-9-]/g, '')     // Remove special characters
      .replace(/-+/g, '-')            // Replace multiple hyphens with single hyphen
      .replace(/^-|-$/g, '');         // Remove leading/trailing hyphens
    const filename = `ADR-${adrNumber}-${sanitizedName}.md`;
    const filePath = `/docs/adr/${filename}`;
    
    // Commit message
    const commitMessage = `Add ADR-${adrNumber}: ${decision.name}

Decision ${outcome.approved ? 'approved' : 'rejected'} via ConsensusBot
Status: ${outcome.approved ? 'Accepted' : 'Rejected'}
Vote counts: ${votes.filter(v => v.vote_type === 'yes').length} Yes, ${votes.filter(v => v.vote_type === 'no').length} No, ${votes.filter(v => v.vote_type === 'abstain').length} Abstain

Automatically generated from ConsensusBot decision ID ${decision.id}`;
    
    // Push to repository
    const result = await adoClient.pushFile(filePath, adrContent, commitMessage);
    
    logger.info('ADR pushed successfully', {
      decisionId: decision.id,
      filePath,
      commitId: result.commitId
    });
    
    return {
      success: true,
      filePath,
      commitId: result.commitId,
      adrNumber,
      filename
    };
    
  } catch (error) {
    logger.error('Error pushing ADR to repository', {
      error: error.message,
      stack: error.stack,
      decisionId: decision.id
    });
    throw error;
  }
};

/**
 * Create Azure DevOps client from environment variables
 * @returns {AzureDevOpsClient} Configured client instance
 */
const createAzureDevOpsClient = () => {
  const config = {
    organization: process.env.AZURE_DEVOPS_ORG || '',
    project: process.env.AZURE_DEVOPS_PROJECT || '',
    repository: process.env.AZURE_DEVOPS_REPO || 'KB.ProcessDocs',
    personalAccessToken: process.env.AZURE_DEVOPS_PAT || ''
  };
  
  // Validate required configuration
  if (!config.organization || !config.project || !config.personalAccessToken) {
    logger.warn('Azure DevOps configuration incomplete', {
      hasOrg: !!config.organization,
      hasProject: !!config.project,
      hasPAT: !!config.personalAccessToken
    });
  }
  
  return new AzureDevOpsClient(config);
};

module.exports = {
  AzureDevOpsClient,
  generateADRMarkdown,
  pushADRToRepository,
  createAzureDevOpsClient
};
