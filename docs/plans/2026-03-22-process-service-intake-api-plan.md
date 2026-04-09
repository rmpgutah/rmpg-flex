# Process Service Intake API — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow external client websites to POST process service requests into RMPG Flex, automatically creating dispatch calls visible to dispatchers in real-time.

**Architecture:** Single inbound API endpoint authenticated by API key (SHA-256 hashed, stored in new `integration_api_keys` table). Maps incoming service request fields to existing `calls_for_service` PSO/process columns. Admin UI tab for key management and request logging.

**Tech Stack:** Express route + SHA-256 hashing + existing `generateCallNumber`/`broadcast` utilities. React admin tab following existing tab pattern.

**Design Doc:** `docs/plans/2026-03-22-process-service-intake-api-design.md`

---

### Task 1: Database Table — `integration_api_keys`

**Files:**
- Modify: `server/src/models/database.ts` (add table creation near migration section)

**Step 1: Add table creation to database.ts**

Find the migration section (near the bottom where `addCol()` calls live) and add the `integration_api_keys` table:

```sql
CREATE TABLE IF NOT EXISTS integration_api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  scopes TEXT NOT NULL DEFAULT '["service_request"]',
  created_by INTEGER,
  last_used_at TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
```

**Step 2: Verify the server starts without errors**

Run: `cd server && npx tsx src/index.ts` (start and Ctrl+C after "listening" message)
Expected: No SQLite errors, table created successfully.

**Step 3: Commit**

```
git add server/src/models/database.ts
git commit -m "feat: add integration_api_keys table for external API access"
```

---

### Task 2: API Key Auth Middleware

**Files:**
- Create: `server/src/middleware/apiKeyAuth.ts`

**Step 1: Create the middleware**

The middleware:
- Reads `X-API-Key` from request headers
- SHA-256 hashes it and looks up the hash in `integration_api_keys`
- Validates the key is active and has the required scope
- Updates `last_used_at` and `request_count`
- Attaches `apiKeyId` and `apiKeyName` to `req` for audit logging
- Returns 401 for missing/invalid key, 403 for revoked/wrong scope

Use `crypto.createHash('sha256')` for hashing. Import `db` from `../models/database`.

**Step 2: Commit**

```
git add server/src/middleware/apiKeyAuth.ts
git commit -m "feat: add API key authentication middleware for integrations"
```

---

### Task 3: Integration Routes — Service Request Endpoint + Key Management

**Files:**
- Create: `server/src/routes/integrations.ts`

**Step 1: Create the route file with two sections**

**Section A — Public endpoint (API key auth):**

`POST /service-request`
- Auth: `authenticateApiKey('service_request')` middleware
- Rate limit: 30 requests/minute per API key ID
- Validates required fields: `respondent_name`, `respondent_address`, `service_type`
- Validates `service_type` is one of: subpoena, summons, complaint, eviction, restraining_order, other
- Validates `priority` is P1-P4 (defaults to P3, or P2 if `rush` is true)
- Builds description from `documents_description` + `court` + `case_number`
- Generates call number via `generateCallNumber(db)` and case number via `generateCaseNumber(db, 'civil_process')`
- Inserts into `calls_for_service` with field mapping:
  - `incident_type` = `'process_service'`
  - `source` = `'online'`
  - `status` = `'pending'`
  - `pso_service_type` = `'process_service'`
  - `pso_requestor_name` = `client_name`
  - `pso_requestor_phone` = `client_phone`
  - `pso_requestor_email` = `client_email`
  - `pso_billing_code` = `billing_code`
  - `pso_authorization` = `authorization`
  - `process_service_type` = `service_type`
  - `process_served_to` = `respondent_name`
  - `process_served_address` = `respondent_address`
  - `location_address` = `respondent_address`
  - `description` = built description
  - `notes` = `special_instructions`
- Broadcasts `'calls:created'` via `broadcastDispatchUpdate`
- Audit logs with `entity_type = 'integration_service_request'`
- Returns 201 with `{ success, call_id, call_number, case_number, status, message }`

**Section B — Admin endpoints (JWT auth, admin/manager role):**

All prefixed with `/keys` and guarded by `authenticateToken` + `requireRole(['admin', 'manager'])`.

- `GET /keys` — List all API keys (join with users for created_by_name), never expose hashes
- `POST /keys` — Create new key: generate `rmpg_ps_` + 32 random hex bytes, store SHA-256 hash, return full key ONCE
- `PATCH /keys/:id/revoke` — Set `is_active = 0`
- `PATCH /keys/:id/activate` — Set `is_active = 1`
- `DELETE /keys/:id` — Permanent delete
- `GET /request-log` — Query audit_logs where `entity_type = 'integration_service_request'`, limit 100

**Step 2: Commit**

```
git add server/src/routes/integrations.ts
git commit -m "feat: add integrations route with service request endpoint and key management"
```

---

### Task 4: Mount the Integration Routes

**Files:**
- Modify: `server/src/index.ts`

**Step 1: Add import near line 109**

```typescript
import integrationRoutes from './routes/integrations';
```

**Step 2: Mount the route near line 470 (after other app.use calls)**

```typescript
app.use('/api/integrations', integrationRoutes);
```

**Step 3: Commit**

```
git add server/src/index.ts
git commit -m "feat: mount /api/integrations route"
```

---

### Task 5: Admin Integrations Tab (Frontend)

**Files:**
- Create: `client/src/pages/admin/AdminIntegrationsTab.tsx`

**Step 1: Create the admin tab component**

Follow the same pattern as `AdminServeManagerTab`:
- Props: `{ LoadingSpinner: React.FC; error: string | null; setError: (e: string | null) => void }`
- Uses `apiFetch()` from `../../hooks/useApi`
- Dark theme: `panel-beveled`, `bg-surface-base`, `border-[#1c2e42]`, `text-rmpg-*` colors
- Lucide icons: `Key`, `Plus`, `Trash2`, `ToggleLeft`, `ToggleRight`, `Copy`, `Clock`, `Activity`, `Shield`

**UI Sections:**

1. **API Keys panel** — Table with columns: Name, Key Prefix, Status (active/revoked badge), Last Used, Requests, Created, Actions (revoke/activate/delete buttons). "Create API Key" button in header.

2. **Create Key modal** — Simple modal with name input. On submit, POST to `/api/integrations/keys`. Display the returned full API key in a highlighted box with copy button. Warning: "Save this key now — it cannot be retrieved again."

3. **Request Log panel** — Table showing recent inbound service requests. Columns: Time, API Key, Respondent, Service Type, Call # (parsed from audit log new_data JSON), Status. Fetched from `GET /api/integrations/request-log`.

**Step 2: Commit**

```
git add client/src/pages/admin/AdminIntegrationsTab.tsx
git commit -m "feat: add AdminIntegrationsTab for API key management UI"
```

---

### Task 6: Wire Tab into AdminPage

**Files:**
- Modify: `client/src/pages/AdminPage.tsx`

**Step 1: Add import (near line 62)**

```typescript
import AdminIntegrationsTab from './admin/AdminIntegrationsTab';
```

**Step 2: Add 'integrations' to TabId type (line 227)**

Add `| 'integrations'` to the union type.

**Step 3: Add to VALID_TABS array (line 241)**

Add `'integrations'` to the array.

**Step 4: Add tab entry to tabGroups (line 646, Integrations category)**

```typescript
{ id: 'integrations', label: 'API Integrations', icon: Plug },
```

Import `Plug` from `lucide-react`.

**Step 5: Add tab render block (after last activeTab block, ~line 975)**

```tsx
{activeTab === 'integrations' && (
  <AdminIntegrationsTab
    LoadingSpinner={LoadingSpinner}
    error={error}
    setError={setError}
  />
)}
```

**Step 6: Commit**

```
git add client/src/pages/AdminPage.tsx
git commit -m "feat: wire AdminIntegrationsTab into admin page"
```

---

### Task 7: Verify End-to-End

**Step 1: Start the dev server**

Run: `npm run dev`

**Step 2: Verify admin UI**

Navigate to Admin page, click "API Integrations" tab. Confirm it loads without errors.

**Step 3: Create an API key**

Click "Create API Key", enter name "Test Portal", confirm key is shown.

**Step 4: Test the endpoint with curl**

```
curl -X POST http://localhost:3001/api/integrations/service-request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <key-from-step-3>" \
  -d '{"client_name":"Test Law Firm","client_phone":"801-555-0000","respondent_name":"Jane Doe","respondent_address":"456 State St, Salt Lake City, UT 84111","service_type":"subpoena","documents_description":"Test subpoena","priority":"P3"}'
```

Expected: 201 with call_id and call_number.

**Step 5: Verify dispatch**

Open Dispatch page — new call should appear with type "process_service".

**Step 6: Verify request log**

Admin → API Integrations → Request Log should show the test request.
