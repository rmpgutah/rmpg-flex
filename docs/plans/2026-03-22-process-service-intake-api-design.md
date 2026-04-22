# Process Service Intake API — Design Document

**Date**: 2026-03-22
**Status**: Approved

## Purpose

Allow external client-facing websites to submit Process Service (PSO) requests into RMPG Flex via API. Upon submission, a new dispatch call is automatically created with all client and service details pre-populated. Dispatchers see the call appear in real-time.

## Architecture

### Flow

1. Client fills out service request form on external website, completes payment
2. External site POSTs to `POST /api/integrations/service-request` with API key in `X-API-Key` header
3. RMPG Flex validates the key against `integration_api_keys` table (SHA-256 hash lookup)
4. Input is validated and sanitized
5. A new `calls_for_service` record is created with PSO/process service fields populated
6. `broadcast('calls:created', newCall)` fires — dispatchers see it live in CAD
7. Response returns the new call ID and call number to the external site

### Auth Model

- **API Key authentication** (not JWT — external callers don't have user accounts)
- Keys are prefixed `rmpg_ps_` for identification
- Only the SHA-256 hash is stored; plaintext shown once on creation
- Rate limited: 30 requests/minute per API key
- HTTPS required (existing HTTP→HTTPS redirect)

## Data Model

### New Table: `integration_api_keys`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT NOT NULL | Human label ("Client Portal", "Law Firm XYZ") |
| `key_prefix` | TEXT NOT NULL | First 8 chars for display (`rmpg_ps_...`) |
| `key_hash` | TEXT NOT NULL UNIQUE | SHA-256 of full key for auth lookup |
| `is_active` | INTEGER DEFAULT 1 | 1=active, 0=revoked |
| `scopes` | TEXT DEFAULT '["service_request"]' | JSON array of allowed actions |
| `created_by` | INTEGER | FK to users (admin who created it) |
| `last_used_at` | TEXT | Last successful API call |
| `request_count` | INTEGER DEFAULT 0 | Total requests made |
| `created_at` | TEXT | |

### Existing Table: `calls_for_service` (no changes)

Uses existing PSO and process service columns already in schema.

## API Endpoint

### `POST /api/integrations/service-request`

**Headers**: `X-API-Key: rmpg_ps_xxxxxxxxxxxx`

**Request Body**:

```json
{
  "client_name": "Smith & Associates Law Firm",
  "client_phone": "801-555-1234",
  "client_email": "intake@smithlaw.com",
  "billing_code": "PO-2026-0412",
  "authorization": "AUTH-9981",
  "respondent_name": "John Doe",
  "respondent_address": "123 Main St, Salt Lake City, UT 84101",
  "service_type": "subpoena",
  "documents_description": "Civil subpoena for case 2026-CV-00142",
  "case_number": "2026-CV-00142",
  "court": "Third District Court",
  "priority": "P3",
  "rush": false,
  "special_instructions": "Gated community, call 801-555-9999 for gate code"
}
```

**Field Mapping to `calls_for_service`**:

| Incoming Field | DB Column | Notes |
|---------------|-----------|-------|
| (auto) | `incident_type` | Always `"process_service"` |
| (auto) | `source` | Always `"online"` |
| (auto) | `status` | Always `"pending"` |
| (auto) | `pso_service_type` | Always `"process_service"` |
| `client_name` | `pso_requestor_name` | |
| `client_phone` | `pso_requestor_phone` | |
| `client_email` | `pso_requestor_email` | |
| `billing_code` | `pso_billing_code` | |
| `authorization` | `pso_authorization` | |
| `service_type` | `process_service_type` | subpoena, summons, complaint, eviction, restraining_order, other |
| `respondent_name` | `process_served_to` | |
| `respondent_address` | `process_served_address` + `location_address` | |
| `documents_description` | `description` | |
| `special_instructions` | `notes` | |
| `priority` | `priority` | Default P3, validate P1-P4 |
| `case_number` | `case_number` | Via case generation |
| `court` | Appended to `description` | |

**Response (201)**:

```json
{
  "success": true,
  "call_id": 1542,
  "call_number": "26-CFS01542",
  "status": "pending",
  "message": "Service request created and queued for dispatch"
}
```

**Error Responses**:
- `401` — Missing or invalid API key
- `403` — API key revoked or lacks `service_request` scope
- `422` — Validation errors (missing required fields, invalid service_type)
- `429` — Rate limit exceeded

## Admin UI

New **"Integrations"** tab on the Admin page:

### API Keys Panel
- Create new key: enter name → generates key → show full key once (modal with copy button)
- List: name, prefix, status (active/revoked), last used, request count, created date
- Actions: revoke (soft-delete via `is_active = 0`)

### Request Log
- Recent incoming service requests (from audit_logs where entity_type = 'integration_request')
- Columns: timestamp, API key name, respondent, service type, created call number (link), status

## Security

- API keys hashed with SHA-256 before storage
- Rate limiting: 30 requests/minute per key
- Input sanitization via existing `sanitizeInput` middleware
- Audit log entry on every request (success and failure)
- HTTPS enforced in production
- `scopes` field allows future expansion to other integration types
- No dispatcher_id on auto-created calls (null — assigned later by dispatch)

## Files to Create/Modify

### New Files
- `server/src/routes/integrations.ts` — API endpoint + API key management routes
- `server/src/middleware/apiKeyAuth.ts` — API key validation middleware
- `client/src/pages/admin/AdminIntegrationsTab.tsx` — Admin UI tab

### Modified Files
- `server/src/models/database.ts` — Add `integration_api_keys` table
- `server/src/index.ts` — Mount `/api/integrations` routes
- `client/src/pages/AdminPage.tsx` — Add Integrations tab
