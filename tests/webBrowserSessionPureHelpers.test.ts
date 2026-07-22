import { describe, it, expect } from 'vitest';
import { isIdleTimedOut, shapeFrameMessage, shapeErrorMessage, shapeSessionEndedMessage, IDLE_TIMEOUT_MS } from '../src/durable-objects/webBrowserSession/pureHelpers';

describe('isIdleTimedOut', () => {
  it('is false right at lastInputAt', () => {
    expect(isIdleTimedOut(1000, 1000)).toBe(false);
  });
  it('is false just under the timeout', () => {
    expect(isIdleTimedOut(1000, 1000 + IDLE_TIMEOUT_MS - 1)).toBe(false);
  });
  it('is true at exactly the timeout', () => {
    expect(isIdleTimedOut(1000, 1000 + IDLE_TIMEOUT_MS)).toBe(true);
  });
  it('is true well past the timeout', () => {
    expect(isIdleTimedOut(1000, 1000 + IDLE_TIMEOUT_MS * 10)).toBe(true);
  });
});

describe('message shaping', () => {
  it('shapeFrameMessage wraps base64 jpeg data', () => {
    expect(shapeFrameMessage('abc123==')).toEqual({ type: 'frame', data: 'abc123==' });
  });
  it('shapeErrorMessage wraps a message string', () => {
    expect(shapeErrorMessage('bad url')).toEqual({ type: 'error', message: 'bad url' });
  });
  it('shapeSessionEndedMessage carries the reason', () => {
    expect(shapeSessionEndedMessage('idle_timeout')).toEqual({ type: 'session_ended', reason: 'idle_timeout' });
    expect(shapeSessionEndedMessage('closed')).toEqual({ type: 'session_ended', reason: 'closed' });
  });
});
