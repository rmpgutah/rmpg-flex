// ============================================================
// citationUtahMaster — schema + render smoke tests
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  citationUtahMasterSchema,
  citationUtahMasterCanonicalData,
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
  violation_day: 'MON',
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
};

describe('citationUtahMasterSchema layout', () => {
  it('has exactly one fixed-layout section (form); strip is page-anchored', () => {
    const fixedSections = citationUtahMasterSchema.sections.filter(
      (s) => typeof s !== 'function' && (s as any).kind === 'fixed-layout',
    );
    expect(fixedSections).toHaveLength(1);
  });

  it('master form section is 250mm tall (spans usable content area)', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    expect(fixed.kind).toBe('fixed-layout');
    expect(fixed.height).toBe(250);
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
  it('hides the Court Appearance block on type=warning', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    const courtField = fixed.fields.find((f: any) => f.label === 'COURT APPEARANCE');
    expect(courtField).toBeDefined();
    const warning: CitationUtahData = { ...FIXTURE, type: 'warning' };
    expect(courtField.visibleIf?.(warning)).toBe(false);
    expect(courtField.visibleIf?.(FIXTURE)).toBe(true);
  });

  it('hides the Promise to Appear block on type=warning', () => {
    const fixed = citationUtahMasterSchema.sections[0] as any;
    const promiseField = fixed.fields.find((f: any) => f.label?.startsWith('PROMISE TO APPEAR'));
    expect(promiseField).toBeDefined();
    const warning: CitationUtahData = { ...FIXTURE, type: 'warning' };
    expect(promiseField.visibleIf?.(warning)).toBe(false);
  });
});
