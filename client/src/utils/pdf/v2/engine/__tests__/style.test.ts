import { describe, it, expect } from 'vitest';
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING, AGENCY, FOOTER_TEXT } from '../style';

describe('style tokens', () => {
  it('typography table has the expected entries with correct sizes', () => {
    expect(TYPOGRAPHY.formTitle.size).toBe(14);
    expect(TYPOGRAPHY.formTitle.weight).toBe('bold');
    expect(TYPOGRAPHY.agencyName.size).toBe(11);
    expect(TYPOGRAPHY.fieldLabel.size).toBe(7);
    expect(TYPOGRAPHY.fieldLabel.weight).toBe('bold');
    expect(TYPOGRAPHY.fieldValue.size).toBe(9);
    expect(TYPOGRAPHY.sectionHeader.size).toBe(9);
    expect(TYPOGRAPHY.tableHeader.size).toBe(8);
  });
  it('rule weights are graduated (heaviest header rule down to thinnest divider)', () => {
    expect(RULE_WEIGHTS.headerThick).toBeGreaterThan(RULE_WEIGHTS.headerThin);
    expect(RULE_WEIGHTS.headerThin).toBeGreaterThanOrEqual(RULE_WEIGHTS.sectionRule);
  });
  it('agency identity is set for RMPG production', () => {
    expect(AGENCY.name).toBe('ROCKY MOUNTAIN PROTECTIVE GROUP');
    expect(AGENCY.location).toMatch(/SALT LAKE CITY/i);
  });
  it('footer text mentions the law-enforcement-sensitive notice', () => {
    expect(FOOTER_TEXT.classification).toMatch(/LAW ENFORCEMENT SENSITIVE/);
  });
});
