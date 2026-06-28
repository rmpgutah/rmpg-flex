// Render the Notice of Attempt with the same shape psoNoticeAutofill builds
// for a real CFS close, then dump the PDF bytes so the operator can eyeball
// the layout without going through the dispatch UI. Pure smoke test — pins
// that the generator stays on a single page for typical input and writes
// the resulting PDF to /tmp for visual inspection during development.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { generateNoticeOfAttempt } from '../servePdfGenerator';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/admin/config/branding')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('', { status: 404 });
    }),
  );
});

describe('generateNoticeOfAttempt — single-page layout', () => {
  it('renders the disclaimer block on the first page (lead band + body + signature)', async () => {
    const pdf = await generateNoticeOfAttempt({
      // Empty court case → field "5. Case Number" shows N/A in the
      // recipient copy; the agency CFS# prints in the header under
      // its own AGENCY REF # label.
      caseNumber: '',
      agencyRefNumber: 'CFS26-00074',
      noticeDate: '06/21/2026',
      courtName: 'N/A',
      jurisdiction: 'Salt Lake County, Utah',
      serverName: 'Christopher Zamora',
      serverBadge: '5721',
      serverCompany: 'Rocky Mountain Protective Group',
      serverPhone: '(385) 436-3370',
      recipientName: 'Authorized Representative (or current occupant)',
      recipientAddress: '745 East Village Way, Sandy, Utah 84094',
      documentType: 'Subpoena Service',
      clientName: 'ICU Investigations, LLC.',
      attorneyName: 'Megan Van Kalsbeek',
      attempts: [
        {
          number: 1,
          date: '06/20/2026',
          time: '23:00',
          result: 'PS/00.99',
          notes: 'I arrived on site at 745 E. Village Way, Sandy, Utah 84094, where I observed on arrival, w...',
          gpsLat: 40.5701,
          gpsLng: -111.8770,
        },
      ],
      nextAttemptNote: 'Will return Tuesday, Jun 25, 2026 between 6:00 PM and 8:00 PM.',
    });

    // Single-page is the design contract — if it spills onto page 2 the
    // operator can't leave it at the door as one sheet.
    expect(pdf.getNumberOfPages()).toBe(1);

    // Dump for visual inspection. CI doesn't keep these; local dev runs
    // can open the file to confirm the lead band lands at the TOP of the
    // disclaimer section, not below the signature.
    try {
      const buf = pdf.output('arraybuffer');
      writeFileSync('/tmp/notice-of-attempt.test.pdf', Buffer.from(buf));
    } catch { /* /tmp not writable in some CI envs — skip silently */ }
  });
});
