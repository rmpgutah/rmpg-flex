// ============================================================
// /api/ai/test/:provider — connectivity probe smoke tests.
// ============================================================
// Backs the new handler in src/routes/ai.ts that closes the
// `/api/ai/test/{groq,gemini,openai,ollama}` 404s in the 2026-06-21
// prod console dump. The handler reads the saved per-provider config
// from system_config and fires a single HTTP probe to the provider's
// /models endpoint (or /api/tags for Ollama), returning the
// `{ ok, latencyMs, error? }` contract that AIProvidersPanel +
// AICommandCenterPanel render in the per-provider Test button.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import ai from '../src/routes/ai';
import type { Env } from '../src/types';
import { makeFakeDb } from './helpers/fakeD1';

type Role = 'admin' | 'manager' | 'supervisor' | 'officer';

function buildApp(role: Role, db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'tester', role, full_name: 'Test' });
    await next();
  });
  app.route('/api/ai', ai);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db, AI: {} as any });
}

function configRow(value: object) {
  return [{ config_value: JSON.stringify(value) }];
}

describe('/api/ai/test/:provider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as any;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('rejects unknown provider with 400', async () => {
    const request = buildApp('admin', makeFakeDb([]));
    const res = await request('/api/ai/test/anthropic');
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Unknown provider/i);
  });

  it('rejects officer with 403', async () => {
    const request = buildApp('officer', makeFakeDb([]));
    const res = await request('/api/ai/test/groq');
    expect(res.status).toBe(403);
  });

  it('returns ok:false with clear error when no API key configured for groq', async () => {
    const request = buildApp('admin', makeFakeDb([]));
    const res = await request('/api/ai/test/groq');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/No API key configured/i);
  });

  it('returns ok:true + latencyMs when groq /models responds 200', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }) as any);
    const request = buildApp('admin', makeFakeDb([
      { match: /SELECT config_value FROM system_config\s+WHERE config_key = \?/, rows: configRow({ apiKey: 'gsk_test', model: 'llama-3' }) },
    ]));
    const res = await request('/api/ai/test/groq');
    const body = await res.json() as { ok: boolean; latencyMs: number; error?: string };
    expect(body.ok).toBe(true);
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer gsk_test' }) }),
    );
  });

  it('returns ok:false with HTTP code when provider rejects the key', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }) as any);
    const request = buildApp('admin', makeFakeDb([
      { match: /SELECT config_value FROM system_config/, rows: configRow({ apiKey: 'bad-key' }) },
    ]));
    const res = await request('/api/ai/test/openai');
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/HTTP 401/);
  });

  it('gemini probe uses key as query param (not Authorization header)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }) as any);
    const request = buildApp('admin', makeFakeDb([
      { match: /SELECT config_value FROM system_config/, rows: configRow({ apiKey: 'AIzaSyXYZ' }) },
    ]));
    await request('/api/ai/test/gemini');
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toContain('generativelanguage.googleapis.com');
    expect(call[0]).toContain('key=AIzaSyXYZ');
  });

  it('openai probe respects custom baseUrl', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }) as any);
    const request = buildApp('admin', makeFakeDb([
      { match: /SELECT config_value FROM system_config/, rows: configRow({ apiKey: 'sk-x', baseUrl: 'https://my-proxy.example.com/v1/' }) },
    ]));
    await request('/api/ai/test/openai');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://my-proxy.example.com/v1/models');
  });

  it('ollama returns clear "private/local" error for localhost (CF Workers cannot reach)', async () => {
    const request = buildApp('admin', makeFakeDb([
      { match: /SELECT config_value FROM system_config/, rows: configRow({ url: 'http://localhost:11434' }) },
    ]));
    const res = await request('/api/ai/test/ollama');
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/private\/local|not reachable/i);
    // The probe should never actually fire — we short-circuited.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ollama returns the local-only error for 127.0.0.1 and 192.168.x as well', async () => {
    for (const url of ['http://127.0.0.1:11434', 'http://192.168.1.10:11434', 'http://10.0.0.5:11434']) {
      fetchSpy.mockClear();
      const request = buildApp('admin', makeFakeDb([
        { match: /SELECT config_value FROM system_config/, rows: configRow({ url }) },
      ]));
      const res = await request('/api/ai/test/ollama');
      const body = await res.json() as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/private\/local|not reachable/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it('ollama with a public URL fires the probe', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('[]', { status: 200 }) as any);
    const request = buildApp('admin', makeFakeDb([
      { match: /SELECT config_value FROM system_config/, rows: configRow({ url: 'https://ollama.example.com' }) },
    ]));
    const res = await request('/api/ai/test/ollama');
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://ollama.example.com/api/tags');
  });

  it('returns ok:false on network error rather than throwing', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('fetch failed'));
    const request = buildApp('admin', makeFakeDb([
      { match: /SELECT config_value FROM system_config/, rows: configRow({ apiKey: 'sk-x' }) },
    ]));
    const res = await request('/api/ai/test/openai');
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/fetch failed/);
  });
});
