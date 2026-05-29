# rmpg-api-proxy

Edge router bound to **`rmpgutah.us/api/*`**. For every API request it decides
which backend worker handles it:

1. **`STUBS`** (checked first) — `{ match: RegExp, methods?, body, reason }`.
   First match returns canned JSON (200, 60 s private cache). Used to silence
   dashboard-poll 404s/500s for endpoints neither backend implements.
2. **`API_ROUTES`** — `{ kind: 'regex'|'prefix', value, methods? }`. First match
   routes to `env.API` (**rmpg-flex-api**, the `/src/` rewrite).
3. No match → `env.LEGACY` (**rmpg-flex**, the legacy-port worker).

## ⚠️ Provenance — read before deploying

This directory was **reconstructed from the live deployed bundle on 2026-05-28**
(extracted verbatim from a `workers_get_worker_code` result — not retyped). Until
this commit, the proxy had **no source on disk**; prior sessions authored it
inline and deployed it. `index.js` is therefore the esbuild *output* form
(`__defProp`/`__name` helpers), not hand-written TS — but the `STUBS` and
`API_ROUTES` arrays are plain and are the only parts you edit.

`.github/workflows/deploy.yml` does **NOT** deploy this worker. It is a separate
manual deploy.

## Deploy

```bash
cd proxies/api-proxy
# 1. Confirm wrangler.toml bindings + route match the live worker
#    (Cloudflare dash → Workers → rmpg-api-proxy → Settings).
# 2. Sanity-diff against what's live RIGHT NOW before overwriting it:
npx wrangler deploy --dry-run --outfile /tmp/proxy-next.js
#    then compare /tmp/proxy-next.js to the current live bundle
#    (workers_get_worker_code / dashboard Quick-Edit) — the ONLY intended
#    delta is the 4 new dispatch rules (see below).
# 3. Deploy:
npx wrangler deploy
```

## What this commit changed

Added 4 `API_ROUTES` rules (lines ~781–784) so the dispatch call-action
endpoints ported in **PR #711** actually reach `rmpg-flex-api` instead of
falling through to legacy:

```js
{ kind: "regex", value: /^\/api\/dispatch\/calls\/\d+\/(revert-status|le-notification|transfer|broadcast-note|generate-incident)$/, methods: ["POST"] },
{ kind: "regex", value: /^\/api\/dispatch\/calls\/\d+\/notes\/[^/]+$/, methods: ["PUT", "DELETE"] },
{ kind: "regex", value: /^\/api\/dispatch\/calls\/\d+\/status$/, methods: ["POST"] },
{ kind: "regex", value: /^\/api\/dispatch\/calls\/archive-bulk$/, methods: ["POST"] },
```

Everything else (76 stubs, the other 74 routes, the fetch handler) is byte-for-byte
the live bundle.

## Verify after deploy

From the dispatch UI: clear a call **with a disposition** (it should persist),
revert a status, transfer a call, broadcast a note, edit/delete a note, and
generate an incident from a cleared call. Each should now succeed instead of
toast-failing. If any still 404s, the rule didn't take — re-check `API_ROUTES`
order and that no `STUBS` entry shadows the path.
