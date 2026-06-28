# Contributing to RMPG Flex

This repo holds production code for a live police CAD/RMS. Treat changes
accordingly — they reach dispatchers, patrol officers, and recorded evidence.

## Who can contribute

RMPG employees and authorized contractors. See [`LICENSE`](LICENSE) for the
authorization scope. Outside contributions are not accepted.

## Read this first

- [`CLAUDE.md`](CLAUDE.md) — canonical operator/developer manual. The
  "Common Gotchas (CF era)" and "Cross-reference: dead instructions to ignore"
  sections will save you hours.
- [`LEGACY.md`](LEGACY.md) — live-vs-dead directory map. The old Hostinger VPS
  is decommissioned; anything under `legacy/` is read-only.

## Branch & PR flow

1. **Branch off `origin/main`.** Don't branch off a sibling worktree's local
   `main`.
2. Make changes on a feature branch.
3. **Bump the service-worker cache** if you touched anything under `client/` —
   change `CACHE_NAME` in [`client/public/sw.js`](client/public/sw.js).
4. Open a PR with `gh pr create` (or the GitHub UI). The PR template
   ([`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md))
   describes what to include.
5. CI runs ([`.github/workflows/pr-tests.yml`](.github/workflows/pr-tests.yml)):
   - Worker `tsc --noEmit`
   - Client `tsc --noEmit`
   - Client `vitest`
   - Client `vite build`
6. Squash-merge to `main` once green. The deploy workflow takes it from there.

**Do not `git push HEAD:main`.** Even for "small" changes. The PR flow exists
so the typecheck/build gates run before users see the change. The only
exceptions are documented hotfix procedures with explicit operator sign-off.

If you're merging a *batch* of open PRs at once, do a true integration merge
(`git merge --no-ff` each into a local integration branch off `origin/main`,
verify CI gates once, then push) rather than squash-racing — squash on shared
files (`sw.js`, route configs) silently drops hunks.

## Schema changes (D1)

1. Add a new file under `migrations/` with the next free integer prefix
   ([`migrations/README.md`](migrations/README.md) documents the numbering
   quirks — duplicate prefixes exist).
2. Idempotent DDL only: `CREATE TABLE IF NOT EXISTS`. D1 does **not** support
   `IF NOT EXISTS` on `ADD COLUMN`, so either accept the re-apply failure or
   reconcile via the Worker's boot-time `columnExists()` helper.
3. Test locally: `npm run migrate:local`.
4. After merge, the deploy step applies migrations with `continue-on-error`.
   **Verify the migration actually reached live D1** by running
   `pragma_table_info('<table>')` against the live `rmpg-flex`
   (`785de7ae-3e7a-4e01-93bb-d24ddd813f6b`) DB — a runtime "no such
   column / table" error is almost always a migration that silently didn't
   land.
5. Watch the [D1 100-column cap](CLAUDE.md#common-gotchas-cf-era). New columns
   on `calls_for_service` or `persons` must go to the `_ext` overflow table —
   the `column-cap-check` workflow fails CI otherwise.

## Code patterns

- **D1 queries are async.** `await db.prepare(...).first()`. Forgetting `await`
  returns a Promise that JSON-serializes to `{}` and silently breaks the
  client.
- **Routes** live in `src/routes/`, are mounted from `src/index.ts`, and gate
  auth per-prefix (`app.use('/api/<prefix>', authMiddleware)`).
- **Optional integration secrets** are read from `c.env` and never hard-coded.
  When unset, the route returns `503 not_configured` rather than crashing.
- **Tailwind theme tokens** (`bg-surface-base`, `text-brand-400`, …) re-theme
  between night and day automatically. **Never hardcode hex** in components
  you touch; if the page you're editing already has hex, migrate it.
- **Icon-only buttons**: use `<IconButton aria-label="…">` from
  [`client/src/components/IconButton.tsx`](client/src/components/IconButton.tsx).
  The `aria-label` is a required TS prop.

## Tests

- Worker: typecheck only today. Adding a Vitest + Miniflare suite for `/src/`
  is tracked as Phase 2 tech debt — prefer adding a smoke test alongside any
  new route.
- Client: `cd client && npx vitest run`.
- `.husky/pre-push` mirrors CI locally. Don't `--no-verify` past it except for
  documented hotfixes.

## Verifying after deploy

- `https://api.rmpgutah.us/api/health` is the only endpoint that bypasses the
  Cloudflare managed challenge — every other path needs a real browser.
- For DB-level checks, query live D1 directly through the Cloudflare API or
  `wrangler d1 execute rmpg-flex --remote --command '…'` — that path bypasses
  the WAF.

## Reporting security issues

See [`.github/SECURITY.md`](.github/SECURITY.md). Do not file public issues
for vulnerabilities.
