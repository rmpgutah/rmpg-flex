// Notification alerts had no speech at all — playNotificationTone played a
// tone and stopped. Pins the phrasing per priority, the PA voice mode, and
// that muting the speech does NOT mute the tone.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ text: string; mode: string }> = [];
vi.mock('../edgeTTS', () => ({
  speak: (text: string, _sev: unknown, mode: string) => {
    calls.push({ text, mode });
    return Promise.resolve();
  },
  isEdgeTTSEnabled: () => true,
  getEdgeTTSPayload: () => ({}),
}));

// playToneAsync must resolve or processQueue's isSpeaking latch never clears
// under jsdom and later enqueues are silently dropped.
const playSound = vi.fn();
vi.mock('../dispatchTones', () => ({
  playSound,
  playToneAsync: vi.fn().mockResolvedValue(undefined),
}));

const settle = () => new Promise((r) => setTimeout(r, 60));

describe('notification voice', () => {
  beforeEach(() => { calls.length = 0; playSound.mockClear(); localStorage.clear(); });

  it('prefixes critical with "Critical alert." and keeps the detail', async () => {
    const va = await import('../voiceAlerts');
    await va.announceNotification('critical', 'Officer down, unit S19.');
    await settle();
    expect(calls[0].text).toBe('Critical alert. Officer down, unit S19.');
  });

  it('prefixes high with "High priority."', async () => {
    const va = await import('../voiceAlerts');
    await va.announceNotification('high', 'Warrant hit on John Meyers.');
    await settle();
    expect(calls[0].text).toBe('High priority. Warrant hit on John Meyers.');
  });

  it('speaks normal priority with no prefix — the tone already says "something happened"', async () => {
    const va = await import('../voiceAlerts');
    await va.announceNotification('normal', 'Call 26-CFS00110 assigned to unit S19.');
    await settle();
    expect(calls[0].text).toBe('Call 26-CFS00110 assigned to unit S19.');
  });

  it('speaks through the alert_pa chain, not the radio chain', async () => {
    const va = await import('../voiceAlerts');
    await va.announceNotification('critical', 'Officer down.');
    await settle();
    expect(calls[0].mode).toBe('alert_pa');
  });

  it('ignores empty detail', async () => {
    const va = await import('../voiceAlerts');
    await va.announceNotification('critical', '   ');
    await settle();
    expect(calls.length).toBe(0);
  });

  it('stays silent when the notification category is muted', async () => {
    const va = await import('../voiceAlerts');
    va.setEventEnabled('notification', false);
    await va.announceNotification('critical', 'Officer down.');
    await settle();
    expect(calls.length).toBe(0);
  });

  it('still plays the TONE when only the voice is muted', async () => {
    const nt = await import('../notificationTones');
    const va = await import('../voiceAlerts');
    va.setEventEnabled('notification', false);
    nt.playNotificationTone('critical', 'Officer down.');
    await settle();
    expect(playSound).toHaveBeenCalledWith('emergency_three');
    expect(calls.length).toBe(0);
  });

  it('plays tone THEN speech when both are enabled', async () => {
    const nt = await import('../notificationTones');
    const va = await import('../voiceAlerts');
    va.setEventEnabled('notification', true);
    nt.playNotificationTone('high', 'Warrant hit.');
    await settle();
    expect(playSound).toHaveBeenCalledWith('alert');
    expect(calls[0].text).toBe('High priority. Warrant hit.');
  });

  it('plays the tone alone when no detail is supplied — existing callers unchanged', async () => {
    const nt = await import('../notificationTones');
    nt.playNotificationTone('normal');
    await settle();
    expect(playSound).toHaveBeenCalledWith('info');
    expect(calls.length).toBe(0);
  });
});
