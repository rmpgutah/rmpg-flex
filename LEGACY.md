# Legacy code in this repository

The retired VPS-era code lives under [`legacy/`](legacy/README.md).

> **The Hostinger VPS host is decommissioned (shut down 2026-06-15).** There is no
> server at `194.113.64.90` / `/opt/rmpg-flex` anymore — every VPS deploy/ops path
> below is dead, not "maybe dead." Production is 100% Cloudflare.

**Quick map of what's live vs. dead** (host decommissioned 2026-06-15):

| Directory | Status | What it is |
|-----------|--------|------------|
| `/src/` | ✅ live | Cloudflare Worker (Hono) — the API. Entry: `src/index.ts`. |
| `/client/` | ✅ live | React SPA, deployed to Cloudflare Pages by `.github/workflows/deploy.yml`. |
| `/migrations/` | ✅ live | D1 SQL migrations (applied by `wrangler d1 migrations apply`). |
| `/wrangler.toml` | ✅ live | Worker + D1 + KV + R2 bindings. |
| `/.github/workflows/` | ✅ live | `pr-tests.yml` (gates PRs), `deploy.yml` (deploys to CF on push to main). |
| `/legacy/server-vps/` | ❌ dead | Old Express + better-sqlite3 server. **Not built, not deployed, not tested.** |
| `/deploy/` | ❌ dead | VPS rsync deploy scripts for a host that no longer exists. **Never invoke.** |
| `/desktop/` | ⚠️  undecided | Electron wrapper. Still ships installers but its auto-update infra was VPS-hosted and is now gone. Awaiting product decision. |
| `/edge/` | ⚠️  unclear | Python edge runner for Flex Dashcam AI. Independent of VPS; may be salvageable. |

If you see an old reference to `/opt/rmpg-flex`, `rsync`, `systemctl`, `better-sqlite3`, or `nginx` in any doc or comment, it's describing the dead VPS path — ignore the instruction and check the current Worker code in `/src/` instead.
