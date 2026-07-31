// Pins the exact spoken output. The bug was a template that produced
// "Update on call . <unrelated text>" whenever callNumber was empty —
// which was 14 of 16 call sites.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const spoken: string[] = [];
const speakMock = vi.fn((text: string) => { spoken.push(text); return Promise.resolve(); });
vi.mock('../edgeTTS', () => ({
  speak: (...a: unknown[]) => speakMock(a[0] as string),
  isEdgeTTSEnabled: () => true,
  getEdgeTTSPayload: () => ({}),
}));

// processQueue() ends every drain with a 'roger' courtesy beep and only then
// clears its isSpeaking latch. The real playToneAsync never resolves under
// jsdom (no WebAudio), so without this mock the latch stays set and every
// later enqueue is silently dropped — which looks exactly like a product bug.
vi.mock('../dispatchTones', () => ({
  playSound: vi.fn(),
  playToneAsync: vi.fn().mockResolvedValue(undefined),
}));

const settle = () => new Promise((r) => setTimeout(r, 60));

describe('call update phrasing', () => {
  beforeEach(() => { spoken.length = 0; speakMock.mockClear(); localStorage.clear(); });

  it('says exactly "Call updated." regardless of arguments', async () => {
    const va = await import('../voiceAlerts');
    await va.announceCallUpdate('26-CFS00110', 'New note added', 'Zamora');
    await settle();
    expect(spoken).toEqual(['Call updated.']);
  });

  it('never emits the old malformed "Update on call ." text', async () => {
    const va = await import('../voiceAlerts');
    await va.announceCallUpdate('', '5 units active. 2 available.');
    await settle();
    const all = spoken.join(' ');
    expect(all).not.toContain('Update on call');
    // no space-before-period, the audible artifact of the empty interpolation
    expect(all).not.toMatch(/\s\./);
  });

  it('speakDispatcherResponse speaks its text verbatim with no prefix', async () => {
    const va = await import('../voiceAlerts');
    await va.speakDispatcherResponse('5 units active. 2 available, 1 en route.');
    await settle();
    expect(spoken).toEqual(['5 units active. 2 available, 1 en route.']);
  });

  it('speakDispatcherResponse ignores empty and whitespace-only text', async () => {
    const va = await import('../voiceAlerts');
    await va.speakDispatcherResponse('');
    await va.speakDispatcherResponse('   ');
    await settle();
    expect(spoken).toEqual([]);
  });

  it('speakDispatcherResponse does NOT dedup — repeated queries must answer', async () => {
    const va = await import('../voiceAlerts');
    await va.speakDispatcherResponse('3 pending calls.');
    await settle();
    await va.speakDispatcherResponse('3 pending calls.');
    await settle();
    expect(spoken).toEqual(['3 pending calls.', '3 pending calls.']);
  });
});
