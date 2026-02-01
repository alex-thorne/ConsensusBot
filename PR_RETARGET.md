# PR Retargeting Instructions

## Objective
This pull request needs to be retargeted to merge into the `development` branch instead of `main`.

## Steps to Retarget

### 1. Create the `development` branch (if it doesn't exist)

If the `development` branch doesn't exist on GitHub yet, create it:

```bash
# Create development branch from initial state
git checkout --orphan development
git rm -rf .
echo "# ConsensusBot" > README.md
echo "A Slack App to facilitate team decision-making" >> README.md
git add README.md
git commit -m "Initial commit"
git push origin development
```

Alternatively, if there's an existing commit you want to base `development` on, you can use:
```bash
git checkout -b development <commit-sha>
git push origin development
```

### 2. Change the Pull Request Base Branch

On GitHub:
1. Navigate to the pull request page
2. Click on "Edit" next to the PR title
3. Click on the base branch dropdown (currently showing `main`)
4. Select `development` as the new base branch
5. GitHub will automatically rebase the PR onto the new base

### 3. Verify the Changes

After retargeting:
- Check that the PR shows changes between `copilot/revise-consensusbot-architecture` and `development`
- Verify that all commits are still present
- Ensure CI/CD checks pass (if configured)

## Current State

- **Feature Branch**: `copilot/revise-consensusbot-architecture`
- **Current Base**: `main` (or default branch)
- **Desired Base**: `development`

## Why This Change?

Merging to `development` instead of `main` follows a standard git workflow where:
- `development` contains ongoing work and integration
- `main` contains stable, production-ready code
- Feature branches merge to `development` first
- `development` is periodically merged to `main` after testing

## Alternative: Using GitHub CLI

If you have the GitHub CLI installed, you can change the base branch with:

```bash
gh pr edit <pr-number> --base development
```

## Alternative: Using GitHub API

You can also use the GitHub API to change the base branch:

```bash
curl -X PATCH \
  -H "Authorization: token YOUR_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/alex-thorne/ConsensusBot/pulls/<pr-number> \
  -d '{"base":"development"}'
```

Replace `YOUR_TOKEN` with a GitHub personal access token and `<pr-number>` with the PR number.
