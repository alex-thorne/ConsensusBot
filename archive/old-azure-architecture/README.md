# Archive: Old Azure Architecture

This directory contains the previous Azure-based implementation of ConsensusBot.

## What's Archived Here

This is the **legacy Azure-based architecture** that was deprecated in February 2026 in favor of Slack Native (ROSI) infrastructure.

### Archived Components

- **src/** - Node.js application code
- **azure-functions/** - Azure Timer Functions for reminders
- **terraform/** - Infrastructure as Code for Azure resources
- **test/** - Jest test suite for Node.js code
- **config/** - Configuration files
- **Docker files** - Dockerfile, docker-compose.yml, .dockerignore
- **Node.js files** - package.json, package-lock.json, jest.config.js, .eslintrc.json
- **README_AZURE.md** - Original README for Azure deployment

### Why This Was Archived

The application was migrated from Azure to Slack Native (ROSI) to achieve:
- **90% cost reduction** ($10-50/mo vs $171-266/mo)
- **85% less maintenance** (1-2 hrs/mo vs 8-12 hrs/mo)
- **Zero secret management** overhead
- **Simplified deployment** using Slack CLI
- **Better integration** with Slack's native ecosystem

For details, see:
- [Architecture Re-evaluation](../docs/SLACK_NATIVE_ARCHITECTURE_REEVALUATION.md)
- [Migration Guide](../MIGRATION_GUIDE.md)
- [New README](../README.md)

### Using This Archive

This code is kept for reference only. To deploy the current version of ConsensusBot, follow the instructions in the main [README.md](../README.md).

If you need to reference the old Azure implementation:
1. The code is fully functional as of February 2026
2. All tests passed with 84%+ coverage
3. Documentation is in README_AZURE.md
4. Terraform configs are production-ready

### Restoration (If Needed)

To restore the Azure-based architecture:
1. Copy files from this directory back to the root
2. Run `npm install` to restore dependencies
3. Follow deployment steps in README_AZURE.md
4. Provision infrastructure with Terraform

**Note**: This is not recommended. The Slack Native architecture is superior in all measurable dimensions.

---

*Archived: February 2026*  
*Original Implementation: December 2025 - February 2026*
