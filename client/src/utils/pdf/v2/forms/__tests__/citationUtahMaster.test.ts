// ============================================================
// citationUtahMaster — schema + render smoke tests
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  citationUtahMasterSchema,
  citationUtahMasterCanonicalData,
  COPY_STRIP_LABELS,
  FORM_CONTENT_HEIGHT,
  type CitationUtahData,
} from '../citationUtahMaster';
import {
  renderUtahMasterMultiCopyBytes,
  renderUtahMasterCopyBlobs,
  ALL_COPY_KINDS,
} from '../../utahMasterRenderer';
import { extractSidecarFromBytes } from '../../engine/sidecar';

const FIXTURE: CitationUtahData = {
  citation_number: 'CIT-2026-0001',
  type: 'traffic',
  status: 'issued',
  zone_plaintiff_name: 'STATE OF UTAH',
  zone_agency_id_label: 'ORI: UT0123456',
  zone_include_court_caption: true,
  person_last: 'Doe',
  person_first: 'John',
  person_middle: 'Q',
  person_dob: '1990-05-15',
  person_dl: 'D12345678',
  person_dl_state: 'UT',
  person_address: '123 Main St',
  person_city: 'Salt Lake City',
  person_state: 'UT',
  person_zip: '84111',
  person_phone: '(801) 555-0100',
  vehicle_plate: 'A12 3BC',
  vehicle_state: 'UT',
  vehicle_year: '2020',
  vehicle_make: 'Toyota',
  vehicle_model: 'Camry',
  vehicle_color: 'Silver',
  vehicle_vin: '1HGBH41JXMN109186',
  violation_date: '2026-06-22',
  violation_time: '14:32',
  location: '500 S State St',
  incident_city: 'Salt Lake City',
  incident_county: 'Salt Lake',
  statute_citation: '41-6a-601',
  violation_description: 'Speed 45 in 35 zone',
  offense_level: 'Infraction',
  fine_amount: 120,
  speed_recorded: 45,
  speed_limit: 35,
  radar_type: 'LIDAR',
  court_name: 'Salt Lake City Justice Court',
  court_address: '333 South 200 East, Salt Lake City, UT 84111',
  court_date: '2026-07-15',
  court_time: '09:00',
  court_room: '1',
  appearance_required: false,
  notes: 'Posted speed limit clearly visible.',
  issuing_officer_name: 'J. Smith',
  badge_number: '4521',
  ori: 'UT0123456',
  issuing_agency: 'Rocky Mountain Protective Group',
  prosecuting_agency: 'Salt Lake City Attorney',
  caption_county: 'Salt Lake',
  caption_city: 'Salt Lake City',
  dl_expires: '11/2033',
  dl_restriction: 'A',
  cdl_presented: false,
  motorcycle_endorsed: false,
  picture_id: true,
  birth_place: 'UT',
  person_sex: 'M',
  person_race: 'W',
  person_height: '511',
  person_weight: '185',
  person_eyes: 'BRO',
  person_hair: 'BRO',
  vehicle_type: 'PASSENGER',
  vehicle_plate_expires: '09/2026',
  mile_post: '312',
  direction_of_travel: 'NB',
  interstate: false,
  military: false,
  court_phone: '(801) 535-6300',
  officer_id_number: '4521',
  complainant: 'J. Smith',
  complainant_phone: '(801) 555-0199',
};

describe('citationUtahMasterSchema layout', () => {
  it('has exactly one fixed-layout section (form); strip is page-anchored', () => {
    const fixedSections = citationUtahMasterSchema.sections.filter(
      (s) => typeof s !== 'function' && (s as any).kind === 'fixed-layout',
    );
    expect(fixedSections).toHaveLength(1);
  });

  it('form content clears the page-anchored copy strip', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    expect(fixed.kind).toBe('fixed-layout');
    expect(fixed.height).toBe(FORM_CONTENT_HEIGHT);
    // Letter page is 279.4mm; the header consumes ~36mm and the copy strip is
    // drawn at (pageHeight - 25mm). Content must end above it or the copy
    // designation prints on top of the court-disposition strip.
    expect(36 + FORM_CONTENT_HEIGHT).toBeLessThan(279.4 - 25);
  });

  it('every field with a path has an accessor', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    for (const f of fixed.fields) {
      if (f.path) expect(typeof f.accessor).toBe('function');
    }
  });

  it('citation_number, person_name, statute_citation, court_name paths are present', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    const paths = new Set(fixed.fields.map((f: any) => f.path).filter(Boolean));
    expect(paths).toContain('citation_number');
    expect(paths).toContain('court_name');
    expect(paths).toContain('statute_citation');
    expect(paths).toContain('person_dob');
    expect(paths).toContain('vehicle_plate');
  });

  it('carries every field the official Utah Uniform Citation prints', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    const paths = new Set(fixed.fields.map((f: any) => f.path).filter(Boolean));
    for (const p of [
      'ori', 'issuing_agency', 'prosecuting_agency', 'caption_county', 'caption_city',
      'person_last', 'person_first', 'person_middle', 'person_city', 'person_state', 'person_zip',
      'dl_state', 'dl_expires', 'dl_restriction', 'cdl_presented', 'motorcycle_endorsed',
      'picture_id', 'birth_place', 'ssn',
      'person_sex', 'person_race', 'person_height', 'person_weight', 'person_eyes', 'person_hair',
      'vehicle_plate_expires', 'vehicle_type',
      'gvwr', 'occupants_16_plus', 'company_unit', 'company_city_state', 'actual_weight', 'weight_limit',
      'mile_post', 'direction_of_travel', 'interstate', 'military',
      'court_phone', 'officer_id_number', 'complainant', 'complainant_phone',
      'fine_imposed', 'fine_suspended', 'jail_days', 'jail_suspended',
      'conviction_date', 'date_sent_to_dld', 'docket_number', 'judge_name',
      'felony_death', 'felony_serious_bodily',
    ]) {
      expect(paths, `missing official field: ${p}`).toContain(p);
    }
  });

  it('prints the statutory notices verbatim', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    const paragraphs = fixed.fields
      .filter((f: any) => f.style === 'paragraph')
      .map((f: any) => f.label as string);
    const joined = paragraphs.join(' ');
    // Wording is transcribed from the filed form; a clerk reads these copies
    // against the paper original, so paraphrasing is a rejection risk.
    expect(joined).toContain('Not less than (5) five nor more than (14) fourteen days');
    expect(joined).toContain('deferred prosecution under UCA 77-2-4.2');
    expect(joined).toContain('This citation is not an information and will not be used as an information without your consent');
    expect(joined).toContain('the proper court pursuant to section 77-7-21, U.C.A.');
    expect(joined).toContain('https://www.utcourts.gov/epayments');
  });

  it('gives every statutory paragraph room for its wrapped lines', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    for (const f of fixed.fields.filter((x: any) => x.style === 'paragraph')) {
      // drawParagraph clips to floor(h / lineHeight) lines. Approximate the
      // wrap at ~0.52mm per character at 6pt to catch a paragraph whose box
      // is too short to show all of its text.
      const lineHeight = f.lineHeight ?? 2.6;
      const charsPerLine = f.w / 0.52;
      const needed = Math.ceil(f.label.length / charsPerLine);
      const available = Math.floor(f.h / lineHeight);
      expect(available, `paragraph truncated: ${f.label.slice(0, 40)}`).toBeGreaterThanOrEqual(needed);
    }
  });

  it('renders yes/no pairs as a tri-state — null checks neither box', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    const yes = fixed.fields.find((f: any) => f.style === 'checkbox' && f.label === 'YES');
    const no = fixed.fields.find((f: any) => f.style === 'checkbox' && f.label === 'NO');
    const unanswered: CitationUtahData = { ...FIXTURE, cdl_presented: null };
    expect(yes.accessor(unanswered)).toBe(false);
    expect(no.accessor(unanswered)).toBe(false);
    expect(no.accessor({ ...FIXTURE, cdl_presented: false })).toBe(true);
    expect(yes.accessor({ ...FIXTURE, cdl_presented: true })).toBe(true);
  });

  it('all field coordinates fit within the 195.9mm content width', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    const WIDTH = 195.9;
    for (const f of fixed.fields) {
      expect(f.x + f.w, `${f.path || f.label || f.style} overflows width`).toBeLessThanOrEqual(WIDTH + 0.01);
    }
  });

  it('all field y-coordinates fit within the declared section height', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    for (const f of fixed.fields) {
      expect(f.y + f.h, `${f.path || f.label || f.style} overflows height`).toBeLessThanOrEqual(fixed.height);
    }
  });
});

describe('citationUtahMasterCanonicalData', () => {
  it('extracts every path-bearing field from the fixture', () => {
    const bag = citationUtahMasterCanonicalData(FIXTURE);
    expect(bag.citation_number).toBe('CIT-2026-0001');
    expect(bag.court_name).toBe('Salt Lake City Justice Court');
    expect(bag.statute_citation).toBe('41-6a-601');
    expect(bag.violation_description).toBe('Speed 45 in 35 zone');
    expect(bag.ori).toBe('UT0123456');
    expect(bag.person_height).toBe('511');
    expect(bag.mile_post).toBe('312');
  });

  it('round-trips an unanswered yes/no as null, not false', () => {
    // Pathing the YES checkbox would extract `false` for an unanswered
    // question and re-render it as an explicit "NO" — a false statement of
    // fact on a court document.
    const bag = citationUtahMasterCanonicalData({ ...FIXTURE, cdl_presented: null });
    expect(bag.cdl_presented).toBeUndefined();
    const answered = citationUtahMasterCanonicalData({ ...FIXTURE, cdl_presented: false });
    expect(answered.cdl_presented).toBe(false);
  });

  it('omits the per-page __copyKind from the canonical bag', () => {
    const withCopy: CitationUtahData = { ...FIXTURE, __copyKind: 'defendant' };
    const bag = citationUtahMasterCanonicalData(withCopy);
    expect(bag.__copyKind).toBeUndefined();
  });

  it('includes the violations array when populated', () => {
    const withViolations: CitationUtahData = {
      ...FIXTURE,
      violations: [
        { statute_citation: '41-6a-601', description: 'Speed', offense_class: 'Infraction', fine_amount: 120 },
        { statute_citation: '41-6a-1716', description: 'Phone use', offense_class: 'Class C Misd.', fine_amount: 145 },
      ],
    };
    const bag = citationUtahMasterCanonicalData(withViolations);
    expect(Array.isArray(bag.violations)).toBe(true);
    expect((bag.violations as any[]).length).toBe(2);
  });
});

describe('renderUtahMasterMultiCopyBytes', () => {
  it('renders 4 pages by default (one per copy variant)', async () => {
    const bytes = await renderUtahMasterMultiCopyBytes(FIXTURE, {
      generatedAt: new Date('2026-06-22T14:32:00Z'),
      coreFontsOnly: true,
    });
    // Each page in a jsPDF file starts with the PDF page object marker
    // `<< /Type /Page ...`. Counting these in the raw bytes is a tractable
    // way to verify multi-copy expansion without parsing the PDF fully.
    const text = new TextDecoder('latin1').decode(bytes);
    const pageMatches = text.match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBeGreaterThanOrEqual(4);
  }, 30_000);

  it('embeds a sidecar that round-trips back to citation data', async () => {
    const bytes = await renderUtahMasterMultiCopyBytes(FIXTURE, {
      generatedAt: new Date('2026-06-22T14:32:00Z'),
      coreFontsOnly: true,
    });
    const sidecar = extractSidecarFromBytes(bytes);
    expect(sidecar).not.toBeNull();
    expect(sidecar?.schemaId).toBe('citation-utah-master');
    expect((sidecar?.data as any)?.citation_number).toBe('CIT-2026-0001');
    // Verify __copyKind is stripped from the embedded payload (it's per-page only)
    expect((sidecar?.data as any)?.__copyKind).toBeUndefined();
  }, 30_000);
});

describe('renderUtahMasterCopyBlobs', () => {
  it('yields one Blob per copy variant', async () => {
    const blobs = await renderUtahMasterCopyBlobs(FIXTURE, {
      generatedAt: new Date('2026-06-22T14:32:00Z'),
      coreFontsOnly: true,
    });
    for (const kind of ALL_COPY_KINDS) {
      expect(blobs[kind]).toBeInstanceOf(Blob);
      expect(blobs[kind].size).toBeGreaterThan(1000);
    }
  }, 60_000);

  it('honors copyKinds subset (e.g., defendant only for on-scene print)', async () => {
    const blobs = await renderUtahMasterCopyBlobs(FIXTURE, {
      copyKinds: ['defendant'],
      generatedAt: new Date('2026-06-22T14:32:00Z'),
      coreFontsOnly: true,
    });
    expect(blobs.defendant).toBeInstanceOf(Blob);
    // Other variants intentionally absent
    expect((blobs as any).court).toBeUndefined();
    expect((blobs as any).agency).toBeUndefined();
    expect((blobs as any).file).toBeUndefined();
  }, 30_000);
});

describe('type-aware section visibility', () => {
  it('hides the notice-to-appear block on type=warning', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    const notice = fixed.fields.find(
      (f: any) => f.label === 'THE DEFENDANT IS GIVEN NOTICE TO APPEAR',
    );
    expect(notice).toBeDefined();
    expect(notice.visibleIf?.({ ...FIXTURE, type: 'warning' })).toBe(false);
    expect(notice.visibleIf?.(FIXTURE)).toBe(true);
  });

  it('hides the summons warning and defendant signature on type=warning', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    const warning: CitationUtahData = { ...FIXTURE, type: 'warning' };
    const summons = fixed.fields.find(
      (f: any) => f.style === 'paragraph' && f.label.startsWith('Not less than (5) five'),
    );
    expect(summons.visibleIf?.(warning)).toBe(false);
    const defSig = fixed.fields.find((f: any) => f.label === 'Signature of Defendant');
    expect(defSig.visibleIf?.(warning)).toBe(false);
  });

  it('always prints the court-disposition strip — it is court-filled, not officer-filled', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    const docket = fixed.fields.find((f: any) => f.path === 'docket_number');
    expect(docket.visibleIf).toBeUndefined();
  });
});

describe('copy designations', () => {
  it('uses the designations printed on the official 4-part set', () => {
    expect(COPY_STRIP_LABELS.agency).toBe('ISSUING AGENCY COPY');
    expect(COPY_STRIP_LABELS.court).toBe('COURT COPY');
    expect(COPY_STRIP_LABELS.defendant).toBe('DEFENDANT COPY');
  });
});
