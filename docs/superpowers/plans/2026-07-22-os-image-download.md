# Kiosk Linux OS Image Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Kiosk Linux OS image (`bzImage` + `rootfs.cpio.gz`) downloadable
from the public `/downloads` page and the Admin Downloads tab, reusing the existing
`DOWNLOADS` R2 bucket, `scanInstallers()` detection logic, and `serveDownloadFile()`
route — no new backend infrastructure, no CI pipeline.

**Architecture:** Extend the existing `InstallerInfo` type and `scanInstallers()`
function in `src/routes/downloads.ts` with a fourth category (`os`), detected by a
`kiosk-linux-os-*.tar.gz` filename pattern. Extend both existing frontend components
(`DownloadsPage.tsx`, `AdminDownloadsTab.tsx`) with a fourth platform card. Package
and upload the actual artifact manually, once, as a separate ops step.

**Tech Stack:** Hono route handlers (existing, `src/routes/downloads.ts`), Cloudflare
R2 (existing `DOWNLOADS` binding), React/TypeScript (`client/`), Vitest.

## Global Constraints

- No new R2 bucket, no new route file — extend `src/routes/downloads.ts` in place.
- No CI/automated build pipeline — packaging and upload are manual, one-time (per
  this update), repeatable steps, documented for whoever does the next one.
- The existing `verLt()`/`extractVersion()` logic must be reused as-is for the `os`
  category — do not write new version-comparison logic.
- A missing `os` entry (no upload done yet) must render as "Not available", the
  exact same fallback both UIs already use for other platforms — not a new error
  state.
- `serveDownloadFile()`'s `Content-Disposition: attachment` list must be extended to
  include `.tar.gz` so browsers download rather than attempt to preview it.

---

## File Structure

- **Modify:** `src/routes/downloads.ts` — extend `InstallerInfo`, `scanInstallers()`,
  `serveDownloadFile()`'s MIME/Content-Disposition handling; export `scanInstallers`
  for testing.
- **Create:** `tests/downloadsOsImage.test.ts` — tests for the new `os` detection
  branch, using a mock `R2Bucket`.
- **Modify:** `client/src/pages/DownloadsPage.tsx` — add `'os'` to the `Platform`
  union, `PLATFORM_CONFIG`, `platforms` array, and (since this page has an
  install-instructions `STEPS` object keyed by platform) a minimal `os` entry there
  too, so the existing per-platform tab rendering doesn't break on a missing key.
- **Modify:** `client/src/pages/admin/AdminDownloadsTab.tsx` — add `'os'` to the
  `Platform` union, `PLATFORM_CONFIG`, and `PLATFORMS` array.
- **Modify:** `client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx` — extend
  the existing test fixtures with an `os` entry.
- **Create:** `kiosk-linux/RELEASE.md` — documents the manual packaging/upload
  recipe for whoever does this next.

---

### Task 1: Backend — detect and serve the `os` category

**Files:**
- Modify: `src/routes/downloads.ts`
- Create: `tests/downloadsOsImage.test.ts`

**Interfaces:**
- Produces: `scanInstallers` now exported; `InstallerInfo` now has an optional `os:
  InstallerMeta` field — consumed by Task 2's frontend types (which must add the
  matching field independently in their own `DownloadsInfo` interfaces, since the
  frontend doesn't import this backend type directly — confirm this by checking
  how the existing `win`/`mac`/`android` fields are already duplicated between
  `src/routes/downloads.ts`'s `InstallerInfo` and each frontend file's own
  `DownloadsInfo` interface, and follow that same existing duplication pattern for
  `os`, not a new shared-type import).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/downloadsOsImage.test.ts
import { describe, it, expect } from 'vitest';
import { scanInstallers } from '../src/routes/downloads';

function fakeBucket(objects: Array<{ key: string; size: number; uploaded: Date }>) {
  return {
    list: async () => ({ objects }),
    get: async (key: string) => {
      const obj = objects.find((o) => o.key === key);
      return obj ? { size: obj.size, arrayBuffer: async () => new ArrayBuffer(obj.size) } : null;
    },
  } as any;
}

describe('scanInstallers — os (Kiosk Linux) detection', () => {
  it('detects a kiosk-linux-os-*.tar.gz file as the os category', async () => {
    const bucket = fakeBucket([
      { key: 'kiosk-linux-os-1.0.0.tar.gz', size: 15_728_640, uploaded: new Date('2026-07-22T00:00:00Z') },
    ]);
    const info = await scanInstallers(bucket);
    expect(info.os).toBeDefined();
    expect(info.os?.filename).toBe('kiosk-linux-os-1.0.0.tar.gz');
    expect(info.os?.version).toBe('1.0.0');
    expect(info.os?.size).toBe('15.0 MB');
  });

  it('picks the highest version when multiple os archives exist', async () => {
    const bucket = fakeBucket([
      { key: 'kiosk-linux-os-1.0.0.tar.gz', size: 1000, uploaded: new Date('2026-07-01T00:00:00Z') },
      { key: 'kiosk-linux-os-1.2.0.tar.gz', size: 2000, uploaded: new Date('2026-07-22T00:00:00Z') },
    ]);
    const info = await scanInstallers(bucket);
    expect(info.os?.filename).toBe('kiosk-linux-os-1.2.0.tar.gz');
  });

  it('leaves os undefined when no matching file exists', async () => {
    const bucket = fakeBucket([
      { key: 'RMPG-Flex-Setup-5.8.4.exe', size: 1000, uploaded: new Date() },
    ]);
    const info = await scanInstallers(bucket);
    expect(info.os).toBeUndefined();
  });

  it('does not misclassify an unrelated .tar.gz file', async () => {
    const bucket = fakeBucket([
      { key: 'some-other-archive-2.0.0.tar.gz', size: 1000, uploaded: new Date() },
    ]);
    const info = await scanInstallers(bucket);
    expect(info.os).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/downloadsOsImage.test.ts`
Expected: FAIL — `scanInstallers` is not exported (or not found)

- [ ] **Step 3: Export `scanInstallers` and extend `InstallerInfo`**

In `src/routes/downloads.ts`, change:
```ts
interface InstallerInfo {
  win?: InstallerMeta;
  mac?: InstallerMeta;
  android?: InstallerMeta;
}
```
to:
```ts
interface InstallerInfo {
  win?: InstallerMeta;
  mac?: InstallerMeta;
  android?: InstallerMeta;
  os?: InstallerMeta;
}
```

Change `async function scanInstallers(bucket: R2Bucket): Promise<InstallerInfo> {`
to `export async function scanInstallers(bucket: R2Bucket): Promise<InstallerInfo> {`

- [ ] **Step 4: Add the `os` detection branch**

Inside `scanInstallers()`'s existing `for (const obj of list.objects)` loop, add a
new `else if` branch alongside the existing `.dmg`/`.exe`/`.apk` checks:

```ts
    } else if (name.endsWith('.tar.gz') && name.startsWith('kiosk-linux-os-')) {
      if (!info.os || verLt(info.os.version, version)) info.os = meta;
    }
```

(Insert this as an additional `else if` in the existing `if (name.endsWith('.dmg')
...) { ... } else if (name.endsWith('.exe') ...) { ... } else if (name.endsWith('.apk'))
{ ... }` chain — add it as the final `else if` in that same chain, before the
chain's closing brace.)

- [ ] **Step 5: Extend the Content-Disposition list in `serveDownloadFile`**

In `serveDownloadFile()`, change:
```ts
  if (filename.endsWith('.dmg') || filename.endsWith('.exe') || filename.endsWith('.apk') || filename.endsWith('.zip')) {
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
  }
```
to:
```ts
  if (filename.endsWith('.dmg') || filename.endsWith('.exe') || filename.endsWith('.apk') || filename.endsWith('.zip') || filename.endsWith('.tar.gz')) {
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/downloadsOsImage.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 7: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/routes/downloads.ts tests/downloadsOsImage.test.ts
git commit -m "feat(downloads): detect and serve Kiosk Linux OS image archives"
```

---

### Task 2: Frontend — add the "Kiosk Linux OS" card to both UIs

**Files:**
- Modify: `client/src/pages/DownloadsPage.tsx`
- Modify: `client/src/pages/admin/AdminDownloadsTab.tsx`
- Modify: `client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx`

**Interfaces:**
- Consumes: the backend's `os` field in `/api/downloads/info` responses (Task 1).
- Produces: both UIs render a 4th card/row for `os` when present, "Not available"
  when absent — no new exported interface, this task only extends existing
  component-local types.

- [ ] **Step 1: Extend `AdminDownloadsTab.tsx`'s types and config**

In `client/src/pages/admin/AdminDownloadsTab.tsx`, change:
```ts
type Platform = 'win' | 'mac' | 'android';
```
to:
```ts
type Platform = 'win' | 'mac' | 'android' | 'os';
```

Change:
```ts
interface DownloadsInfo {
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
}
```
to:
```ts
interface DownloadsInfo {
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
  os?: InstallerMeta;
}
```

Change:
```ts
const PLATFORM_CONFIG: Record<Platform, { label: string; icon: React.ElementType }> = {
  win: { label: 'Windows', icon: Monitor },
  mac: { label: 'macOS', icon: Apple },
  android: { label: 'Android', icon: Smartphone },
};

const PLATFORMS: Platform[] = ['win', 'mac', 'android'];
```
to:
```ts
const PLATFORM_CONFIG: Record<Platform, { label: string; icon: React.ElementType }> = {
  win: { label: 'Windows', icon: Monitor },
  mac: { label: 'macOS', icon: Apple },
  android: { label: 'Android', icon: Smartphone },
  os: { label: 'Kiosk Linux OS', icon: HardDrive },
};

const PLATFORMS: Platform[] = ['win', 'mac', 'android', 'os'];
```

Add `HardDrive` to the existing `lucide-react` import line at the top of the file
(the one currently reading `import { Monitor, Apple, Smartphone, Download,
ExternalLink } from 'lucide-react';`).

Since the platform card grid is currently `className="grid grid-cols-1
sm:grid-cols-3 gap-3"` (3 columns for 3 platforms), change it to `sm:grid-cols-2
lg:grid-cols-4` so a 4th card doesn't force an awkward 4-into-3 wrap on medium
screens.

- [ ] **Step 2: Extend the existing test with an `os` fixture**

In `client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx`, add `os: {
filename: 'kiosk-linux-os-1.0.0.tar.gz', version: '1.0.0', size: '15.0 MB', bytes:
15728640 }` to the mocked response object in the "fetches /api/downloads/info and
renders all present platforms" test, and add an assertion:

```ts
expect(screen.getByText(/15\.0 MB/)).toBeInTheDocument();
const osLink = screen.getByRole('link', { name: /kiosk linux os/i });
expect(osLink).toHaveAttribute('href', '/downloads/kiosk-linux-os-1.0.0.tar.gz');
```

- [ ] **Step 3: Run the Admin test suite**

Run: `cd client && npx vitest run src/pages/admin/__tests__/AdminDownloadsTab.test.tsx`
Expected: PASS — all tests including the new `os` assertions.

- [ ] **Step 4: Extend `DownloadsPage.tsx`'s types and config**

In `client/src/pages/DownloadsPage.tsx`, change:
```ts
type Platform = 'win' | 'mac' | 'android';
```
to:
```ts
type Platform = 'win' | 'mac' | 'android' | 'os';
```

Change:
```ts
interface DownloadsInfo {
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
}
```
to:
```ts
interface DownloadsInfo {
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
  os?: InstallerMeta;
}
```

Add an `os` entry to `PLATFORM_CONFIG` (this page's version has more fields per
platform than the Admin tab's — `arch`, `ext`, `buttonLabel` — match that existing
shape exactly):
```ts
  os: {
    label: 'Kiosk Linux OS',
    arch: 'x86_64 (QEMU/virtio-gpu)',
    icon: HardDrive,
    ext: '.tar.gz',
    buttonLabel: 'Download .tar.gz',
  },
```

Add `HardDrive` to this file's existing `lucide-react` import
(`import { Monitor, Apple, Smartphone, Download, ChevronRight } from
'lucide-react';`).

Add `'os'` to the `platforms: Platform[] = ['win', 'mac', 'android'];` array (→
`['win', 'mac', 'android', 'os'];`).

This page also has a `platformFromFileId()` deep-link helper and a `STEPS` object
keyed by platform for install instructions — both need an `os` case so the page
doesn't crash on a missing key when `activeTab` is `'os'`. Add to
`platformFromFileId`:
```ts
  if (lower === 'os' || lower.includes('kiosk-linux') || lower.endsWith('.tar.gz')) return 'os';
```
(insert as an additional `if` before the final `win` fallback check).

Add to `STEPS`:
```ts
    os: {
      title: 'Kiosk Linux OS',
      steps: [
        'Download the .tar.gz archive using the button above.',
        'Extract it: tar xzf kiosk-linux-os-<version>.tar.gz',
        'This produces bzImage (kernel) and rootfs.cpio.gz (root filesystem).',
        'Boot under QEMU: qemu-system-x86_64 -kernel bzImage -initrd rootfs.cpio.gz -append "console=ttyS0" -nographic',
      ],
      warning: 'This image currently targets QEMU/virtio-gpu only — it is not yet built or tested for real hardware. See kiosk-linux/README.md in the source repository for the full scope and current limitations.',
    },
```

Since this page's grid is `grid-cols-1 md:grid-cols-3` for the download cards,
change it to `md:grid-cols-2 lg:grid-cols-4` for the same reason as Task 2 Step 1.

- [ ] **Step 5: Verify the client build and typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

Run: `cd client && npx vitest run`
Expected: all existing tests pass, including the extended `AdminDownloadsTab.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/DownloadsPage.tsx client/src/pages/admin/AdminDownloadsTab.tsx client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx
git commit -m "feat(downloads): add Kiosk Linux OS card to public and admin download UIs"
```

---

### Task 3: Package, upload, and document the release process

**Files:**
- Create: `kiosk-linux/RELEASE.md`

**Interfaces:** None — this is an ops/documentation task, plus the actual one-time
upload action.

- [ ] **Step 1: Build the OS image (if not already built)**

```bash
cd kiosk-linux
./build.sh
```

Expected: `output/images/bzImage` and `output/images/rootfs.cpio.gz` exist (per the
existing, already-verified build process from the prior sub-projects).

- [ ] **Step 2: Package into a single archive**

```bash
cd kiosk-linux/output/images
tar czf kiosk-linux-os-1.0.0.tar.gz bzImage rootfs.cpio.gz
ls -la kiosk-linux-os-1.0.0.tar.gz
```

Pick the version string to match this being the first published OS image release
(`1.0.0`) — document in `RELEASE.md` (Step 4 below) that this is independent of the
RMPG Flex app's own version number, since the OS image has its own release
lifecycle.

- [ ] **Step 3: Upload to the `DOWNLOADS` R2 bucket**

```bash
wrangler r2 object put rmpg-flex-downloads/kiosk-linux-os-1.0.0.tar.gz \
  --file=kiosk-linux-os-1.0.0.tar.gz \
  --remote
```

(Confirm the actual R2 bucket name bound to `DOWNLOADS` first —
`grep -A3 'binding = "DOWNLOADS"' ../../wrangler.toml` — the command above assumes
`rmpg-flex-downloads`; adjust to the real bucket name shown in `wrangler.toml` if
different.)

Verify the upload succeeded and is visible to the Worker:
```bash
curl -sf https://api.rmpgutah.us/api/downloads/info | grep -o '"os":{[^}]*}'
```
Expected: a JSON fragment showing the `os` field with `filename:
"kiosk-linux-os-1.0.0.tar.gz"`.

- [ ] **Step 4: Write the release recipe doc**

```markdown
# kiosk-linux/RELEASE.md

How to publish a new Kiosk Linux OS image release for download from
rmpgutah.us/downloads and the Admin console's Downloads tab.

This is a manual, one-time-per-release process — there is no CI pipeline for
this yet (Buildroot doesn't build on macOS directly; see build.sh's own
comments for the Colima/Docker toolchain this requires).

## Steps

1. Build: `cd kiosk-linux && ./build.sh` — produces
   `output/images/{bzImage,rootfs.cpio.gz}`.
2. Package: `cd output/images && tar czf kiosk-linux-os-<version>.tar.gz
   bzImage rootfs.cpio.gz` — `<version>` is this OS image's own release
   number (independent of the RMPG Flex app version — this is a separate
   artifact with its own release lifecycle).
3. Upload: `wrangler r2 object put <DOWNLOADS bucket name, see
   wrangler.toml>/kiosk-linux-os-<version>.tar.gz --file=kiosk-linux-os-<version>.tar.gz --remote`
4. Verify: `curl -sf https://api.rmpgutah.us/api/downloads/info` should show
   an `os` field with the new filename/version. The public `/downloads` page
   and the Admin Downloads tab both pick this up automatically — no code
   deploy needed for a routine version bump, only for this file's own
   packaging/upload steps.
5. To supersede an old version: just upload the new `.tar.gz` under a higher
   version number — `scanInstallers()` already picks the highest version
   present, old files are not deleted automatically (delete manually via
   `wrangler r2 object delete` if reclaiming space matters).
```

- [ ] **Step 5: Commit**

```bash
git add kiosk-linux/RELEASE.md
git commit -m "docs(kiosk-linux): document the manual OS image release process"
```
