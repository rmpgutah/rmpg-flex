# Call Detail Audit + Pure-Black Theme Enforcement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** (1) Audit every editable field on the dispatch call detail panel against the live PUT handler and fill any gaps, and (2) replace dark-blue chrome hex values (surface backgrounds, panels, borders) with pure black while leaving semantic status blues untouched.

**Architecture:** Two independent workstreams shipped in one branch. Part 1 modifies only `server/src/routes/dispatch.ts` (the live handler discovered in commit `651ef115` — the modular `dispatch/calls.ts` is shadow code). Part 2 modifies ~12 client files to swap dark-blue surface hexes for pure-black equivalents. Tailwind `blue-*` palette is already aliased to grayscale in `tailwind.config.js`, so only inline `style={{...}}` hexes and CSS `#` literals need attention.

**Tech Stack:** TypeScript + Express (server) + React + Tailwind + Vite (client). No new dependencies.

**Design doc:** [2026-04-10-call-detail-audit-and-blue-purge-design.md](2026-04-10-call-detail-audit-and-blue-purge-design.md)

---

## Critical Conventions (read before starting)

1. **Worktree path**: All edits use `/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini/`. Never the main repo.
2. **Shadow route trap**: `server/src/index.ts:46` imports `./routes/dispatch` which resolves to `dispatch.ts` (not `dispatch/index.ts`). **All Part 1 edits go in `server/src/routes/dispatch.ts` at line 445's `router.put('/calls/:id', ...)` handler.** Do NOT touch `server/src/routes/dispatch/calls.ts` — it's dead code.
3. **Leave semantic blue alone**: `#3b82f6` is "enroute" status. It means something. Do not replace it in Part 2. Same for any priority-P3 markers, "video start" markers, or status dots.
4. **Target hex values for Part 2**: `#060c14`, `#040810`, `#0d1520`, `#141e2b`, `#1a2636`, `#0d142a`, `#0e1428`, `#1a5a9e`. These are surface/chrome blues.
5. **Don't touch Tailwind blue utility classes**: `text-blue-*`, `bg-blue-*`, `border-blue-*` already render as gray via the palette override in `client/tailwind.config.js:126-138`. Cleaning them up is cosmetic busywork.
6. **Don't rename `--brand-blue` CSS var**: It's already set to `#888888` (gray). Renaming breaks every file that uses it.
7. **Deploy flow**: `bash deploy/deploy.sh` after both parts are committed. Bump `client/public/sw.js` `CACHE_NAME` from `v153` to `v154` in the Part 2 commit so browsers pick up the visual change.
8. **Typecheck command**: `cd server && npx tsc --noEmit 2>&1 | grep dispatch.ts | grep -v "PremiseHistory\|Expected 5"` (the `grep -v` filters pre-existing baseline errors). For client: `cd client && npx tsc --noEmit 2>&1 | grep -c "error TS"` should return `0`.

---

## PART 1 — Call Detail Field Audit

**Phase goal:** Add missing destructure + addField entries to `server/src/routes/dispatch.ts:445` so every editable field in the client can save successfully.

### Task 1.1: Audit destructure block for missing fields

**Files:**
- Read: `server/src/routes/dispatch.ts:454-477` (destructure)
- Read: `server/src/routes/dispatch.ts:543-618` (addField calls)
- Read: `server/src/routes/dispatch/calls.ts:259-271` (reference: modular version's destructure — has fields the monolith might be missing)

**Step 1: Enumerate current destructure**

Run:
```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && sed -n '454,477p' server/src/routes/dispatch.ts
```

Expected current fields in destructure (you're looking for what's MISSING compared to the modular version):
- `incident_type, priority, status, caller_name, caller_phone, caller_relationship`
- `location_address, property_id, latitude, longitude, description, notes, disposition`
- `cross_street, location_building, location_floor, location_room`
- `weapons_involved, injuries_reported, num_subjects`
- `subject_description, vehicle_description, direction_of_travel`
- `source, caller_address, zone_beat, section_id, zone_id, beat_id, responding_officer, secondary_type`
- `contact_method, scene_safety, weather_conditions, lighting_conditions`
- `num_victims, alcohol_involved, drugs_involved, domestic_violence`
- `supervisor_notified, le_notified, le_agency, le_case_number`
- `damage_estimate, damage_description, action_taken`
- `starting_mileage, ending_mileage`
- All extended flags (`mental_health_crisis`, etc.)
- All PSO fields EXCEPT `pso_attempt_number`
- `process_service_type, process_served_to, process_served_address` (missing `process_attempts`, `process_served_at`, `process_service_result`)
- `client_id`
- **Missing from destructure**: `pso_attempt_number`, `process_attempts`, `process_served_at`, `process_service_result`, `case_number`, `case_id`, `contract_id`

**Step 2: Enumerate current addField calls**

Run:
```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && sed -n '543,618p' server/src/routes/dispatch.ts | grep addField
```

Note any destructured variables that exist but never get an `addField` call — those are "received but ignored" bugs.

**Step 3: Cross-reference against client usage**

Grep the client for fields that get sent to `/dispatch/calls/${id}` via PUT. The audit is narrow: look for `apiFetch.*dispatch/calls` calls and the request bodies. Use this command:

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && grep -rEn "apiFetch.*dispatch/calls/\\\$\\{.*\\}'" client/src --include="*.tsx" -A 3 | head -60
```

Look specifically for `method: 'PUT'` bodies that reference fields NOT in the current destructure. Common suspects based on the modular version:
- `case_number` — client might send this; monolith has it? Check.
- `case_id` — same
- `pso_attempt_number` — PSO workflow uses this counter
- `process_attempts` — process service counter
- `process_served_at` — when process was served
- `process_service_result` — outcome of service attempt
- `contract_id` — contract linkage

**Step 4: Report findings**

Write a brief report (in chat, not a file) of:
- Missing from destructure: [list]
- Destructured but not addField'd: [list]
- Client sends but neither present: [list]

**No commit yet** — Task 1.1 is pure discovery. The fix lands in Task 1.2.

---

### Task 1.2: Add missing fields to handler

**Files:**
- Modify: `server/src/routes/dispatch.ts:454-477` (destructure block)
- Modify: `server/src/routes/dispatch.ts:618` (last `addField` call, before the timeline block at line 620)

**Step 1: Extend the destructure**

Using the Edit tool, find the exact current destructure block and add the missing field names from Task 1.1. For each missing field, add it to the appropriate section (PSO, Process Service, top-level, etc.). Example for the PSO / Process Service section:

Find:
```typescript
      // PSO Client Request fields
      pso_service_type, pso_authorization, pso_requestor_name,
      pso_requestor_phone, pso_requestor_email, pso_billing_code,
      // Process Service fields
      process_service_type, process_served_to, process_served_address,
      client_id: updateClientId,
    } = req.body;
```

Replace with (adding the missing fields):
```typescript
      // PSO Client Request fields
      pso_service_type, pso_authorization, pso_requestor_name,
      pso_requestor_phone, pso_requestor_email, pso_billing_code,
      pso_attempt_number,
      // Process Service fields
      process_service_type, process_served_to, process_served_address,
      process_attempts, process_served_at, process_service_result,
      // Case linkage
      case_number, case_id, contract_id,
      client_id: updateClientId,
    } = req.body;
```

Only add fields that Task 1.1 confirmed are missing AND are used by the client. **Do not speculatively add fields.**

**Step 2: Add matching addField calls**

Find the existing PSO/Process Service addField block near the end of the list (around line 612-617):

```typescript
    addField('pso_service_type', pso_service_type);
    addField('pso_authorization', pso_authorization);
    addField('pso_requestor_name', pso_requestor_name);
    addField('pso_requestor_phone', pso_requestor_phone);
    addField('pso_requestor_email', pso_requestor_email);
    addField('pso_billing_code', pso_billing_code);
    // Process Service fields
    addField('process_service_type', process_service_type);
    addField('process_served_to', process_served_to);
    addField('process_served_address', process_served_address);
    addField('client_id', resolvedUpdateClientId);
```

Replace with (adding matching addField calls for every new destructure entry):
```typescript
    addField('pso_service_type', pso_service_type);
    addField('pso_authorization', pso_authorization);
    addField('pso_requestor_name', pso_requestor_name);
    addField('pso_requestor_phone', pso_requestor_phone);
    addField('pso_requestor_email', pso_requestor_email);
    addField('pso_billing_code', pso_billing_code);
    addField('pso_attempt_number', pso_attempt_number !== undefined ? (isNaN(Number(pso_attempt_number)) ? null : Number(pso_attempt_number)) : undefined);
    // Process Service fields
    addField('process_service_type', process_service_type);
    addField('process_served_to', process_served_to);
    addField('process_served_address', process_served_address);
    addField('process_attempts', process_attempts !== undefined ? (isNaN(Number(process_attempts)) ? null : Number(process_attempts)) : undefined);
    addField('process_served_at', process_served_at);
    addField('process_service_result', process_service_result);
    // Case linkage
    addField('case_number', case_number);
    addField('case_id', case_id);
    addField('contract_id', contract_id);
    addField('client_id', resolvedUpdateClientId);
```

**Integer coercion note:** `pso_attempt_number` and `process_attempts` are integer counters. Use the `!isNaN(Number(x)) ? Number(x) : null` pattern to handle both numeric strings from form inputs AND already-numeric values. This mirrors the pattern used by `starting_mileage` and other numeric fields in the file.

**Step 3: Verify no duplicates**

After editing, grep for duplicate addField calls:

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && sed -n '543,625p' server/src/routes/dispatch.ts | grep "addField" | awk '{print $1}' | sort | uniq -c | sort -rn | head -5
```

Each addField call should appear exactly once. If you see a count > 1, you added a duplicate — remove it.

**Step 4: Typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini/server" && npx tsc --noEmit 2>&1 | grep "dispatch.ts" | grep -v "PremiseHistory\|Expected 5"
```
Expected: NO output (no new errors).

**Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini"
git add server/src/routes/dispatch.ts
git commit -m "$(cat <<'EOF'
fix(dispatch): audit PUT /calls/:id for missing editable fields

Post-commit 651ef115 (timeline timestamp fix), audited every editable
field in the client's DispatchPage detail panel against the live
handler at dispatch.ts:445. Found N fields that were either missing
from the destructure block or had no addField call, causing their
values to be silently dropped when the client sent them in an edit.

Fields added:
  - [list the specific fields you actually added based on Task 1.1 findings]

Each addition is a single destructure entry + matching addField call.
Integer counters (pso_attempt_number, process_attempts) use the same
isNaN/Number coercion pattern as existing numeric fields.

No behavior change for fields that already worked. The addField helper
short-circuits on undefined so clients that don't send these new fields
are unaffected.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3: Regression test — timeline still works

**Files:** None modified — this is a verification task.

**Step 1: Verify timeline block still intact**

Read lines 625-675 of `server/src/routes/dispatch.ts` and confirm the timeline override block (the `TIMELINE_EDIT_ROLES` check, `handleTimelineField` helper, calls to `handleTimelineField('received_at')` through `handleTimelineField('created_at')`) is still present and unmodified.

If ANY line of the timeline block is different from the pre-Task-1.2 state, stop and ask the user — you may have accidentally edited inside the block.

**Step 2: Verify the NO_FIELDS branch logs**

Read lines 675-690 and confirm the diagnostic `console.warn` for `NO_FIELDS_TO_UPDATE` is still in place.

**Step 3: Re-run typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini/server" && npx tsc --noEmit 2>&1 | grep "dispatch.ts" | grep -v "PremiseHistory\|Expected 5"
```
Expected: NO output.

**No commit** — this is verification only.

---

## PART 2 — Pure-Black Theme Enforcement

**Phase goal:** Replace dark-blue chrome hex values with pure-black equivalents across ~12 client files. Leave semantic blues (`#3b82f6` for enroute status, etc.) untouched.

### Task 2.1: Fix login page gradient

**Files:**
- Modify: `client/src/pages/LoginPage.tsx:334`

**Step 1: Find the current gradient**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && sed -n '334p' client/src/pages/LoginPage.tsx
```
Expected: `style={{ background: 'linear-gradient(180deg, #060c14 0%, #0a0a0a 100%)' }}`

**Step 2: Replace the gradient with pure black**

Use Edit tool to replace:
```jsx
style={{ background: 'linear-gradient(180deg, #060c14 0%, #0a0a0a 100%)' }}
```
with:
```jsx
style={{ background: 'linear-gradient(180deg, #0a0a0a 0%, #050505 100%)' }}
```

Rationale: the gradient effect is preserved (subtle darkening top-to-bottom) but with pure-black stops that match `--surface-base` and `--surface-sunken` from `index.css`. No blue channel.

**Step 3: Typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini/client" && npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: `0`.

**No commit yet** — Part 2 commits at the end as a single cohesive change.

---

### Task 2.2: Fix ShiftHandoffReport blue panels

**Files:**
- Modify: `client/src/components/ShiftHandoffReport.tsx` (multiple lines)

**Step 1: Count the blue hex usages**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && grep -nE "#0d1520|#1a2636|#141e2b|#1a5a9e" client/src/components/ShiftHandoffReport.tsx
```

Expected hits: ~13 lines using `bg-[#0d1520]`, `bg-[#1a2636]`, and one `color: #1a5a9e` in a print media query.

**Step 2: Replace each hex value**

Use Edit tool with `replace_all: true` for bulk replacements:

| Find | Replace |
|---|---|
| `bg-[#0d1520]` | `bg-[#0a0a0a]` |
| `bg-[#1a2636]` | `bg-[#141414]` |
| `#1a5a9e` | `#888888` |

Run each as a separate Edit call with `replace_all: true`.

**Step 3: Verify no blue hex remains in the file**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && grep -nE "#060c14|#040810|#0d1520|#141e2b|#1a2636|#0d142a|#0e1428|#1a5a9e" client/src/components/ShiftHandoffReport.tsx
```
Expected: NO output.

**Step 4: Typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini/client" && npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: `0`.

---

### Task 2.3: Fix ShiftScorecard blue panels

**Files:**
- Modify: `client/src/components/ShiftScorecard.tsx` (~8 lines)

**Step 1: Count the blue hex usages**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && grep -nE "#0d1520|#141e2b|#1a5a9e" client/src/components/ShiftScorecard.tsx
```

**Step 2: Replace**

Same three `replace_all` edits as Task 2.2:
- `#0d1520` → `#0a0a0a`
- `#141e2b` → `#141414`
- `#1a5a9e` → `#888888`

**Caveat:** Line 41 has `{ key: 'response_time', label: 'Response Time', icon: Activity, color: '#3b82f6' }`. **Leave `#3b82f6` alone** — that's semantic. Your regex should only match `#1a5a9e` and the two dark surface blues, so this shouldn't be at risk, but verify.

**Step 3: Verify**

```bash
grep -nE "#0d1520|#141e2b|#1a5a9e" client/src/components/ShiftScorecard.tsx
```
Expected: NO output.

Verify `#3b82f6` is still there:
```bash
grep -n "#3b82f6" client/src/components/ShiftScorecard.tsx
```
Expected: line 41 still has it.

---

### Task 2.4: Fix OfflineMapFallback background

**Files:**
- Modify: `client/src/components/OfflineMapFallback.tsx:539,697`

**Step 1: Check**

```bash
grep -nE "#060c14" client/src/components/OfflineMapFallback.tsx
```
Expected: 2 hits (lines 539 and 697).

**Step 2: Replace**

`#060c14` → `#0a0a0a` (replace_all on this file).

**Step 3: Verify**

```bash
grep -nE "#060c14" client/src/components/OfflineMapFallback.tsx
```
Expected: NO output.

---

### Task 2.5: Fix DispatchMiniMap background

**Files:**
- Modify: `client/src/components/DispatchMiniMap.tsx:341,404`

**Step 1: Replace**

`#060c14` → `#0a0a0a` (replace_all).

**Step 2: Verify**

```bash
grep -nE "#060c14" client/src/components/DispatchMiniMap.tsx
```
Expected: NO output.

---

### Task 2.6: Fix RadialMenu brand accent

**Files:**
- Modify: `client/src/components/RadialMenu.tsx`

**Step 1: Check context first**

Read lines 20-30 and 200-215. You should see:
- Line 22: `{ label: 'Status', icon: Radio, color: '#3b82f6', action: 'status' }` — **LEAVE THIS. Semantic blue.**
- Line 205: `background: isOpen ? '#ef4444' : '#1a5a9e',` — the "closed" state of the menu button. **Replace `#1a5a9e` with `#888888`** (gray).

**Step 2: Surgical replace — NOT replace_all**

Use Edit (NOT replace_all) to replace just line 205:
```jsx
background: isOpen ? '#ef4444' : '#1a5a9e',
```
with:
```jsx
background: isOpen ? '#ef4444' : '#888888',
```

**Step 3: Verify line 22 unchanged**

```bash
sed -n '22p' client/src/components/RadialMenu.tsx
```
Expected: still has `color: '#3b82f6'`.

---

### Task 2.7: Fix page-level dark surface blues

**Files:** These need individual treatment — get line-level context for each first. Expected files based on Task 0 audit:
- `client/src/pages/ArrestRecordsPage.tsx`
- `client/src/pages/CommandCenterPage.tsx`
- `client/src/pages/CommunicationsPage.tsx`
- `client/src/pages/CrimeAnalysisPage.tsx`
- `client/src/pages/DashCamerasPage.tsx`
- `client/src/pages/DispatchPage.tsx` (the legacy 2,784-line flat file — probably dead code but still has blue)
- `client/src/pages/ForensicsPage.tsx`
- `client/src/pages/NationalWarrantSearchPage.tsx`
- `client/src/pages/ResetPasswordPage.tsx`
- `client/src/pages/dispatch/DispatchPage.tsx` (the live 5,568-line file)
- `client/src/pages/fleet/tabs/FleetGpsHistoryTab.tsx`
- `client/src/pages/map/MapPage.tsx`
- `client/src/pages/map/components/MapSidebar.tsx`
- `client/src/pages/map/utils/mapMarkerBuilders.ts`

**Step 1: Enumerate all dark-surface blue hits across these files**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && grep -rnE "#060c14|#040810|#0d1520|#141e2b|#1a2636|#0d142a|#0e1428|#1a5a9e" client/src/pages client/src/pages/map 2>&1 | grep -v "#3b82f6" | head -40
```

**Step 2: For each file, do a bulk replace_all of the dark surface hexes**

In each file, apply these replace_all edits:
- `#060c14` → `#0a0a0a`
- `#040810` → `#050505`
- `#0d1520` → `#0a0a0a`
- `#141e2b` → `#141414`
- `#1a2636` → `#1a1a1a`
- `#0d142a` → `#0d0d0d`
- `#0e1428` → `#0e0e0e`
- `#1a5a9e` → `#888888`

**Step 3: Double-check `mapMarkerBuilders.ts`**

This file builds SVG map markers with fill colors. Map markers are arguably semantic (each marker type has a unique color). Open the file and read each fill color reference. For each blue hex:
- If it's a theme background / panel color — replace
- If it's distinguishing marker type (e.g., "water hydrant" vs "gas station") — LEAVE IT

Report to the user what you chose to do and why.

**Step 4: Verify each file has no dark-surface blue remaining**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && grep -rnE "#060c14|#040810|#0d1520|#141e2b|#1a2636|#0d142a|#0e1428|#1a5a9e" client/src/pages 2>&1 | grep -v "#3b82f6"
```
Expected: NO output (or only lines that were intentionally left as semantic markers in Step 3).

**Step 5: Verify `#3b82f6` preserved**

```bash
grep -rn "#3b82f6" client/src/pages | wc -l
```
Expected: ~10-15 (unchanged from before).

---

### Task 2.8: Fix index.css surface blues

**Files:**
- Modify: `client/src/index.css` (multiple lines)

**Step 1: Find all blue hex in index.css**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && grep -nE "#060c14|#040810|#0d1520|#141e2b|#1a2636|#0d142a|#0e1428|#1a5a9e" client/src/index.css
```

Expected hits include:
- Line 1785: `background: #040810;`
- Line 2027: `background: #040810;`
- Line 2526: `[style*="background: #060c14"],`
- Line 4062-4063: `border-top-color: #060c14;` / `border-left-color: #060c14;`

**Step 2: Replace each hex value**

Apply bulk replace_all:
- `#060c14` → `#0a0a0a`
- `#040810` → `#050505`
- `#0d1520` → `#0a0a0a`
- `#141e2b` → `#141414`
- `#1a2636` → `#1a1a1a`
- `#1a5a9e` → `#888888`

The line 2526 `[style*="background: #060c14"]` selector is problematic — it's an attribute selector that matches INLINE STYLE strings. If we replace the inline styles in `OfflineMapFallback.tsx` and `DispatchMiniMap.tsx` (Tasks 2.4 and 2.5), this selector no longer matches anything. **Either update the selector to match the new `#0a0a0a` OR delete the entire rule if nothing else relies on it.** Read the rule body before deciding — if it's a ::before overlay that styles the offline map fallback, updating the selector preserves the overlay.

**Step 3: Update the theme comment**

Find lines 5-9:
```css
/* ============================================================
   RMPG Flex - Custom Styles
   Spillman Flex / Motorola Solutions — Steel-Blue Dark Theme
   Motorola blue + gold accents on steel-blue-tinted dark console
   ============================================================ */
```

Replace with:
```css
/* ============================================================
   RMPG Flex - Custom Styles
   Spillman Flex / Motorola Solutions — Pure Black Dark Theme
   Gray + gold accents on a pure-black CAD console
   ============================================================ */
```

**Step 4: Verify**

```bash
grep -nE "#060c14|#040810|#0d1520|#141e2b|#1a2636|#1a5a9e" client/src/index.css
```
Expected: NO output (except possibly the attribute selector if you chose to preserve it with the new hex).

Also verify the comment:
```bash
grep -n "Steel-Blue\|Pure Black" client/src/index.css | head -3
```
Expected: "Pure Black Dark Theme" present, "Steel-Blue" absent.

---

### Task 2.9: Bump service worker cache

**Files:**
- Modify: `client/public/sw.js:11`

**Step 1: Read current value**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini" && grep "CACHE_NAME" client/public/sw.js
```
Expected: `const CACHE_NAME = 'rmpg-flex-v153';`

**Step 2: Bump to v154**

Replace `'rmpg-flex-v153'` with `'rmpg-flex-v154'`.

**Step 3: Verify**

```bash
grep "CACHE_NAME" client/public/sw.js
```
Expected: `const CACHE_NAME = 'rmpg-flex-v154';`

---

### Task 2.10: Client typecheck + build

**Step 1: Full client typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini/client" && npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: `0`.

**Step 2: Full client build**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini/client" && npx vite build 2>&1 | tail -10
```
Expected: `✓ built in Xs` at the end.

**Step 3: Visual verification in preview**

The preview servers (`vite-client` on port 5173 and `api-server` on port 3001) should already be running. After the edits, HMR should have refreshed. Take a screenshot of the login page:

```bash
# No explicit command — use preview_screenshot MCP tool on the running vite-client server
```

Using the Claude Preview tools:
- `preview_list` to get the vite-client serverId
- `preview_eval` with `window.location.href = '/login'` to navigate
- `preview_screenshot` with the serverId

Expected: login page background reads pure black top-to-bottom, no navy tint visible in the "INTERNAL USE ONLY" footer area.

---

### Task 2.11: Commit Part 2

**Step 1: Stage all Part 2 files**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini"
git add client/public/sw.js \
  client/src/index.css \
  client/src/pages/LoginPage.tsx \
  client/src/components/ShiftHandoffReport.tsx \
  client/src/components/ShiftScorecard.tsx \
  client/src/components/OfflineMapFallback.tsx \
  client/src/components/DispatchMiniMap.tsx \
  client/src/components/RadialMenu.tsx \
  client/src/pages/ArrestRecordsPage.tsx \
  client/src/pages/CommandCenterPage.tsx \
  client/src/pages/CommunicationsPage.tsx \
  client/src/pages/CrimeAnalysisPage.tsx \
  client/src/pages/DashCamerasPage.tsx \
  client/src/pages/DispatchPage.tsx \
  client/src/pages/ForensicsPage.tsx \
  client/src/pages/NationalWarrantSearchPage.tsx \
  client/src/pages/ResetPasswordPage.tsx \
  client/src/pages/dispatch/DispatchPage.tsx \
  client/src/pages/fleet/tabs/FleetGpsHistoryTab.tsx \
  client/src/pages/map/MapPage.tsx \
  client/src/pages/map/components/MapSidebar.tsx \
  client/src/pages/map/utils/mapMarkerBuilders.ts
```

**Step 2: Verify only intended files are staged**

```bash
git status --short
```
Expected: only the files listed above, all `M` (modified), no unrelated files.

**Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
style(theme): replace dark-blue surface hexes with pure black

Root cause: the Tailwind `blue-*` palette is aliased to grayscale in
tailwind.config.js, so `text-blue-500` already renders as gray. But
inline `style={{}}` hex values bypass Tailwind, and the legacy
"Steel-Blue Dark Theme" scattered navy hex literals throughout inline
styles, CSS backgrounds, and component chrome.

User reported visible blue tint on the LoginPage "INTERNAL USE ONLY"
footer area. Confirmed: LoginPage.tsx:334 used a
`linear-gradient(180deg, #060c14 0%, #0a0a0a 100%)` background where
#060c14 is a dark steel blue (RGB 6, 12, 20).

Fix: enumerate every dark-blue surface hex across client and replace
with neutral blacks that match the CSS surface variables
(--surface-base #0a0a0a, --surface-raised #141414, --surface-sunken
#050505).

Replacements applied:
  #060c14 -> #0a0a0a  (surface base)
  #040810 -> #050505  (surface sunken)
  #0d1520 -> #0a0a0a  (surface base)
  #141e2b -> #141414  (surface raised)
  #1a2636 -> #1a1a1a  (panel raised)
  #0d142a -> #0d0d0d  (surface mid)
  #0e1428 -> #0e0e0e  (surface mid)
  #1a5a9e -> #888888  (brand-blue vestigial, matches --brand-blue CSS var)

Preserved intentionally:
  - #3b82f6 (semantic "enroute" unit status — means something to dispatchers)
  - Tailwind `blue-*` utility class occurrences (already rendered gray via palette override)
  - --brand-blue CSS var name (value already #888888)
  - Semantic status colors: red (error), amber (warning), green (success), purple (2FA)

Also:
  - Updated client/src/index.css header comment from "Steel-Blue Dark Theme" to "Pure Black Dark Theme"
  - Bumped client/public/sw.js CACHE_NAME v153 -> v154 so browsers pick up the visual change

No functional changes. Tested: client typecheck clean, vite build succeeds,
preview screenshot confirms login page reads pure black top-to-bottom.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PART 3 — Deploy + Verify

### Task 3.1: Deploy to production

**Files:** None modified — deploy only.

**Step 1: Pre-deploy sanity checks**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/focused-montalcini"
git status --short       # expect: empty or only `?? server/node_modules`
git log --oneline -5     # expect: Part 1 and Part 2 commits at the top
```

**Step 2: Run deploy**

```bash
bash deploy/deploy.sh 2>&1 | tail -15
```
Expected: "✓ DEPLOY SUCCESSFUL" and systemd shows new PID.

**Step 3: Verify health**

```bash
sleep 3 && curl -s https://rmpgutah.us/api/health | python3 -c "import json,sys; d=json.load(sys.stdin); print('OK' if d.get('status')=='ok' else 'FAIL')"
```
Expected: `OK`.

---

### Task 3.2: Production verification

**Step 1: Verify entry log still fires for timeline edits (regression check)**

```bash
ssh -o StrictHostKeyChecking=no root@194.113.64.90 "journalctl -u rmpg-flex --since '3 minutes ago' --no-pager 2>&1 | grep -iE 'PUT /calls|dispatch.ts|NO_FIELDS' | tail -10"
```
Expected: the Part 1 commit didn't touch the entry log, so it should still be active. If the user triggers a call edit, you should see `[PUT /calls/:id dispatch.ts ENTRY]` lines.

**Step 2: Verify nginx access log shows new successful PUTs**

```bash
ssh -o StrictHostKeyChecking=no root@194.113.64.90 "grep 'PUT /api/dispatch/calls' /var/log/nginx/access.log | tail -5"
```
Expected: recent entries should show `200` or `304` responses (assuming the user edited anything).

**Step 3: Report back**

Summarize for the user:
- Part 1: list of fields added
- Part 2: count of files edited, count of hex values replaced
- Part 3: deploy PID, health OK confirmation, CACHE_NAME bump

Tell the user to hard reload (`Cmd+Shift+R`) and verify:
1. Login page: pure black top to bottom, no blue tint
2. Any page they previously saw blue on: now neutral dark
3. Enroute unit status dots: still blue (semantic blue preserved)

---

## Rollback Plan

Each Part is a single commit, so revert is straightforward:

```bash
# Revert just Part 2 (blue purge) if visuals broke:
git revert <sha-of-part-2>
bash deploy/deploy.sh

# Revert just Part 1 (field audit) if a save regressed:
git revert <sha-of-part-1>
bash deploy/deploy.sh

# Revert both:
git revert <sha-of-part-2> <sha-of-part-1>
bash deploy/deploy.sh
```

Database is untouched by both parts, so there's no data migration concern.

---

## Summary

**3 parts, ~14 atomic tasks, 2 commits, 1 deploy.**

- **Part 1 — Call detail audit (1 commit)**: Add missing destructure entries + addField calls to `server/src/routes/dispatch.ts:445`. Server-only change. ~20-40 lines added.
- **Part 2 — Blue purge (1 commit)**: Replace dark-surface blue hex values across ~14 client files with pure-black equivalents. Preserve semantic `#3b82f6`. Update CSS comment. Bump SW cache. Client-only change. ~50-100 lines modified.
- **Part 3 — Deploy + verify (0 commits)**: `bash deploy/deploy.sh`, health check, production nginx log spot-check.

**No new dependencies. No data migrations. Both parts independently revertible.**
