import { describe, it, expect } from 'vitest';
import { thumbnailFileName } from '../videoThumbnail';

describe('thumbnailFileName', () => {
  it('always returns thumb.jpg regardless of the source file name', () => {
    expect(thumbnailFileName('bodycam-clip.mov')).toBe('thumb.jpg');
    expect(thumbnailFileName('no-extension')).toBe('thumb.jpg');
  });
});
