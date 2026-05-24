# Utah Warrants Poller — Runtime-Agnostic Core

Pure TypeScript modules. No Express, no Cloudflare bindings, no `better-sqlite3`. Depends only on standard `fetch` and a small `DataStore` interface.

## Why portable?

The RMPG Flex VPS was decommissioned 2026-05-24; the system is being rehomed to Cloudflare Workers + D1 + R2 (see `memory/project_vps_decommissioned.md`). The CF Worker source lives in a separate repo this Claude session does not have access to. This core was built so that:

- A future CF cron handler can wire it up in ~30 lines (D1-backed `DataStore`)
- Local tests can run with an in-memory `DataStore`
- No code is wasted if the runtime target changes again

## Architecture

```
types.ts           WarrantRecord, PollResult, DataStore, AlertSink
normalize.ts       Name/DOB canonicalization + dedup keys (pure fns)
sources/base.ts    BaseWarrantSource: rate-limit + retry + UA wrapper
sources/*.ts       Per-source adapters (list-poll OR query-lookup)
orchestrator.ts    runPoll() — Promise.allSettled across sources,
                   per-source audit, MNI cross-link, alert fan-out
```

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

| Source | Mode | URL verified | Adapter |
|---|---|---|---|
| warrants.utah.gov | query-lookup | ✅ live API captured via chrome-devtools MCP 2026-05-24 | ✅ implemented |
| Salt Lake County Sheriff | list-poll | **URL UNKNOWN** | not started |
| Utah County Sheriff | list-poll | **URL UNKNOWN** | not started |
| Davis County Sheriff | list-poll | **URL UNKNOWN** | not started |
| Weber County Sheriff | list-poll | **URL UNKNOWN** | not started |
| Utah Courts XCHANGE | query-lookup | **URL UNKNOWN** | not started |

**Before any county adapter ships**, the real URL must be confirmed by a human with a browser open. URL-guessing produced a 5-of-6 miss rate in initial probing. See conversation log for the verification protocol.

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
