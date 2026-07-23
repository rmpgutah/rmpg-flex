# Downloads Page Changelog (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a D1-backed `download_releases` table, a public `GET /api/downloads/changelog` endpoint, a script-driven authoring path, and a "What's New" section on the public Downloads page.

**Architecture:** One new D1 table (`download_releases`), one new route handler in the existing `src/routes/downloads.ts` (already mounted `auth: 'public'` in `src/routesConfig.ts:661`), a bash authoring script mirroring `scripts/apply-migration.sh`'s pattern, and a new section in `client/src/pages/DownloadsPage.tsx` fetched independently of the existing `/api/downloads/info` call.

**Tech Stack:** Cloudflare D1 (native `D1Database.prepare().bind().all()`, all async), Hono route in a Worker, React + `apiFetch` on the client, Vitest for the pure-function test.

## Global Constraints

- D1 queries are always `await`ed — forgetting this silently returns a Promise that serializes to `{}` (CLAUDE.md gotcha #3).
- Migrations use idempotent DDL (`CREATE TABLE IF NOT EXISTS`) — D1 does not support `ADD COLUMN IF NOT EXISTS`.
- One shared changelog list across all platforms (not per-platform) — confirmed in the spec.
- `notes` column is plain text, one bullet per line, split on `\n` server-side — no JSON, no markdown.
- `version` is `UNIQUE` — no upsert; a duplicate insert must fail loudly.
- The new route is public (no auth), matching the existing `/api/downloads/info` and `/api/downloads/check` in the same file.
- Radius/colors on any new UI: reuse the page's existing `surface-overlay` / `border-subtle` / `#d4a017` gold-accent card styling — never hardcode a different palette (CLAUDE.md Design tokens section).
- "What's New" section placement: directly after the hero, before the download-cards grid (confirmed in the spec).

---

## Task 1: `download_releases` migration

**Files:**
- Create: `migrations/0201_download_releases.sql`

**Interfaces:**
- Produces: table `download_releases(id, version, release_date, notes, created_at)`, index `idx_download_releases_date`. Task 2's route queries this table directly by name — no ORM layer to keep in sync.

- [ ] **Step 1: Write the migration file**

```sql
-- migrations/0201_download_releases.sql
CREATE TABLE IF NOT EXISTS download_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  release_date TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_download_releases_date ON download_releases(release_date DESC);
```

- [ ] **Step 2: Apply it to local D1 and verify**

Run: `npm run migrate:local`
Expected: no errors; migration `0201_download_releases.sql` listed as applied.

Then verify the table exists:

```bash
npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='download_releases'"
```
Expected: one row, `name: download_releases`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0201_download_releases.sql
git commit -m "Add download_releases table for Downloads-page changelog"
```

- [ ] **Step 4 (post-merge, not part of this commit): apply to live D1**

After this PR merges to `main`, run (per CLAUDE.md's Schema Changes section — `deploy.yml`'s migration step is `continue-on-error: true` and cannot be trusted alone):

```bash
scripts/apply-migration.sh 0201_download_releases.sql
```

Then verify with:

```bash
npx wrangler d1 execute rmpg-flex --remote --command "PRAGMA table_info(download_releases)"
```
Expected: columns `id, version, release_date, notes, created_at`.

---

## Task 2: `GET /api/downloads/changelog` route

**Files:**
- Modify: `src/routes/downloads.ts`
- Test: `tests/downloadsChangelog.test.ts`

**Interfaces:**
- Consumes: `download_releases` table from Task 1 (columns: `version TEXT`, `release_date TEXT`, `notes TEXT`).
- Produces: exported pure function `parseReleaseNoteRow(row: { version: string; release_date: string; notes: string }): ReleaseNote` and exported type `ReleaseNote { version: string; releaseDate: string; notes: string[] }`. Task 4 (client) consumes the route's JSON response shape `ReleaseNote[]`, matching this type exactly (camelCase `releaseDate`, `notes` as a string array).

- [ ] **Step 1: Write the failing test**

Create `tests/downloadsChangelog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseReleaseNoteRow } from '../src/routes/downloads';

describe('parseReleaseNoteRow', () => {
  it('splits multi-line notes into an array of bullet strings', () => {
    const row = { version: '5.8.5', release_date: '2026-07-22', notes: 'Added Kiosk Linux OS image\nFixed ALPR capture retry' };
    const result = parseReleaseNoteRow(row);
    expect(result).toEqual({
      version: '5.8.5',
      releaseDate: '2026-07-22',
      notes: ['Added Kiosk Linux OS image', 'Fixed ALPR capture retry'],
    });
  });

  it('filters out blank lines from notes', () => {
    const row = { version: '5.8.4', release_date: '2026-07-01', notes: 'First fix\n\nSecond fix\n' };
    const result = parseReleaseNoteRow(row);
    expect(result.notes).toEqual(['First fix', 'Second fix']);
  });

  it('returns an empty notes array when notes is an empty string', () => {
    const row = { version: '5.8.3', release_date: '2026-06-15', notes: '' };
    const result = parseReleaseNoteRow(row);
    expect(result.notes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/downloadsChangelog.test.ts`
Expected: FAIL — `parseReleaseNoteRow` is not exported from `../src/routes/downloads`.

- [ ] **Step 3: Add `parseReleaseNoteRow`, `ReleaseNote`, and the route**

In `src/routes/downloads.ts`, add near the other interfaces (after `InstallerInfo`, before `fmtBytes`):

```ts
export interface ReleaseNote {
  version: string;
  releaseDate: string;
  notes: string[];
}

export function parseReleaseNoteRow(row: { version: string; release_date: string; notes: string }): ReleaseNote {
  return {
    version: row.version,
    releaseDate: row.release_date,
    notes: row.notes.split('\n').map((line) => line.trim()).filter(Boolean),
  };
}
```

Change the router's Bindings type to include `DB` (it currently only declares `DOWNLOADS`):

```ts
const downloads = new Hono<{ Bindings: { DOWNLOADS: R2Bucket; DB: D1Database } }>();
```

Add `import type { D1Database } from '@cloudflare/workers-types';` to the top import line alongside the existing `R2Bucket, R2Object` import.

Add the route after the existing `/downloads/check` handler, before `export default downloads;`:

```ts
// GET /api/downloads/changelog — public release notes for the Downloads page
downloads.get('/downloads/changelog', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      'SELECT version, release_date, notes FROM download_releases ORDER BY release_date DESC, id DESC LIMIT 10'
    ).all();
    const rows = result.results as unknown as Array<{ version: string; release_date: string; notes: string }>;
    return c.json(rows.map(parseReleaseNoteRow));
  } catch (err) {
    console.error('downloads/changelog error:', err);
    return c.json({ error: 'Failed to read changelog' }, 500);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/downloadsChangelog.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full existing downloads test file to confirm no regression**

Run: `npx vitest run tests/downloadsOsImage.test.ts`
Expected: PASS (4 tests, unchanged) — confirms the Bindings-type change didn't break `scanInstallers`.

- [ ] **Step 6: Typecheck the Worker**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/downloads.ts tests/downloadsChangelog.test.ts
git commit -m "Add GET /api/downloads/changelog route for release notes"
```

---

## Task 3: Authoring script

**Files:**
- Create: `scripts/add-release-note.sh`

**Interfaces:**
- Consumes: `download_releases` table from Task 1.
- Produces: nothing consumed by other tasks — this is an operator-run CLI tool, not code other tasks import.

- [ ] **Step 1: Write the script**

Create `scripts/add-release-note.sh`:

```bash
#!/usr/bin/env bash
# Insert a release note into live D1 `download_releases` for the Downloads
# page's "What's New" section.
#
# Usage:
#   scripts/add-release-note.sh <version> <release_date YYYY-MM-DD> <notes-file>
#
# <notes-file> is a plain text file, one bullet point per line.
#
# Example:
#   echo -e "Added Kiosk Linux OS image download\nFixed ALPR capture retry bug" > /tmp/notes.txt
#   scripts/add-release-note.sh 5.8.5 2026-07-22 /tmp/notes.txt

set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: $0 <version> <release_date YYYY-MM-DD> <notes-file>" >&2
  exit 64
fi

VERSION="$1"
RELEASE_DATE="$2"
NOTES_FILE="$3"

if [ ! -f "$NOTES_FILE" ]; then
  echo "error: $NOTES_FILE does not exist" >&2
  exit 66
fi

if ! [[ "$RELEASE_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "error: release_date must be YYYY-MM-DD, got: $RELEASE_DATE" >&2
  exit 65
fi

# Escape single quotes for the SQL literal (' -> '')
NOTES_ESCAPED=$(sed "s/'/''/g" "$NOTES_FILE")
VERSION_ESCAPED=$(printf '%s' "$VERSION" | sed "s/'/''/g")

echo "→ inserting release note for v$VERSION ($RELEASE_DATE) into live D1 (rmpg-flex)..."
npx wrangler d1 execute rmpg-flex --remote --command \
  "INSERT INTO download_releases (version, release_date, notes) VALUES ('$VERSION_ESCAPED', '$RELEASE_DATE', '$NOTES_ESCAPED')"

echo "✓ release note for v$VERSION inserted"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/add-release-note.sh`

- [ ] **Step 3: Verify the script's local logic without hitting live D1**

There is no live-D1 write to safely test in this task (the real insert happens post-merge, same as `apply-migration.sh`'s pattern). Instead, verify the guard clauses work:

Run: `scripts/add-release-note.sh` (no args)
Expected: prints usage message, exits with code 64.

Run: `scripts/add-release-note.sh 5.8.5 not-a-date /tmp/nonexistent.txt`
Expected: fails on the missing-file check first (`error: /tmp/nonexistent.txt does not exist`), exits with code 66 — confirms argument order and the file-existence check run before the date-format check.

Run: `echo "test note" > /tmp/notes-test.txt && scripts/add-release-note.sh 5.8.5 bad-date /tmp/notes-test.txt`
Expected: fails with `error: release_date must be YYYY-MM-DD, got: bad-date`, exit code 65.

- [ ] **Step 4: Commit**

```bash
git add scripts/add-release-note.sh
git commit -m "Add scripts/add-release-note.sh for Downloads changelog authoring"
```

---

## Task 4: "What's New" section on the public Downloads page

**Files:**
- Modify: `client/src/pages/DownloadsPage.tsx`

**Interfaces:**
- Consumes: `GET /api/downloads/changelog` from Task 2, returning `ReleaseNote[]` where `ReleaseNote = { version: string; releaseDate: string; notes: string[] }` (matches Task 2's exported type field-for-field).
- Produces: nothing consumed elsewhere — this is the leaf UI.

- [ ] **Step 1: Add local types and state**

In `client/src/pages/DownloadsPage.tsx`, add near the top-level `interface DownloadsInfo` block (after it, before `PLATFORM_CONFIG`):

```tsx
interface ReleaseNote {
  version: string;
  releaseDate: string;
  notes: string[];
}
```

Inside the `DownloadsPage` component, alongside the existing `info`/`loading`/`fetchError` state declarations, add:

```tsx
const [changelog, setChangelog] = useState<ReleaseNote[]>([]);
const [showAllChangelog, setShowAllChangelog] = useState(false);
```

- [ ] **Step 2: Fetch the changelog independently of the installer-info fetch**

Add a new `useEffect` right after the existing one that fetches `/api/downloads/info` (around line 110-120):

```tsx
useEffect(() => {
  apiFetch<ReleaseNote[]>('/api/downloads/changelog')
    .then((data) => setChangelog(data))
    .catch(() => setChangelog([]));
}, []);
```

- [ ] **Step 3: Render the "What's New" card**

Insert this JSX block right after the closing `</div>` of the hero section (`{/* Hero */}` block, before the `{/* ── Loading state ── */}` comment):

```tsx
{/* What's New */}
{changelog.length > 0 && (
  <div
    className="p-5 mb-8"
    style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
  >
    <h4 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: '#d4a017' }}>
      What's New
    </h4>
    {(showAllChangelog ? changelog : changelog.slice(0, 1)).map((entry) => (
      <div key={entry.version} className="mb-4 last:mb-0">
        <div className="text-xs font-bold mb-1" style={{ color: 'var(--rmpg-300)' }}>
          v{entry.version} — {entry.releaseDate}
        </div>
        <div className="space-y-1">
          {entry.notes.map((note, i) => (
            <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--rmpg-400)' }}>
              <span style={{ color: '#d4a017' }}>&bull;</span>
              {note}
            </div>
          ))}
        </div>
      </div>
    ))}
    {changelog.length > 1 && (
      <button
        type="button"
        onClick={() => setShowAllChangelog((v) => !v)}
        className="text-[11px] font-bold uppercase tracking-wider mt-2"
        style={{ color: 'var(--rmpg-500)' }}
      >
        {showAllChangelog ? 'Show less' : `Show ${changelog.length - 1} more`}
      </button>
    )}
  </div>
)}
```

- [ ] **Step 4: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors introduced by this change (pre-existing unrelated errors, if any, are out of scope — CLAUDE.md's Phase 5 session log notes 12 pre-existing client typecheck errors unrelated to this work).

- [ ] **Step 5: Manual verification in the browser**

Start the dev servers and confirm the section renders:

```bash
npm run dev
```
(in a second terminal)
```bash
cd client && npm run dev
```

Seed a local test row so the section has something to show:

```bash
npx wrangler d1 execute rmpg-flex --local --command "INSERT INTO download_releases (version, release_date, notes) VALUES ('5.8.5', '2026-07-22', 'Added Kiosk Linux OS image download' || char(10) || 'Fixed ALPR capture retry bug')"
```

Open `http://localhost:5173/downloads` in the browser pane and confirm:
- The "What's New" card appears directly below the hero, above the platform download cards.
- It shows `v5.8.5 — 2026-07-22` with the two bullet notes.
- No "Show more" button appears (only one entry exists).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/DownloadsPage.tsx
git commit -m "Add What's New changelog section to the public Downloads page"
```

---

## Post-merge checklist (not part of any single commit)

- [ ] Run `scripts/apply-migration.sh 0201_download_releases.sql` against live D1.
- [ ] Verify with `npx wrangler d1 execute rmpg-flex --remote --command "PRAGMA table_info(download_releases)"`.
- [ ] Seed the first real release note with `scripts/add-release-note.sh` once a version ships.
- [ ] Confirm `https://rmpgutah.us/downloads` shows the "What's New" section in a real browser (the WAF managed challenge blocks a plain `curl`, per CLAUDE.md's deploy-verification section).
