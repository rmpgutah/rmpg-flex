# Utah Warrants Poller — Runtime-Agnostic Core

> ⚠️ **STATUS: REFERENCE / NOT WIRED INTO PRODUCTION (2026-05-24).** The canonical Utah warrants poller for the live RMPG Flex system is **`server/src/utils/utahWarrantScraper.ts`** in the legacy Express server. That implementation is more mature than this subtree: it has adaptive CloudFront WAF backoff, 24h SQLite caching, the `warrant_watch_runs`/`warrant_watch_log` audit tables, and (as of commit 7d8d6c12) `scraper_events` WebSocket broadcasts that surface every run in the `/warrants → Scrapers` tab live feed.
>
> This subtree exists as a clean-room reference for the Cloudflare Workers rehome (different repo, different agent) — runtime-agnostic, no Express/`better-sqlite3` deps, portable to D1. Do NOT wire any of these modules into a server route handler; that would duplicate work and produce two parallel pollers fighting over the same upstream API. If you need to make changes that affect production polling, edit `server/src/utils/utahWarrantScraper.ts`.

Pure TypeScript modules. No Express, no Cloudflare bindings, no `better-sqlite3`. Depends only on standard `fetch` and a small `DataStore` interface.

## Why portable?

The RMPG Flex VPS was decommissioned 2026-05-24; the system is being rehomed to Cloudflare Workers + D1 + R2 (see `memory/project_vps_decommissioned.md`). The CF Worker source lives in a separate repo this Claude session does not have access to. This core was built so that:

- A future CF cron handler can wire it up in ~30 lines (D1-backed `DataStore`)
- Local tests can run with an in-memory `DataStore`
- No code is wasted if the runtime target changes again

## Architecture

```
types.ts                       WarrantRecord, PollResult, DataStore, AlertSink
normalize.ts                   Name/DOB canonicalization + dedup keys (pure fns)
sources/base.ts                BaseWarrantSource: rate-limit + retry + UA wrapper
sources/*.ts                   Per-source adapters (list-poll OR query-lookup)
orchestrator.ts                runPoll() — Promise.allSettled across sources,
                               per-source audit, MNI cross-link, alert fan-out
adapters/memory-datastore.ts   In-memory DataStore (tests + CLI demos)
adapters/d1-datastore.ts       Reference D1 DataStore (copy into CF repo)
examples/cloudflare-worker.ts  Reference Worker integration (copy into CF repo)
cli/lookup.ts                  End-to-end CLI demo against the live .gov API
__tests__/*.ts                 52 unit + 9 orchestrator + 3 live integration tests
```

## CLI demo

End-to-end runnable against the LIVE state API, zero deps:

```
node shared/warrants-poller/cli/lookup.ts <FIRST> <LAST> [--age N] [--dob YYYY-MM-DD] [--json]

# examples
node shared/warrants-poller/cli/lookup.ts JOHN SMITH
node shared/warrants-poller/cli/lookup.ts JOHN SMITH --age 47
node shared/warrants-poller/cli/lookup.ts JANE DOE --dob 1990-03-14 --json
```

Requires Node 22+ (uses `--experimental-strip-types` to run TS directly). Verified 2026-05-24 against production UDPS API.

## Running tests

```
# Default suite (52 tests, ~180ms) — runs in CI
./client/node_modules/.bin/vitest run shared/warrants-poller/__tests__

# Live integration suite (3 tests, ~14s) — opt-in, hits real .gov API
WARRANTS_LIVE_TEST=1 ./client/node_modules/.bin/vitest run shared/warrants-poller/__tests__/warrants-utah-gov.integration.test.ts
```

## User-agent decision (important)

The default UA in `sources/base.ts` is a current Chrome string, NOT a descriptive `RMPG-Flex-Warrants-Poller/1.0` identifier. This is **deliberate** and verified live: CloudFront-fronted state portals (warrants.utah.gov among them) return **403 to identifier-style UAs** even when the underlying API is public. The Chrome UA gets 200/201. Identifier UAs are RFC-encouraged but incompatible with current WAF defaults — don't "improve" this without re-validating every source.

### Two adapter modes

- **list-poll** — site publishes a public list/table; cron harvests periodically; `pollAll()` returns the full snapshot.
- **query-lookup** — site only exposes a search form; the adapter is called reactively (e.g. from MNI lookup) with `{name, dob?, age?}`; `lookup()` returns matches.

The orchestrator only runs `list-poll` sources. `query-lookup` adapters are wired into the existing MNI / skip-trace path.

### Calling convention for `lookup()`

**Pass both `dob` and `age` when the local person record has them.** `dob` is canonical truth; `age` is an optimization hint that adapters disambiguating by age (like warrants-utah-gov) prefer when both are present. If the local record only has age (legacy import paths), `age` alone is sufficient. Adapters MUST tolerate either field being absent.

Age-based disambiguation only fires when the upstream source returns **multiple** persons for the same name — single-match results are trusted on the API's name match alone, because dropping a real warrant due to a ±1y data-entry slip is a strictly worse outcome than presenting a possibly-misaged single match (which the officer visually verifies in the field anyway).

## Wiring into a Cloudflare Worker

```ts
// In the CF repo (NOT this repo):
import { runPoll } from './warrants-poller/orchestrator';
import { WarrantsUtahGovSource } from './warrants-poller/sources/warrants-utah-gov';
import { makeD1Store } from './adapters/d1-warrants-store'; // CF-side

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const store = makeD1Store(env.DB);
    const sources = [
      new SlcoSheriffSource(),     // list-poll
      // WarrantsUtahGovSource is query-lookup; do NOT pass to runPoll
    ];
    ctx.waitUntil(runPoll({ sources, store }));
  },
};
```

`wrangler.toml`:
```toml
[triggers]
crons = ["*/30 * * * *"]   # every 30 min; tune per source ToS
```

## Status (as of 2026-05-24)

| Source | Mode | Verified | Adapter |
|---|---|---|---|
| warrants.utah.gov | query-lookup | ✅ live JSON API (chrome-devtools MCP) | ✅ implemented |
| SLCo Sheriff (saltlakecounty.gov/sheriff) | — | ✅ verified: no separate warrant list | not needed (see below) |
| Weber County Sheriff | — | ✅ verified: links to statewide portal | not needed (see below) |
| Utah County / Davis County Sheriff | — | timeout/403 on automation; pattern predicts no separate list | not needed (see below) |
| Utah Courts XCHANGE (xchange.utcourts.gov) | — | ✅ verified: case dockets, not active warrants | deferred (see below) |

### Why only one adapter

Utah is **UCJIS-centralized**. County sheriffs contribute warrant data to the state index (UCJIS) rather than publishing duplicate public lists. Live evidence captured 2026-05-24:

- **Salt Lake County Sheriff** homepage has zero links containing "warrant"
- **Weber County Sheriff** has a "Statewide Warrant Search" link that points at the state (the linked URL `secure.utah.gov/warrants` is actually defunct, but the intent is clear — they don't publish their own)
- **warrants.utah.gov** is the live statewide aggregator that ingests from all counties via UCJIS

Building county-specific adapters would mean either (a) scraping data already present in `warrants.utah.gov` (waste + maintenance burden) or (b) building dead adapters against URLs that don't exist (silent half-build).

**XCHANGE** is a different data surface — court case dockets, not an active-warrants list. A case docket may *mention* warrant issuance as a docket entry, but extracting "currently-outstanding warrants" from dockets is a fragile derivative that would compete with UCJIS's authoritative version. Deferred unless a future requirement specifically needs court-level case context that warrants.utah.gov doesn't expose.

**Re-evaluate if**: a Utah county begins publishing its own active-warrants portal (would show up as a "Warrants" link on their sheriff homepage), or RMPG obtains UCJIS-credentialed API access (would unlock richer per-warrant data via the credentialed back-end, not via a different public site).

## DataStore contract for the CF agent

Implement these 5 methods backed by D1:

```ts
interface DataStore {
  findExistingWarrant(source, sourceWarrantId): Promise<WarrantRecord | null>;
  upsertWarrant(rec): Promise<{ inserted: boolean; warrantId: number }>;
  findPersonByNameDOB(name, dob): Promise<PersonStub | null>;
  linkWarrantToPerson(warrantId, personId): Promise<void>;
  recordAudit(result): Promise<void>;
}
```

Suggested D1 schema:

```sql
CREATE TABLE warrants (
  id            INTEGER PRIMARY KEY,
  source        TEXT NOT NULL,
  source_warrant_id TEXT NOT NULL,
  subject_name  TEXT NOT NULL,
  dob           TEXT,
  charges_json  TEXT NOT NULL,
  bond_amount   REAL,
  issued_date   TEXT,
  warrant_type  TEXT,
  raw_json      TEXT NOT NULL,
  fetched_at    TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  UNIQUE(source, source_warrant_id)
);
CREATE INDEX warrants_name_dob ON warrants(subject_name, dob);

CREATE TABLE warrant_person_links (
  warrant_id INTEGER NOT NULL REFERENCES warrants(id),
  person_id  INTEGER NOT NULL,
  linked_at  TEXT NOT NULL,
  PRIMARY KEY (warrant_id, person_id)
);

CREATE TABLE warrant_poll_audit (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  warrants_found INTEGER NOT NULL,
  warrants_inserted INTEGER NOT NULL,
  warrants_updated INTEGER NOT NULL,
  person_matches INTEGER NOT NULL,
  error TEXT
);
```
