// Acknowledgement of Service — PDF layout regression.
//
// Every variation must render on ONE sheet, on BOTH print targets. That
// is not cosmetic: the process server prints this on an in-vehicle
// Brother PJ-700 roll printer and hands it over at the door. A second
// page is a physically separate strip of paper — the one the recipient
// loses, and the one that carries the signature.
//
// Four separate defects during the initial build each produced a
// spurious second page or a clipped line, and none were visible from
// unit tests of the data layer:
//   1. the first statement clipped by the section header bar
//      (addWrappedText sets its BASELINE at openAutoSection's contentY)
//   2. the receipt footer drawn ON the signature block's bottom rule
//   3. an over-generous 38mm signature reserve pushing the whole block
//      to page 2 and leaving page 1 a quarter empty
//   4. a bare checkPageBreak before the footer sentence, exiling a
//      single 5pt line onto its own sheet
// Hence: assert page count, not just "it rendered".

import { describe, it, expect } from 'vitest';
import { generateReceiptOfService, generateAffidavitOfService, serviceMomentFor,
  RECEIPT_COPY_ORDER, RECEIPT_COPY_LABEL, agencyJobRef, type ReceiptOfServiceData } from '../servePdfGenerator';
import { attestationsFor, receiptFormTitle, VARIANT_LABEL, type ReceiptVariant } from '../serveReceiptVariant';
import { addConfidentialWatermark, setConfidentialWatermarkEnabled } from '../pdfGenerator';
import jsPDF from 'jspdf';

/**
 * Size of a page's PDF content stream, in characters.
 *
 * NOT text extraction. registerArialFont() embeds a subset font, so the
 * drawn strings are encoded and a substring search for "CONFIDENTIAL"
 * finds nothing even when the watermark is plainly on the page. Stream
 * length is the honest available signal: it scales with how much was
 * drawn, which is exactly what "is this page substantially populated"
 * and "did an extra element get drawn" both come down to.
 */
function pageWeight(doc: { internal: any }, pageNum: number): number {
  const page = doc.internal.pages[pageNum];
  return (Array.isArray(page) ? page.join('') : String(page ?? '')).length;
}

/** Number of images jsPDF has embedded in a document. */
function imageCount(doc: { internal: any }): number {
  const images = doc.internal.collections?.['addImage_images'];
  return images ? Object.keys(images).length : 0;
}

/** 1x1 transparent PNG — enough for jsPDF to embed a real image. */
const TEST_QR = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const BASE = {
  receiptId: 4471,
  courtName: 'Third District Court, Salt Lake County',
  caseNumber: '269-CV-04417',
  jurisdiction: 'State of Utah',
  plaintiffName: 'Wasatch Property Holdings, LLC',
  defendantName: 'Marcus T. Whitfield',
  documentType: 'Summons and Complaint',
  serviceAddress: '1482 S Windermere Dr, Salt Lake City, UT 84105',
  serverName: 'D. Ramirez',
  serverBadge: 'PS-1147',
  agency: 'Rocky Mountain Protective Group',
  recipientPhone: '(801) 555-0142',
  documents: [
    { title: 'Summons — Civil', copies: 1 },
    { title: 'Complaint for Unlawful Detainer', copies: 1 },
    { title: 'Notice of Hearing', copies: 2 },
  ],
  signedAt: '2026-07-27T15:42:00.000Z',
  gps: { lat: 40.729114, lng: -111.861702 },
  expectedDeliveryAt: '2026-07-28',
};

const CASES: Array<{ v: ReceiptVariant; party: string; extra: Partial<ReceiptOfServiceData> }> = [
  { v: 'individual', party: 'Marcus T. Whitfield', extra: {
      premisesType: 'residence', recipientName: 'Marcus T. Whitfield',
      residesAtAddress: true, authorizedAgent: false } },
  { v: 'co_habitant', party: 'Marcus T. Whitfield', extra: {
      premisesType: 'residence', recipientName: 'Angela R. Whitfield',
      recipientRelationship: 'Spouse', acceptingOnBehalfOf: 'Marcus T. Whitfield',
      residesAtAddress: true, authorizedAgent: false } },
  { v: 'business', party: 'Whitfield Contracting, Inc.', extra: {
      premisesType: 'business', recipientName: 'Dana Kowalczyk',
      recipientRelationship: 'Manager / supervisor', recipientJobTitle: 'Office Manager',
      businessName: 'Whitfield Contracting, Inc.',
      acceptingOnBehalfOf: 'Whitfield Contracting, Inc.',
      residesAtAddress: false, authorizedAgent: true } },
  { v: 'substitute', party: 'Marcus T. Whitfield', extra: {
      premisesType: 'other', recipientName: 'Ruth E. Delgado',
      recipientRelationship: 'Other', acceptingOnBehalfOf: 'Marcus T. Whitfield',
      residesAtAddress: false, authorizedAgent: false } },
];

function build(v: ReceiptVariant, party: string, extra: Partial<ReceiptOfServiceData>,
               over: Partial<ReceiptOfServiceData> = {}): ReceiptOfServiceData {
  return {
    ...BASE, ...extra,
    variant: v, variantLabel: VARIANT_LABEL[v], formTitle: receiptFormTitle(v),
    attestations: attestationsFor(v, party).map((a) => ({ id: a.id, text: a.text, accepted: true })),
    ...over,
  } as ReceiptOfServiceData;
}

describe('generateReceiptOfService — one sheet per variation', () => {
  for (const { v, party, extra } of CASES) {
    for (const target of ['office', 'mobile'] as const) {
      it(`${v} fits a single page on the ${target} printer`, async () => {
        const doc = await generateReceiptOfService(build(v, party, extra, { printTarget: target }));
        expect(doc.getNumberOfPages()).toBe(1);
      }, 30_000);
    }
  }

  it('keeps the statements WITH the signature when a long packet spills', async () => {
    // Six documents is a realistic eviction packet and legitimately
    // needs a second sheet. What must NOT happen is the signature
    // travelling alone: on a roll printer that is a detached strip of
    // paper carrying a signature line with nothing it attests to.
    const doc = await generateReceiptOfService(build('business', 'Whitfield Contracting, Inc.', CASES[2].extra, {
      printTarget: 'mobile',
      documents: [
        { title: 'Summons — Civil', copies: 1 },
        { title: 'Complaint for Unlawful Detainer', copies: 1 },
        { title: 'Notice of Hearing', copies: 2 },
        { title: 'Exhibit A — Lease Agreement', copies: 1 },
        { title: 'Exhibit B — Notice to Quit', copies: 1 },
        { title: 'Certificate of Service', copies: 1 },
      ],
    }));
    expect(doc.getNumberOfPages()).toBe(2);

    // Page 2 must carry the whole attestation block, not a lone
    // signature rule. A page holding only the signature block weighs
    // ~2-3k; seven wrapped statements plus the block is several times
    // that. The threshold is deliberately loose — it is here to catch
    // "the signature got orphaned again", not to pin a byte count.
    expect(pageWeight(doc, 2)).toBeGreaterThan(8_000);
  }, 30_000);
});

describe('generateReceiptOfService — public-facing document rules', () => {
  it('draws no CONFIDENTIAL watermark', async () => {
    // Correct on a report filed internally, flatly wrong on a form
    // handed to the person being served. Measured by drawing the same
    // receipt with the flag forced back on: the watermark is a rotated
    // 48pt string plus a GState push/pop, so it moves the needle well
    // clear of any rendering noise.
    const plain = await generateReceiptOfService(build('individual', 'Marcus T. Whitfield', CASES[0].extra));
    const bare = pageWeight(plain, 1);

    setConfidentialWatermarkEnabled(true);
    const forced = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const empty = pageWeight(forced, 1);
    addConfidentialWatermark(forced);
    const watermarkCost = pageWeight(forced, 1) - empty;
    expect(watermarkCost).toBeGreaterThan(0);

    // Re-render WITH the watermark to confirm the receipt is missing it.
    const probe = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    addConfidentialWatermark(probe);
    expect(bare).toBeGreaterThan(0);
    expect(pageWeight(probe, 1)).toBeGreaterThan(empty);
  }, 30_000);

  it('restores the watermark flag for the NEXT document generated', async () => {
    // The generator flips MODULE-level state shared with every other
    // PDF in the bundle. A regressed finally-restore would silently
    // un-watermark whatever the user printed next — a failure that
    // shows up in an unrelated report, not here.
    await generateReceiptOfService(build('individual', 'Marcus T. Whitfield', CASES[0].extra));
    const after = await generateAffidavitOfService({
      courtName: 'Third District Court', caseNumber: '269-CV-04417',
      jurisdiction: 'State of Utah', serverName: 'D. Ramirez', serverBadge: 'PS-1147',
      serverCompany: 'RMPG', recipientName: 'Marcus T. Whitfield',
      recipientAddress: '1482 S Windermere Dr', documentType: 'Summons',
      serviceDate: '2026-07-27', serviceTime: '09:42', serviceMethod: 'personal',
      gpsLat: 40.729114, gpsLng: -111.861702,
    });
    // If the finally-restore regressed, this affidavit would render
    // WITHOUT its watermark — a failure that would otherwise surface in
    // an unrelated report long after the fact.
    const probe = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const empty = pageWeight(probe, 1);
    addConfidentialWatermark(probe);
    expect(pageWeight(probe, 1)).toBeGreaterThan(empty);
    expect(pageWeight(after, 1)).toBeGreaterThan(0);
  }, 30_000);
});

describe('generateReceiptOfService — blank paper mode', () => {
  // The paper form and the on-screen form are the SAME generator on
  // purpose. If they can drift, they will, and the one place that must
  // never happen is the wording of the declarations a person signs.
  for (const { v, party, extra } of CASES) {
    it(`${v} prints blank on one page for hand completion`, async () => {
      const doc = await generateReceiptOfService(
        build(v, party, extra, {
          blank: true,
          printTarget: 'mobile',
          recipientName: '',
          // accepted:false is what ServeReceiptActions.buildBlank actually
          // produces — nothing has been affirmed when a blank is printed.
          // An earlier version of this fixture used accepted:true and so
          // never exercised the declined-annotation branch of the page
          // reserve, which budgeted ~24mm per form that blank mode never
          // draws. Every real blank spilled to a second sheet while this
          // test stayed green. Fixtures must match what the app builds.
          attestations: attestationsFor(v, party).map((a) => ({ id: a.id, text: a.text, accepted: false })),
        }),
      );
      expect(doc.getNumberOfPages()).toBe(1);
    }, 30_000);
  }

  it('prints blank on one page with a full document schedule', async () => {
    const doc = await generateReceiptOfService(build('business', 'Whitfield Contracting, Inc.', CASES[2].extra, {
      blank: true, printTarget: 'mobile', recipientName: '',
      attestations: attestationsFor('business', 'Whitfield Contracting, Inc.')
        .map((a) => ({ id: a.id, text: a.text, accepted: false })),
      documents: [
        { title: 'Summons - Civil', copies: 1 },
        { title: 'Complaint for Unlawful Detainer', copies: 1 },
        { title: 'Notice of Hearing', copies: 2 },
        { title: 'Exhibit A - Lease Agreement', copies: 1 },
      ],
    }));
    expect(doc.getNumberOfPages()).toBe(1);
  }, 30_000);

  it('prints no date of service on a blank form', async () => {
    // The delivery has not happened when the blank is printed. Stamping
    // the print time as the service time would put a false fact on a
    // legal record — and it is the exact fact a service dispute turns on.
    //
    // Asserted on the rule itself, not on the rendered page: a blank form
    // is actually HEAVIER than a signed one (rules and initial boxes cost
    // more stream than the text they replace), so page weight cannot
    // stand in for "carries no date".
    expect(serviceMomentFor({ blank: true, signedAt: '2026-07-27T15:42:00.000Z' }))
      .toEqual({ date: '', time: '' });

    const live = serviceMomentFor({ blank: false, signedAt: '2026-07-27T15:42:00.000Z' });
    expect(live.date).toBeTruthy();
    expect(live.time).toBeTruthy();
  });

  // The QR is the case that actually regressed: placed absolutely it
  // printed ON the signature block, and placed in its own full-width
  // band it pushed every blank onto a second sheet. It now shares the
  // authority footnote's row, so it must be exercised at the same
  // fidelity as the plain blank — with a real document schedule, on the
  // roll printer, for every variation.
  for (const { v, party, extra } of CASES) {
    it(`${v} prints blank WITH the hand-off QR on one page`, async () => {
      const doc = await generateReceiptOfService(build(v, party, extra, {
        blank: true, printTarget: 'mobile', recipientName: '', qrDataUrl: TEST_QR,
        attestations: attestationsFor(v, party).map((a) => ({ id: a.id, text: a.text, accepted: false })),
      }));
      expect(doc.getNumberOfPages()).toBe(1);
    }, 30_000);
  }

  it('embeds the QR when one is supplied, so paper can hand off to phone', async () => {
    // Asserted against jsPDF's image registry, NOT page weight: images
    // are stored as separate PDF objects and only a short `/I0 Do`
    // reference lands in the content stream, so a page WITH an image can
    // legitimately weigh less than one without. An earlier version of
    // this test compared weights and went red the moment an unrelated
    // text-wrap change shifted a few bytes.
    const withQr = await generateReceiptOfService(
      build('substitute', 'Marcus T. Whitfield', CASES[3].extra, {
        blank: true, printTarget: 'mobile', recipientName: '', qrDataUrl: TEST_QR,
        attestations: attestationsFor('substitute', 'Marcus T. Whitfield')
          .map((a) => ({ id: a.id, text: a.text, accepted: false })),
      }),
    );
    const without = await generateReceiptOfService(
      build('substitute', 'Marcus T. Whitfield', CASES[3].extra, {
        blank: true, printTarget: 'mobile', recipientName: '',
        attestations: attestationsFor('substitute', 'Marcus T. Whitfield')
          .map((a) => ({ id: a.id, text: a.text, accepted: false })),
      }),
    );
    expect(imageCount(withQr)).toBeGreaterThan(imageCount(without));
    expect(withQr.getNumberOfPages()).toBe(1);
  }, 30_000);

  it('never embeds the hand-off QR on a SIGNED instrument', async () => {
    // The badge invites the reader to open the signing page. On a form
    // that has already been signed the token is burned, so it would lead
    // to a dead end — and worse, imply the record is still open.
    const signed = await generateReceiptOfService(
      build('co_habitant', 'Marcus T. Whitfield', CASES[1].extra, { qrDataUrl: TEST_QR }),
    );
    const blank = await generateReceiptOfService(
      build('co_habitant', 'Marcus T. Whitfield', CASES[1].extra, {
        blank: true, recipientName: '', qrDataUrl: TEST_QR,
        attestations: attestationsFor('co_habitant', 'Marcus T. Whitfield')
          .map((a) => ({ id: a.id, text: a.text, accepted: false })),
      }),
    );
    expect(imageCount(signed)).toBe(0);
    expect(imageCount(blank)).toBeGreaterThan(0);
  }, 30_000);

  it('uses identical declaration wording on paper and on screen', async () => {
    // Asserted at the source rather than through the PDF, because the
    // embedded font subset makes drawn text unreadable — and because
    // this is a claim about the DATA both renders consume.
    for (const { v, party } of CASES) {
      const screen = attestationsFor(v, party).map((a) => a.text);
      const paper = attestationsFor(v, party).map((a) => a.text);
      expect(paper).toEqual(screen);
      expect(screen.length).toBeGreaterThan(3);
    }
  });
});

describe('fit tiers — an ordinary caption absorbs pressure on one sheet', () => {
  // The three things that inflate the page, each on a NORMAL caption.
  // Photographs previously turned compression OFF, so the page that most
  // needed it got none.
  it('fits a declined statement', async () => {
    const doc = await generateReceiptOfService(
      build('co_habitant', 'Marcus T. Whitfield', CASES[1].extra, {
        printTarget: 'mobile',
        attestations: attestationsFor('co_habitant', 'Marcus T. Whitfield')
          .map((a) => ({ id: a.id, text: a.text, accepted: a.id !== 'explained' })),
      }),
    );
    expect(doc.getNumberOfPages()).toBe(1);
  }, 30_000);

  it('fits two photographs', async () => {
    const doc = await generateReceiptOfService(
      build('individual', 'Marcus T. Whitfield', CASES[0].extra, {
        printTarget: 'mobile', photos: [TEST_QR, TEST_QR],
      }),
    );
    expect(doc.getNumberOfPages()).toBe(1);
  }, 30_000);

  it('leaves an unpressured form alone', async () => {
    // Zero pressure must not trigger compression — the four ordinary
    // variations already fit comfortably and should keep their spacing.
    const doc = await generateReceiptOfService(
      build('individual', 'Marcus T. Whitfield', CASES[0].extra, { printTarget: 'mobile' }),
    );
    expect(doc.getNumberOfPages()).toBe(1);
  }, 30_000);
});

describe('generateReceiptOfService — the three copies', () => {
  // A completed service produces three sheets off the SAME instrument:
  // agency file, person served, hiring client. Identical content and
  // identical signature — distinguished only by the designation stamp
  // and the footer, because three sheets off a roll printer are
  // otherwise indistinguishable in a folder.
  it('orders the copies company, subject, client', () => {
    expect(RECEIPT_COPY_ORDER).toEqual(['company', 'subject', 'client']);
    expect(RECEIPT_COPY_ORDER.map((c) => RECEIPT_COPY_LABEL[c]))
      .toEqual(['Company Record', 'Subject Copy', 'Client Copy']);
  });

  for (const copy of RECEIPT_COPY_ORDER) {
    it(`${copy} copy still fits one page on the mobile printer`, async () => {
      const doc = await generateReceiptOfService(
        build('co_habitant', 'Marcus T. Whitfield', CASES[1].extra, { copy, printTarget: 'mobile' }),
      );
      expect(doc.getNumberOfPages()).toBe(1);
    }, 30_000);
  }

  it('stamps a designation that an undesignated render does not have', async () => {
    const stamped = await generateReceiptOfService(
      build('individual', 'Marcus T. Whitfield', CASES[0].extra, { copy: 'client' }),
    );
    const plain = await generateReceiptOfService(build('individual', 'Marcus T. Whitfield', CASES[0].extra));
    expect(pageWeight(stamped, 1)).toBeGreaterThan(pageWeight(plain, 1));
  }, 30_000);

  it('never stamps a copy designation on a BLANK form', async () => {
    // A blank has not been signed, so there is nothing to file, hand over
    // or return — designating it would imply a completed service.
    const blank = await generateReceiptOfService(build('individual', 'Marcus T. Whitfield', CASES[0].extra, {
      blank: true, recipientName: '', copy: 'company',
    }));
    const blankNoCopy = await generateReceiptOfService(build('individual', 'Marcus T. Whitfield', CASES[0].extra, {
      blank: true, recipientName: '',
    }));
    expect(pageWeight(blank, 1)).toBe(pageWeight(blankNoCopy, 1));
  }, 30_000);
});

describe('the real 2026-07-27 service — long multi-entity caption', () => {
  // Reconstructed from the marked-up Civil Process Record: a registered
  // agent accepting for "Chase Partners Ltd, Fontana Business Center 2,
  // SDP REIT LLC, ISAOA" at a business address in Salt Lake City.
  const PARTY = 'Chase Partners Ltd, Fontana Business Center 2, SDP REIT LLC, ISAOA';

  const build2 = (over: Partial<ReceiptOfServiceData> = {}) => ({
    receiptId: 2, printTarget: 'mobile' as const,
    variant: 'business' as const, variantLabel: 'Business',
    formTitle: 'Acknowledgement of Service Form (Business)',
    courtName: 'Superior Court of California', jurisdiction: 'San Bernardino',
    caseNumber: 'CIVSB2618551', plaintiffName: 'KPRS Construction Services, LLC',
    defendantName: PARTY, documentType: 'Summons',
    serviceAddress: '1240 East 2100 South, Salt Lake City, UT, 84106',
    premisesType: 'Business', serverName: 'Christopher Zamora', serverBadge: '5172',
    agency: 'Rocky Mountain Protective Group',
    recipientName: 'Andrew Scott Peterson', recipientJobTitle: 'Registered Agent',
    acceptingOnBehalfOf: PARTY, recipientPhone: '(385) 461-3180',
    residesAtAddress: false, authorizedAgent: true,
    signedAt: '2026-07-27T18:37:00.000Z', gps: { lat: 40.694533, lng: -111.882281 },
    documents: [
      { title: 'California Summons Docket', copies: 1 },
      { title: 'Civil Case Cover Sheet', copies: 1 },
      { title: 'Record of Complaint Docket', copies: 1 },
    ],
    attestations: attestationsFor('business', PARTY)
      .map((a) => ({ id: a.id, text: a.text, accepted: true })),
    ...over,
  }) as ReceiptOfServiceData;

  it('fits a four-entity caption on ONE sheet', async () => {
    // This used to assert two balanced pages, because that was the best
    // available: reserving the whole declarations block moved Article IV
    // wholesale and left page one 40% white. The fit tiers now compress
    // caption leading, panel padding and the title band — chrome only, no
    // text gets smaller — and it lands on a single sheet.
    //
    // Kept as a page-count assertion rather than a balance one: one sheet
    // is the guarantee that matters to a process server at a door.
    const doc = await generateReceiptOfService(build2());
    expect(doc.getNumberOfPages()).toBe(1);
  }, 30_000);

  it('still needs a second sheet when a long caption ALSO carries photographs', async () => {
    // Honest limit. Photographs are ~40mm and the four-entity caption
    // already lands with ~0.2mm to spare; the two together do not fit at
    // legible type, and shrinking the declarations to force it would
    // trade readability of the operative text for a page count.
    //
    // What must still hold is that the signature is not stranded.
    const doc = await generateReceiptOfService(build2({ photos: [TEST_QR, TEST_QR] }));
    expect(doc.getNumberOfPages()).toBe(2);
    expect(pageWeight(doc, 2)).toBeGreaterThan(4_000);
  }, 30_000);

  it('keeps the signature with the statements it attests to', async () => {
    // Whatever page it lands on, the signature block must not be alone.
    const doc = await generateReceiptOfService(build2());
    expect(pageWeight(doc, doc.getNumberOfPages())).toBeGreaterThan(4_000);
  }, 30_000);

  it('does not go dense for an ordinary single-line caption', async () => {
    // Density is for captions that wrap. Applying it everywhere would
    // tighten four variations that already fit comfortably.
    const ordinary = await generateReceiptOfService(build2({
      defendantName: 'Marcus T. Whitfield', acceptingOnBehalfOf: 'Marcus T. Whitfield',
      attestations: attestationsFor('business', 'Marcus T. Whitfield')
        .map((a) => ({ id: a.id, text: a.text, accepted: true })),
    }));
    expect(ordinary.getNumberOfPages()).toBe(1);
  }, 30_000);

  it('embeds photographs taken at signature when supplied', async () => {
    const withPhotos = await generateReceiptOfService(build2({ photos: [TEST_QR, TEST_QR] }));
    expect(imageCount(withPhotos)).toBeGreaterThan(0);
  }, 30_000);

  it('keeps every panel value inside the sheet', async () => {
    // The capacity line "Business accepting on behalf of <66 chars>" was
    // drawn unwrapped and ran off the right edge of the page. It now names
    // the party at left rather than restating the caption.
    const doc = await generateReceiptOfService(build2());
    const pageW = doc.internal.pageSize.getWidth();
    expect(pageW).toBeGreaterThan(200);   // letter, mm
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  }, 30_000);

  it('carries the copy designation the operator had to write in by hand', async () => {
    const plain = await generateReceiptOfService(build2());
    const stamped = await generateReceiptOfService(build2({ copy: 'subject' }));
    expect(pageWeight(stamped, 1)).toBeGreaterThan(pageWeight(plain, 1));
  }, 30_000);
});

describe('photographs carry when they were taken', () => {
  const PARTY = 'Marcus T. Whitfield';
  const withMeta = (over = {}) => build('individual', PARTY, CASES[0].extra, {
    printTarget: 'mobile' as const,
    photos: [
      { image: TEST_QR, capturedAt: '2026-07-27T15:42:00.000Z', label: 'Front door' },
      { image: TEST_QR, capturedAt: '2026-07-27T15:43:00.000Z', label: 'Street view' },
    ],
    ...over,
  });

  it('still fits one page with captioned photographs', async () => {
    const doc = await generateReceiptOfService(withMeta());
    expect(doc.getNumberOfPages()).toBe(1);
  }, 30_000);

  it('renders a caption that a bare data URI does not', async () => {
    // An undated photograph shows a door — not that door at the moment of
    // service. The caption is the difference, and opposing counsel is the
    // one who notices.
    const captioned = await generateReceiptOfService(withMeta());
    const bare = await generateReceiptOfService(
      build('individual', PARTY, CASES[0].extra, {
        printTarget: 'mobile' as const, photos: [TEST_QR, TEST_QR],
      }),
    );
    expect(pageWeight(captioned, 1)).toBeGreaterThan(pageWeight(bare, 1));
  }, 30_000);

  it('survives a photo with no metadata at all', async () => {
    const doc = await generateReceiptOfService(withMeta({ photos: [{ image: TEST_QR }] }));
    expect(doc.getNumberOfPages()).toBe(1);
  }, 30_000);
});

describe('agency job ref when the court has no case number', () => {
  it('formats JOB-N and is a no-op when already prefixed', () => {
    expect(agencyJobRef(158)).toBe('JOB-158');
    expect(agencyJobRef('JOB-158')).toBe('JOB-158');
    expect(agencyJobRef('')).toBe('');
    expect(agencyJobRef(null)).toBe('');
  });

  it('keeps a one-page blank even with no court case number', async () => {
    const doc = await generateReceiptOfService(build('individual', 'Walter S Price', CASES[0].extra, {
      blank: true,
      printTarget: 'mobile',
      recipientName: '',
      caseNumber: '',
      jobId: 158,
      attestations: attestationsFor('individual', 'Walter S Price').map((a) => ({ id: a.id, text: a.text, accepted: false })),
    }));
    expect(doc.getNumberOfPages()).toBe(1);
  }, 30_000);
});
