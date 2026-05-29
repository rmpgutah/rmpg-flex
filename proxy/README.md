# `proxy/` — the API routing proxy (`rmpg-api-proxy`)

**This is the canonical, deployed proxy. Edit `proxy/index.ts` and nothing else.**

`rmpgutah.us/api/*` is served by the `rmpg-api-proxy` Worker, which dispatches
each request per-path between two backends via service bindings:

- `env.API`    → `rmpg-flex-api` (the `/src/` rewrite — the strangler target)
- `env.LEGACY` → `rmpg-flex` (the original legacy-port Worker — default for
  any path not matched by `STUBS` or `API_ROUTES`)

## Request flow (`index.ts`)

1. **`STUBS`** are checked first — short-circuit empty/placeholder responses for
   endpoints with no working backend yet. A stub here **shadows** any real
   handler for the same path, so delete the stub when you port the route.
2. **`API_ROUTES`** — paths that must go to the rewrite (`env.API`).
3. **Fallthrough** → `env.LEGACY`.

## Deployment

`.github/workflows/deploy.yml` deploys this dir:

```yaml
- name: Deploy proxy
  with:
    workingDirectory: proxy   # ← THIS dir
    command: deploy
```

It runs **after** `rmpg-flex-api` so the `env.API` binding points at the freshly
deployed rewrite.

## ⚠️ Why there is no `proxies/api-proxy/`

There used to be a second, near-identical copy at `proxies/api-proxy/`. It was an
**orphan** — `deploy.yml` never deployed it — so routing changes made there
silently never went live (this stranded PR #720's stub-removal work, among
others). It was deleted to remove the footgun. If you find a `proxies/` dir
reappearing, it's a mistake: the only proxy source is **`proxy/index.ts`**.

To verify what's actually live, pull the deployed bundle:
`workers_get_worker_code({ scriptName: 'rmpg-api-proxy' })` and diff against
`proxy/index.ts`.
