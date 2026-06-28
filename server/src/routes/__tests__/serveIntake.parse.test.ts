import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseAllDocuments } from '../../utils/serveIntakeHelpers';

const f = (n: string) => readFileSync(join(__dirname, 'fixtures/serveIntake', n), 'utf-8');

describe('parseAllDocuments — Armstrong case', () => {
  const out = parseAllDocuments({
    fieldSheet: f('armstrong.fieldSheet.txt'),
    infoSheet: f('armstrong.infoSheet.txt'),
    courtDocket: f('armstrong.courtDocket.txt'),
  });

  it('extracts defendant identity', () => {
    expect(out.defendant.first).toBe('Abbey');
    expect(out.defendant.last).toBe('Armstrong');
    expect(out.defendant.dob).toBe('1997-10-13');
  });

  it('extracts service address with parts', () => {
    expect(out.address).toMatch(/2361 E 3395 S.*SALT LAKE CITY.*UT 84109/i);
    expect(out.addressParts.building).toBe('2361');
  });

  it('extracts plaintiff from info sheet', () => {
    expect(out.plaintiff).toMatch(/Capital One, N\.A\., successor by merger to Discover Bank/);
  });

  it('extracts attorney Heather Valerga + Bar# 14431 from docket', () => {
    expect(out.attorney.name).toBe('Heather Valerga');
    expect(out.attorney.barNumber).toBe('14431');
    expect(out.attorney.firm).toBe('GUGLIELMO & ASSOCIATES');
    expect(out.attorney.email.toLowerCase()).toBe('utah@guglielmolaw.com');
  });

  it('extracts documents list + primary doc + service type', () => {
    expect(out.documents).toMatch(/Summons and Complaint; Bilingual Notice/);
    expect(out.primaryDoc).toBe('SUMMONS');
    expect(out.serviceType).toBe('SUMMONS SERVICE');
  });

  it('extracts job numbers (ICU 15570133 + client 633570)', () => {
    expect(out.jobNumber).toBe('15570133');
    expect(out.clientJobNumber).toBe('633570');
  });

  it('extracts court metadata from info sheet', () => {
    expect(out.court).toMatch(/THIRD JUDICIAL DISTRICT COURT/);
    expect(out.courtAddress).toMatch(/450 S STATE ST/i);
    expect(out.county.toUpperCase()).toBe('SALT LAKE');
  });

  it('extracts signed date + response deadline from docket URCP 4 boilerplate', () => {
    expect(out.signedDate).toBe('March 25, 2026');
    expect(out.responseDeadlineDays).toBe(21);
  });

  it('extracts clerk phone', () => {
    expect(out.clerkPhone).toBe('(801) 238-7300');
  });

  it('extracts docket barcode job number', () => {
    expect(out.docketBarcodeJobNumber).toBe('633570');
  });

  it('extracts complaint residence for cross-check', () => {
    expect(out.complaintResidence).toMatch(/2361 E 3395 S/);
  });
});
