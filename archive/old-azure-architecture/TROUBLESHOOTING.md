# Troubleshooting Guide

This guide provides solutions to common issues encountered when deploying and running ConsensusBot.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Configuration Issues](#configuration-issues)
- [Runtime Issues](#runtime-issues)
- [Database Issues](#database-issues)
- [Slack Integration Issues](#slack-integration-issues)
- [Azure DevOps Integration Issues](#azure-devops-integration-issues)
- [Docker Issues](#docker-issues)
- [Performance Issues](#performance-issues)
- [Security Issues](#security-issues)

---

## Installation Issues

### Issue: npm install fails with node-gyp errors

**Symptom**:
```
gyp ERR! build error
gyp ERR! stack Error: `make` failed with exit code: 2
```

**Cause**: Missing build tools for compiling better-sqlite3 native module.

**Solution**:

**macOS**:
```bash
xcode-select --install
npm install
```

**Linux (Ubuntu/Debian)**:
```bash
sudo apt-get install build-essential python3
npm install
```

**Windows**:
```bash
npm install --global windows-build-tools
npm install
```

### Issue: Permission denied during npm install

**Symptom**:
```
npm ERR! code EACCES
npm ERR! syscall access
```

**Solution**:
```bash
# Don't use sudo! Fix npm permissions instead
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH

# Then retry
npm install
```

---

## Configuration Issues

### Issue: Missing environment variables

**Symptom**:
```
Error: SLACK_BOT_TOKEN is required
```

**Solution**:
1. Ensure `.env` file exists:
```bash
cp .env.example .env
```

2. Fill in all required variables:
```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
```

3. Restart the application

### Issue: Invalid Slack tokens

**Symptom**:
```
Error: An API error occurred: invalid_auth
```

**Solution**:
1. Verify token format:
   - Bot Token: starts with `xoxb-`
   - App Token: starts with `xapp-`
   - Signing Secret: 32-character hex string

2. Regenerate tokens if needed:
   - Go to https://api.slack.com/apps
   - Select your app
   - OAuth & Permissions → Reinstall App
   - Basic Information → App-Level Tokens → Regenerate

### Issue: Azure DevOps PAT not working

**Symptom**:
```
Error: Azure DevOps API returned 401: Unauthorized
```

**Solution**:
1. Verify PAT has correct scopes:
   - Code: Read & Write
   - Expiration: Not expired

2. Check organization/project names:
```bash
# Correct format
AZURE_DEVOPS_ORG=myorganization  # Not URL
AZURE_DEVOPS_PROJECT=MyProject   # Case-sensitive
```

3. Regenerate PAT if expired

---

## Runtime Issues

### Issue: Application crashes on startup

**Symptom**:
```
Error: Cannot find module './src/index.js'
```

**Solution**:
```bash
# Verify file structure
ls -la src/

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Run from project root
node src/index.js
```

### Issue: Socket Mode connection fails

**Symptom**:
```
Error: Failed to connect to Slack via Socket Mode
```

**Solution**:
1. Check Socket Mode is enabled:
   - Slack App Settings → Socket Mode → Enable

2. Verify App Token exists and is valid

3. Check firewall/proxy settings:
```bash
# Test connectivity
curl -v https://wss-primary.slack.com/

# If behind proxy, set:
export HTTPS_PROXY=http://proxy:port
```

### Issue: Command not responding

**Symptom**: `/consensus` command shows "Application not responding"

**Solution**:
1. Check application logs for errors

2. Verify slash command configuration:
   - Slack App Settings → Slash Commands
   - Command: `/consensus`
   - Request URL: (Socket Mode doesn't need URL)

3. Ensure bot is in the channel:
```
/invite @ConsensusBot
```

---

## Database Issues

### Issue: Database is locked

**Symptom**:
```
Error: SQLITE_BUSY: database is locked
```

**Solution**:
```bash
# Stop all instances
killall node

# Check for lock file
rm -f data/consensus.db-shm data/consensus.db-wal

# Restart application
npm start
```

### Issue: Database file not found

**Symptom**:
```
Error: SQLITE_CANTOPEN: unable to open database file
```

**Solution**:
```bash
# Create data directory
mkdir -p data

# Set correct permissions
chmod 755 data

# Database will be created automatically
npm start
```

### Issue: Database corruption

**Symptom**:
```
Error: database disk image is malformed
```

**Solution**:
```bash
# Backup current database
cp data/consensus.db data/consensus.db.backup

# Try to repair
sqlite3 data/consensus.db ".dump" | sqlite3 data/consensus_fixed.db
mv data/consensus_fixed.db data/consensus.db

# If repair fails, restore from backup or start fresh
rm data/consensus.db
npm start
```

---

## Slack Integration Issues

### Issue: Bot doesn't receive messages

**Symptom**: No response when mentioning bot or using commands

**Solution**:
1. Check Event Subscriptions:
   - Slack App Settings → Event Subscriptions
   - Subscribe to bot events: `app_mention`, `message.im`

2. Verify bot scopes:
   - `chat:write`
   - `commands`
   - `im:history`
   - `users:read`

3. Reinstall app to workspace

### Issue: Modal doesn't open

**Symptom**: Clicking "Create New Decision" does nothing

**Solution**:
1. Check browser console for errors

2. Verify Interactivity is enabled:
   - Slack App Settings → Interactivity & Shortcuts → On

3. Check application logs for `open_consensus_modal` action

### Issue: Voting buttons not working

**Symptom**: Clicking yes/no/abstain buttons has no effect

**Solution**:
1. Verify action_id patterns in logs:
```
vote_yes_{decision_id}
vote_no_{decision_id}
vote_abstain_{decision_id}
```

2. Check button action handlers are registered:
```javascript
app.action(/^vote_yes_(\d+)$/, ...)
```

3. Ensure decision is still active (not finalized)

---

## Azure DevOps Integration Issues

### Issue: ADR push fails with 404

**Symptom**:
```
Error: Azure DevOps API returned 404: Not Found
```

**Solution**:
1. Verify repository ID is correct:
```bash
# Get repository ID
az repos show --repository YourRepo --organization https://dev.azure.com/YourOrg --project YourProject --query id
```

2. Check project and organization names match exactly

3. Verify PAT has access to the repository

### Issue: ADR file not visible in repository

**Symptom**: Push succeeds but file doesn't appear

**Solution**:
1. Check branch name - defaults to `main`

2. Navigate to correct path:
   - Path: `/docs/adr/ADR-{id}-{decision-name}.md`

3. Pull latest changes if using different branch

### Issue: Merge conflict on ADR push

**Symptom**:
```
Error: TF401028: The reference has already been updated by another client
```

**Solution**:
- Application uses `force=true` to overwrite
- Check for concurrent pushes
- Review retry logic (3 attempts with backoff)

---

## Docker Issues

### Issue: Docker build fails

**Symptom**:
```
ERROR: failed to solve: failed to fetch
```

**Solution**:
1. Check Docker daemon is running:
```bash
docker ps
```

2. Clean build cache:
```bash
docker builder prune
docker build --no-cache -t consensusbot:latest .
```

3. Check network connectivity

### Issue: Container exits immediately

**Symptom**: Container starts and stops within seconds

**Solution**:
```bash
# Check logs
docker logs consensusbot

# Run interactively to debug
docker run -it --env-file .env consensusbot:latest sh

# Common causes:
# - Missing environment variables
# - Invalid configuration
# - Port conflict
```

### Issue: Port already in use

**Symptom**:
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solution**:
```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port
PORT=3001 npm start
```

---

## Performance Issues

### Issue: Slow response times

**Symptom**: Commands take >5 seconds to respond

**Solution**:
1. Check database size:
```bash
ls -lh data/consensus.db
```

2. Vacuum database if large:
```bash
sqlite3 data/consensus.db "VACUUM;"
```

3. Review Application Insights for slow queries

4. Increase Node.js memory:
```bash
NODE_OPTIONS="--max-old-space-size=2048" npm start
```

### Issue: High memory usage

**Symptom**: Memory usage >500MB

**Solution**:
1. Check for memory leaks:
```bash
node --inspect src/index.js
# Open chrome://inspect
```

2. Review active connections/listeners

3. Restart application periodically (if on consumption plan)

---

## Security Issues

### Issue: Slack request verification fails

**Symptom**:
```
Error: Slack request signing verification failed
```

**Solution**:
1. Verify `SLACK_SIGNING_SECRET` is correct

2. Check system clock is synchronized:
```bash
# Linux/macOS
sudo ntpdate -s time.nist.gov

# Or use systemd-timesyncd
timedatectl status
```

3. Ensure no proxy/load balancer modifying headers

### Issue: Unauthorized Key Vault access

**Symptom**:
```
Error: The user, group or application does not have secrets get permission
```

**Solution (Azure)**:
```bash
# Grant Function App access to Key Vault
az keyvault set-policy \
  --name YourKeyVault \
  --object-id <function-app-principal-id> \
  --secret-permissions get list
```

**Solution (Local)**:
```bash
# Grant your user access
az keyvault set-policy \
  --name YourKeyVault \
  --upn your-email@domain.com \
  --secret-permissions get list set
```

---

## Common Error Messages

### "Cannot read property 'id' of undefined"

**Cause**: Accessing user or channel data before it's loaded

**Solution**: Add null checks:
```javascript
const userId = body?.user?.id;
if (!userId) {
  logger.error('No user ID in request');
  return;
}
```

### "Timeout waiting for response"

**Cause**: Long-running operation (>3 seconds) before `ack()`

**Solution**: Acknowledge immediately, process asynchronously:
```javascript
await ack();
// Then process...
```

### "Invalid block structure"

**Cause**: Malformed Slack Block Kit JSON

**Solution**: Validate blocks at https://api.slack.com/tools/block-kit-builder

---

## Getting Help

If you can't resolve your issue:

1. **Enable debug logging**:
```bash
LOG_LEVEL=debug npm start
```

2. **Check Application Insights** (if deployed to Azure):
   - Review exceptions
   - Check failed requests
   - Analyze traces

3. **Reproduce with minimal config**:
```bash
# Test with minimal .env
SLACK_BOT_TOKEN=...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=...
LOG_LEVEL=debug
```

4. **Gather information**:
   - Node.js version: `node --version`
   - npm version: `npm --version`
   - OS: `uname -a` (Linux/macOS) or `ver` (Windows)
   - Error logs: Last 50 lines

5. **Open a GitHub issue** with:
   - Clear description of problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Relevant logs (sanitize secrets!)
   - Environment details

---

## Additional Resources

- [Slack API Documentation](https://api.slack.com/)
- [Bolt for JavaScript Guide](https://slack.dev/bolt-js/)
- [Azure Functions Troubleshooting](https://docs.microsoft.com/en-us/azure/azure-functions/functions-diagnostics)
- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3)

---

## Quick Reference

### Essential Commands

```bash
# Check logs
tail -f /var/log/consensusbot.log

# Test database connection
sqlite3 data/consensus.db "SELECT COUNT(*) FROM decisions;"

# Verify Slack connectivity
curl -H "Authorization: Bearer $SLACK_BOT_TOKEN" https://slack.com/api/auth.test

# Check Azure DevOps connectivity
curl -u :$AZURE_DEVOPS_PAT https://dev.azure.com/$AZURE_DEVOPS_ORG/_apis/projects

# Monitor resources
top -p $(pgrep -f "node.*consensus")
```

### Log Locations

- **Local**: stdout/stderr
- **Docker**: `docker logs consensusbot`
- **Azure Functions**: Application Insights → Logs
- **systemd**: `journalctl -u consensusbot`

### Health Checks

```bash
# Application health
curl http://localhost:3000/health

# Database health
sqlite3 data/consensus.db "PRAGMA integrity_check;"

# Slack connectivity
curl https://slack.com/api/api.test
```
