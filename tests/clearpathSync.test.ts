import { describe, it, expect } from 'vitest';
import {
  kmhToMph, channelOf, isOutsideChannel, pickVideoObjects, mediaDedupeKey, formatTs, r2KeyFor,
} from '../src/utils/clearpathSync';
import { pickAlprImageUrl, validatePlate } from '../src/utils/clearpathAlpr';
import type { CpgMediaEvent, CpgMediaObject } from '../src/utils/clearpathGps';

const mo = (over: Partial<CpgMediaObject>): CpgMediaObject => ({
  channel: 'outside', type: 'VIDEO', title: '', thumbnailUrl: '', accessUrl: '', status: 'AVAILABLE',
  lastUpdate: 0, expiringSoon: false, eventType: '', location: null, ...over,
});
const ev = (objs: CpgMediaObject[], over: Partial<CpgMediaEvent> = {}): CpgMediaEvent => ({
  address: '', batchId: '', eventTimestamp: 1000, lastUpdate: 0, expiringSoon: false, status: 'AVAILABLE',
  mediaObject: objs, ...over,
});

describe('clearpathSync pure helpers', () => {
  it('kmhToMph converts and null-guards', () => {
    expect(kmhToMph(100)).toBe(62);
    expect(kmhToMph(0)).toBe(0);
    expect(kmhToMph(null)).toBeNull();
    expect(kmhToMph(-5)).toBeNull();
  });

  it('channelOf / isOutsideChannel classify cabin vs road', () => {
    expect(channelOf(mo({ channel: 'OUTSIDE' }))).toBe('outside');
    expect(isOutsideChannel('outside')).toBe(true);
    expect(isOutsideChannel('inside')).toBe(false);
    expect(isOutsideChannel('cabin')).toBe(false);
  });

  it('pickVideoObjects keeps only available videos with a url, expiring-soon first', () => {
    const a = mo({ accessUrl: 'https://s3/a', expiringSoon: false });
    const b = mo({ accessUrl: 'https://s3/b', expiringSoon: true });
    const img = mo({ type: 'IMAGE', accessUrl: 'https://s3/i' });
    const processing = mo({ accessUrl: 'https://s3/p', status: 'PROCESSING' });
    const noUrl = mo({ accessUrl: '' });
    const out = pickVideoObjects(ev([a, b, img, processing, noUrl]));
    expect(out).toHaveLength(2);
    expect(out[0].accessUrl).toBe('https://s3/b'); // expiring-soon first
  });

  it('mediaDedupeKey and r2KeyFor are stable + filesystem-safe', () => {
    expect(mediaDedupeKey('cp1', 1000, 'outside')).toBe('cp1|1000|outside');
    expect(r2KeyFor('cp/16:08', 1700000000000, 'outside')).toBe('dashcam/cp1608/1700000000000_outside.mp4');
  });

  it('formatTs renders UTC without ms/zone', () => {
    expect(formatTs(0)).toBe('1970-01-01 00:00:00');
  });
});

describe('clearpathAlpr pure helpers', () => {
  it('pickAlprImageUrl prefers an outside full IMAGE over thumbnails', () => {
    const image = mo({ type: 'IMAGE', channel: 'outside', accessUrl: 'https://s3/full.jpg' });
    const vidThumb = mo({ type: 'VIDEO', channel: 'outside', thumbnailUrl: 'https://s3/thumb.jpg' });
    expect(pickAlprImageUrl(ev([vidThumb, image]))).toBe('https://s3/full.jpg');
  });

  it('pickAlprImageUrl falls back to an outside thumbnail', () => {
    const vidThumb = mo({ type: 'VIDEO', channel: 'outside', thumbnailUrl: 'https://s3/thumb.jpg' });
    expect(pickAlprImageUrl(ev([vidThumb]))).toBe('https://s3/thumb.jpg');
  });

  it('pickAlprImageUrl ignores inside-channel and non-https', () => {
    const inside = mo({ type: 'IMAGE', channel: 'inside', accessUrl: 'https://s3/cabin.jpg' });
    const insecure = mo({ type: 'IMAGE', channel: 'outside', accessUrl: 'http://s3/insecure.jpg' });
    expect(pickAlprImageUrl(ev([inside, insecure]))).toBeNull();
  });

  it('validatePlate normalizes real plates and rejects model junk', () => {
    expect(validatePlate('abc-123')).toBe('ABC123');
    expect(validatePlate(' 7XY 99 ')).toBe('7XY99');
    expect(validatePlate('NOTVISIBLE')).toBeNull();
    expect(validatePlate('none')).toBeNull();
    expect(validatePlate('')).toBeNull();
    expect(validatePlate(null)).toBeNull();
    expect(validatePlate('A')).toBeNull();           // too short
    expect(validatePlate('TOOLONGPLATE')).toBeNull(); // too long
  });
});
