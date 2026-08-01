import { describe, it, expect } from 'vitest';
import { FORM_NUMBERS } from '../pdfAssets';

// A form number identifies a document type in the records system and on court
// filings. Two distinct document types sharing one number is a filing defect,
// not a cosmetic one — a clerk pulling "FORM PS-210" would get two different
// documents. This happened for real on 2026-08-01: a `business` entry was
// added carrying PS-210, which `patrol_tracking` already owned.
//
// Self-aliases (key === value, e.g. 'FORM PS-206-PTI': 'FORM PS-206-PTI') are
// legitimate — they let a caller pass a form number straight through — so they
// are collapsed before the uniqueness check rather than counted as collisions.

describe('FORM_NUMBERS', () => {
  it('assigns a unique form number to every distinct document type', () => {
    const byNumber = new Map<string, string[]>();

    for (const [key, value] of Object.entries(FORM_NUMBERS)) {
      if (key === value) continue; // self-alias, not a distinct document type
      const owners = byNumber.get(value) ?? [];
      owners.push(key);
      byNumber.set(value, owners);
    }

    const collisions = [...byNumber.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([number, owners]) => `${number} claimed by: ${owners.join(', ')}`);

    expect(collisions, `duplicate form number(s):\n  ${collisions.join('\n  ')}`).toEqual([]);
  });

  it('formats every entry as "FORM <SERIES>-<NUMBER>"', () => {
    for (const [key, value] of Object.entries(FORM_NUMBERS)) {
      expect(value, `${key} has a malformed form number`).toMatch(/^FORM [A-Z]{2,4}-[0-9]{3}[A-Z-]*$/);
    }
  });
});
