import { describe, it, expect } from 'vitest';
import { sectionAnchorId } from '../sectionAnchor';

describe('sectionAnchorId', () => {
  it('slugifies a section title', () => {
    expect(sectionAnchorId('Physical Description')).toBe('spm-sec-physical-description');
  });
  it('collapses punctuation and ampersands', () => {
    expect(sectionAnchorId('Contact & Address')).toBe('spm-sec-contact-address');
  });
  it('trims leading/trailing separators', () => {
    expect(sectionAnchorId('  Notes!  ')).toBe('spm-sec-notes');
  });
});
