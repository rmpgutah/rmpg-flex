# Security Audit Fixes — 2026-03-20

## Phase 1: HIGH Priority

| # | Severity | Issue | Fix | Files |
|---|----------|-------|-----|-------|
| 1 | HIGH | JWT tokens in URL query params (12 instances) | HMAC-signed URLs via `signResourceAccess()` | 2 new + 14 modified |
| 2 | MEDIUM | IDOR on serve POST /routes | Officer ownership check | serve.ts |
| 3 | LOW | Pagination max 10,000 → 1,000 | Batch sed replacement | 20 route files |
| 4 | LOW | Unsanitized error messages in UI | `sanitizeErrorMsg()` wrapper | AuthContext.tsx |

### False Positives (Investigated, No Fix Needed)
- Audit export endpoint — already protected by `router.use(requireRole('admin', 'manager'))`
- Announcements endpoint — already protected by `router.use(authenticateToken)`; no `requireRole` is intentional (filters by user role)
- Field interviews IDOR — all officers/dispatchers seeing all FIs is standard CAD workflow

## Phase 2: Email, Config, Documents

| # | Severity | Issue | Fix | Files |
|---|----------|-------|-----|-------|
| 5 | HIGH | Email header injection (CRLF in addresses) | `validateEmailAddress()` with CRLF blocking | email.ts |
| 6 | MEDIUM | Graph API folder ID path traversal | `validateFolderId()` alphanumeric check | email.ts |
| 7 | MEDIUM | Unpublished docs accessible by ID | Published status check on single GET | companyDocuments.ts |
| 8 | MEDIUM | Sensitive config values logged in plaintext | Regex-based `[REDACTED]` masking | systemConfig.ts |
| 9 | MEDIUM | ffprobe argument injection | `--` separator + path validation | personnel.ts |

## Phase 3: Client Pages & Access Control

| # | Severity | Issue | Fix | Files |
|---|----------|-------|-----|-------|
| 10 | MEDIUM | DAR cross-officer data access | Officer-level filtering on GET endpoints | dar.ts |
| 11 | MEDIUM | AdminPage accessible to non-admin roles | Frontend role guard + `<Navigate />` | AdminPage.tsx |
| 12 | LOW | `prompt()` input unsanitized | Control char stripping + length limit | DailyActivityReportsPage.tsx |

## Verified Secure (No Issues Found)
- Auth: JWT validation, session binding, TOTP, WebAuthn, backup codes
- WebSocket: Message-based auth, rate limiting, session revalidation
- File uploads: Magic byte verification, path traversal protection, HMAC signing
- Desktop offline DB: Parameterized queries, table whitelist
- Password reset: Cryptographic tokens, single-use, time-limited
- CSRF: Custom header validation
- Index.ts: Prototype pollution protection, body size limits, CORS, DNS rebinding
