import { describe, it, expect, vi, beforeEach } from 'vitest';

const speakMock = vi.fn(async (..._args: any[]) => {});
vi.mock('../edgeTTS', () => ({
  speak: (...args: any[]) => speakMock(...args),
}));

// Import AFTER the mock so the queue module picks up our spy.
import { enqueueSpeech, __resetQueueForTest } from '../speakQueue';

describe('speakQueue', () => {
  beforeEach(() => {
    speakMock.mockClear();
    __resetQueueForTest();
  });

  it('speaks a single enqueued item', async () => {
    enqueueSpeech({ text: 'hello', severity: 'minor', ruleId: 'r1', entityKey: 'e1' });
    // let microtasks + the internal sleep settle (minor first item: no gap)
    await new Promise((r) => setTimeout(r, 20));
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0]?.[0]).toBe('hello');
  });

  it('sorts so major preempts minor when enqueued together', async () => {
    enqueueSpeech({ text: 'minor a', severity: 'minor',  ruleId: 'x', entityKey: '1' });
    enqueueSpeech({ text: 'major b', severity: 'major',  ruleId: 'y', entityKey: '2' });
    // drain: major should emerge first
    await new Promise((r) => setTimeout(r, 50));
    expect(speakMock.mock.calls[0]?.[0]).toBe('major b');
  });

  it('drops a dup inside the cooldown window', async () => {
    enqueueSpeech({ text: 'first',  severity: 'minor', ruleId: 'dup', entityKey: 'e1', cooldownMs: 10000 });
    await new Promise((r) => setTimeout(r, 10));
    enqueueSpeech({ text: 'second', severity: 'minor', ruleId: 'dup', entityKey: 'e1', cooldownMs: 10000 });
    await new Promise((r) => setTimeout(r, 10));
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0]?.[0]).toBe('first');
  });

  it('different entityKey bypasses the cooldown', async () => {
    enqueueSpeech({ text: 'first',  severity: 'minor', ruleId: 'dup', entityKey: 'e1', cooldownMs: 10000 });
    enqueueSpeech({ text: 'second', severity: 'minor', ruleId: 'dup', entityKey: 'e2', cooldownMs: 10000 });
    // Need ~6s for the global non-major rate limit between two minors.
    await new Promise((r) => setTimeout(r, 6100));
    expect(speakMock).toHaveBeenCalledTimes(2);
  }, 10000);

  it('major does NOT incur the global non-major rate limit', async () => {
    enqueueSpeech({ text: 'first',  severity: 'major', ruleId: 'a', entityKey: '1' });
    enqueueSpeech({ text: 'second', severity: 'major', ruleId: 'b', entityKey: '2' });
    await new Promise((r) => setTimeout(r, 50));
    expect(speakMock).toHaveBeenCalledTimes(2);
  });
});
