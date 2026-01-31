/**
 * Tests for Azure DevOps Integration Module
 */

const {
  AzureDevOpsClient,
  generateADRMarkdown,
  pushADRToRepository,
  createAzureDevOpsClient
} = require('../../src/utils/azureDevOps');

// Mock logger to avoid console output during tests
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('Azure DevOps Integration', () => {
  
  describe('AzureDevOpsClient', () => {
    
    test('should initialize with configuration', () => {
      const config = {
        organization: 'test-org',
        project: 'test-project',
        repository: 'KB.ProcessDocs',
        personalAccessToken: 'test-pat'
      };
      
      const client = new AzureDevOpsClient(config);
      
      expect(client.organization).toBe('test-org');
      expect(client.project).toBe('test-project');
      expect(client.repository).toBe('KB.ProcessDocs');
      expect(client.pat).toBe('test-pat');
      expect(client.baseUrl).toContain('test-org');
      expect(client.baseUrl).toContain('test-project');
    });
    
    test('should generate correct authorization headers', () => {
      const config = {
        organization: 'org',
        project: 'proj',
        repository: 'repo',
        personalAccessToken: 'my-pat-token'
      };
      
      const client = new AzureDevOpsClient(config);
      const headers = client.getAuthHeaders();
      
      expect(headers).toHaveProperty('Authorization');
      expect(headers.Authorization).toContain('Basic');
      expect(headers).toHaveProperty('Content-Type', 'application/json');
    });
    
    test('should prepare push payload correctly', async () => {
      const config = {
        organization: 'org',
        project: 'proj',
        repository: 'repo',
        personalAccessToken: 'pat'
      };
      
      const client = new AzureDevOpsClient(config);
      const result = await client.pushFile(
        '/docs/test.md',
        'Test content',
        'Test commit'
      );
      
      expect(result.success).toBe(true);
      expect(result.filePath).toBe('/docs/test.md');
      expect(result.repository).toBe('repo');
      expect(result.branch).toBe('main');
    });
    
    test('should support custom branch in pushFile', async () => {
      const config = {
        organization: 'org',
        project: 'proj',
        repository: 'repo',
        personalAccessToken: 'pat'
      };
      
      const client = new AzureDevOpsClient(config);
      const result = await client.pushFile(
        '/docs/test.md',
        'Content',
        'Commit',
        'develop'
      );
      
      expect(result.branch).toBe('develop');
    });
    
    test('should throw error for getFile (not implemented)', async () => {
      const config = {
        organization: 'org',
        project: 'proj',
        repository: 'repo',
        personalAccessToken: 'pat'
      };
      
      const client = new AzureDevOpsClient(config);
      
      await expect(client.getFile('/test.md')).rejects.toThrow('Not implemented');
    });
    
    test('should throw error for listFiles (not implemented)', async () => {
      const config = {
        organization: 'org',
        project: 'proj',
        repository: 'repo',
        personalAccessToken: 'pat'
      };
      
      const client = new AzureDevOpsClient(config);
      
      await expect(client.listFiles('/docs')).rejects.toThrow('Not implemented');
    });
  });
  
  describe('generateADRMarkdown', () => {
    
    test('should generate ADR markdown for approved decision', () => {
      const decision = {
        id: 5,
        name: 'Adopt GraphQL API',
        proposal: 'We should adopt GraphQL for our API layer to improve flexibility and reduce over-fetching.',
        success_criteria: 'super_majority',
        deadline: '2026-02-15',
        creator_id: 'U123456',
        channel_id: 'C789012',
        message_ts: '1234567890.123456',
        created_at: '2026-02-01T10:00:00Z',
        updated_at: '2026-02-10T15:30:00Z'
      };
      
      const votes = [
        { user_id: 'U1', vote_type: 'yes' },
        { user_id: 'U2', vote_type: 'yes' },
        { user_id: 'U3', vote_type: 'yes' },
        { user_id: 'U4', vote_type: 'no' }
      ];
      
      const outcome = {
        approved: true,
        requiredVoters: 4,
        reason: 'Supermajority achieved'
      };
      
      const markdown = generateADRMarkdown(decision, votes, outcome);
      
      expect(markdown).toContain('ADR-0005: Adopt GraphQL API');
      expect(markdown).toContain('## Status');
      expect(markdown).toContain('Accepted');
      expect(markdown).toContain('## Context');
      expect(markdown).toContain('GraphQL for our API layer');
      expect(markdown).toContain('## Decision');
      expect(markdown).toContain('✅ Approved');
      expect(markdown).toContain('**Yes**: 3 (75.0%)');
      expect(markdown).toContain('**No**: 1 (25.0%)');
      expect(markdown).toContain('**Abstain**: 0 (0.0%)');
      expect(markdown).toContain('**Total Votes**: 4');
      expect(markdown).toContain('Supermajority (≥66%)');
    });
    
    test('should generate ADR markdown for rejected decision', () => {
      const decision = {
        id: 10,
        name: 'Move to Microservices',
        proposal: 'Transition from monolith to microservices architecture.',
        success_criteria: 'unanimous',
        deadline: '2026-03-01',
        creator_id: 'U999',
        created_at: '2026-02-15T10:00:00Z'
      };
      
      const votes = [
        { user_id: 'U1', vote_type: 'yes' },
        { user_id: 'U2', vote_type: 'no' },
        { user_id: 'U3', vote_type: 'no' }
      ];
      
      const outcome = {
        approved: false,
        requiredVoters: 3,
        reason: 'Unanimity not achieved'
      };
      
      const markdown = generateADRMarkdown(decision, votes, outcome);
      
      expect(markdown).toContain('ADR-0010: Move to Microservices');
      expect(markdown).toContain('Rejected');
      expect(markdown).toContain('❌ Rejected');
      expect(markdown).toContain('**Yes**: 1 (33.3%)');
      expect(markdown).toContain('**No**: 2 (66.7%)');
      expect(markdown).toContain('Unanimity (100%)');
    });
    
    test('should handle simple majority success criteria', () => {
      const decision = {
        id: 1,
        name: 'Test',
        proposal: 'Test proposal',
        success_criteria: 'simple_majority',
        deadline: '2026-02-20',
        creator_id: 'U1',
        created_at: '2026-02-01T10:00:00Z'
      };
      
      const votes = [
        { user_id: 'U1', vote_type: 'yes' }
      ];
      
      const outcome = {
        approved: true,
        requiredVoters: 1
      };
      
      const markdown = generateADRMarkdown(decision, votes, outcome);
      
      expect(markdown).toContain('Simple Majority (>50%)');
    });
    
    test('should handle votes with abstentions', () => {
      const decision = {
        id: 2,
        name: 'Test Decision',
        proposal: 'Test',
        success_criteria: 'super_majority',
        deadline: '2026-02-20',
        creator_id: 'U1',
        created_at: '2026-02-01T10:00:00Z'
      };
      
      const votes = [
        { user_id: 'U1', vote_type: 'yes' },
        { user_id: 'U2', vote_type: 'yes' },
        { user_id: 'U3', vote_type: 'abstain' },
        { user_id: 'U4', vote_type: 'no' }
      ];
      
      const outcome = {
        approved: true,
        requiredVoters: 4
      };
      
      const markdown = generateADRMarkdown(decision, votes, outcome);
      
      expect(markdown).toContain('**Abstain**: 1 (25.0%)');
      expect(markdown).toContain('**Total Votes**: 4');
    });
    
    test('should pad ADR number with leading zeros', () => {
      const decision = {
        id: 3,
        name: 'Test',
        proposal: 'Test',
        success_criteria: 'simple_majority',
        deadline: '2026-02-20',
        creator_id: 'U1',
        created_at: '2026-02-01T10:00:00Z'
      };
      
      const votes = [];
      const outcome = { approved: false, requiredVoters: 0 };
      
      const markdown = generateADRMarkdown(decision, votes, outcome);
      
      expect(markdown).toContain('ADR-0003:');
    });
    
    test('should include decision metadata in references section', () => {
      const decision = {
        id: 7,
        name: 'Test Decision',
        proposal: 'Test',
        success_criteria: 'simple_majority',
        deadline: '2026-02-20',
        creator_id: 'U_CREATOR',
        channel_id: 'C_CHANNEL',
        message_ts: '1234567890.123456',
        created_at: '2026-02-01T10:00:00Z'
      };
      
      const votes = [];
      const outcome = { approved: true, requiredVoters: 0 };
      
      const markdown = generateADRMarkdown(decision, votes, outcome);
      
      expect(markdown).toContain('**Decision ID**: 7');
      expect(markdown).toContain('**Slack Channel**: C_CHANNEL');
      expect(markdown).toContain('**Slack Message**: 1234567890.123456');
      expect(markdown).toContain('decisions table, ID 7');
    });
    
    test('should handle decisions with no votes', () => {
      const decision = {
        id: 8,
        name: 'No Votes Decision',
        proposal: 'Nobody voted',
        success_criteria: 'simple_majority',
        deadline: '2026-02-20',
        creator_id: 'U1',
        created_at: '2026-02-01T10:00:00Z'
      };
      
      const votes = [];
      const outcome = { approved: false, requiredVoters: 5 };
      
      const markdown = generateADRMarkdown(decision, votes, outcome);
      
      expect(markdown).toContain('**Yes**: 0 (0.0%)');
      expect(markdown).toContain('**No**: 0 (0.0%)');
      expect(markdown).toContain('**Abstain**: 0 (0.0%)');
      expect(markdown).toContain('**Total Votes**: 0');
    });
  });
  
  describe('pushADRToRepository', () => {
    
    test('should push ADR with correct filename and path', async () => {
      const decision = {
        id: 15,
        name: 'Adopt TypeScript',
        proposal: 'Migrate to TypeScript for better type safety.',
        success_criteria: 'super_majority',
        deadline: '2026-03-01',
        creator_id: 'U1',
        created_at: '2026-02-15T10:00:00Z'
      };
      
      const votes = [
        { user_id: 'U1', vote_type: 'yes' },
        { user_id: 'U2', vote_type: 'yes' }
      ];
      
      const outcome = {
        approved: true,
        requiredVoters: 2
      };
      
      const mockClient = {
        organization: 'test-org',
        project: 'test-project',
        repository: 'KB.ProcessDocs',
        pushFile: jest.fn().mockResolvedValue({
          success: true,
          commitId: 'abc123',
          repository: 'KB.ProcessDocs',
          branch: 'main',
          filePath: '/docs/adr/test.md'
        })
      };
      
      const result = await pushADRToRepository(decision, votes, outcome, mockClient);
      
      expect(result.success).toBe(true);
      expect(result.adrNumber).toBe('0015');
      expect(result.filename).toContain('ADR-0015');
      expect(result.filename).toContain('adopt-typescript');
      expect(result.filePath).toBe('/docs/adr/ADR-0015-adopt-typescript.md');
      expect(mockClient.pushFile).toHaveBeenCalledTimes(1);
      
      const pushCallArgs = mockClient.pushFile.mock.calls[0];
      expect(pushCallArgs[0]).toBe('/docs/adr/ADR-0015-adopt-typescript.md');
      expect(pushCallArgs[1]).toContain('ADR-0015: Adopt TypeScript');
      expect(pushCallArgs[2]).toContain('Add ADR-0015');
    });
    
    test('should sanitize filename for special characters', async () => {
      const decision = {
        id: 20,
        name: 'Use REST/HTTP APIs & OAuth2.0!',
        proposal: 'Test',
        success_criteria: 'simple_majority',
        deadline: '2026-03-01',
        creator_id: 'U1',
        created_at: '2026-02-15T10:00:00Z'
      };
      
      const votes = [];
      const outcome = { approved: true, requiredVoters: 0 };
      
      const mockClient = {
        organization: 'org',
        project: 'proj',
        repository: 'repo',
        pushFile: jest.fn().mockResolvedValue({
          success: true,
          commitId: 'xyz',
          repository: 'repo',
          branch: 'main',
          filePath: '/test.md'
        })
      };
      
      const result = await pushADRToRepository(decision, votes, outcome, mockClient);
      
      expect(result.filename).toBe('ADR-0020-use-resthttp-apis-oauth20.md');
      expect(result.filename).not.toContain('/');
      expect(result.filename).not.toContain('&');
      expect(result.filename).not.toContain('!');
    });
    
    test('should include vote statistics in commit message', async () => {
      const decision = {
        id: 25,
        name: 'Test Decision',
        proposal: 'Test',
        success_criteria: 'simple_majority',
        deadline: '2026-03-01',
        creator_id: 'U1',
        created_at: '2026-02-15T10:00:00Z'
      };
      
      const votes = [
        { user_id: 'U1', vote_type: 'yes' },
        { user_id: 'U2', vote_type: 'yes' },
        { user_id: 'U3', vote_type: 'no' },
        { user_id: 'U4', vote_type: 'abstain' }
      ];
      
      const outcome = { approved: true, requiredVoters: 4 };
      
      const mockClient = {
        organization: 'org',
        project: 'proj',
        repository: 'repo',
        pushFile: jest.fn().mockResolvedValue({
          success: true,
          commitId: 'commit123'
        })
      };
      
      await pushADRToRepository(decision, votes, outcome, mockClient);
      
      const commitMessage = mockClient.pushFile.mock.calls[0][2];
      expect(commitMessage).toContain('2 Yes');
      expect(commitMessage).toContain('1 No');
      expect(commitMessage).toContain('1 Abstain');
      expect(commitMessage).toContain('Accepted');
      expect(commitMessage).toContain('decision ID 25');
    });
    
    test('should handle rejected decisions in commit message', async () => {
      const decision = {
        id: 30,
        name: 'Rejected Decision',
        proposal: 'Test',
        success_criteria: 'unanimous',
        deadline: '2026-03-01',
        creator_id: 'U1',
        created_at: '2026-02-15T10:00:00Z'
      };
      
      const votes = [
        { user_id: 'U1', vote_type: 'yes' },
        { user_id: 'U2', vote_type: 'no' }
      ];
      
      const outcome = { approved: false, requiredVoters: 2 };
      
      const mockClient = {
        organization: 'org',
        project: 'proj',
        repository: 'repo',
        pushFile: jest.fn().mockResolvedValue({
          success: true,
          commitId: 'commit456'
        })
      };
      
      await pushADRToRepository(decision, votes, outcome, mockClient);
      
      const commitMessage = mockClient.pushFile.mock.calls[0][2];
      expect(commitMessage).toContain('rejected');
      expect(commitMessage).toContain('Rejected');
    });
  });
  
  describe('createAzureDevOpsClient', () => {
    
    const originalEnv = process.env;
    
    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });
    
    afterAll(() => {
      process.env = originalEnv;
    });
    
    test('should create client from environment variables', () => {
      process.env.AZURE_DEVOPS_ORG = 'my-org';
      process.env.AZURE_DEVOPS_PROJECT = 'my-project';
      process.env.AZURE_DEVOPS_REPO = 'MyRepo';
      process.env.AZURE_DEVOPS_PAT = 'my-pat-token';
      
      const client = createAzureDevOpsClient();
      
      expect(client.organization).toBe('my-org');
      expect(client.project).toBe('my-project');
      expect(client.repository).toBe('MyRepo');
      expect(client.pat).toBe('my-pat-token');
    });
    
    test('should use default repository name when not specified', () => {
      process.env.AZURE_DEVOPS_ORG = 'org';
      process.env.AZURE_DEVOPS_PROJECT = 'proj';
      process.env.AZURE_DEVOPS_PAT = 'pat';
      delete process.env.AZURE_DEVOPS_REPO;
      
      const client = createAzureDevOpsClient();
      
      expect(client.repository).toBe('KB.ProcessDocs');
    });
    
    test('should handle missing environment variables gracefully', () => {
      delete process.env.AZURE_DEVOPS_ORG;
      delete process.env.AZURE_DEVOPS_PROJECT;
      delete process.env.AZURE_DEVOPS_PAT;
      
      const client = createAzureDevOpsClient();
      
      expect(client.organization).toBe('');
      expect(client.project).toBe('');
      expect(client.pat).toBe('');
      expect(client.repository).toBe('KB.ProcessDocs');
    });
  });
});
