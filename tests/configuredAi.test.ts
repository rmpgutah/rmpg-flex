import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildProviderChain,
  providerEndpoint,
  isPrivateHost,
  extractProviderText,
  callConfiguredAi,
  type ProviderConfig,
} from '../src/utils/configuredAi';

describe('buildProviderChain', () => {
  const keys = { openai: 'sk-o', groq: 'gsk-g', gemini: 'AIza-g' };

  it('puts the configured provider first', () => {
    const chain = buildProviderChain('groq', true, {
      groq: { apiKey: keys.groq, model: 'llama-3.3-70b-versatile' },
    });
    expect(chain[0].name).toBe('groq');
    expect(chain[0].apiKey).toBe('gsk-g');
  });

  it('appends workers-ai as the terminal fallback when autoFallback is on', () => {
    const chain = buildProviderChain('openai', true, { openai: { apiKey: keys.openai } });
    expect(chain[chain.length - 1].name).toBe('workers-ai');
  });

  it('omits workers-ai when autoFallback is off and a real provider is configured', () => {
    const chain = buildProviderChain('openai', false, { openai: { apiKey: keys.openai } });
    expect(chain.map((p) => p.name)).toEqual(['openai']);
  });

  it('still yields workers-ai when autoFallback is off but the chosen provider has no key', () => {
    // Otherwise the chain would be empty and every dev-chat request would 500.
    const chain = buildProviderChain('openai', false, {});
    expect(chain.map((p) => p.name)).toEqual(['workers-ai']);
  });

  it('drops a keyless external provider rather than calling it unauthenticated', () => {
    const chain = buildProviderChain('gemini', true, { gemini: { model: 'gemini-1.5-flash' } });
    expect(chain.map((p) => p.name)).toEqual(['workers-ai']);
  });

  it('never queues ollama — Workers cannot reach private network space', () => {
    const chain = buildProviderChain('ollama', true, { ollama: { url: 'http://localhost:11434' } });
    expect(chain.some((p) => p.name === 'ollama')).toBe(false);
  });

  it('deduplicates when the configured provider is workers-ai', () => {
    const chain = buildProviderChain('workers-ai', true, {});
    expect(chain.map((p) => p.name)).toEqual(['workers-ai']);
  });

  it('falls back through the other configured providers after the primary', () => {
    const chain = buildProviderChain('groq', true, {
      groq: { apiKey: keys.groq },
      openai: { apiKey: keys.openai },
    });
    expect(chain.map((p) => p.name)).toEqual(['groq', 'openai', 'workers-ai']);
  });
});

describe('providerEndpoint', () => {
  it('uses the Groq OpenAI-compatible base', () => {
    expect(providerEndpoint({ name: 'groq', model: 'm', apiKey: 'k' }))
      .toBe('https://api.groq.com/openai/v1/chat/completions');
  });

  it('uses the OpenAI base by default', () => {
    expect(providerEndpoint({ name: 'openai', model: 'm', apiKey: 'k' }))
      .toBe('https://api.openai.com/v1/chat/completions');
  });

  it('honours a custom OpenAI baseUrl and strips a trailing slash', () => {
    expect(providerEndpoint({ name: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://proxy.example.com/v1/' }))
      .toBe('https://proxy.example.com/v1/chat/completions');
  });

  it('builds the Gemini generateContent URL from the model', () => {
    expect(providerEndpoint({ name: 'gemini', model: 'gemini-1.5-flash', apiKey: 'k' }))
      .toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent');
  });
});

describe('isPrivateHost', () => {
  it.each(['localhost', '127.0.0.1', '10.0.0.4', '192.168.1.9', '172.16.0.1', 'box.local', '::1'])(
    'flags %s as unreachable from a Worker', (h) => expect(isPrivateHost(h)).toBe(true));

  it.each(['api.openai.com', 'api.groq.com', ''])('allows %s', (h) => expect(isPrivateHost(h)).toBe(false));
});

describe('extractProviderText', () => {
  it('reads an OpenAI-shaped completion', () => {
    expect(extractProviderText('openai', {
      choices: [{ message: { content: '  hello  ' } }],
    })).toBe('hello');
  });

  it('reads a Gemini-shaped completion', () => {
    expect(extractProviderText('gemini', {
      candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }],
    })).toBe('ab');
  });

  it('reads a Workers AI completion', () => {
    expect(extractProviderText('workers-ai', { response: 'hi' })).toBe('hi');
  });

  it('returns empty string for junk rather than throwing', () => {
    expect(extractProviderText('openai', { nope: true })).toBe('');
    expect(extractProviderText('gemini', null)).toBe('');
  });
});

describe('callConfiguredAi', () => {
  afterEach(() => vi.unstubAllGlobals());

  const env = () => ({ AI: { run: vi.fn().mockResolvedValue({ response: 'from workers ai' }) } }) as any;
  const msgs = [{ role: 'user' as const, content: 'hi' }];

  it('returns the first provider that answers, without falling back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'from groq' } }] }), { status: 200 })));
    const chain: ProviderConfig[] = [
      { name: 'groq', model: 'm', apiKey: 'k' },
      { name: 'workers-ai', model: 'w' },
    ];
    const res = await callConfiguredAi(env(), chain, { messages: msgs });
    expect(res.content).toBe('from groq');
    expect(res.provider).toBe('groq');
    expect(res.fellBack).toBe(false);
  });

  it('falls back to the next provider on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    const e = env();
    const res = await callConfiguredAi(e, [
      { name: 'openai', model: 'm', apiKey: 'k' },
      { name: 'workers-ai', model: 'w' },
    ], { messages: msgs });
    expect(res.content).toBe('from workers ai');
    expect(res.provider).toBe('workers-ai');
    expect(res.fellBack).toBe(true);
    expect(e.AI.run).toHaveBeenCalled();
  });

  it('falls back when a provider returns 200 with empty content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 })));
    const res = await callConfiguredAi(env(), [
      { name: 'openai', model: 'm', apiKey: 'k' },
      { name: 'workers-ai', model: 'w' },
    ], { messages: msgs });
    expect(res.provider).toBe('workers-ai');
  });

  it('throws a single aggregated error when every provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const e = { AI: { run: vi.fn().mockRejectedValue(new Error('ai down')) } } as any;
    await expect(callConfiguredAi(e, [
      { name: 'openai', model: 'm', apiKey: 'k' },
      { name: 'workers-ai', model: 'w' },
    ], { messages: msgs })).rejects.toThrow(/all AI providers failed/i);
  });

  it('sends the system prompt as a leading system message for OpenAI-compatible providers', async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await callConfiguredAi(env(), [{ name: 'openai', model: 'm', apiKey: 'k' }],
      { messages: msgs, system: 'SYS' });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
  });

  it('routes the system prompt to system_instruction for Gemini', async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await callConfiguredAi(env(), [{ name: 'gemini', model: 'gemini-1.5-flash', apiKey: 'k' }],
      { messages: msgs, system: 'SYS' });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.system_instruction.parts[0].text).toBe('SYS');
    expect(body.contents[0].role).toBe('user');
  });

  it('throws rather than hanging when the chain is empty', async () => {
    await expect(callConfiguredAi(env(), [], { messages: msgs })).rejects.toThrow(/no AI provider/i);
  });
});
