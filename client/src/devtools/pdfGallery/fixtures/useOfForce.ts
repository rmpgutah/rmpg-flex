import type {
  UofReportPdfInput,
  UofReportForPdf,
  LinkedFootageEntry,
} from '../../../utils/useOfForceReportPdf';
import type {
  IaComplaintPdfInput,
  IaComplaintForPdf,
  IaInvestigationForPdf,
} from '../../../utils/affairsComplaintPdf';
import type { ClearedSummaryInput } from '../../../utils/clearedSummaryPdf';
import type { CallForService } from '../../../types';
import type { DailyActivityReport } from '../../../types';
import type { PdfFixture } from '../types';

// Synthetic data only. No real person, address, plate, case, or evidence
// number from live records may appear here — organization policy.
// Narrative text uses REAL use-of-force / IA boilerplate (not lorem ipsum)
// so genuine phrase collisions with the placeholder-leak detector surface
// here rather than during a live migration.

const LONG_NAME =
  'Bartholomew Maximilian Fitzgerald-Whitlock, III, of the Wasatch Front Region, hereinafter Subject';
const MAXIMAL_NAME = LONG_NAME.padEnd(120, ' ').slice(0, 120);

const BOILERPLATE_SENTENCE =
  'The reasonable officer standard was applied throughout; de-escalation techniques were attempted ' +
  'prior to the use of force, and this account is submitted under penalty of perjury, State of Utah, ' +
  'County of Salt Lake. ';
const MAXIMAL_NARRATIVE = BOILERPLATE_SENTENCE.repeat(
  Math.ceil(2000 / BOILERPLATE_SENTENCE.length),
).slice(0, 2000);

// ── Use of Force Report ──────────────────────────────────────

function linkedFootageEntry(i: number): LinkedFootageEntry {
  return {
    kind: i % 2 === 0 ? 'bwc' : 'dashcam',
    id: `foot-${i}`,
    title: `Clip ${i + 1} — Wasatch Plaza Retail Center`,
    recorded_at: `2026-${String((i % 12) + 1).padStart(2, '0')}-01T09:00:00Z`,
    duration_seconds: 300 + i,
    classification: 'evidence',
    evidence_locked: i % 2 === 0,
    evidence_number: i % 2 === 0 ? `E-2026-${String(4417 + i).padStart(4, '0')}` : null,
  };
}

const typicalUofReport: UofReportForPdf = {
  id: 501,
  incident_id: 2026004417,
  officer_id: 42,
  subject_person_id: 900,
  force_type: 'empty_hand',
  force_level: 'Moderate',
  justification: 'Subject actively resisted handcuffing following a lawful detention for trespass.',
  subject_injuries: 'Minor abrasion to left wrist, treated on scene.',
  officer_injuries: 'None',
  de_escalation_attempted: 1,
  de_escalation_details: 'De-escalation techniques were attempted, including verbal commands and distance, before force was used.',
  weapons_used: 'None',
  body_camera_active: 1,
  witness_officers: '["Marcus Reyes","Dana Whitlock"]',
  narrative: 'Under the reasonable officer standard, force was applied only after de-escalation techniques were attempted and failed.',
  status: 'submitted',
  reviewed_by: 7,
  reviewed_at: '2026-03-16T10:00:00Z',
  review_notes: 'Reviewed — force level consistent with policy and the reasonable officer standard.',
  created_at: '2026-03-14T15:30:00Z',
  updated_at: '2026-03-16T10:00:00Z',
  officer_name: 'Marcus Reyes',
  officer_badge: '4417',
  subject_first_name: 'Dana',
  subject_last_name: 'Whitlock',
  subject_dob: '1990-04-12',
  incident_number: '2026-004417',
  incident_type: 'trespass',
  reviewer_name: 'Sgt. Marcus Reyes',
};

export const useOfForceReportFixtures: PdfFixture<UofReportPdfInput>[] = [
  {
    variant: 'typical',
    label: 'Submitted moderate-force report with linked footage and review',
    input: {
      report: typicalUofReport,
      linkedFootage: [linkedFootageEntry(0), linkedFootageEntry(1)],
      preparedBy: 'Sgt. Marcus Reyes',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no footage, no review',
    input: {
      report: {},
      linkedFootage: [],
    },
  },
  {
    variant: 'maximal',
    label: 'Lethal-force + injuries, long narrative, 40-clip footage log, year-boundary date',
    input: {
      report: {
        id: 503,
        incident_id: 2026004419,
        officer_id: 42,
        subject_person_id: 903,
        force_type: 'firearm',
        force_level: 'Life-Threatening',
        justification: MAXIMAL_NARRATIVE,
        subject_injuries: MAXIMAL_NARRATIVE,
        officer_injuries: MAXIMAL_NARRATIVE,
        de_escalation_attempted: 1,
        de_escalation_details: MAXIMAL_NARRATIVE,
        weapons_used: 'Duty firearm, Glock 17 Gen5',
        body_camera_active: 1,
        witness_officers: '["Marcus Reyes","Dana Whitlock","Alex Kim","Jordan Lee"]',
        narrative: MAXIMAL_NARRATIVE,
        status: 'under_review',
        reviewed_by: 7,
        reviewed_at: '2026-12-31T23:59:00Z',
        review_notes: MAXIMAL_NARRATIVE,
        created_at: '2026-12-31T23:59:00Z',
        updated_at: '2026-12-31T23:59:00Z',
        officer_name: 'Sergeant Marcus Alexander Reyes, Badge 4417',
        officer_badge: '4417',
        subject_first_name: MAXIMAL_NAME,
        subject_last_name: 'Whitlock-Fitzgerald',
        subject_dob: '1975-01-01',
        incident_number: '2026-004419',
        incident_type: 'officer_involved_shooting',
        reviewer_name: 'Sergeant Marcus Alexander Reyes, Badge 4417',
      },
      linkedFootage: Array.from({ length: 40 }, (_, i) => linkedFootageEntry(i)),
      preparedBy: 'Sergeant Marcus Alexander Reyes, Badge 4417',
    },
  },
];

// ── Internal Affairs Complaint ───────────────────────────────

function iaInvestigation(i: number): IaInvestigationForPdf {
  return {
    id: i,
    complaint_id: 601,
    investigator_id: 42,
    investigator_name: 'Marcus Reyes',
    started_at: `2026-${String((i % 12) + 1).padStart(2, '0')}-01T09:00:00Z`,
    completed_at: `2026-${String((i % 12) + 1).padStart(2, '0')}-05T17:00:00Z`,
    summary: 'Interviews conducted with complainant and witness officers per IA protocol.',
    findings: 'Findings pending review under the reasonable officer standard.',
    recommendations: 'Recommend additional training on de-escalation techniques.',
    reviewed_by: 7,
    reviewed_at: `2026-${String((i % 12) + 1).padStart(2, '0')}-06T09:00:00Z`,
    status: 'in_progress',
  };
}

const typicalIaComplaint: IaComplaintForPdf = {
  id: 601,
  complaint_number: 'IA-2026-0034',
  complainant_name: 'Dana Whitlock',
  complainant_contact: '(801) 555-0142',
  subject_officer_id: 42,
  subject_officer_name: 'Marcus Reyes',
  complaint_type: 'excessive_force',
  description: 'Complainant alleges excessive force was used during a trespass detention at 1400 S State St, Salt Lake City, UT 84115.',
  incident_date: '2026-03-14T15:30:00Z',
  incident_location: '1400 S State St, Salt Lake City, UT 84115',
  witnesses: 'Dana Whitlock (complainant), Alex Kim (bystander)',
  evidence_list: 'Body-worn camera footage, dashcam footage, use-of-force report UoF-501',
  status: 'under_investigation',
  assigned_to: 7,
  assigned_to_name: 'Sgt. Marcus Reyes',
  finding: undefined,
  discipline: undefined,
  closed_date: undefined,
  created_by: 8,
  created_at: '2026-03-15T09:00:00Z',
  updated_at: '2026-03-16T10:00:00Z',
};

export const affairsComplaintFixtures: PdfFixture<IaComplaintPdfInput>[] = [
  {
    variant: 'typical',
    label: 'Open excessive-force complaint with one investigation',
    input: {
      complaint: typicalIaComplaint,
      investigations: [iaInvestigation(0)],
      preparedBy: 'Sgt. Marcus Reyes',
      payloadHash: 'd'.repeat(64),
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no investigations, no payload hash',
    input: {
      complaint: {},
      investigations: [],
    },
  },
  {
    variant: 'maximal',
    label: 'Sustained finding + discipline, long description, 40-row investigations, year-boundary date',
    input: {
      complaint: {
        id: 603,
        complaint_number: 'IA-2026-0036',
        complainant_name: MAXIMAL_NAME,
        complainant_contact: '(801) 555-0199',
        subject_officer_id: 42,
        subject_officer_name: 'Sergeant Marcus Alexander Reyes, Badge 4417',
        complaint_type: 'excessive_force',
        description: MAXIMAL_NARRATIVE,
        incident_date: '2026-12-31T23:59:00Z',
        incident_location: '1400 S State St, Salt Lake City, UT 84115',
        witnesses: MAXIMAL_NARRATIVE,
        evidence_list: MAXIMAL_NARRATIVE,
        status: 'closed',
        assigned_to: 7,
        assigned_to_name: 'Sergeant Marcus Alexander Reyes, Badge 4417',
        finding: 'sustained',
        discipline: 'Sustained / not sustained / exonerated / unfounded review concluded — written reprimand and remedial training issued.',
        closed_date: '2026-12-31',
        created_by: 8,
        created_at: '2026-01-01T09:00:00Z',
        updated_at: '2026-12-31T23:59:00Z',
      },
      investigations: Array.from({ length: 40 }, (_, i) => iaInvestigation(i)),
      preparedBy: 'Sergeant Marcus Alexander Reyes, Badge 4417',
      payloadHash: 'e'.repeat(64),
    },
  },
];

// ── Cleared Calls Summary ────────────────────────────────────

function clearedCall(i: number): CallForService & { cleared_at: string } {
  return {
    id: `call-${i}`,
    call_number: `C-2026-${String(4417 + i).padStart(6, '0')}`,
    incident_type: 'trespass' as CallForService['incident_type'],
    priority: 'P2',
    status: 'cleared' as CallForService['status'],
    location: '1400 S State St, Salt Lake City, UT 84115',
    description: 'Trespass complaint, subject warned and released.',
    source: 'phone' as CallForService['source'],
    assigned_units: ['U-1', 'U-2'],
    notes: [],
    disposition: 'warned_and_released',
    created_at: `2026-06-21T0${(i % 9)}:00:00Z`,
    created_by: 'dispatch',
    updated_at: `2026-06-21T1${(i % 9)}:00:00Z`,
    cleared_at: `2026-06-21T1${(i % 9)}:00:00Z`,
  };
}

export const clearedSummaryFixtures: PdfFixture<ClearedSummaryInput>[] = [
  {
    variant: 'typical',
    label: 'Standard shift-end window with two cleared calls',
    input: {
      calls: [clearedCall(0), clearedCall(1)],
      windowStart: new Date('2026-06-21T06:00:00Z'),
      windowEnd: new Date('2026-06-21T18:00:00Z'),
      dispatcherName: 'Marcus Reyes',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no cleared calls in the window',
    input: {
      calls: [],
      windowStart: new Date('2026-06-21T06:00:00Z'),
      windowEnd: new Date('2026-06-21T18:00:00Z'),
    },
  },
  {
    variant: 'maximal',
    label: '40-row cleared-calls table, year-boundary window',
    input: {
      calls: Array.from({ length: 40 }, (_, i) => clearedCall(i)),
      windowStart: new Date('2026-12-31T06:00:00Z'),
      windowEnd: new Date('2026-12-31T23:59:00Z'),
      dispatcherName: 'Sergeant Marcus Alexander Reyes, Badge 4417',
    },
  },
];

// ── Daily Activity Report (builder extraction) ───────────────

function darItem(): string {
  return JSON.stringify([
    { call_number: 'C-2026-004417', incident_type: 'trespass', created_at: '2026-06-21T09:00:00Z' },
  ]);
}

const typicalDar: DailyActivityReport = {
  id: 701,
  dar_number: 'DAR-2026-0044',
  status: 'submitted',
  officer_id: 42,
  officer_name: 'Marcus Reyes',
  shift_date: '2026-06-21',
  shift_start: '06:00',
  shift_end: '18:00',
  property_id: 9,
  property_name: 'Wasatch Plaza Retail Center',
  post_assignment: 'Gate 4',
  calls_handled: darItem(),
  incidents_created: '[]',
  citations_issued: '[]',
  patrols_completed: JSON.stringify([{ checkpoint: 'Gate 4', status: 'ok', scanned_at: '2026-06-21T09:00:00Z' }]),
  activities_narrative: 'De-escalation techniques were attempted throughout the shift; no use-of-force incidents occurred.',
  notable_events: 'Trespass complaint at 1400 S State St, subject warned and released.',
  equipment_issues: undefined,
  safety_concerns: undefined,
  recommendations: undefined,
  reviewed_by: 7,
  reviewed_by_name: 'Sgt. Marcus Reyes',
  reviewed_at: '2026-06-21T19:00:00Z',
  review_notes: 'Reviewed and approved.',
  created_at: '2026-06-21T18:05:00Z',
  updated_at: '2026-06-21T19:00:00Z',
  submitted_at: '2026-06-21T18:05:00Z',
};

export const darFixtures: PdfFixture<DailyActivityReport>[] = [
  {
    variant: 'typical',
    label: 'Submitted, reviewed DAR with one call and one patrol scan',
    input: typicalDar,
  },
  {
    variant: 'empty',
    label: 'Required fields only — empty JSON activity arrays',
    input: {
      id: 702,
      dar_number: 'DAR-2026-0045',
      status: 'draft',
      officer_id: 43,
      shift_date: '2026-06-22',
      calls_handled: '[]',
      incidents_created: '[]',
      citations_issued: '[]',
      patrols_completed: '[]',
      created_at: '2026-06-22T18:05:00Z',
      updated_at: '2026-06-22T18:05:00Z',
    },
  },
  {
    variant: 'maximal',
    label: 'Long narrative fields, 40-row activity tables, year-boundary date',
    input: {
      id: 703,
      dar_number: 'DAR-2026-0046',
      status: 'approved',
      officer_id: 42,
      officer_name: 'Sergeant Marcus Alexander Reyes, Badge 4417',
      shift_date: '2026-12-31',
      shift_start: '06:00',
      shift_end: '18:00',
      property_id: 9,
      property_name: 'Wasatch Plaza Retail Center',
      post_assignment: 'Gate 4',
      calls_handled: JSON.stringify(Array.from({ length: 40 }, (_, i) => ({
        call_number: `C-2026-${String(4417 + i).padStart(6, '0')}`,
        incident_type: 'trespass',
        created_at: '2026-12-31T09:00:00Z',
      }))),
      incidents_created: JSON.stringify(Array.from({ length: 40 }, (_, i) => ({
        incident_number: `2026-${String(4417 + i).padStart(6, '0')}`,
        incident_type: 'trespass',
        created_at: '2026-12-31T09:00:00Z',
      }))),
      citations_issued: JSON.stringify(Array.from({ length: 40 }, (_, i) => ({
        citation_number: `CIT-2026-${String(4417 + i).padStart(6, '0')}`,
        charge: 'Speeding, under penalty of perjury, State of Utah, County of Salt Lake.',
        violation_date: '2026-12-31T09:00:00Z',
      }))),
      patrols_completed: JSON.stringify(Array.from({ length: 40 }, (_, i) => ({
        checkpoint: `Gate ${(i % 8) + 1}`,
        status: 'ok',
        scanned_at: '2026-12-31T09:00:00Z',
      }))),
      activities_narrative: MAXIMAL_NARRATIVE,
      notable_events: MAXIMAL_NARRATIVE,
      equipment_issues: MAXIMAL_NARRATIVE,
      safety_concerns: MAXIMAL_NARRATIVE,
      recommendations: MAXIMAL_NARRATIVE,
      reviewed_by: 7,
      reviewed_by_name: 'Sergeant Marcus Alexander Reyes, Badge 4417',
      reviewed_at: '2026-12-31T23:59:00Z',
      review_notes: MAXIMAL_NARRATIVE,
      created_at: '2026-12-31T23:59:00Z',
      updated_at: '2026-12-31T23:59:00Z',
      submitted_at: '2026-12-31T23:59:00Z',
    },
  },
];
