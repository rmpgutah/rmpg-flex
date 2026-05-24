// REFERENCE INTEGRATION — copy and adapt into the Cloudflare Workers repo.
//
// Demonstrates both wiring patterns:
//
//   1. scheduled() cron handler for list-poll adapters
//      (none of our current adapters are list-poll, but the wiring shape
//      is here for when a county/state list source is added)
//
//   2. HTTP route POST /api/warrants/lookup for query-lookup adapters
//      (warrants-utah-gov is currently the only one)
//
// Required wrangler.toml entries (illustrative):
//
//   name = "rmpg-flex-warrants"
//   main = "src/worker.ts"
//   compatibility_date = "2026-05-01"
//   [[d1_databases]]
//     binding = "DB"
//     database_name = "rmpg-flex"
//     database_id = "<your D1 database id>"
//   [triggers]
//     crons = ["*/30 * * * *"]     # only needed if you add list-poll sources
//
// Auth/middleware: this reference omits JWT verification. In production
// the /api/warrants/lookup route MUST require an authenticated officer
// session — warrant queries are auditable per Utah open-records law.

import { runPoll } from '../orchestrator';
import { WarrantsUtahGovSource } from '../sources/warrants-utah-gov';
import type { BaseWarrantSource } from '../sources/base';
import { makeD1DataStore } from '../adapters/d1-datastore';

// Adjust to match your Worker's actual Env shape.
interface Env {
  DB: any; // D1Database
}

// Built once per Worker invocation. Cheap — adapters hold no per-call state
// beyond throttle timestamps, which reset each isolate. If you start
// caching parsed responses, hoist this outside the handler.
function buildSources(): BaseWarrantSource[] {
  return [new WarrantsUtahGovSource()];
}

export default {
  // --- HTTP request entry point ---
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Query-lookup route — called from MNI / skip-trace surface in the
    // dispatch UI when an officer pulls up a person record.
    if (url.pathname === '/api/warrants/lookup' && request.method === 'POST') {
      // TODO(integrator): replace with your existing auth middleware.
      // Officer must be authenticated AND the lookup MUST be audit-logged
      // (subject name + officer ID + timestamp) per Utah GRAMA + agency
      // policy. Don't ship this route without that.
      const body = (await request.json()) as { name?: string; dob?: string; age?: number };
      if (!body.name) return jsonResponse({ error: 'name required' }, 400);

      const sources = buildSources();
      const querySources = sources.filter((s) => s.mode === 'query-lookup');

      // Fan out to every query-lookup adapter in parallel. Each handles
      // its own throttling + retries internally; failures of one source
      // don't abort the others (Promise.allSettled).
      const settled = await Promise.allSettled(
        querySources.map((s) => s.lookup({ name: body.name!, dob: body.dob, age: body.age })),
      );

      const warrants = settled.flatMap((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        // Log per-source failure but don't fail the whole request.
        console.error(`warrants lookup failed for ${querySources[i].id}:`, r.reason);
        return [];
      });

      return jsonResponse({
        query: { name: body.name, dob: body.dob, age: body.age },
        warrants,
        sourceErrors: settled
          .map((r, i) => (r.status === 'rejected' ? { source: querySources[i].id, error: String(r.reason?.message ?? r.reason) } : null))
          .filter((x): x is { source: string; error: string } => x !== null),
      });
    }

    return jsonResponse({ error: 'not found' }, 404);
  },

  // --- Cron entry point ---
  // Wired only if wrangler.toml has [triggers] crons. Today no list-poll
  // sources exist, so this is a no-op — but leaving it wired means adding
  // a county sheriff list adapter later only requires editing
  // buildSources() above (no Worker config change).
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const sources = buildSources();
    const store = makeD1DataStore({ db: env.DB });
    // waitUntil keeps the cron alive until the poll finishes even though
    // the handler returns immediately.
    ctx.waitUntil(
      (async () => {
        const results = await runPoll({ sources, store });
        for (const r of results) {
          if (!r.ok) console.error('warrant poll failed', r);
        }
      })(),
    );
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// === Minimal ambient types so this file typechecks in isolation. ===
// When you copy into the CF repo, delete this block and rely on the real
// @cloudflare/workers-types ambient declarations.
declare global {
  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
  }
  interface ScheduledEvent {
    cron: string;
    scheduledTime: number;
  }
}
export {};
