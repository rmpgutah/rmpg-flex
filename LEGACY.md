# Legacy code in this repository

> **The Hostinger VPS host is decommissioned (shut down 2026-06-15).** There is no
> server at `194.113.64.90` / `/opt/rmpg-flex` anymore — every VPS deploy/ops path
> below is dead, not "maybe dead." Production is 100% Cloudflare.

**2026-07-16 cleanup**: the retired VPS-era code that used to live under `legacy/server-vps/`,
the stale duplicate top-level `server/` directory, and the dead `deploy/` rsync scripts have
all been **deleted outright** (they were quarantined and unused, not merely documented as
dead). If you see an old reference to `/opt/rmpg-flex`, `rsync`, `systemctl`, `better-sqlite3`,
`nginx`, `legacy/server-vps`, `bash deploy/deploy.sh`, or a top-level `server/` import in any
doc, comment, or old branch — it's describing a path that no longer exists in this repo at all.
Ignore the instruction and check the current Worker code in `/src/` instead.

**Quick map of what's live** (host decommissioned 2026-06-15):

| Directory | Status | What it is |
|-----------|--------|------------|
| `/src/` | ✅ live | Cloudflare Worker (Hono) — the API. Entry: `src/index.ts`. |
| `/client/` | ✅ live | React SPA, deployed to Cloudflare Pages by `.github/workflows/deploy.yml`. |
| `/migrations/` | ✅ live | D1 SQL migrations (applied by `wrangler d1 migrations apply`). |
| `/wrangler.toml` | ✅ live | Worker + D1 + KV + R2 bindings. |
| `/.github/workflows/` | ✅ live | `pr-tests.yml` (gates PRs), `deploy.yml` (deploys to CF on push to main). |
| `/desktop/` | ⚠️  undecided | Electron wrapper. Still ships installers but its auto-update infra was VPS-hosted and is now gone. Awaiting product decision. |
| `/edge/` | ⚠️  unclear | Python edge runner for Flex Dashcam AI. Independent of VPS; may be salvageable. |
