import type { ShiftReportInput } from '../../../utils/shiftReportPdf';
import type { ShiftPlanPdfInput } from '../../../utils/shiftPlanPdf';
import type { PlateCapturePdfInput } from '../../../utils/plateCapturePdf';
import type { FieldInterview } from '../../../types';
import type { NoticeOfCommunicationData } from '../../../utils/psoNoticePdfGenerator';
import type { PatrolTrackingReportData } from '../../../utils/patrolTrackingPdfGenerator';
import type { NavBriefingArgs } from '../../../utils/navBriefingPdf';
import type { NavTrip } from '../../../types';
import type { MapSituationReportData } from '../../../utils/mapSituationReportPdf';
import type { DialerRecordPdfInput } from '../../../utils/dialerCallRecordPdf';
import type { ShiftPlan, AreaAssignment } from '../../../hooks/useShiftPlanning';
import type { PdfFixture } from '../types';

// Synthetic data only. No real person, address, plate, case, or evidence
// number from live records may appear here — organization policy.
// Realistic dispatch/patrol phrasing is used deliberately (not lorem ipsum)
// so genuine phrase collisions with the placeholder-leak detector surface
// here rather than during a live migration. US units throughout (miles, mph).

const MAXIMAL_NAME =
  'Bartholomew Maximilian Fitzgerald-Whitlock, III, of the Wasatch Front Region, hereinafter Subject'.padEnd(120, ' ').slice(0, 120);

const BOILERPLATE_SENTENCE =
  'Unit cleared the call after subject was contacted and identified; no further action was required. ' +
  'BOLO issued for the associated vehicle. State of Utah, County of Salt Lake, under penalty of perjury. ';
const MAXIMAL_NARRATIVE = BOILERPLATE_SENTENCE.repeat(Math.ceil(2000 / BOILERPLATE_SENTENCE.length)).slice(0, 2000);

const YEAR_BOUNDARY = '2026-12-31T23:59:00Z';

// ── Shift Report (shiftReportPdf.ts) ─────────────────────────

export const shiftReportFixtures: PdfFixture<ShiftReportInput>[] = [
  {
    variant: 'typical',
    label: 'Standard end-of-shift report with calls, incidents, and patrol scans',
    input: {
      officer: { full_name: 'Marcus Reyes', badge_number: '4417' },
      date: '2026-06-21T18:00:00Z',
      unitCallSign: '4-Adam-12',
      summary: { totalCalls: 2, totalIncidents: 1, totalScans: 3, totalCitations: 1, totalFieldInterviews: 1 },
      calls: [
        {
          call_number: 'C-2026-004417', incident_type: 'trespass', priority: 'P2', status: 'cleared',
          location_address: '1400 S State St, Salt Lake City, UT 84115', created_at: '2026-06-21T09:00:00Z',
        },
        {
          call_number: 'C-2026-004418', incident_type: 'welfare_check', priority: 'P3', status: 'cleared',
          location_address: '1400 S State St, Salt Lake City, UT 84115', created_at: '2026-06-21T11:00:00Z',
        },
      ],
      incidents: [
        { incident_number: '2026-004417', incident_type: 'trespass', status: 'closed', location_address: '1400 S State St, Salt Lake City, UT 84115' },
      ],
      scans: [
        { scanned_at: '2026-06-21T09:15:00Z', checkpoint_name: 'Gate 4' },
        { scanned_at: '2026-06-21T12:15:00Z', checkpoint_name: 'Gate 2' },
        { scanned_at: '2026-06-21T15:15:00Z', checkpoint_name: 'Gate 4' },
      ],
    },
  },
  {
    variant: 'empty',
    label: 'No sections populated — officer name falls back to useAuth value',
    input: {
      officerNameFallback: 'Dana Whitlock',
    },
  },
  {
    variant: 'maximal',
    label: '40-row calls/incidents/scans tables, long location text, year-boundary date',
    input: {
      officer: { full_name: MAXIMAL_NAME, badge_number: '4417' },
      date: YEAR_BOUNDARY,
      unitCallSign: '4-Adam-12',
      summary: { totalCalls: 40, totalIncidents: 40, totalScans: 40, totalCitations: 12, totalFieldInterviews: 8 },
      calls: Array.from({ length: 40 }, (_, i) => ({
        call_number: `C-2026-${String(4417 + i).padStart(6, '0')}`,
        incident_type: 'trespass',
        priority: 'P2',
        status: 'cleared',
        location_address: '1400 S State St, Salt Lake City, UT 84115',
        created_at: YEAR_BOUNDARY,
      })),
      incidents: Array.from({ length: 40 }, (_, i) => ({
        incident_number: `2026-${String(4417 + i).padStart(6, '0')}`,
        incident_type: 'trespass',
        status: 'closed',
        location_address: '1400 S State St, Salt Lake City, UT 84115',
      })),
      scans: Array.from({ length: 40 }, (_, i) => ({
        scanned_at: YEAR_BOUNDARY,
        checkpoint_name: `Gate ${(i % 8) + 1}`,
      })),
    },
  },
];

// ── Shift Plan (shiftPlanPdf.ts) ──────────────────────────────

function minimalAssignment(): AreaAssignment {
  return {
    id: 'a-1',
    layerId: 'beat',
    featureKey: 'SLA/A1',
    label: 'Beat A1',
    properties: {},
    officerIds: [],
    officerNames: [],
    unitIds: [],
    unitCallSigns: [],
  };
}

function assignment(i: number): AreaAssignment {
  return {
    id: `a-${i}`,
    layerId: 'beat',
    featureKey: `SLA/A${i}`,
    label: `Beat A${i}`,
    properties: {},
    officerIds: [String(i)],
    officerNames: ['Marcus Reyes'],
    unitIds: [String(i)],
    unitCallSigns: ['4-Adam-12'],
    shiftStart: '06:00',
    shiftEnd: '14:00',
    notes: 'Extra patrol requested near retail corridor.',
    color: 'var(--sev-warn)',
  };
}

function basePlan(over: Partial<ShiftPlan> = {}): ShiftPlan {
  return {
    id: 'sp-4417',
    name: 'Day Shift — Salt Lake District',
    date: '2026-06-21',
    shiftType: 'day',
    assignments: [assignment(1), assignment(2)],
    status: 'active',
    createdAt: '2026-06-20T18:00:00Z',
    updatedAt: '2026-06-21T05:00:00Z',
    ...over,
  };
}

export const shiftPlanFixtures: PdfFixture<ShiftPlanPdfInput>[] = [
  {
    variant: 'typical',
    label: 'Active day-shift plan with two area assignments and a staffing warning',
    input: {
      plan: basePlan(),
      stats: { assigned: 2, officers: 2, units: 2 },
      notifications: [{ message: 'Beat A2 is understaffed for the current call volume.', severity: 'warning' }],
      conflicts: [{ officer_name: 'Marcus Reyes', shift_count: 2 }],
      preparedBy: 'Sgt. Marcus Reyes',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — one minimal area assignment, no warnings',
    input: {
      plan: basePlan({ assignments: [minimalAssignment()], name: '', status: 'draft' }),
      stats: { assigned: 0, officers: 0, units: 0 },
    },
  },
  {
    variant: 'maximal',
    label: '40 area assignments, long notes, 120-char plan name, year-boundary date',
    input: {
      plan: basePlan({
        name: MAXIMAL_NAME,
        date: '2026-12-31',
        assignments: Array.from({ length: 40 }, (_, i) => assignment(i + 1)),
        updatedAt: YEAR_BOUNDARY,
      }),
      stats: { assigned: 40, officers: 38, units: 40 },
      notifications: Array.from({ length: 10 }, (_, i) => ({
        message: `Beat A${i + 1} is understaffed for the current call volume; consider redeployment.`,
        severity: i % 2 === 0 ? 'critical' : 'warning',
      })),
      conflicts: Array.from({ length: 10 }, (_, i) => ({ officer_name: `Officer ${i + 1}`, shift_count: 2 + (i % 3) })),
      preparedBy: MAXIMAL_NAME,
    },
  },
];

// ── ALPR Plate Capture (plateCapturePdf.ts) ───────────────────

export const plateCaptureFixtures: PdfFixture<PlateCapturePdfInput>[] = [
  {
    variant: 'typical',
    label: 'Confirmed capture with one screening hit and review history',
    input: {
      capture: {
        id: 9001,
        plate: 'UT-7X4K21',
        state: 'UT',
        make: 'Ford',
        model: 'F150',
        color: 'Red',
        year: 2019,
        vehicle_type: 'pickup',
        review_status: 'confirmed',
        accepted: true,
        plate_confidence: 0.94,
        risk_score: 0.1,
        source: 'dashcam',
        device_name: 'Unit 4-Adam-12 Dashcam',
        location_text: '1400 S State St, Salt Lake City, UT 84115',
        lat: 40.7291,
        lng: -111.8879,
        created_at: '2026-06-21T09:00:00Z',
        call_id: 'call-4417',
        trust_score: 0.94,
        trust_basis: 'derived',
        read_count: 3,
      },
      hits: [{ kind: 'watchlist', severity: 'critical', detail: 'Vehicle flagged on internal BOLO list.' }],
      history: [
        { id: 1, action: 'reviewed', details: 'Confirmed by supervisor.', created_at: '2026-06-21T09:10:00Z', user_name: 'Sgt. Marcus Reyes' },
      ],
      preparedBy: 'Sgt. Marcus Reyes',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no hits, no history, unverified banner shows',
    input: {
      capture: {},
    },
  },
  {
    variant: 'maximal',
    label: '40-row review history, multiple screening hits, year-boundary capture',
    input: {
      capture: {
        id: 9002,
        plate: 'UT-7X4K21',
        state: 'UT',
        make: 'Ford',
        model: 'F150',
        color: 'Red',
        year: 2019,
        vehicle_type: 'pickup',
        condition: 'damaged',
        damage_summary: MAXIMAL_NARRATIVE,
        damage_observed: true,
        review_status: 'needs_review',
        accepted: false,
        plate_confidence: 0.61,
        risk_score: 0.87,
        alerted: true,
        source: 'field',
        device_name: 'Unit 4-Adam-12 Field Camera',
        location_text: '1400 S State St, Salt Lake City, UT 84115',
        lat: 40.7291,
        lng: -111.8879,
        created_at: YEAR_BOUNDARY,
        reviewed_at: YEAR_BOUNDARY,
        call_id: 'call-4419',
        incident_id: 'inc-4419',
        trust_score: 0.61,
        trust_basis: 'single read',
        read_count: 1,
      },
      hits: Array.from({ length: 5 }, (_, i) => ({ kind: 'watchlist', severity: 'critical', detail: `Screening hit #${i + 1} — BOLO match.` })),
      history: Array.from({ length: 40 }, (_, i) => ({
        id: i + 1,
        action: i % 2 === 0 ? 'reviewed' : 'flagged',
        details: 'Chain-of-review entry, State of Utah, County of Salt Lake.',
        created_at: YEAR_BOUNDARY,
        user_name: 'Sgt. Marcus Reyes',
      })),
      preparedBy: MAXIMAL_NAME,
    },
  },
];

// ── Field Interview Card (fiCardPdf.ts) ───────────────────────

const baseFi: FieldInterview = {
  id: 501,
  fi_number: 'FI-2026-0044',
  subject_first_name: 'Dana',
  subject_last_name: 'Whitlock',
  subject_dob: '1990-04-12',
  subject_gender: 'F',
  subject_race: 'W',
  subject_height: '5\'6"',
  subject_weight: '140',
  subject_hair: 'Brown',
  subject_eye: 'Blue',
  subject_clothing: 'Blue jacket, jeans',
  location: '1400 S State St, Salt Lake City, UT 84115',
  contact_reason: 'suspicious_activity',
  contact_type: 'field',
  action_taken: 'warned',
  narrative: 'Subject was contacted and identified near the retail corridor; no further action was required.',
  vehicle_plate: 'UT-7X4K21',
  vehicle_description: 'Red 2019 Ford F150',
  officer_id: 42,
  officer_name: 'Marcus Reyes',
  person_flags: JSON.stringify(['ACTIVE_WARRANT']),
  status: 'active',
  created_at: '2026-06-21T09:00:00Z',
};

export const fiCardFixtures: PdfFixture<FieldInterview>[] = [
  {
    variant: 'typical',
    label: 'Active FI with active-warrant banner and vehicle block',
    input: baseFi,
  },
  {
    variant: 'empty',
    label: 'Required fields only — no narrative, no vehicle, no flags',
    input: {
      id: 502,
      fi_number: 'FI-2026-0045',
      location: '1400 S State St, Salt Lake City, UT 84115',
      contact_reason: 'suspicious_activity',
      contact_type: 'field',
      action_taken: 'warned',
      officer_id: 43,
      status: 'active',
      created_at: '2026-06-21T09:00:00Z',
    },
  },
  {
    variant: 'maximal',
    label: '2,000-char narrative, 120-char subject name, year-boundary date',
    input: {
      id: 503,
      fi_number: 'FI-2026-0046',
      subject_first_name: MAXIMAL_NAME,
      subject_last_name: 'Whitlock-Fitzgerald',
      subject_dob: '1975-01-01',
      subject_gender: 'F',
      subject_race: 'W',
      subject_height: '5\'6"',
      subject_weight: '140',
      subject_hair: 'Brown',
      subject_eye: 'Blue',
      subject_clothing: MAXIMAL_NARRATIVE,
      location: '1400 S State St, Salt Lake City, UT 84115',
      contact_reason: 'suspicious_activity',
      contact_type: 'field',
      action_taken: 'warned',
      narrative: MAXIMAL_NARRATIVE,
      vehicle_plate: 'UT-7X4K21',
      vehicle_description: 'Red 2019 Ford F150',
      officer_id: 42,
      officer_name: 'Sergeant Marcus Alexander Reyes, Badge 4417',
      person_flags: JSON.stringify(['ACTIVE_WARRANT']),
      status: 'active',
      created_at: YEAR_BOUNDARY,
    },
  },
];

// ── PSO Notice of Communication (psoNoticePdfGenerator.ts) ────

export const psoNoticeFixtures: PdfFixture<NoticeOfCommunicationData>[] = [
  {
    variant: 'typical',
    label: 'Two attempts, no contact then service completed',
    input: {
      noticeDate: '2026-06-21',
      callNumber: 'C-2026-004417',
      respondentName: 'Dana Whitlock',
      courtCaseNumber: '2026-004417',
      courtName: 'Third District Court',
      clientName: 'Rocky Mountain Protective Group',
      serviceType: 'civil_summons',
      serviceAddress: '1400 S State St, Salt Lake City, UT 84115',
      attempts: [
        { number: 1, date: '2026-06-20', time: '10:00', result: 'no_contact', notes: 'No answer at door.' },
        { number: 2, date: '2026-06-21', time: '14:00', result: 'served', notes: 'Served to respondent directly.' },
      ],
      officerName: 'Marcus Reyes',
      officerBadge: '4417',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no attempts, occupant/respondent wording',
    input: {
      noticeDate: '2026-06-21',
      callNumber: 'C-2026-004418',
      clientName: 'Rocky Mountain Protective Group',
      serviceType: 'subpoena_service',
      serviceAddress: '1400 S State St, Salt Lake City, UT 84115',
      attempts: [{ number: 1, date: '2026-06-21', time: '09:00', result: 'no_access', notes: '' }],
      officerName: 'Marcus Reyes',
      officerBadge: '4417',
    },
  },
  {
    variant: 'maximal',
    label: '40-row attempt log, 120-char recipient name, year-boundary notice date',
    input: {
      noticeDate: '2026-12-31',
      callNumber: 'C-2026-004419',
      respondentName: MAXIMAL_NAME,
      courtCaseNumber: '2026-004419',
      courtName: 'Third District Court',
      clientName: 'Rocky Mountain Protective Group',
      serviceType: 'civil_summons',
      serviceAddress: '1400 S State St, Salt Lake City, UT 84115',
      attempts: Array.from({ length: 40 }, (_, i) => ({
        number: i + 1,
        date: '2026-12-31',
        time: '09:00',
        result: i % 2 === 0 ? 'no_contact' : 'served',
        notes: 'State of Utah, County of Salt Lake, attempt logged under penalty of perjury.',
      })),
      officerName: 'Sergeant Marcus Alexander Reyes, Badge 4417',
      officerBadge: '4417',
      nextWindow: '2027-01-02',
    },
  },
];

// ── Patrol Tracking Report (patrolTrackingPdfGenerator.ts) ────

function minimalPatrolPoint(): any {
  return {
    lat: 40.7291, lng: -111.8879, accuracy: 10, heading_cardinal: 'N', speed_mph: 0,
    status: 'available', current_call_number: null, current_call_type: null,
    time: '2026-06-21T09:00:00Z', distance_from_prev_meters: 0, is_stationary: true,
  };
}

function patrolPoint(i: number): any {
  return {
    lat: 40.7291 + i * 0.001, lng: -111.8879 - i * 0.001, accuracy: 8, heading_cardinal: 'NE',
    speed_mph: 25 + (i % 10), status: 'dispatched', current_call_number: 'C-2026-004417',
    current_call_type: 'trespass', time: YEAR_BOUNDARY, distance_from_prev_meters: 120,
    is_stationary: false, road_name: 'S State St', nearest_intersection: '1400 S',
    source: 'clearpathgps', beat_id: 'A1', beat_code: 'A1', zone: 'Riverton D2',
    cumulative_distance_miles: i * 0.5,
  };
}

function minimalResponseSegment(): any {
  return {
    call_number: 'C-2026-004417', incident_type: 'trespass', priority: 'P2',
    dispatched_at: '2026-06-21T09:00:00Z', onscene_at: null, time_to_onscene_seconds: null,
    response_distance_miles: 0, breadcrumb_count: 0,
  };
}

export const patrolTrackingFixtures: PdfFixture<PatrolTrackingReportData>[] = [
  {
    variant: 'typical',
    label: 'One unit trail with breadcrumbs and a response segment',
    input: {
      trails: [
        {
          unit_id: 1, call_sign: '4-Adam-12', officer_name: 'Marcus Reyes', badge_number: '4417',
          points: [patrolPoint(0), patrolPoint(1)],
          stats: {
            total_points: 2, stationary_points: 0, moving_points: 2, total_distance_miles: 1.0,
            max_speed_mph: 34, avg_speed_mph: 27, duration_minutes: 12,
          },
          response_segments: [minimalResponseSegment()],
        },
      ],
      query: { startDate: '2026-06-21T00:00:00Z', endDate: '2026-06-21T23:59:00Z', hours: 24 },
      total_units: 1,
      total_points: 2,
    },
  },
  {
    variant: 'empty',
    label: 'One minimal trail with one required-fields-only breadcrumb',
    input: {
      trails: [
        {
          unit_id: 1, call_sign: '4-Adam-12', officer_name: 'Marcus Reyes', badge_number: '4417',
          points: [minimalPatrolPoint()],
          stats: {
            total_points: 1, stationary_points: 1, moving_points: 0, total_distance_miles: 0,
            max_speed_mph: 0, avg_speed_mph: 0, duration_minutes: 0,
          },
          response_segments: [minimalResponseSegment()],
        },
      ],
      query: { startDate: null, endDate: null, hours: 8 },
      total_units: 1,
      total_points: 1,
    },
  },
  {
    variant: 'maximal',
    label: 'Two units, 40-point breadcrumb trail each, year-boundary period',
    input: {
      trails: [
        {
          unit_id: 1, call_sign: '4-Adam-12', officer_name: MAXIMAL_NAME, badge_number: '4417',
          points: Array.from({ length: 40 }, (_, i) => patrolPoint(i)),
          stats: {
            total_points: 40, stationary_points: 4, moving_points: 36, total_distance_miles: 20,
            max_speed_mph: 62, avg_speed_mph: 31, duration_minutes: 480,
          },
          response_segments: Array.from({ length: 5 }, () => minimalResponseSegment()),
        },
        {
          unit_id: 2, call_sign: '4-Adam-13', officer_name: 'Dana Whitlock', badge_number: '4418',
          points: Array.from({ length: 40 }, (_, i) => patrolPoint(i)),
          stats: {
            total_points: 40, stationary_points: 2, moving_points: 38, total_distance_miles: 22,
            max_speed_mph: 58, avg_speed_mph: 29, duration_minutes: 480,
          },
          response_segments: Array.from({ length: 5 }, () => minimalResponseSegment()),
        },
      ],
      query: { startDate: '2026-12-31T00:00:00Z', endDate: YEAR_BOUNDARY, hours: 24 },
      total_units: 2,
      total_points: 80,
    },
  },
];

// ── Nav Pre-Trip Briefing (navBriefingPdf.ts) ─────────────────

export const navBriefingFixtures: PdfFixture<NavBriefingArgs>[] = [
  {
    variant: 'typical',
    label: 'Single-destination route with turn-by-turn steps',
    input: {
      route: {
        unitCallSign: '4-Adam-12',
        callNumber: 'C-2026-004417',
        eta: '6 min',
        distance: '2.1 mi',
        durationSec: 360,
        distanceMeters: 3380,
        steps: [
          { instruction: 'Head north on S State St', distanceMeters: 500, distanceText: '0.3 mi', maneuverType: 'depart' },
          { instruction: 'Turn right onto 1400 S', distanceMeters: 200, distanceText: '0.1 mi', maneuverType: 'turn', modifier: 'right' },
        ],
        trafficAware: true,
        worstCongestion: 'moderate',
        postedLimitMph: null,
      },
      destinationLabel: '1400 S State St, Salt Lake City, UT 84115',
      destLat: 40.7291,
      destLng: -111.8879,
      originLat: 40.73,
      originLng: -111.89,
      officerName: 'Marcus Reyes',
      unitCallSign: '4-Adam-12',
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no steps, no destination, no waypoints',
    input: {
      route: {
        unitCallSign: '4-Adam-12',
        callNumber: 'C-2026-004418',
        eta: '—',
        distance: '—',
        durationSec: 0,
        distanceMeters: 0,
        steps: [],
        trafficAware: false,
        worstCongestion: 'unknown',
        postedLimitMph: null,
      },
    },
  },
  {
    variant: 'maximal',
    label: '40-step turn-by-turn list with multi-stop waypoints',
    input: {
      route: {
        unitCallSign: '4-Adam-12',
        callNumber: 'C-2026-004419',
        eta: '38 min',
        distance: '24.6 mi',
        durationSec: 2280,
        distanceMeters: 39600,
        steps: Array.from({ length: 40 }, (_, i) => ({
          instruction: `Continue on S State St for ${i + 1} blocks then turn`,
          distanceMeters: 200,
          distanceText: '0.1 mi',
          maneuverType: 'turn',
          modifier: i % 2 === 0 ? 'left' : 'right',
        })),
        trafficAware: true,
        worstCongestion: 'severe',
        postedLimitMph: null,
      },
      destinationLabel: MAXIMAL_NAME,
      destLat: 40.7291,
      destLng: -111.8879,
      originLat: 40.73,
      originLng: -111.89,
      waypoints: [
        { id: 1, lat: 40.731, lng: -111.891, label: 'Stop 1 — 1400 S State St', completed: true },
        { id: 2, lat: 40.732, lng: -111.892, label: 'Stop 2 — 1500 S State St', completed: false },
      ],
      officerName: MAXIMAL_NAME,
      unitCallSign: '4-Adam-12',
    },
  },
];

// ── Nav Trip Report (navTripPdf.ts — multi-trip) ──────────────

function minimalNavTrip(id: number): NavTrip {
  return {
    id,
    officer_id: 42,
    start_lat: 40.7291,
    start_lng: -111.8879,
    start_time: '2026-06-21T09:00:00Z',
    status: 'completed',
    detected_by: 'auto',
    created_at: '2026-06-21T09:00:00Z',
    updated_at: '2026-06-21T09:20:00Z',
  };
}

function navTrip(i: number): NavTrip {
  return {
    id: 500 + i,
    officer_id: 42,
    vehicle_id: 7,
    unit_id: 1,
    start_lat: 40.7291,
    start_lng: -111.8879,
    start_accuracy: 8,
    start_location: '1400 S State St, Salt Lake City, UT 84115',
    start_time: YEAR_BOUNDARY,
    end_lat: 40.735,
    end_lng: -111.895,
    end_accuracy: 8,
    end_location: '1500 S State St, Salt Lake City, UT 84115',
    end_time: YEAR_BOUNDARY,
    distance_miles: 2.4 + i * 0.1,
    max_speed_mph: 45,
    duration_seconds: 720,
    route_points: [
      { lat: 40.7291, lng: -111.8879, ts: YEAR_BOUNDARY, speed: 10, heading: 45 },
      { lat: 40.73, lng: -111.888, ts: YEAR_BOUNDARY, speed: 12, heading: 50 },
    ],
    status: 'completed',
    detected_by: i % 2 === 0 ? 'auto' : 'manual',
    purpose: 'patrol',
    vehicle_number: 'V-12',
    make: 'Ford',
    model: 'Explorer',
    plate_number: 'UT-7X4K21',
    unit_call_sign: '4-Adam-12',
    created_at: YEAR_BOUNDARY,
    updated_at: YEAR_BOUNDARY,
  };
}

export const navTripReportFixtures: PdfFixture<{ trips: NavTrip[]; officerName?: string; vehicleLabel?: string; periodLabel?: string }>[] = [
  {
    variant: 'typical',
    label: 'Two completed trips with breakdowns by status/vehicle/purpose',
    input: {
      trips: [navTrip(1), navTrip(2)],
      officerName: 'Marcus Reyes',
      vehicleLabel: 'V-12 — Ford Explorer',
      periodLabel: '2026-06-21',
    },
  },
  {
    variant: 'empty',
    label: 'One required-fields-only trip',
    input: {
      trips: [minimalNavTrip(600)],
    },
  },
  {
    variant: 'maximal',
    label: '40 trips, year-boundary period, breadcrumb-heavy routes',
    input: {
      trips: Array.from({ length: 40 }, (_, i) => navTrip(i)),
      officerName: MAXIMAL_NAME,
      vehicleLabel: 'V-12 — Ford Explorer',
      periodLabel: '2026-12-31',
    },
  },
];

// ── Nav Trip Detail (navTripPdf.ts — single trip) ─────────────

export const navTripDetailFixtures: PdfFixture<{ trip: NavTrip; officerName?: string }>[] = [
  {
    variant: 'typical',
    label: 'Completed trip with start/end locations and breadcrumb path',
    input: { trip: navTrip(1), officerName: 'Marcus Reyes' },
  },
  {
    variant: 'empty',
    label: 'Required fields only — trip still in progress (no end location)',
    input: { trip: minimalNavTrip(601) },
  },
  {
    variant: 'maximal',
    label: '40-point breadcrumb path, long notes, year-boundary trip',
    input: {
      trip: {
        ...navTrip(3),
        id: 999,
        notes: MAXIMAL_NARRATIVE,
        route_points: Array.from({ length: 40 }, (_, i) => ({
          lat: 40.7291 + i * 0.001, lng: -111.8879 - i * 0.001, ts: YEAR_BOUNDARY, speed: 10 + (i % 5), heading: (i * 9) % 360,
        })),
      },
      officerName: MAXIMAL_NAME,
    },
  },
];

// ── Tactical Situation Report (mapSituationReportPdf.ts) ──────

export const mapSituationReportFixtures: PdfFixture<MapSituationReportData>[] = [
  {
    variant: 'typical',
    label: 'Live snapshot with active calls, units, analysis, and a patrol route',
    input: {
      mapImageDataUrl: null,
      mapAspect: 1.6,
      operator: 'Marcus Reyes',
      center: { lat: 40.7291, lng: -111.8879 },
      zoom: 13,
      calls: [
        { call_number: 'C-2026-004417', incident_type: 'trespass', priority: 'P2', status: 'dispatched', location_address: '1400 S State St, Salt Lake City, UT 84115' },
      ],
      units: [
        { call_sign: '4-Adam-12', officer_name: 'Marcus Reyes', status: 'available', current_call_type: null, current_call_location: null },
      ],
      analysis: { safetyZones: 3, highRisk: 1, predictions: 2, repeatAddrs: 1 },
      patrol: {
        unitCallSign: '4-Adam-12',
        totalEta: '18 min',
        totalDistance: '6.2 mi',
        stops: [{ order: 1, callNumber: 'C-2026-004417', label: 'Retail corridor', legEta: '6 min' }],
      },
    },
  },
  {
    variant: 'empty',
    label: 'Required fields only — no calls, no units, no analysis',
    input: {
      mapImageDataUrl: null,
      mapAspect: 1.6,
      operator: 'Marcus Reyes',
      center: { lat: 40.7291, lng: -111.8879 },
      zoom: 13,
      calls: [{ call_number: 'C-2026-004418', incident_type: 'trespass', priority: 'P3', status: 'pending', location_address: '1400 S State St, Salt Lake City, UT 84115' }],
      units: [{ call_sign: '4-Adam-13', officer_name: 'Dana Whitlock', status: 'available' }],
    },
  },
  {
    variant: 'maximal',
    label: '40 active calls, 30 units on map, long operator name, year-boundary snapshot',
    input: {
      mapImageDataUrl: null,
      mapAspect: 1.6,
      operator: MAXIMAL_NAME,
      center: { lat: 40.7291, lng: -111.8879 },
      zoom: 14,
      calls: Array.from({ length: 40 }, (_, i) => ({
        call_number: `C-2026-${String(4417 + i).padStart(6, '0')}`,
        incident_type: 'trespass',
        priority: (['P1', 'P2', 'P3', 'P4'] as const)[i % 4],
        status: 'dispatched',
        location_address: '1400 S State St, Salt Lake City, UT 84115',
      })),
      units: Array.from({ length: 30 }, (_, i) => ({
        call_sign: `4-Adam-${i + 1}`,
        officer_name: 'Marcus Reyes',
        status: 'dispatched',
        current_call_type: 'trespass',
        current_call_location: '1400 S State St, Salt Lake City, UT 84115',
      })),
      analysis: { safetyZones: 12, highRisk: 4, predictions: 6, repeatAddrs: 3 },
      patrol: {
        unitCallSign: '4-Adam-12',
        totalEta: '58 min',
        totalDistance: '22.4 mi',
        stops: Array.from({ length: 10 }, (_, i) => ({
          order: i + 1, callNumber: `C-2026-${String(4417 + i).padStart(6, '0')}`, label: `Stop ${i + 1}`, legEta: '6 min',
        })),
      },
    },
  },
];

export const dialerCallRecordFixtures: PdfFixture<DialerRecordPdfInput>[] = [
  {
    variant: 'typical',
    label: 'Inbound dispatch call with transcription and recording on file',
    input: {
      exportedBy: 'Marcus Reyes',
      record: {
        id: 4417,
        kind: 'call',
        call_sid: 'CAab12cd34ef56',
        from_number: '+18015550100',
        to_number: '+18015550999',
        direction: 'inbound',
        status: 'completed',
        started_at: '2026-08-12T15:04:00Z',
        ended_at: '2026-08-12T15:07:22Z',
        duration_seconds: 202,
        agent_name: 'Dana Whitlock',
        transcript: 'Caller: I need an officer at 1400 S State Street.\nDispatcher: Copy, starting a call for service.',
        recording_r2_key: 'dialer-connect/call/4417/1',
      },
    },
  },
  {
    variant: 'empty',
    label: 'Identifiers only, no transcription or audio',
    input: {
      record: { id: 1, kind: 'call' },
    },
  },
  {
    variant: 'maximal',
    label: 'Long transcription spanning pages',
    input: {
      exportedBy: MAXIMAL_NAME,
      record: {
        id: 9001,
        kind: 'call',
        call_sid: 'CAmaximal0001',
        from_number: '+18015550100',
        to_number: '+18015550999',
        direction: 'outbound',
        started_at: '2026-08-12T23:59:00Z',
        ended_at: '2026-08-13T00:12:00Z',
        duration_seconds: 780,
        agent_name: MAXIMAL_NAME,
        transcript: MAXIMAL_NARRATIVE,
        recording_r2_key: 'dialer-connect/call/9001/1',
      },
    },
  },
];
