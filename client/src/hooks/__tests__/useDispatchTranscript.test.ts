import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useDispatchTranscript,
  pushTranscriptEntry,
  clearTranscript,
} from '../useDispatchTranscript';

beforeEach(() => { clearTranscript(); });

describe('useDispatchTranscript', () => {
  it('pushed entries appear in the subscriber hook', () => {
    const { result } = renderHook(() => useDispatchTranscript());
    act(() => {
      pushTranscriptEntry({ text: 'hello', severity: 'minor', source: 'system' });
    });
    expect(result.current.entries[result.current.entries.length - 1]?.text).toBe('hello');
  });

  it('caps at 100 entries (oldest dropped)', () => {
    for (let i = 0; i < 150; i++) {
      pushTranscriptEntry({ text: `e${i}`, severity: 'minor', source: 'system' });
    }
    const { result } = renderHook(() => useDispatchTranscript());
    expect(result.current.entries.length).toBe(100);
    // Last entry should be the most recent.
    expect(result.current.entries[result.current.entries.length - 1]?.text).toBe('e149');
    // First retained entry should be e50 (149 - 100 + 1 = 50).
    expect(result.current.entries[0]?.text).toBe('e50');
  });

  it('assigns a unique id and timestamp to each entry', () => {
    pushTranscriptEntry({ text: 'a', severity: 'minor', source: 'system' });
    pushTranscriptEntry({ text: 'b', severity: 'minor', source: 'system' });
    const { result } = renderHook(() => useDispatchTranscript());
    const [a, b] = result.current.entries;
    expect(a.id).not.toBe(b.id);
    expect(typeof a.ts).toBe('number');
    expect(a.ts).toBeLessThanOrEqual(b.ts);
  });

  it('clearTranscript empties the buffer and notifies subscribers', () => {
    pushTranscriptEntry({ text: 'x', severity: 'minor', source: 'system' });
    const { result } = renderHook(() => useDispatchTranscript());
    expect(result.current.entries.length).toBe(1);
    act(() => clearTranscript());
    expect(result.current.entries.length).toBe(0);
  });
});
