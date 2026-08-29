// Render the Notice of Attempt with the same shape psoNoticeAutofill builds
// for a real CFS close, then dump the PDF bytes so the operator can eyeball
// the layout without going through the dispatch UI. Pure smoke test — pins
// that the generator stays on a single page for typical input and writes
// the resulting PDF to /tmp for visual inspection during development.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { generateNoticeOfAttempt } from '../servePdfGenerator';
import { ORGANIZATION } from '../../constants/organizationConstants';

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
      serverCompany: ORGANIZATION.name,
      serverPhone: ORGANIZATION.phone,
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

  it('stays on one page with two GPS attempts and next-attempt note (live regression shape)', async () => {
    const pdf = await generateNoticeOfAttempt({
      caseNumber: '',
      agencyRefNumber: 'CFS26-00074',
      noticeDate: '06/21/2026',
      courtName: 'N/A',
      jurisdiction: 'Salt Lake County, Utah',
      serverName: 'Christopher Zamora',
      serverBadge: '5721',
      serverCompany: ORGANIZATION.name,
      serverPhone: ORGANIZATION.phone,
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
        {
          number: 2,
          date: '06/21/2026',
          time: '07:35',
          result: 'PS/00.99',
          notes: 'Second attempt — no answer at door, vehicle in driveway, lights off.',
          gpsLat: 40.5702,
          gpsLng: -111.8771,
        },
      ],
      nextAttemptNote: 'Will return Tuesday, Jun 25, 2026 between 6:00 PM and 8:00 PM.',
    }, { printTarget: 'mobile' });

    expect(pdf.getNumberOfPages()).toBe(1);
  });

  it('stays on one page with signature image and maximal field lengths', async () => {
    // 1×1 white PNG
    const sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const pdf = await generateNoticeOfAttempt({
      caseNumber: 'CV-2026-123456789-EXTRA-LONG-CASE-NUMBER',
      agencyRefNumber: 'CFS26-00074-AGENCY-REF-EXTRA-LONG',
      noticeDate: '06/21/2026',
      courtName: 'Third Judicial District Court, Salt Lake County, State of Utah',
      jurisdiction: 'Salt Lake County, State of Utah, United States of America',
      serverName: 'Christopher Alexander Zamora Jr.',
      serverBadge: '5721',
      serverCompany: ORGANIZATION.name,
      serverPhone: ORGANIZATION.phone,
      signature: sig,
      recipientName: 'Authorized Representative (or current occupant) c/o Property Management Office',
      recipientAddress: '745 East Village Way, Building C, Unit 204, Sandy, Salt Lake County, Utah 84094-1234',
      documentType: 'Subpoena Duces Tecum and Notice to Produce Documents',
      clientName: 'ICU Investigations, LLC — Corporate Investigations Division',
      attorneyName: 'Megan Van Kalsbeek, Esq., Van Kalsbeek & Associates, P.C.',
      attempts: [
        { number: 1, date: '06/20/2026', time: '23:00', result: 'PS/00.99', notes: 'I arrived on site at 745 E. Village Way, Sandy, Utah 84094, where I observed on arrival, windows dark, no answer at door despite audible doorbell.', gpsLat: 40.5701, gpsLng: -111.8770 },
        { number: 2, date: '06/21/2026', time: '07:35', result: 'PS/00.99', notes: 'Second attempt — knocked three times, no answer, vehicle in driveway, lights off, neighbor confirmed occupant works nights.', gpsLat: 40.5702, gpsLng: -111.8771 },
      ],
      nextAttemptNote: 'Will return Tuesday, June 25, 2026 between 6:00 PM and 8:00 PM Mountain Time. Please call our office to arrange a convenient delivery time.',
    }, { printTarget: 'mobile' });

    expect(pdf.getNumberOfPages()).toBe(1);
  });

  it('stays on one page with six GPS attempts (worst-case attempt table)', async () => {
    const attempts = Array.from({ length: 6 }, (_, i) => ({
      number: i + 1,
      date: '06/20/2026',
      time: i % 2 === 0 ? '07:35' : '19:15',
      result: 'PS/00.99',
      notes: 'Knocked three times, no answer, vehicle observed in driveway, lights off throughout premises.',
      gpsLat: 40.5701 + i * 0.0001,
      gpsLng: -111.8770 - i * 0.0001,
    }));
    const pdf = await generateNoticeOfAttempt({
      caseNumber: '',
      agencyRefNumber: 'CFS26-00074',
      noticeDate: '06/21/2026',
      courtName: 'Third Judicial District Court',
      jurisdiction: 'Salt Lake County, Utah',
      serverName: 'Christopher Zamora',
      serverBadge: '5721',
      serverCompany: ORGANIZATION.name,
      serverPhone: ORGANIZATION.phone,
      recipientName: 'Authorized Representative (or current occupant)',
      recipientAddress: '745 East Village Way, Sandy, Utah 84094',
      documentType: 'Subpoena Service',
      clientName: 'ICU Investigations, LLC.',
      attorneyName: 'Megan Van Kalsbeek',
      attempts,
      nextAttemptNote: 'Will return Tuesday, Jun 25, 2026 between 6:00 PM and 8:00 PM.',
    }, { printTarget: 'mobile' });

    expect(pdf.getNumberOfPages()).toBe(1);
  });

  it('keeps flowing content above the QR band with readable tier-0 spacing (2 attempts)', async () => {
    const pdf = await generateNoticeOfAttempt({
      caseNumber: '',
      agencyRefNumber: 'CFS26-00074',
      noticeDate: '06/21/2026',
      courtName: 'N/A',
      jurisdiction: 'Salt Lake County, Utah',
      serverName: 'Christopher Zamora',
      serverBadge: '5721',
      serverCompany: ORGANIZATION.name,
      serverPhone: ORGANIZATION.phone,
      recipientName: 'Authorized Representative (or current occupant)',
      recipientAddress: '745 East Village Way, Sandy, Utah 84094',
      documentType: 'Subpoena Service',
      clientName: 'ICU Investigations, LLC.',
      attorneyName: 'Megan Van Kalsbeek',
      attempts: [
        { number: 1, date: '06/20/2026', time: '23:00', result: 'PS/00.99', notes: 'I arrived on site at 745 E. Village Way, Sandy, Utah 84094, where I observed on arrival, w...', gpsLat: 40.5701, gpsLng: -111.8770 },
        { number: 2, date: '06/21/2026', time: '07:35', result: 'PS/00.99', notes: 'Second attempt — no answer at door, vehicle in driveway, lights off.', gpsLat: 40.5702, gpsLng: -111.8771 },
      ],
      nextAttemptNote: 'Will return Tuesday, Jun 25, 2026 between 6:00 PM and 8:00 PM.',
    }, { printTarget: 'mobile' });

    const layout = (pdf as unknown as { __noticeLayout?: { tier: number; contentBottomY: number; qrZoneTop: number } }).__noticeLayout;
    expect(layout).toBeDefined();
    expect(layout!.tier).toBeLessThanOrEqual(1);
    expect(layout!.contentBottomY).toBeLessThanOrEqual(layout!.qrZoneTop);
  });

  it('stays on one page with full-length attempt notes from the field', async () => {
    const longNote =
      'Arrived on scene at the listed address. Knocked on front door three times, rang doorbell twice, '
      + 'no answer. Observed one vehicle in driveway with out-of-state plates, all windows covered with '
      + 'blinds drawn. Neighbor in adjacent unit stated subject works overnight shifts and is rarely home '
      + 'before noon. Left notice card in door jamb per agency policy. GPS captured at curbside.';
    const pdf = await generateNoticeOfAttempt({
      caseNumber: '',
      agencyRefNumber: 'JOB-1842',
      noticeDate: '08/29/2026',
      courtName: 'Third Judicial District Court',
      jurisdiction: 'Salt Lake County, Utah',
      serverName: 'Christopher Zamora',
      serverBadge: '5721',
      serverCompany: ORGANIZATION.name,
      serverPhone: ORGANIZATION.phone,
      signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      recipientName: 'Authorized Representative (or current occupant)',
      recipientAddress: '745 East Village Way, Building C, Unit 204, Sandy, Utah 84094',
      documentType: 'Subpoena Duces Tecum and Notice to Produce Documents',
      clientName: 'ICU Investigations, LLC — Corporate Investigations Division',
      attorneyName: 'Megan Van Kalsbeek, Esq.',
      attempts: [
        { number: 1, date: '08/28/2026', time: '07:35', result: 'PS/00.99', notes: longNote, gpsLat: 40.5701, gpsLng: -111.8770 },
        { number: 2, date: '08/29/2026', time: '19:15', result: 'PS/00.99', notes: longNote, gpsLat: 40.5702, gpsLng: -111.8771 },
      ],
      nextAttemptNote: 'Will return Tuesday, September 2, 2026 between 6:00 PM and 8:00 PM Mountain Time.',
    }, { printTarget: 'mobile' });

    expect(pdf.getNumberOfPages()).toBe(1);
  });
});
