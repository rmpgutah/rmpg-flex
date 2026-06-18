// tests/footage/clearpathSource.test.ts
import { describe, it, expect } from 'vitest';
import { buildMediaRequestPayload, parseRequestId, classifyChunkStatus, isTriggerClip } from '../../src/utils/footage/clearpathSource';

describe('buildMediaRequestPayload', () => {
  it('builds the confirmed HAR-verified request body (timestamp ms, cameraTypes, duration sec)', () => {
    const body = buildMediaRequestPayload(1_000_000, 1_040_000, 'outside');
    expect(body.timestamp).toBe(1_000_000);   // start time in ms
    expect(body.duration).toBe(40);           // (1_040_000-1_000_000)/1000
    expect(body.cameraTypes).toEqual(['OUTSIDE']);
  });
  it('maps inside channel to INSIDE camera type', () => {
    expect(buildMediaRequestPayload(0, 20_000, 'inside').cameraTypes).toEqual(['INSIDE']);
  });
});

describe('parseRequestId', () => {
  it('reads common id field aliases', () => {
    expect(parseRequestId({ requestId: 'abc' })).toBe('abc');
    expect(parseRequestId({ id: 7 })).toBe('7');
    expect(parseRequestId({ mediaRequestId: 'm1' })).toBe('m1');
    expect(parseRequestId({})).toBeNull();
  });
});

describe('classifyChunkStatus', () => {
  it('available with an accessUrl', () => {
    const s = classifyChunkStatus({ status: 'AVAILABLE', accessUrl: 'https://s3/x.mp4', type: 'VIDEO' });
    expect(s.state).toBe('available');
    expect(s.accessUrl).toBe('https://s3/x.mp4');
  });
  it('requested while still processing', () => {
    expect(classifyChunkStatus({ status: 'PROCESSING' }).state).toBe('requested');
  });
  it('missing when the camera has no footage for the window', () => {
    expect(classifyChunkStatus({ status: 'NO_MEDIA' }).state).toBe('missing');
  });
});

describe('isTriggerClip', () => {
  const CHUNK = 40; // standard 40s chunk duration

  it('flags recognised driving-event types as trigger clips', () => {
    expect(isTriggerClip('hard brake event', null, CHUNK)).toBe(true);
    expect(isTriggerClip('Speeding Violation', null, CHUNK)).toBe(true);
    expect(isTriggerClip('Frontal Collision Warning', null, CHUNK)).toBe(true);
    expect(isTriggerClip('Lane Departure', null, CHUNK)).toBe(true);
    expect(isTriggerClip('SOS panic alert', null, CHUNK)).toBe(true);
  });

  it('accepts on-demand clips with empty eventType', () => {
    expect(isTriggerClip('', null, CHUNK)).toBe(false);
    expect(isTriggerClip('', 40, CHUNK)).toBe(false);
  });

  it('accepts clips with unrecognised (custom) eventType regardless of label', () => {
    expect(isTriggerClip('ON_DEMAND', null, CHUNK)).toBe(false);
    expect(isTriggerClip('REQUESTED', 40, CHUNK)).toBe(false);
    expect(isTriggerClip('custom-event-xyz', 40, CHUNK)).toBe(false);
  });

  it('duration guard: skips clips shorter than 75% of the requested window', () => {
    expect(isTriggerClip('', 29, CHUNK)).toBe(true);   // 29 < 30 (75% of 40)
    expect(isTriggerClip('', 30, CHUNK)).toBe(false);  // exactly 75% — accept
    expect(isTriggerClip('', 31, CHUNK)).toBe(false);
    expect(isTriggerClip('', 40, CHUNK)).toBe(false);
  });

  it('duration guard: null/undefined durationSec is not a skip signal', () => {
    expect(isTriggerClip('', null, CHUNK)).toBe(false);
    expect(isTriggerClip('', undefined, CHUNK)).toBe(false);
  });

  it('duration guard: works correctly for short final chunks', () => {
    // A 15s last segment: threshold = 11.25; a 15s clip should pass
    expect(isTriggerClip('', 15, 15)).toBe(false);
    // A 10s clip against a 15s chunk: 10 < 11.25 → skip
    expect(isTriggerClip('', 10, 15)).toBe(true);
  });

  it('event type check takes precedence — recognised type skipped even at full duration', () => {
    expect(isTriggerClip('hard brake event', 40, CHUNK)).toBe(true);
  });
});
