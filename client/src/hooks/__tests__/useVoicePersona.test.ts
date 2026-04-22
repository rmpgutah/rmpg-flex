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

  it('mount-GET does not clobber a concurrent user edit', async () => {
    let resolveGet: (v: any) => void = () => {};
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementationOnce(
      () => new Promise((r) => { resolveGet = r; })
    );
    // Subsequent apiFetch calls (the PUT from setPersona) resolve normally.
    apiFetchMock.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useVoicePersona());

    // User edits BEFORE the mount-GET resolves.
    act(() => {
      result.current.setPersona({ terseness: 'terse' });
    });

    // Now release the GET with a DIFFERENT terseness value.
    await act(async () => {
      resolveGet({
        voice_persona: 'en-US-JennyNeural',
        voice_rate: 1.0,
        voice_pitch: 0,
        voice_terseness: 'standard',
      });
      await Promise.resolve();
    });

    // User's 'terse' edit must win — the late GET must not clobber it.
    expect(result.current.persona.terseness).toBe('terse');
    expect(localStorage.getItem('rmpg-voice-terseness')).toBe('terse');
  });

  it('mount-GET resolving after unmount does not write to localStorage', async () => {
    localStorage.setItem('rmpg-voice-persona', 'en-US-AriaNeural');
    let resolveGet: (v: any) => void = () => {};
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementationOnce(
      () => new Promise((r) => { resolveGet = r; })
    );

    const { unmount } = renderHook(() => useVoicePersona());
    unmount();

    await act(async () => {
      resolveGet({
        voice_persona: 'en-US-JennyNeural',
        voice_rate: 1.0,
        voice_pitch: 0,
        voice_terseness: 'standard',
      });
      await Promise.resolve();
    });

    // localStorage still shows the pre-existing value.
    expect(localStorage.getItem('rmpg-voice-persona')).toBe('en-US-AriaNeural');
  });

  it('garbage terseness in localStorage falls back to default', () => {
    localStorage.setItem('rmpg-voice-terseness', 'yelling');
    apiFetchMock.mockReset();
    // never resolves — state is strictly from localStorage
    apiFetchMock.mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHook(() => useVoicePersona());
    expect(result.current.persona.terseness).toBe('standard');
  });

  it('brainEnabled defaults to false when server returns 0', async () => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({
      voice_persona: 'en-US-JennyNeural',
      voice_rate: 1.0,
      voice_pitch: 0,
      voice_terseness: 'standard',
      voice_brain_enabled: 0,
    });
    const { result } = renderHook(() => useVoicePersona());
    await waitFor(() => expect(result.current.persona.brainEnabled).toBe(false));
    expect(localStorage.getItem('rmpg-voice-brain-enabled')).toBe('0');
  });

  it('brainEnabled reflects server value when enabled', async () => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({
      voice_persona: 'en-US-JennyNeural',
      voice_rate: 1.0,
      voice_pitch: 0,
      voice_terseness: 'standard',
      voice_brain_enabled: 1,
    });
    const { result } = renderHook(() => useVoicePersona());
    await waitFor(() => expect(result.current.persona.brainEnabled).toBe(true));
    expect(localStorage.getItem('rmpg-voice-brain-enabled')).toBe('1');
  });

  it('setPersona({brainEnabled: true}) sends voice_brain_enabled: 1 to server', async () => {
    const { result } = renderHook(() => useVoicePersona());
    await waitFor(() => expect(result.current.persona).toBeDefined());
    apiFetchMock.mockClear();
    act(() => { result.current.setPersona({ brainEnabled: true }); });
    await waitFor(() => {
      const put = apiFetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'PUT');
      expect(put).toBeTruthy();
    });
    const put: any[] = apiFetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'PUT')!;
    const body = JSON.parse(put[1].body as string);
    expect(body).toMatchObject({ voice_brain_enabled: 1 });
    expect(localStorage.getItem('rmpg-voice-brain-enabled')).toBe('1');
  });
});
