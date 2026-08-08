// Regenerates the two live Process Server Job Information Sheets (JOB-96,
// JOB-93) that surfaced the checkPageBreak font-restore bug and the
// addWrappedText hard-break justify bug (both fixed in pdfGenerator.ts,
// 2026-08-08). Writes real PDFs to disk so the fix can be visually
// re-verified against the exact live data that exposed it, instead of
// trusting the code read alone.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateServeJobSheet, type ServeJobSheetData } from '../serveJobSheetPdfGenerator';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/admin/system-settings')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response('', { status: 404 });
    }),
  );
});

const OUT_DIR = join(process.cwd(), 'tmp-pdf-regen');

const job96: ServeJobSheetData = {
  jobId: 96,
  status: 'pending',
  priority: 'routine',
  deadline: '2026-08-11',
  timeWindow: '',
  serveDate: null,
  serviceInstructions:
    'MUST ATTEMPT WITHIN 48 HOURS AT A BUSINESS ADDRESS ON WEEKDAYS BETWEEN 9AM AND 4PM. ' +
    'CORPORATE/GOVERNMENT - MAY SERVE ANY PERSON AUTHORIZED TO ACCEPT SERVICE AT A BUSINESS/GOVERNMENT ' +
    'LOCATION (AUTHORIZED BY THE REGISTERED AGENT OR LISTED ON CORPORATE DOCUMENTS AS THE SECRETARY, ' +
    'TREASURER, V.P, MANAGER, CO-OWNER, ETC.). ALL CORPORATE - MUST BE PERSONALLY SERVED TO THE ' +
    'REGISTERED AGENT OR OWNER AT A HOME LOCATION UNLESS THE SPOUSE IS AUTHORIZED TO ACCEPT OR IS A ' +
    'MEMBER OF THE COMPANY.',
  notes:
    'DATE: FRI, AUG 7, 2026 AT 3:25PM\n' +
    'SUBJECT: NEW ORDER / CONTROL #: NV337996\n' +
    'ASSIGNED TO: UNASSIGNED\n' +
    'CONTROL NUMBER: NV337996\n' +
    'CASE NUMBER: 260500083\n' +
    "CASE TITLE: VALERIE HEACOCK, VS KENZ, LLC DBA FABULOUS FREDDY'S CAR WASH, A UTAH LIMITED LIABILITY CO.\n" +
    'DATE SUBMITTED: 8/7/2026\n' +
    'SUBJECT: SOUTHERN UTAH VETERANS HOME IVINS 160 NORTH 200 EAST IVINS, UT 84738-6100 C/O REGISTERED AGENT LEGALINC CORPORATE SERVICES INC\n' +
    'JOB TYPE: 030 - STANDARD PROCESS (48 TO 72 HRS)\n' +
    'DOCUMENTS: SUBPOENA DUCES TECUM (FOR PRODUCTION OF DOCUMENTS ONLY)\n' +
    'ADDRESS: 299 S MAIN ST STE 1300 SALT LAKE CITY, UT 84111\n' +
    'FWD: NEW ORDER / CONTROL #: NV337996',
  recipientName: 'SOUTHERN UTAH VETERANS HOMES',
  recipientAddress: '299 SOUTH MAIN STREET, STE 1300, SALT LAKE CITY, UT, 84111',
  recipientGps: { lat: 40.763421, lng: -111.890656 },
  documentType: 'SUBPOENA',
  caseNumber: '260500083',
  courtName: 'FIFTH JUDICIAL DISTRICT COURT, STATE OF UTAH',
  jurisdiction: 'WASHINGTON',
  clientName: 'RESNICK & LOUIS, P.C.',
  attorneyName: 'DEREK J. WARNER',
  officerName: 'CHRISTOPHER ZAMORA',
  officerBadge: '5172',
  attempts: [],
};

const job93: ServeJobSheetData = {
  jobId: 93,
  status: 'attempted',
  priority: 'routine',
  deadline: '2026-08-13',
  timeWindow: '',
  serveDate: null,
  serviceInstructions:
    'REGULAR ATTEMPT SERVICE, CT CORPORATION/CSC REGISTERED AGENCY/CSC OR BUSINESS REGISTERED AGENT FOR ' +
    'GREEN DOT BANK. PLEASE HAND DELIVER TO REGISTERED AGENT, OR ANY PERSON AUTHORIZED PERSON ABLE TO ' +
    'ACCEPT SERVICE ON BEHALF OF THE COMPANY.',
  notes:
    'WEEKDAYS BETWEEN 09:00 TO 15:30.\n' +
    'ROUTINE SERVICE TO CT CORP/CSC OR BUSINESS REGISTERED AGENT\n' +
    'SERVICE TO BE COMPLETED WITHIN 5 BUSINESS DAYS.\n' +
    'MSI WILL PROVIDE AFFIDAVIT OF SERVICE ONCE SERVICE HAS BEEN EXECUTED.\n' +
    '[OCR INTAKE 2026-08-07: 1/1 DOCS READ, 90% CONFIDENCE; VERIFY: DOB, PHONE]',
  recipientName: 'CT CORPORATION/CSC REGISTERED AGENCY',
  recipientAddress: '15 WEST SOUTH TEMPLE, STE 600, SALT LAKE CITY, UT, 84101',
  recipientGps: { lat: 40.769100, lng: -111.891750 },
  documentType: 'SUMMONS & COMPLAINT',
  caseNumber: '4:26-CV-12695-FKB-PTM',
  courtName: 'UNITED STATES DISTRICT COURT',
  jurisdiction: 'EASTERN DISTRICT OF MICHIGAN',
  clientName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
  attorneyName: 'MEIR RUBINOV',
  officerName: 'CHRISTOPHER ZAMORA',
  officerBadge: '5172',
  attempts: [
    {
      number: 1,
      date: '07-AUG-2026',
      time: '17:28:56',
      type: 'DAY',
      result: 'FAILED - PS/00.01 - NO CONTACT / NO ANSWER',
      officerName: 'CHRISTOPHER ZAMORA',
      notes: 'AGENT ATTEMPTED TO SERVE, THOUGH WAS UNABLE TO COMPLETE SERVICE AS A RESULT OF CLOSURE.',
      gpsLat: 40.694574,
      gpsLng: -111.882241,
    },
  ],
};

describe('generateServeJobSheet — live-data regen (JOB-96, JOB-93)', () => {
  it('renders JOB-96 (multi-line NOTES spanning a page break) without throwing', async () => {
    const doc = await generateServeJobSheet(job96);
    expect(doc.internal.pages.length - 1).toBeGreaterThanOrEqual(2);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'JOB-96-regen.pdf'), Buffer.from(doc.output('arraybuffer')));
  });

  it('renders JOB-93 (hard-break NOTES line + page-break continuation) without throwing', async () => {
    const doc = await generateServeJobSheet(job93);
    expect(doc.internal.pages.length - 1).toBeGreaterThanOrEqual(2);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'JOB-93-regen.pdf'), Buffer.from(doc.output('arraybuffer')));
  });
});
