// Identity capture on the signing form.
//
// recipient_id_type / recipient_id_verified / recipient_description have
// existed since migration 0207 and nothing ever wrote them. The physical
// description in particular is what an affidavit of service conventionally
// carries and what nobody types by hand — it comes free off the barcode.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = readFileSync(join(__dirname, '..', 'ServeReceiptPage.tsx'), 'utf8');

describe('driver licence scan', () => {
  it('reuses the existing decoder and AAMVA parser', () => {
    // Both already exist for the DL search page. A second implementation
    // would drift from the one that gets exercised daily.
    expect(PAGE).toMatch(/from '\.\.\/\.\.\/utils\/pdf417Decoder'/);
    expect(PAGE).toMatch(/from '\.\.\/\.\.\/utils\/aamvaParser'/);
  });

  it('is offered, never demanded', () => {
    // Nobody is obliged to produce ID to accept papers. A form that
    // insisted would block a service that is otherwise perfectly good.
    expect(PAGE).toMatch(/Optional: scan the barcode/);
    expect(PAGE).toMatch(/You do not have to/);
    // It must not appear in the blocking list.
    const missingBlock = PAGE.slice(PAGE.indexOf('const missing'), PAGE.indexOf('const acceptedAttestations'));
    expect(missingBlock).not.toMatch(/idVerified/);
  });

  it('populates the columns that existed and were never written', () => {
    expect(PAGE).toMatch(/recipient_id_verified: idVerified/);
    expect(PAGE).toMatch(/recipient_id_type: idVerified \? 'drivers_licence_scan' : null/);
    expect(PAGE).toMatch(/recipient_description: idDescription \|\| null/);
  });

  it('keeps the licence number and address on the device', () => {
    // The decoded barcode carries a licence number and home address. The
    // form asks for neither, so neither is kept — only the fields it
    // actually shows survive the parse.
    const scan = PAGE.slice(PAGE.indexOf('const scanId'), PAGE.indexOf('const buildPdfData'));
    expect(scan).not.toMatch(/dl_number/);
    expect(scan).not.toMatch(/dl\.address/);
    expect(scan).toMatch(/setIdDescription/);
  });

  it('degrades to typing when the barcode will not read', () => {
    // Bad light, a worn card, a cracked screen. The fallback has to be
    // the thing the person was going to do anyway.
    expect(PAGE).toMatch(/or just type your name/);
  });
});
