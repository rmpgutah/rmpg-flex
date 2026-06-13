# Dispatch Linkage Expansion & Client-Data Autofill — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming) — pending implementation plan
**Platforms:** Web (Mac/Windows browser + Electron), Backend Worker (`rmpg-flex`)

## Problem

The Call-For-Service (CFS) edit screen's **Persons / Vehicles** tab and the
**Caller** block let dispatchers attach records and label relationships, but the
option lists are narrow, hardcoded, and duplicated — while the data model already
carries richer connections the UI can't create:

- **Person-link roles** are 6 hardcoded `<option>`s
  ([`DispatchPage.tsx:4770`](../../../client/src/pages/dispatch/DispatchPage.tsx)):
  suspect, victim, witness, reporting_party, involved, other. Yet `call_persons.role`
  already stores `serve_recipient`, `serve_recipient_agent` (auto-created by serve-intake,
  [`serveIntakeRecords.ts:842`](../../../src/utils/serveIntakeRecords.ts)) and `mentioned`
  (narrative extraction, [`intel.ts:287`](../../../src/routes/intel.ts)). Those roles
  *display* (humanized) but **cannot be selected by hand** — that is the
  "INVOLVED / MENTIONED / SERVE RECIPIENT AGENT" mix in the screenshots.
- **Caller relationship** is 9 hardcoded options
  ([`DispatchPage.tsx:4268`](../../../client/src/pages/dispatch/DispatchPage.tsx)),
  duplicated as `CALLER_RELATIONSHIPS` in `NewCallModal.tsx`. Process-service callers
  (registered agent, attorney, plaintiff/defendant, property manager) have no fitting label.
- **Businesses cannot be linked to a call from dispatch.** The `call_businesses` junction
  table exists ([`0023_business_records.sql:102`](../../../migrations/0023_business_records.sql))
  and the serve-intake scanner writes to it, but there is **no link endpoint and no UI**.
- **Selecting a Client does not autofill anything** in the main CFS edit form
  ([`DispatchPage.tsx:4182`](../../../client/src/pages/dispatch/DispatchPage.tsx) sets
  `client_id` only). Only `QuickPsoModal` autofills (requestor name/phone/location), and only
  on new-call creation.

Net effect: dispatchers re-type client contact data already on file, and cannot express the
process-service connection graph (who was served, by which agent, for which client/contract)
that the records side already understands.

## Goal

Expand dispatch linkage and wire client-data autofill, specifically:

1. **Admin-configurable option lists** (person roles, vehicle roles, caller relationships,
   business roles) — DB-driven, layered over hardcoded defaults.
2. **Expanded default roles** so process-service connections (serve recipient, agent,
   registered/authorized agent, plaintiff, defendant, attorney, process server, client contact,
   mentioned, complainant) are selectable by hand for the first time.
3. **Link Businesses/Orgs to calls** — surface the existing `call_businesses` model with
   endpoints + a "Linked Businesses" UI block.
4. **Client-data autofill (fill-blanks-only)** when a client is selected on a call.
5. **Contract/Client as a first-class link** — a CLIENT chip carrying contract / billing /
   authorization context into the Process Service panel.

### Decisions made during brainstorming

- **Scope = all four capability areas** (expand roles, link businesses, richer caller
  relationship, contract/client link).
- **Autofill semantics = fill-blanks-only.** Never overwrite a value a dispatcher has typed.
- **Option storage = admin-configurable (DB-driven)**, implemented as **a dedicated
  `link_options` table layered over hardcoded defaults, merged at render** — *not*
  `system_config`, *not* pure-DB. This mirrors the proven `DEFAULT_DISPOSITION_CODES` + custom-codes
  pattern and sidesteps the live `system_config` schema landmine (`config_key`/`config_value`
  vs `key`/`value`; UNIQUE on `(key,value)`).
- **Delivery = one PR**, layers sequenced (foundation → dropdowns → businesses → autofill →
  chip → admin editor), off `origin/main`. Splitting would ship a half-wired foundation.

## Non-Goals

- No change to the `calls_for_service` / `calls_for_service_ext` column set — all caller,
  PSO, and process-service columns already exist (confirmed via the existing
  `UPDATABLE_CALL_COLUMNS_BASE`/`_EXT` lists in `calls.ts`). **No `ALTER` on
  `calls_for_service`** (it is at the D1 100-column cap).
- No removal or renaming of any existing role/relationship value already stored on records;
  expansion is additive. Hidden/relabeled options still humanize-render saved values.
- No fuzzy matching, no reordering of existing linked-record lists.
- No new client/contract CRUD — clients are read for autofill; editing clients stays in Admin.
- No iOS work this pass (server endpoints are iOS-safe but no field-app UI is built here).

## Architecture

```
  OPTION SOURCE (layer 1 — underpins roles + caller relationship)
  ┌─────────────────────────────────────────────────────────────────────┐
  │ DB: link_options (category,value,label,sort_order,is_active,         │
  │                    is_default)                                        │
  │ Worker: GET /api/dispatch/link-options  → all categories             │
  │         /api/admin/link-options  CRUD (admin/manager)                 │
  │ Client: constants/linkOptions.ts  (hardcoded DEFAULTS)               │
  │         hooks/useLinkOptions.ts   (fetch + merge-over-defaults +      │
  │                                     cache; never empty on failure)    │
  └─────────────────────────────────────────────────────────────────────┘
        │ person_role        │ vehicle_role     │ caller_relationship  │ business_role
        ▼                    ▼                  ▼                       ▼
  Linked Persons       Linked Vehicles    Caller block            Linked Businesses (NEW)
  (DispatchPage,       (DispatchPage)     (DispatchPage,          (DispatchPage +
   LinkPersonModal)                        NewCallModal)            callLinks.ts endpoints)

  CLIENT INTEGRATION (layer 2)
  ┌─────────────────────────────────────────────────────────────────────┐
  │ On client_id change → lazy GET /clients/:id (cached) →               │
  │   autofillFromClient(client, editData)  [fill-blanks-only]           │
  │ CLIENT chip in PSO/Process-Service panel (contract/billing/auth)     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Merge semantics (client `useLinkOptions`)

Start from hardcoded `DEFAULTS[category]`. Apply DB rows:
- DB row matching an existing `value` → overrides `label`/`sort_order`; `is_active=0` hides it.
- DB row with a new `value` → appended as a custom option.
- Sort by `sort_order`, then label.
- A value saved on a record but absent/hidden in options still renders via the existing
  `role.replace(/_/g,' ')` humanizer (no "unknown option" gaps).
- If the fetch fails or returns empty, defaults stand alone → **dropdowns are never empty.**

## Components

### 1. `link_options` table + seed (migration)
Next free prefix under `migrations/` (check `ls migrations | tail`; high-water ~0100+).
Idempotent `CREATE TABLE IF NOT EXISTS`. Seed all default rows with `is_default=1`,
`is_active=1`, `sort_order` spaced by 10. **Must be applied directly to live D1
(`785de7ae-…`)** per the migration-drift workflow (deploy step is `continue-on-error`);
verify with `pragma_table_info('link_options')`.

```sql
CREATE TABLE IF NOT EXISTS link_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,           -- person_role | vehicle_role | caller_relationship | business_role
  value TEXT NOT NULL,              -- slug, e.g. 'serve_recipient_agent'
  label TEXT NOT NULL,              -- display, e.g. 'Serve Recipient Agent'
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  UNIQUE(category, value)
);
CREATE INDEX IF NOT EXISTS idx_link_options_cat ON link_options(category, is_active, sort_order);
```

### 2. Default option sets (`client/src/constants/linkOptions.ts`)
Single source of truth for baseline options; the migration seed is generated to match it.
- **person_role:** suspect, victim, witness, reporting_party, involved, complainant,
  serve_recipient, serve_recipient_agent, registered_agent, authorized_agent, plaintiff,
  defendant, attorney, process_server, client_contact, mentioned, other
- **vehicle_role:** suspect_vehicle, victim_vehicle, witness_vehicle, involved, evidence,
  towed, recovered, other
- **caller_relationship:** employee, victim, witness, complainant, management, alarm_company,
  officer, anonymous, registered_agent, attorney, plaintiff, defendant, property_manager,
  tenant, client, guard_on_duty, third_party, automated_system, neighbor, family_member, other
- **business_role:** served_business, client_org, alarm_company, property, employer,
  registered_agent_entity, involved, other

### 3. Worker endpoints
- `GET /api/dispatch/link-options` (auth) → `{ person_role:[…], vehicle_role:[…],
  caller_relationship:[…], business_role:[…] }`, active rows only, sorted. Used by the client hook.
- `/api/admin/link-options` CRUD (admin/manager gated, audited):
  `GET` (incl. inactive, for the editor), `POST` (add custom), `PATCH /:id`
  (label/sort/active), `DELETE /:id` (block when `is_default=1` → set `is_active=0` instead).

### 4. Client option hook + dropdown swap
`useLinkOptions()` fetches once, merges, caches (module-level / SWR-style). Replace the inline
hardcoded `<option>` blocks at:
- `DispatchPage.tsx` person-role (4770), vehicle-role (4821), caller-relationship (4268)
- `LinkPersonModal.tsx` `PERSON_ROLES` (shared component)
- `NewCallModal.tsx` `CALLER_RELATIONSHIPS`
Each maps `options[category]` → `<option value label>`. Behavior identical when DB empty.

### 5. Linked Businesses (backend + UI)
**Backend** (`src/routes/dispatch/callLinks.ts`, mirroring persons/vehicles):
- `GET /dispatch/calls/:id/businesses` (join `businesses`)
- `POST /dispatch/calls/:id/businesses` `{ business_id, role?, notes? }`
- `DELETE /dispatch/calls/:id/businesses/:linkId`
- `PATCH /dispatch/calls/:id/businesses/:linkId` `{ role?, notes? }`
- `POST /dispatch/calls/:id/businesses/quick-add` `{ name, address?, phone?, role? }`
- Business search: reuse `/records/businesses/search` if present, else add a minimal search.

**UI** (`DispatchPage.tsx`, Persons/Vehicles tab, new block after Linked Vehicles): state
`callBusinesses`, `linkBusinessRole`; `fetch/link/unlink` mirroring `callPersons`; role dropdown
from `business_role`; search-to-link + "Create New Business". Chips show name + role badge.

### 6. Client-data autofill (fill-blanks-only)
On `client_id` change in the edit form, lazily `GET /clients/:id` (cached per id) and run
`autofillFromClient(client, editData)`. The field-mapping is the one genuine business decision
and is **deferred to the user as a scaffolded contribution** — signature and call site are
prepared; the user fills the mapping body:

```ts
// client/src/utils/clientAutofill.ts
/**
 * Map a Client record onto CFS edit fields, FILLING BLANKS ONLY.
 * Return a partial patch; caller applies it without overwriting non-empty fields.
 * Candidate mappings: contact_name→caller_name/pso_requestor_name,
 *   contact_phone→caller_phone/pso_requestor_phone, contact_email→pso_requestor_email,
 *   address→caller_address, client_code→pso_billing_code, active contract→contract_id,
 *   a sensible default caller_relationship (e.g. 'client').
 */
export function autofillFromClient(client: ClientRecord, current: EditData): Partial<EditData> {
  // TODO(user): define exactly which client fields map to which call fields.
}
```
The apply step is generic: `for (k,v) of patch) if (!current[k]) set(k,v)`. The slim
`/admin/clients` list fetch is enriched (or the lazy `/clients/:id` is used) so
`contact_email` / billing fields are available.

### 7. Contract/Client link chip
In the PSO / Process-Service panel header, a "CLIENT" chip when `client_id` is set, showing
client name + `contract_id` + `pso_billing_code` + `pso_authorization`. Optional: on autofill,
auto-link the client's `businesses` record (if one exists) as `business_role='client_org'`.

### 8. Admin "Linkage Options" editor
New tab/section in `AdminPage.tsx`: a category selector + editable list (toggle active, edit
label, reorder via `sort_order`, add custom value+label). Calls `/api/admin/link-options`.
Defaults are protected (no hard delete; hide instead).

## Data flow

1. App/edit-form mount → `useLinkOptions()` → `GET /dispatch/link-options` → merge over defaults.
2. Dispatcher opens a call's Persons/Vehicles tab → role dropdowns render merged options.
3. Dispatcher selects a Client → lazy `GET /clients/:id` → `autofillFromClient` → fill-blanks
   patch applied to `editData` → CLIENT chip renders with contract/billing/auth.
4. Dispatcher links a person/vehicle/**business** with a chosen role → existing/new endpoints
   write `call_persons` / `call_vehicles` / `call_businesses`.
5. Admin edits options → `/api/admin/link-options` → next `useLinkOptions` fetch reflects changes.

## Error handling

- `GET /link-options` failure or empty → hook returns hardcoded defaults (logged once, dropdowns
  unaffected).
- `GET /clients/:id` failure → no autofill, no chip; manual entry unaffected (silent for the
  user, `console.error` for devs).
- Business link/quick-add failures mirror the persons flow (toast + no state mutation); duplicate
  links rejected by `UNIQUE(call_id,business_id,role)`.
- Admin delete of a default → 409/blocked with a clear message; UI offers "hide" instead.

## Testing

- **Worker:** typecheck (`npm run typecheck`). Manual/curl-via-browser checks of
  `/dispatch/link-options`, the business link endpoints, and `/admin/link-options` CRUD against
  live D1 after applying the migration (WAF blocks bare curl — use the logged-in browser or
  D1 API).
- **Client:** `cd client && npx tsc --noEmit` + `npx vitest run`. Add unit tests for
  `useLinkOptions` merge logic (override, append, hide, empty-fetch fallback) and
  `autofillFromClient` fill-blanks behavior (never overwrites non-empty).
- **Build:** `npx vite build`. **Bump `CACHE_NAME` in `client/public/sw.js`** (client change).

## Build sequence

1. `link_options` migration + seed (apply to live D1; verify `pragma_table_info`).
2. Worker: `GET /dispatch/link-options` + `/admin/link-options` CRUD.
3. Client: `constants/linkOptions.ts` defaults + `useLinkOptions` hook + dropdown swap across
   DispatchPage / LinkPersonModal / NewCallModal.
4. Linked Businesses: `callLinks.ts` endpoints + DispatchPage UI block.
5. Client autofill: lazy client fetch + `autofillFromClient` (user-authored mapping) + apply.
6. Contract/Client chip in PSO panel.
7. Admin "Linkage Options" editor.
8. SW bump, typecheck, vitest, build; PR off `origin/main`.

## Open question for the user (implementation-time)

The `autofillFromClient` field mapping (§6) — exactly which client fields populate which call
fields, and the default `caller_relationship` to apply — is left for the user to author.
