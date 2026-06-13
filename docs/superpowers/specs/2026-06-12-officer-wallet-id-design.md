# Officer Wallet ID — Digital Badge / ID Pass (Design)

> Status: approved 2026-06-12. Internal, QR-verifiable digital officer ID in RMPG Flex
> (Workers `rmpg-flex-api` + D1 + React SPA). No external wallet/cert dependencies.

## Goal

Give every RMPG officer a digital ID badge: their own in-app badge card with a live QR code,
and a scan-to-verify flow so an authenticated RMPG user can confirm another officer's identity and
current standing in the field.

## Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| Pass format | **Internal QR-verifiable digital ID** (self-contained; no Apple/Google Wallet, no certs) |
| Verification | **Online lookup** — scanner calls a verify endpoint that checks live D1 |
| Scope | **API + "My ID" display + verify/scanner page** |
| Verify access | **Authenticated RMPG users only**; full result (name, photo, badge#, rank, dept, status) |
| QR security | **Option A — rotating signed token** (short-lived HMAC; screenshot stops verifying after expiry) |
| Issuance | **Lazy auto-issue** on first `GET /api/wallet/me`; admin revoke/reinstate |

## Data model — migration `0103_wallet_credentials.sql`

The `users` table already holds all *displayed* badge fields (`full_name`, `badge_number`, `rank`,
`department`, `avatar_url`/`profile_image`, `status`, `employee_id`, `hire_date`). The new table owns
only credential lifecycle:

```sql
CREATE TABLE IF NOT EXISTS wallet_credentials (
  wallet_id   TEXT PRIMARY KEY,        -- opaque unguessable id (uuid v4)
  user_id     INTEGER NOT NULL UNIQUE, -- one credential per officer (FK users.id)
  status      TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'revoked'
  issued_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT,
  revoked_by  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wallet_credentials_user ON wallet_credentials(user_id);
```

**Effective validity = `wallet_credentials.status='active'` AND live `users.status='active'`.**
Deactivating an officer auto-invalidates the badge — no separate revoke needed. Idempotent DDL;
applied to live `785de7ae` directly after merge per CLAUDE.md D1 rule.

## QR token (rotating signed token)

- **Format:** `walletId.exp.sig` where `sig = base64url(HMAC-SHA256(JWT_SECRET, "walletId.exp"))`,
  `exp` = unix seconds, TTL **60s**. (Reuses the already-present `JWT_SECRET`; HMAC via WebCrypto.)
- The "My ID" page regenerates the displayed QR every **30s** by re-calling `/api/wallet/qr-token`.
- **Pure, unit-testable** sign/verify helpers in `src/utils/walletToken.ts` — no I/O.
- Verify path: parse → recompute HMAC (constant-time compare) → check `exp` not passed → live D1
  status lookup. A shared screenshot fails the `exp` check after 60s; a revoked/deactivated officer
  fails the live lookup immediately.

## API — `src/routes/wallet.ts`, mounted `/api/wallet` (all JWT-gated)

| Method & path | Role | Behaviour |
|---------------|------|-----------|
| `GET /api/wallet/me` | any auth | Lazy-issue my credential if absent; return badge data + wallet_id + a fresh QR token |
| `GET /api/wallet/qr-token` | any auth | Return only a fresh rotating token for my own credential |
| `POST /api/wallet/verify` | any auth | Body `{ token }`. Validate sig+exp, live status lookup; return verified officer identity + `valid: true/false` + reason |
| `POST /api/wallet/:walletId/revoke` | admin/manager | Set status='revoked', audited |
| `POST /api/wallet/:walletId/reinstate` | admin/manager | Set status='active', audited |
| `GET /api/wallet/admin/list` | admin/manager | Roster of issued credentials + status |

Role gating reuses `requireRole` (as existing admin routes do). Verify returns a **stable shape**
`{ valid, reason, officer? }` (404-free) so the scanner UI renders cleanly for invalid/revoked.

**Routing:** register in `src/routesConfig.ts` (`{ prefix: '/api/wallet', router: wallet, auth: 'required' }`)
**and add `{ kind: 'prefix', value: '/api/wallet' }` to the proxy `API_ROUTES`** — a new rewrite route
falls through to legacy (404) without it.

## Client

**`client/src/pages/wallet/MyIdPage.tsx`** (route e.g. `/my-id`): badge card in the Spillman pure-black
theme — photo (from `profile_image`/`avatar_url`), full name, badge#, rank, department, status pill,
and a QR rendered with the existing `qrcode` dep, refreshed every 30s from `/api/wallet/qr-token`.

**`client/src/pages/wallet/VerifyIdPage.tsx`** (route e.g. `/verify-id`): camera scan via the existing
`zxing-wasm` dep (already used by the DL scanner, `client/src/utils/pdf417Decoder.ts`) reading QR_CODE,
plus a manual-token paste fallback; POSTs to `/api/wallet/verify` and renders the verified officer
card with a clear VALID (green) / INVALID·REVOKED (red) banner. Authenticated route.

Both reached via `apiFetch`. Bump `client/public/sw.js` `CACHE_NAME` on ship.

## Testing

- **Worker (vitest, `tests/`):** `walletToken.test.ts` — sign→verify round-trip, tamper rejection,
  expiry rejection, malformed-token rejection. Validity-computation test (active vs revoked vs
  deactivated-user). These are the pure-logic core.
- **Client (vitest):** badge-card render + a verify-result render test (valid/revoked banners).
- No Worker integration harness exists yet (typecheck-only) — endpoints get smoke coverage via the
  pure helpers + manual live verification.

## Out of scope (YAGNI)

Apple/Google Wallet passes, offline credential validation, public verify, hardware badge printing,
credential expiry/renewal cycles (validity follows employment status). The data model leaves room to
add native wallet passes later without rework.
