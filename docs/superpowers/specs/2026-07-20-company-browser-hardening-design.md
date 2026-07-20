# Company Browser — Ownership, Access Restriction, and Encryption at Rest

Date: 2026-07-20

## Goal

Follow-up hardening for the Company Browser feature (Desktop tab, Electron-only web browser — see the original design at `docs/superpowers/specs/2026-07-20-desktop-company-browser-design.md`), adding three things the user explicitly asked for:

1. Explicit ownership/proprietary notice: Rocky Mountain Protective Group, LLC.
2. Restriction to company personnel only (beyond the existing JWT auth gate).
3. Encryption at rest for the bookmarks/history data already being persisted.

## Scope decisions

- **Encryption scope**: bookmarks/history stored in D1 (`user_preferences.browser_bookmarks_json` / `browser_history_json`) — the only Company Browser data persisted server-side today. Per-tab Electron webview partition data (cookies/cache) is out of scope; Chromium already sandboxes/encrypts that at the OS level, and encrypting it further is a materially larger, separate effort not requested.
- **Access restriction**: block `client_viewer` and `contract_manager` roles from the Company Browser nav entry, matching the existing `CLIENT_VIEWER_BLOCKED`/`CONTRACT_MANAGER_BLOCKED` exclusion pattern already used for other internal-only modules. Every other authenticated role (officer, dispatcher, supervisor, manager, admin, etc.) retains access — the app has no anonymous access already, so this narrows "company personnel" to "internal staff roles," not "authenticated users."
- **Ownership notice**: a persistent footer line in the Company Browser UI, plus a one-time dismissible modal on first launch per user (localStorage-backed, not a new D1 column — this is a UI acknowledgment, not data that needs cross-device sync).

## Architecture

### 1. Role restriction (`client/src/data/navCatalog.ts`)

Add `'/desktop-company-browser'` to both `CLIENT_VIEWER_BLOCKED` and `CONTRACT_MANAGER_BLOCKED` (currently defined at `navCatalog.ts:34-41`). No other code changes — `DesktopPageInner`'s existing role-filter (`client/src/pages/DesktopPage.tsx:65-72`) already excludes any path in either set from `allFunctions`, which both the pinned-icon list and the taskbar launcher search derive from. A blocked role can no longer pin, launch, or search up the module.

### 2. Encryption at rest (`src/utils/companyBrowserCrypto.ts`, `src/routes/stubs.ts`)

New module `src/utils/companyBrowserCrypto.ts`, structurally identical to the existing `src/utils/emailCrypto.ts` (AES-256-GCM, stored form `"v1:" + base64(iv || ciphertext+tag)`, 12-byte random IV per encryption):

- `encryptBrowserData(env, plaintext): Promise<string>`
- `decryptBrowserData(env, stored): Promise<string | null>` — returns `null` (not a thrown error) on any decrypt failure, so a corrupted row or post-rotation key mismatch degrades to "no bookmarks/history" rather than a 500.

Key derivation: if `env.COMPANY_BROWSER_DATA_KEY` is set (base64 of ≥32 random bytes), use it directly (padded via SHA-256 if short, matching `emailCrypto.ts`'s convention). Otherwise derive from `SHA-256(JWT_SECRET + '|company-browser-data-v1')` — domain-separated from `emailCrypto.ts`'s own fallback (which hashes bare `JWT_SECRET`), so the two features never end up with the same derived key even though they share one root secret and the same out-of-the-box, no-new-secret-required behavior.

`decryptBrowserData` must tolerate the plaintext JSON rows already live in D1 from the just-shipped, pre-encryption version of this feature: if `stored` doesn't start with `"v1:"`, treat it as legacy plaintext and return it as-is (same convention `emailCrypto.ts`'s `decryptSecret` already uses for exactly this reason). This is a real migration-in-place concern — real users may already have bookmarks saved.

`src/routes/stubs.ts` changes:
- `PUT /preferences`: before building the `UPDATE` statement, if the request body includes `browser_bookmarks_json` and/or `browser_history_json`, replace those values with `await encryptBrowserData(c.env, value)`.
- `GET /preferences`: after loading the row, if `browser_bookmarks_json`/`browser_history_json` are non-null, replace them with `await decryptBrowserData(c.env, value)` (falling back to `null` on decrypt failure) before returning the response.

This is entirely a Worker-side boundary change. `CompanyBrowserPage.tsx` already treats these two fields as opaque JSON strings it `JSON.parse`s/`JSON.stringify`s — it never sees ciphertext vs. plaintext, so **no client code changes** are needed for this piece.

### 3. Ownership notice (`client/src/pages/CompanyBrowserPage.tsx`)

- **Footer line**: a small, persistent, always-visible line at the bottom of the Company Browser window: `"© 2026 Rocky Mountain Protective Group, LLC — Internal Use Only, Authorized Personnel Only"`.
- **First-launch modal**: shown once per user, stating the tool is RMPG-owned, proprietary, and restricted to authorized personnel, with a single "I Understand" dismiss button. Persistence key: `localStorage.getItem('rmpg_company_browser_ack_<userId>')` — set to `'1'` on dismiss, checked on mount to decide whether to show the modal. Namespaced per user ID (not global) so a shared computer with multiple RMPG accounts shows the notice to each user once, not once total.

## Data flow

No new data flow beyond what's already described in the original design — encryption is entirely inside the existing `PUT`/`GET /preferences` request/response cycle already used for bookmarks/history persistence. The debounced save effect in `CompanyBrowserPage.tsx` (already built) is untouched.

## Error handling

- `decryptBrowserData` returning `null` on failure is treated by `stubs.ts`'s `GET` handler exactly like the field being unset in the database — the client's existing `parseJsonArray(prefs.browser_bookmarks_json)` already treats a nullish value as an empty array, so no new client-side error handling is needed.
- The first-launch modal's `localStorage` read/write is wrapped in try/catch (matching the existing `loadFavorites`/`loadSession` pattern elsewhere in this codebase) — a `localStorage` failure (private browsing, quota) degrades to "show the modal every launch" rather than crashing the page.

## Testing

- `tests/companyBrowserCrypto.test.ts` (new): round-trip encrypt/decrypt returns the original plaintext; a legacy (non-`"v1:"`-prefixed) plaintext string passes through `decryptBrowserData` unchanged; a corrupted/truncated ciphertext string returns `null` rather than throwing; encrypting the same plaintext twice produces different ciphertext (proves the IV is actually random per call, not reused).
- `tests/stubsPreferences.test.ts` (extend the existing file from the original feature): after a `PUT /preferences` with a bookmarks/history payload, assert the raw D1 row's `browser_bookmarks_json`/`browser_history_json` values do NOT equal the plaintext sent (i.e., they're actually ciphertext, not a no-op passthrough) and start with `"v1:"`; assert a subsequent `GET /preferences` returns the original plaintext.
- `client/src/data/navCatalog.test.ts` (create if none exists for role-filtering, otherwise extend): assert `'/desktop-company-browser'` is present in both `CLIENT_VIEWER_BLOCKED` and `CONTRACT_MANAGER_BLOCKED`.
- `client/src/pages/CompanyBrowserPage.test.tsx` (extend the existing file): the footer copyright line renders; the first-launch modal appears when `localStorage` has no ack key for the current user, is dismissible, and does not reappear on remount once dismissed (mock `localStorage`).

## Post-merge

No migration needed — no schema change (the D1 columns already exist from the original feature; encryption only changes what bytes are stored in them, not their shape). No new required secret — `COMPANY_BROWSER_DATA_KEY` is optional, matching `EMAIL_CRED_KEY`'s pattern of "works out of the box, rotatable later via `wrangler secret put`."
