// Smoke tests for recordPdfGenerator.ts — verify every public export can
// accept minimum-viable data and complete without throwing. These don't
// validate PDF output correctness (that would require visual snapshot
// tooling); they catch the regressions that most frequently break PDFs:
//  - missing null-checks crashing on undefined optional fields
//  - broken imports after refactors
//  - type/signature drift between callers and generators
//
// Scope covers every member of `RecordPdfType` (9 report types) plus BOLO
// and Warrant Summary — the three public surfaces callers actually use.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  CallPdfData,
  PersonPdfData,
  VehiclePdfData,
  WarrantPdfData,
  EvidencePdfData,
  FleetPdfData,
  PersonnelPdfData,
  PropertyPdfData,
  CitationPdfData,
  BoloSubject,
  WarrantSummaryData,
} from '../recordPdfGenerator';
import {
  generateRecordPdf,
  generateBoloPdf,
  generateWarrantSummaryPdf,
  setActiveOfficerSignature,
} from '../recordPdfGenerator';

// Stub the admin-branding endpoint. generateRecordPdf itself doesn't fetch,
// but the generators call shared helpers (addReportHeader etc.) that read
// active branding state — keeping fetch stubbed avoids test flakiness if
// anything in the chain changes to eagerly load.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/admin/config/branding')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('', { status: 404 });
    })
  );
  setActiveOfficerSignature(undefined);
});

// ── Minimum-viable fixtures (only required fields per interface) ────

const minCall: CallPdfData = {
  call_number: 'C-25-00001',
  incident_type: 'WELFARE_CHECK',
  priority: '3',
  status: 'CLEARED',
  description: 'Smoke test call.',
};

const minPerson: PersonPdfData = {
  id: '1',
  first_name: 'Test',
  last_name: 'Subject',
};

const minVehicle: VehiclePdfData = {
  id: '1',
  license_plate: 'ABC123',
};

const minWarrant: WarrantPdfData = {
  warrant_number: 'W-25-00001',
  type: 'BENCH',
  status: 'ACTIVE',
};

const minEvidence: EvidencePdfData = {
  evidence_number: 'E-25-00001',
};

const minFleet: FleetPdfData = {
  vehicle_number: 'UNIT-1',
  status: 'active',
};

const minPersonnel: PersonnelPdfData = {
  first_name: 'Officer',
  last_name: 'Test',
};

const minProperty: PropertyPdfData = {
  name: 'Test Property',
};

const minCitation: CitationPdfData = {
  citation_number: 'CIT-25-00001',
  type: 'TRAFFIC',
  status: 'ISSUED',
};

const minWarrantSummary: WarrantSummaryData = {
  period: { from: null, to: null },
  byStatus: {},
  byType: {},
  bySeverity: {},
  bySource: {},
  topCourts: [],
  newThisPeriod: null,
  clearedThisPeriod: null,
  scanActivity: { totalScans: 0, totalFound: 0, totalCleared: 0 },
};

// ── Tests ──────────────────────────────────────────────────────────

describe('recordPdfGenerator smoke tests', () => {
  it('generates a call PDF from minimal data', async () => {
    const doc = await generateRecordPdf('call', minCall);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a person PDF from minimal data', async () => {
    const doc = await generateRecordPdf('person', minPerson);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a vehicle PDF from minimal data', async () => {
    const doc = await generateRecordPdf('vehicle', minVehicle);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a warrant PDF from minimal data', async () => {
    const doc = await generateRecordPdf('warrant', minWarrant);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('renders with all new Phase 1 fields populated', async () => {
    const data = {
      ...minWarrant,
      oca_number: '2026-CR-4827',
      ori: 'UT0181700',
      ncic_entry_number: 'N28B9',
      issue_date: '2026-04-01',
      priority_score: 87,
      statute_text: 'Theft — Obtaining property by deception',
      subject_aliases: ['Johnny', 'Red'],
      subject_distinguishing_features: 'snake tattoo neck',
      known_associates: [{ name: 'Doe, Jane', relationship: 'spouse' }],
      known_vehicles: [{ plate: 'ABC123', description: '2021 Civic Blue' }],
      rmpg_encounters: [{ date: '2026-03-20', context: 'FI-2026-0012', property: 'Walmart' }],
      source_scraper_name: 'Utah Warrants Live',
      source_state: 'UT',
      source_last_scraped_at: '2026-04-24T13:45:00Z',
      printed_by_name: 'Zamora',
      printed_by_badge: '142',
      printed_at: '2026-04-24T14:32:00Z',
    };
    const doc = await generateRecordPdf('warrant', data);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(5000);
  });

  it('renders EXPIRED watermark for past expires_at', async () => {
    const data = { ...minWarrant, expires_at: '2020-01-01' };
    const doc = await generateRecordPdf('warrant', data);
    expect(doc).toBeDefined();
  });

  it('renders ARCHIVED watermark when archived_at set', async () => {
    const data = { ...minWarrant, archived_at: '2026-04-01' };
    const doc = await generateRecordPdf('warrant', data);
    expect(doc).toBeDefined();
  });

  it('handles Unicode subject name', async () => {
    const doc = await generateRecordPdf('warrant', {
      ...minWarrant,
      subject_first_name: 'Müller',
      subject_last_name: '王',
    });
    expect(doc).toBeDefined();
  });

  it('generates an evidence PDF from minimal data', async () => {
    const doc = await generateRecordPdf('evidence', minEvidence);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a fleet PDF from minimal data', async () => {
    const doc = await generateRecordPdf('fleet', minFleet);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a personnel PDF from minimal data', async () => {
    const doc = await generateRecordPdf('personnel', minPersonnel);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a property PDF from minimal data', async () => {
    const doc = await generateRecordPdf('property', minProperty);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a citation PDF from minimal data', async () => {
    const doc = await generateRecordPdf('citation', minCitation);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('rejects unknown record types', async () => {
    // @ts-expect-error intentional bad input
    await expect(generateRecordPdf('bogus', {})).rejects.toThrow();
  });

  it('generates a BOLO PDF with a single subject', () => {
    const subject: BoloSubject = {
      first_name: 'Test',
      last_name: 'Subject',
      warrants: [],
    };
    const doc = generateBoloPdf([subject]);
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a BOLO PDF with multiple subjects and warrants', () => {
    const subjects: BoloSubject[] = [
      {
        first_name: 'Alpha',
        last_name: 'One',
        warrants: [{
          warrant_number: 'W-1',
          type: 'ARREST',
          charge_description: 'Test charge',
          offense_level: 'FELONY',
          issuing_court: 'Test Court',
          bail_amount: 1000,
        }],
      },
      {
        first_name: 'Bravo',
        last_name: 'Two',
        warrants: [],
      },
    ];
    const doc = generateBoloPdf(subjects);
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a warrant summary PDF from an empty-period dataset', () => {
    const doc = generateWarrantSummaryPdf(minWarrantSummary);
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a warrant summary PDF from a populated dataset', () => {
    const doc = generateWarrantSummaryPdf({
      period: { from: '2025-01-01', to: '2025-03-31' },
      byStatus: { ACTIVE: 12, CLEARED: 7 },
      byType: { BENCH: 10, ARREST: 9 },
      bySeverity: { FELONY: 5, MISDEMEANOR: 14 },
      bySource: { MANUAL: 15, SCRAPER: 4 },
      topCourts: [{ issuing_court: 'Test Court', count: 12 }],
      newThisPeriod: 19,
      clearedThisPeriod: 7,
      scanActivity: { totalScans: 150, totalFound: 19, totalCleared: 7 },
    });
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('setActiveOfficerSignature accepts undefined and a signature payload', () => {
    expect(() => setActiveOfficerSignature(undefined)).not.toThrow();
    expect(() => setActiveOfficerSignature({
      signatureImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=',
      printedName: 'Test Officer',
      badgeNumber: '123',
      date: new Date().toISOString().slice(0, 10),
    })).not.toThrow();
    // Reset for subsequent tests
    setActiveOfficerSignature(undefined);
  });
});
