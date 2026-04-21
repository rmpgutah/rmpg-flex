# CI + Deploy Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unblock Deploy to Production, eliminate two recurring CI `startup_failure` workflows.

**Architecture:** Three independent changes. (1) Add `exports` field to `dompurify` stub packages so Vite 6's Rolldown can resolve the ESM entry point. (2) Delete the unconfigured EthicalCheck workflow. (3) Switch Auto-merge Dependabot from self-hosted runner to `ubuntu-latest` to eliminate runner contention startup failures.

**Tech Stack:** Vite 6 + Rolldown, jsPDF 4.x, GitHub Actions (self-hosted + ubuntu-latest runners), Node.js 22.

---

## Task 1: Fix `dompurify` stub ESM resolution — `client/stubs/`

**Files:**
- Modify: `client/stubs/dompurify/package.json`

**Context for the engineer:**

The RMPG Flex client uses `jspdf@4.2.1` for PDF generation. jsPDF's ESM build contains `import DOMPurify from 'dompurify'`. The repo has a no-op stub at `client/stubs/dompurify/` which `client/package.json` pulls in via `"overrides": { "dompurify": "file:./stubs/dompurify" }`. This eliminates the real dompurify (which has CVE-2026-0540) from the dependency tree.

The stub has `index.js` (CommonJS) and `index.mjs` (ESM) files that are both already correct. The problem is **only** in `package.json`: it declares `main` and `module` but not `exports`. Vite 6 uses Rolldown, which follows modern ESM resolution and requires the `exports` field for packages that ship both CJS and ESM. Without `exports`, Rolldown cannot resolve `import DOMPurify from 'dompurify'` and the build fails with `Rolldown failed to resolve import "dompurify"`.

**Step 1: Read the current stub package.json**

Run: `cat "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/client/stubs/dompurify/package.json"`

Expected output:
```json
{
  "name": "dompurify",
  "version": "99.0.0",
  "description": "No-op stub — jsPDF .html() not used in RMPG Flex",
  "main": "index.js",
  "module": "index.mjs"
}
```

**Step 2: Add the `exports` field**

Use the Edit tool to replace the entire file contents with:

```json
{
  "name": "dompurify",
  "version": "99.0.0",
  "description": "No-op stub — jsPDF .html() not used in RMPG Flex",
  "main": "index.js",
  "module": "index.mjs",
  "exports": {
    ".": {
      "import": "./index.mjs",
      "require": "./index.js",
      "default": "./index.mjs"
    }
  }
}
```

**Step 3: Verify no other changes needed in stub files**

Run: `cat "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/client/stubs/dompurify/index.mjs"`

Confirm it contains `export default sanitize;` and `export { sanitize };`. If yes, no further changes. If not, STOP and report.

**Step 4: Reinstall to propagate the override into node_modules**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/client" && npm install --legacy-peer-deps`

Expected: Installs without errors. The new `exports` field will be copied from `client/stubs/dompurify/package.json` to `client/node_modules/dompurify/package.json`.

**Step 5: Verify the build now succeeds**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/client" && npx vite build 2>&1 | tail -15`

Expected: Must end with `✓ built in <time>s`. Must NOT contain `Rolldown failed to resolve import "dompurify"`. If the build fails with any error, STOP and report.

**Step 6: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar"
git add client/stubs/dompurify/package.json client/package-lock.json
git commit -m "fix(client): add exports field to dompurify stub for Vite 6 Rolldown resolution

Vite 6 uses Rolldown which requires the exports field to resolve ESM
imports. jspdf@4.2.1's ESM build imports dompurify, and without the
exports field Rolldown cannot find the stub's ESM entry, causing
Deploy to Production to fail.

Fixes Deploy to Production build error:
  Rolldown failed to resolve import \"dompurify\" from jspdf.es.min.js

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Mirror the fix to the `server/stubs/dompurify` package

**Files:**
- Modify: `server/stubs/dompurify/package.json`

**Context for the engineer:**

The server has an identical stub at `server/stubs/dompurify/` referenced by `server/package.json` overrides. Even though the server doesn't use Rolldown (the server is run via `tsx`, not bundled), we apply the same fix for consistency and to future-proof against any server-side ESM resolver that requires the `exports` field.

**Step 1: Read the current server stub**

Run: `cat "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/server/stubs/dompurify/package.json"`

**Step 2: Add the `exports` field**

Replace with the same content as Task 1 Step 2 (use the Edit tool).

**Step 3: Reinstall**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/server" && npm install --legacy-peer-deps`

Expected: Installs without errors.

**Step 4: Verify server tests still pass**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/server" && npx vitest run 2>&1 | tail -10`

Expected: `Test Files <N> passed` and `Tests <M> passed`. The current baseline is 10 files, 256 tests.

**Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar"
git add server/stubs/dompurify/package.json server/package-lock.json
git commit -m "fix(server): add exports field to dompurify stub for consistency

Mirrors the client-side fix. The server doesn't currently use a
bundler that requires the exports field, but adding it is consistent
with the client stub and future-proofs against ESM resolver changes.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Delete EthicalCheck workflow

**Files:**
- Delete: `.github/workflows/ethicalcheck.yml`

**Context for the engineer:**

`.github/workflows/ethicalcheck.yml` is a third-party OWASP API security testing action from APIsec-inc. It's a starter template that was never configured — it needs an OPENAPI_SPEC_URL and email, neither of which exists in the repo. It fires on every push/PR and recurrently fails with `startup_failure`, cluttering the CI dashboard. CodeQL `security-extended` already provides comparable coverage, and RMPG Flex has no OpenAPI spec to test against.

**Step 1: Verify the file exists and is what we think**

Run: `cat "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/.github/workflows/ethicalcheck.yml" 2>&1 | head -5`

Expected: Starts with the APIsec EthicalCheck header/description. If not, STOP and report.

**Step 2: Delete the file**

Run: `rm "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/.github/workflows/ethicalcheck.yml"`

**Step 3: Verify deletion**

Run: `ls "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/.github/workflows/" | grep -i ethical`

Expected: No output (empty result).

**Step 4: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar"
git add -A .github/workflows/
git commit -m "ci: remove unconfigured EthicalCheck-Workflow

The EthicalCheck-Workflow is an unconfigured starter template from
APIsec-inc that has never worked — it requires an OPENAPI_SPEC_URL
and email which were never configured. It fires on every push and
fails with startup_failure, cluttering the CI dashboard.

RMPG Flex has no OpenAPI spec to test against, and CodeQL
security-extended already provides comparable security coverage.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Fix Auto-merge Dependabot workflow runner

**Files:**
- Modify: `.github/workflows/auto-merge-dependabot.yml`

**Context for the engineer:**

The current workflow runs on `self-hosted` which is saturated (CodeQL, Security & Quality, Copilot agents all compete for the single runner). The `if: github.actor == 'dependabot[bot]'` check is at the job level, but it only evaluates AFTER the runner is provisioned. When the self-hosted runner is busy, the job times out or errors with `startup_failure` before the condition can skip it.

Auto-merge is a pure GitHub API call (`gh pr merge --auto --squash`) — it doesn't need a self-hosted runner. Switching to `ubuntu-latest` means GitHub provisions a fresh hosted runner per job, and conditions are evaluated more eagerly, eliminating the startup_failure race.

**Step 1: Read the current workflow**

Run: `cat "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/.github/workflows/auto-merge-dependabot.yml"`

Expected content (confirm these exact lines exist):
```yaml
jobs:
  auto-merge:
    name: Auto-merge safe Dependabot PRs
    runs-on: self-hosted
    if: github.actor == 'dependabot[bot]'
```

**Step 2: Change `runs-on` to `ubuntu-latest`**

Use the Edit tool to replace:
```yaml
    runs-on: self-hosted
    if: github.actor == 'dependabot[bot]'
```
with:
```yaml
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
```

**Step 3: Verify the change**

Run: `grep -A2 "runs-on:" "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/.github/workflows/auto-merge-dependabot.yml"`

Expected: `runs-on: ubuntu-latest`

**Step 4: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/.github/workflows/auto-merge-dependabot.yml')); print('valid')"`

Expected: `valid`. If Python throws a YAML parse error, STOP and report.

**Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar"
git add .github/workflows/auto-merge-dependabot.yml
git commit -m "ci(auto-merge): use ubuntu-latest to eliminate startup_failure

The self-hosted runner is saturated by CodeQL, Security & Quality,
and Copilot agent jobs. When Auto-merge Dependabot queues behind
them, the dependabot actor check doesn't evaluate before the runner
scheduler marks the job startup_failure.

Auto-merge is a pure GitHub API call (gh pr merge --auto --squash)
that doesn't need a self-hosted runner. Switching to ubuntu-latest
provisions a fresh runner per job and evaluates conditions eagerly.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Final verification + merge to main

**Files:**
- None (verification + git operations)

**Context for the engineer:**

Confirm all three fixes work together, then merge the branch into main and push.

**Step 1: Verify no uncommitted changes**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar" && git status -s`

Expected: Empty output. If not empty, STOP and report.

**Step 2: Verify commit history**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar" && git log --oneline -10`

Expected: Top 4 commits (newest first) should be:
1. `ci(auto-merge): use ubuntu-latest to eliminate startup_failure`
2. `ci: remove unconfigured EthicalCheck-Workflow`
3. `fix(server): add exports field to dompurify stub for consistency`
4. `fix(client): add exports field to dompurify stub for Vite 6 Rolldown resolution`

Plus the previous `docs: add design for CI + deploy fixes` commit.

**Step 3: Run final client build as smoke test**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/client" && npx vite build 2>&1 | tail -5`

Expected: `✓ built in <time>s` with no errors.

**Step 4: Run final server tests**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/suspicious-chandrasekhar/server" && npx vitest run 2>&1 | tail -5`

Expected: `Test Files 10 passed (10)` and `Tests 256 passed (256)`.

**Step 5: Switch to main repo and merge**

Run these commands in sequence (not parallel):
```bash
cd "/Users/rmpgutah/RMPG Flex"
git checkout main
git pull origin main
git merge claude/suspicious-chandrasekhar --no-edit
```

If a merge conflict occurs, STOP and report. Do NOT attempt to resolve conflicts in the execution phase — that's a separate decision.

**Step 6: Push to origin**

Run: `cd "/Users/rmpgutah/RMPG Flex" && git push origin main`

Expected: Push succeeds. May emit warnings about status checks — that's fine.

**Step 7: Trigger Deploy to Production manually**

Run: `cd "/Users/rmpgutah/RMPG Flex" && gh workflow run "Deploy to Production" --ref main 2>&1`

Expected: `✓ Created workflow_dispatch event for deploy.yml at main`

**Step 8: Wait and verify Deploy succeeds**

Wait ~30 seconds, then run: `cd "/Users/rmpgutah/RMPG Flex" && gh run list --workflow "Deploy to Production" --limit 1 --json status,conclusion -q '.[0] | "\(.status) \(.conclusion // "—")"'`

Expected path:
- Initial: `queued —`
- Then: `in_progress —`
- Finally: `completed success`

If it ends with `completed failure`, run `gh run view <id> --log-failed 2>&1 | tail -30` to get the error and STOP.

**Step 9: Report final status**

Summarize to the user:
- Deploy status (success/failure)
- Confirmation that EthicalCheck no longer fires (check with `gh run list --workflow "EthicalCheck-Workflow" --limit 1` — should show the old failed run, no new run triggered)
- Confirmation that auto-merge-dependabot no longer shows startup_failure on subsequent pushes (will be confirmed on next PR)

---

## Out of Scope

- Generating an OpenAPI spec for RMPG Flex
- Upgrading jsPDF to 5.x
- Reviewing other self-hosted runner jobs for contention issues
- Investigating why `Deploy to Production` runs on every push (currently it's `workflow_dispatch` only — no action needed)
