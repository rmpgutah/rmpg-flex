import type { OfficerEquipment } from '../../../types';
import type { EquipmentPdfInput, CheckoutLogEntry } from '../../../utils/equipmentCustodyPdf';
import type { EvidencePdfInput, EvidenceItem, ChainOfCustodyEntry as EvidenceChainEntry } from '../../../utils/evidenceItemPdf';
import type {
  BodycamVideoPdfInput,
  BodycamVideoForPdf,
  BodycamCustodyEntry,
} from '../../../utils/bodycamVideoCustodyPdf';
import type {
  ForensicCasePdfInput,
  ForensicCaseForPdf,
  ForensicExhibitForPdf,
  ForensicAnalysisForPdf,
  ChainOfCustodyEntry as ForensicChainEntry,
} from '../../../utils/forensicCasePdf';
import type {
  JailBookingSheetInput,
  InmatePdfRecord,
  InmateChargeRow,
  JailRosterSnapshotInput,
} from '../../../utils/jailBookingSheetPdf';
import type { PdfFixture } from '../types';

// Synthetic data only. No real person, address, plate, case, or evidence
// number from live records may appear here — organization policy.
// Narrative text uses REAL evidence/custody boilerplate (not lorem ipsum)
// so genuine phrase collisions with the placeholder-leak detector surface
// here rather than during a live migration.

const LONG_NAME =
  'Bartholomew Maximilian Fitzgerald-Whitlock, III, of the Wasatch Front Region, hereinafter Subject';
const MAXIMAL_NAME = LONG_NAME.padEnd(120, ' ').slice(0, 120);

const BOILERPLATE_SENTENCE =
  'Chain of custody maintained without interruption; item sealed by order of the court and released ' +
  'to the custody of the receiving party under penalty of perjury, State of Utah, County of Salt ' +
  'Lake, and this record is null and void if the seal is broken without authorization. ';
const MAXIMAL_NARRATIVE = BOILERPLATE_SENTENCE.repeat(
  Math.ceil(2000 / BOILERPLATE_SENTENCE.length),
).slice(0, 2000);

// ── Equipment Custody ───────────────────────────────────────

function checkoutLogEntry(i: number): CheckoutLogEntry {
  return {
    id: `col_${i}`,
    equipment_id: 601,
    officer_id: 42,
    officer_name: 'Marcus Reyes',
    action: i % 2 === 0 ? 'checkout' : 'checkin',
    checkout_date: `2026-${String((i % 12) + 1).padStart(2, '0')}-01T08:00:00Z`,
    performed_by: 'Sgt. Marcus Reyes',
    checked_by_name: 'Sgt. Marcus Reyes',
    notes: 'Released to the custody of the assigned officer under standard issue procedure.',
  };
}

const typicalEquipment: OfficerEquipment = {
  id: 'eq-601',
  officer_id: '42',
  officer_name: 'Marcus Reyes',
  equipment_type: 'body_camera',
  make: 'Axon',
  model: 'Body 3',
  serial_number: 'AX-2026-004417',
  asset_tag: 'RMPG-4417',
  condition: 'good',
  status: 'issued',
  issued_date: '2026-03-14',
  notes: 'Issued at start of shift; chain of custody maintained without interruption.',
  created_by: 'Sgt. Marcus Reyes',
  created_at: '2026-03-14T15:30:00Z',
  updated_at: '2026-03-14T15:30:00Z',
};

export const equipmentCustodyFixtures: PdfFixture<EquipmentPdfInput>[] = [
  {
    variant: 'typical',
    label: 'Issued body camera with checkout history',
    input: {
      item: typicalEquipment,
      checkoutLog: [checkoutLogEntry(0), checkoutLogEntry(1)],
      preparedBy: 'Sgt. Marcus Reyes',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no checkout history',
    input: {
      item: {
        id: 'eq-602',
        officer_id: '42',
        equipment_type: 'radio',
        condition: 'new',
        status: 'issued',
        created_at: '2026-03-14T15:30:00Z',
        updated_at: '2026-03-14T15:30:00Z',
      },
      checkoutLog: [],
    },
  },
  {
    variant: 'maximal',
    label: 'Long officer name, long notes, 40-row checkout log, year-boundary date',
    input: {
      item: {
        id: 'eq-603',
        officer_id: '42',
        officer_name: MAXIMAL_NAME,
        equipment_type: 'firearm',
        make: 'Glock',
        model: '17 Gen5',
        serial_number: 'GL-2026-004417-XX',
        asset_tag: 'RMPG-4417-MAX',
        condition: 'fair',
        status: 'issued',
        issued_date: '2026-12-31',
        notes: MAXIMAL_NARRATIVE,
        created_by: 'Sergeant Marcus Alexander Reyes, Badge 4417',
        created_at: '2026-12-31T23:59:00Z',
        updated_at: '2026-12-31T23:59:00Z',
      },
      checkoutLog: Array.from({ length: 40 }, (_, i) => checkoutLogEntry(i)),
      preparedBy: 'Sergeant Marcus Alexander Reyes, Badge 4417',
    },
  },
];

// ── Evidence Item ───────────────────────────────────────────

function evidenceChainEntry(i: number): EvidenceChainEntry {
  return {
    action: i % 2 === 0 ? 'collected' : 'transferred',
    by_name: 'Marcus Reyes',
    at: `2026-${String((i % 12) + 1).padStart(2, '0')}-01T09:00:00Z`,
    to_location: 'Evidence Room, 1400 S State St, Salt Lake City, UT 84115',
    notes: 'Sealed by order of the court; released to the custody of the receiving party.',
  };
}

const typicalEvidenceItem: EvidenceItem = {
  id: 801,
  evidence_number: 'E-2026-0417',
  description: 'Folding knife, black handle, recovered from front passenger seat.',
  evidence_type: 'weapon',
  category: 'physical',
  status: 'in_custody',
  storage_location: 'Evidence Room, Shelf B-14',
  serial_number: 'N/A',
  brand: 'Buck',
  model: '110',
  estimated_value: 45,
  collected_date: '2026-03-14T12:00:00Z',
  collected_by_name: 'Marcus Reyes',
  incident_number: '2026-004417',
  case_number: '2026-004417',
  disposition: 'pending',
  notes: 'Chain of custody maintained without interruption since collection.',
  chain_of_custody: [evidenceChainEntry(0), evidenceChainEntry(1)],
};

export const evidenceItemFixtures: PdfFixture<EvidencePdfInput>[] = [
  {
    variant: 'typical',
    label: 'In-custody weapon with chain of custody',
    input: {
      item: typicalEvidenceItem,
      preparedBy: 'Sgt. Marcus Reyes',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no chain of custody',
    input: {
      item: {},
    },
  },
  {
    variant: 'maximal',
    label: 'Long description, 40-entry chain of custody, year-boundary date',
    input: {
      item: {
        id: 803,
        evidence_number: 'E-2026-0419',
        description: MAXIMAL_NARRATIVE,
        evidence_type: 'weapon',
        category: 'physical',
        status: 'in_custody',
        storage_location:
          'Evidence Room, Building C, Suite 2200, Shelf B-14, 1400 South State Street, Salt Lake City, Utah 84115-2847',
        serial_number: 'N/A',
        brand: 'Buck',
        model: '110',
        estimated_value: 45.5,
        collected_date: '2026-12-31T23:59:00Z',
        collected_by_name: 'Sergeant Marcus Alexander Reyes, Badge 4417',
        incident_number: '2026-004419',
        case_number: '2026-004419',
        disposition: 'released',
        disposition_method: 'released to the custody of the owner under penalty of perjury',
        disposition_date: '2026-12-31T23:59:00Z',
        disposition_notes: MAXIMAL_NARRATIVE,
        notes: MAXIMAL_NARRATIVE,
        chain_of_custody: Array.from({ length: 40 }, (_, i) => evidenceChainEntry(i)),
      },
      preparedBy: 'Sergeant Marcus Alexander Reyes, Badge 4417',
    },
  },
];

// ── Bodycam Video Custody ───────────────────────────────────

function bodycamCustodyEntry(i: number): BodycamCustodyEntry {
  return {
    at: `2026-${String((i % 12) + 1).padStart(2, '0')}-01T09:00:00Z`,
    action: i % 2 === 0 ? 'viewed' : 'exported',
    by_name: 'Marcus Reyes',
    notes: 'Reviewed under standard chain-of-custody procedure; sealed by order of the court.',
  };
}

const typicalBodycamVideo: BodycamVideoForPdf = {
  id: 901,
  title: 'Traffic stop — 1400 S State St',
  case_number: '2026-004417',
  classification: 'evidence',
  retention_status: 'hold',
  recorded_at: '2026-03-14T15:30:00Z',
  duration_seconds: 612,
  file_size: 452_000_000,
  mime_type: 'video/mp4',
  officer_name: 'Marcus Reyes',
  camera_serial: 'AX-2026-004417',
  notes: 'Chain of custody maintained without interruption since capture.',
  interaction_type: 'traffic_stop',
  uploaded_by: 'Sgt. Marcus Reyes',
  created_at: '2026-03-14T15:35:00Z',
};

export const bodycamVideoCustodyFixtures: PdfFixture<BodycamVideoPdfInput>[] = [
  {
    variant: 'typical',
    label: 'Held traffic-stop video with custody log',
    input: {
      video: typicalBodycamVideo,
      custody: [bodycamCustodyEntry(0), bodycamCustodyEntry(1)],
      preparedBy: 'Sgt. Marcus Reyes',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — empty video object, no custody log',
    input: {
      video: {},
    },
  },
  {
    variant: 'maximal',
    label: 'Long notes, 40-row custody log, year-boundary date',
    input: {
      video: {
        id: 903,
        title: 'Use of force incident — Wasatch Plaza Retail Center',
        case_number: '2026-004419',
        classification: 'evidence',
        retention_status: 'hold',
        recorded_at: '2026-12-31T23:59:00Z',
        duration_seconds: 3600,
        file_size: 4_520_000_000,
        mime_type: 'video/mp4',
        officer_name: 'Sergeant Marcus Alexander Reyes, Badge 4417',
        camera_serial: 'AX-2026-004419-XX',
        notes: MAXIMAL_NARRATIVE,
        interaction_type: 'use_of_force',
        uploaded_by: 'Sergeant Marcus Alexander Reyes, Badge 4417',
        created_at: '2026-12-31T23:59:00Z',
      },
      custody: Array.from({ length: 40 }, (_, i) => bodycamCustodyEntry(i)),
      preparedBy: 'Sergeant Marcus Alexander Reyes, Badge 4417',
    },
  },
];

// ── Forensic Case ───────────────────────────────────────────

function forensicChainEntry(i: number): ForensicChainEntry {
  return {
    at: `2026-${String((i % 12) + 1).padStart(2, '0')}-01T09:00:00Z`,
    from: i === 0 ? null : 'Evidence Room, Shelf B-14',
    to: 'Forensic Lab, Wasatch Front Region',
    reason: 'transferred for analysis under order of the court',
    notes: 'Sealed by order of the court; released to the custody of the receiving analyst.',
    by_id: 42,
  };
}

function forensicExhibit(i: number): ForensicExhibitForPdf {
  return {
    id: i,
    exhibit_number: `LX-2026-${String(4417 + i).padStart(6, '0')}`,
    exhibit_type: 'trace_evidence',
    description: `Item ${i + 1}: fiber sample recovered from the scene, sealed by order of the court.`,
    quantity: 1,
    condition_received: 'sealed',
    storage_location: 'Forensic Lab, Wasatch Front Region',
    collected_by: 'Marcus Reyes',
    collected_date: `2026-${String((i % 12) + 1).padStart(2, '0')}-01`,
    hash_sha256: 'a'.repeat(64),
    disposition: 'pending',
    chain_of_custody: [forensicChainEntry(i)],
  };
}

const typicalCase: ForensicCaseForPdf = {
  id: 1001,
  lab_number: 'LX-2026-004417',
  case_number: '2026-004417',
  title: 'Trace evidence analysis — Wasatch Plaza incident',
  case_type: 'trace_evidence',
  status: 'in_progress',
  priority: 'routine',
  description: 'Fiber and residue analysis requested in connection with a burglary investigation.',
  requesting_agency: 'Rocky Mountain Protective Group',
  requesting_officer: 'Sgt. Marcus Reyes',
  lead_examiner_name: 'Dana Whitlock',
  linked_incident_number: '2026-004417',
  received_date: '2026-03-14',
  due_date: '2026-04-14',
  created_at: '2026-03-14T15:30:00Z',
};

export const forensicCaseFixtures: PdfFixture<ForensicCasePdfInput>[] = [
  {
    variant: 'typical',
    label: 'In-progress case with exhibits and analyses',
    input: {
      case: typicalCase,
      exhibits: [forensicExhibit(0), forensicExhibit(1)],
      analyses: [
        {
          id: 1,
          analysis_type: 'fiber_comparison',
          status: 'complete',
          methodology: 'Polarized light microscopy per lab SOP FL-14.',
          analyst_name: 'Dana Whitlock',
          started_at: '2026-03-15T09:00:00Z',
          completed_at: '2026-03-16T17:00:00Z',
          conclusion: 'Consistent with reference sample; findings released to the custody of the court.',
        },
      ],
      preparedBy: 'Dana Whitlock',
      payloadHash: 'b'.repeat(64),
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no exhibits, no analyses',
    input: {
      case: {},
      exhibits: [],
      analyses: [],
    },
  },
  {
    variant: 'maximal',
    label: 'Long title/description, 40-row exhibits, year-boundary date',
    input: {
      case: {
        id: 1003,
        lab_number: 'LX-2026-004419',
        case_number: '2026-004419',
        title: MAXIMAL_NAME,
        case_type: 'trace_evidence',
        status: 'in_progress',
        priority: 'urgent',
        description: MAXIMAL_NARRATIVE,
        findings: MAXIMAL_NARRATIVE,
        conclusion: MAXIMAL_NARRATIVE,
        notes: MAXIMAL_NARRATIVE,
        requesting_agency: 'Rocky Mountain Protective Group',
        requesting_officer: 'Sergeant Marcus Alexander Reyes, Badge 4417',
        lead_examiner_name: 'Dana Marie Whitlock',
        linked_incident_number: '2026-004419',
        linked_case_number: '2026-004419',
        received_date: '2026-12-31',
        due_date: '2027-01-31',
        completed_date: '2026-12-31',
        released_date: '2026-12-31',
        created_at: '2026-12-31T23:59:00Z',
      },
      exhibits: Array.from({ length: 40 }, (_, i) => forensicExhibit(i)),
      analyses: Array.from({ length: 40 }, (_, i) => ({
        id: i,
        analysis_type: 'fiber_comparison',
        status: 'complete',
        methodology: 'Polarized light microscopy per lab SOP FL-14, under penalty of perjury.',
        equipment_used: 'Leica DM2700 P',
        results: `Result ${i + 1}: consistent with reference sample.`,
        conclusion: 'Findings released to the custody of the court, sealed by order of the court.',
        notes: 'Chain of custody maintained without interruption.',
        analyst_name: 'Dana Marie Whitlock',
        started_at: `2026-${String((i % 12) + 1).padStart(2, '0')}-01T09:00:00Z`,
        completed_at: `2026-${String((i % 12) + 1).padStart(2, '0')}-02T17:00:00Z`,
      })) as ForensicAnalysisForPdf[],
      preparedBy: 'Sergeant Marcus Alexander Reyes, Badge 4417',
      payloadHash: 'c'.repeat(64),
    },
  },
];

// ── Jail Booking Sheet ──────────────────────────────────────

function inmateChargeRow(i: number): InmateChargeRow {
  return {
    id: i,
    charge_description: `Charge ${i + 1}: theft, to wit — unlawful taking of property.`,
    statute_code: '76-6-404',
    offense_level: 'misdemeanor',
    warrant_number: `WR-2026-${String(4417 + i).padStart(6, '0')}`,
    bond_amount: 500 + i,
    disposition: 'pending',
    notes: 'Booked under penalty of perjury, State of Utah, County of Salt Lake.',
  };
}

const typicalInmate: InmatePdfRecord = {
  id: 1101,
  booking_number: 'BK-2026-004417',
  last_name: 'Whitlock',
  first_name: 'Dana',
  middle_name: 'Marie',
  dob: '1990-04-12',
  gender: 'F',
  race: 'W',
  height_inches: 66,
  weight_lbs: 145,
  hair_color: 'Brown',
  eye_color: 'Green',
  skin_tone: 'Fair',
  housing_unit: 'A',
  housing_cell: 'A-12',
  status: 'in_custody',
  booking_date: '2026-03-14T15:30:00Z',
  arresting_agency: 'Rocky Mountain Protective Group',
  arresting_officer_name: 'Marcus Reyes',
  bail_amount: 2500,
  bond_type: 'cash',
  notes: 'Booking completed under standard intake procedure.',
};

export const jailBookingSheetFixtures: PdfFixture<JailBookingSheetInput>[] = [
  {
    variant: 'typical',
    label: 'In-custody inmate with charges',
    input: {
      inmate: typicalInmate,
      charges: [inmateChargeRow(0), inmateChargeRow(1)],
      preparedBy: 'Sgt. Marcus Reyes',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — last/first name, no charges',
    input: {
      inmate: {
        last_name: 'Whitlock',
        first_name: 'Dana',
      },
      charges: [],
    },
  },
  {
    variant: 'maximal',
    label: 'Long name, long notes, 40-row charges, year-boundary date',
    input: {
      inmate: {
        id: 1103,
        booking_number: 'BK-2026-004419',
        last_name: 'Whitlock-Fitzgerald',
        first_name: MAXIMAL_NAME,
        middle_name: 'Marie Alexandra',
        dob: '1975-01-01',
        gender: 'F',
        race: 'W',
        height_inches: 66,
        weight_lbs: 145,
        hair_color: 'Brown',
        eye_color: 'Green',
        skin_tone: 'Fair',
        marks_scars_tattoos: MAXIMAL_NARRATIVE,
        housing_unit: 'A',
        housing_cell: 'A-12',
        status: 'in_custody',
        booking_date: '2026-12-31T23:59:00Z',
        arresting_agency: 'Rocky Mountain Protective Group',
        arresting_officer_name: 'Sergeant Marcus Alexander Reyes, Badge 4417',
        bail_amount: 50000.5,
        bond_type: 'surety',
        notes: MAXIMAL_NARRATIVE,
      },
      charges: Array.from({ length: 40 }, (_, i) => inmateChargeRow(i)),
      preparedBy: 'Sergeant Marcus Alexander Reyes, Badge 4417',
    },
  },
];

// ── Jail Roster Snapshot ─────────────────────────────────────

export const jailRosterSnapshotFixtures: PdfFixture<JailRosterSnapshotInput>[] = [
  {
    variant: 'typical',
    label: 'In-custody roster, standard shift handoff',
    input: {
      rows: [typicalInmate, { ...typicalInmate, id: 1102, booking_number: 'BK-2026-004418', last_name: 'Reyes', first_name: 'Marcus' }],
      scope: 'All in-custody inmates',
      preparedBy: 'Sgt. Marcus Reyes',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — empty roster',
    input: {
      rows: [],
    },
  },
  {
    variant: 'maximal',
    label: '40-row roster, long scope text',
    input: {
      rows: Array.from({ length: 40 }, (_, i) => ({
        id: 1200 + i,
        booking_number: `BK-2026-${String(4417 + i).padStart(6, '0')}`,
        last_name: `Subject${i}`,
        first_name: 'Dana',
        housing_unit: 'A',
        housing_cell: `A-${(i % 20) + 1}`,
        status: 'in_custody',
        booking_date: '2026-12-31T23:59:00Z',
      })) as InmatePdfRecord[],
      scope:
        'State of Utah, County of Salt Lake — filtered: status=in_custody, released to the custody ' +
        'of the relief supervisor at shift handoff, chain of custody maintained without interruption.',
      preparedBy: 'Sergeant Marcus Alexander Reyes, Badge 4417',
    },
  },
];
