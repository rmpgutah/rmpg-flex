import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import router from '../src/routes/mapboxOptimizationV2';
import { normalizeOptimizationSolution, pollOptimizationV2Job, type OptimizationJob } from '../src/utils/mapboxOptimizationV2Jobs';
import { optimizationSubmitSchema, validateOptimizationProblem } from '../src/utils/mapboxOptimizationV2Validation';

const job: OptimizationJob = { id: 'job', job_type: 'serve_run', status: 'pending', ref_id: 12, created_at: new Date().toISOString(), problem_json: '{"options":{"avg_mpg":25}}', solution_json: null, error_message: null };
const solution = { dropped: { services: [], shipments: [] }, routes: [{ vehicle: 'A1', stops: [
  { type: 'start', location: 'depot', eta: '2026-09-09T12:00:00Z', odometer: 0 },
  { type: 'service', location: 'location-name', services: ['10', '11'], eta: '2026-09-09T12:10:00Z', odometer: 1609.344 },
  { type: 'end', location: 'depot', eta: '2026-09-09T12:30:00Z', odometer: 3218.688 },
] }] };
function database() {
  const statements: { sql: string; args: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => {
      const record = { sql, args: [] as unknown[] }; statements.push(record);
      const stmt = { bind: (...args: unknown[]) => { record.args = args; return stmt; }, run: vi.fn(async () => ({ meta: { changes: 1 } })), first: async () => ({ ...job, created_by: 1 }) };
      return stmt;
    },
    batch: vi.fn(async (_statements: unknown[]) => []),
  };
  return { db: db as unknown as D1Database, batch: db.batch, statements };
}
afterEach(() => vi.unstubAllGlobals());
describe('Optimization lifecycle', () => {
  it('keeps an empty HTTP 202 processing without writing a solution', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 202 })));
    const { db, batch, statements } = database();
    expect((await pollOptimizationV2Job(db, 'pk.test', job)).status).toBe('processing');
    expect(batch).not.toHaveBeenCalled();
    expect(statements[0].sql).toContain("status='processing'");
  });
  it('retries rate limits and server errors', async () => {
    for (const status of [429, 500, 503]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
      const { db, statements } = database();
      expect((await pollOptimizationV2Job(db, 'pk.test', job)).status).toBe('processing');
      expect(statements).toHaveLength(0);
    }
  });
  it('rejects malformed success without committing completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'processing' })));
    const { db, batch } = database();
    expect((await pollOptimizationV2Job(db, 'pk.test', job)).error).toBe('poll_failed');
    expect(batch).not.toHaveBeenCalled();
  });
  it('atomically writes all service IDs and derived route metrics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(solution)));
    const { db, batch, statements } = database();
    const result = await pollOptimizationV2Job(db, 'pk.test', job);
    expect(result.status).toBe('complete');
    expect(result.avg_mpg).toBe(25);
    expect(batch).toHaveBeenCalledOnce();
    expect(statements[0].args.slice(0, 3)).toEqual(['[10,11]', 2, 30]);
    expect(statements[0].sql).toContain('newer.rowid');
    expect(batch.mock.calls[0][0]).toHaveLength(2);
  });
  it('times out pending jobs by creation time', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { db } = database();
    expect((await pollOptimizationV2Job(db, 'pk.test', { ...job, created_at: '2020-01-01 00:00:00' })).error).toBe('timed_out');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns fuel metadata on cached results', async () => {
    const { db } = database();
    expect((await pollOptimizationV2Job(db, null, { ...job, status: 'complete', solution_json: JSON.stringify(solution) })).avg_mpg).toBe(25);
  });
  it('denies another officer access before polling or returning cached data', async () => {
    const app = new Hono<any>();
    app.use('*', async (c, next) => { c.set('user', { id: 2, role: 'officer' }); await next(); });
    app.route('/', router);
    const { db } = database();
    expect((await app.request('/job', {}, { DB: db })).status).toBe(403);
  });
  it('derives metrics from documented stop fields', () => {
    const normalized = normalizeOptimizationSolution(structuredClone(solution));
    expect(normalized.routes[0].duration).toBe(1800);
    expect(normalized.routes[0].distance).toBe(3218.688);
  });
});
describe('Optimization request validation', () => {
  it('rejects duplicate IDs, invalid coordinates, and reversed shifts', () => {
    expect(optimizationSubmitSchema.safeParse({ job_type: 'multi_unit_dispatch', call_ids: [1, 1], unit_ids: [1] }).success).toBe(false);
    expect(optimizationSubmitSchema.safeParse({ job_type: 'serve_run', serve_queue_ids: [1], origin: { lat: 200, lng: 0 }, shift_start: '2026-09-09T12:00:00Z', shift_end: '2026-09-09T11:00:00Z' }).success).toBe(false);
  });
  it('supports fleet shipments and validates location references', () => {
    const parsed = optimizationSubmitSchema.parse({ job_type: 'fleet_route', problem: { version: 1, locations: [{ name: 'a', coordinates: [0, 0] }], vehicles: [{ name: 'truck', capacities: { boxes: 2 }, loading_policy: 'fifo' }], shipments: [{ name: 'box', from: 'a', to: 'a', size: { boxes: 1 } }] } });
    if (parsed.job_type !== 'fleet_route') throw new Error('wrong type');
    expect(() => validateOptimizationProblem(parsed.problem)).not.toThrow();
    parsed.problem.shipments![0].to = 'missing';
    expect(() => validateOptimizationProblem(parsed.problem)).toThrow('Unknown location');
  });
});
