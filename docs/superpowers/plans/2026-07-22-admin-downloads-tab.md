# Admin Downloads Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing, already-working public installer-download flow
(`/api/downloads/info`, `/downloads/<filename>`) as a read-only tab inside the Admin
console, so an admin doesn't need to know the standalone `/downloads` URL exists.

**Architecture:** One new self-contained component, `AdminDownloadsTab.tsx`, following
the exact `Admin<Name>Tab.tsx` convention already used by ~35 other Admin tabs. It
calls the same `apiFetch('/api/downloads/info')` the public `DownloadsPage.tsx`
already calls — no new backend code. Wired into `AdminPage.tsx`'s existing
`VALID_TABS` array, tab-config array, and `activeTab === '...'` render switch.

**Tech Stack:** React + TypeScript (client/), existing `apiFetch` helper, Vitest +
React Testing Library (existing `client/src/pages/admin/__tests__/` convention).

## Global Constraints

- No backend changes — `/api/downloads/info` and `/downloads/<filename>` already
  exist and are unmodified by this plan.
- No embedding/duplicating the full public `DownloadsPage.tsx` chrome (its own
  header, hero, install-instructions, footer) — this tab is a focused, read-only
  summary that links out to `/downloads` for the full experience.
- Read-only: no upload/version-management UI, no new admin actions.
- Follow the existing `Admin<Name>Tab.tsx` file-per-tab convention and the existing
  `client/src/pages/admin/__tests__/Admin<Name>Tab.test.tsx` mocking convention
  (`vi.stubGlobal('fetch', ...)` matching on URL substring, not `apiFetch`-level
  mocking) exactly — do not invent a new pattern.

---

## File Structure

- **Create:** `client/src/pages/admin/AdminDownloadsTab.tsx` — the tab component:
  fetches `/api/downloads/info`, renders one row per platform (version, size,
  download button), an error state, and a link to the full `/downloads` page.
- **Create:** `client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx` — tests
  for loading/success/error/missing-platform states.
- **Modify:** `client/src/pages/AdminPage.tsx` — add `'downloads'` to `VALID_TABS`
  (line 278), add a `{ id: 'downloads', label: 'Downloads', icon: Download }` entry
  to the tab-config array (near the `system`/`health` group, ~line 707-713), add the
  `import AdminDownloadsTab from './admin/AdminDownloadsTab';` import, add the
  `Download` icon to the existing `lucide-react` import block, and add the
  `{activeTab === 'downloads' && <AdminDownloadsTab />}` render block (near the
  `map_data_files`/`health` blocks, ~line 1062-1072).

---

### Task 1: `AdminDownloadsTab` component

**Files:**
- Create: `client/src/pages/admin/AdminDownloadsTab.tsx`
- Test: `client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx`

**Interfaces:**
- Produces: `export default function AdminDownloadsTab(): JSX.Element` — a
  zero-props component (matching `AdminMapDataTab`'s convention: no shared
  `LoadingSpinner`/`error`/`setError` props needed since this tab manages its own
  self-contained loading/error state, same as the public `DownloadsPage.tsx` does).
  Consumed by Task 2's render block in `AdminPage.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AdminDownloadsTab from '../AdminDownloadsTab';

function stub(handlers: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    for (const path of Object.keys(handlers)) {
      if (url.includes(path)) {
        return Promise.resolve(new Response(JSON.stringify(handlers[path]), { status: 200 }));
      }
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  }));
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('<AdminDownloadsTab>', () => {
  it('fetches /api/downloads/info and renders all present platforms', async () => {
    stub({
      '/api/downloads/info': {
        win: { filename: 'RMPG-Flex-Setup-5.8.4.zip', version: '5.8.4', size: '142 MB', bytes: 148897792 },
        mac: { filename: 'RMPG-Flex-5.8.4.dmg', version: '5.8.4', size: '138 MB', bytes: 144703488 },
        android: { filename: 'RMPG-Flex-5.8.4.apk.zip', version: '5.8.4', size: '45 MB', bytes: 47185920 },
      },
    });
    render(<AdminDownloadsTab />);
    await waitFor(() => expect(screen.getByText(/v5\.8\.4/)).toBeInTheDocument());
    expect(screen.getByText(/142 MB/)).toBeInTheDocument();
    expect(screen.getByText(/138 MB/)).toBeInTheDocument();
    expect(screen.getByText(/45 MB/)).toBeInTheDocument();

    const winLink = screen.getByRole('link', { name: /windows/i });
    expect(winLink).toHaveAttribute('href', '/downloads/RMPG-Flex-Setup-5.8.4.zip');
    const macLink = screen.getByRole('link', { name: /macos/i });
    expect(macLink).toHaveAttribute('href', '/downloads/RMPG-Flex-5.8.4.dmg');
    const androidLink = screen.getByRole('link', { name: /android/i });
    expect(androidLink).toHaveAttribute('href', '/downloads/RMPG-Flex-5.8.4.apk.zip');
  });

  it('shows "Not available" for a platform missing from the response', async () => {
    stub({
      '/api/downloads/info': {
        win: { filename: 'RMPG-Flex-Setup-5.8.4.zip', version: '5.8.4', size: '142 MB', bytes: 148897792 },
        // mac and android omitted
      },
    });
    render(<AdminDownloadsTab />);
    await waitFor(() => expect(screen.getAllByText(/not available/i)).toHaveLength(2));
  });

  it('shows an error message when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(<AdminDownloadsTab />);
    await waitFor(() => expect(screen.getByText(/could not load download info/i)).toBeInTheDocument());
  });

  it('links out to the full public downloads page', async () => {
    stub({ '/api/downloads/info': {} });
    render(<AdminDownloadsTab />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    const fullPageLink = screen.getByRole('link', { name: /open full downloads page/i });
    expect(fullPageLink).toHaveAttribute('href', '/downloads');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/pages/admin/__tests__/AdminDownloadsTab.test.tsx`
Expected: FAIL — cannot find module `../AdminDownloadsTab`

- [ ] **Step 3: Write the component**

```tsx
// client/src/pages/admin/AdminDownloadsTab.tsx
import React, { useEffect, useState } from 'react';
import { Monitor, Apple, Smartphone, Download, ExternalLink } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

type Platform = 'win' | 'mac' | 'android';

interface InstallerMeta {
  filename: string;
  version: string;
  size: string;
  bytes: number;
  releaseDate?: string;
}

interface DownloadsInfo {
  mac?: InstallerMeta;
  win?: InstallerMeta;
  android?: InstallerMeta;
}

const PLATFORM_CONFIG: Record<Platform, { label: string; icon: React.ElementType }> = {
  win: { label: 'Windows', icon: Monitor },
  mac: { label: 'macOS', icon: Apple },
  android: { label: 'Android', icon: Smartphone },
};

const PLATFORMS: Platform[] = ['win', 'mac', 'android'];

export default function AdminDownloadsTab() {
  const [info, setInfo] = useState<DownloadsInfo>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    apiFetch<DownloadsInfo>('/api/downloads/info')
      .then((data) => {
        setInfo(data);
        setLoading(false);
      })
      .catch(() => {
        setFetchError(true);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-xs uppercase tracking-wider" style={{ color: 'var(--rmpg-500)' }}>
        Loading download info…
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--sev-critical, var(--rmpg-400))' }}>
        Could not load download info — check your connection and refresh.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PLATFORMS.map((p) => {
          const installer = info[p];
          const { label, icon: Icon } = PLATFORM_CONFIG[p];
          return (
            <div
              key={p}
              className="flex flex-col items-start p-3 gap-2"
              style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" style={{ color: 'var(--brand-gold)' }} />
                <span className="text-xs font-bold uppercase tracking-wider text-rmpg-100">{label}</span>
              </div>
              {installer ? (
                <>
                  <span className="text-[11px]" style={{ color: 'var(--rmpg-500)' }}>
                    v{installer.version} — {installer.size}
                  </span>
                  <a
                    href={`/downloads/${encodeURIComponent(installer.filename)}`}
                    download={installer.filename}
                    aria-label={label}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
                    style={{ border: '1px solid var(--brand-gold)', color: 'var(--brand-gold)', borderRadius: 2 }}
                  >
                    <Download className="w-3 h-3" />
                    Download
                  </a>
                </>
              ) : (
                <span className="text-[11px]" style={{ color: 'var(--rmpg-500)' }}>Not available</span>
              )}
            </div>
          );
        })}
      </div>

      <a
        href="/downloads"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider"
        style={{ color: 'var(--rmpg-400)' }}
      >
        Open full Downloads page
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}
```

Note: the test's `getByRole('link', { name: /windows/i })` relies on the download
`<a>` having an accessible name — the `aria-label={label}` prop above provides that
directly (its child text "Download" plus the icon would otherwise make the
accessible name ambiguous/generic). Confirm this resolves correctly when running
the tests in Step 4; if RTL's accessible-name computation doesn't pick up
`aria-label` as expected for some reason, adjust the query in the test to
`screen.getByRole('link', { name: /download/i })` scoped within the parent
platform card instead — check the real test output before assuming which fix is
needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/pages/admin/__tests__/AdminDownloadsTab.test.tsx`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/admin/AdminDownloadsTab.tsx client/src/pages/admin/__tests__/AdminDownloadsTab.test.tsx
git commit -m "feat(admin): add AdminDownloadsTab component"
```

---

### Task 2: Wire the tab into `AdminPage.tsx`

**Files:**
- Modify: `client/src/pages/AdminPage.tsx`

**Interfaces:**
- Consumes: `AdminDownloadsTab` (Task 1) — `<AdminDownloadsTab />`, zero props.

- [ ] **Step 1: Add the `Download` icon import**

In `client/src/pages/AdminPage.tsx`, add `Download` to the existing `lucide-react`
import block (the one starting `import { Settings, Users, Building2, ... } from
'lucide-react';`, ~lines 3-30) — add it as one more entry in that list, e.g. right
after `Package,` on its own line: `  Download,`.

- [ ] **Step 2: Add the component import**

Add `import AdminDownloadsTab from './admin/AdminDownloadsTab';` alongside the
other `import Admin<Name>Tab from './admin/Admin<Name>Tab';` lines (~lines 48-72).

- [ ] **Step 3: Add `'downloads'` to `VALID_TABS`**

Find the `VALID_TABS` array (line 278) and add `'downloads'` to the list — insert
it near `'system'`/`'health'` for readability, e.g.:

```ts
const VALID_TABS = ['users', 'clients', 'system', 'settings', 'audit', 'health', 'downloads', 'announcements', /* ...rest unchanged... */];
```

- [ ] **Step 4: Add the tab-config entry**

Find the tab-config array entries near `{ id: 'health', label: 'System Health',
icon: Activity },` (~line 712) and add, directly after it:

```tsx
        { id: 'downloads', label: 'Downloads', icon: Download },
```

- [ ] **Step 5: Add the render block**

Find the existing render block for `activeTab === 'health'` (~line 1066-1072) and
add, directly after its closing `)}`:

```tsx
        {activeTab === 'downloads' && (
          <AdminDownloadsTab />
        )}
```

- [ ] **Step 6: Verify — typecheck and full client test suite**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

Run: `cd client && npx vitest run`
Expected: all existing tests still pass, plus the 4 new `AdminDownloadsTab.test.tsx`
tests from Task 1.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/AdminPage.tsx
git commit -m "feat(admin): surface Downloads tab in Admin console"
```
