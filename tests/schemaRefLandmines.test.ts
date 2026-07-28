// ============================================================
// Schema-reference landmines
// ============================================================
// Six queries named columns that do not exist on live D1. None of them
// failed a build, a typecheck, or a test -- SQL is a string, and the row type
// is a lie the compiler cannot check. They threw "no such column" at runtime,
// on the specific code path, and every one of them was wrapped in a catch
// that returned an empty array.
//
// So they did not 500. They returned NOTHING, forever, quietly:
//
//   vehicle_sightings.unit_id        -> sightings never replayed (171 rows)
//   audit_log.detail                 -> audit never replayed (4,226 rows)
//   gps_breadcrumbs.created_at       -> GPS never replayed (249,816 rows)
//   citations.lat / .lng             -> citations never replayed (2 rows)
//   serve_queue.lat/.lng/.assigned_to -> route optimizer bbox always null
//   nsopw_query_cache.first_name ... -> SOR screen queried a response CACHE
//                                       instead of national_sex_offenders
//
// 254,215 rows sat unreplayed behind that silence while the pipeline
// reported success.
//
// This test pins the column names each query depends on. It reads the SOURCE
// rather than hitting D1, so it runs in CI without network or credentials --
// the live schema was verified by hand via pragma_table_info when the fix
// landed, and these assertions freeze that result.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('serve route optimizer bounding box', () => {
  const src = read('utils/serveRouteOptimizer.ts');

  it('reads the columns serve_queue actually has', () => {
    expect(src).toContain('recipient_lat AS lat');
    expect(src).toContain('recipient_lng AS lng');
  });

  it('filters on officer_id, the column live rows populate', () => {
    // assigned_officer_id exists but is populated on 0 of 23 live rows.
    expect(src).toContain('WHERE officer_id = ?');
    expect(src).not.toMatch(/WHERE\s+assigned_to\s*=/);
  });

  it('no longer selects the non-existent bare lat/lng', () => {
    expect(src).not.toMatch(/SELECT lat, lng FROM serve_queue/);
  });
});

describe('SOR screening', () => {
  const src = read('utils/serveAttemptEnhanced.ts');

  it('queries the offender table, not the query-response cache', () => {
    // nsopw_query_cache holds cache_key / raw_response / hit_offender_ids --
    // none of the columns this lookup projects.
    expect(src).toContain('FROM national_sex_offenders');
    expect(src).not.toMatch(/first_name, last_name, jurisdiction, offense, risk_level\s*\n\s*FROM nsopw_query_cache/);
  });
});

describe('analytics replay streams', () => {
  const src = read('routes/reanalysis.ts');

  it('uses audit_log.details, not .detail', () => {
    expect(src).toContain('details AS detail');
  });

  it('uses gps_breadcrumbs.recorded_at, not .created_at', () => {
    expect(src).toContain('recorded_at AS created_at');
  });

  it('uses citations.latitude/longitude, not .lat/.lng', () => {
    expect(src).toContain('latitude AS lat, longitude AS lng');
  });

  it('does not project vehicle_sightings.unit_id, which does not exist', () => {
    expect(src).not.toMatch(/confidence, lat, lng, created_at, unit_id/);
  });

  it('never swallows a stream failure silently', () => {
    // The empty-array fallback is deliberate -- one broken stream must not
    // abort the whole replay -- but it has to be LOUD. A bare catch returning
    // [] is what hid all four defects above.
    expect(src).not.toContain('.catch(() => [])');
    expect(src).toContain('replayFail(');
    expect(src).toContain('Analytics replay stream failed');
  });
});
