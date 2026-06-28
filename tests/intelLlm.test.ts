// tests/intelLlm.test.ts
// The Intel AI fallback ladder: Claude when a working key exists, else free
// Workers AI — always returning WHICH engine answered. Regression for the bug
// where an out-of-credit key made /ask, /extract, /summarize hard-fail with 502
// instead of degrading like Deep Research does.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runIntelLLM, INTEL_WORKERS_AI_MODEL } from '../src/utils/intelLlm';

// env stub: DB.first returns the configured anthropic key (or null), AI.run is
// the Workers AI fallback. getClaudeModel reads the same stub (harmless — the
// model id only matters to the fetch we stub).
function stubEnv(key: string | null, aiRun: (...a: any[]) => Promise<any>): any {
  const row = key ? { config_value: key } : null;
  // db.queryFirst calls `.first()` directly when there are no bindings (and
  // getAnthropicKey/getClaudeModel bind nothing), so the statement must expose
  // first()/all()/run() AND a chainable bind() that returns itself.
  const stmt: any = { first: async () => row, all: async () => ({ results: row ? [row] : [] }), run: async () => ({}), bind: () => stmt };
  return { DB: { prepare: () => stmt }, AI: { run: aiRun } };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('runIntelLLM fallback ladder', () => {
  it('no key → Workers AI, engine "workers-ai"', async () => {
    const env = stubEnv(null, async () => ({ response: 'free answer' }));
    expect(await runIntelLLM(env, { text: 'q' })).toEqual({ text: 'free answer', engine: 'workers-ai' });
  });

  it('coerces an object Workers AI response to a JSON string (JSON-eliciting prompts survive)', async () => {
    const env = stubEnv(null, async () => ({ response: { persons: [], vehicles: [] } }));
    const r = await runIntelLLM(env, { text: 'extract' });
    expect(r.engine).toBe('workers-ai');
    expect(JSON.parse(r.text)).toEqual({ persons: [], vehicles: [] });
  });

  // fetch stub mimics the subset of the Response callClaude() reads (ok/status/
  // json/text) — avoids depending on a global Response constructor in the test env.
  const fetchOk = (json: any) => vi.fn(async () => ({ ok: true, status: 200, json: async () => json, text: async () => '' }));
  const fetchErr = (status: number, body: string) => vi.fn(async () => ({ ok: false, status, json: async () => ({}), text: async () => body }));

  it('key present + Claude succeeds → engine "claude", Workers AI untouched', async () => {
    vi.stubGlobal('fetch', fetchOk({ content: [{ type: 'text', text: 'claude says hi' }] }));
    const ai = vi.fn(async () => ({ response: 'should not be used' }));
    const r = await runIntelLLM(stubEnv('sk-ant-test', ai), { text: 'q' });
    expect(r).toEqual({ text: 'claude says hi', engine: 'claude' });
    expect(ai).not.toHaveBeenCalled();
  });

  it('key present but Claude fails (out of credit) → falls back to Workers AI', async () => {
    vi.stubGlobal('fetch', fetchErr(400, '{"error":"credit balance too low"}'));
    const ai = vi.fn(async () => ({ response: 'fallback answer' }));
    const r = await runIntelLLM(stubEnv('sk-ant-test', ai), { text: 'q' });
    expect(r).toEqual({ text: 'fallback answer', engine: 'workers-ai' });
    expect(ai).toHaveBeenCalledWith(INTEL_WORKERS_AI_MODEL, expect.anything());
  });

  it('empty Claude reply also falls through to Workers AI', async () => {
    vi.stubGlobal('fetch', fetchOk({ content: [{ type: 'text', text: '   ' }] }));
    const r = await runIntelLLM(stubEnv('sk-ant-test', async () => ({ response: 'fallback' })), { text: 'q' });
    expect(r.engine).toBe('workers-ai');
    expect(r.text).toBe('fallback');
  });
});
