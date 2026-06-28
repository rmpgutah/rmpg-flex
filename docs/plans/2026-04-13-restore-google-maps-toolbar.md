# Restore Google Maps Toolbar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the full MapPage toolbar (layers panel, drawing tools, stats bar, 30+ feature hooks) by re-enabling Google Maps as primary when an API key is present, while preserving the current `OfflineMapFallback` (Leaflet + CartoDB) as the fallback when no key is configured.

**Architecture:** Revert commit `cc35c952` (the unconditional `throw` in `googleMapsApiKey.ts`), simplify `MapPage.tsx`'s `isAuthError` branch so "no key configured" routes silently to Leaflet instead of showing a billing-setup dialog, and bump `CACHE_NAME` so browsers pick up the new bundle. No new components, no new hooks — both code paths already exist and work; we're just re-enabling the conditional between them.

**Tech Stack:** React 18 + TypeScript, Vite 6, Leaflet (via `OfflineMapFallback`), Google Maps JS API (via `googleMapsLoader`), systemd-managed VPS deploy via `deploy.sh`.

**Design doc:** `docs/plans/2026-04-13-restore-google-maps-toolbar-design.md` (committed `1e112541`).

**Working branch:** `claude/restore-map-tools` (based on `claude/strange-roentgen` at `ad1f024a`).

---

## Context for the Engineer

- **`googleMapsApiKey.ts`** is a 3-export module. After commit `cc35c952`, `getGoogleMapsApiKey()` unconditionally throws. Before that commit, it checked `VITE_GOOGLE_MAPS_API_KEY` (build-time) and fell back to `apiFetch('/integrations/google-maps/client-key')` (runtime, hits a server endpoint that reads `GOOGLE_MAPS_API_KEY` from `server/.env` OR a value saved via the Admin Integrations panel).

- **`MapPage.tsx:219-227`** defines `mapError` state and derives `isAuthError` / `showOfflineFallback`. The current logic shows a blocking config dialog when `mapError` mentions "API key" / "authentication" / "not configured". Post-revert we want those errors to route to Leaflet silently — no dialog.

- **`client/public/sw.js`** — bump `CACHE_NAME` on every client deploy (CLAUDE.md gotcha #5) or browsers serve stale `index.html` from cache. Current deployed value: `rmpg-flex-v221`.

- **`OfflineMapFallback.tsx`** — untouched. When `MapPage.tsx:2151` renders it (because `showOfflineFallback` is true), it covers the map canvas at `z-[2000]` with a fully-functional Leaflet + CartoDB view. This is what production has right now.

- **Sub-skill reference:** `@superpowers:systematic-debugging` if anything fails unexpectedly. `@superpowers:verification-before-completion` before claiming the deploy worked.

---

## Task 1: Revert `cc35c952` and resolve sw.js conflict

**Files:**
- Modify (via revert): `client/src/utils/googleMapsApiKey.ts`
- Modify (via revert + manual conflict resolution): `client/public/sw.js`

**Step 1: Run the revert**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/restore-map-tools"
git revert cc35c952 --no-edit
```

**Expected outcome:** One of two things will happen.
- **Clean revert** (unlikely, since sw.js has been bumped many times since `cc35c952`): `git revert` succeeds, produces a commit, exits 0.
- **Conflict on sw.js** (likely): `git revert` reports `CONFLICT (content): Merge conflict in client/public/sw.js` and exits 1.

**Step 2: If clean revert — verify and proceed to Step 4.**

```bash
git show HEAD --stat
# Expect: 2 files changed, client/src/utils/googleMapsApiKey.ts and client/public/sw.js
git show HEAD -- client/src/utils/googleMapsApiKey.ts | grep -c 'apiFetch'
# Expect: at least 1 (apiFetch call restored)
```

Skip to Task 2.

**Step 3: If conflict on sw.js — resolve manually.**

Read the conflict:
```bash
grep -n '<<<<<<< \|=======\|>>>>>>>' client/public/sw.js
```

The conflict is on the `CACHE_NAME` line. `googleMapsApiKey.ts` should have reverted cleanly — only sw.js conflicts.

Resolve by keeping the current production value and discarding the revert's attempt to reset it:

```bash
# Open client/public/sw.js, find the conflict block around CACHE_NAME
# It will look like:
#   <<<<<<< HEAD
#   const CACHE_NAME = 'rmpg-flex-v221';
#   =======
#   const CACHE_NAME = 'rmpg-flex-v214';  # or similar pre-cc35c952 value
#   >>>>>>> parent of cc35c952...
#
# Keep ONLY the HEAD version (v221). Delete the conflict markers and the other branch.
# Task 3 will bump it to v222.
```

Use the Edit tool to remove the conflict markers, keeping `const CACHE_NAME = 'rmpg-flex-v221';`.

**Step 4: Verify no other files changed, complete the revert commit**

```bash
git status
# Expect: only client/src/utils/googleMapsApiKey.ts (modified, staged) and client/public/sw.js (unmerged or modified after resolve)

git add client/public/sw.js
git revert --continue  # only if we were in the middle of a revert that paused for conflict
# OR if the revert already committed, do nothing
```

**Step 5: Sanity-check the reverted function body**

```bash
cat client/src/utils/googleMapsApiKey.ts
```

**Expected content:**
```typescript
import { apiFetch } from '../hooks/useApi';

let cachedGoogleMapsApiKey: string | null = ((import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || null;
let inflightGoogleMapsApiKey: Promise<string> | null = null;

const MISSING_KEY_MESSAGE =
  'Google Maps API key not configured on the server. Add GOOGLE_MAPS_API_KEY to server/.env.';

export function getCachedGoogleMapsApiKey(): string {
  return cachedGoogleMapsApiKey || '';
}

export function getGoogleMapsApiKeyErrorMessage(): string {
  return MISSING_KEY_MESSAGE;
}

export async function getGoogleMapsApiKey(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedGoogleMapsApiKey) return cachedGoogleMapsApiKey;
  if (!forceRefresh && inflightGoogleMapsApiKey) return inflightGoogleMapsApiKey;

  inflightGoogleMapsApiKey = apiFetch<{ configured?: boolean; apiKey?: string }>('/integrations/google-maps/client-key')
    .then((response) => {
      const apiKey = typeof response?.apiKey === 'string' ? response.apiKey.trim() : '';
      if (!apiKey) {
        throw new Error(MISSING_KEY_MESSAGE);
      }
      cachedGoogleMapsApiKey = apiKey;
      return apiKey;
    })
    .finally(() => {
      inflightGoogleMapsApiKey = null;
    });

  return inflightGoogleMapsApiKey;
}
```

If the function body doesn't look like this (e.g., still has the `throw new Error('Google Maps disabled...')`), the revert failed. Stop and debug.

**Step 6: Commit (if revert didn't already)**

If `git revert` produced a commit with a conflict, we'll be in a detached "revert in progress" state. Finalize:

```bash
git status
# If "revert in progress", then:
git commit --no-edit
```

Resulting commit message should be something like:
```
Revert "fix(map): disable Google Maps entirely — force Leaflet fallback"

This reverts commit cc35c9520ae2b93334760d5968caf82ce81ea91e.
```

---

## Task 2: Simplify `isAuthError` in MapPage.tsx

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx:226-227`

**Why:** Post-revert, `getGoogleMapsApiKey()` throws `MISSING_KEY_MESSAGE` ("Google Maps API key not configured on the server...") when no key is set. The current `isAuthError` check in `MapPage.tsx` matches "API key" and "not configured" and renders a full-screen billing-setup dialog. That's the wrong UX — we want silent Leaflet fallback, not a blocking prompt.

**Step 1: Read the current state**

```bash
sed -n '219,230p' client/src/pages/map/MapPage.tsx
```

**Expected output (current):**
```typescript
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRetry, setMapRetry] = useState(0); // bump to re-trigger Google Maps init
  const [tilesStalled, setTilesStalled] = useState(false);
  const [retryingGmaps, setRetryingGmaps] = useState(false);

  // Determine if the error is an API key/auth issue vs a connectivity issue.
  // Auth errors → show config dialog.  Connectivity errors → show Leaflet fallback.
  const isAuthError = mapError != null && (mapError.includes('API key') || mapError.includes('authentication') || mapError.includes('not configured'));
  const showOfflineFallback = mapError != null && !isAuthError;
```

**Step 2: Edit lines 225-227**

Use the Edit tool on `client/src/pages/map/MapPage.tsx`:

**Old string:**
```typescript
  // Determine if the error is an API key/auth issue vs a connectivity issue.
  // Auth errors → show config dialog.  Connectivity errors → show Leaflet fallback.
  const isAuthError = mapError != null && (mapError.includes('API key') || mapError.includes('authentication') || mapError.includes('not configured'));
  const showOfflineFallback = mapError != null && !isAuthError;
```

**New string:**
```typescript
  // All map errors route to the Leaflet fallback — no blocking config dialog.
  // "No API key configured" is a normal operating mode for deployments without
  // Google Maps billing enabled. gm_authFailure and network errors likewise
  // degrade gracefully to Leaflet + CartoDB tiles. The config dialog was a
  // holdover from an earlier era when Google Maps was mandatory.
  const isAuthError = false;
  const showOfflineFallback = mapError != null;
```

**Why keep `isAuthError` as a const instead of deleting it:** The symbol is likely referenced downstream in `MapPage.tsx` (search for `isAuthError` — line 2186 has `{isAuthError && (` guarding the config dialog). Leaving it as `false` keeps the dialog JSX in the tree as dead code (dead-code elimination by Vite minifier handles the rest) without requiring us to delete potentially multiple usage sites. **YAGNI** — delete only if dead-code warnings complain.

**Step 3: Verify the file still type-checks**

```bash
cd client && npx tsc --noEmit 2>&1 | tail -20
```

**Expected:** No new errors. There are 28 pre-existing `@types/express` 5.x errors in server/ that `client/` tsconfig shouldn't touch — if you see those they're unrelated and ignorable. If you see errors mentioning `isAuthError` or `MapPage.tsx`, stop and debug.

**Step 4: Commit**

```bash
git add client/src/pages/map/MapPage.tsx
git commit -m "$(cat <<'EOF'
fix(map): route 'no Google Maps key' silently to Leaflet fallback

Post-revert of cc35c952, getGoogleMapsApiKey() throws MISSING_KEY_MESSAGE
when no key is configured. The existing isAuthError branch detected that
string and rendered a full-screen billing-setup dialog, which is the
wrong UX for deployments intentionally running without Google Maps.

Setting isAuthError = false means all map errors — missing key,
gm_authFailure, network errors — fall through to OfflineMapFallback
(Leaflet + CartoDB). Deployments with a key configured load Google Maps
normally; deployments without get the same Leaflet view they have today.
EOF
)"
```

---

## Task 3: Bump `CACHE_NAME` to v222

**Files:**
- Modify: `client/public/sw.js:11`

**Step 1: Read the current value**

```bash
grep -n "CACHE_NAME = " client/public/sw.js | head -1
```

**Expected:** `11:const CACHE_NAME = 'rmpg-flex-v221';`

If it's already v222 or higher, skip this task.

**Step 2: Edit**

Use the Edit tool:

**Old string:** `const CACHE_NAME = 'rmpg-flex-v221';`

**New string:** `const CACHE_NAME = 'rmpg-flex-v222';`

**Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "$(cat <<'EOF'
chore(sw): bump CACHE_NAME to v222 for Google Maps toolbar restore

The revert of cc35c952 and the isAuthError simplification change the
client bundle. Without a CACHE_NAME bump, browsers running the v221
SW will keep serving the old index.html and bundle from cache.

Per CLAUDE.md gotcha #5.
EOF
)"
```

---

## Task 4: Verify build + server tests pass locally

**Files:** none — verification only.

**Step 1: Run the client typecheck**

```bash
cd client && npx tsc --noEmit 2>&1 | tail -5
```

**Expected:** clean exit, no new errors. This is the gate `deploy.sh` runs first.

**Step 2: Run the server test suite**

```bash
cd ../server && npx vitest run 2>&1 | tail -5
```

**Expected:** `Test Files  21 passed (21)` and `Tests  356 passed (356)`. Per CLAUDE.md the expected count is 356.

**Flaky-test note:** The `tests/integration/warrants.test.ts > PUT /api/warrants/:id/serve > marks a warrant as served` test has been observed failing intermittently with `socket hang up` under the full-suite run but passes in isolation. If exactly that test fails, re-run the suite once. If any other test fails, investigate before proceeding.

**Step 3: Run the vite build**

```bash
cd ../client && npx vite build 2>&1 | tail -10
```

**Expected:** `built in X.Xs` with no errors. The produced `client/dist/` is what `deploy.sh` will rsync to the VPS.

**Step 4: No commit — this was verification only.**

---

## Task 5: Push branch, open PR, merge, deploy

**Files:** none — git + deploy ops.

**Step 1: Push the branch**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/restore-map-tools"
git push -u origin claude/restore-map-tools
```

**Expected:** `* [new branch]      claude/restore-map-tools -> claude/restore-map-tools`.

**Step 2: Open PR targeting `claude/strange-roentgen`**

**CRITICAL:** default base branch is `main`. Explicitly set `--base claude/strange-roentgen` — that's the branch production deploys from.

```bash
gh pr create --base claude/strange-roentgen --head claude/restore-map-tools \
  --title "feat(map): restore Google Maps toolbar via hybrid key-present fallback" \
  --body "See docs/plans/2026-04-13-restore-google-maps-toolbar-design.md for the full design.

## Summary

- Reverts cc35c952 (disable Google Maps entirely)
- Simplifies MapPage isAuthError to always route map errors through OfflineMapFallback
- Bumps CACHE_NAME v221 → v222

## Behavior

- Deployment **with** Google Maps API key (via server/.env or Admin Integrations panel) → full MapPage toolbar with 30+ hooks and 20+ panels, Google Maps as primary tile source
- Deployment **without** a key → unchanged from today's production: Leaflet + CartoDB via OfflineMapFallback

## Verification

Post-deploy, requires user to add GOOGLE_MAPS_API_KEY to server/.env (and restart) or save via Admin Integrations panel. Without a key the site behaves exactly as today."
```

**Expected output:** a URL like `https://github.com/.../pull/NNN`. Capture the PR number.

**Step 3: Merge the PR**

```bash
gh pr merge <PR_NUMBER> --squash --repo Rocky-Mountain-Protective-Group-LLC/rmpg-flex
```

**Expected:** `gh` reports the merge succeeded. If CI is required and blocking, add `--auto` and wait.

**Step 4: Pull merged state into the existing strange-roentgen worktree**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/strange-roentgen"
git pull origin claude/strange-roentgen --ff-only
```

**Expected:** fast-forward to the new merge commit. No conflicts.

**Step 5: Verify the merged files contain the changes**

```bash
grep -c 'apiFetch' client/src/utils/googleMapsApiKey.ts
grep -c 'isAuthError = false' client/src/pages/map/MapPage.tsx
grep -c 'v222' client/public/sw.js
```

**Expected:** all three return `1` or higher.

**Step 6: Deploy**

```bash
bash deploy/deploy.sh 2>&1 | tail -30
```

**Expected:** `✓ DEPLOY SUCCESSFUL` and `rmpg-flex.service ... active (running)`.

If the flaky warrant test fails the gate, re-run once. If it fails twice, stop and flag — pre-existing flake may have become a real regression.

---

## Task 6: Post-deploy verification (two sub-paths)

**Files:** none.

### 6a: Verify the key-absent path still works (no-regression check)

This runs without any API key configured. Current production is in this state.

**Step 1: Health check**

```bash
curl -sf https://rmpgutah.us/api/health | python3 -c "import sys, json; d=json.load(sys.stdin); print(f\"status={d['status']} version={d['version']}\")"
```

**Expected:** `status=ok version=5.7.0` (or whatever current version).

**Step 2: Confirm sw.js is updated**

```bash
curl -sL https://rmpgutah.us/sw.js 2>/dev/null | grep -m1 "CACHE_NAME ="
```

**Expected:** `const CACHE_NAME = 'rmpg-flex-v222';`

**Step 3: Verify map page still renders Leaflet**

Open https://rmpgutah.us/map in a browser. You should see the same Leaflet + CartoDB view you saw before this change. No config-prompt dialog, no new errors in the console. Map tiles should still render (CSP fix from PR #174 is preserved).

If a config dialog appears asking you to set up billing → Task 2 was done incorrectly. Re-check that `isAuthError = false`.

### 6b: Verify the key-present path lights up the toolbar (user-driven, requires billing)

This requires you (the user) to:

1. Go to Google Cloud Console → create a project → enable the Maps JavaScript API + Places API (New) → create a key → enable billing on the project.
2. Either:
   - SSH to the VPS and add `GOOGLE_MAPS_API_KEY=...` to `/opt/rmpg-flex/server/.env` then `systemctl restart rmpg-flex`, **or**
   - Log into the app as admin → Admin Integrations panel → paste the key, save.

**Step 1: Hard-reload /map in the browser**

Unregister the service worker once to force the new v222 SW to activate:

- DevTools → Application → Service Workers → Unregister
- Cmd+Shift+R (hard reload)

**Step 2: Verify Google Maps loaded, not Leaflet**

- Bottom-right corner of the map should show "Google" attribution + "Terms of Use"
- Top-left should show the **Layers panel** (Units / Active Calls / Properties toggles)
- Top-center should show **Stats bar** (LIVE badge, call count, unit count)
- Bottom-left should show **Status legend** (AVL/DSP/ENR/ONS/BSY dots with priority codes)
- Drawing / measurement / event-planning tools should be accessible in the layers panel

**Step 3: If Google Maps does NOT load**

Open DevTools → Console. Likely errors:
- `gm_authFailure`: the key is invalid or billing isn't enabled on the Cloud project → fix in Cloud Console
- `RefererNotAllowedMapError`: key has HTTP-referrer restrictions and rmpgutah.us isn't on the allowlist → fix in the key's restrictions
- `ApiNotActivatedMapError`: Maps JavaScript API isn't enabled on the Cloud project → enable it

All three should degrade gracefully to the Leaflet fallback (no crash, no blank screen), per the design.

---

## Success Criteria

- [ ] `cc35c952` is reverted on `claude/strange-roentgen`, visible in `git log --oneline --grep='Revert "fix(map): disable'`
- [ ] `MapPage.tsx` has `const isAuthError = false;`
- [ ] Deployed `sw.js` has `CACHE_NAME = 'rmpg-flex-v222'`
- [ ] Key-absent deployment: visiting `/map` shows Leaflet fallback with no config-prompt dialog
- [ ] Key-present deployment (after user configures): visiting `/map` shows Google Maps with full toolbar

## Rollback

If anything breaks in production after deploy:

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/strange-roentgen"
git log --oneline | grep 'Revert "fix(map): disable' | head -1
# Copy the hash, then:
git revert <that-hash> --no-edit
# Resolve any sw.js conflict the same way as Task 1, bump CACHE_NAME to v223
bash deploy/deploy.sh
```

Symmetric and safe — restores the `cc35c952` disable and returns production to the current (pre-this-plan) state.
