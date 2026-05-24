# Legacy code in this repository

The retired VPS-era code lives under [`legacy/`](legacy/README.md).

**Quick map of what's live vs. dead** (as of 2026-05-24):

| Directory | Status | What it is |
|-----------|--------|------------|
| `/src/` | ✅ live | Cloudflare Worker (Hono) — the API. Entry: `src/index.ts`. |
| `/client/` | ✅ live | React SPA, deployed to Cloudflare Pages by `.github/workflows/deploy.yml`. |
| `/migrations/` | ✅ live | D1 SQL migrations (applied by `wrangler d1 migrations apply`). |
| `/wrangler.toml` | ✅ live | Worker + D1 + KV + R2 bindings. |
| `/.github/workflows/` | ✅ live | `pr-tests.yml` (gates PRs), `deploy.yml` (deploys to CF on push to main). |
| `/legacy/server-vps/` | ❌ dead | Old Express + better-sqlite3 server. **Not built, not deployed, not tested.** |
| `/deploy/` | ⚠️  likely dead | VPS rsync deploy scripts. Kept until confirmed unused, but should not be invoked. |
| `/desktop/` | ⚠️  undecided | Electron wrapper. Still ships installers but auto-update infra was VPS-hosted. Awaiting product decision. |
| `/edge/` | ⚠️  unclear | Python edge runner for Flex Dashcam AI. Independent of VPS; may be salvageable. |

If you see an old reference to `/opt/rmpg-flex`, `rsync`, `systemctl`, `better-sqlite3`, or `nginx` in any doc or comment, it's describing the dead VPS path — ignore the instruction and check the current Worker code in `/src/` instead.
