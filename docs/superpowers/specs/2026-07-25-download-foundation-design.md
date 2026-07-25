# Download Foundation — Phase 1

**Status:** designed, not started · **Started:** 2026-07-25 · **Owner:** Rocky Mountain Protective Group

Phase 1 of a four-phase program to make artifact downloads correct, verifiable,
and capable of carrying the bundled double-click installers planned for Phase 2.

This phase fixes breakage that is **live in production today** and removes the
300 MiB publish ceiling that would otherwise block Phase 2 entirely.

## Why this exists

On 2026-07-25 a field report — "the disc image file is corrupted" — turned out to
be two unrelated problems. Only the second is a defect.

**Not a defect:** `disk.img` inside `kiosk-linux-os-1.2.0.zip` is healthy. It
carries a valid MBR (`55 aa`), an active type-`0x83` Linux partition at sector
2048, and an ext superblock (`0xef53`, label `kiosk_boot`, error count 0).
macOS attached it correctly as `FDisk_partition_scheme` / `Linux` but cannot
*mount* ext4, and DiskImageMounter reports every unmountable image as
"corrupted". The image was never meant to be opened in Finder.

**The real defect:** four artifacts in the field are 11,728 bytes of HTML — the
single-page-app shell saved under a binary filename. PR #3007 (commit
`7e4db82862`, landed 2026-07-25 03:08) mounted `/downloads/*` on the Worker and
fixed the public downloads page, but three surfaces still emit URLs that resolve
against Cloudflare Pages instead of the Worker.

Verified in production while designing this phase:

| Request | Result |
| --- | --- |
| `rmpgutah.us/downloads/kiosk-linux-os-1.2.0.zip` | `200 text/html` — app shell, no `Location` header |
| `api.rmpgutah.us/downloads/kiosk-linux-os-1.2.0.zip` | `200 application/zip`, 247,872,459 bytes |
| `rmpgutah.us/rmpg-seal.png` | `404` |
| `api.rmpgutah.us/rmpg-seal.png` | `404` |

Two independent faults keep this alive:

1. **Three surfaces build relative URLs.** `AdminDownloadsTab.tsx:86`,
   `AdminIPEDTab.tsx:441` and `:463`, and `MenuBar.tsx:974` / `:987` emit
   `/downloads/...` against the Pages origin. `MenuBar` additionally hardcodes
   `RMPG-Flex-Setup-5.8.1.exe`, while the published Windows artifact is now
   `RMPG-Flex-Setup-5.8.6.zip` — a filename that no longer exists.
2. **`_redirects` cannot rescue them.** Its `/downloads/*  …  200` rule uses a
   status-200 external rewrite, which is a Netlify feature Cloudflare Pages does
   not implement. The rule is silently ignored and the request falls through to
   the `/*  /index.html  200` catch-all.

A 200 response plus a plausible filename is why browsers save these without
complaint, and why the failure only surfaces later in a different application.

`/api/*` on the app domain is **not** evidence the 200-rules work — it survives
via the separate `rmpg-api-proxy` zone route. `wrangler.toml` declares only
`api.rmpgutah.us` as a custom domain.

A fifth problem is structural rather than behavioural:
`AdminDownloadsTab.test.tsx:38` asserts the broken relative href, so the test
suite currently **enforces** the defect.

## Scope

In scope for Phase 1:

- Make every download URL server-authoritative.
- Make a relative `/downloads/` link impossible to reintroduce.
- Publish and surface a SHA-256 per artifact.
- Replace `wrangler r2 object put` with an R2 multipart publisher.
- Add a `rmpgutah.us/downloads/*` zone route as an edge safety net.
- Remove `_redirects` rules proven dead.

Out of scope — later phases, each with its own spec:

- **Phase 2** — signed, notarized macOS `.dmg` USB-writer app; Windows
  single-file self-extracting installer. Both bundle the OS image.
- **Phase 3** — staging/stable channels, release notes, rollback, admin upload UI.
- **Phase 4** — download analytics and fleet OS/app version inventory.

## Architecture

Three layers, each with one responsibility.

**1. Publish** — `scripts/publish-download.mjs` computes SHA-256, uploads to R2
over the S3 multipart API, and writes the checksum to the object's
`customMetadata`. This replaces `wrangler r2 object put`, whose hard 300 MiB
limit fails in milliseconds; a command that appears to succeed is therefore not
evidence of an upload. Wrangler 4.112.0 exposes no multipart flag, so the S3 API
is the only path. Phase 2's bundled installers exceed the CLI limit, making this
a prerequisite rather than an improvement.

**2. Serve** — `scanInstallers()` in `src/routes/downloads.ts` adds `url` and
`sha256` to each entry. `serveDownloadFile()` is untouched: it already streams
from R2 with Range support and correct `Content-Disposition`.

**3. Consume** — clients render `installer.url`. No client-side URL construction
on info-driven paths.

### Key decision: request-derived origin

`url` is built from `new URL(c.req.url).origin`, not from a constant.

Today the client holds `CF_WORKER_DIRECT_BASE = 'https://api.rmpgutah.us'` — a
build-time constant encoding a deployment-time fact. It cannot change without a
client rebuild and can go stale inside a cached bundle. A request-derived origin
cannot drift from reality and is automatically correct in development
(`localhost:8787`), removing the `import.meta.env.DEV` branch from
`downloadUrl()`.

Because `/api/downloads/info` is served by the Worker, the derived origin is
always the Worker origin.

### Edge safety net: zone route

Add a `rmpgutah.us/downloads/*` route pointing at `rmpg-flex-api`, mirroring the
mechanism already proven by `rmpg-api-proxy` for `/api/*`. Relative links then
resolve natively — same-origin, no redirect hop, no origin change visible to the
browser or to `electron-updater`.

This is deliberately *not* load-bearing. The serve and consume layers together
make correct absolute URLs the default path; the zone route only catches
surfaces not yet found and links written later.

**Must be verified before enabling:** that the new route does not overlap or
shadow the existing `rmpg-api-proxy` route, and that Pages continues to serve
all non-`/downloads` paths unchanged.

## Components

| File | Change |
| --- | --- |
| `src/routes/downloads.ts` | `InstallerMeta` gains `url` + `sha256`; read `obj.customMetadata.sha256`; derive origin from request |
| `client/src/pages/DownloadsPage.tsx:349` | `href={installer.url}`; display checksum |
| `client/src/pages/admin/AdminDownloadsTab.tsx:86` | `href={installer.url}` |
| `client/src/pages/admin/AdminIPEDTab.tsx:441`, `:463` | `downloadUrl()` — filename-only case |
| `client/src/components/MenuBar.tsx:974`, `:987` | Read current filename from `/api/downloads/info`; drop the `5.8.1` pin |
| `client/src/hooks/useApi.ts:369` | Keep `downloadUrl()` for filename-only callers; narrow its documented role |
| `client/public/_redirects` | Delete rules proven dead |
| `wrangler.toml` | Add `rmpgutah.us/downloads/*` route |
| `scripts/publish-download.mjs` | New — multipart upload + checksum |
| `scripts/backfill-download-checksums.mjs` | New — one-off for the four existing artifacts |
| `client/src/__tests__/downloadLinks.guard.test.ts` | New — guard test |
| `kiosk-linux/RELEASE.md` | Replace the `wrangler r2 object put` step |

## Data flow

```
publish-download.mjs
  → sha256(file)
  → S3 CreateMultipartUpload → UploadPart × N → CompleteMultipartUpload
  → customMetadata { sha256 }

R2
  → scanInstallers() reads customMetadata.sha256
  → builds url = <request origin>/downloads/<filename>
  → GET /api/downloads/info → { filename, version, size, bytes, releaseDate, url, sha256 }

Client
  → renders <a href={installer.url}> and shows sha256
  → GET /downloads/:filename streams from R2 (unchanged)
```

## Error handling

- **Legacy objects without a checksum.** Artifacts uploaded before this change
  have no `sha256` in `customMetadata`. The field is omitted from the response
  and the UI hides the checksum row rather than rendering `undefined`. The
  backfill script then populates the existing four artifacts.
- **Failed multipart upload.** Call `AbortMultipartUpload` so orphaned parts do
  not accrue storage charges, exit non-zero, and name the failing part number.
  A partial upload must never leave a half-written object addressable.
- **Checksum mismatch on backfill.** Report and skip; never overwrite a live
  artifact's metadata with a checksum computed from a different local file.
- **Zone route misconfiguration.** If the route is added but the Worker path is
  wrong, downloads fail loudly with a Worker error rather than silently
  returning HTML — a strict improvement over today's failure mode.

## Testing

- **Guard test** (`downloadLinks.guard.test.ts`) scans `client/src/**/*.{ts,tsx}`
  and fails on any of these three patterns, which are exactly the forms the
  known defects took:

  | Pattern | Example of what it catches |
  | --- | --- |
  | `href` assigned a string literal beginning `/downloads/` | `AdminIPEDTab.tsx:441` |
  | `href` assigned a template literal beginning `/downloads/` | `AdminDownloadsTab.tsx:86` |
  | any string literal containing `rmpgutah.us/downloads/` | `MenuBar.tsx:974` (hardcoded origin) |

  Two exclusions, both required or the test fails on correct code: `useApi.ts`,
  which legitimately constructs the path inside `downloadUrl()`; and `*.test.ts`
  / `*.test.tsx` files, which assert on URL strings by design — including this
  guard's own fixtures. Modeled on
  `client/src/utils/__tests__/accentTokens.test.ts`, including its convention of
  commenting *why* each rule exists. This is the mechanism that makes the bug
  unrepresentable; the client has no ESLint (`"lint": "tsc --noEmit"`), so a
  source-scanning vitest is the available enforcement point.
- **`scanInstallers()` unit test** asserting `url` and `sha256` are present and
  that `url` is absolute.
- **Correct `AdminDownloadsTab.test.tsx:38`**, which currently asserts the
  broken relative href.
- **Full client suite must pass**, not targeted tests only — a red test has
  previously hidden behind green targeted runs for four consecutive tasks.
- **Post-deploy verification**, since `deploy.yml` continues on error:
  `curl -sI https://rmpgutah.us/downloads/<file>` must return
  `application/zip`, not `text/html`.

## `_redirects` cleanup — deliberately conservative

Delete only rules proven dead by direct observation:

- `/downloads/*` — returns the app shell (verified).
- `/rmpg-seal.png` — 404s on both origins (verified). Nothing depends on it:
  `client/src/utils/pdfAssets.ts:8` already records that root-level assets 404
  on live and switched to Vite `?url` imports.

Test before deleting: `/updates/*` and `/download`.

**Leave `/api/*` in place.** It is almost certainly inert, surviving only
because `rmpg-api-proxy` covers the same path — but if that reasoning is wrong,
deleting it breaks every API call in the product. Removing one redundant line
does not justify that risk.

## Operator prerequisites

Neither can be performed by an agent; both have lead time and should start now.

**R2 S3 API credentials** (blocks the multipart publisher). In the Cloudflare
dashboard: R2 → Manage R2 API Tokens → Create API Token, with Object Read &
Write on `rmpg-flex-downloads`. This yields an Access Key ID and Secret Access
Key, which are distinct from `CLOUDFLARE_API_TOKEN`. Store locally in
`.dev.vars` (gitignored) and as GitHub Actions secrets for CI publishing.

**Apple Developer ID certificate** (blocks Phase 2, not Phase 1 — start early).
The published macOS build is currently ad-hoc signed and Gatekeeper-rejected:

```
DMG:  code object is not signed at all   → spctl: rejected
App:  Signature=adhoc (flags=0x2)        → spctl: rejected
```

That is what `electron-builder --mac -c.mac.identity=null` produces, so release
5.8.5 was built locally rather than through `desktop-release.yml`, which
hard-fails unless all five Apple secrets exist. Generate a **Developer ID
Application** certificate, export as `.p12`, and add
`APPLE_CERTIFICATE` (base64 of the `.p12`), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` under repository
Settings → Secrets and variables → Actions. The workflow is already written for
these; it needs only the values.

## Acceptance criteria

1. `curl -sI https://rmpgutah.us/downloads/<current-os-zip>` returns
   `application/zip`, not `text/html`.
2. Every download link in the product resolves to a real binary — public page,
   Admin Downloads tab, Admin IPED tab, and the menu bar.
3. The menu bar links to the currently published Windows artifact, with no
   version hardcoded in source.
4. `/api/downloads/info` returns `url` and `sha256` for all four artifacts.
5. Adding a relative `/downloads/` href anywhere under `client/src` fails CI.
6. An artifact larger than 300 MiB publishes successfully and downloads intact.
7. Worker typecheck, client typecheck, full client vitest, and client build all
   pass.
