// ============================================================
// Serve Intake OCR fallback chains — docType forwarding
// ============================================================
// ocrText() (src/utils/serveIntakeOcr.ts) is the shared Claude-first/
// Workers-AI-fallback helper used by /scan-document and reprocessDocument
// (see src/routes/serveIntake.ts). It grew an optional `docType` param so
// those two call sites can carry the same document-family prompt guidance
// the /upload commit path already gets from familyFromFileName(). This
// test proves the parameter actually reaches the model call — i.e. it
// would fail if `docType` were accepted by ocrText() but silently dropped
// before reaching extractFromText()/buildExtractionMessages(), which is
// exactly the class of bug this task exists to close.
//
// No real case data — synthetic document text only.

import { describe, it, expect } from 'vitest';
import { ocrText } from '../src/utils/serveIntakeOcr';

// env.DB stub: every system_config lookup (anthropic_api_key, anthropic_model,
// openai_api_key, openai_model) resolves to "no row", so the Claude leg
// (extractFromTextClaude → callAi) fails fast with "key not configured" for
// both providers and ocrText() falls through to the Workers-AI leg — with NO
// real network call made, since callAi only calls out once a key is present.
function mkEnv(run: (model: string, opts: any) => Promise<any>): any {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => null }),
        first: async () => null,
      }),
    },
    AI: { run },
  };
}

describe('ocrText — docType forwarding to extractFromText', () => {
  it('threads docType through to the system prompt the model actually receives', async () => {
    let capturedMessages: Array<{ role: string; content: string }> | null = null;
    const env = mkEnv(async (_model: string, opts: any) => {
      capturedMessages = opts.messages;
      return {
        response: JSON.stringify({
          documentType: 'other',
          confidence: 0.5,
          fields: {},
        }),
      };
    });

    await ocrText(env, 'Some synthetic field-sheet document text goes here.', 'field_sheet');

    expect(capturedMessages).not.toBeNull();
    const system = capturedMessages!.find((m) => m.role === 'system')?.content ?? '';
    // buildFamilyPrompt('field_sheet') content — proves the family prompt
    // reached the actual model call, not just some intermediate function.
    expect(system).toMatch(/watermark/i);
    expect(system).toMatch(/ICU Investigations FIELD SHEET/i);
  });

  it('omits family guidance when docType is not passed (unchanged default behavior)', async () => {
    let capturedMessages: Array<{ role: string; content: string }> | null = null;
    const env = mkEnv(async (_model: string, opts: any) => {
      capturedMessages = opts.messages;
      return {
        response: JSON.stringify({ documentType: 'other', confidence: 0.5, fields: {} }),
      };
    });

    await ocrText(env, 'Some synthetic document text goes here.');

    expect(capturedMessages).not.toBeNull();
    const system = capturedMessages!.find((m) => m.role === 'system')?.content ?? '';
    expect(system).not.toMatch(/watermark/i);
    expect(system).not.toMatch(/ICU Investigations FIELD SHEET/i);
  });

  it('a DIFFERENT docType (court_filing) produces DIFFERENT guidance, proving the value — not just presence — is forwarded', async () => {
    let capturedMessages: Array<{ role: string; content: string }> | null = null;
    const env = mkEnv(async (_model: string, opts: any) => {
      capturedMessages = opts.messages;
      return {
        response: JSON.stringify({ documentType: 'other', confidence: 0.5, fields: {} }),
      };
    });

    await ocrText(env, 'Some synthetic court docket text goes here.', 'court_filing');

    const system = capturedMessages!.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toMatch(/caption/i);
    expect(system).not.toMatch(/watermark/i);
  });
});

// ============================================================
// R3 — the family prompt must reach the CLAUDE leg too
// ============================================================
// ocrText tries extractFromTextClaude FIRST and only falls back to the
// Workers-AI leg. docType used to be passed only to the fallback, so the
// moment anthropic_api_key was configured Claude won the race and the
// family-prompt wiring above became inert — a silent capability regression
// caused by setting a secret, invisible to every test that stubs the key
// away. These tests configure the key and intercept the HTTP call.
//
// No real case data — synthetic document text and a fake key only.
function mkClaudeEnv(capture: (body: any) => void): { env: any; restore: () => void } {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    capture(JSON.parse(init.body));
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ documentType: 'other', confidence: 0.5, fields: {} }) }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  const env: any = {
    DB: {
      prepare: (sql: string) => {
        const row = /anthropic_api_key/.test(sql) ? { config_value: 'sk-ant-fake-test-key' } : null;
        return { bind: () => ({ first: async () => row }), first: async () => row };
      },
    },
    AI: { run: async () => { throw new Error('Workers-AI leg must not run when Claude succeeds'); } },
  };
  return { env, restore: () => { globalThis.fetch = realFetch; } };
}

describe('ocrText — docType forwarding to the Claude leg', () => {
  it('threads docType into the Claude system prompt', async () => {
    let body: any = null;
    const { env, restore } = mkClaudeEnv((b) => { body = b; });
    try {
      await ocrText(env, 'Some synthetic field-sheet document text goes here.', 'field_sheet');
    } finally { restore(); }

    expect(body).not.toBeNull();
    expect(body.system).toMatch(/ICU Investigations FIELD SHEET/i);
    expect(body.system).toMatch(/watermark/i);
  });

  it('a DIFFERENT docType produces DIFFERENT Claude guidance (value, not just presence, is forwarded)', async () => {
    let body: any = null;
    const { env, restore } = mkClaudeEnv((b) => { body = b; });
    try {
      await ocrText(env, 'Some synthetic court docket text goes here.', 'court_filing');
    } finally { restore(); }

    expect(body.system).toMatch(/COURT FILING/i);
    expect(body.system).not.toMatch(/ICU Investigations FIELD SHEET/i);
  });

  it('omits family guidance on the Claude leg when docType is not passed', async () => {
    let body: any = null;
    const { env, restore } = mkClaudeEnv((b) => { body = b; });
    try {
      await ocrText(env, 'Some synthetic document text goes here.');
    } finally { restore(); }

    expect(body.system).not.toMatch(/ICU Investigations FIELD SHEET/i);
    expect(body.system).not.toMatch(/COURT FILING/i);
  });
});
