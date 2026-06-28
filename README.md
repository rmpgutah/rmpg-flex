# RMPG Flex

Police CAD/RMS (Computer-Aided Dispatch / Records Management System) for **Rocky
Mountain Protective Group**, a private security and law enforcement company
based in Salt Lake City, Utah.

> ⚠️ Proprietary software — see [`LICENSE`](LICENSE). Access is restricted to
> RMPG employees and authorized contractors.

## What's deployed

| Surface | URL | Build |
|---|---|---|
| App (SPA) | https://rmpgutah.us | Cloudflare Pages project `rmpg-flex` (built from [`client/`](client)) |
| API | https://api.rmpgutah.us | Cloudflare Worker `rmpg-flex-api` (entry [`src/index.ts`](src/index.ts)) |
| Database | Cloudflare D1 `rmpg-flex` (`785de7ae-…`) | Bound as `DB` in [`wrangler.toml`](wrangler.toml) |
| Storage | R2 bucket `system-essentials` | Bound as `MAP_DATA` |
| Cache / state | KV namespace `8e01c392…` | Bound as `KV` |
| Durable Objects | `WelfareWatchDO` | One instance per officer; backs the welfare-check timer |

## Tech stack

- **API**: [Hono](https://hono.dev) on Cloudflare Workers, TypeScript, JWT
  (`jose`), bcryptjs. Real-time over native Workers `webSocketPair()`.
- **Client**: React 18 + TypeScript + Vite 6 + Tailwind. Maps via Mapbox GL JS.
- **DB**: Cloudflare D1 — accessed via the native `D1Database.prepare().bind()`
  pattern. All queries are async; missing `await` is the #1 bug source.
- **Edge**: Python edge runner for Flex Dashcam AI (`edge/`, NVIDIA Jetson
  target), independent of the Worker.
- **Theme**: Spillman Flex day/night skin (steel-blue night default, light-grey
  day, auto-switching 06:00–18:00 local). Palette lives in
  [`client/src/styles/theme-palettes.css`](client/src/styles/theme-palettes.css)
  — never hardcode hex.

## Repository layout

```
src/                Cloudflare Worker (live API)
client/             React SPA (Vite → client/dist/, deployed to CF Pages)
migrations/         D1 SQL migrations
desktop/            Electron wrapper (still in active use)
edge/               Python edge runner for Flex Dashcam AI
scripts/            Codegen + one-off ops scripts
legacy/             ⚠️ RETIRED VPS-era code (read-only) — see LEGACY.md
```

The Hostinger VPS that previously hosted this stack was **decommissioned on
2026-06-15**. If you see references to `194.113.64.90`, `/opt/rmpg-flex`,
`systemctl restart rmpg-flex`, or `better-sqlite3`, they describe dead
architecture — see [`LEGACY.md`](LEGACY.md) for the live-vs-dead map.

## Local development

```bash
# Worker (API)
npm install
npm run dev               # wrangler dev on :8787
npm run typecheck         # tsc --noEmit on /src/

# Client
cd client
npm install
npm run dev               # Vite on :5173

# Database (local D1)
npm run migrate:local
```

You'll need an `.dev.vars` (gitignored) with at minimum `JWT_SECRET`. Optional
integration keys (`IPED_API_KEY`, `ROBOFLOW_API_KEY`, `FLEETIO_API_KEY`, …)
trigger `503 not_configured` from their respective routes if unset, rather than
crashing the Worker.

## Deploying

`git push origin main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
which:

1. `npm run typecheck` (Worker)
2. `wrangler d1 migrations apply rmpg-flex --remote` *(continue-on-error — the
   Worker reconciles missing columns at boot, but always confirm new tables
   landed by querying `pragma_table_info` against live D1)*
3. `wrangler deploy` (Worker)
4. `wrangler pages deploy client/dist --project-name=rmpg-flex --branch=main`

Required GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

> **Service-worker cache**: bump `CACHE_NAME` in
> [`client/public/sw.js`](client/public/sw.js) on every client change, or users
> will keep serving stale chunks for up to 24 h.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the branch / PR / migration flow.
The short version: feature branch → `gh pr create` → CI → squash-merge to
`main` → auto-deploy. **Never push directly to `main`.**

## Deep technical docs

[`CLAUDE.md`](CLAUDE.md) is the canonical operator/developer manual — it covers
gotchas, schema-drift remediation, the D1 100-column cap, ALPR/Roboflow,
Fleet.io integration, the day/night theme engine, and the long list of
"don't follow this advice, it describes the dead VPS" landmines.

## Code of conduct

[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Security

To report a vulnerability, see [`.github/SECURITY.md`](.github/SECURITY.md).
