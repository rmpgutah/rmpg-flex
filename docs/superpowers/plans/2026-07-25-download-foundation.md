# Download Foundation (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every download link in RMPG Flex resolve to a real binary, publish a verifiable checksum per artifact, and remove the 300 MiB publish ceiling.

**Architecture:** The Worker becomes authoritative for download URLs — `/api/downloads/info` returns a canonical absolute `url` plus a `sha256` per artifact, with the origin derived from the incoming request rather than a build-time constant. Clients stop constructing download URLs. A source-scanning vitest makes a relative `/downloads/` link fail CI, and publishing moves from `wrangler r2 object put` to an S3 multipart script.

**Tech Stack:** Hono on Cloudflare Workers, Cloudflare R2 (Workers binding + S3 API), React 18 + Vite, vitest, `@aws-sdk/client-s3`.

**Spec:** [`docs/superpowers/specs/2026-07-25-download-foundation-design.md`](../specs/2026-07-25-download-foundation-design.md)

## Global Constraints

- **`bucket.list()` MUST pass `include: ['customMetadata']`.** `compatibility_date = "2026-05-01"` is past the `2022-08-04` cutoff, so a bare `list()` omits `customMetadata` entirely and every checksum silently reads `undefined`.
- **Any `list()` that passes `include` MUST follow the cursor.** R2 returns fewer objects per page when metadata is requested. Never compare `objects.length` against a limit; use `truncated`.
- **All D1 and R2 calls are async** — always `await`.
- **New Worker logging uses `log` from `src/utils/logger.ts`**, not `console.*`.
- **Never hardcode hex in client code.** Use the `rmpg-*` / `surface-*` / `brand-*` Tailwind tokens. Border radius is 2 px everywhere — never `rounded-lg`.
- **No PII in the repository.** Do not commit account IDs, emails, keys, or `.p12` files.
- **The company is "Rocky Mountain Protective Group"** in prose; `RMPG` only in identifiers and very limited references.
- **US units** in any user-facing copy.
- **The full client suite is the gate**, not targeted tests: `cd client && npx vitest run`. A red test has previously hidden behind green targeted runs.
- **Do not delete the `/api/*` rule** from `client/public/_redirects`. It is almost certainly inert, but if that reasoning is wrong, removing it breaks every API call.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/routes/downloads.ts` | *Modify.* `InstallerMeta` gains `url` + `sha256`; add `listAllObjects()` and `toMeta()` helpers; `scanInstallers()` takes an origin. |
| `tests/downloadsInfo.test.ts` | *Create.* Unit tests for `scanInstallers()` against a fake R2 bucket. |
| `client/src/pages/DownloadsPage.tsx` | *Modify.* Render `installer.url`; show the checksum. |
| `client/src/pages/admin/AdminDownloadsTab.tsx` | *Modify.* Render `installer.url`. |
| `client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx` | *Modify.* Currently asserts the broken relative href. |
| `client/src/components/MenuBar.tsx` | *Modify.* Read the current Windows artifact from the API instead of hardcoding `5.8.1`. |
| `client/src/pages/admin/AdminIPEDTab.tsx` | *Modify.* Use `downloadUrl()` for its filename-only links. |
| `client/src/__tests__/downloadLinks.guard.test.ts` | *Create.* Fails CI on a relative or hardcoded-origin download link. |
| `client/public/_redirects` | *Modify.* Delete rules proven dead. |
| `wrangler.toml` | *Modify.* Add the `rmpgutah.us/downloads/*` zone route. |
| `scripts/publish-download.mjs` | *Create.* SHA-256 + S3 multipart publisher. |
| `scripts/backfill-download-checksums.mjs` | *Create.* One-off checksum backfill for existing artifacts. |
| `kiosk-linux/RELEASE.md` | *Modify.* Replace the `wrangler r2 object put` step. |

---

## Task 1: Serve canonical `url` and `sha256` from the Worker

**Files:**
- Modify: `src/routes/downloads.ts:178-184` (`InstallerMeta`), `:228-308` (`scanInstallers`), `:313` (info handler)
- Test: `tests/downloadsInfo.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `scanInstallers(bucket: R2Bucket, origin: string): Promise<InstallerInfo>`, where each `InstallerMeta` is `{ filename: string; version: string; size: string; bytes: number; releaseDate: string; url: string; sha256?: string }`. Tasks 2 and 3 consume `url` and `sha256`. Task 6 writes the `sha256` custom-metadata key this reads.

- [ ] **Step 1: Write the failing test**

Create `tests/downloadsInfo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scanInstallers } from '../src/routes/downloads';

const ORIGIN = 'https://api.rmpgutah.us';

type FakeObj = {
  key: string;
  size: number;
  uploaded: Date;
  customMetadata?: Record<string, string>;
};

/** Single-page fake bucket that records the options list() was called with. */
function fakeBucket(objects: FakeObj[], spy?: { include?: string[] }) {
  return {
    async list(opts?: { include?: string[]; cursor?: string }) {
      if (spy) spy.include = opts?.include;
      return { objects, truncated: false };
    },
  } as any;
}

/** Two-page fake bucket, to prove the cursor is followed. */
function pagedBucket(page1: FakeObj[], page2: FakeObj[]) {
  return {
    async list(opts?: { cursor?: string }) {
      return opts?.cursor
        ? { objects: page2, truncated: false }
        : { objects: page1, truncated: true, cursor: 'CURSOR' };
    },
  } as any;
}

const dmg: FakeObj = {
  key: 'RMPG-Flex-5.8.6-arm64.dmg',
  size: 125030770,
  uploaded: new Date('2026-07-25T00:00:00Z'),
  customMetadata: { sha256: 'a'.repeat(64) },
};

describe('scanInstallers', () => {
  it('returns an absolute url built from the request origin', async () => {
    const info = await scanInstallers(fakeBucket([dmg]), ORIGIN);
    expect(info.mac?.url).toBe(`${ORIGIN}/downloads/RMPG-Flex-5.8.6-arm64.dmg`);
  });

  it('uses the origin it was given, so dev resolves to the local Worker', async () => {
    const info = await scanInstallers(fakeBucket([dmg]), 'http://localhost:8787');
    expect(info.mac?.url).toBe('http://localhost:8787/downloads/RMPG-Flex-5.8.6-arm64.dmg');
  });

  it('exposes the sha256 stored in customMetadata', async () => {
    const info = await scanInstallers(fakeBucket([dmg]), ORIGIN);
    expect(info.mac?.sha256).toBe('a'.repeat(64));
  });

  it('omits sha256 for artifacts published before checksums existed', async () => {
    const legacy = { ...dmg, customMetadata: undefined };
    const info = await scanInstallers(fakeBucket([legacy]), ORIGIN);
    expect(info.mac).toBeDefined();
    expect('sha256' in (info.mac as object)).toBe(false);
  });

  // Guards the exact silent failure this task exists to avoid: with
  // compatibility_date >= 2022-08-04 a bare list() returns NO customMetadata,
  // so every checksum would read undefined and nothing would look broken.
  it('asks list() for customMetadata', async () => {
    const spy: { include?: string[] } = {};
    await scanInstallers(fakeBucket([dmg], spy), ORIGIN);
    expect(spy.include).toContain('customMetadata');
  });

  // R2 returns fewer objects per page when metadata is requested, so a single
  // list() call can silently omit artifacts.
  it('follows the cursor across pages', async () => {
    const exe: FakeObj = {
      key: 'RMPG-Flex-Setup-5.8.6.exe',
      size: 103001016,
      uploaded: new Date('2026-07-25T00:00:00Z'),
    };
    const info = await scanInstallers(pagedBucket([dmg], [exe]), ORIGIN);
    expect(info.mac?.filename).toBe('RMPG-Flex-5.8.6-arm64.dmg');
    expect(info.win?.filename).toBe('RMPG-Flex-Setup-5.8.6.exe');
  });

  it('percent-encodes filenames containing spaces', async () => {
    const apk: FakeObj = {
      key: 'RMPG Flex-5.8.0.apk',
      size: 39416087,
      uploaded: new Date('2026-05-24T00:00:00Z'),
    };
    const info = await scanInstallers(fakeBucket([apk]), ORIGIN);
    expect(info.android?.url).toBe(`${ORIGIN}/downloads/RMPG%20Flex-5.8.0.apk`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/downloadsInfo.test.ts`

Expected: FAIL. `scanInstallers` currently takes one argument and returns metas without `url`, so `info.mac?.url` is `undefined`.

- [ ] **Step 3: Extend `InstallerMeta`**

In `src/routes/downloads.ts`, replace the interface at line 178:

```ts
interface InstallerMeta {
  filename: string;
  version: string;
  size: string;
  bytes: number;
  releaseDate: string;
  /**
   * Absolute URL for this artifact.
   *
   * Built from the incoming request's origin rather than a constant. The
   * client previously held `CF_WORKER_DIRECT_BASE = 'https://api.rmpgutah.us'`
   * — a build-time constant encoding a deployment-time fact, which could only
   * change with a full client rebuild and could go stale inside a cached
   * bundle. A request-derived origin cannot drift, and is automatically
   * correct in dev (localhost:8787) with no environment branch.
   */
  url: string;
  /**
   * Hex-encoded SHA-256, read from R2 customMetadata.
   *
   * Optional because artifacts published before scripts/publish-download.mjs
   * existed have no checksum. Consumers must hide the field rather than
   * render `undefined`.
   *
   * Deliberately NOT derived from the R2 etag: a multipart object's etag is
   * the hash of the concatenated per-part MD5 sums plus "-<partCount>", so it
   * is not a content hash at all once publishing uses multipart.
   */
  sha256?: string;
}
```

- [ ] **Step 4: Add the pagination and meta helpers**

Insert immediately above `export async function scanInstallers` (line 228):

```ts
/**
 * Every object in the bucket, following the cursor.
 *
 * `include: ['customMetadata']` is REQUIRED to read the sha256 written at
 * publish time. Our compatibility_date (2026-05-01) is past the 2022-08-04
 * cutoff, so a bare list() omits customMetadata and the checksum silently
 * reads undefined.
 *
 * Requesting metadata also makes R2 return FEWER objects per page to stay
 * under a response-size cap, so the cursor must be followed. Never compare
 * objects.length against a limit — use `truncated`.
 */
async function listAllObjects(bucket: R2Bucket): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ include: ['customMetadata'], cursor });
    out.push(...page.objects);
    if (!page.truncated) return out;
    cursor = page.cursor;
  }
}

/**
 * Build an InstallerMeta from an R2 object.
 *
 * Four call sites construct metas (the main scan plus the .zip overrides for
 * Windows, Android and the OS image); they all route through here so `url`
 * and `sha256` cannot be forgotten in one of them.
 */
function toMeta(obj: R2Object, origin: string, versionFallback?: string): InstallerMeta {
  const version = extractVersion(obj.key) || versionFallback || '0.0.0';
  const sha256 = obj.customMetadata?.sha256;
  return {
    filename: obj.key,
    version,
    size: fmtBytes(obj.size),
    bytes: obj.size,
    releaseDate: obj.uploaded.toISOString(),
    url: `${origin}/downloads/${encodeURIComponent(obj.key)}`,
    ...(sha256 ? { sha256 } : {}),
  };
}
```

Add `R2Object` to the type import at the top of the file if it is not already present:

```ts
import type { R2Bucket, R2Object, D1Database } from '@cloudflare/workers-types';
```

- [ ] **Step 5: Rewrite `scanInstallers` to take an origin**

Replace the signature and body opening (lines 228-243):

```ts
export async function scanInstallers(bucket: R2Bucket, origin: string): Promise<InstallerInfo> {
  const info: InstallerInfo = {};
  const objects = await listAllObjects(bucket);

  for (const obj of objects) {
    const name = obj.key;
    const version = extractVersion(name) || '0.0.0';
    const meta = toMeta(obj, origin);
```

Leave the four `if (name.endsWith(...))` branches unchanged — they already assign `meta`.

- [ ] **Step 6: Route the three `.zip` override blocks through `toMeta`**

Each override currently rebuilds a meta literal. Replace the Windows block:

```ts
  if (info.win) {
    const zipName = info.win.filename.replace(/\.exe$/, '.zip');
    const zipObj = objects.find((o) => o.key === zipName);
    if (zipObj) info.win = toMeta(zipObj, origin, info.win.version);
  }
```

Replace the Android block:

```ts
  if (info.android) {
    const zipName = info.android.filename.replace(/\.apk$/, '.zip');
    const zipObj = objects.find((o) => o.key === zipName);
    if (zipObj) info.android = toMeta(zipObj, origin, info.android.version);
  }
```

Replace the OS-image block:

```ts
  if (info.os && info.os.filename.endsWith('.tar.gz')) {
    const zipName = info.os.filename.replace(/\.tar\.gz$/, '.zip');
    const zipObj = objects.find((o) => o.key === zipName);
    if (zipObj) info.os = toMeta(zipObj, origin, info.os.version);
  }
```

Note the `list.objects.find(...)` calls become `objects.find(...)` — the local `list` variable no longer exists.

- [ ] **Step 7: Pass the origin from the handler**

Replace the `/downloads/info` handler (line 313):

```ts
downloads.get('/downloads/info', async (c) => {
  try {
    const origin = new URL(c.req.url).origin;
    return c.json(await scanInstallers(c.env.DOWNLOADS, origin));
  } catch (err) {
    log.error('downloads/info failed', { route: '/api/downloads/info' }, err as Error);
    return c.json({ error: 'Failed to read downloads' }, 500);
  }
});
```

Add the logger import at the top of the file if absent:

```ts
import { log } from '../utils/logger';
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/downloadsInfo.test.ts`

Expected: PASS, 7 tests.

- [ ] **Step 9: Typecheck the Worker**

Run: `npm run typecheck`

Expected: no errors. If `scanInstallers` is called anywhere else, the compiler will name the site — pass the origin there too.

- [ ] **Step 10: Commit**

```bash
git add src/routes/downloads.ts tests/downloadsInfo.test.ts && git commit -m "feat(downloads): return canonical absolute url + sha256 per artifact"
```

---

## Task 2: Downloads page and Admin tab consume `installer.url`

**Files:**
- Modify: `client/src/pages/DownloadsPage.tsx:349`, `client/src/pages/admin/AdminDownloadsTab.tsx:86`
- Test: `client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx:21-47` (modify)

**Interfaces:**
- Consumes: `InstallerMeta.url` and `InstallerMeta.sha256` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Update the test to assert the correct behaviour**

The existing test asserts the *bug*. Replace the whole first test in `client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx` (lines 21-47) with this. The size strings are unchanged from the original — the `getByText` assertions depend on them, so do not "modernise" them:

```tsx
  it('fetches /api/downloads/info and renders all present platforms', async () => {
    stub({
      '/api/downloads/info': {
        win: { filename: 'RMPG-Flex-Setup-5.8.4.zip', version: '5.8.4', size: '142 MB', bytes: 148897792, url: 'https://api.rmpgutah.us/downloads/RMPG-Flex-Setup-5.8.4.zip' },
        mac: { filename: 'RMPG-Flex-5.8.4.dmg', version: '5.8.4', size: '138 MB', bytes: 144703488, url: 'https://api.rmpgutah.us/downloads/RMPG-Flex-5.8.4.dmg' },
        android: { filename: 'RMPG-Flex-5.8.4.apk.zip', version: '5.8.4', size: '45 MB', bytes: 47185920, url: 'https://api.rmpgutah.us/downloads/RMPG-Flex-5.8.4.apk.zip' },
        os: { filename: 'kiosk-linux-os-1.0.0.tar.gz', version: '1.0.0', size: '15.0 MB', bytes: 15728640, url: 'https://api.rmpgutah.us/downloads/kiosk-linux-os-1.0.0.tar.gz' },
      },
    });
    render(<AdminDownloadsTab />);
    await waitFor(() => expect(screen.getAllByText(/v5\.8\.4/)).toHaveLength(3));
    expect(screen.getByText(/142 MB/)).toBeInTheDocument();
    expect(screen.getByText(/138 MB/)).toBeInTheDocument();
    expect(screen.getByText(/45 MB/)).toBeInTheDocument();
    expect(screen.getByText(/15\.0 MB/)).toBeInTheDocument();

    // Absolute, Worker-origin URLs. A relative /downloads/… href resolves
    // against Pages and returns the SPA shell as a 200, which is the bug this
    // test previously locked in.
    const winLink = screen.getByRole('link', { name: /windows/i });
    expect(winLink).toHaveAttribute('href', 'https://api.rmpgutah.us/downloads/RMPG-Flex-Setup-5.8.4.zip');
    const macLink = screen.getByRole('link', { name: /macos/i });
    expect(macLink).toHaveAttribute('href', 'https://api.rmpgutah.us/downloads/RMPG-Flex-5.8.4.dmg');
    const androidLink = screen.getByRole('link', { name: /android/i });
    expect(androidLink).toHaveAttribute('href', 'https://api.rmpgutah.us/downloads/RMPG-Flex-5.8.4.apk.zip');
    const osLink = screen.getByRole('link', { name: /kiosk linux os/i });
    expect(osLink).toHaveAttribute('href', 'https://api.rmpgutah.us/downloads/kiosk-linux-os-1.0.0.tar.gz');
  });
```

Then add a `url` field to **every** stubbed installer object elsewhere in the file (the "Not available" test at line 49 stubs `win` too). Any stub lacking `url` will render `href={undefined}` once the component changes, which fails in a confusing way.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/admin/__tests__/AdminDownloadsTab.test.tsx`

Expected: FAIL — the component still emits `/downloads/RMPG-Flex-Setup-5.8.4.zip`.

- [ ] **Step 3: Add `url` and `sha256` to the client type**

The interface is declared **twice** — at `client/src/pages/DownloadsPage.tsx:12` and `client/src/pages/admin/AdminDownloadsTab.tsx:7`. Add the two fields to **both**; leave the duplication alone (unifying it is unrelated refactoring). In each file:

```ts
interface InstallerMeta {
  filename: string;
  version: string;
  size: string;
  bytes: number;
  releaseDate?: string;
  /** Absolute URL from the API. Never build this client-side. */
  url: string;
  /** Hex SHA-256. Absent for artifacts published before checksums existed. */
  sha256?: string;
}
```

- [ ] **Step 4: Point both links at `installer.url`**

`AdminDownloadsTab.tsx:86` — replace:

```tsx
                    href={installer.url}
```

`DownloadsPage.tsx:349` — replace `href={downloadUrl(installer.filename)}` with:

```tsx
                        href={installer.url}
```

Remove the now-unused `downloadUrl` import from `DownloadsPage.tsx` if nothing else in the file uses it.

- [ ] **Step 5: Show the checksum on the public page**

In `DownloadsPage.tsx`, directly beneath the download button for each installer, add:

```tsx
{installer.sha256 && (
  <div className="mt-1 text-[10px] text-rmpg-400 break-all">
    <span className="text-[color:var(--field-label-color)]">SHA-256</span>{' '}
    <code className="font-mono">{installer.sha256}</code>
  </div>
)}
```

The `installer.sha256 &&` guard is required: legacy artifacts have no checksum and must not render `undefined`. Colors go through theme tokens — no hex.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/admin/__tests__/AdminDownloadsTab.test.tsx`

Expected: PASS.

- [ ] **Step 7: Run the full client suite**

Run: `cd client && npx vitest run`

Expected: all pass. Baseline was clean on 2026-07-25, so any failure is from this change.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/DownloadsPage.tsx client/src/pages/admin/AdminDownloadsTab.tsx client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx && git commit -m "fix(downloads): render server-provided absolute url and show SHA-256"
```

---

## Task 3: MenuBar reads the current Windows artifact from the API

**Files:**
- Modify: `client/src/components/MenuBar.tsx:965-995`
- Test: `client/src/components/__tests__/MenuBarDownload.test.tsx` (create)

**Interfaces:**
- Consumes: `InstallerMeta.url` from Task 1 via `GET /api/downloads/info`.
- Produces: nothing.

MenuBar currently hardcodes `https://rmpgutah.us/downloads/RMPG-Flex-Setup-5.8.1.exe` in two places. That URL is wrong twice over: it targets the Pages origin (which returns the app shell), and `5.8.1` is five releases stale — the published artifact is `RMPG-Flex-Setup-5.8.6.zip`, so the `.exe` name no longer exists in the bucket.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/__tests__/MenuBarDownload.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MenuBar from '../MenuBar';

// MenuBar calls useNavigate() and useLocation() (MenuBar.tsx:102-103), so it
// throws outside a Router. There is no existing MenuBar test to copy a wrapper
// from — this is the first one.
const renderMenuBar = () => render(<MemoryRouter><MenuBar /></MemoryRouter>);

vi.mock('../../hooks/useApi', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useApi')>('../../hooks/useApi');
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string) => {
      if (path.includes('/downloads/info')) {
        return {
          win: {
            filename: 'RMPG-Flex-Setup-5.8.6.zip',
            version: '5.8.6',
            size: '98.0 MB',
            bytes: 102790778,
            url: 'https://api.rmpgutah.us/downloads/RMPG-Flex-Setup-5.8.6.zip',
          },
        };
      }
      return {};
    }),
  };
});

describe('MenuBar desktop download link', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the currently published artifact, not a hardcoded version', async () => {
    renderMenuBar();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /download/i });
      expect(link).toHaveAttribute('href', 'https://api.rmpgutah.us/downloads/RMPG-Flex-Setup-5.8.6.zip');
    });
  });

  it('hardcodes no version number anywhere', async () => {
    renderMenuBar();
    await waitFor(() => expect(screen.getByRole('link', { name: /download/i })).toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain('5.8.1');
  });
});
```

If `MenuBar` turns out to need further context providers beyond the Router, add them to `renderMenuBar` — the error message names the missing hook.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/components/__tests__/MenuBarDownload.test.tsx`

Expected: FAIL — the href is the hardcoded `5.8.1` Pages URL.

- [ ] **Step 3: Fetch the installer info in MenuBar**

Add near MenuBar's other state:

```tsx
const [winInstaller, setWinInstaller] = useState<{ url: string; version: string } | null>(null);

useEffect(() => {
  apiFetch<{ win?: { url: string; version: string } }>('/api/downloads/info')
    .then((info) => setWinInstaller(info.win ?? null))
    .catch(() => setWinInstaller(null));
}, []);
```

Ensure `apiFetch` is imported from `../hooks/useApi`.

- [ ] **Step 4: Replace both hardcoded URLs**

At both former hardcoded sites, use the fetched URL and skip rendering when it is unavailable:

```tsx
{winInstaller && (
  <a href={winInstaller.url} download>
    Download RMPG Flex for Windows ({winInstaller.version})
  </a>
)}
```

Hiding the link when the fetch fails is deliberate: a visible link to a URL known to be wrong is worse than no link, because it produces the 11 KB HTML file this whole phase exists to eliminate.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && npx vitest run src/components/__tests__/MenuBarDownload.test.tsx`

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/MenuBar.tsx client/src/components/__tests__/MenuBarDownload.test.tsx && git commit -m "fix(menubar): resolve the desktop installer from the API, not a stale hardcoded 5.8.1 URL"
```

---

## Task 4: Guard test making relative download links unrepresentable

**Files:**
- Create: `client/src/__tests__/downloadLinks.guard.test.ts`
- Modify: `client/src/pages/admin/AdminIPEDTab.tsx:441,463`

**Interfaces:**
- Consumes: `downloadUrl()` from `client/src/hooks/useApi.ts` (already exists).
- Produces: nothing — this is an enforcement mechanism.

The client has no ESLint (`"lint": "tsc --noEmit"`), so a source-scanning vitest is the available enforcement point. Modeled on `client/src/utils/__tests__/accentTokens.test.ts`.

- [ ] **Step 1: Write the guard test**

Create `client/src/__tests__/downloadLinks.guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

// useApi.ts owns downloadUrl() and legitimately contains the literal path.
const ALLOWLIST = new Set(['hooks/useApi.ts']);

/**
 * Every non-test .ts/.tsx file under client/src, as paths relative to src.
 *
 * Test files are excluded because they assert on URL strings by design —
 * including this file. Without that exclusion the guard fails on correct code.
 */
function sourceFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const relPath = rel ? `${rel}/${entry}` : entry;
    if (statSync(abs).isDirectory()) {
      if (entry === 'node_modules') continue;
      out.push(...sourceFiles(abs, relPath));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    if (ALLOWLIST.has(relPath)) continue;
    out.push(relPath);
  }
  return out;
}

const FILES = sourceFiles(SRC);

describe('download links never resolve against the Pages origin', () => {
  // A relative /downloads/<file> href resolves against rmpgutah.us (Pages),
  // where no route matches, so the `/*  /index.html  200` SPA catch-all
  // returns the app shell with HTTP 200. The browser then saves ~11 KB of
  // HTML under the artifact's filename and reports no error at all. Use the
  // server-provided installer.url, or downloadUrl() when only a filename is
  // known.
  it('has no href pointing at a relative /downloads/ path', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(join(SRC, file), 'utf8');
      if (/href=\{?[`'"]\/downloads\//.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  // A hardcoded rmpgutah.us origin is the same defect spelled out in full:
  // that host is Pages, not the Worker that serves /downloads/.
  it('has no hardcoded rmpgutah.us/downloads/ URL', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(join(SRC, file), 'utf8');
      if (/rmpgutah\.us\/downloads\//.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('actually scanned the tree', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });
});
```

The final assertion matters: a path bug that silently scans zero files would make the guard pass forever while enforcing nothing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/__tests__/downloadLinks.guard.test.ts`

Expected: FAIL, listing `pages/admin/AdminIPEDTab.tsx` (both patterns may also flag files not yet fixed if Tasks 2 and 3 are incomplete — that is correct behaviour).

- [ ] **Step 3: Fix AdminIPEDTab**

`AdminIPEDTab.tsx` links to IPED bundles by filename only, so it uses the helper rather than a server-provided URL. Add the import:

```tsx
import { downloadUrl } from '../../hooks/useApi';
```

Replace line 441:

```tsx
                  href={downloadUrl(downloads.bundles.mac.filename)}
```

Replace line 463:

```tsx
                  href={downloadUrl(downloads.bundles.win.filename)}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/__tests__/downloadLinks.guard.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Verify the guard actually catches a regression**

Temporarily add `href="/downloads/oops.zip"` to any component, then run the guard again. Expected: FAIL naming that file. Remove the line afterward. A guard never observed failing is not known to work.

- [ ] **Step 6: Run the full client suite**

Run: `cd client && npx vitest run`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/__tests__/downloadLinks.guard.test.ts client/src/pages/admin/AdminIPEDTab.tsx && git commit -m "test(downloads): fail CI on relative or Pages-origin download links"
```

---

## Task 5: Remove dead `_redirects` rules and add the zone route

**Files:**
- Modify: `client/public/_redirects:19-27`
- Modify: `wrangler.toml:39-41`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Test the two unverified rules before touching them**

Run: `curl -sS -I https://rmpgutah.us/updates/latest.yml`

Then: `curl -sS -I https://rmpgutah.us/download`

Record each `content-type`. `text/html` means the rule is dead and safe to delete. Anything else means it works via some other mechanism — leave that rule alone and note it in the commit message. `/downloads/*` (returns `text/html`) and `/rmpg-seal.png` (404s on both origins) were already verified dead on 2026-07-25.

- [ ] **Step 2: Delete the rules confirmed dead**

In `client/public/_redirects`, delete the `/downloads/*` and `/rmpg-seal.png` lines, plus `/updates/*` and `/download` only if Step 1 showed them dead. Replace the block comment above them with:

```
# NOTE: Cloudflare Pages supports redirect statuses (301/302/303/307/308) but
# NOT status-200 "rewrite to another origin", which is a Netlify feature. Rules
# written as `200` here are silently ignored and fall through to the `/*
# /index.html 200` catch-all below, which returns the app shell with HTTP 200 —
# so a download saves ~11 KB of HTML under the artifact's filename and nothing
# reports an error. Verified 2026-07-25.
#
# /api/* is intentionally KEPT: it is almost certainly inert too, surviving
# only because the separate rmpg-api-proxy Worker route covers the same path.
# But if that reasoning is wrong, deleting it breaks every API call, and
# removing one redundant line does not justify that risk.
```

Keep the `/api/*` rule and the `/assets/*  /index.html  404` rule exactly as they are.

- [ ] **Step 3: Add the zone route**

Append to `wrangler.toml` after the existing `[[routes]]` block:

```toml
# Serve /downloads/* from the app domain too, so a relative link still reaches
# the Worker instead of falling through to the Pages SPA catch-all. This
# mirrors the mechanism already proven by rmpg-api-proxy for /api/* — a zone
# route, not a _redirects rule, because Pages ignores status-200 rewrites to
# another origin.
#
# Deliberately a safety net, not the primary path: the API returns absolute
# URLs (see InstallerMeta.url) and a guard test forbids relative links. This
# only catches surfaces not yet found and links written later.
[[routes]]
pattern = "rmpgutah.us/downloads/*"
zone_name = "rmpgutah.us"
```

- [ ] **Step 4: Typecheck and confirm the config parses**

Run: `npx wrangler deploy --dry-run`

Expected: succeeds and lists both routes. An error here means the route syntax is wrong — fix before deploying, because a bad apex-zone route can shadow Pages paths.

- [ ] **Step 5: Commit**

```bash
git add client/public/_redirects wrangler.toml && git commit -m "fix(downloads): drop inert status-200 _redirects, add rmpgutah.us/downloads/* zone route"
```

- [ ] **Step 6: Post-deploy verification (after merge)**

Run: `curl -sS -I https://rmpgutah.us/downloads/kiosk-linux-os-1.2.0.zip`

Expected: `content-type: application/zip` — not `text/html`. Also confirm the SPA still loads at `https://rmpgutah.us/` and that `https://rmpgutah.us/api/health` still returns JSON, proving the new route did not shadow Pages or the API proxy.

---

## Task 6: SHA-256 + S3 multipart publisher

**Files:**
- Create: `scripts/publish-download.mjs`
- Modify: `package.json` (add `@aws-sdk/client-s3` to devDependencies)
- Modify: `kiosk-linux/RELEASE.md:36-45`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: R2 objects carrying `customMetadata.sha256`, which Task 1's `toMeta()` reads.

**Prerequisite:** `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` must exist in the environment (or `.dev.vars`). These are R2 **S3 API** credentials from the R2 dashboard, not `CLOUDFLARE_API_TOKEN`. Without them this task can be written and unit-tested but not run against R2.

- [ ] **Step 1: Add the dependency**

Run: `npm install --save-dev @aws-sdk/client-s3`

- [ ] **Step 2: Write the publisher**

Create `scripts/publish-download.mjs`:

```js
#!/usr/bin/env node
/**
 * Publish an artifact to the rmpg-flex-downloads R2 bucket.
 *
 *   node scripts/publish-download.mjs <file> [objectKey]
 *
 * Replaces `wrangler r2 object put`, which rejects anything over 300 MiB and
 * fails in MILLISECONDS — so a command that appears to have succeeded is not
 * evidence an upload happened. Wrangler exposes no multipart flag, so the S3
 * API is the only path for the 236 MiB OS image and the bundled installers
 * planned for Phase 2.
 *
 * Also computes the SHA-256 and stores it as customMetadata.sha256, which
 * /api/downloads/info surfaces. The R2 etag cannot substitute: for a multipart
 * object it is the hash of concatenated per-part MD5 sums plus "-<partCount>",
 * not a content hash.
 *
 * Requires R2 S3 API credentials (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY),
 * which are distinct from CLOUDFLARE_API_TOKEN.
 */
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_DOWNLOADS_BUCKET || 'rmpg-flex-downloads';

// R2 requires every part except the last to be the SAME size, minimum 5 MiB,
// with at most 10,000 parts. 64 MiB gives ample headroom (640 GiB ceiling).
const PART_SIZE = 64 * 1024 * 1024;
// Below this, a single PUT is simpler and R2 allows up to 5 GiB that way.
const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

const MIME = {
  '.dmg': 'application/x-apple-diskimage',
  '.exe': 'application/x-msdownload',
  '.apk': 'application/vnd.android.package-archive',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.yml': 'text/yaml',
  '.txt': 'text/plain; charset=utf-8',
};

function contentTypeFor(name) {
  if (name.endsWith('.tar.gz')) return 'application/gzip';
  const dot = name.lastIndexOf('.');
  return (dot >= 0 && MIME[name.slice(dot)]) || 'application/octet-stream';
}

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const [file, keyArg] = process.argv.slice(2);
  if (!file) die('usage: node scripts/publish-download.mjs <file> [objectKey]');
  for (const [name, val] of Object.entries({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, R2_ACCESS_KEY_ID: ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY })) {
    if (!val) die(`${name} is not set. R2 S3 credentials come from the R2 dashboard and are NOT CLOUDFLARE_API_TOKEN.`);
  }

  const key = keyArg || basename(file);
  const { size } = await stat(file).catch(() => die(`cannot read ${file}`));
  const contentType = contentTypeFor(key);

  process.stdout.write(`Hashing ${key} (${size} bytes)… `);
  const sha256 = await sha256File(file);
  console.log(sha256);

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
  });
  const metadata = { sha256 };

  if (size < MULTIPART_THRESHOLD) {
    console.log(`Uploading ${key} in a single request…`);
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: await readFile(file), ContentType: contentType, Metadata: metadata,
    }));
  } else {
    const created = await s3.send(new CreateMultipartUploadCommand({
      Bucket: BUCKET, Key: key, ContentType: contentType, Metadata: metadata,
    }));
    const uploadId = created.UploadId;
    const total = Math.ceil(size / PART_SIZE);
    console.log(`Uploading ${key} as ${total} parts of ${PART_SIZE} bytes…`);
    const parts = [];
    try {
      for (let n = 1; n <= total; n++) {
        const start = (n - 1) * PART_SIZE;
        const end = Math.min(start + PART_SIZE, size) - 1;
        const body = await new Promise((res, rej) => {
          const chunks = [];
          createReadStream(file, { start, end })
            .on('data', (c) => chunks.push(c))
            .on('end', () => res(Buffer.concat(chunks)))
            .on('error', rej);
        });
        const { ETag } = await s3.send(new UploadPartCommand({
          Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: n, Body: body,
        }));
        parts.push({ ETag, PartNumber: n });
        process.stdout.write(`  part ${n}/${total} ok\n`);
      }
      await s3.send(new CompleteMultipartUploadCommand({
        Bucket: BUCKET, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts },
      }));
    } catch (err) {
      // Abort so orphaned parts stop accruing storage charges, and so no
      // half-written object is ever addressable.
      await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId })).catch(() => {});
      die(`upload failed at part ${parts.length + 1} of ${total}: ${err.message}`);
    }
  }

  console.log(`\nPublished ${key}`);
  console.log(`  sha256: ${sha256}`);
  console.log(`  verify: curl -sI https://api.rmpgutah.us/downloads/${encodeURIComponent(key)}`);
}

main();
```

- [ ] **Step 3: Verify the script's guard rails without touching R2**

Run: `node scripts/publish-download.mjs`

Expected: exits non-zero with the usage message.

Run: `R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= node scripts/publish-download.mjs package.json`

Expected: exits non-zero naming the missing credential and stating it is not `CLOUDFLARE_API_TOKEN`.

- [ ] **Step 4: Publish a real artifact (requires credentials)**

Re-publish the current OS image so it gains a checksum:

```bash
node scripts/publish-download.mjs ~/Downloads/kiosk-linux-os-1.2.0.zip
```

Expected: multipart path, all parts OK, prints a 64-character hex digest.

- [ ] **Step 5: Confirm the checksum round-trips through the API**

Run: `curl -sS https://api.rmpgutah.us/api/downloads/info | python3 -m json.tool`

Expected: the `os` entry now carries both `url` and a `sha256` matching Step 4's digest.

- [ ] **Step 6: Update RELEASE.md**

In `kiosk-linux/RELEASE.md`, replace the step 3 `wrangler r2 object put` instructions with:

```markdown
3. **Upload**: `node scripts/publish-download.mjs kiosk-linux-os-<version>.zip`
   (and again for the `.tar.gz`). This computes the SHA-256, stores it as R2
   custom metadata so `/api/downloads/info` can publish it, and uploads via S3
   multipart.

   **Do not use `wrangler r2 object put`.** It rejects anything over 300 MiB
   and fails in milliseconds, so a command that looks like it finished is not
   evidence the upload happened. Requires `R2_ACCESS_KEY_ID` and
   `R2_SECRET_ACCESS_KEY` (R2 dashboard → Manage R2 API Tokens → Object Read &
   Write); these are NOT `CLOUDFLARE_API_TOKEN`.
```

- [ ] **Step 7: Commit**

```bash
git add scripts/publish-download.mjs package.json package-lock.json kiosk-linux/RELEASE.md && git commit -m "feat(downloads): S3 multipart publisher with SHA-256, replacing the 300 MiB-capped wrangler put"
```

---

## Task 7: Backfill checksums for existing artifacts

**Files:**
- Create: `scripts/backfill-download-checksums.mjs`

**Interfaces:**
- Consumes: the same R2 S3 credentials and `customMetadata.sha256` convention as Task 6.
- Produces: `sha256` metadata on artifacts published before Task 6 existed.

Four artifacts predate the publisher. Rather than re-uploading hundreds of megabytes, this downloads each, hashes it, and copies the object onto itself with metadata attached — R2 supports `CopyObject` with `MetadataDirective: 'REPLACE'`.

> **This supersedes the spec's "checksum mismatch on backfill" error case.** The spec anticipated hashing a *local* copy, which could disagree with what R2 actually holds. Hashing the stored object directly makes a mismatch impossible by construction, so there is no mismatch branch to write. The stronger property is worth the deviation; the spec's bullet is obsolete rather than unmet.

- [ ] **Step 1: Write the backfill script**

Create `scripts/backfill-download-checksums.mjs`:

```js
#!/usr/bin/env node
/**
 * Add customMetadata.sha256 to artifacts published before
 * scripts/publish-download.mjs existed.
 *
 *   node scripts/backfill-download-checksums.mjs [--apply]
 *
 * Without --apply it only reports what it would do. Hashing streams the object
 * rather than buffering it, so a 236 MiB image costs no meaningful memory.
 *
 * Uses CopyObject onto the same key with MetadataDirective REPLACE, so the
 * bytes are never re-uploaded.
 */
import {
  S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_DOWNLOADS_BUCKET || 'rmpg-flex-downloads';
const APPLY = process.argv.includes('--apply');

// Only real download artifacts. latest.yml / latest-mac.yml / blockmaps are
// electron-updater feed files, not things a person downloads and verifies.
const ARTIFACT = /\.(dmg|exe|apk|zip|tar\.gz)$/;

function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

async function main() {
  for (const [name, val] of Object.entries({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, R2_ACCESS_KEY_ID: ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY })) {
    if (!val) die(`${name} is not set.`);
  }
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
  });

  let token;
  const keys = [];
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }));
    for (const o of page.Contents || []) if (ARTIFACT.test(o.Key) && !o.Key.includes('blockmap')) keys.push(o.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  console.log(`${keys.length} artifact(s) found${APPLY ? '' : ' (dry run — pass --apply to write)'}\n`);

  for (const key of keys) {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    if (head.Metadata?.sha256) { console.log(`skip  ${key} — already has sha256`); continue; }

    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const hash = createHash('sha256');
    for await (const chunk of obj.Body) hash.update(chunk);
    const sha256 = hash.digest('hex');

    if (!APPLY) { console.log(`would  ${key} -> ${sha256}`); continue; }

    await s3.send(new CopyObjectCommand({
      Bucket: BUCKET,
      Key: key,
      CopySource: `${BUCKET}/${encodeURIComponent(key)}`,
      ContentType: head.ContentType,
      Metadata: { ...(head.Metadata || {}), sha256 },
      MetadataDirective: 'REPLACE',
    }));
    console.log(`wrote  ${key} -> ${sha256}`);
  }
}

main();
```

- [ ] **Step 2: Dry-run it**

Run: `node scripts/backfill-download-checksums.mjs`

Expected: lists each artifact with the digest it *would* write, and writes nothing. Confirm the count matches the bucket (4 artifacts plus any published in Task 6).

- [ ] **Step 3: Apply it**

Run: `node scripts/backfill-download-checksums.mjs --apply`

Expected: `wrote` lines for artifacts lacking a checksum, `skip` for the one Task 6 already published.

- [ ] **Step 4: Confirm all four artifacts now carry a checksum**

Run: `curl -sS https://api.rmpgutah.us/api/downloads/info | python3 -m json.tool`

Expected: `win`, `mac`, `android`, and `os` each have `url` and `sha256`.

- [ ] **Step 5: Spot-check one digest end to end**

```bash
curl -fL -o /tmp/verify.zip https://api.rmpgutah.us/downloads/kiosk-linux-os-1.2.0.zip && shasum -a 256 /tmp/verify.zip
```

Expected: matches the `os.sha256` from Step 4. This is the acceptance test for the whole integrity feature — a published checksum nobody has verified against a real download proves nothing.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-download-checksums.mjs && git commit -m "feat(downloads): backfill SHA-256 metadata onto pre-existing artifacts"
```

---

## Final verification

Run all four gates. The baseline was clean on 2026-07-25, so any failure is caused by this work.

- [ ] `npm run typecheck` — Worker types
- [ ] `npx vitest run` — Worker suite (expect 254+ files pass)
- [ ] `cd client && npx tsc --noEmit` — client types
- [ ] `cd client && npx vitest run` — full client suite
- [ ] `cd client && npx vite build` — client build

Then confirm the acceptance criteria from the spec:

- [ ] `curl -sI https://rmpgutah.us/downloads/kiosk-linux-os-1.2.0.zip` returns `application/zip`
- [ ] `curl -sI https://api.rmpgutah.us/api/health` still returns JSON (the new zone route shadowed nothing)
- [ ] `https://rmpgutah.us/` still loads the SPA
- [ ] Every download button resolves to a real binary: public page, Admin Downloads tab, Admin IPED tab, menu bar
- [ ] `/api/downloads/info` returns `url` + `sha256` for all four artifacts
- [ ] Adding a relative `/downloads/` href fails `cd client && npx vitest run`
- [ ] An artifact over 300 MiB publishes and downloads intact
