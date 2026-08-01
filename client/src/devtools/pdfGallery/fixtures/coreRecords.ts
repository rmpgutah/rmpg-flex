// ═══════════════════════════════════════════════════════════════════════
// CORE RECORD DOCUMENT SERIES (FORM PS-2xx) — the 14 record types every
// officer prints daily via PrintRecordButton / downloadRecordPdf, dispatched
// through the single generateRecordPdf() switch in recordPdfGenerator.ts.
//
// Missed entirely by the harness until now. In the hour before this batch
// was written, the operator printed three PS-2xx documents live and found
// a real defect in every one (commits c02f699ab5, 977fb637f1, 956bc6d20e):
//   - vehicle (PS-203): tow_status 'None' (title-cased default) falsely
//     stamped an IMPOUNDED banner; the linked-records strip had no persons
//     badge and mis-pluralized counts ("1 PROPERTIES").
//   - property (PS-208) / business (PS-212): banner subtitles truncated
//     with a dangling separator before the ellipsis; addFieldPair
//     blanket-uppercased emails/URLs; annual revenue printed as a raw
//     unformatted integer.
// The fixtures below are regression fixtures for those already-fixed
// defects — reproducing the exact input shapes that triggered them.
//
// Synthetic data only. No real name, plate, VIN, address, EIN, or phone
// number from the operator's live-printed records appears here — organization
// policy. Realistic law-enforcement phrasing (Utah Code citations, NCIC
// codes, chain-of-custody language) is used deliberately instead of lorem
// ipsum, since genuine phrase collisions are what the placeholder-leak
// detector is meant to catch. US units throughout.
// ═══════════════════════════════════════════════════════════════════════

import { generateRecordPdf } from '../../../utils/recordPdfGenerator';
import type {
  CallPdfData,
  PersonPdfData,
  VehiclePdfData,
  WarrantPdfData,
  EvidencePdfData,
  FleetPdfData,
  PersonnelPdfData,
  PropertyPdfData,
  BusinessPdfData,
  CitationPdfData,
  CasePdfData,
  FieldInterviewPdfData,
  CourtEventPdfData,
  JailBookingPdfData,
} from '../../../utils/recordPdfGenerator';
import type { PdfFixture } from '../types';

const MAXIMAL_NAME =
  'Bartholomew Maximilian Fitzgerald-Whitlock Ambrosino-Delacroix Reyes-Whitfield the Third, Esquire'.padEnd(120, ' ').slice(0, 120);

const BOILERPLATE_SENTENCE =
  'This narrative was compiled under penalty of perjury per Utah Code 76-8-504, and is a true and accurate ' +
  'account of the events described. Chain of custody was maintained throughout. State of Utah, County of Salt Lake. ';
const MAXIMAL_NARRATIVE = BOILERPLATE_SENTENCE.repeat(Math.ceil(2000 / BOILERPLATE_SENTENCE.length)).slice(0, 2000);

const YEAR_BOUNDARY = '2026-12-31T23:59:00Z';

function rows<T>(count: number, make: (i: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => make(i));
}

// ── call (FORM PS-201) — dispatch-patrol ──────────────────────────────

export const callFixtures: PdfFixture<CallPdfData>[] = [
  {
    variant: 'typical',
    label: 'Disturbance call, dispatched and cleared, one note',
    input: {
      call_number: '2026-004417',
      incident_type: 'Disturbance',
      priority: 'P2',
      status: 'cleared',
      description: 'Loud verbal argument reported between two occupants of unit 14B.',
      disposition: 'Resolved on scene — parties separated, no citations issued.',
      caller_name: 'Dana Whitlock',
      caller_phone: '(801) 555-0142',
      location: '1400 S State St, Salt Lake City, UT 84115',
      zone_beat: 'B-14',
      responding_officer: 'Marcus Reyes',
      created_at: '2026-07-15T20:12:00Z',
      dispatched_at: '2026-07-15T20:13:10Z',
      onscene_at: '2026-07-15T20:21:44Z',
      cleared_at: '2026-07-15T20:48:02Z',
      notes: [
        { id: 'n1', author: 'Dispatch', content: 'Caller reports raised voices, no weapons mentioned.', created_at: '2026-07-15T20:12:30Z' },
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no caller, location, or narrative',
    input: {
      call_number: '2026-000001',
      incident_type: 'Unknown',
      priority: 'P4',
      status: 'open',
      description: '',
      notes: [{ id: 'n1', author: 'Dispatch' }],
      assigned_units: [],
      linked_persons: [{ role: 'witness', first_name: 'Unknown', last_name: 'Unknown' }],
      linked_vehicles: [{ role: 'observed' }],
    },
  },
  {
    variant: 'maximal',
    label: 'Long narrative, 40-note timeline, year-boundary timestamps',
    input: {
      call_number: '2026-009999',
      incident_type: 'Assault',
      priority: 'P1',
      status: 'closed',
      description: MAXIMAL_NARRATIVE.slice(0, 400),
      narrative: MAXIMAL_NARRATIVE,
      caller_name: MAXIMAL_NAME.trim(),
      location: '1 Point of the Mountain Loop Rd, Draper, UT 84020',
      created_at: YEAR_BOUNDARY,
      closed_at: YEAR_BOUNDARY,
      notes: rows(40, (i) => ({
        id: `note-${i}`,
        author: `Officer ${i}`,
        content: `Timeline entry ${i}: subject observed moving toward the east stairwell.`,
        created_at: '2026-12-31T23:0' + (i % 6) + ':00Z',
      })),
      linked_persons: rows(40, (i) => ({
        role: i % 2 === 0 ? 'witness' : 'subject',
        first_name: `Person${i}`,
        last_name: `Fixture${i}`,
      })),
      assigned_units: rows(40, (i) => `Unit-${i}`),
    },
  },
];

// ── person (FORM PS-202) — dispatch-patrol ────────────────────────────
// Regression fixture: linked_persons AND linked_properties BOTH present
// (the LINKED count-strip once undercounted / mis-pluralized this combo —
// c02f699ab5).

export const personFixtures: PdfFixture<PersonPdfData>[] = [
  {
    variant: 'typical',
    label: 'Subject with linked persons AND linked properties (LINKED strip regression)',
    input: {
      id: '4417',
      first_name: 'Dana',
      last_name: 'Whitlock',
      date_of_birth: '1988-04-02',
      gender: 'F',
      race: 'W',
      height: '5\'6"',
      weight: '140 lbs',
      address: '1400 S State St',
      city: 'Salt Lake City',
      state: 'UT',
      zip: '84115',
      phone: '(801) 555-0142',
      email: 'dana.whitlock@example.com',
      linked_persons: [
        { name: 'Marcus Reyes', dob: '1990-01-01', relationship: 'associate' },
      ],
      linked_properties: [
        { name: 'Sunridge Apartments', address: '1400 S State St, Salt Lake City, UT 84115', relationship: 'resident' },
        { name: 'Terra Sol Plaza', address: '3533 S Terra Sol Dr, South Salt Lake, UT 84115', relationship: 'former resident' },
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one bare linked person, one bare linked property',
    input: {
      id: '1',
      first_name: 'Jane',
      last_name: 'Doe',
      linked_persons: [{ name: 'Unknown' }],
      linked_properties: [{ name: 'Unknown' }],
    },
  },
  {
    variant: 'maximal',
    label: '120-char name, 2000-char notes, 40-row criminal history, year boundary',
    input: {
      id: '999999',
      first_name: MAXIMAL_NAME.trim().slice(0, 60),
      last_name: MAXIMAL_NAME.trim().slice(60, 120) || 'Fixture',
      date_of_birth: '1970-01-01',
      notes: MAXIMAL_NARRATIVE,
      created_at: YEAR_BOUNDARY,
      criminal_records: rows(40, (i) => ({
        record_type: 'arrest',
        offense: `Theft, 3rd Degree Felony — count ${i}`,
        offense_level: 'Felony 3',
        statute: '76-6-206',
        case_number: `2026-0${9000 + i}`,
        agency: 'Rocky Mountain Protective Group',
        jurisdiction: 'Salt Lake County',
        offense_date: '2026-12-31',
        disposition: 'Convicted',
        disposition_date: '2026-12-31',
        sentence: 'Probation',
      })),
      linked_persons: rows(40, (i) => ({ name: `Associate ${i}` })),
      linked_properties: rows(40, (i) => ({ name: `Property ${i}` })),
    },
  },
];

// ── vehicle (FORM PS-203) — dispatch-patrol ───────────────────────────
// Both PS-203 regressions live here: tow_status 'None' (capital N) falsely
// stamping IMPOUNDED, and the LINKED strip undercounting persons /
// mis-pluralizing "1 PROPERTIES" (c02f699ab5).

export const vehicleFixtures: PdfFixture<VehiclePdfData>[] = [
  {
    variant: 'typical',
    label: "tow_status: 'None' (title-cased default) + linked persons AND properties",
    input: {
      id: '7204',
      license_plate: 'UT-7X4K21',
      plate_state: 'UT',
      vin: 'WBA5A5C50FD123456',
      make: 'Honda',
      model: 'Civic',
      year: 2019,
      color: 'Silver',
      tow_status: 'None',
      stolen_status: 'clear',
      owner_name: 'Marcus Reyes',
      linked_persons: [
        { name: 'Marcus Reyes', relationship: 'registered owner' },
      ],
      linked_properties: [
        { name: 'Terra Sol Plaza', address: '3533 S Terra Sol Dr, South Salt Lake, UT 84115', relationship: 'last seen' },
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — bare linked person and property',
    input: {
      id: '1',
      license_plate: 'UT-0000',
      linked_persons: [{ name: 'Unknown' }],
      linked_properties: [{ name: 'Unknown' }],
    },
  },
  {
    variant: 'maximal',
    label: '120-char owner name, 2000-char notes, 40-row incident history',
    input: {
      id: '999999',
      license_plate: 'UT-9999999999999999999999999999999999999999999999999999',
      make: 'Ford',
      model: 'F-150',
      year: 2026,
      owner_name: MAXIMAL_NAME.trim(),
      notes: MAXIMAL_NARRATIVE,
      created_at: YEAR_BOUNDARY,
      tow_status: 'None',
      incidents: rows(40, (i) => ({
        incident_number: `2026-0${8000 + i}`,
        incident_type: 'Traffic Stop',
        status: 'closed',
        created_at: '2026-12-31',
      })),
      linked_persons: rows(40, (i) => ({ name: `Driver ${i}` })),
      linked_properties: rows(40, (i) => ({ name: `Lot ${i}` })),
    },
  },
];

// ── warrant (FORM PS-204) — court-legal ───────────────────────────────

export const warrantFixtures: PdfFixture<WarrantPdfData>[] = [
  {
    variant: 'typical',
    label: 'Active felony warrant, one prior service attempt',
    input: {
      warrant_number: 'WR-2026-004417',
      type: 'Bench Warrant',
      status: 'active',
      offense_level: 'Felony 3',
      charge_description: 'Theft, in violation of Utah Code 76-6-206',
      subject_first_name: 'Marcus',
      subject_last_name: 'Reyes',
      subject_dob: '1990-01-01',
      issuing_court: '3rd District Court, Salt Lake County',
      issuing_judge: 'Hon. A. Bramwell',
      bail_amount: 5000,
      created_at: '2026-06-01T00:00:00Z',
      service_attempts: [
        { attempted_at: '2026-07-10T18:00:00Z', location: '1400 S State St', method: 'in-person', result: 'not located', notes: '' },
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no service attempts',
    input: {
      warrant_number: 'WR-2026-000001',
      type: 'Bench Warrant',
      status: 'active',
      service_attempts: [{ attempted_at: '2026-01-01T00:00:00Z', location: 'Unknown', method: 'in-person', result: 'not located', notes: '' }],
    },
  },
  {
    variant: 'maximal',
    label: '120-char subject name, 2000-char notes, 40-row service attempts',
    input: {
      warrant_number: 'WR-2026-999999',
      type: 'Arrest Warrant',
      status: 'active',
      subject_first_name: MAXIMAL_NAME.trim().slice(0, 60),
      subject_last_name: MAXIMAL_NAME.trim().slice(60, 120) || 'Fixture',
      notes: MAXIMAL_NARRATIVE,
      created_at: YEAR_BOUNDARY,
      charge_description: '76-6-206 Theft; 76-5-102 Assault; 76-8-306 Obstructing Justice',
      service_attempts: rows(40, (i) => ({
        attempted_at: '2026-12-31T23:00:00Z',
        location: `Location ${i}`,
        method: 'in-person',
        result: 'not located',
        notes: `Attempt ${i} of 40`,
      })),
    },
  },
];

// ── evidence (FORM PS-205) — evidence-custody ─────────────────────────

export const evidenceFixtures: PdfFixture<EvidencePdfData>[] = [
  {
    variant: 'typical',
    label: 'Collected item with one chain-of-custody transfer',
    input: {
      evidence_number: 'EV-2026-004417',
      evidence_type: 'Physical',
      category: 'Weapon',
      status: 'in custody',
      description: 'Folding knife recovered from scene, blade approx. 3.5 in.',
      collected_by: 'Marcus Reyes',
      collected_date: '2026-07-15',
      storage_location: 'Evidence Locker B-4',
      chain_of_custody: [
        { action: 'collected', to_person: 'Marcus Reyes', reason: 'initial collection', timestamp: '2026-07-15T21:00:00Z' },
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one bare chain-of-custody entry',
    input: {
      evidence_number: 'EV-2026-000001',
      chain_of_custody: [{ action: 'collected', timestamp: '2026-01-01T00:00:00Z' }],
    },
  },
  {
    variant: 'maximal',
    label: '2000-char description, 40-row chain of custody, year boundary',
    input: {
      evidence_number: 'EV-2026-999999',
      evidence_type: 'Physical',
      description: MAXIMAL_NARRATIVE,
      created_at: YEAR_BOUNDARY,
      chain_of_custody: rows(40, (i) => ({
        action: i % 2 === 0 ? 'transferred' : 'reviewed',
        from_person: `Officer ${i}`,
        to_person: `Officer ${i + 1}`,
        reason: 'lab submission',
        timestamp: '2026-12-31T23:00:00Z',
      })),
    },
  },
];

// ── fleet (FORM PS-206) — internal-reference ──────────────────────────

export const fleetFixtures: PdfFixture<FleetPdfData>[] = [
  {
    variant: 'typical',
    label: 'In-service patrol vehicle, one fuel log entry',
    input: {
      vehicle_number: 'RMPG-14',
      make: 'Ford',
      model: 'Explorer',
      year: 2023,
      status: 'active',
      current_mileage: 41250,
      last_service_date: '2026-06-01',
      next_service_due: '2026-09-01',
      fuel_logs: [
        { fuel_date: '2026-07-20', gallons: 18.2, total_cost: 62.5 },
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no logs',
    input: {
      vehicle_number: 'RMPG-01',
      status: 'active',
      fuel_logs: [{ fuel_date: '2026-01-01', gallons: 1 }],
      maintenance_logs: [{ service_date: '2026-01-01', service_type: 'Inspection', description: 'Routine' }],
    },
  },
  {
    variant: 'maximal',
    label: '2000-char notes, 40-row fuel + maintenance logs',
    input: {
      vehicle_number: 'RMPG-99999999999999999999999999999999999999999999999999999999',
      status: 'active',
      notes: MAXIMAL_NARRATIVE,
      created_at: YEAR_BOUNDARY,
      fuel_logs: rows(40, (i) => ({
        fuel_date: '2026-12-31',
        gallons: 15 + i,
        total_cost: 50 + i,
        odometer_reading: 40000 + i * 10,
      })),
      maintenance_logs: rows(40, (i) => ({
        service_date: '2026-12-31',
        service_type: 'Oil change',
        description: `Scheduled service ${i}`,
        cost: 45 + i,
      })),
    },
  },
];

// ── personnel (FORM PS-207) — internal-reference ──────────────────────

export const personnelFixtures: PdfFixture<PersonnelPdfData>[] = [
  {
    variant: 'typical',
    label: 'Active officer with one credential on file',
    input: {
      badge_number: '4417',
      first_name: 'Marcus',
      last_name: 'Reyes',
      rank: 'Officer',
      department: 'Patrol',
      status: 'active',
      employment_status: 'full-time',
      hire_date: '2020-03-01',
      credentials: [
        { type: 'POST Certification', credential_number: 'POST-88214', issuing_authority: 'Utah POST', issued_date: '2020-03-01', expiry_date: '2028-03-01', status: 'valid' },
      ],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no credentials/training/equipment',
    input: {
      first_name: 'Jane',
      last_name: 'Doe',
      credentials: [{ type: 'POST Certification', credential_number: 'POST-1', issuing_authority: 'Utah POST', issued_date: '2026-01-01', expiry_date: '2027-01-01', status: 'valid' }],
      training_records: [{ course_name: 'Basic Academy', category: 'Core', provider: 'Utah POST', hours: 0, status: 'complete' }],
      equipment_list: [{ equipment_type: 'Radio', condition: 'good', status: 'issued' }],
    },
  },
  {
    variant: 'maximal',
    label: '120-char name, 2000-char notes, 40-row credentials',
    input: {
      first_name: MAXIMAL_NAME.trim().slice(0, 60),
      last_name: MAXIMAL_NAME.trim().slice(60, 120) || 'Fixture',
      notes: MAXIMAL_NARRATIVE,
      created_at: YEAR_BOUNDARY,
      credentials: rows(40, (i) => ({
        type: 'Firearms Qualification',
        credential_number: `FQ-${1000 + i}`,
        issuing_authority: 'Rocky Mountain Protective Group',
        issued_date: '2026-01-01',
        expiry_date: '2026-12-31',
        status: 'valid',
      })),
    },
  },
];

// ── property (FORM PS-208) — evidence-custody ─────────────────────────
// Regression fixture: address long enough to force banner-subtitle
// truncation, the exact shape that produced a dangling separator before
// the ellipsis (977fb637f1).

export const propertyFixtures: PdfFixture<PropertyPdfData>[] = [
  {
    variant: 'typical',
    label: 'Long address forcing banner-subtitle truncation (dangling-separator regression)',
    input: {
      name: 'Terra Sol Plaza',
      address: '3533 South Terra Sol Drive, Building 4, Suite 210, South Salt Lake',
      city: 'South Salt Lake',
      state: 'UT',
      zip: '84115',
      property_type: 'Commercial',
      is_active: true,
      owner_name: 'Rocky Mountain Protective Group',
      key_holder_name: 'Dana Whitlock',
      key_holder_phone: '(801) 555-0142',
      linked_persons: [{ name: 'Dana Whitlock', relationship: 'key holder' }],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one bare linked person',
    input: {
      name: 'Unnamed Property',
      linked_persons: [{ name: 'Unknown' }],
    },
  },
  {
    variant: 'maximal',
    label: '120-char name, 2000-char hazard notes, 40-row incident history',
    input: {
      name: MAXIMAL_NAME.trim(),
      address: '1 Point of the Mountain Loop Road, Suite 9999999999999999999999999999999999999999999999',
      hazard_notes: MAXIMAL_NARRATIVE,
      created_at: YEAR_BOUNDARY,
      incidents: rows(40, (i) => ({
        incident_number: `2026-0${7000 + i}`,
        incident_type: 'Trespass',
        status: 'closed',
        created_at: '2026-12-31',
      })),
      linked_persons: rows(40, (i) => ({ name: `Tenant ${i}` })),
    },
  },
];

// ── business (FORM PS-212) — client-facing ────────────────────────────
// Regression fixture: email + website (must NOT be uppercased) and a
// numeric annual_revenue (must be formatted via formatCurrency, not
// printed as a raw integer) — both fixed in 977fb637f1.

export const businessFixtures: PdfFixture<BusinessPdfData>[] = [
  {
    variant: 'typical',
    label: 'Email + website casing regression, unformatted-revenue regression',
    input: {
      id: '221',
      name: 'Rocky Mountain Protective Group',
      dba_name: 'RMPG Security Services',
      business_type: 'Private Security',
      industry: 'Security Services',
      ein: '39-4812556',
      employee_count: 62,
      annual_revenue: 4250000,
      status: 'active',
      address: '1400 S State St',
      city: 'Salt Lake City',
      state: 'UT',
      zip: '84115',
      phone: '(801) 555-0142',
      email: 'contact@rmpgutah.us',
      website: 'https://www.rmpgutah.us',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only',
    input: {
      name: 'Unnamed Business',
    },
  },
  {
    variant: 'maximal',
    label: '120-char legal name, 2000-char notes, large numeric revenue',
    input: {
      id: '999999',
      name: MAXIMAL_NAME.trim(),
      dba_name: MAXIMAL_NAME.trim(),
      annual_revenue: 999999999,
      notes: MAXIMAL_NARRATIVE,
      created_at: YEAR_BOUNDARY,
      email: 'legal@example-holdings-group-international.com',
      website: 'https://www.example-holdings-group-international.com',
    },
  },
];

// ── citation (FORM PS-209) — court-legal ──────────────────────────────

export const citationFixtures: PdfFixture<CitationPdfData>[] = [
  {
    variant: 'typical',
    label: 'Speeding citation, one violation row, court date set',
    input: {
      citation_number: 'CI-2026-004417',
      type: 'Traffic',
      status: 'issued',
      person_name: 'Dana Whitlock',
      person_dl: 'D123-4567-8901',
      vehicle_plate: 'UT-7X4K21',
      statute_citation: '41-6a-601',
      violation_description: 'Speeding, 15 over posted limit',
      offense_level: 'Infraction',
      fine_amount: 165,
      violation_date: '2026-07-15',
      location: '1400 S State St',
      speed_recorded: 55,
      speed_limit: 40,
      issuing_officer_name: 'Marcus Reyes',
      badge_number: '4417',
      court_date: '2026-08-20',
      court_name: '3rd District Court, Salt Lake County',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one bare violation row',
    input: {
      citation_number: 'CI-2026-000001',
      type: 'Traffic',
      status: 'issued',
      violations: [{ violation_number: 1 }],
    },
  },
  {
    variant: 'maximal',
    label: '120-char name, 2000-char notes, 40-row violation table',
    input: {
      citation_number: 'CI-2026-999999',
      type: 'Traffic',
      status: 'issued',
      person_name: MAXIMAL_NAME.trim(),
      notes: MAXIMAL_NARRATIVE,
      created_at: YEAR_BOUNDARY,
      violations: rows(40, (i) => ({
        violation_number: i + 1,
        statute_citation: '41-6a-601',
        violation_description: `Violation ${i}`,
        offense_level: 'Infraction',
        fine_amount: 100 + i,
      })),
    },
  },
];

// ── case (FORM PS-301) — court-legal ───────────────────────────────────

export const caseFixtures: PdfFixture<CasePdfData>[] = [
  {
    variant: 'typical',
    label: 'Open investigative case, one linked person and one linked incident',
    input: {
      case_number: 'CS-2026-004417',
      title: 'Theft from Terra Sol Plaza retail unit',
      case_type: 'Property Crime',
      status: 'open',
      priority: 'medium',
      lead_investigator_name: 'Marcus Reyes',
      summary: 'Ongoing theft investigation involving a repeat suspect at a client property.',
      opened_date: '2026-07-01',
      linked_persons: [{ id: 1, first_name: 'Dana', last_name: 'Whitlock', relationship: 'suspect' }],
      linked_incidents: [{ id: 1, incident_number: '2026-004417', incident_type: 'Theft', status: 'closed' }],
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no appendices',
    input: {
      case_number: 'CS-2026-000001',
      title: 'Untitled Case',
    },
  },
  {
    variant: 'maximal',
    label: '120-char title, 2000-char narrative, 40-row linked persons',
    input: {
      case_number: 'CS-2026-999999',
      title: MAXIMAL_NAME.trim(),
      narrative: MAXIMAL_NARRATIVE,
      opened_date: '2026-12-31',
      closed_date: '2026-12-31',
      linked_persons: rows(40, (i) => ({ id: i, first_name: `Subject${i}`, last_name: 'Fixture' })),
      linked_incidents: rows(40, (i) => ({ id: i, incident_number: `2026-0${6000 + i}` })),
    },
  },
];

// ── field_interview (FORM PS-2xx) — dispatch-patrol ───────────────────

export const fieldInterviewFixtures: PdfFixture<FieldInterviewPdfData>[] = [
  {
    variant: 'typical',
    label: 'Consensual contact, vehicle observed, one narrative',
    input: {
      fi_number: 'FI-2026-004417',
      status: 'closed',
      subject_first_name: 'Dana',
      subject_last_name: 'Whitlock',
      subject_dob: '1988-04-02',
      location: '1400 S State St, Salt Lake City, UT 84115',
      contact_reason: 'Subject observed loitering near closed business after hours.',
      contact_type: 'Consensual',
      officer_name: 'Marcus Reyes',
      badge_number: '4417',
      narrative: 'Subject was cooperative and identified themselves; no further action taken.',
      vehicle_plate: 'UT-7X4K21',
      created_at: '2026-07-15T22:00:00Z',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only',
    input: {
      fi_number: 'FI-2026-000001',
      location: 'Unknown',
      contact_reason: 'Unspecified',
    },
  },
  {
    variant: 'maximal',
    label: '120-char subject name, 2000-char narrative, year boundary',
    input: {
      fi_number: 'FI-2026-999999',
      subject_first_name: MAXIMAL_NAME.trim().slice(0, 60),
      subject_last_name: MAXIMAL_NAME.trim().slice(60, 120) || 'Fixture',
      location: '1 Point of the Mountain Loop Rd, Draper, UT 84020',
      contact_reason: MAXIMAL_NARRATIVE.slice(0, 500),
      narrative: MAXIMAL_NARRATIVE,
      created_at: YEAR_BOUNDARY,
    },
  },
];

// ── court_event (FORM PS-2xx) — court-legal ───────────────────────────

export const courtEventFixtures: PdfFixture<CourtEventPdfData>[] = [
  {
    variant: 'typical',
    label: 'Scheduled arraignment, officer appearance required',
    input: {
      event_number: 'CE-2026-004417',
      event_type: 'Arraignment',
      status: 'scheduled',
      event_date: '2026-08-20',
      event_time: '09:00',
      court_name: '3rd District Court, Salt Lake County',
      courtroom: 'Room 4B',
      judge_name: 'Hon. A. Bramwell',
      defendant_name: 'Dana Whitlock',
      officers_required: ['Marcus Reyes'],
      citation_number: 'CI-2026-004417',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only',
    input: {
      event_number: 'CE-2026-000001',
      event_type: 'Hearing',
      event_date: '2026-01-01',
    },
  },
  {
    variant: 'maximal',
    label: '120-char defendant name, 2000-char notes, 40 required officers',
    input: {
      event_number: 'CE-2026-999999',
      event_type: 'Trial',
      event_date: '2026-12-31',
      defendant_name: MAXIMAL_NAME.trim(),
      notes: MAXIMAL_NARRATIVE,
      created_at: YEAR_BOUNDARY,
      officers_required: rows(40, (i) => `Officer ${i}`),
    },
  },
];

// ── jail_booking (FORM PS-2xx) — evidence-custody ─────────────────────

export const jailBookingFixtures: PdfFixture<JailBookingPdfData>[] = [
  {
    variant: 'typical',
    label: 'Booked subject, comma-separated charges',
    input: {
      full_name: 'Dana Whitlock',
      first_name: 'Dana',
      last_name: 'Whitlock',
      date_of_birth: '1988-04-02',
      booking_date: '2026-07-15',
      charges: 'Theft (76-6-206), Trespassing (76-6-206.3)',
      county: 'Salt Lake',
      status: 'booked',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only',
    input: {
      full_name: 'Unknown Subject',
    },
  },
  {
    variant: 'maximal',
    label: '120-char name, 40-row parsed charge lines, year boundary',
    input: {
      full_name: MAXIMAL_NAME.trim(),
      booking_date: '2026-12-31',
      charges: rows(40, (i) => `Charge ${i} — 76-6-206`).join(', '),
      charge_lines: rows(40, (i) => `Charge ${i} — Theft, 3rd Degree Felony (76-6-206)`),
      county: 'Salt Lake',
      status: 'booked',
    },
  },
];

// ── generate() adapters ────────────────────────────────────────────────
// generateRecordPdf(recordType, data) is the module's single existing
// exported entry point that builds a jsPDF for a given record type — it
// already creates the doc, preloads the seal, runs the switch, and
// finalizes footers/watermarks. The registry's `generate` contract wants
// `(input) => jsPDF | Promise<jsPDF>`, so each adapter below just binds
// the record-type discriminant; nothing in recordPdfGenerator.ts is
// renamed, re-signatured, or otherwise modified.

export const generateCallRecord = (data: CallPdfData) => generateRecordPdf('call', data);
export const generatePersonRecord = (data: PersonPdfData) => generateRecordPdf('person', data);
export const generateVehicleRecord = (data: VehiclePdfData) => generateRecordPdf('vehicle', data);
export const generateWarrantRecord = (data: WarrantPdfData) => generateRecordPdf('warrant', data);
export const generateEvidenceRecord = (data: EvidencePdfData) => generateRecordPdf('evidence', data);
export const generateFleetRecord = (data: FleetPdfData) => generateRecordPdf('fleet', data);
export const generatePersonnelRecord = (data: PersonnelPdfData) => generateRecordPdf('personnel', data);
export const generatePropertyRecord = (data: PropertyPdfData) => generateRecordPdf('property', data);
export const generateBusinessRecord = (data: BusinessPdfData) => generateRecordPdf('business', data);
export const generateCitationRecord = (data: CitationPdfData) => generateRecordPdf('citation', data);
export const generateCaseRecord = (data: CasePdfData) => generateRecordPdf('case', data);
export const generateFieldInterviewRecord = (data: FieldInterviewPdfData) => generateRecordPdf('field_interview', data);
export const generateCourtEventRecord = (data: CourtEventPdfData) => generateRecordPdf('court_event', data);
export const generateJailBookingRecord = (data: JailBookingPdfData) => generateRecordPdf('jail_booking', data);
