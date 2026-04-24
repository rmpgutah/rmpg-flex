# Call Detail Audit + Pure-Black Theme Enforcement — Design

**Date**: 2026-04-10
**Author**: Claude + RMPG
**Status**: Approved — ready for implementation planning
**Scope**: Two independent but related cleanups shipped in one plan

---

## Context

Two user-reported issues arrived together but are unrelated in root cause:

1. **"Fix data entry failures in call details"** — after the timeline timestamp fix shipped at commit `651ef115`, the user still suspects other editable fields on the call detail panel may fail to save. They're unsure which ones, so they asked for an audit of every editable field against the live PUT handler.

2. **"Remove all traces of blue in the UI ensuring a black theme"** — the user reports seeing blue color on the login page "Internal Use" area and "through various areas of the UI on other pages." The Tailwind `blue-*` palette is already aliased to grayscale in `tailwind.config.js`, but **inline `style={{ ... }}` hex values bypass Tailwind**, so any hardcoded `#060c14`-style steel-blue slips through the override undetected.

---

## Part 1 — Call Detail Data Entry Audit

### Background

The live `PUT /api/dispatch/calls/:id` handler lives at `server/src/routes/dispatch.ts:445`. (The modular `server/src/routes/dispatch/calls.ts:939` is shadow code — `server/src/index.ts` imports `./routes/dispatch` which resolves to the `.ts` file over the directory index under tsx's bundler module resolution.)

The handler uses a dynamic SET-clause builder:

```ts
const updates: string[] = [];
const params: any[] = [];
const addField = (col: string, val: any) => {
  if (val !== undefined) { updates.push(`${col} = ?`); params.push(val === '' ? null : val); }
};
```

If `updates.length === 0` after all `addField` calls, the handler returns `400 {"error":"No fields to update"}`. That's the error pattern that bit the timeline timestamps — they weren't in the destructure block at all.

### Known-good after commit `651ef115`

The timeline block at `dispatch.ts:618-660` now handles:
- `received_at`
- `dispatched_at`
- `enroute_at`
- `onscene_at`
- `cleared_at`
- `closed_at`
- `created_at`

These work end-to-end (proven by nginx 200 responses on real user traffic at 17:44:30 UTC).

### Audit target — 5 categories

The plan is to walk each editable field exposed in the client's DispatchPage detail panel, cross-reference against the server handler's destructure + addField calls, and fill any gaps.

#### Category 1: Timeline timestamps (DONE)
Covered by commit `651ef115`. No new work.

#### Category 2: Identity & routing
- `case_number` — in handler
- `incident_number` — **likely missing** (it's a computed field from a subquery, not directly editable)
- `call_number` — probably not editable post-creation
- `caller_name` / `caller_phone` / `caller_address` / `caller_relationship` — in handler

**Audit step:** verify caller_* fields can be saved. If `incident_number` is editable in the UI, check whether it goes through a different endpoint.

#### Category 3: Location
- `location_address` / `cross_street` / `location_building` / `location_floor` / `location_room` — in handler
- `zone_beat` / `section_id` / `zone_id` / `beat_id` — in handler (with auto-resolve logic)
- `latitude` / `longitude` — in handler

**Audit step:** verify that manually editing any location field doesn't get overwritten by the auto-resolve beat/zone/section logic in `dispatch.ts:486-530`.

#### Category 4: Narrative & flags
- `description` / `notes` / `disposition` — in handler
- `priority` — in handler, **possibly case-sensitive mismatch** (client might send `p1` lowercase, handler does `String(priority).toUpperCase()` in the modular version but `addField('priority', priority)` in the monolith — could accept lowercase and break the DB CHECK constraint)
- `status` — in handler with CHECK validation
- 20+ boolean flags (`weapons_involved`, `mental_health_crisis`, etc.) — in handler

**Audit step:** verify priority is normalized to uppercase. Verify boolean flags round-trip correctly (handler converts to `? 1 : 0` but some paths might send `true`/`false` and get stored as JSON strings).

#### Category 5: PSO / Process Service
- `pso_service_type` / `pso_authorization` / `pso_requestor_name` / `pso_requestor_phone` / `pso_requestor_email` / `pso_billing_code` — in handler
- `pso_attempt_number` — **possibly missing** (in modular handler but not in monolith destructure — line 454-477 of dispatch.ts lists pso fields but not pso_attempt_number)
- `process_service_type` / `process_served_to` / `process_served_address` — in handler
- `process_attempts` / `process_served_at` / `process_service_result` — **possibly missing** (same pattern — in modular but not monolith)
- `contract_id` — **possibly missing** in monolith

**Audit step:** confirm the 4-5 fields above are missing from the monolith destructure. Add them if so.

### Audit methodology

For each field, the audit script:

1. Read `dispatch.ts:454-477` destructure block — if field is not present, it's dropped silently
2. Read `dispatch.ts:543-620` addField calls — if field has a destructure entry but no addField, the value is received but never written
3. Cross-reference against `client/src/pages/dispatch/DispatchPage.tsx` input bindings — grep for `selectedCall\.<field>` and edit handlers that POST/PUT to the call endpoint
4. For any gap, write a single-line `addField('<field>', <value>);` insertion

### Out of scope

- **POST /calls/:id/status, /calls/:id/dispatch, /calls/:id/assign-unit, etc.** — separate endpoints with their own logic. User asked about call details edits, not dispatch workflow actions.
- **Timeline entry CRUD (`/calls/:id/timeline/:entryId`)** — that's the activity log edit, different endpoint in `callLifecycle.ts`, already scoped.
- **Dedup with `dispatch/calls.ts`** — shadow route cleanup is a separate tech debt task the user declined today.

### Success criteria

- Zero `No fields to update` errors when editing any exposed call detail field
- Nginx access log shows 200 responses for all category 2-5 field edits after the audit
- No new TypeScript errors introduced
- No regression in the timeline timestamp path (verified by repeating the `dispatched_at` edit test)

---

## Part 2 — Pure-Black Theme Enforcement (Blue Purge)

### Background

The current runtime state is **already nearly pure black**:
- `client/tailwind.config.js` overrides the Tailwind `blue-*` palette to grayscale (`#111 → #f5f5f5`), so `text-blue-500` renders as `#888` at runtime
- `client/src/index.css` defines `--brand-blue: #888888` (gray masquerading under a blue-named variable)
- Surface colors are already pure black (`--surface-base: #0a0a0a`, `--surface-raised: #141414`, `--surface-sunken: #050505`)

**But** the user reports visible blue. The hunt narrows to:

1. **Hardcoded hex values in inline `style={{}}` props** — Tailwind palette override does not reach these
2. **Hex values in raw CSS declarations** in `index.css` that use `#` literals instead of `var(--...)`
3. **SVG `fill=` attributes** in icon components or inline SVG markup
4. **Linear gradients with blue stops** — especially backgrounds

### Confirmed live blue

`client/src/pages/LoginPage.tsx:334`:

```jsx
<div
  className="min-h-screen flex flex-col items-center justify-center p-4 relative"
  style={{ background: 'linear-gradient(180deg, #060c14 0%, #0a0a0a 100%)' }}
>
```

`#060c14` = RGB (6, 12, 20). Blue channel dominant. The gradient goes from navy-black at the top to pure black at the bottom. The "INTERNAL USE ONLY" text at the bottom of the page inherits this background and picks up the blue tint visibly.

### Audit strategy — targeted grep + visual verification

**Phase A — Hex audit**

Regex to find dark-blue-dominant hex values (blue channel ≥ 2x the red/green channels AND overall darkness < 0x30):

```
#0[0-5][0-9a-f]{2}[12][0-9a-f]
```

This catches `#060c14`, `#0a0e18`, `#0d1520`, `#0e1428`, etc. — anything where the first two hex digits (red) are 0x00-0x05 and the last two (blue) are 0x10-0x1f. Tuned to catch real theme colors without false positives on pure black (`#000` / `#0a0a0a` are excluded because their blue channel is <= 0x0a).

Initial run found 8 files. Expected files (from earlier grep):
- `client/src/index.css`
- `client/src/pages/LoginPage.tsx` (the confirmed one)
- `client/src/pages/admin/ai/AI*.tsx` (6 files — the AI admin panels)

**Phase B — Replace with neutral darks**

For each hit, replace with a pure-black equivalent matching the surrounding aesthetic:

| Original (blue-tinted) | Replacement (neutral) |
|---|---|
| `#060c14`, `#0a0e18` | `#0a0a0a` (var-surface-base) |
| `#0d1520`, `#0e1428` | `#0d0d0d` |
| `#141e2b`, `#1a2636` | `#141414` (var-surface-raised) |
| `#1a5a9e`, `#3b82f6` (bright blue) | `#888888` (var-brand-blue, already gray) |

**Phase C — Gradients**

Grep for `linear-gradient` and `radial-gradient` in both `.tsx` and `.css`. Any gradient with a blue-tinted stop gets its blue stop replaced with the neutral equivalent from the table above.

**Phase D — Header comment**

Update `client/src/index.css:7-9` from:
```
/* RMPG Flex - Custom Styles
   Spillman Flex / Motorola Solutions — Steel-Blue Dark Theme
   Motorola blue + gold accents on steel-blue-tinted dark console
   ============================================================ */
```
to:
```
/* RMPG Flex - Custom Styles
   Spillman Flex / Motorola Solutions — Pure Black Dark Theme
   Gray + gold accents on a pure-black console
   ============================================================ */
```

**Phase E — Visual verification**

For each edited page/component, capture a screenshot via `preview_screenshot` on the running dev server. Spot check:
- Login page (`/login`) — the "Internal Use" area should now read pure black background with no navy tint
- Admin AI panels (`/admin?tab=ai_settings` and subpanels) — expected to still render distinct panel chrome, just in neutral dark
- Dispatch page (`/dispatch`) — sanity check that the operational view didn't lose contrast

### What is explicitly out of scope

- **Do NOT rename** `--brand-blue` → `--brand-accent`. It's already gray, renaming breaks every reference for zero user benefit
- **Do NOT remove** the Tailwind `blue-*` palette override in `tailwind.config.js`. It's the safety net that makes `text-blue-500` already render as gray — removing it would regress the 16 existing direct blue class usages
- **Do NOT touch** the 16 literal `text-blue-*` / `bg-blue-*` / `border-blue-*` class occurrences. They render as gray at runtime. Cleaning them up is cosmetic and adds risk
- **Do NOT re-theme semantic status colors**: red (error), amber (warning), green (success), purple (2FA). These aren't blue and weren't asked about
- **Do NOT modify SVG files or raster assets**. If the RMPG logo has blue in it, that's the logo, not a theme value

### Success criteria

- The confirmed `#060c14` on `LoginPage.tsx:334` is replaced and the login page renders as pure black top-to-bottom
- Zero matches for the dark-blue regex pattern across `client/src/**/*.tsx` and `client/src/**/*.css`
- Header comment in `index.css` updated
- Vite build still succeeds
- No TypeScript errors introduced
- Visual spot check on 3 pages (login, admin AI, dispatch) shows no perceptible blue tint

---

## Phased delivery

Both parts ship in one branch, two commits (one per part), one deploy.

### Phase 1: Call detail audit
Single commit that adds any missing destructure entries + addField calls to `server/src/routes/dispatch.ts`. Touches one file. Reversible. Estimated ~20-40 lines of additions.

### Phase 2: Blue purge
Single commit that edits inline styles + CSS across ~8 files. Touches no server code. Reversible. Estimated ~10-20 hex value replacements + 1 comment update.

### Deploy
`bash deploy/deploy.sh` — code-only deploy. The SW cache gets bumped (v153 → v154) in the same commit as phase 2 so browsers pick up the visual change.

### Verification chain
1. `cd server && npx tsc --noEmit` — 0 new errors
2. `cd client && npx tsc --noEmit` — 0 new errors
3. `cd client && npx vite build` — succeeds
4. Deploy
5. `curl -sf https://rmpgutah.us/api/health` — returns `{"status":"ok"}`
6. Visual spot check the login page via `preview_screenshot`
7. Sanity check a call detail edit (any field) to verify the audit didn't break anything

---

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Audit adds a field that the client never sends, causing dead code | High | Low | Additive changes, no behavior change when field is absent (addField short-circuits on `undefined`) |
| Hex replacement makes a UI element too dark to read | Medium | Low | Visual verification step catches it; revert single hex and replace with `#141414` instead of `#0a0a0a` |
| Hex replacement hits a legitimate business color (e.g. a water/flood map layer that's intentionally blue) | Low | Medium | Regex is narrow and tuned to dark theme colors; manual review of each match before replacing |
| Shadow-route trap strikes again — I edit `dispatch.ts` but the server is somehow loading a different file | Very low | High | Entry log at the top of the handler still fires (left in place from commit `651ef115`) to confirm which handler runs |
| The timeline fix regresses because I touch `dispatch.ts` again | Low | Medium | Timeline tests re-run manually after audit by editing a timestamp in the UI; diff review before commit confirms the timeline block at lines 618-660 is untouched |

---

## Open questions (to resolve during implementation, not blockers)

1. Should I also audit the `POST /dispatch/calls/:id/notes` and `POST /dispatch/calls/:id/persons` endpoints? User said "call details" which is ambiguous between the basic PUT and the nested POSTs. **Default: stick to PUT only, surface the question in the commit message.**
2. If I find a bright-blue hex like `#1a5a9e` outside the admin AI panels, is it safe to replace? **Default: yes, replace with `#888888`; user explicitly said "all traces of blue."**
3. The SW cache has been bumped twice this session (v151 → v152 → v153). Bump to v154 or v155? **Default: v154, monotonically increasing.**
