import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoicePersona } from '../useVoicePersona';

const apiFetchMock = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: any[]) => apiFetchMock(...args),
}));

describe('useVoicePersona', () => {
  beforeEach(() => {
    localStorage.clear();
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({
      voice_persona: 'en-US-JennyNeural',
      voice_rate: 1.0,
      voice_pitch: 0,
      voice_terseness: 'standard',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads from server and writes through to localStorage', async () => {
    const { result } = renderHook(() => useVoicePersona());
    await waitFor(() => expect(result.current.persona.voiceId).toBe('en-US-JennyNeural'));
    expect(localStorage.getItem('rmpg-voice-persona')).toBe('en-US-JennyNeural');
    expect(localStorage.getItem('rmpg-voice-terseness')).toBe('standard');
  });

  it('optimistically updates localStorage on setPersona', async () => {
    const { result } = renderHook(() => useVoicePersona());
    await waitFor(() => expect(result.current.persona).toBeDefined());
    act(() => {
      result.current.setPersona({ terseness: 'terse' });
    });
    expect(localStorage.getItem('rmpg-voice-terseness')).toBe('terse');
    expect(result.current.persona.terseness).toBe('terse');
  });

  it('PUT is sent with mapped server field names (voice_* not camelCase)', async () => {
    const { result } = renderHook(() => useVoicePersona());
    await waitFor(() => expect(result.current.persona).toBeDefined());
    apiFetchMock.mockClear();
    act(() => {
      result.current.setPersona({ voiceId: 'en-US-GuyNeural', rate: 1.1 });
    });
    await waitFor(() => {
      const putCall = apiFetchMock.mock.calls.find((c) => (c[1]?.method === 'PUT'));
      expect(putCall).toBeTruthy();
    });
    const putCall = apiFetchMock.mock.calls.find((c) => (c[1]?.method === 'PUT'))!;
    const body = JSON.parse(putCall[1].body as string);
    expect(body).toMatchObject({ voice_persona: 'en-US-GuyNeural', voice_rate: 1.1 });
    expect(body).not.toHaveProperty('voiceId');
  });

  it('falls back to localStorage if server GET fails', async () => {
    localStorage.setItem('rmpg-voice-persona', 'en-US-AriaNeural');
    apiFetchMock.mockReset();
    apiFetchMock.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useVoicePersona());
    // initial state already from localStorage
    expect(result.current.persona.voiceId).toBe('en-US-AriaNeural');
  });
});
