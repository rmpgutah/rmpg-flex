import { describe, it, expect } from 'vitest';
import { CITATION_INSTRUCTIONS, type CopyVariantId } from '../citationInstructions';

describe('CITATION_INSTRUCTIONS', () => {
  it('exposes exactly three variants in canonical order', () => {
    expect(CITATION_INSTRUCTIONS.map((c) => c.id))
      .toEqual(['violator', 'officer', 'administrative']);
  });

  it.each([
    ['violator', 'VIOLATOR COPY'],
    ['officer', 'OFFICER COPY — RETAIN FOR RECORDS'],
    ['administrative', 'ADMINISTRATIVE COPY — COURT FILING'],
  ])('%s banner reads "%s"', (id, banner) => {
    const c = CITATION_INSTRUCTIONS.find((x) => x.id === id as CopyVariantId);
    expect(c?.bannerText).toBe(banner);
  });

  it('violator block mentions Utah Code §53-3-218', () => {
    const c = CITATION_INSTRUCTIONS.find((x) => x.id === 'violator')!;
    expect(c.body.join('\n')).toMatch(/53-3-218/);
  });

  it('officer block contains "penalty of perjury"', () => {
    const c = CITATION_INSTRUCTIONS.find((x) => x.id === 'officer')!;
    expect(c.body.join('\n').toLowerCase()).toContain('penalty of perjury');
  });

  it('administrative block contains DISPOSITION header', () => {
    const c = CITATION_INSTRUCTIONS.find((x) => x.id === 'administrative')!;
    expect(c.body.join('\n')).toContain('DISPOSITION');
  });
});
