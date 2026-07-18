# R2 presigned direct-upload — design spec

Date: 2026-07-18
Status: approved (pending user spec review)

## Background / problem

The general attachment uploader (`POST /api/uploads` in
[`src/routes/uploads.ts`](../../../src/routes/uploads.ts)) — the endpoint behind
`apiUploadFiles`/`apiUploadFilesWithProgress` in `client/src/hooks/useApi.ts`,
which backs `FileAttachments.tsx` and every page that attaches files to a
record — buffers the entire file into Worker memory via `file.arrayBuffer()`
before writing it to R2. The route's declared ceiling is 500 MB, but a
Workers isolate has roughly 128 MB of memory, so any file past that size
fails today. (Body-cam video already avoids this with its own
chunked-multipart-through-Worker flow in `bodyCameraUploads.ts` and needs no
changes.)

Separately, `system-essentials` (bound as `MAP_DATA`) — map overlays and
PMTiles tile archives served by `src/routes/mapData.ts` / `src/routes/tiles.ts`
— has **no upload path in the app at all**. It's read-only from the Worker's
perspective (grep confirms zero `.put()` calls); new map data evidently gets
pushed some other way today (CLI/dashboard) rather than through the app.

Both problems share a fix: sign S3-compatible presigned PUT URLs (via the R2
S3 API endpoints the operator provided) so the browser uploads bytes straight
to R2, bypassing the Worker's memory/CPU entirely.

- Attachments bucket: `rmpg-flex-uploads` (binding `UPLOADS`) — dashboard
  `https://dash.cloudflare.com/5caa95c5789f4fc4ed3934b2a2c29ed4/r2/default/buckets/rmpg-flex-uploads/settings`,
  S3 endpoint `https://5caa95c5789f4fc4ed3934b2a2c29ed4.r2.cloudflarestorage.com/rmpg-flex-uploads`.
- Map-data bucket: `system-essentials` (binding `MAP_DATA`) — dashboard
  `https://dash.cloudflare.com/5caa95c5789f4fc4ed3934b2a2c29ed4/r2/default/buckets/system-essentials/settings`,
  S3 endpoint `https://5caa95c5789f4fc4ed3934b2a2c29ed4.r2.cloudflarestorage.com/system-essentials`.
- Account ID `5caa95c5789f4fc4ed3934b2a2c29ed4` (from the endpoint hosts) is
  not secret — it goes in `wrangler.toml` as a plain var.

## Goals

- Let the browser upload large attachment files directly to R2 instead of
  proxying the full body through the Worker.
- Give an admin a way to push map overlay / PMTiles files into
  `system-essentials` from the app instead of `wrangler`/dashboard.
- Reuse one shared presigned-URL signer for both buckets/features.
- Keep the existing small-file path (`POST /api/uploads`) and body-cam's
  chunked-multipart path completely unchanged.

## Non-goals

- Presigned **multipart** upload (multi-GB single objects). Single-PUT
  presign covers every realistic attachment and map-file size today; if a
  multi-GB file shows up later, that's a follow-up.
- A generic "browse the map-data bucket" file manager beyond list/upload/delete.
- Any change to body-cam video upload, which already has a working
  chunked-through-Worker flow.
- Automatic cleanup of orphaned R2 objects from abandoned presigned uploads
  (client requested a presign, never actually PUT, or PUT succeeded but the
  browser closed before calling back). Matches the existing accepted
  tradeoff for aborted body-cam multipart uploads — a future sweep, not
  built now.

## Design

### 1. Operator setup (outside this spec's code changes)

1. In the R2 bucket settings page, create **one R2 API token** scoped to
   both `rmpg-flex-uploads` and `system-essentials` with Object Read & Write.
   Copy the Access Key ID + Secret Access Key it shows once.
2. Set them as Worker secrets from a terminal — **not** pasted into chat —
   `wrangler secret put R2_ACCESS_KEY_ID` and
   `wrangler secret put R2_SECRET_ACCESS_KEY`. Per this repo's own incident
   history (the Legal Data Hunter key that had to be rotated after appearing
   in chat text, documented in `CLAUDE.md`), no credential value is ever
   pasted into the conversation.
3. `R2_ACCOUNT_ID = "5caa95c5789f4fc4ed3934b2a2c29ed4"` added to
   `wrangler.toml` `[vars]` (not secret).
4. CORS: allow `PUT` (and the preflight `OPTIONS`) from `https://rmpgutah.us`
   and `http://localhost:5173` on **both** buckets, applied via
   `wrangler r2 bucket cors put <bucket> --rules <file>` — non-destructive,
   additive, done as part of implementation (no dashboard click-through
   needed).

### 2. Shared presigning utility

- Add `aws4fetch` (small, zero-dependency, Workers-native SigV4 signer) to
  root `package.json`.
- New `src/utils/r2Presign.ts`: a thin wrapper — given `env`, bucket name,
  object key, content type, and expiry — returns a presigned PUT URL via
  `aws4fetch`'s `AwsClient.sign()` with `aws: { signQuery: true }`. Both
  features below call this one function; nothing else touches SigV4 directly.
- If `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` are unset, presign endpoints
  return `200 { ok: false, code: 'not_configured' }` (per this repo's
  established unset-secret convention — see `feedback-503-not-configured-anti-pattern`),
  so the UI can fall back to the existing Worker-proxied upload path instead
  of hard-failing.

### 3. Attachments direct-upload

- `POST /api/uploads/presign` (mounted alongside the existing `uploads`
  router, same auth as today — `resolveAuth()`): body
  `{ filename, contentType, size }`. Validates `contentType` against the
  existing `ALLOWED_MIME` set and `size` against a raised ceiling (2 GB,
  single-PUT). Generates `fileId = crypto.randomUUID()`,
  `r2Key = attachments/{fileId}{ext}`, stashes the intended metadata
  (`{ r2Key, filename, contentType, size, entityType, entityId, folderId,
  userId }`) in KV under `upload-presign:{fileId}` with a 30-minute TTL, and
  returns `{ file_id, upload_url }`.
- `POST /api/uploads/presign/:fileId/complete`: re-reads the KV metadata
  (404 if missing/expired), does `c.env.UPLOADS.head(r2Key)` to confirm the
  object actually landed and that its size matches what was presigned
  (guards against a client calling complete without a real upload, or a
  truncated PUT), then inserts the `attachments` row using the exact same
  logic already in `POST /` (folder placement, activity log). Deletes the
  KV entry. Returns the created row — same shape as today's `POST /`
  response, so no caller-side special-casing.
- Client: new `apiUploadFileDirect()` in `useApi.ts` — presign → raw
  `fetch(upload_url, { method: 'PUT', body: file, headers: { 'Content-Type':
  file.type } })` (not `apiFetch`: foreign origin, non-JSON body) with
  progress via `XMLHttpRequest.upload.onprogress` → complete. `apiUploadFiles`
  / `apiUploadFilesWithProgress` route each file through this path when
  `file.size > 20 * 1024 * 1024` (20 MB) and keep the existing multipart path
  below that threshold. No change to any call site (`FileAttachments.tsx`,
  etc.) — the branching is internal to the two exported helpers.

### 4. Admin map-data upload tool

- New prefix `/api/admin/map-data`, `auth: 'required'` in
  [`src/routesConfig.ts`](../../../src/routesConfig.ts) (unlike
  `/api/map-data`, which stays `auth: 'public'` for tile-serving — these
  admin routes must not share that mount). Every handler additionally checks
  `c.get('user')?.role === 'admin'`, mirroring the pattern already in
  `src/routes/cloudflare.ts`.
- `GET /files` — `c.env.MAP_DATA.list()` across the whole bucket (the
  existing public listing at `GET /api/map-data` stays pinned to
  `Map Overlay Database/` only — unchanged).
- `POST /presign` — body `{ key, contentType, size }`. `key` must start with
  `Map Overlay Database/` or `tiles/` (allowlisted prefixes — prevents an
  admin typo from writing an arbitrary key into the bucket). Uses the same
  `r2Presign.ts` helper against `system-essentials`. No KV bookkeeping needed
  here (unlike attachments) — there's no DB row to create afterward.
- `DELETE /files/:key` — `c.env.MAP_DATA.delete(key)`, same prefix allowlist.
- Client: new `AdminMapDataTab.tsx` — file list (name, size, uploaded date),
  a destination picker (Overlay vs. Tile archive) + filename field, drag-drop
  using the same direct-PUT pattern as attachments (presign → PUT → refresh
  list via `GET /files`, no "complete" call needed), delete button per row.
  Wired into `AdminPage.tsx`'s tab list, admin-only (the tab itself checks
  the logged-in user's role before rendering, matching other admin-only tabs).

### 5. Backward compatibility / rollout

- No D1 schema changes — no migration needed (attachments schema is
  untouched; map-data has no DB table).
- Existing `POST /api/uploads` and body-cam upload routes are unmodified.
- If R2 credentials aren't configured yet, both new upload paths degrade to
  `not_configured` and the UI keeps using the existing Worker-proxied path
  (attachments) or shows a "not configured" state (admin map-data tab).

## Testing

- Server: extend `tests/` for `r2Presign.ts` (mock `AwsClient`, assert the
  signed URL shape) and the new presign/complete/list/delete routes (mocked
  R2/KV, admin-role gate on `/api/admin/map-data/*`).
- Client: no new automated test beyond existing patterns. Manually verify
  via the dev server: upload a >20 MB file through `FileAttachments.tsx` and
  confirm it lands via the direct-PUT path (network tab shows a PUT to
  `*.r2.cloudflarestorage.com`, not `/api/uploads`); as an admin, upload a
  file via the new map-data tab and confirm it's listed and playable/fetchable
  from `/api/map-data/...` or `/api/tiles/...` afterward.
