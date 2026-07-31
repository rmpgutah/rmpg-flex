// A phrase must be able to pick its voice mode so notification alerts can
// speak through the PA chain while dispatch traffic stays on the radio chain.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const speakMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../edgeTTS', () => ({
  speak: (...args: unknown[]) => speakMock(...args),
  isEdgeTTSEnabled: () => true,
  getEdgeTTSPayload: () => ({}),
}));

describe('phrase voice mode', () => {
  beforeEach(() => {
    speakMock.mockClear();
    localStorage.clear();
  });

  it('passes alert_pa through to edgeTTS.speak as the 3rd argument', async () => {
    const va = await import('../voiceAlerts');
    await va.__speakPhraseForTest({ text: 'Critical alert.', mode: 'alert_pa' });
    expect(speakMock).toHaveBeenCalled();
    expect(speakMock.mock.calls[0][0]).toBe('Critical alert.');
    expect(speakMock.mock.calls[0][2]).toBe('alert_pa');
  });

  it('defaults to conversational when no mode is given', async () => {
    const va = await import('../voiceAlerts');
    await va.__speakPhraseForTest({ text: 'New call.' });
    expect(speakMock.mock.calls[0][2]).toBe('conversational');
  });

  it('never passes undefined as the mode — speak() would fall back silently', async () => {
    const va = await import('../voiceAlerts');
    await va.__speakPhraseForTest({ text: 'x' });
    expect(speakMock.mock.calls[0][2]).not.toBeUndefined();
  });
});
