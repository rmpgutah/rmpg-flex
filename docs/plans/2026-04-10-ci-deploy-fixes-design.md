# CI + Deploy Fixes — Design Doc

**Date**: 2026-04-10
**Status**: Approved
**Author**: Claude (with rmpgutah)

## Problem

Three CI/CD issues block or clutter the RMPG Flex pipeline:

1. **Deploy to Production: FAILED** — Client build fails because Vite 6's Rolldown bundler can't resolve the `dompurify` stub's ESM entry point.
2. **EthicalCheck-Workflow: recurring `startup_failure`** — Unconfigured third-party OWASP API security testing workflow fires on every push.
3. **Auto-merge Dependabot: recurring `startup_failure`** — Self-hosted runner contention causes startup failures on non-Dependabot PRs.

The deploy failure is operational (blocks production). The other two are cosmetic noise that makes the CI dashboard misleadingly red.

## Approach

### 1. Deploy to Production — Add `exports` field to dompurify stubs

**Root cause**: `jspdf@4.2.1`'s ESM build does `import DOMPurify from 'dompurify'`. Rolldown (Vite 6's bundler) resolves ESM imports strictly via the `exports` field. The stub's `package.json` only has legacy `main`/`module` fields, so Rolldown fails with `Rolldown failed to resolve import "dompurify"`.

**Fix**: Add an `exports` field to both `client/stubs/dompurify/package.json` and `server/stubs/dompurify/package.json`:

```json
{
  "exports": {
    ".": {
      "import": "./index.mjs",
      "require": "./index.js",
      "default": "./index.mjs"
    }
  }
}
```

**Why this works**: The stub's `index.mjs` already uses `export default sanitize` and `export { sanitize }`, which exactly matches what jsPDF imports. The `exports` field tells Rolldown where to find the ESM entry point.

**Why not downgrade jsPDF**: Would risk breaking report/citation/patrol-log PDF generation.
**Why not externalize in Vite config**: More fragile, breaks HMR.

### 2. EthicalCheck-Workflow — Delete

**Root cause**: `.github/workflows/ethicalcheck.yml` is a starter template that was never configured. It requires `OPENAPI_SPEC_URL` and an email, neither of which exists in the repo.

**Fix**: Delete `.github/workflows/ethicalcheck.yml`.

**Why delete instead of configure**: RMPG Flex has 69 route files with no OpenAPI spec. Generating one is a multi-day effort that would require public hosting of the API schema. CodeQL `security-extended` already provides comparable coverage. Configuring is pure overhead.

### 3. Auto-merge Dependabot — Switch to ubuntu-latest + top-level job condition

**Root cause**: Job runs on `self-hosted` which is saturated (CodeQL, Security & Quality, Copilot agents compete for runner slots). The `if: github.actor == 'dependabot[bot]'` condition only evaluates after the runner is provisioned, so non-Dependabot PRs fail at startup before the skip condition fires.

**Fix**: Edit `.github/workflows/auto-merge-dependabot.yml`:
- Change `runs-on: self-hosted` → `runs-on: ubuntu-latest`
- Move the actor check to job-level (it's already there)
- Optionally add a workflow-level filter so the job doesn't even get scheduled for non-Dependabot PRs

**Why this works**: Auto-merge is a pure GitHub API call (`gh pr merge --auto --squash`). It doesn't need a self-hosted runner. GitHub-hosted runners are provisioned on-demand per job, so condition evaluation happens before runner contention matters.

## Components

| File | Change |
|------|--------|
| `client/stubs/dompurify/package.json` | Add `exports` field |
| `server/stubs/dompurify/package.json` | Add `exports` field |
| `.github/workflows/ethicalcheck.yml` | Delete |
| `.github/workflows/auto-merge-dependabot.yml` | Change `runs-on` to `ubuntu-latest` |

## Testing

1. **Deploy fix**: Run `cd client && npx vite build` locally — must succeed without the Rolldown dompurify error.
2. **Deploy fix (CI)**: Trigger a manual `workflow_dispatch` of `Deploy to Production` — must reach the health check step.
3. **EthicalCheck fix**: Push to a branch — no EthicalCheck run should appear.
4. **Auto-merge fix**: Open a test PR (non-Dependabot) — Auto-merge workflow should skip cleanly (no `startup_failure`).

## Rollback

Each change is independent and can be reverted via `git revert`. The `exports` field is additive (safe), workflow deletions can be restored from git history, and the `runs-on` change is a one-line edit.

## Out of Scope

- Generating an OpenAPI spec for RMPG Flex (separate initiative if ever needed).
- Reviewing other self-hosted runner jobs for similar contention issues (could be a future CI hardening task).
- Upgrading to jsPDF 5.x or switching PDF libraries.
