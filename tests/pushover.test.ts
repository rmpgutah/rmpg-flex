import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendPushover, cadPriorityToPushover } from '../src/utils/pushover';

// ── cadPriorityToPushover ─────────────────────────────────────────────────────

describe('cadPriorityToPushover', () => {
  it('maps critical to 1', () => expect(cadPriorityToPushover('critical')).toBe(1));
  it('maps urgent to 1', () => expect(cadPriorityToPushover('urgent')).toBe(1));
  it('maps CRITICAL (case-insensitive) to 1', () => expect(cadPriorityToPushover('CRITICAL')).toBe(1));
  it('maps high to 0', () => expect(cadPriorityToPushover('high')).toBe(0));
  it('maps normal to -1', () => expect(cadPriorityToPushover('normal')).toBe(-1));
  it('maps low to -1', () => expect(cadPriorityToPushover('low')).toBe(-1));
  it('maps empty string to -1', () => expect(cadPriorityToPushover('')).toBe(-1));
});

// ── sendPushover ──────────────────────────────────────────────────────────────

describe('sendPushover', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns ok:true on a successful 200 response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ status: 1, request: 'abc' }), { status: 200 }));
    const result = await sendPushover('app_token', 'user_key', { message: 'Test' });
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    // Verify the correct URL was called
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.pushover.net/1/messages.json');
  });

  it('returns ok:false with errors on API error response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ status: 0, errors: ['user key is invalid'] }),
      { status: 400 },
    ));
    const result = await sendPushover('app_token', 'bad_key', { message: 'Test' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('user key is invalid');
  });

  it('returns ok:false on network failure', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network error'));
    const result = await sendPushover('app_token', 'user_key', { message: 'Test' });
    expect(result.ok).toBe(false);
    expect(result.errors?.[0]).toContain('network error');
  });

  it('includes optional fields in the request body', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ status: 1 }), { status: 200 }));
    await sendPushover('tok', 'key', {
      title: 'ALERT',
      message: 'P1 Call',
      priority: 1,
      sound: 'siren',
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get('title')).toBe('ALERT');
    expect(body.get('priority')).toBe('1');
    expect(body.get('sound')).toBe('siren');
  });
});
