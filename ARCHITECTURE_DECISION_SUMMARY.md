# Architecture Decision: Compute Infrastructure

**Date**: February 2026  
**Status**: ✅ **APPROVED - Stay on Azure**  
**Decision Maker**: Architecture Review Team  

---

## Executive Summary

After comprehensive evaluation, **we recommend maintaining the current Azure-based compute infrastructure** for ConsensusBot rather than migrating to Slack's "Run on Slack" (ROSI) platform.

## Quick Facts

| Metric | Azure (Current) | Slack ROSI | Winner |
|--------|-----------------|------------|--------|
| **Overall Score** | 8.7/10 | 5.4/10 | ✅ Azure |
| **Migration Cost** | $0 | $15K-30K | ✅ Azure |
| **Monthly Cost (Prod)** | $171-266 (optimizable to $50-105) | $10-50 + Slack subscription | Depends |
| **Azure DevOps Integration** | ✅ Native | ❌ Requires proxy | ✅ Azure |
| **Team Familiarity** | ✅ High | ⚠️ Low (new platform) | ✅ Azure |
| **Code Reuse** | ✅ 100% (166 tests) | ❌ 0% (complete rewrite) | ✅ Azure |

## The Decision

### ✅ MAINTAIN AZURE-BASED INFRASTRUCTURE

**Primary Reasons:**

1. **Azure DevOps Integration is Critical**
   - ADR archival to Azure DevOps is a core project requirement
   - Azure compute provides seamless integration
   - ROSI would require maintaining Azure components anyway (defeating its purpose)

2. **Organizational Alignment**
   - Organization uses Azure for all self-deployed services
   - Existing Azure expertise and operational processes
   - Azure DevOps is the standard for documentation

3. **Investment Protection**
   - 166 passing tests (84% code coverage)
   - Mature, well-documented codebase
   - Recent architecture cleanup (Slack-first state management)
   - Migration would waste this investment

4. **Cost-Benefit Analysis**
   - Migration cost: $15K-30K developer time
   - Ongoing savings: Minimal (still need Azure for ADR archival)
   - Better ROI: Optimize current Azure costs (40-60% reduction possible)

5. **Current Architecture Already Optimal**
   - Hybrid Slack-Azure architecture perfectly aligned with project goals
   - Ephemeral state in Slack (leveraging Slack's strengths)
   - Long-term storage in Azure DevOps (organizational standard)
   - Azure compute orchestrates between the two

## What We Analyzed

Comprehensive review covered:
- ✅ Operability (monitoring, alerting, troubleshooting)
- ✅ Maintainability (code quality, technical debt, ecosystem)
- ✅ Reusability (code portability, pattern reuse)
- ✅ Cost efficiency (TCO, hidden costs, optimization potential)
- ✅ Security & compliance (data protection, access control, auditing)
- ✅ Alignment with objectives (ephemeral + permanent storage)

## When ROSI Would Be Right

Slack "Run on Slack" infrastructure is excellent for:
- ❌ ~~ConsensusBot~~ (requires Azure DevOps integration)
- ✅ Simple Slack workflows with no external dependencies
- ✅ Teams without Azure infrastructure or expertise
- ✅ Rapid prototypes confined to Slack ecosystem
- ✅ Apps with minimal state (<1GB)

## Next Steps

Instead of migrating, we will **optimize the current Azure infrastructure**:

### Immediate (0-3 months)
- 🎯 Right-size Function App tier (potential 40-60% cost reduction)
- 🎯 Implement Application Insights sampling
- 🎯 Enable Key Vault firewall and security hardening
- 🎯 Create monitoring dashboards and alerts

### Short-term (3-6 months)
- 🎯 Set up CI/CD pipeline automation
- 🎯 Enhance Slack App Home with dashboard
- 🎯 Improve ADR templates with visualizations
- 🎯 Implement caching for performance

### Long-term (6-12+ months)
- 🎯 AI integration (Azure OpenAI for decision insights)
- 🎯 Bi-directional Azure DevOps sync
- 🎯 Microsoft Teams adapter
- 🎯 Advanced analytics

## Full Analysis

For the complete architecture review with detailed analysis, see:
📄 [**Architecture Review: Azure vs Slack-Native Compute Infrastructure**](docs/ARCHITECTURE_REVIEW_AZURE_VS_SLACK.md)

The full document includes:
- Current architecture deep-dive
- Slack ROSI capabilities and limitations
- 10-dimension comparative analysis
- Detailed cost breakdown
- Security assessment
- Implementation roadmap
- Success metrics

## Questions?

For questions about this decision:
1. Review the [full architecture review document](docs/ARCHITECTURE_REVIEW_AZURE_VS_SLACK.md)
2. Check the [project README](README.md) for context
3. Create a GitHub issue for discussion

---

**Decision Confidence**: Very High (9/10)

This decision is based on objective analysis, organizational context, and clear evaluation of costs, benefits, and risks. The recommendation strongly favors Azure for this specific use case.
