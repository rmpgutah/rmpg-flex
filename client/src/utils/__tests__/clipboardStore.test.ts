import { describe, it, expect, beforeEach } from 'vitest';
import {
  addClipEntry, removeClipEntry, filterClipHistory, sortClips, clipsToCsv,
  saveClipHistory, CLIP_STORAGE_KEY,
} from '../clipboardStore';

describe('clipboardStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('dedupes and prepends new entries', () => {
    const next = addClipEntry(['old'], '  ABC1234  ');
    expect(next[0]).toBe('ABC1234');
    const again = addClipEntry(next, 'ABC1234');
    expect(again.filter((x) => x === 'ABC1234')).toHaveLength(1);
  });

  it('removes, filters, pins-first sort, and exports csv', () => {
    saveClipHistory(['a', 'b', 'c']);
    expect(removeClipEntry(['a', 'b'], 'a')).toEqual(['b']);
    expect(filterClipHistory(['plate ABC', 'phone'], 'abc')).toEqual(['plate ABC']);
    expect(sortClips(['a', 'b', 'c'], ['c'])).toEqual(['c', 'a', 'b']);
    const csv = clipsToCsv(['hello'], ['hello']);
    expect(csv).toContain('pinned');
    expect(csv).toContain('yes');
    expect(localStorage.getItem(CLIP_STORAGE_KEY)).toBeTruthy();
  });
});
