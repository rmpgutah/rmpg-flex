# Legacy / VPS-era code — DO NOT FOLLOW

Everything under this directory is from the retired Hostinger VPS deployment
(decommissioned 2026-05-24). It is kept in-repo for:

- Reference when porting features to the Cloudflare Workers stack in `/src/`.
- Audit history (Git blame, prior incident write-ups).
- Recovery of one-off scripts that may still be useful (e.g. dossier
  rendering logic, scraper rule mirrors).

**Nothing here is built, deployed, tested, or executed.** CI does not touch
this tree. `wrangler deploy` does not touch this tree.

## What's here

| Path | Was | Status |
|------|-----|--------|
| `server-vps/` | Express + better-sqlite3 API server that ran on the VPS | Dead. Replaced by `/src/` (Hono on Cloudflare Workers). |
| `server-vps/send-update-email.ts` | One-shot release-notification script | Dead. Used VPS SQLite + nodemailer. |

## Rules for working with this tree

1. **Do not import** anything from `legacy/` into `/src/`, `/client/`, or
   `/scripts/`. The whole point of quarantining was to make accidental
   imports impossible.
2. **Do not "fix" code here.** If a bug exists in legacy code that needs
   the equivalent fix in `/src/`, port it forward — don't edit two places.
3. **Do not run tests here.** The vitest suite under `server-vps/` references
   `better-sqlite3`, file-system paths under `/opt/rmpg-flex/`, and other
   things that no longer exist.
4. **OK to read** for context: route shapes, validation logic, NIBRS
   mappings, scraper filter rules. The CF rewrite mirrors many of these
   intentionally — comments in `/src/` point back here.

## Eventual deletion

Plan to remove this directory once:

- All `/server/` routes have CF equivalents (track via `grep apiFetch
  client/src/` vs the route list in `src/index.ts`).
- No `/src/` comments reference `legacy/server-vps/` as a source of truth.
- One full release cycle has passed where nothing has been read from here.

Until then: read-only.
