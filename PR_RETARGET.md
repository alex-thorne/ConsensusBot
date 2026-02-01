# PR Retargeting Instructions

## Objective
This pull request needs to be retargeted to merge into the `development` branch instead of `main`.

## Quick Start

The `development` branch has been created locally in this repository. To complete the retargeting:

**Step 1: Push the development branch**
```bash
git checkout development  
git push -u origin development
```

**Step 2: Change PR base on GitHub** (choose one method below)

Note: A local `development` branch exists at commit `8d004eb` with the initial README.

## Detailed Steps

### Option A: Using GitHub Web UI (Recommended)

1. Push the `development` branch to origin (see Quick Start above)
2. Navigate to the pull request page on GitHub
3. Click the "Edit" button next to the PR title
4. Click on the base branch dropdown (currently showing `main` or default branch)
5. Select `development` as the new base branch
6. GitHub will automatically update the PR to show changes against `development`

### Option B: Using GitHub CLI

If you have the GitHub CLI installed:

```bash
# First, push development branch
git checkout development
git push -u origin development

# Then change the PR base
gh pr edit <pr-number> --base development
```

### Option C: Using GitHub API

```bash
# First, push development branch  
git checkout development
git push -u origin development

# Then update via API
curl -X PATCH \
  -H "Authorization: token YOUR_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/alex-thorne/ConsensusBot/pulls/<pr-number> \
  -d '{"base":"development"}'
```

Replace `YOUR_TOKEN` with a GitHub personal access token and `<pr-number>` with the actual PR number.

## Branch Information

- **Feature Branch**: `copilot/revise-consensusbot-architecture`  
- **Current PR Base**: `main` (or repository default branch)  
- **Target PR Base**: `development`  
- **Local development branch**: `8d004eb` (Initial commit with README)

## Why Use a development Branch?

This follows the standard git flow workflow:
- `main` - Stable, production-ready code
- `development` - Integration branch for ongoing work  
- Feature branches - Merge to `development` first, then `development` merges to `main` after testing

## Verification

After retargeting, verify that:
- [ ] The PR base shows `development` instead of `main`
- [ ] All commits from the feature branch are still visible in the PR
- [ ] The PR diff shows changes relative to the `development` branch
- [ ] CI/CD checks pass (if configured)
