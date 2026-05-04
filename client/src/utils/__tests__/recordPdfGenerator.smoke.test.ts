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
  CasePdfData,
  FieldInterviewPdfData,
  CourtEventPdfData,
  JailBookingPdfData,
  BoloSubject,
  WarrantSummaryData,
} from '../recordPdfGenerator';
import {
  generateRecordPdf,
  generateBoloPdf,
  generateWarrantSummaryPdf,
  setActiveOfficerSignature,
} from '../recordPdfGenerator';

// Stub fetch:
//  - /api/admin/config/branding → 200 [] (branding helper tolerates empty)
//  - /api/pdf-tools/sign-payload → 503 (graceful UNSIGNED fallback path)
//  - everything else → 404
//
// The 503 simulates a server without EVIDENCE_SIGNING_PRIVATE_KEY env var
// configured. fetchPdfSignature returns null on 503 and downstream code
// renders the "UNSIGNED" trailer instead of failing.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/admin/config/branding')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (typeof url === 'string' && url.includes('/api/pdf-tools/sign-payload')) {
        return new Response(
          JSON.stringify({ error: 'not configured', code: 'SIGNING_NOT_CONFIGURED' }),
          { status: 503 },
        );
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

const minCase: CasePdfData = {
  case_number: 'CSE-25-00001',
  title: 'Test Case File',
};

const minFieldInterview: FieldInterviewPdfData = {
  fi_number: 'FI-25-00001',
  location: '123 Test St, Salt Lake City, UT',
  contact_reason: 'suspicious_activity',
};

const minCourtEvent: CourtEventPdfData = {
  event_number: 'CRT-25-00001',
  event_type: 'arraignment',
  event_date: '2026-06-01',
};

const minJailBooking: JailBookingPdfData = {
  full_name: 'JOHN DOE',
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

  it('embeds EXPIRED text in PDF when expires_at is past', async () => {
    const data = { ...minWarrant, expires_at: '2020-01-01' };
    const doc = await generateRecordPdf('warrant', data);
    const pdfBytes = Buffer.from(doc.output('arraybuffer'));
    // jsPDF encodes text as parenthesized literals like "(EXPIRED) Tj" — search for the substring
    expect(pdfBytes.includes(Buffer.from('EXPIRED'))).toBe(true);
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

  it('generates a case PDF from minimal data', async () => {
    const doc = await generateRecordPdf('case', minCase);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a case PDF with all linked-record appendices populated', async () => {
    const doc = await generateRecordPdf('case', {
      ...minCase,
      case_type: 'theft',
      status: 'open',
      priority: 'high',
      lead_investigator_name: 'Det. Test',
      assigned_officer_names: ['Officer A', 'Officer B'],
      solvability_score: 75,
      summary: 'Multi-victim theft from auto across three properties.',
      narrative: 'Initial investigation indicates a single perpetrator.',
      opened_date: '2026-04-01',
      due_date: '2026-05-01',
      linked_persons: [{ id: 1, first_name: 'John', last_name: 'Doe', date_of_birth: '1980-01-01', relationship: 'suspect' }],
      linked_incidents: [{ id: 10, incident_number: 'INC-001', incident_type: 'theft', status: 'open', created_at: '2026-04-01' }],
      linked_evidence: [{ id: 20, item_number: 'E-001', description: 'broken window', status: 'collected', collected_at: '2026-04-01' }],
      linked_citations: [{ id: 30, citation_number: 'CIT-001', type: 'traffic', status: 'issued', violation_date: '2026-03-01' }],
      linked_warrants: [{ id: 40, warrant_number: 'W-001', type: 'arrest', status: 'active', charge_description: 'Theft' }],
    });
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a field_interview PDF from minimal data', async () => {
    const doc = await generateRecordPdf('field_interview', minFieldInterview);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a field_interview PDF with subject + vehicle + narrative', async () => {
    const doc = await generateRecordPdf('field_interview', {
      ...minFieldInterview,
      subject_first_name: 'Jane',
      subject_last_name: 'Doe',
      subject_dob: '1990-05-15',
      subject_height: '5\'6"',
      subject_weight: '140',
      subject_clothing: 'Black hoodie, blue jeans',
      vehicle_plate: 'ABC123',
      vehicle_description: '2020 Honda Civic, gray',
      narrative: 'Subject was observed loitering near loading dock at 2300 hours.',
      latitude: 40.76,
      longitude: -111.89,
      contact_type: 'consensual',
      action_taken: 'verbal_warning',
    });
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a court_event PDF from minimal data', async () => {
    const doc = await generateRecordPdf('court_event', minCourtEvent);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a court_event PDF with full hearing + outcome populated', async () => {
    const doc = await generateRecordPdf('court_event', {
      ...minCourtEvent,
      event_type: 'subpoena',
      status: 'concluded',
      event_time: '09:30',
      court_name: 'Salt Lake County Justice Court',
      courtroom: '3B',
      judge_name: 'Hon. Smith',
      court_case_number: '2026-TR-12345',
      defendant_name: 'John Doe',
      prosecutor: 'D. Prosecutor',
      defense_attorney: 'R. Defender',
      officers_required: ['Officer A', 'Officer B'],
      citation_number: 'CIT-001',
      outcome: 'Guilty plea entered',
      sentence: '6 months probation',
      fine_amount: 350.00,
      notes: 'Defendant appeared with counsel.',
    });
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a jail_booking PDF from minimal data', async () => {
    const doc = await generateRecordPdf('jail_booking', minJailBooking);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a jail_booking PDF with parsed charges from free text', async () => {
    const doc = await generateRecordPdf('jail_booking', {
      ...minJailBooking,
      first_name: 'JOHN',
      last_name: 'DOE',
      date_of_birth: '1980-01-01',
      booking_date: '2026-04-15',
      county: 'Salt Lake',
      status: 'in_custody',
      charges: 'Theft 76-6-404; Assault 76-5-102; Possession 58-37-8',
      source_name: 'JailBase',
      source_id: 'jb-12345',
    });
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('generates a jail_booking PDF using charge_lines array', async () => {
    const doc = await generateRecordPdf('jail_booking', {
      ...minJailBooking,
      charge_lines: ['Theft (Class A Misdemeanor)', 'Failure to Appear', 'Probation Violation'],
    });
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
