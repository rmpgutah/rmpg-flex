import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock edgeTTS before importing voiceAlerts so the lazy `await import('./edgeTTS')`
// inside speakPhrase() resolves to our spy.
const speakSpy: any = vi.fn(async (..._args: any[]) => {});
vi.mock('../edgeTTS', () => ({
  speak: (...args: any[]) => speakSpy(...args),
  announceWithSeverity: (...args: any[]) => speakSpy(...args),
  clearQueue: vi.fn(),
  isEdgeTTSEnabled: () => true,
}));

// Mock dispatchTones to avoid real audio playback.
vi.mock('../dispatchTones', () => ({
  playToneAsync: vi.fn(async () => {}),
}));

// Ensure both the master sound toggle and the voice-alerts toggle are enabled
// so the announcement paths don't early-return. Polyfill SpeechSynthesis so
// isSpeechAvailable() returns true in jsdom.
beforeEach(() => {
  localStorage.setItem('rmpg-sound', '1');
  localStorage.setItem('rmpg-voice-alerts', '1');
  (window as any).speechSynthesis = {
    speak: () => {},
    cancel: () => {},
    getVoices: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as any).SpeechSynthesisUtterance = class {
    text: string;
    voice: any;
    rate = 1; pitch = 1; volume = 1; lang = 'en-US';
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) { this.text = text; }
  };
  speakSpy.mockClear();
});

describe('voiceAlerts honors terseness', () => {
  it('terse mode produces a short spoken line with P# shorthand', async () => {
    localStorage.setItem('rmpg-voice-terseness', 'terse');
    const { announceNewCall } = await import('../voiceAlerts');
    await announceNewCall({
      call_number: 'CN-1',
      priority: 'P1',
      incident_type: 'domestic',
      location_address: '123 Main St',
      assigned_units: ['3A'],
    } as any);
    // Allow queue to drain
    await new Promise((r) => setTimeout(r, 50));
    const spoken = (speakSpy.mock.calls as unknown as any[][]).map((c) => String(c[0])).join(' | ');
    expect(spoken).toMatch(/P1 domestic/);
    expect(spoken.length).toBeLessThan(100);
  });

  it('narrative mode produces a richer "New call / priority one" line', async () => {
    localStorage.setItem('rmpg-voice-terseness', 'narrative');
    const { announceNewCall } = await import('../voiceAlerts');
    await announceNewCall({
      call_number: 'CN-2',
      priority: 'P1',
      incident_type: 'domestic',
      location_address: '123 Main St',
      assigned_units: ['3A'],
    } as any);
    await new Promise((r) => setTimeout(r, 50));
    const spoken = (speakSpy.mock.calls as unknown as any[][]).map((c) => String(c[0])).join(' | ');
    expect(spoken).toMatch(/New call/);
    expect(spoken).toMatch(/priority one/);
  });

  it('standard mode keeps the existing multi-phrase cadence', async () => {
    localStorage.setItem('rmpg-voice-terseness', 'standard');
    const { announceNewCall } = await import('../voiceAlerts');
    await announceNewCall({
      call_number: 'CN-3',
      priority: 'P2',
      incident_type: 'domestic_disturbance',
      location_address: '456 Elm St',
      caller_name: 'Jane Doe',
    } as any);
    await new Promise((r) => setTimeout(r, 50));
    const spoken = (speakSpy.mock.calls as unknown as any[][]).map((c) => String(c[0])).join(' | ');
    // Standard mode still kicks off the legacy "Attention all units" preamble —
    // this single assertion is enough to prove we went down the multi-phrase
    // branch rather than the single-shot renderCallNarrative branch.
    expect(spoken).toMatch(/Attention all units/);
  });
});
