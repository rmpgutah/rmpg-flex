import type { TrespassOrder } from '../../../types';
import type { CriminalHistoryInput, CriminalHistoryEntry } from '../../../utils/criminalHistoryPdf';
import type { CourtAppearanceInput } from '../../../utils/courtAppearancePdf';
import type { PdfFixture } from '../types';

// Synthetic data only. No real person, address, plate, or case number
// from live records may appear here — organization policy. Narrative
// text uses REAL legal boilerplate (not lorem ipsum) so genuine phrase
// collisions with the placeholder-leak detector (e.g. "null and void")
// surface here rather than during a live migration.

const LONG_NAME =
  'Bartholomew Maximilian Fitzgerald-Whitlock, III, of the Wasatch Front Region, hereinafter Subject';
// 120-char subject name for the maximal variant (trimmed/padded to exactly 120 chars).
const MAXIMAL_SUBJECT_NAME = LONG_NAME.padEnd(120, ' ').slice(0, 120);

const BOILERPLATE_SENTENCE =
  'This order shall remain in full force and effect until lifted by competent authority, and any prior ' +
  'verbal permission granted to the Subject, hereinafter referred to as "Subject," to enter upon the ' +
  'above-described premises is hereby declared null and void. ';
const MAXIMAL_NARRATIVE = BOILERPLATE_SENTENCE.repeat(
  Math.ceil(2000 / BOILERPLATE_SENTENCE.length),
).slice(0, 2000);

// ── Trespass Order ──────────────────────────────────────────

export const trespassOrderFixtures: PdfFixture<TrespassOrder>[] = [
  {
    variant: 'typical',
    label: 'Active order, standard subject',
    input: {
      id: 1001,
      order_number: 'TO-2026-004417',
      subject_first_name: 'Dana',
      subject_last_name: 'Whitlock',
      subject_dob: '1990-04-12',
      location: '1400 S State St, Salt Lake City, UT 84115',
      property_name: 'Wasatch Plaza Retail Center',
      order_type: 'trespass_warning',
      status: 'active',
      reason:
        'Subject was found on the property after hours, on or about March 14, 2026, in violation of ' +
        'posted notice, to wit: the rear loading dock signage.',
      conditions: 'Subject shall not enter or remain upon the premises described above.',
      duration_days: 365,
      effective_date: '2026-03-14',
      expiration_date: '2027-03-14',
      issued_by: 42,
      issued_by_name: 'Marcus Reyes',
      issued_by_display: 'Sgt. Marcus Reyes',
      authorized_by: 'Sgt. Marcus Reyes, Badge 4417',
      notes: 'Subject acknowledged receipt and understanding of the order.',
      created_at: '2026-03-14T15:30:00Z',
      updated_at: '2026-03-14T15:30:00Z',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — every optional absent',
    input: {
      id: 1002,
      order_number: 'TO-2026-004418',
      subject_first_name: 'Dana',
      subject_last_name: 'Whitlock',
      location: '1400 S State St, Salt Lake City, UT 84115',
      order_type: 'trespass_warning',
      status: 'active',
      issued_by: 42,
      created_at: '2026-03-14T15:30:00Z',
      updated_at: '2026-03-14T15:30:00Z',
    },
  },
  {
    variant: 'maximal',
    label: 'Long name, 2000-char narrative, year-boundary date',
    input: {
      id: 1003,
      order_number: 'TO-2026-004419',
      subject_first_name: MAXIMAL_SUBJECT_NAME,
      subject_last_name: 'Whitlock-Fitzgerald',
      subject_dob: '1975-01-01',
      subject_description:
        'State of Utah, County of Salt Lake — subject previously served under a prior order that was ' +
        'declared null and void upon expiration.',
      location:
        '1400 South State Street, Building C, Suite 2200, Salt Lake City, Utah 84115-2847',
      property_name: 'Wasatch Plaza Retail Center — Building C',
      order_type: 'exclusion_order',
      status: 'active',
      reason: MAXIMAL_NARRATIVE,
      conditions: MAXIMAL_NARRATIVE,
      duration_days: 365,
      effective_date: '2026-12-31',
      expiration_date: '2027-12-31',
      issued_by: 42,
      issued_by_name: 'Marcus Alexander Reyes',
      issued_by_display: 'Sergeant Marcus Alexander Reyes, Badge 4417',
      authorized_by: 'Sergeant Marcus Alexander Reyes, Badge 4417, under penalty of perjury',
      notes: MAXIMAL_NARRATIVE,
      created_at: '2026-12-31T23:59:00Z',
      updated_at: '2026-12-31T23:59:00Z',
    },
  },
];

// ── Criminal History ────────────────────────────────────────

function historyEntry(i: number): CriminalHistoryEntry {
  const types: CriminalHistoryEntry['type'][] = [
    'incident', 'citation', 'field_interview', 'warrant', 'trespass',
  ];
  return {
    id: `ch_${i}`,
    type: types[i % types.length],
    date: `2026-${String((i % 12) + 1).padStart(2, '0')}-01`,
    reference_number: `2026-${String(4417 + i).padStart(6, '0')}`,
    description:
      `On or about the date above, the Subject, hereinafter referred to as "Subject," was involved ` +
      `in an event at 1400 S State St, Salt Lake City, UT 84115, to wit: entry ${i + 1}.`,
    status: i % 2 === 0 ? 'closed' : 'open',
    officer_name: 'Marcus Reyes',
    location: '1400 S State St, Salt Lake City, UT 84115',
  };
}

export const criminalHistoryFixtures: PdfFixture<CriminalHistoryInput>[] = [
  {
    variant: 'typical',
    label: 'Subject with mixed history, prepared by an officer',
    input: {
      subject: {
        id: 501,
        first_name: 'Dana',
        last_name: 'Whitlock',
        middle_name: 'Marie',
        date_of_birth: '1990-04-12',
        sex: 'F',
        race: 'W',
        drivers_license: 'W123-4567-8901',
        dl_state: 'UT',
        address: '1400 S State St, Salt Lake City, UT 84115',
        caution_flags: 'None on file',
        has_active_warrants: false,
        is_sex_offender: false,
      },
      history: [historyEntry(0), historyEntry(1), historyEntry(2)],
      preparedBy: 'Sgt. Marcus Reyes',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — empty subject, empty history array',
    input: {
      subject: {},
      history: [],
    },
  },
  {
    variant: 'maximal',
    label: '120-char name, 40-row history table, year-boundary date',
    input: {
      subject: {
        id: 502,
        first_name: MAXIMAL_SUBJECT_NAME,
        last_name: 'Whitlock-Fitzgerald',
        middle_name: 'Marie Alexandra',
        date_of_birth: '1975-01-01',
        sex: 'F',
        race: 'W',
        drivers_license: 'W123-4567-8901',
        dl_state: 'UT',
        address: '1400 South State Street, Building C, Suite 2200, Salt Lake City, Utah 84115-2847',
        caution_flags: 'State of Utah, County of Salt Lake — flagged under penalty of perjury disclosure',
        has_active_warrants: true,
        is_sex_offender: false,
      },
      history: Array.from({ length: 40 }, (_, i) => historyEntry(i)),
      preparedBy: 'Sergeant Marcus Alexander Reyes, Badge 4417',
    },
  },
];

// ── Court Appearance ────────────────────────────────────────

export const courtAppearanceFixtures: PdfFixture<CourtAppearanceInput>[] = [
  {
    variant: 'typical',
    label: 'Scheduled hearing, standard defendant and witnesses',
    input: {
      id: 701,
      event_number: 'CE-2026-004417',
      event_type: 'Preliminary Hearing',
      status: 'scheduled',
      event_date: '2026-09-15',
      event_time: '09:00',
      court_name: 'Third District Court, State of Utah, County of Salt Lake',
      courtroom: 'Courtroom 4B',
      judge_name: 'Hon. Patricia Alvarado',
      court_case_number: '2026-004417',
      defendant_name: 'Marcus Reyes',
      prosecutor: 'ADA Dana Whitlock',
      defense_attorney: 'Jordan Blake, Esq.',
      bail_amount: 2500,
      bond_status: 'posted',
      witnesses: JSON.stringify([
        { name: 'Dana Whitlock', role: 'witness', contact_status: 'confirmed', phone: '801-555-0142' },
      ]),
      court_fees: JSON.stringify([{ label: 'Filing fee', amount: 75 }]),
      continuance_count: 0,
      preparedBy: 'Sgt. Marcus Reyes',
      notes:
        'Subject to appear as ordered; hereinafter referred to as "Defendant." Failure to appear ' +
        'may result in a bench warrant, so help me God.',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — every optional absent',
    input: {
      event_number: 'CE-2026-004418',
      event_type: 'Arraignment',
      event_date: '2026-09-16',
    },
  },
  {
    variant: 'maximal',
    label: 'Long defendant name, long notes, year-boundary date, 40-row continuance log',
    input: {
      id: 703,
      event_number: 'CE-2026-004419',
      event_type: 'Jury Trial',
      status: 'scheduled',
      event_date: '2026-12-31',
      event_time: '23:59',
      court_name: 'Third District Court, State of Utah, County of Salt Lake',
      courtroom: 'Courtroom 4B',
      judge_name: 'Hon. Patricia Alexandra Alvarado-Sandoval',
      court_case_number: '2026-004419',
      defendant_name: MAXIMAL_SUBJECT_NAME,
      prosecutor: { name: 'ADA Dana Whitlock', phone: '801-555-0142', email: 'dwhitlock@example.gov' },
      defense_attorney: 'Jordan Blake, Esq., of the Wasatch Front Region',
      outcome: null,
      sentence: null,
      fine_amount: 12500.5,
      notes: MAXIMAL_NARRATIVE,
      judge_notes: JSON.stringify({ text: MAXIMAL_NARRATIVE.slice(0, 500) }),
      bail_amount: 50000,
      bond_status: 'posted',
      surety_info:
        'State of Utah, County of Salt Lake — surety executed under penalty of perjury; prior bond ' +
        'agreement declared null and void upon reissuance.',
      witnesses: JSON.stringify(
        Array.from({ length: 5 }, (_, i) => ({
          name: `Witness ${i + 1}, Wasatch Front Region`,
          role: i === 0 ? 'victim' : 'witness',
          contact_status: i % 2 === 0 ? 'confirmed' : 'pending',
          phone: '801-555-0100',
          email: `witness${i + 1}@example.gov`,
        })),
      ),
      court_fees: JSON.stringify(
        Array.from({ length: 10 }, (_, i) => ({ label: `Fee item ${i + 1}`, amount: 100 + i })),
      ),
      continuance_log: JSON.stringify(
        Array.from({ length: 40 }, (_, i) => ({
          date: `2026-${String((i % 12) + 1).padStart(2, '0')}-01`,
          reason: `Continuance ${i + 1}: to wit, scheduling conflict on or about the noted date.`,
        })),
      ),
      officers_required: JSON.stringify(['Sgt. Marcus Reyes', 'Ofc. Dana Whitlock']),
      officer_confirmations: JSON.stringify({ 'Sgt. Marcus Reyes': 'confirmed', 'Ofc. Dana Whitlock': 'pending' }),
      continuance_count: 40,
      preparedBy: 'Sergeant Marcus Alexander Reyes, Badge 4417',
    },
  },
];
