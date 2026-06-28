// tests/footage/clearpathSource.test.ts
import { describe, it, expect } from 'vitest';
import { buildMediaRequestPayload, parseRequestId, classifyChunkStatus, isTriggerClip, pickBestClip, type PollCandidatePage } from '../../src/utils/footage/clearpathSource';

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

describe('pickBestClip — per-request URL dedup (segment-to-segment copy fix)', () => {
  const FROM = 1_700_000_000_000;
  const TO   = FROM + 40_000;
  const SLOP = 120_000;

  function clip(tsOffsetMs: number, accessUrl: string, durationSec = 40, eventType = '', channel = 'outside'): PollCandidatePage['items'][number] {
    return {
      eventTimestamp: FROM + tsOffsetMs,
      mediaObject: [{ channel, type: 'VIDEO', eventType, durationSec, status: 'AVAILABLE', accessUrl }],
    };
  }

  it('returns the only available clip when nothing is claimed', () => {
    const page: PollCandidatePage = { items: [clip(20_000, 'https://s3/a.mp4')] };
    const r = pickBestClip(page, FROM, TO, 'outside', SLOP);
    expect(r.state).toBe('available');
    expect(r.accessUrl).toBe('https://s3/a.mp4');
  });

  it('skips a clip whose URL is already claimed and returns requested if no alternative', () => {
    const page: PollCandidatePage = { items: [clip(20_000, 'https://s3/a.mp4')] };
    const claimed = new Set(['https://s3/a.mp4']);
    const r = pickBestClip(page, FROM, TO, 'outside', SLOP, claimed);
    expect(r.state).toBe('requested');
  });

  it('picks the second-best clip when the closest one is claimed', () => {
    // closer clip at +10s is claimed; further clip at +60s should win
    const page: PollCandidatePage = {
      items: [clip(10_000, 'https://s3/closer.mp4'), clip(60_000, 'https://s3/farther.mp4')],
    };
    const claimed = new Set(['https://s3/closer.mp4']);
    const r = pickBestClip(page, FROM, TO, 'outside', SLOP, claimed);
    expect(r.state).toBe('available');
    expect(r.accessUrl).toBe('https://s3/farther.mp4');
  });

  it('reproduces the request-14 scenario: 3 chunks, 2 unique clips → first 2 get distinct URLs, 3rd gets requested', () => {
    // ClearPath returns the same 2 clips to every chunk's poll.
    // After chunk seq=0 downloads clipA and seq=1 downloads clipB, seq=2 must NOT
    // match either — it should stay 'requested' rather than triple-download clipB.
    const page: PollCandidatePage = {
      items: [clip(10_000, 'https://s3/A.mp4'), clip(50_000, 'https://s3/B.mp4')],
    };
    const claimed = new Set<string>();

    // seq 0: window [FROM, FROM+40s]
    const r0 = pickBestClip(page, FROM, FROM + 40_000, 'outside', SLOP, claimed);
    expect(r0.state).toBe('available');
    claimed.add(r0.accessUrl!);

    // seq 1: window [FROM+40s, FROM+80s]
    const r1 = pickBestClip(page, FROM + 40_000, FROM + 80_000, 'outside', SLOP, claimed);
    expect(r1.state).toBe('available');
    expect(r1.accessUrl).not.toBe(r0.accessUrl);   // distinct from seq 0
    claimed.add(r1.accessUrl!);

    // seq 2: window [FROM+80s, FROM+120s] — both URLs claimed, must NOT duplicate
    const r2 = pickBestClip(page, FROM + 80_000, FROM + 120_000, 'outside', SLOP, claimed);
    expect(r2.state).toBe('requested');
  });

  it('rejects trigger clips and out-of-territory clips before the dedup check', () => {
    const page: PollCandidatePage = {
      items: [
        clip(20_000, 'https://s3/trigger.mp4', 20, 'hard brake event'),  // trigger clip
        clip(1_000_000, 'https://s3/far.mp4'),                            // way out of territory
        clip(20_000, 'https://s3/good.mp4'),
      ],
    };
    const r = pickBestClip(page, FROM, TO, 'outside', SLOP);
    expect(r.accessUrl).toBe('https://s3/good.mp4');
  });
});
