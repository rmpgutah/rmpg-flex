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
| `/proxy/` | ✅ live | Strangler-pattern Worker routing prod `/api/*` traffic to `rmpg-flex-api`. Do not delete. |
| `/functions/` | ✅ live | Cloudflare Pages Functions middleware for the SPA. |
| `/desktop/` | ✅ live | Electron wrapper — in active use (see CLAUDE.md; desktop tests run in pre-push). |
| `/desktop-tauri/` | ✅ live | FlexOS/Tauri desktop shell (lock screen, tray, virtual desktops — active 2026-08). |
| `/ios2/` | ✅ live | iOS app (RMPGFlexConnect) — active iOS programs. |
| `/containers/` | ✅ live | pdf-tools + tesseract-ocr container images. |
| `/config/` | ✅ live | OSM layer manifests for the map overlay program. |
| `/e2e/` | ✅ live | Playwright e2e specs (`playwright.config.ts`). |
| `/edge/` | ⚠️  unclear | Python edge runner for Flex Dashcam AI. Independent of VPS; may be salvageable. |
| `/training/` | ⚠️  on hold | LoRA/ALPR dataset + training scripts — program paused (Roboflow credits), keep. |
| `/tools/jail-scraper/` | ⚠️  external | Credentialed jail-roster scraper run outside the Worker. |

**Removed in the 2026-08-21 sweep** (unreferenced strays): `.deploy-timestamp` (one-off
CDN cache-bust from 2026-05-31), `Cursor1.cur` (stray cursor asset), `import_map.json`
(Deno-era import map, referenced by nothing).
