// Locks in the statute outline parser the reader + PDF share: marker depth,
// structural-vs-reference detection, and container folding.
import { describe, it, expect } from 'vitest';
import { tokenDepth, parseOutline } from '../statuteOutline';

describe('tokenDepth', () => {
  it('maps the canonical Utah outline tokens to depths', () => {
    expect(tokenDepth('1')).toBe(0);
    expect(tokenDepth('a')).toBe(1);
    expect(tokenDepth('i')).toBe(2);   // roman lower
    expect(tokenDepth('A')).toBe(3);
    expect(tokenDepth('I')).toBe(4);   // roman upper
    expect(tokenDepth('b')).toBe(1);
    expect(tokenDepth('iv')).toBe(2);
  });
});

describe('parseOutline', () => {
  it('splits the inline run into a nested outline (assault sample)', () => {
    const text =
      '(1) (a) As used in this section, "chokehold" means a hold using an arm.' +
      '(b) Terms defined in Section 76-1-101.5 apply to this section.' +
      '(2) An actor commits assault if the actor:(a) attempts to inflict injury;';
    const segs = parseOutline(text);
    const markers = segs.map((s) => s.marker);
    expect(markers).toContain('(1)(a)'); // (1) is a pure container folded onto (a)
    expect(markers).toContain('(b)');
    expect(markers).toContain('(2)');
    // depths: (1)(a) sits at the child depth (1), (2) at 0
    const two = segs.find((s) => s.marker === '(2)');
    expect(two?.depth).toBe(0);
  });

  it('treats a mid-sentence reference as text, not a new subsection', () => {
    const text = 'A person who violates Subsection (3) is guilty of an offense.';
    const segs = parseOutline(text);
    expect(segs).toHaveLength(1);
    expect(segs[0].marker).toBe('');
    expect(segs[0].text).toContain('Subsection (3)');
  });

  it('returns a single lead segment when there are no markers', () => {
    const segs = parseOutline('An arrest is an actual restraint of the person arrested.');
    expect(segs).toHaveLength(1);
    expect(segs[0].depth).toBe(0);
  });
});
