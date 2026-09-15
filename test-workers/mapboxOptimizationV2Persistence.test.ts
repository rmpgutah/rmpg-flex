import { env } from 'cloudflare:test';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import initialSchema from '../migrations/0254_mapbox_optimization_v2_jobs.sql?raw';
import fleetMigration from '../migrations/0286_mapbox_fleet_optimization.sql?raw';
import { pollOptimizationV2Job, type OptimizationJob } from '../src/utils/mapboxOptimizationV2Jobs';

beforeAll(async () => {
  for (const statement of initialSchema.split(';').filter(s => s.trim())) await env.DB.prepare(statement).run();
  await env.DB.prepare("INSERT INTO mapbox_optimization_v2_jobs(id,job_type,created_by,problem_json) VALUES ('existing','serve_run',1,'{}')").run();
  for (const statement of fleetMigration.split(';').filter(s => s.trim())) await env.DB.prepare(statement).run();
  await env.DB.prepare('CREATE TABLE serve_routes (id INTEGER PRIMARY KEY, optimized_order_json TEXT, total_distance_miles REAL, total_time_minutes REAL, updated_at TEXT)').run();
});
afterEach(() => vi.unstubAllGlobals());
describe('V2 D1 persistence', () => {
  it('preserves existing jobs and permits fleet jobs after migration', async () => {
    expect(await env.DB.prepare("SELECT id FROM mapbox_optimization_v2_jobs WHERE id='existing'").first()).toEqual({ id: 'existing' });
    await env.DB.prepare("INSERT INTO mapbox_optimization_v2_jobs(id,job_type,created_by,problem_json) VALUES ('fleet','fleet_route',1,'{}')").run();
    expect(await env.DB.prepare("SELECT job_type FROM mapbox_optimization_v2_jobs WHERE id='fleet'").first()).toEqual({ job_type: 'fleet_route' });
  });
  it('commits solution and saved order together, and protects newer route plans', async () => {
    await env.DB.prepare("INSERT INTO serve_routes(id,optimized_order_json) VALUES (12,'[]')").run();
    for (const id of ['older', 'newer']) await env.DB.prepare("INSERT INTO mapbox_optimization_v2_jobs(id,job_type,created_by,problem_json,ref_id) VALUES (?,'serve_run',1,'{}',12)").bind(id).run();
    const solution = (id: string) => ({ dropped: { services: [], shipments: [] }, routes: [{ vehicle: 'A', stops: [{ type: 'service', location: id, services: [id], eta: '2026-09-09T12:00:00Z', odometer: 0 }] }] });
    for (const [id, service] of [['newer', '20'], ['older', '10']]) {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json(solution(service))));
      const job = await env.DB.prepare('SELECT * FROM mapbox_optimization_v2_jobs WHERE id=?').bind(id).first<OptimizationJob>();
      expect((await pollOptimizationV2Job(env.DB, 'pk.test', job!)).status).toBe('complete');
    }
    expect(await env.DB.prepare('SELECT optimized_order_json FROM serve_routes WHERE id=12').first()).toEqual({ optimized_order_json: '[20]' });
    expect(await env.DB.prepare("SELECT status FROM mapbox_optimization_v2_jobs WHERE id='older'").first()).toEqual({ status: 'complete' });
  });
});
