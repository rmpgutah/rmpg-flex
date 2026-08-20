# Downloads Page Changelog (Phase 1 of Downloads enhancement program)

## Context

This is Phase 1 of a 4-phase Downloads-page enhancement program:

1. **Changelog / release notes table** (this spec)
2. Real admin CMS (R2 upload + changelog editor + "latest"/rollback) — depends on #1
3. Download analytics (per-download tracking, adoption stats in Admin tab) — independent
4. In-app update banner with changelog diff — depends on #1

Phases 2–4 are out of scope here and will get their own specs.

## Goal

Give the public `/downloads` page a "What's New" section showing recent release notes, backed by a real D1 table instead of hardcoded copy. Authoring is script-driven for now; Phase 2 replaces the script with a UI.

## Schema

New migration, next free prefix after `0200` (confirm actual high-water via `ls migrations/ | tail` at implementation time — duplicate prefixes exist per `migrations/README.md`):

```sql
CREATE TABLE IF NOT EXISTS download_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  release_date TEXT NOT NULL,     -- ISO date (YYYY-MM-DD), UTC
  notes TEXT NOT NULL,            -- newline-separated bullet points, plain text
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_download_releases_date ON download_releases(release_date DESC);
```

- One shared list across all platforms (win/mac/android/os all ship from the same app version bump, per `client/package.json`'s single version number).
- `notes` stored as plain text with one bullet per line — no JSON, no markdown parser needed. The route splits on `\n` when serializing to JSON.
- `version` is unique — re-running an insert for the same version should fail loudly (no upsert), since duplicate entries would indicate an authoring mistake.

Per CLAUDE.md's migration rules: idempotent DDL (`CREATE TABLE IF NOT EXISTS`), applied via `scripts/apply-migration.sh` after merge (deploy.yml's migration step is `continue-on-error: true`, so this cannot be assumed to land automatically).

## API

New endpoint in `src/routes/downloads.ts`:

- `GET /api/downloads/changelog` — public, no auth (same tier as the existing `GET /api/downloads/info`, both mounted before the auth middleware gate per `src/index.ts`'s public-route list).
- Returns the most recent 10 entries, newest first (`ORDER BY release_date DESC, id DESC`):
  ```ts
  interface ReleaseNote {
    version: string;
    releaseDate: string;
    notes: string[]; // notes.split('\n').filter(Boolean)
  }
  ```
  Response shape: `ReleaseNote[]`.
- Empty table → `[]`, not an error.

## Authoring (Phase 1 only — no UI)

New script `scripts/add-release-note.sh`, mirroring the existing `scripts/apply-migration.sh` pattern (same `wrangler d1 execute --remote` mechanism, same live-DB target `rmpg-flex` / `785de7ae-3e7a-4e01-93bb-d24ddd813f6b`):

```bash
scripts/add-release-note.sh <version> <release_date YYYY-MM-DD> <notes-file>
```

`<notes-file>` is a plain text file, one bullet per line. The script reads it, escapes single quotes, and runs an `INSERT INTO download_releases (version, release_date, notes) VALUES (...)`.

Phase 2 replaces this script with a real editor in `AdminDownloadsTab.tsx` (add/edit/delete entries, no more manual `wrangler d1 execute`).

## Public UI

`client/src/pages/DownloadsPage.tsx`:

- New "What's New" card, placed directly after the hero section and before the download-cards grid — the newest version's changes are the first thing a visitor reads.
- Fetches `GET /api/downloads/changelog` in its own `useEffect` (separate from the existing `/api/downloads/info` fetch — independent failure domains; if the changelog fetch fails or returns `[]`, the section simply doesn't render, no error state shown, since it's supporting content, not the core download flow).
- Styling matches the page's existing card pattern (`surface-overlay` background, `border-subtle` border, `2px` radius, `#d4a017` gold accent headers — consistent with "What's Included" / "Installation Guide" cards already on the page).
- Layout: the most recent entry is expanded by default (version + date + full bullet list). Older entries (up to 9 more) are collapsed under a "Show more" toggle — clicking expands all remaining entries at once (no per-entry accordion; keeps the interaction simple).
- Each entry: `v{version} — {releaseDate}` as a small header line, followed by bullet points (`•` prefix, same text styling as the existing "What's Included" list items).

## Error handling

- Changelog fetch failure: silently omit the section (`catch(() => setChangelog([]))`), consistent with treating this as enhancement content, not critical path. The existing platform-download-info fetch already has its own visible error state (`fetchError` banner) for the actually load-bearing data.
- Empty `notes` string edge case: `.filter(Boolean)` after split guards against a stray blank line rendering as an empty bullet.

## Testing

- No Worker test suite exists yet for routes generally (per CLAUDE.md, only typecheck runs in CI for `/src/`) — this endpoint follows the same untested-route norm as the rest of `downloads.ts`. A smoke test is optional but not required to match existing conventions.
- Client: no new interactive logic beyond the show-more toggle; a basic render test (has-entries vs. empty-array cases) can be added to `client/src/pages/__tests__/` if a DownloadsPage test file already exists, otherwise skipped — matches the "add tests when you're already touching related test files" norm rather than mandating new test scaffolding for a small UI addition.

## Out of scope (later phases)

- Any write UI (admin CMS) — Phase 2.
- Download counting/analytics — Phase 3.
- In-app "update available" banner using this data — Phase 4.
