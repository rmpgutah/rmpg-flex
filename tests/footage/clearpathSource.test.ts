// tests/footage/clearpathSource.test.ts
import { describe, it, expect } from 'vitest';
import { buildMediaRequestPayload, parseRequestId, classifyChunkStatus } from '../../src/utils/footage/clearpathSource';

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
