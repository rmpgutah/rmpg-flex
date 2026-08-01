// Regression tests for the PROPERTY (PS-208) and BUSINESS (PS-210) record
// PDFs, found 2026-08-01 when the operator compared live-printed records
// against the on-screen UI. Fixtures are synthetic — no PII from the real
// records is reproduced here.
//
// Defect A: a printed PROPERTY record showed "ACTIVE WARRANT" next to a
// linked resident. Traced the flag's data path: the backend
// (`GET /records/links`) gates `active_warrants` on
// `LOWER(status) = 'active'`, and the client only ever surfaces the flag
// when that count is > 0 (`activeWarrantFlagFromLinkedMeta`). Live D1 audit
// confirmed this specific person's warrants are all `recalled` — the flag
// logic is correct; a person with a closed/served/cleared warrant, or no
// warrants at all, must never print the flag.
//
// Defect B: banner subtitles (property address, business DBA name) were
// truncated with dangling separator punctuation ("..., SOUTH SALT LAKE -",
// "DBA: ... GROUP,") because the old code took `splitTextToSize()[0]` with
// no ellipsis and no separator cleanup. Fixed by routing through
// `fitTextToWidth` (shrink first, ellipsis-truncate only as a last resort,
// stripping trailing separators before the ellipsis).
import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { activeWarrantFlagFromLinkedMeta } from '../recordLinks';
import { fitTextToWidth } from '../pdfFormHelpers';
import { isEmailOrUrlPdfValue } from '../pdfGenerator';

describe('activeWarrantFlagFromLinkedMeta (Defect A — false ACTIVE WARRANT flag)', () => {
  it('shows the flag when the person has a genuine active warrant', () => {
    expect(activeWarrantFlagFromLinkedMeta({ active_warrants: 1 })).toBe('ACTIVE WARRANT');
    expect(activeWarrantFlagFromLinkedMeta({ active_warrants: 3 })).toBe('ACTIVE WARRANT');
  });

  it('does NOT show the flag for a closed/served/recalled warrant', () => {
    // The backend only counts rows with LOWER(status) = 'active', so a
    // person whose only warrants are recalled/served/closed arrives here
    // with active_warrants: 0 — this is the exact shape for the operator's
    // reported case (all 4 warrants recalled).
    expect(activeWarrantFlagFromLinkedMeta({ active_warrants: 0 })).toBe('');
  });

  it('does NOT show the flag for a person with no warrants at all', () => {
    expect(activeWarrantFlagFromLinkedMeta({})).toBe('');
    expect(activeWarrantFlagFromLinkedMeta(undefined)).toBe('');
    expect(activeWarrantFlagFromLinkedMeta(null)).toBe('');
  });
});

describe('fitTextToWidth (Defect B — dangling separator on truncation)', () => {
  it('never ends the truncated text on a dangling separator before the ellipsis', () => {
    const doc = new jsPDF();
    doc.setFont('helvetica', 'normal');
    const long = '3533 SOUTH TERRA SOL DRIVE, SOUTH SALT LAKE, UT 84115';
    const { text } = fitTextToWidth(doc, long, 30, 8, 5);
    expect(text.endsWith('...')).toBe(true);
    const beforeEllipsis = text.slice(0, -3);
    expect(beforeEllipsis).not.toMatch(/[\s,\-·/]$/);
  });

  it('strips a dangling comma before a legal-entity-name ellipsis', () => {
    const doc = new jsPDF();
    doc.setFont('helvetica', 'normal');
    const long = 'DBA: ROCKY MOUNTAIN PROTECTIVE GROUP, LLC.';
    const { text } = fitTextToWidth(doc, long, 25, 8, 5);
    if (text.endsWith('...')) {
      expect(text.slice(0, -3)).not.toMatch(/[\s,\-·/]$/);
    }
  });

  it('fits text unchanged when it already fits', () => {
    const doc = new jsPDF();
    doc.setFont('helvetica', 'normal');
    const { text, fontSize } = fitTextToWidth(doc, 'SHORT', 100, 8, 5);
    expect(text).toBe('SHORT');
    expect(fontSize).toBe(8);
  });
});

describe('isEmailOrUrlPdfValue (Defect C — emails/URLs printed uppercase)', () => {
  it('recognizes email addresses', () => {
    expect(isEmailOrUrlPdfValue('ops@example-security.us')).toBe(true);
    expect(isEmailOrUrlPdfValue('  ops@example-security.us  ')).toBe(true);
  });

  it('recognizes http(s) and www URLs', () => {
    expect(isEmailOrUrlPdfValue('https://example-security.us')).toBe(true);
    expect(isEmailOrUrlPdfValue('http://example-security.us/portal')).toBe(true);
    expect(isEmailOrUrlPdfValue('www.example-security.us')).toBe(true);
  });

  it('rejects ordinary field values (still get uppercased everywhere else)', () => {
    expect(isEmailOrUrlPdfValue('123 MAIN ST')).toBe(false);
    expect(isEmailOrUrlPdfValue('')).toBe(false);
    expect(isEmailOrUrlPdfValue('Active')).toBe(false);
  });
});
