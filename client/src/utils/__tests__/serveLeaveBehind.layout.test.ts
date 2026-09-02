// PS-314 leave-behind — defects from JOB-158 (2026-08-28):
//   * page-2 header colliding with "I, the undersigned…"
//   * addFieldPair substituting "N/A" on wet-ink fill-in cells
//   * recipient signature block labelled BADGE NUMBER
//   * recipient-facing prose shouted in ALL CAPS

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addFieldPair,
  addWritableFieldPair,
  addWrappedText,
  addSignatureBlock,
} from '../pdfGenerator';
import { generateServeLeaveBehin, type LeaveBehindData } from '../serveLeaveBehinPdfGenerator';

vi.mock('../pdfGenerator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pdfGenerator')>();
  return {
    ...actual,
    addFieldPair: vi.fn((...args: Parameters<typeof actual.addFieldPair>) => actual.addFieldPair(...args)),
    addWritableFieldPair: vi.fn((...args: Parameters<typeof actual.addWritableFieldPair>) => actual.addWritableFieldPair(...args)),
    addWrappedText: vi.fn((...args: Parameters<typeof actual.addWrappedText>) => actual.addWrappedText(...args)),
    addSignatureBlock: vi.fn((...args: Parameters<typeof actual.addSignatureBlock>) => actual.addSignatureBlock(...args)),
  };
});

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

afterEach(() => {
  vi.mocked(addFieldPair).mockClear();
  vi.mocked(addWritableFieldPair).mockClear();
  vi.mocked(addWrappedText).mockClear();
  vi.mocked(addSignatureBlock).mockClear();
  vi.unstubAllGlobals();
});

const JOB_158: LeaveBehindData = {
  jobId: 158,
  caseNumber: null,
  documentType: 'Summons & Complaint (Small Claims)',
  courtName: 'Third Judicial District Court, State of Utah - Matheson',
  jurisdiction: 'Salt Lake',
  clientName: 'Guglielmo & Associates, PLLC.',
  attorneyName: 'Heather Valerga',
  serviceInstructions:
    'Sub-serve on 1st attempt to any occupant 16+. Personal only at POE.',
  serveDate: null,
  recipientType: 'individual',
  recipientName: 'Walter S Price',
  recipientAddress: '4656 South 1980 West, Taylorsville, UT, 84129',
  officerName: 'Christopher Zamora',
  officerBadge: '5172',
};

describe('generateServeLeaveBehin — JOB-158 defects', () => {
  it('keeps two pages', async () => {
    const doc = await generateServeLeaveBehin(JOB_158);
    expect(doc.getNumberOfPages()).toBe(2);
  }, 30_000);

  it('uses writable rules instead of N/A on fill-in cells', async () => {
    await generateServeLeaveBehin(JOB_158);

    const writableLabels = vi.mocked(addWritableFieldPair).mock.calls.map((c) => String(c[1]).toUpperCase());
    expect(writableLabels).toEqual(expect.arrayContaining([
      'PRINTED NAME', 'DATE', 'TIME', 'SERVE DATE', 'DATE SERVED', 'TIME SERVED',
      'CASE NUMBER (IF ASSIGNED)',
    ]));

    const emptyFieldLabels = vi.mocked(addFieldPair).mock.calls
      .filter((c) => !String(c[2] ?? '').trim())
      .map((c) => String(c[1]).toUpperCase());
    expect(emptyFieldLabels).not.toEqual(expect.arrayContaining([
      'PRINTED NAME', 'DATE', 'TIME', 'DATE SERVED', 'TIME SERVED', 'SERVE DATE',
    ]));
  }, 30_000);

  it('renders recipient-facing prose in mixed case and labels capacity not badge', async () => {
    await generateServeLeaveBehin(JOB_158);

    const intro = vi.mocked(addWrappedText).mock.calls.find((c) => String(c[1]).includes('I, the undersigned'));
    expect(intro).toBeTruthy();
    expect(intro?.[6]).toMatchObject({ preserveCase: true });

    const recipSig = vi.mocked(addSignatureBlock).mock.calls.find((c) => String(c[1]).toUpperCase() === 'SIGNATURE');
    expect(recipSig?.[5]).toMatchObject({ middleFieldLabel: 'CAPACITY' });

    const officerSig = vi.mocked(addSignatureBlock).mock.calls.find((c) => /officer/i.test(String(c[1])));
    expect(officerSig?.[5]).toMatchObject({
      printedName: 'Christopher Zamora',
      badgeNumber: '5172',
      date: '',
    });
  }, 30_000);
});
