import { describe, it, expect } from 'vitest';
import { COLOR, CLASSIFICATION } from '../pdfTokens';

describe('pdfTokens color restoration (navy + gold baseline)', () => {
  it('ACCENT_GOLD is the canonical brand gold, not black', () => {
    expect(COLOR.ACCENT_GOLD).toEqual([212, 160, 23]); // #d4a017
  });

  it('RULE_GOLD matches ACCENT_GOLD', () => {
    expect(COLOR.RULE_GOLD).toEqual([212, 160, 23]);
  });

  it('BG_SECTION_HDR is letterhead navy, not charcoal', () => {
    expect(COLOR.BG_SECTION_HDR).toEqual([26, 47, 92]); // #1a2f5c
  });

  it('BG_SIDEBAR_TAB matches BG_SECTION_HDR (navy)', () => {
    expect(COLOR.BG_SIDEBAR_TAB).toEqual([26, 47, 92]);
  });

  it('PRIO_1_BG (most urgent) is navy, PRIO_4_BG (least urgent) is pale gold', () => {
    expect(COLOR.PRIO_1_BG).toEqual([26, 47, 92]);
    expect(COLOR.PRIO_4_BG).toEqual([230, 210, 160]);
  });

  it('CLASSIFICATION bars use the navy family, not gray', () => {
    expect(CLASSIFICATION.LES.bg).toEqual([26, 47, 92]);
    expect(CLASSIFICATION.CONFIDENTIAL.bg).toEqual([15, 28, 56]);
  });

  it('BG_TABLE_HDR stays the 2026-07-03 light-gray tone-reconfig value (not reverted)', () => {
    expect(COLOR.BG_TABLE_HDR).toEqual([224, 224, 224]);
  });
});
