// ============================================================
// RMPG Flex — Record PDF Generator (v3 — Design Token Remodel)
// Professional police-style PDF forms for all record types
// Reuses helpers from pdfGenerator.ts + pdfTokens.ts
// ============================================================

import jsPDF from 'jspdf';
import {
  addConfidentialWatermark,
  addClassificationBar,
  addReportHeader,
  openAutoSection,
  closeAutoSection,
  addFieldPair,
  addCheckboxField,
  addSignatureBlock,
  addTableWithShading,
  addThreeColumnFields,
  addWrappedText,
  addNarrativeSection,
  addPageFooter,
  checkPageBreak,
  setGenerationTimestamp,
  fetchPdfBranding,
  setActiveBranding,
  loadPdfAssets,
  setActiveFormKey,
  setActiveCaseNumber,
  addAttachmentsSection,
  addImageToPage,
} from './pdfGenerator';
import type { PdfImage, PdfSignatureData } from './pdfGenerator';
import {
  LAYOUT, SPACING, FONT, COLOR, BORDER,
  getContentWidth, getHalfWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth, getQuarterWidth,
  getGridStartX, getGridContentWidth,
} from './pdfTokens';
import {
  drawFormSection, drawFormGrid, drawSideTab,
  drawCheckboxGrid, drawNibrsHeader,
  type CheckboxItem,
} from './pdfFormHelpers';

// ── Active Officer Signature (set per-generation, cleared after) ─

let _activeOfficerSig: PdfSignatureData | undefined;

/** Set the officer's digital signature data for the current PDF generation run */
export function setActiveOfficerSignature(sig: PdfSignatureData | undefined) {
  _activeOfficerSig = sig;
}

/** Get the active officer signature (used by addSignatureBlock calls) */
function getOfficerSig(): PdfSignatureData | undefined {
  return _activeOfficerSig;
}

// ── Type Aliases for Record Types ────────────────────────────

export type RecordPdfType =
  | 'call'
  | 'person'
  | 'vehicle'
  | 'warrant'
  | 'evidence'
  | 'fleet'
  | 'personnel'
  | 'property'
  | 'citation';

// ── Data Interfaces ──────────────────────────────────────────

export interface CallPdfData {
  call_number: string;
  incident_type: string;
  priority: string;
  status: string;
  source?: string;
  description: string;
  disposition?: string;
  // Caller
  caller_name?: string;
  caller_phone?: string;
  caller_relationship?: string;
  caller_address?: string;
  // Location
  location?: string;
  cross_street?: string;
  location_building?: string;
  location_floor?: string;
  location_room?: string;
  zone_beat?: string;
  section_id?: string;
  zone_id?: string;
  beat_id?: string;
  dispatch_code?: string;
  // District names (green columns — shown on PDF header)
  section_name?: string;
  zone_name?: string;
  beat_name?: string;
  beat_descriptor?: string;
  // Case linkage
  case_id?: number;
  case_number?: string;
  // Contract ID (for PSO Client Request incidents)
  contract_id?: string;
  latitude?: number;
  longitude?: number;
  property_name?: string;
  // Incident details
  num_subjects?: number;
  num_victims?: number;
  subject_description?: string;
  vehicle_description?: string;
  direction_of_travel?: string;
  secondary_type?: string;
  // Scene conditions
  weather_conditions?: string;
  lighting_conditions?: string;
  scene_safety?: string;
  injuries_reported?: boolean;
  weapons_involved?: string;
  // Flags
  alcohol_involved?: boolean;
  drugs_involved?: boolean;
  domestic_violence?: boolean;
  supervisor_notified?: boolean;
  le_notified?: boolean;
  le_agency?: string;
  le_case_number?: string;
  // Extended operational flags
  mental_health_crisis?: boolean;
  juvenile_involved?: boolean;
  felony_in_progress?: boolean;
  officer_safety_caution?: boolean;
  k9_requested?: boolean;
  ems_requested?: boolean;
  fire_requested?: boolean;
  hazmat?: boolean;
  gang_related?: boolean;
  evidence_collected?: boolean;
  body_camera_active?: boolean;
  photos_taken?: boolean;
  trespass_issued?: boolean;
  vehicle_pursuit?: boolean;
  foot_pursuit?: boolean;
  // PSO Client Request fields
  pso_service_type?: string;
  pso_authorization?: string;
  pso_requestor_name?: string;
  pso_requestor_phone?: string;
  pso_requestor_email?: string;
  pso_billing_code?: string;
  // Process Service fields
  process_service_type?: string;
  process_served_to?: string;
  process_served_address?: string;
  process_attempts?: number;
  process_served_at?: string;
  process_service_result?: string;
  // Damage
  damage_estimate?: number;
  damage_description?: string;
  // Resolution
  action_taken?: string;
  responding_officer?: string;
  // Units
  assigned_units?: string[];
  // Mileage
  starting_mileage?: number;
  ending_mileage?: number;
  // Timeline
  created_at?: string;
  dispatched_at?: string;
  enroute_at?: string;
  onscene_at?: string;
  cleared_at?: string;
  closed_at?: string;
  created_by?: string;
  // Notes / Narrative
  notes?: { id: string; author: string; content: string; created_at: string }[];
  narrative?: string;
  // OPR identifier
  dispatcher_name?: string;
  // Assigned units detail (from API: call_sign, officer_name, badge_number)
  assigned_units_detail?: { call_sign: string; officer_name?: string; badge_number?: string; status?: string }[];
  attachment_images?: PdfImage[];
  // GPS breadcrumb trail (auto-fetched by PrintRecordButton)
  breadcrumb_trail?: {
    points: { lat: number; lng: number; time: string; speed_mph: number | null; road_name?: string | null; nearest_intersection?: string | null; source?: string; call_sign?: string; officer_name?: string }[];
    stats: { total_points: number; total_distance_miles: number; duration_minutes: number; avg_speed_mph: number; max_speed_mph: number; source_breakdown?: Record<string, number> };
  };
}

// ── System History sub-types for Person PDFs ─────────────────

export interface PersonWarrantHistory {
  warrant_number: string | null;
  type: string;
  status: string;
  charge_description: string;
  offense_level: string | null;
  statute_citation: string | null;
  date_issued: string | null;
  expires_at: string | null;
}

export interface PersonIncidentHistory {
  incident_number: string | null;
  incident_type: string;
  status: string;
  priority: string | null;
  description: string | null;
  created_at: string | null;
  role: string;
}

export interface PersonCallHistory {
  call_number: string | null;
  incident_type: string;
  priority: string | null;
  status: string;
  location: string | null;
  created_at: string | null;
}

export interface PersonCitationHistory {
  citation_number: string;
  type: string;
  status: string;
  statute_citation: string | null;
  violation_description: string | null;
  offense_level: string | null;
  fine_amount: number | null;
  violation_date: string | null;
  location: string | null;
}

export interface PersonPdfData {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  alias_nickname?: string;
  date_of_birth?: string;
  gender?: string;
  race?: string;
  // Physical
  height?: string;
  weight?: string;
  build?: string;
  complexion?: string;
  hair_color?: string;
  hair_length?: string;
  hair_style?: string;
  eye_color?: string;
  facial_hair?: string;
  glasses?: string;
  blood_type?: string;
  shoe_size?: string;
  scars_marks_tattoos?: string;
  clothing_description?: string;
  // Contact
  phone?: string;
  phone_secondary?: string;
  email?: string;
  social_media?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  // ID
  dl_number?: string;
  dl_state?: string;
  dl_class?: string;
  dl_expiry?: string;
  id_type?: string;
  id_number?: string;
  id_state?: string;
  id_expiry?: string;
  ssn_last4?: string;
  // Employment / Demographics
  employer?: string;
  occupation?: string;
  language?: string;
  citizenship?: string;
  marital_status?: string;
  place_of_birth?: string;
  // Flags
  is_sex_offender?: boolean;
  is_veteran?: boolean;
  gang_affiliation?: string;
  probation_parole?: string;
  probation_parole_officer?: string;
  known_associates?: string;
  caution_flags?: string;
  flags?: string[];
  // Emergency
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relationship?: string;
  // System History (fetched from /system-history endpoint)
  warrants?: PersonWarrantHistory[];
  incidents?: PersonIncidentHistory[];
  calls?: PersonCallHistory[];
  citations?: PersonCitationHistory[];
  bolo_active?: boolean;
  // Admin
  notes?: string;
  incident_ids?: string[];
  created_at?: string;
  updated_at?: string;
  id_photo?: PdfImage | null;
  attachment_images?: PdfImage[];
}

export interface VehiclePdfData {
  id: string;
  license_plate: string;
  plate_state?: string;
  plate_type?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  body_style?: string;
  trim?: string;
  doors?: number;
  color?: string;
  secondary_color?: string;
  // Mechanical
  engine_type?: string;
  fuel_type?: string;
  transmission?: string;
  drive_type?: string;
  odometer?: string;
  // Owner
  owner_name?: string;
  owner_address?: string;
  owner_phone?: string;
  commercial_vehicle?: boolean;
  hazmat?: boolean;
  // Insurance
  insurance_company?: string;
  insurance_policy?: string;
  registration_expiry?: string;
  // Legal
  stolen_status?: string;
  stolen_date?: string;
  recovery_date?: string;
  tow_status?: string;
  tow_company?: string;
  tow_date?: string;
  lien_holder?: string;
  // Description
  distinguishing_features?: string;
  damage_description?: string;
  flags?: string[];
  notes?: string;
  incident_ids?: string[];
  created_at?: string;
  updated_at?: string;
  attachment_images?: PdfImage[];
}

export interface WarrantPdfData {
  warrant_number: string;
  type: string;
  status: string;
  offense_level?: string;
  charge_description?: string;
  // Subject
  subject_first_name?: string;
  subject_last_name?: string;
  subject_dob?: string;
  subject_gender?: string;
  subject_race?: string;
  subject_height?: string;
  subject_weight?: string;
  subject_hair_color?: string;
  subject_eye_color?: string;
  subject_address?: string;
  // Court
  issuing_court?: string;
  issuing_judge?: string;
  bail_amount?: number;
  expires_at?: string;
  // Entry
  entered_by_name?: string;
  created_at?: string;
  // Service
  served_by_name?: string;
  served_at?: string;
  served_location?: string;
  // Admin
  notes?: string;
  archived_at?: string;
}

export interface EvidencePdfData {
  evidence_number: string;
  evidence_type?: string;
  category?: string;
  incident_number?: string;
  status?: string;
  description?: string;
  serial_number?: string;
  brand?: string;
  model?: string;
  dimensions?: string;
  weight?: string;
  estimated_value?: number;
  quantity?: number;
  // Collection
  collected_by?: string;
  collected_date?: string;
  location_found?: string;
  packaging_type?: string;
  photo_taken?: boolean;
  // Storage
  storage_location?: string;
  // Chain of custody
  chain_of_custody?: {
    action: string;
    from_person?: string;
    to_person?: string;
    reason?: string;
    timestamp: string;
  }[];
  // Lab
  lab_submitted?: boolean;
  lab_name?: string;
  lab_case_number?: string;
  // Disposal
  disposal_method?: string;
  disposal_date?: string;
  disposal_authorized_by?: string;
  // Admin
  notes?: string;
  created_at?: string;
  updated_at?: string;
  attachment_images?: PdfImage[];
}

export interface FleetFuelLogEntry {
  fuel_date: string;
  gallons: number;
  total_cost?: number;
  cost_per_gallon?: number;
  odometer_reading?: number;
  station?: string;
  fuel_type?: string;
  distance?: number;
  efficiency?: number;
}

export interface FleetMaintenanceEntry {
  service_date: string;
  service_type: string;
  description: string;
  cost?: number;
  odometer_reading?: number;
  vendor?: string;
  labor_cost?: number;
  service_tasks?: string;
}

export type FleetReportType = 'status' | 'fuel_logs' | 'maintenance' | 'mileage_summary';

export interface FleetPdfData {
  vehicle_number: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  vin?: string;
  plate_number?: string;
  plate_state?: string;
  status: string;
  assigned_unit_call_sign?: string;
  current_mileage?: number;
  last_service_date?: string;
  next_service_due?: string;
  insurance_expiry?: string;
  registration_expiry?: string;
  equipment?: string[];
  notes?: string;
  created_at?: string;
  updated_at?: string;
  // Extended report data
  report_type?: FleetReportType;
  fuel_logs?: FleetFuelLogEntry[];
  maintenance_logs?: FleetMaintenanceEntry[];
}

export interface PersonnelCredentialEntry {
  type: string;
  credential_number: string;
  issuing_authority: string;
  issued_date: string;
  expiry_date: string;
  status: string;
}

export interface PersonnelTrainingEntry {
  course_name: string;
  category: string;
  provider: string;
  completed_date?: string;
  expiry_date?: string;
  hours: number;
  score?: number;
  status: string;
}

export interface PersonnelEquipmentEntry {
  equipment_type: string;
  serial_number?: string;
  make?: string;
  model?: string;
  condition: string;
  status: string;
  issued_date?: string;
}

export interface PersonnelBodyCameraEntry {
  camera_id: string;
  make: string;
  model: string;
  status: string;
  condition: string;
  assigned_at: string;
}

export interface PersonnelDeploymentEntry {
  property_name: string;
  position: string;
  start_date: string;
  end_date?: string;
  status: string;
  hours_per_week?: number;
}

export interface PersonnelTimeEntry {
  clock_in: string;
  clock_out?: string;
  total_hours?: number;
  status: string;
}

export interface PersonnelPdfData {
  badge_number?: string;
  employee_id?: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  rank?: string;
  role?: string;
  department?: string;
  date_of_birth?: string;
  gender?: string;
  blood_type?: string;
  allergies?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  hire_date?: string;
  termination_date?: string;
  shift_preference?: string;
  uniform_size?: string;
  dl_number?: string;
  dl_state?: string;
  dl_expiry?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relationship?: string;
  certifications?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
  attachment_images?: PdfImage[];
  // Extended data for comprehensive report
  credentials?: PersonnelCredentialEntry[];
  training_records?: PersonnelTrainingEntry[];
  equipment_list?: PersonnelEquipmentEntry[];
  body_cameras?: PersonnelBodyCameraEntry[];
  deployments?: PersonnelDeploymentEntry[];
  time_entries?: PersonnelTimeEntry[];
  report_type?: 'full' | 'credentials' | 'training' | 'equipment' | 'time';
}

export interface PropertyPdfData {
  name: string;
  client_name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  property_type?: string;
  is_active?: boolean;
  gate_code?: string;
  alarm_code?: string;
  emergency_contact?: string;
  access_instructions?: string;
  post_orders?: string;
  hazard_notes?: string;
  created_at?: string;
  updated_at?: string;
  attachment_images?: PdfImage[];
}

export interface CitationPdfData {
  citation_number: string;
  type: string;
  status: string;
  // Subject
  person_name?: string;
  person_dob?: string;
  person_dl?: string;
  person_address?: string;
  // Vehicle
  vehicle_description?: string;
  vehicle_plate?: string;
  vehicle_state?: string;
  // Violation
  statute_citation?: string;
  violation_description?: string;
  offense_level?: string;
  fine_amount?: number;
  violation_date?: string;
  violation_time?: string;
  location?: string;
  // Officer
  issuing_officer_name?: string;
  badge_number?: string;
  // Court
  court_date?: string;
  court_name?: string;
  court_address?: string;
  // Meta
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

// ── Helper: Priority mapping for calls ───────────────────────

function callPriorityLabel(p: string): string {
  const map: Record<string, string> = { P1: 'critical', P2: 'high', P3: 'medium', P4: 'low' };
  return map[p] || 'routine';
}

function fmtTimestamp(ts?: string): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: '2-digit', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return ts; }
}

function fmtDate(ts?: string | null): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      month: '2-digit', day: '2-digit', year: 'numeric',
    });
  } catch { return ts; }
}

function fmtDateTime(ts?: string | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ts; }
}

function fmtCurrency(val?: number): string {
  if (val == null) return '';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

// ── Call for Service Report ──────────────────────────────────

function generateCallReport(doc: jsPDF, data: CallPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const prio = callPriorityLabel(data.priority);
  const gridX = getGridStartX();
  const gridW = getGridContentWidth(doc);

  setActiveCaseNumber(data.call_number);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'CALL FOR SERVICE REPORT',
    formNumber: 'FORM PS-201',
    caseNumber: data.call_number,
    reportDate: fmtTimestamp(data.created_at || ''),
  });

  // ── Dispatch District Info Bar (gold columns — below header) ──
  {
    const cw = getContentWidth(doc);
    const barY = y;
    const hasContract = data.contract_id && data.incident_type === 'pso_client_request';
    const barH = hasContract ? 18 : 10;
    doc.setFillColor(20, 25, 30);
    doc.rect(LAYOUT.PAGE_MARGIN, barY, cw, barH, 'F');
    doc.setDrawColor(212, 160, 23);
    doc.setLineWidth(0.3);
    doc.line(LAYOUT.PAGE_MARGIN, barY, LAYOUT.PAGE_MARGIN + cw, barY);

    const colW = cw / 5;
    const fields = [
      { label: 'SECTION', value: data.section_name || '' },
      { label: 'ZONE', value: data.zone_name || '' },
      { label: 'BEAT', value: data.beat_name || '' },
      { label: 'AREA', value: data.beat_descriptor || '' },
      { label: 'CODE', value: data.dispatch_code || '' },
    ];
    fields.forEach((f, i) => {
      const fx = LAYOUT.PAGE_MARGIN + (i * colW) + 3;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.5);
      doc.setTextColor(140, 140, 140);
      doc.text(f.label, fx, barY + 3.5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(212, 160, 23);
      doc.text(f.value || '—', fx, barY + 7.5);
    });

    if (hasContract) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.5);
      doc.setTextColor(140, 140, 140);
      doc.text('CONTRACT ID', LAYOUT.PAGE_MARGIN + 3, barY + 12);
      doc.setFont('courier', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(data.contract_id!, LAYOUT.PAGE_MARGIN + 3, barY + 16);
    }

    y = barY + barH + 2;
  }

  // ═══════════════════════════════════════════════════════════
  // ADMINISTRATIVE — call classification + timestamps grid
  // ═══════════════════════════════════════════════════════════
  y = drawFormSection(doc, {
    sideTab: { label: 'ADMINISTRATIVE' },
    rows: [
      { cells: [
        { label: '1. CALL NUMBER', value: data.call_number, ratio: 2, valueBold: true },
        { label: '2. INCIDENT TYPE', value: (data.incident_type || '').replace(/_/g, ' ').toUpperCase(), ratio: 2 },
        { label: '3. PRIORITY', value: data.priority || '', ratio: 1 },
        { label: '4. STATUS', value: (data.status || '').toUpperCase(), ratio: 1 },
      ]},
      { cells: [
        { label: '5. SOURCE', value: (data.source || '').replace(/_/g, ' ').toUpperCase(), ratio: 1 },
        { label: '6. DISPATCH CODE', value: data.dispatch_code || '', ratio: 1 },
        { label: '7. DISPOSITION', value: data.disposition || '', ratio: 1 },
        { label: '8. CASE NUMBER', value: data.case_number || '', ratio: 2, valueBold: true },
      ]},
      { cells: [
        { label: '9. CREATED', value: fmtTimestamp(data.created_at || ''), ratio: 1 },
        { label: '10. DISPATCHED', value: fmtTimestamp(data.dispatched_at || ''), ratio: 1 },
        { label: '11. ENROUTE', value: fmtTimestamp(data.enroute_at || ''), ratio: 1 },
        { label: '12. ON SCENE', value: fmtTimestamp(data.onscene_at || ''), ratio: 1 },
        { label: '13. CLEARED', value: fmtTimestamp(data.cleared_at || ''), ratio: 1 },
        { label: '14. CLOSED', value: fmtTimestamp(data.closed_at || ''), ratio: 1 },
      ]},
    ],
    y,
  });

  // ═══════════════════════════════════════════════════════════
  // DISPATCH — caller info + location grid
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(doc, y, 40, prio);
  y = drawFormSection(doc, {
    sideTab: { label: 'DISPATCH' },
    rows: [
      { cells: [
        { label: '15. CALLER NAME', value: data.caller_name || '', ratio: 2 },
        { label: '16. PHONE', value: data.caller_phone || '', ratio: 1 },
        { label: '17. RELATIONSHIP', value: data.caller_relationship || '', ratio: 1 },
      ]},
      { cells: [
        { label: '18. CALLER ADDRESS', value: data.caller_address || '', ratio: 1 },
      ]},
      { cells: [
        { label: '19. INCIDENT ADDRESS', value: data.location || '', ratio: 1, valueBold: true },
      ]},
      { cells: [
        { label: '20. CROSS STREET', value: data.cross_street || '', ratio: 2 },
        { label: '21. PROPERTY', value: data.property_name || '', ratio: 2 },
        { label: '22. BUILDING', value: data.location_building || '', ratio: 1 },
        { label: '23. FLOOR', value: data.location_floor || '', ratio: 1 },
      ]},
      { cells: [
        { label: '24. ROOM', value: data.location_room || '', ratio: 1 },
        { label: '25. SECTION ID', value: data.section_id || '', ratio: 1 },
        { label: '26. ZONE ID', value: data.zone_id || '', ratio: 1 },
        { label: '27. BEAT ID', value: data.beat_id || '', ratio: 1 },
        { label: '28. LAT', value: data.latitude != null ? String(data.latitude) : '', ratio: 1 },
        { label: '29. LNG', value: data.longitude != null ? String(data.longitude) : '', ratio: 1 },
      ]},
    ],
    y,
  });

  // Mileage row (if present)
  if (data.starting_mileage || data.ending_mileage) {
    const totalMiles = (data.starting_mileage && data.ending_mileage)
      ? (Number(data.ending_mileage) - Number(data.starting_mileage)).toFixed(1)
      : '';
    y = drawFormGrid(doc, [
      { cells: [
        { label: 'STARTING MILEAGE', value: data.starting_mileage != null ? Number(data.starting_mileage).toLocaleString() : '', ratio: 1 },
        { label: 'ENDING MILEAGE', value: data.ending_mileage != null ? Number(data.ending_mileage).toLocaleString() : '', ratio: 1 },
        { label: 'TOTAL MILES', value: totalMiles, ratio: 1, valueBold: true },
      ]},
    ], gridX, y, gridW);
    y += SPACING.SECTION_GAP;
  }

  // ═══════════════════════════════════════════════════════════
  // SCENE — incident details + conditions + flags
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(doc, y, 50, prio);
  const sceneStartY = y;

  // Description + details grid
  y = drawFormGrid(doc, [
    { cells: [
      { label: '30. DESCRIPTION', value: data.description || '', ratio: 1 },
    ], height: 14 },
    { cells: [
      { label: '31. # SUBJECTS', value: data.num_subjects != null ? String(data.num_subjects) : '', ratio: 1 },
      { label: '32. # VICTIMS', value: data.num_victims != null ? String(data.num_victims) : '', ratio: 1 },
      { label: '33. DIRECTION OF TRAVEL', value: data.direction_of_travel || '', ratio: 2 },
    ]},
    { cells: [
      { label: '34. SUBJECT DESCRIPTION', value: data.subject_description || '', ratio: 1 },
    ]},
    { cells: [
      { label: '35. VEHICLE DESCRIPTION', value: data.vehicle_description || '', ratio: 1 },
    ]},
    { cells: [
      { label: '36. WEATHER', value: data.weather_conditions || '', ratio: 1 },
      { label: '37. LIGHTING', value: data.lighting_conditions || '', ratio: 1 },
      { label: '38. WEAPONS INVOLVED', value: data.weapons_involved || '', ratio: 2 },
    ]},
  ], gridX, y, gridW);

  if (data.scene_safety) {
    y = drawFormGrid(doc, [
      { cells: [
        { label: '39. SCENE SAFETY / HAZARDS', value: data.scene_safety, ratio: 1 },
      ]},
    ], gridX, y, gridW);
  }

  // Dense checkbox grid for flags
  const callFlags: CheckboxItem[] = [
    { label: 'Injuries Reported', checked: !!data.injuries_reported },
    { label: 'Alcohol Involved', checked: !!data.alcohol_involved },
    { label: 'Drugs Involved', checked: !!data.drugs_involved },
    { label: 'Domestic Violence', checked: !!data.domestic_violence },
    { label: 'Mental Health Crisis', checked: !!data.mental_health_crisis },
    { label: 'Juvenile Involved', checked: !!data.juvenile_involved },
    { label: 'Felony in Progress', checked: !!data.felony_in_progress },
    { label: 'Officer Safety', checked: !!data.officer_safety_caution },
    { label: 'Gang Related', checked: !!data.gang_related },
    { label: 'HAZMAT', checked: !!data.hazmat },
    { label: 'Vehicle Pursuit', checked: !!data.vehicle_pursuit },
    { label: 'Foot Pursuit', checked: !!data.foot_pursuit },
    { label: 'K9 Requested', checked: !!data.k9_requested },
    { label: 'EMS Requested', checked: !!data.ems_requested },
    { label: 'Fire Requested', checked: !!data.fire_requested },
    { label: 'Evidence Collected', checked: !!data.evidence_collected },
    { label: 'BWC Active', checked: !!data.body_camera_active },
    { label: 'Photos Taken', checked: !!data.photos_taken },
    { label: 'Supervisor Notified', checked: !!data.supervisor_notified },
    { label: 'LE Notified', checked: !!data.le_notified },
    { label: 'Trespass Issued', checked: !!data.trespass_issued },
  ];
  y = drawCheckboxGrid(doc, callFlags, gridX, y, 5, gridW);

  drawSideTab(doc, 'SCENE', sceneStartY, y - sceneStartY);
  y += SPACING.SECTION_GAP;

  // LE Coordination (conditional)
  if (data.le_agency || data.le_case_number) {
    y = checkPageBreak(doc, y, 12, prio);
    y = drawFormGrid(doc, [
      { cells: [
        { label: 'LE AGENCY', value: data.le_agency || '', ratio: 2 },
        { label: 'LE CASE NUMBER', value: data.le_case_number || '', ratio: 2 },
      ]},
    ], gridX, y, gridW);
    y += SPACING.SECTION_GAP;
  }

  // PSO Client Request (conditional)
  if (data.incident_type === 'pso_client_request') {
    y = checkPageBreak(doc, y, 30, prio);
    const psoRows = [
      { cells: [
        { label: 'SERVICE TYPE', value: (data.pso_service_type || '').replace(/_/g, ' ').toUpperCase(), ratio: 1 },
        { label: 'AUTHORIZATION / PO#', value: data.pso_authorization || '', ratio: 1 },
        { label: 'BILLING CODE', value: data.pso_billing_code || '', ratio: 1 },
      ]},
      { cells: [
        { label: 'REQUESTOR NAME', value: data.pso_requestor_name || '', ratio: 2 },
        { label: 'PHONE', value: data.pso_requestor_phone || '', ratio: 1 },
        { label: 'EMAIL', value: data.pso_requestor_email || '', ratio: 2 },
      ]},
    ];
    if (data.pso_service_type === 'process_service' || data.process_service_type) {
      psoRows.push(
        { cells: [
          { label: 'DOCUMENT TYPE', value: (data.process_service_type || '').replace(/_/g, ' ').toUpperCase(), ratio: 1 },
          { label: 'SERVE TO', value: data.process_served_to || '', ratio: 1 },
          { label: 'ATTEMPTS', value: String(data.process_attempts || 0), ratio: 1 },
        ]},
        { cells: [
          { label: 'SERVICE ADDRESS', value: data.process_served_address || '', ratio: 2 },
          { label: 'SERVED AT', value: data.process_served_at || '', ratio: 1 },
          { label: 'RESULT', value: (data.process_service_result || '').replace(/_/g, ' ').toUpperCase(), ratio: 1 },
        ]},
      );
    }
    y = drawFormSection(doc, {
      sideTab: { label: 'CLIENT' },
      rows: psoRows,
      y,
    });
  }

  // Damage Assessment (conditional)
  if (data.damage_estimate || data.damage_description) {
    y = checkPageBreak(doc, y, 10, prio);
    y = drawFormGrid(doc, [
      { cells: [
        { label: 'DAMAGE ESTIMATE', value: fmtCurrency(data.damage_estimate), ratio: 1 },
        { label: 'DAMAGE DESCRIPTION', value: data.damage_description || '', ratio: 3 },
      ]},
    ], gridX, y, gridW);
    y += SPACING.SECTION_GAP;
  }

  // ═══════════════════════════════════════════════════════════
  // UNITS — resolution + assigned units table
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(doc, y, 25, prio);
  const unitsStartY = y;

  y = drawFormGrid(doc, [
    { cells: [
      { label: 'RESPONDING OFFICER', value: data.responding_officer || '', ratio: 2 },
      { label: 'DISPOSITION', value: data.disposition || '', ratio: 1 },
    ]},
  ], gridX, y, gridW);

  if (data.action_taken) {
    y = drawFormGrid(doc, [
      { cells: [
        { label: 'ACTION TAKEN', value: data.action_taken, ratio: 1 },
      ], height: 12 },
    ], gridX, y, gridW);
  }

  // Assigned units table
  const unitDetail = data.assigned_units_detail;
  if (unitDetail && unitDetail.length > 0) {
    const colPositions = [gridX, gridX + 25, gridX + 70, gridX + 110];
    const tableHeaders = [
      { label: 'CALL SIGN', x: colPositions[0] },
      { label: 'OFFICER', x: colPositions[1] },
      { label: 'BADGE #', x: colPositions[2] },
      { label: 'STATUS', x: colPositions[3] },
    ];
    const tableRows = unitDetail.map(u => [
      u.call_sign || '',
      u.officer_name || '',
      u.badge_number || '',
      (u.status || '').toUpperCase(),
    ]);
    y = addTableWithShading(doc, tableHeaders, tableRows, y, colPositions);
  } else if (data.assigned_units && data.assigned_units.length > 0) {
    y = drawFormGrid(doc, [
      { cells: [
        { label: 'ASSIGNED UNITS', value: data.assigned_units.join(', '), ratio: 1 },
      ]},
    ], gridX, y, gridW);
  } else {
    doc.setFontSize(FONT.SIZE_TABLE_BODY);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.setFont('courier', 'normal');
    doc.text('No units assigned', gridX + 2, y + 3);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    y += SPACING.XL;
  }

  drawSideTab(doc, 'UNITS', unitsStartY, y - unitsStartY);
  y += SPACING.SECTION_GAP;

  // ═══════════════════════════════════════════════════════════
  // FREE-FORM — GPS, Notes, Narrative, Attachments, Signatures
  // ═══════════════════════════════════════════════════════════

  // GPS Activity Log
  y = checkPageBreak(doc, y, 30, prio);
  { const sec = openAutoSection(doc, 'GPS Activity Log', y); y = sec.contentY;
    const trail = data.breadcrumb_trail;
    if (trail && trail.points.length > 0) {
      const stats = trail.stats;
      y = addThreeColumnFields(doc, [
        { label: 'Total Distance', value: `${stats.total_distance_miles} mi` },
        { label: 'Duration', value: `${stats.duration_minutes} min` },
        { label: 'Avg Speed', value: `${stats.avg_speed_mph} mph` },
        { label: 'Max Speed', value: `${stats.max_speed_mph} mph` },
        { label: 'Breadcrumb Points', value: String(stats.total_points) },
        { label: 'Sources', value: stats.source_breakdown
          ? Object.entries(stats.source_breakdown).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(', ')
          : '' },
      ], y);
      y += SPACING.SM;

      const maxRows = 50;
      const step = trail.points.length > maxRows ? Math.ceil(trail.points.length / maxRows) : 1;
      const sampled = trail.points.filter((_, i) => i % step === 0 || i === trail.points.length - 1);

      const colPositions = [lx, LAYOUT.PAGE_MARGIN + 38, LAYOUT.PAGE_MARGIN + 100, LAYOUT.PAGE_MARGIN + 130, LAYOUT.PAGE_MARGIN + 155];
      const tableHeaders = [
        { label: 'TIME', x: colPositions[0] },
        { label: 'LOCATION / ROAD', x: colPositions[1] },
        { label: 'SPEED', x: colPositions[2] },
        { label: 'SOURCE', x: colPositions[3] },
        { label: 'UNIT', x: colPositions[4] },
      ];
      const tableRows = sampled.map(p => {
        let timeStr = '';
        try {
          timeStr = new Date(p.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        } catch { timeStr = p.time; }
        let locationStr = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
        if (p.road_name) {
          locationStr = p.road_name;
          if (p.nearest_intersection) locationStr += ` / ${p.nearest_intersection}`;
        }
        return [
          timeStr,
          locationStr,
          p.speed_mph != null ? `${p.speed_mph} mph` : '-',
          (p.source || 'unknown').toUpperCase(),
          p.call_sign || '',
        ];
      });

      y = addTableWithShading(doc, tableHeaders, tableRows, y, colPositions);

      if (step > 1) {
        doc.setFontSize(5);
        doc.setTextColor(...COLOR.TEXT_TERTIARY);
        doc.text(`Showing ${sampled.length} of ${trail.points.length} breadcrumb points (sampled every ${step} points)`, lx, y + 1);
        doc.setTextColor(...COLOR.TEXT_PRIMARY);
        y += SPACING.MD;
      }
    } else {
      doc.setFontSize(FONT.SIZE_TABLE_BODY);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('No GPS breadcrumb data available for this call', lx, y);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      y += SPACING.XL;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Notes
  if (data.notes && data.notes.length > 0) {
    y = checkPageBreak(doc, y, 20, prio);
    const sec = openAutoSection(doc, 'Notes / Narrative', y); y = sec.contentY;
    const noteRows = data.notes.map(n => [
      fmtTimestamp(n.created_at),
      n.author || '',
      n.content || '',
    ]);
    y = addTableWithShading(
      doc,
      [
        { label: 'DATE/TIME', x: LAYOUT.PAGE_MARGIN + 5 },
        { label: 'AUTHOR', x: LAYOUT.PAGE_MARGIN + 45 },
        { label: 'NOTE', x: LAYOUT.PAGE_MARGIN + 80 },
      ],
      noteRows,
      y,
      [LAYOUT.PAGE_MARGIN + 5, LAYOUT.PAGE_MARGIN + 45, LAYOUT.PAGE_MARGIN + 80],
    );
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Narrative
  y = addNarrativeSection(doc, 'Narrative', data.narrative || '', y, prio);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signatures
  y = checkPageBreak(doc, y, 40, prio);
  { const sec = openAutoSection(doc, 'Signatures', y); y = sec.contentY;
    addSignatureBlock(doc, 'Reporting Officer', lx, y, hfw, getOfficerSig());
    y = addSignatureBlock(doc, 'Supervisor Review', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }
}

// ── Person Record ────────────────────────────────────────────

function generatePersonReport(doc: jsPDF, data: PersonPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);
  const hw = getHalfWidth(doc);

  // Determine priority — escalate if active warrants or BOLO
  const hasActiveWarrants = data.warrants && data.warrants.some(w => w.status === 'active');
  const prio = hasActiveWarrants ? 'critical' : data.bolo_active ? 'high' : 'routine';

  const personName = `${data.last_name}, ${data.first_name}`.toUpperCase();
  setActiveCaseNumber(personName);
  let y = addReportHeader(doc, personName, 'Individual Record', prio, undefined, { caseBoxLabel: 'INDIVIDUAL RECORD', useLogo: true });

  // ── ID Photo (passport-style, right-aligned) ──────────────
  if (data.id_photo) {
    const photoW = 25;
    const photoH = 32;
    const photoX = doc.internal.pageSize.getWidth() - LAYOUT.PAGE_MARGIN - photoW - SPACING.MD;
    addImageToPage(doc, data.id_photo, photoX, y - 3, photoW, photoH);
    doc.setDrawColor(...COLOR.BORDER_FIELD);
    doc.setLineWidth(BORDER.FIELD);
    doc.rect(photoX, y - 3, photoW, photoH);
  }

  // ── 1. Subject Identification ─────────────────────────────
  { const sec = openAutoSection(doc, 'Subject Identification', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Last Name', value: data.last_name },
      { label: 'First Name', value: data.first_name },
      { label: 'Middle Name', value: data.middle_name || '' },
      { label: 'Alias / Nickname', value: data.alias_nickname || '' },
      { label: 'Date of Birth', value: fmtDate(data.date_of_birth) },
      { label: 'Gender', value: data.gender || '' },
      { label: 'Race', value: data.race || '' },
      { label: 'Marital Status', value: data.marital_status || '' },
      { label: 'Citizenship', value: data.citizenship || '' },
      { label: 'Place of Birth', value: data.place_of_birth || '' },
      { label: 'Language', value: data.language || '' },
      { label: 'Record ID', value: data.id || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 2. Physical Description ───────────────────────────────
  y = checkPageBreak(doc, y, 45, prio);
  { const sec = openAutoSection(doc, 'Physical Description', y); y = sec.contentY;
    // Group 1: Body measurements
    y = addThreeColumnFields(doc, [
      { label: 'Height', value: data.height || '' },
      { label: 'Weight', value: data.weight || '' },
      { label: 'Build', value: data.build || '' },
      { label: 'Complexion', value: data.complexion || '' },
      { label: 'Blood Type', value: data.blood_type || '' },
      { label: 'Shoe Size', value: data.shoe_size || '' },
    ], y);
    y += SPACING.SM;
    // Group 2: Face & Hair
    y = addThreeColumnFields(doc, [
      { label: 'Hair Color', value: data.hair_color || '' },
      { label: 'Hair Length', value: data.hair_length || '' },
      { label: 'Hair Style', value: data.hair_style || '' },
      { label: 'Eye Color', value: data.eye_color || '' },
      { label: 'Facial Hair', value: data.facial_hair || '' },
      { label: 'Glasses', value: data.glasses || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 3. Scars / Marks / Tattoos ────────────────────────────
  y = addNarrativeSection(doc, 'Scars / Marks / Tattoos', data.scars_marks_tattoos || '', y, prio);

  // ── 4. Clothing Description ───────────────────────────────
  y = addNarrativeSection(doc, 'Clothing Description', data.clothing_description || '', y, prio);

  // ── 5. Contact Information ────────────────────────────────
  y = checkPageBreak(doc, y, 30, prio);
  { const sec = openAutoSection(doc, 'Contact Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Phone (Primary)', value: data.phone || '' },
      { label: 'Phone (Secondary)', value: data.phone_secondary || '' },
      { label: 'Email', value: data.email || '' },
    ], y);
    y = addFieldPair(doc, 'Address', `${data.address || ''}${data.city ? `, ${data.city}` : ''}${data.state ? `, ${data.state}` : ''} ${data.zip || ''}`.trim(), lx, y, ffw);
    if (data.social_media) {
      y = addFieldPair(doc, 'Social Media', data.social_media, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 6. Identification Documents ───────────────────────────
  y = checkPageBreak(doc, y, 30, prio);
  { const sec = openAutoSection(doc, 'Identification Documents', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'DL Number', value: data.dl_number || '' },
      { label: 'DL State', value: data.dl_state || '' },
      { label: 'DL Class', value: data.dl_class || '' },
      { label: 'DL Expiry', value: fmtDate(data.dl_expiry) },
      { label: 'ID Type', value: data.id_type || '' },
      { label: 'ID Number', value: data.id_number || '' },
      { label: 'ID State', value: data.id_state || '' },
      { label: 'ID Expiry', value: fmtDate(data.id_expiry) },
      { label: 'SSN Last 4', value: data.ssn_last4 ? `***-**-${data.ssn_last4}` : '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 7. Employment / Demographics ──────────────────────────
  y = checkPageBreak(doc, y, 18, prio);
  { const sec = openAutoSection(doc, 'Employment / Demographics', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Employer', value: data.employer || '' },
      { label: 'Occupation', value: data.occupation || '' },
      { label: 'Language', value: data.language || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 8. Flags & Warnings ───────────────────────────────────
  y = checkPageBreak(doc, y, 25, prio);
  { const sec = openAutoSection(doc, 'Flags & Warnings', y); y = sec.contentY;
    let fx2 = lx;
    fx2 = addCheckboxField(doc, 'Sex Offender', !!data.is_sex_offender, fx2, y);
    fx2 = addCheckboxField(doc, 'Veteran', !!data.is_veteran, fx2, y);
    addCheckboxField(doc, 'Active BOLO', !!data.bolo_active, fx2, y);
    y += SPACING.XL;
    addFieldPair(doc, 'Gang Affiliation', data.gang_affiliation || '', lx, y, hfw);
    y = addFieldPair(doc, 'Probation/Parole', `${data.probation_parole || ''}${data.probation_parole_officer ? ` (Officer: ${data.probation_parole_officer})` : ''}`.trim(), rx, y, hfw);
    if (data.known_associates) {
      y = addFieldPair(doc, 'Known Associates', data.known_associates, lx, y, ffw);
    }
    if (data.flags && data.flags.length > 0) {
      y = addFieldPair(doc, 'Active Flags', data.flags.join(', '), lx, y, ffw);
    }
    if (data.caution_flags) {
      y = addFieldPair(doc, 'Caution / Officer Safety', data.caution_flags, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 9. Emergency Contact ──────────────────────────────────
  y = checkPageBreak(doc, y, 18, prio);
  { const sec = openAutoSection(doc, 'Emergency Contact', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Name', value: data.emergency_contact_name || '' },
      { label: 'Phone', value: data.emergency_contact_phone || '' },
      { label: 'Relationship', value: data.emergency_contact_relationship || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 10. Active Warrants ───────────────────────────────────
  if (data.warrants && data.warrants.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    const sec = openAutoSection(doc, `Warrants (${data.warrants.length})`, y); y = sec.contentY;
    const warrantRows = data.warrants.map(w => [
      w.warrant_number || '—',
      (w.type || '').toUpperCase(),
      (w.status || '').toUpperCase(),
      w.charge_description || '—',
      (w.offense_level || '').toUpperCase(),
      fmtDate(w.date_issued),
    ]);
    y = addTableWithShading(
      doc,
      [
        { label: 'WARRANT #', x: LAYOUT.PAGE_MARGIN + 3 },
        { label: 'TYPE', x: LAYOUT.PAGE_MARGIN + 32 },
        { label: 'STATUS', x: LAYOUT.PAGE_MARGIN + 52 },
        { label: 'CHARGE', x: LAYOUT.PAGE_MARGIN + 75 },
        { label: 'LEVEL', x: LAYOUT.PAGE_MARGIN + 130 },
        { label: 'DATE', x: LAYOUT.PAGE_MARGIN + 155 },
      ],
      warrantRows,
      y,
      [LAYOUT.PAGE_MARGIN + 3, LAYOUT.PAGE_MARGIN + 32, LAYOUT.PAGE_MARGIN + 52, LAYOUT.PAGE_MARGIN + 75, LAYOUT.PAGE_MARGIN + 130, LAYOUT.PAGE_MARGIN + 155],
    );
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 11. Incident History ──────────────────────────────────
  if (data.incidents && data.incidents.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    const sec = openAutoSection(doc, `Incident History (${data.incidents.length})`, y); y = sec.contentY;
    const incidentRows = data.incidents.map(inc => [
      inc.incident_number || '—',
      (inc.incident_type || '').replace(/_/g, ' ').toUpperCase(),
      (inc.role || '').toUpperCase(),
      (inc.status || '').toUpperCase(),
      fmtDate(inc.created_at),
    ]);
    y = addTableWithShading(
      doc,
      [
        { label: 'INCIDENT #', x: LAYOUT.PAGE_MARGIN + 3 },
        { label: 'TYPE', x: LAYOUT.PAGE_MARGIN + 35 },
        { label: 'ROLE', x: LAYOUT.PAGE_MARGIN + 85 },
        { label: 'STATUS', x: LAYOUT.PAGE_MARGIN + 115 },
        { label: 'DATE', x: LAYOUT.PAGE_MARGIN + 150 },
      ],
      incidentRows,
      y,
      [LAYOUT.PAGE_MARGIN + 3, LAYOUT.PAGE_MARGIN + 35, LAYOUT.PAGE_MARGIN + 85, LAYOUT.PAGE_MARGIN + 115, LAYOUT.PAGE_MARGIN + 150],
    );
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 12. Citation History ──────────────────────────────────
  if (data.citations && data.citations.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    const sec = openAutoSection(doc, `Citations (${data.citations.length})`, y); y = sec.contentY;
    const citationRows = data.citations.map(c => [
      c.citation_number || '—',
      (c.type || '').toUpperCase(),
      (c.status || '').toUpperCase(),
      c.violation_description || c.statute_citation || '—',
      fmtDate(c.violation_date),
    ]);
    y = addTableWithShading(
      doc,
      [
        { label: 'CITATION #', x: LAYOUT.PAGE_MARGIN + 3 },
        { label: 'TYPE', x: LAYOUT.PAGE_MARGIN + 35 },
        { label: 'STATUS', x: LAYOUT.PAGE_MARGIN + 60 },
        { label: 'VIOLATION', x: LAYOUT.PAGE_MARGIN + 88 },
        { label: 'DATE', x: LAYOUT.PAGE_MARGIN + 155 },
      ],
      citationRows,
      y,
      [LAYOUT.PAGE_MARGIN + 3, LAYOUT.PAGE_MARGIN + 35, LAYOUT.PAGE_MARGIN + 60, LAYOUT.PAGE_MARGIN + 88, LAYOUT.PAGE_MARGIN + 155],
    );
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 13. Dispatch Call History ──────────────────────────────
  if (data.calls && data.calls.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    const sec = openAutoSection(doc, `Dispatch Calls (${data.calls.length})`, y); y = sec.contentY;
    const callRows = data.calls.map(c => [
      c.call_number || '—',
      (c.incident_type || '').replace(/_/g, ' ').toUpperCase(),
      (c.status || '').toUpperCase(),
      c.location || '—',
      fmtDate(c.created_at),
    ]);
    y = addTableWithShading(
      doc,
      [
        { label: 'CALL #', x: LAYOUT.PAGE_MARGIN + 3 },
        { label: 'TYPE', x: LAYOUT.PAGE_MARGIN + 30 },
        { label: 'STATUS', x: LAYOUT.PAGE_MARGIN + 72 },
        { label: 'LOCATION', x: LAYOUT.PAGE_MARGIN + 100 },
        { label: 'DATE', x: LAYOUT.PAGE_MARGIN + 155 },
      ],
      callRows,
      y,
      [LAYOUT.PAGE_MARGIN + 3, LAYOUT.PAGE_MARGIN + 30, LAYOUT.PAGE_MARGIN + 72, LAYOUT.PAGE_MARGIN + 100, LAYOUT.PAGE_MARGIN + 155],
    );
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 14. Notes ─────────────────────────────────────────────
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y, prio);

  // ── 15. Record Metadata ───────────────────────────────────
  y = checkPageBreak(doc, y, 15, prio);
  { const sec = openAutoSection(doc, 'Record Metadata', y); y = sec.contentY;
    addFieldPair(doc, 'Created', fmtTimestamp(data.created_at || ''), lx, y, hfw);
    y = addFieldPair(doc, 'Last Updated', fmtTimestamp(data.updated_at || ''), rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── 16. Attachments ───────────────────────────────────────
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'Attachments / Evidence Photos', prio);
  }

  // ── 17. Signature Block ───────────────────────────────────
  y = checkPageBreak(doc, y, 40, prio);
  addSignatureBlock(doc, 'Entering Officer', LAYOUT.PAGE_MARGIN, y, hw, getOfficerSig());
  addSignatureBlock(doc, 'Supervisor Review', LAYOUT.PAGE_MARGIN + hw + SPACING.LG, y, hw);
}

// ── Vehicle Record ───────────────────────────────────────────

function generateVehicleReport(doc: jsPDF, data: VehiclePdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);


  setActiveCaseNumber(data.license_plate || 'N/A');
  let y = addReportHeader(doc, data.license_plate || 'N/A', 'Vehicle Record', data.stolen_status === 'stolen' ? 'critical' : 'routine', undefined, { useLogo: true });

  // Vehicle Identification
  { const sec = openAutoSection(doc, 'Vehicle Identification', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'License Plate', value: data.license_plate },
      { label: 'Plate State', value: data.plate_state || '' },
      { label: 'Plate Type', value: data.plate_type || '' },
      { label: 'Year', value: data.year ? String(data.year) : '' },
      { label: 'Make', value: data.make || '' },
      { label: 'Model', value: data.model || '' },
      { label: 'Body Style', value: data.body_style || '' },
      { label: 'Trim', value: data.trim || '' },
      { label: 'Doors', value: data.doors ? String(data.doors) : '' },
      { label: 'Color', value: data.color || '' },
      { label: 'Secondary Color', value: data.secondary_color || '' },
      { label: 'VIN', value: data.vin || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Mechanical
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, 'Mechanical', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Engine Type', value: data.engine_type || '' },
      { label: 'Fuel Type', value: data.fuel_type || '' },
      { label: 'Transmission', value: data.transmission || '' },
      { label: 'Drive Type', value: data.drive_type || '' },
      { label: 'Odometer', value: data.odometer || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Owner Information
  y = checkPageBreak(doc, y, 22);
  { const sec = openAutoSection(doc, 'Owner Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Owner Name', data.owner_name || '', lx, y, ffw);
    addFieldPair(doc, 'Owner Address', data.owner_address || '', lx, y, hfw);
    y = addFieldPair(doc, 'Owner Phone', data.owner_phone || '', rx, y, hfw);
    let fx3 = lx;
    fx3 = addCheckboxField(doc, 'Commercial Vehicle', !!data.commercial_vehicle, fx3, y);
    addCheckboxField(doc, 'HAZMAT', !!data.hazmat, fx3, y);
    y += SPACING.XL;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Insurance & Registration
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Insurance & Registration', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Insurance Company', value: data.insurance_company || '' },
      { label: 'Policy Number', value: data.insurance_policy || '' },
      { label: 'Registration Expiry', value: fmtDate(data.registration_expiry) },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Legal Status
  y = checkPageBreak(doc, y, 25);
  { const sec = openAutoSection(doc, 'Legal Status', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Stolen Status', value: (data.stolen_status || 'Not Stolen').toUpperCase() },
      { label: 'Stolen Date', value: fmtDate(data.stolen_date) },
      { label: 'Recovery Date', value: fmtDate(data.recovery_date) },
      { label: 'Tow Status', value: data.tow_status || '' },
      { label: 'Tow Company', value: data.tow_company || '' },
      { label: 'Tow Date', value: fmtDate(data.tow_date) },
    ], y);
    // Lien Holder as full-width field (avoids orphaned single field in 3-col grid)
    y = addFieldPair(doc, 'Lien Holder', data.lien_holder || '', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Distinguishing Features
  y = addNarrativeSection(doc, 'Distinguishing Features', data.distinguishing_features || '', y);

  // Damage
  y = addNarrativeSection(doc, 'Damage Description', data.damage_description || '', y);

  // Flags
  if (data.flags && data.flags.length > 0) {
    y = checkPageBreak(doc, y, 12);
    y = addFieldPair(doc, 'Active Flags', data.flags.join(', '), lx, y, ffw);
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'Entering Officer', LAYOUT.PAGE_MARGIN, y, cw, getOfficerSig());
}

// ── Warrant ──────────────────────────────────────────────────

function generateWarrantReport(doc: jsPDF, data: WarrantPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);

  const statusPrio = data.status === 'active' ? 'critical' : data.status === 'served' ? 'low' : 'medium';

  setActiveCaseNumber(data.warrant_number);
  let y = addReportHeader(doc, data.warrant_number, 'Warrant', statusPrio, undefined, { useLogo: true });

  // Warrant Information
  { const sec = openAutoSection(doc, 'Warrant Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Warrant Number', value: data.warrant_number },
      { label: 'Type', value: (data.type || '').toUpperCase() },
      { label: 'Status', value: (data.status || '').toUpperCase() },
      { label: 'Offense Level', value: (data.offense_level || '').toUpperCase() },
    ], y);
    if (data.charge_description) {
      y = addFieldPair(doc, 'Charge Description', data.charge_description, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Subject Information
  y = checkPageBreak(doc, y, 35, statusPrio);
  { const sec = openAutoSection(doc, 'Subject Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Last Name', value: data.subject_last_name || '' },
      { label: 'First Name', value: data.subject_first_name || '' },
      { label: 'Date of Birth', value: fmtDate(data.subject_dob) },
      { label: 'Gender', value: data.subject_gender || '' },
      { label: 'Race', value: data.subject_race || '' },
      { label: 'Height', value: data.subject_height || '' },
      { label: 'Weight', value: data.subject_weight || '' },
      { label: 'Hair Color', value: data.subject_hair_color || '' },
      { label: 'Eye Color', value: data.subject_eye_color || '' },
    ], y);
    if (data.subject_address) {
      y = addFieldPair(doc, 'Address', data.subject_address, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Court Information
  y = checkPageBreak(doc, y, 20, statusPrio);
  { const sec = openAutoSection(doc, 'Court Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Issuing Court', value: data.issuing_court || '' },
      { label: 'Issuing Judge', value: data.issuing_judge || '' },
      { label: 'Bail Amount', value: fmtCurrency(data.bail_amount) },
      { label: 'Expiration Date', value: fmtDate(data.expires_at) },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Entry Information
  y = checkPageBreak(doc, y, 15, statusPrio);
  { const sec = openAutoSection(doc, 'Entry Information', y); y = sec.contentY;
    addFieldPair(doc, 'Entered By', data.entered_by_name || '', lx, y, hfw);
    y = addFieldPair(doc, 'Entry Date', fmtTimestamp(data.created_at), rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Service Information
  if (data.served_at || data.served_by_name) {
    y = checkPageBreak(doc, y, 18, statusPrio);
    const sec = openAutoSection(doc, 'Service Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Served By', value: data.served_by_name || '' },
      { label: 'Served Date', value: fmtTimestamp(data.served_at) },
      { label: 'Served Location', value: data.served_location || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y, statusPrio);

  // Signature Block
  y = checkPageBreak(doc, y, 40, statusPrio);
  const hw = getHalfWidth(doc);
  addSignatureBlock(doc, 'Entering Officer', LAYOUT.PAGE_MARGIN, y, hw, getOfficerSig());
  addSignatureBlock(doc, 'Serving Officer', LAYOUT.PAGE_MARGIN + hw + SPACING.LG, y, hw);
}

// ── Evidence / Property Custody Report ───────────────────────

function generateEvidenceReport(doc: jsPDF, data: EvidencePdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);
  const hw = getHalfWidth(doc);


  setActiveCaseNumber(data.evidence_number);
  let y = addReportHeader(doc, data.evidence_number, 'Evidence / Property Custody Report', 'medium', undefined, { useLogo: true });

  // Evidence Identification
  { const sec = openAutoSection(doc, 'Evidence Identification', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Evidence Number', value: data.evidence_number },
      { label: 'Type', value: (data.evidence_type || '').replace(/_/g, ' ').toUpperCase() },
      { label: 'Category', value: data.category || '' },
      { label: 'Related Incident', value: data.incident_number || '' },
      { label: 'Status', value: (data.status || '').replace(/_/g, ' ').toUpperCase() },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Description
  y = checkPageBreak(doc, y, 30);
  { const sec = openAutoSection(doc, 'Description', y); y = sec.contentY;
    if (data.description) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text('ITEM DESCRIPTION', lx, y);
      y += 3;
      doc.setFont('helvetica', 'normal');
      y = addWrappedText(doc, data.description, lx, y, ffw);
      y += SPACING.MD;
    }
    y = addThreeColumnFields(doc, [
      { label: 'Serial Number', value: data.serial_number || '' },
      { label: 'Brand', value: data.brand || '' },
      { label: 'Model', value: data.model || '' },
      { label: 'Dimensions', value: data.dimensions || '' },
      { label: 'Weight', value: data.weight || '' },
      { label: 'Estimated Value', value: fmtCurrency(data.estimated_value) },
      { label: 'Quantity', value: data.quantity != null ? String(data.quantity) : '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Collection Information — standardized 3-col + 2-col layout
  y = checkPageBreak(doc, y, 25);
  { const sec = openAutoSection(doc, 'Collection Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Collected By', value: data.collected_by || '' },
      { label: 'Collection Date', value: fmtTimestamp(data.collected_date) },
      { label: 'Packaging Type', value: data.packaging_type || '' },
    ], y);
    addFieldPair(doc, 'Location Found', data.location_found || '', lx, y, hfw);
    y = addFieldPair(doc, 'Photo Taken', data.photo_taken ? 'Yes' : 'No', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Storage
  y = checkPageBreak(doc, y, 12);
  { const sec = openAutoSection(doc, 'Storage', y); y = sec.contentY;
    addFieldPair(doc, 'Current Location', data.storage_location || '', lx, y, hfw);
    y = addFieldPair(doc, 'Status', (data.status || '').replace(/_/g, ' ').toUpperCase(), rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Chain of Custody
  if (data.chain_of_custody && data.chain_of_custody.length > 0) {
    y = checkPageBreak(doc, y, 25);
    const sec = openAutoSection(doc, 'Chain of Custody', y); y = sec.contentY;
    const custodyRows = data.chain_of_custody.map(c => [
      fmtTimestamp(c.timestamp),
      (c.action || '').toUpperCase(),
      c.from_person || '',
      c.to_person || '',
      c.reason || '',
    ]);
    y = addTableWithShading(
      doc,
      [
        { label: 'DATE/TIME', x: LAYOUT.PAGE_MARGIN + 3 },
        { label: 'ACTION', x: LAYOUT.PAGE_MARGIN + 38 },
        { label: 'FROM', x: LAYOUT.PAGE_MARGIN + 65 },
        { label: 'TO', x: LAYOUT.PAGE_MARGIN + 100 },
        { label: 'REASON', x: LAYOUT.PAGE_MARGIN + 135 },
      ],
      custodyRows,
      y,
      [LAYOUT.PAGE_MARGIN + 3, LAYOUT.PAGE_MARGIN + 38, LAYOUT.PAGE_MARGIN + 65, LAYOUT.PAGE_MARGIN + 100, LAYOUT.PAGE_MARGIN + 135],
    );
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Lab Analysis
  if (data.lab_submitted) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Lab Analysis', y); y = sec.contentY;
    let fx5 = lx;
    fx5 = addCheckboxField(doc, 'Submitted to Lab', true, fx5, y);
    y += SPACING.XL;
    addFieldPair(doc, 'Lab Name', data.lab_name || '', lx, y, hfw);
    y = addFieldPair(doc, 'Lab Case Number', data.lab_case_number || '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Disposition / Disposal
  if (data.disposal_method) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Disposition / Disposal', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Method', value: data.disposal_method },
      { label: 'Date', value: fmtDate(data.disposal_date) },
      { label: 'Authorized By', value: data.disposal_authorized_by || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'Collecting Officer', LAYOUT.PAGE_MARGIN, y, hw, getOfficerSig());
  addSignatureBlock(doc, 'Evidence Custodian', LAYOUT.PAGE_MARGIN + hw + SPACING.LG, y, hw);
}

// ── Fleet Vehicle Status Report ──────────────────────────────

function generateFleetReport(doc: jsPDF, data: FleetPdfData) {
  const lx = getLeftX();
  const ffw = getFullFieldWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const rx = getRightColumnX(doc);
  const cw = getContentWidth(doc);

  const reportType = data.report_type || 'status';
  const statusPrio = data.status === 'in_service' ? 'low' : data.status === 'maintenance' ? 'medium' : data.status === 'out_of_service' ? 'high' : 'routine';

  const reportTitles: Record<string, string> = {
    status: 'Fleet Vehicle Status Report',
    fuel_logs: 'Fleet Fuel Log Report',
    maintenance: 'Fleet Maintenance Report',
    mileage_summary: 'Fleet Mileage Summary Report',
  };

  setActiveCaseNumber(data.vehicle_number);
  let y = addReportHeader(doc, data.vehicle_number, reportTitles[reportType] || reportTitles.status, statusPrio, undefined, { useLogo: true });

  // Vehicle Information (compact for all report types)
  { const sec = openAutoSection(doc, 'Vehicle Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Unit Number', value: data.vehicle_number },
      { label: 'Make', value: data.make || '' },
      { label: 'Model', value: data.model || '' },
      { label: 'Year', value: data.year ? String(data.year) : '' },
      { label: 'Color', value: data.color || '' },
      { label: 'VIN', value: data.vin || '' },
      { label: 'Plate Number', value: data.plate_number || '' },
      { label: 'Plate State', value: data.plate_state || '' },
      { label: 'Status', value: (data.status || '').replace(/_/g, ' ').toUpperCase() },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Assignment — 2-column
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Assignment', y); y = sec.contentY;
    addFieldPair(doc, 'Assigned Unit', data.assigned_unit_call_sign || 'Unassigned', lx, y, hfw);
    y = addFieldPair(doc, 'Current Mileage', data.current_mileage ? data.current_mileage.toLocaleString() : '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── FUEL LOG REPORT ──
  if (reportType === 'fuel_logs' && data.fuel_logs && data.fuel_logs.length > 0) {
    y = checkPageBreak(doc, y, 30);
    const sec = openAutoSection(doc, `Fuel Logs (${data.fuel_logs.length} entries)`, y); y = sec.contentY;

    // Summary row
    const totalGal = data.fuel_logs.reduce((sum, f) => sum + (f.gallons || 0), 0);
    const totalCost = data.fuel_logs.reduce((sum, f) => sum + (f.total_cost || 0), 0);
    const avgEfficiency = data.fuel_logs.filter(f => f.efficiency).reduce((sum, f, _, arr) => sum + (f.efficiency || 0) / arr.length, 0);
    y = addThreeColumnFields(doc, [
      { label: 'Total Gallons', value: totalGal.toFixed(2) },
      { label: 'Total Cost', value: `$${totalCost.toFixed(2)}` },
      { label: 'Avg Efficiency', value: avgEfficiency > 0 ? `${avgEfficiency.toFixed(1)} MPG` : 'N/A' },
    ], y);
    y += 2;

    // Table header
    const colWidths = [22, 18, 24, 22, 28, cw - 114];
    const headers = ['Date', 'Gallons', 'Cost', 'Odometer', 'Efficiency', 'Station'];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    let xPos = lx;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], xPos, y);
      xPos += colWidths[i];
    }
    y += 3;
    doc.setDrawColor(100, 100, 100);
    doc.line(lx, y, lx + cw, y);
    y += 2;

    // Table rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    for (const f of data.fuel_logs) {
      y = checkPageBreak(doc, y, 5);
      xPos = lx;
      doc.text(fmtDate(f.fuel_date), xPos, y); xPos += colWidths[0];
      doc.text(f.gallons?.toFixed(2) || '', xPos, y); xPos += colWidths[1];
      doc.text(f.total_cost ? `$${f.total_cost.toFixed(2)}` : '', xPos, y); xPos += colWidths[2];
      doc.text(f.odometer_reading ? Number(f.odometer_reading).toLocaleString() : '', xPos, y); xPos += colWidths[3];
      doc.text(f.efficiency ? `${f.efficiency.toFixed(1)} MPG` : '', xPos, y); xPos += colWidths[4];
      doc.text((f.station || '').substring(0, 30), xPos, y);
      y += 4;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── MAINTENANCE REPORT ──
  if (reportType === 'maintenance' && data.maintenance_logs && data.maintenance_logs.length > 0) {
    y = checkPageBreak(doc, y, 30);
    const sec = openAutoSection(doc, `Maintenance Records (${data.maintenance_logs.length} entries)`, y); y = sec.contentY;

    // Summary row
    const totalCost = data.maintenance_logs.reduce((sum, m) => sum + (m.cost || 0), 0);
    const totalLabor = data.maintenance_logs.reduce((sum, m) => sum + (m.labor_cost || 0), 0);
    y = addThreeColumnFields(doc, [
      { label: 'Total Cost', value: `$${totalCost.toFixed(2)}` },
      { label: 'Total Labor', value: `$${totalLabor.toFixed(2)}` },
      { label: 'Records', value: String(data.maintenance_logs.length) },
    ], y);
    y += 2;

    // Table
    const colWidths = [22, 50, 20, 22, cw - 114];
    const headers = ['Date', 'Description', 'Cost', 'Odometer', 'Vendor'];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    let xPos = lx;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], xPos, y);
      xPos += colWidths[i];
    }
    y += 3;
    doc.setDrawColor(100, 100, 100);
    doc.line(lx, y, lx + cw, y);
    y += 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    for (const m of data.maintenance_logs) {
      y = checkPageBreak(doc, y, 5);
      xPos = lx;
      doc.text(fmtDate(m.service_date), xPos, y); xPos += colWidths[0];
      doc.text((m.description || '').substring(0, 45), xPos, y); xPos += colWidths[1];
      doc.text(m.cost ? `$${m.cost.toFixed(2)}` : '', xPos, y); xPos += colWidths[2];
      doc.text(m.odometer_reading ? Number(m.odometer_reading).toLocaleString() : '', xPos, y); xPos += colWidths[3];
      doc.text((m.vendor || '').substring(0, 30), xPos, y);
      y += 4;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── MILEAGE SUMMARY REPORT ──
  if (reportType === 'mileage_summary' && data.fuel_logs && data.fuel_logs.length > 0) {
    y = checkPageBreak(doc, y, 30);
    const sec = openAutoSection(doc, 'Daily Mileage Summary', y); y = sec.contentY;

    // Group fuel logs by date and calculate distance per day
    const byDate: Record<string, { distance: number; gallons: number; cost: number }> = {};
    for (const f of data.fuel_logs) {
      const dateKey = f.fuel_date?.split('T')[0] || 'Unknown';
      if (!byDate[dateKey]) byDate[dateKey] = { distance: 0, gallons: 0, cost: 0 };
      byDate[dateKey].distance += f.distance || 0;
      byDate[dateKey].gallons += f.gallons || 0;
      byDate[dateKey].cost += f.total_cost || 0;
    }

    const sortedDates = Object.keys(byDate).sort();
    const totalDist = sortedDates.reduce((s, d) => s + byDate[d].distance, 0);
    const totalGal = sortedDates.reduce((s, d) => s + byDate[d].gallons, 0);
    const totalCost = sortedDates.reduce((s, d) => s + byDate[d].cost, 0);

    y = addThreeColumnFields(doc, [
      { label: 'Total Distance', value: `${totalDist.toFixed(1)} mi` },
      { label: 'Total Fuel', value: `${totalGal.toFixed(2)} gal` },
      { label: 'Total Cost', value: `$${totalCost.toFixed(2)}` },
    ], y);
    y += 2;

    // Table
    const colWidths = [30, 30, 30, cw - 90];
    const headers = ['Date', 'Distance (mi)', 'Fuel (gal)', 'Cost'];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    let xPos = lx;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], xPos, y);
      xPos += colWidths[i];
    }
    y += 3;
    doc.setDrawColor(100, 100, 100);
    doc.line(lx, y, lx + cw, y);
    y += 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    for (const dateKey of sortedDates) {
      y = checkPageBreak(doc, y, 5);
      const d = byDate[dateKey];
      xPos = lx;
      doc.text(dateKey, xPos, y); xPos += colWidths[0];
      doc.text(d.distance > 0 ? d.distance.toFixed(1) : '-', xPos, y); xPos += colWidths[1];
      doc.text(d.gallons > 0 ? d.gallons.toFixed(2) : '-', xPos, y); xPos += colWidths[2];
      doc.text(d.cost > 0 ? `$${d.cost.toFixed(2)}` : '-', xPos, y);
      y += 4;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── STATUS REPORT (default) extras ──
  if (reportType === 'status') {
    // Compliance
    y = checkPageBreak(doc, y, 20);
    { const sec = openAutoSection(doc, 'Compliance & Service', y); y = sec.contentY;
      y = addThreeColumnFields(doc, [
        { label: 'Registration Expiry', value: fmtDate(data.registration_expiry) },
        { label: 'Insurance Expiry', value: fmtDate(data.insurance_expiry) },
        { label: 'Next Service Due', value: fmtDate(data.next_service_due) },
        { label: 'Last Service Date', value: fmtDate(data.last_service_date) },
      ], y);
      y = closeAutoSection(doc, sec.sectionY, y);
    }

    // Equipment
    if (data.equipment && data.equipment.length > 0) {
      y = checkPageBreak(doc, y, 15);
      const sec = openAutoSection(doc, 'Installed Equipment', y); y = sec.contentY;
      y = addFieldPair(doc, 'Equipment', data.equipment.join(', '), lx, y, ffw);
      y = closeAutoSection(doc, sec.sectionY, y);
    }
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y);

  // Signature Block
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'Fleet Manager', LAYOUT.PAGE_MARGIN, y, cw, getOfficerSig());
}

// ── Personnel / Officer Record ───────────────────────────────

function generatePersonnelReport(doc: jsPDF, data: PersonnelPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);
  const hw = getHalfWidth(doc);

  const reportType = data.report_type || 'full';

  setActiveCaseNumber(data.badge_number || data.employee_id || 'N/A');
  const reportTitle = reportType === 'credentials' ? 'Credentials Report'
    : reportType === 'training' ? 'Training Report'
    : reportType === 'equipment' ? 'Equipment Report'
    : reportType === 'time' ? 'Time & Attendance Report'
    : 'Personnel Record';
  let y = addReportHeader(doc, data.badge_number || data.employee_id || 'N/A', reportTitle, 'routine', undefined, { useLogo: true });

  // ── OFFICER IDENTIFICATION (always shown) ──
  { const sec = openAutoSection(doc, 'Officer Identification', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Last Name', value: data.last_name },
      { label: 'First Name', value: data.first_name },
      { label: 'Middle Name', value: data.middle_name || '' },
      { label: 'Badge Number', value: data.badge_number || '' },
      { label: 'Employee ID', value: data.employee_id || '' },
      { label: 'Rank', value: data.rank || '' },
      { label: 'Role', value: (data.role || '').toUpperCase() },
      { label: 'Department', value: data.department || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── FULL / DEFAULT sections ──
  if (reportType === 'full') {
    // Personal Information
    y = checkPageBreak(doc, y, 15);
    { const sec = openAutoSection(doc, 'Personal Information', y); y = sec.contentY;
      y = addThreeColumnFields(doc, [
        { label: 'Date of Birth', value: fmtDate(data.date_of_birth) },
        { label: 'Gender', value: data.gender || '' },
        { label: 'Blood Type', value: data.blood_type || '' },
      ], y);
      if (data.allergies) {
        y = addFieldPair(doc, 'Allergies', data.allergies, lx, y, ffw);
      }
      y = closeAutoSection(doc, sec.sectionY, y);
    }

    // Contact
    y = checkPageBreak(doc, y, 20);
    { const sec = openAutoSection(doc, 'Contact Information', y); y = sec.contentY;
      addFieldPair(doc, 'Phone', data.phone || '', lx, y, hfw);
      y = addFieldPair(doc, 'Email', data.email || '', rx, y, hfw);
      y = addFieldPair(doc, 'Address', `${data.address || ''}${data.city ? `, ${data.city}` : ''}${data.state ? `, ${data.state}` : ''} ${data.zip || ''}`.trim(), lx, y, ffw);
      y = closeAutoSection(doc, sec.sectionY, y);
    }

    // Employment
    y = checkPageBreak(doc, y, 20);
    { const sec = openAutoSection(doc, 'Employment', y); y = sec.contentY;
      addFieldPair(doc, 'Hire Date', fmtDate(data.hire_date), lx, y, hfw);
      y = addFieldPair(doc, 'Termination Date', fmtDate(data.termination_date), rx, y, hfw);
      addFieldPair(doc, 'Shift Preference', data.shift_preference || '', lx, y, hfw);
      y = addFieldPair(doc, 'Uniform Size', data.uniform_size || '', rx, y, hfw);
      y = closeAutoSection(doc, sec.sectionY, y);
    }

    // Identification
    y = checkPageBreak(doc, y, 15);
    { const sec = openAutoSection(doc, 'Identification', y); y = sec.contentY;
      y = addThreeColumnFields(doc, [
        { label: 'DL Number', value: data.dl_number || '' },
        { label: 'DL State', value: data.dl_state || '' },
        { label: 'DL Expiry', value: fmtDate(data.dl_expiry) },
      ], y);
      y = closeAutoSection(doc, sec.sectionY, y);
    }

    // Emergency Contact
    y = checkPageBreak(doc, y, 15);
    { const sec = openAutoSection(doc, 'Emergency Contact', y); y = sec.contentY;
      y = addThreeColumnFields(doc, [
        { label: 'Name', value: data.emergency_contact_name || '' },
        { label: 'Phone', value: data.emergency_contact_phone || '' },
        { label: 'Relationship', value: data.emergency_contact_relationship || '' },
      ], y);
      y = closeAutoSection(doc, sec.sectionY, y);
    }

    // Certifications
    y = addNarrativeSection(doc, 'Certifications', data.certifications || '', y);
  }

  // ── CREDENTIALS TABLE ──
  if ((reportType === 'full' || reportType === 'credentials') && data.credentials && data.credentials.length > 0) {
    y = checkPageBreak(doc, y, 25);
    const sec = openAutoSection(doc, `Credentials (${data.credentials.length})`, y); y = sec.contentY;

    const colWidths = [cw * 0.22, cw * 0.18, cw * 0.22, cw * 0.14, cw * 0.14, cw * 0.10];
    const headers = ['Type', 'Number', 'Issuing Authority', 'Issued', 'Expiry', 'Status'];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    let xPos = lx;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], xPos, y);
      xPos += colWidths[i];
    }
    y += 3;
    doc.setDrawColor(100, 100, 100);
    doc.line(lx, y, lx + cw, y);
    y += 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    for (const c of data.credentials) {
      y = checkPageBreak(doc, y, 5);
      xPos = lx;
      doc.text((c.type || '').substring(0, 28), xPos, y); xPos += colWidths[0];
      doc.text((c.credential_number || '').substring(0, 22), xPos, y); xPos += colWidths[1];
      doc.text((c.issuing_authority || '').substring(0, 28), xPos, y); xPos += colWidths[2];
      doc.text(fmtDate(c.issued_date), xPos, y); xPos += colWidths[3];
      doc.text(fmtDate(c.expiry_date), xPos, y); xPos += colWidths[4];
      // Color-code status
      if (c.status === 'expired') doc.setTextColor(200, 50, 50);
      else if (c.status === 'expiring_soon') doc.setTextColor(200, 150, 50);
      doc.text((c.status || '').toUpperCase(), xPos, y);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      y += 4;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── TRAINING RECORDS TABLE ──
  if ((reportType === 'full' || reportType === 'training') && data.training_records && data.training_records.length > 0) {
    y = checkPageBreak(doc, y, 25);
    const sec = openAutoSection(doc, `Training Records (${data.training_records.length})`, y); y = sec.contentY;

    // Summary stats
    const totalHours = data.training_records.reduce((s, t) => s + (t.hours || 0), 0);
    const completedCount = data.training_records.filter(t => t.status === 'completed').length;
    y = addThreeColumnFields(doc, [
      { label: 'Total Courses', value: String(data.training_records.length) },
      { label: 'Completed', value: String(completedCount) },
      { label: 'Total Hours', value: totalHours.toFixed(1) },
    ], y);
    y += 2;

    const colWidths = [cw * 0.28, cw * 0.14, cw * 0.20, cw * 0.12, cw * 0.10, cw * 0.08, cw * 0.08];
    const headers = ['Course', 'Category', 'Provider', 'Completed', 'Expiry', 'Hours', 'Status'];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    let xPos = lx;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], xPos, y);
      xPos += colWidths[i];
    }
    y += 3;
    doc.setDrawColor(100, 100, 100);
    doc.line(lx, y, lx + cw, y);
    y += 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    for (const t of data.training_records) {
      y = checkPageBreak(doc, y, 5);
      xPos = lx;
      doc.text((t.course_name || '').substring(0, 35), xPos, y); xPos += colWidths[0];
      doc.text((t.category || '').substring(0, 16), xPos, y); xPos += colWidths[1];
      doc.text((t.provider || '').substring(0, 24), xPos, y); xPos += colWidths[2];
      doc.text(fmtDate(t.completed_date), xPos, y); xPos += colWidths[3];
      doc.text(fmtDate(t.expiry_date), xPos, y); xPos += colWidths[4];
      doc.text(String(t.hours || 0), xPos, y); xPos += colWidths[5];
      doc.text((t.status || '').toUpperCase().substring(0, 10), xPos, y);
      y += 4;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── EQUIPMENT TABLE ──
  if ((reportType === 'full' || reportType === 'equipment') && data.equipment_list && data.equipment_list.length > 0) {
    y = checkPageBreak(doc, y, 25);
    const sec = openAutoSection(doc, `Assigned Equipment (${data.equipment_list.length})`, y); y = sec.contentY;

    const colWidths = [cw * 0.20, cw * 0.18, cw * 0.18, cw * 0.14, cw * 0.14, cw * 0.16];
    const headers = ['Type', 'Serial #', 'Make / Model', 'Condition', 'Status', 'Issued'];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    let xPos = lx;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], xPos, y);
      xPos += colWidths[i];
    }
    y += 3;
    doc.setDrawColor(100, 100, 100);
    doc.line(lx, y, lx + cw, y);
    y += 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    for (const eq of data.equipment_list) {
      y = checkPageBreak(doc, y, 5);
      xPos = lx;
      doc.text((eq.equipment_type || '').substring(0, 24), xPos, y); xPos += colWidths[0];
      doc.text((eq.serial_number || '').substring(0, 22), xPos, y); xPos += colWidths[1];
      doc.text([eq.make, eq.model].filter(Boolean).join(' ').substring(0, 22), xPos, y); xPos += colWidths[2];
      doc.text((eq.condition || '').toUpperCase(), xPos, y); xPos += colWidths[3];
      doc.text((eq.status || '').toUpperCase(), xPos, y); xPos += colWidths[4];
      doc.text(fmtDate(eq.issued_date), xPos, y);
      y += 4;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── BODY CAMERAS TABLE ──
  if ((reportType === 'full' || reportType === 'equipment') && data.body_cameras && data.body_cameras.length > 0) {
    y = checkPageBreak(doc, y, 25);
    const sec = openAutoSection(doc, `Body Cameras (${data.body_cameras.length})`, y); y = sec.contentY;

    const colWidths = [cw * 0.18, cw * 0.20, cw * 0.20, cw * 0.14, cw * 0.14, cw * 0.14];
    const headers = ['Camera ID', 'Make', 'Model', 'Status', 'Condition', 'Assigned'];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    let xPos = lx;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], xPos, y);
      xPos += colWidths[i];
    }
    y += 3;
    doc.setDrawColor(100, 100, 100);
    doc.line(lx, y, lx + cw, y);
    y += 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    for (const cam of data.body_cameras) {
      y = checkPageBreak(doc, y, 5);
      xPos = lx;
      doc.text((cam.camera_id || '').substring(0, 22), xPos, y); xPos += colWidths[0];
      doc.text((cam.make || '').substring(0, 24), xPos, y); xPos += colWidths[1];
      doc.text((cam.model || '').substring(0, 24), xPos, y); xPos += colWidths[2];
      doc.text((cam.status || '').toUpperCase(), xPos, y); xPos += colWidths[3];
      doc.text((cam.condition || '').toUpperCase(), xPos, y); xPos += colWidths[4];
      doc.text(fmtDate(cam.assigned_at), xPos, y);
      y += 4;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── DEPLOYMENTS TABLE ──
  if ((reportType === 'full') && data.deployments && data.deployments.length > 0) {
    y = checkPageBreak(doc, y, 25);
    const sec = openAutoSection(doc, `Deployments (${data.deployments.length})`, y); y = sec.contentY;

    const colWidths = [cw * 0.28, cw * 0.14, cw * 0.16, cw * 0.16, cw * 0.12, cw * 0.14];
    const headers = ['Property', 'Position', 'Start', 'End', 'Hrs/Wk', 'Status'];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    let xPos = lx;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], xPos, y);
      xPos += colWidths[i];
    }
    y += 3;
    doc.setDrawColor(100, 100, 100);
    doc.line(lx, y, lx + cw, y);
    y += 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    for (const d of data.deployments) {
      y = checkPageBreak(doc, y, 5);
      xPos = lx;
      doc.text((d.property_name || '').substring(0, 35), xPos, y); xPos += colWidths[0];
      doc.text((d.position || '').substring(0, 16), xPos, y); xPos += colWidths[1];
      doc.text(fmtDate(d.start_date), xPos, y); xPos += colWidths[2];
      doc.text(fmtDate(d.end_date), xPos, y); xPos += colWidths[3];
      doc.text(d.hours_per_week != null ? String(d.hours_per_week) : '', xPos, y); xPos += colWidths[4];
      doc.text((d.status || '').toUpperCase(), xPos, y);
      y += 4;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── TIME & ATTENDANCE TABLE ──
  if ((reportType === 'full' || reportType === 'time') && data.time_entries && data.time_entries.length > 0) {
    y = checkPageBreak(doc, y, 25);
    const totalHours = data.time_entries.reduce((s, t) => s + (t.total_hours || 0), 0);
    const sec = openAutoSection(doc, `Time & Attendance (${data.time_entries.length} entries — ${totalHours.toFixed(1)} hrs)`, y); y = sec.contentY;

    const colWidths = [cw * 0.30, cw * 0.30, cw * 0.20, cw * 0.20];
    const headers = ['Clock In', 'Clock Out', 'Hours', 'Status'];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    let xPos = lx;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], xPos, y);
      xPos += colWidths[i];
    }
    y += 3;
    doc.setDrawColor(100, 100, 100);
    doc.line(lx, y, lx + cw, y);
    y += 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    for (const t of data.time_entries) {
      y = checkPageBreak(doc, y, 5);
      xPos = lx;
      doc.text(fmtDateTime(t.clock_in), xPos, y); xPos += colWidths[0];
      doc.text(t.clock_out ? fmtDateTime(t.clock_out) : 'Active', xPos, y); xPos += colWidths[1];
      doc.text(t.total_hours != null ? t.total_hours.toFixed(2) : '-', xPos, y); xPos += colWidths[2];
      doc.text((t.status || '').toUpperCase(), xPos, y);
      y += 4;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'HR / Supervisor', LAYOUT.PAGE_MARGIN, y, hw);
  addSignatureBlock(doc, 'Officer', LAYOUT.PAGE_MARGIN + hw + SPACING.LG, y, hw, getOfficerSig());
}

// ── Property Record ──────────────────────────────────────────

function generatePropertyReport(doc: jsPDF, data: PropertyPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);


  setActiveCaseNumber(data.name || 'N/A');
  let y = addReportHeader(doc, data.name || 'N/A', 'Property Record', 'routine', undefined, { useLogo: true });

  // Property Information
  { const sec = openAutoSection(doc, 'Property Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Property Name', value: data.name },
      { label: 'Client', value: data.client_name || '' },
      { label: 'Property Type', value: data.property_type || '' },
      { label: 'Status', value: data.is_active ? 'ACTIVE' : 'INACTIVE' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Location
  y = checkPageBreak(doc, y, 22);
  { const sec = openAutoSection(doc, 'Location', y); y = sec.contentY;
    y = addFieldPair(doc, 'Address', `${data.address || ''}${data.city ? `, ${data.city}` : ''}${data.state ? `, ${data.state}` : ''} ${data.zip || ''}`.trim(), lx, y, ffw);
    addFieldPair(doc, 'Latitude', data.latitude != null ? String(data.latitude) : '', lx, y, hfw);
    y = addFieldPair(doc, 'Longitude', data.longitude != null ? String(data.longitude) : '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Access & Security
  y = checkPageBreak(doc, y, 22);
  { const sec = openAutoSection(doc, 'Access & Security', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Gate Code', value: data.gate_code || '' },
      { label: 'Alarm Code', value: data.alarm_code || '' },
      { label: 'Emergency Contact', value: data.emergency_contact || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Access Instructions
  y = addNarrativeSection(doc, 'Access Instructions', data.access_instructions || '', y);

  // Post Orders
  y = addNarrativeSection(doc, 'Post Orders', data.post_orders || '', y);

  // Hazard Notes
  y = addNarrativeSection(doc, 'Hazard Notes', data.hazard_notes || '', y);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'Officer', LAYOUT.PAGE_MARGIN, y, cw, getOfficerSig());
}

// ── Citation Report ──────────────────────────────────────────

function generateCitationReport(doc: jsPDF, data: CitationPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);
  const hw = getHalfWidth(doc);

  // Map citation type to a priority for the standard classification bar
  const typePrioMap: Record<string, string> = {
    traffic: 'medium',
    criminal: 'critical',
    parking: 'low',
    warning: 'routine',
  };
  const prio = typePrioMap[data.type] || 'routine';

  // Header (uses the standard report header + classification bar)

  setActiveCaseNumber(data.citation_number);
  let y = addReportHeader(doc, data.citation_number, 'Citation / Summons', prio, undefined, { useLogo: true });

  // Citation Information
  { const sec = openAutoSection(doc, 'Citation Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Citation Number', value: data.citation_number },
      { label: 'Type', value: (data.type || '').replace(/_/g, ' ').toUpperCase() },
      { label: 'Status', value: (data.status || '').replace(/_/g, ' ').toUpperCase() },
    ], y);
    y = addThreeColumnFields(doc, [
      { label: 'Date of Violation', value: data.violation_date || '' },
      { label: 'Time', value: data.violation_time || '' },
      { label: 'Location', value: data.location || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Violation Details
  y = checkPageBreak(doc, y, 30);
  { const sec = openAutoSection(doc, 'Violation Details', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Statute / Code', value: data.statute_citation || '' },
      { label: 'Offense Level', value: (data.offense_level || '').replace(/_/g, ' ').toUpperCase() },
      { label: 'Fine Amount', value: data.fine_amount != null ? fmtCurrency(data.fine_amount) : '' },
    ], y);
    if (data.violation_description) {
      y = addFieldPair(doc, 'Violation Description', data.violation_description, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Subject Information
  y = checkPageBreak(doc, y, 30);
  { const sec = openAutoSection(doc, 'Subject Information', y); y = sec.contentY;
    addFieldPair(doc, 'Name', data.person_name || '', lx, y, hfw);
    y = addFieldPair(doc, 'Date of Birth', fmtDate(data.person_dob), rx, y, hfw);
    addFieldPair(doc, "Driver's License", data.person_dl || '', lx, y, hfw);
    y = addFieldPair(doc, 'Address', data.person_address || '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Vehicle Information
  if (data.vehicle_description || data.vehicle_plate) {
    y = checkPageBreak(doc, y, 25);
    const sec = openAutoSection(doc, 'Vehicle Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Vehicle Description', value: data.vehicle_description || '' },
      { label: 'Plate', value: data.vehicle_plate || '' },
      { label: 'State', value: data.vehicle_state || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Issuing Officer
  y = checkPageBreak(doc, y, 25);
  { const sec = openAutoSection(doc, 'Issuing Officer', y); y = sec.contentY;
    addFieldPair(doc, 'Officer Name', data.issuing_officer_name || '', lx, y, hfw);
    y = addFieldPair(doc, 'Badge Number', data.badge_number || '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Court Information
  if (data.court_name || data.court_date) {
    y = checkPageBreak(doc, y, 25);
    const sec = openAutoSection(doc, 'Court Information', y); y = sec.contentY;
    addFieldPair(doc, 'Court Name', data.court_name || '', lx, y, hfw);
    y = addFieldPair(doc, 'Court Date', fmtDate(data.court_date), rx, y, hfw);
    if (data.court_address) {
      y = addFieldPair(doc, 'Court Address', data.court_address, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y, prio);

  // Dual Signature Block — Officer and Recipient
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'Issuing Officer', LAYOUT.PAGE_MARGIN, y, hw, getOfficerSig());
  addSignatureBlock(doc, 'Recipient', LAYOUT.PAGE_MARGIN + hw + SPACING.LG, y, hw);
}

// ── Public API ───────────────────────────────────────────────

type RecordDataMap = {
  call: CallPdfData;
  person: PersonPdfData;
  vehicle: VehiclePdfData;
  warrant: WarrantPdfData;
  evidence: EvidencePdfData;
  fleet: FleetPdfData;
  personnel: PersonnelPdfData;
  property: PropertyPdfData;
  citation: CitationPdfData;
};

export function generateRecordPdf<T extends RecordPdfType>(
  recordType: T,
  data: RecordDataMap[T],
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  // Set form key for footer form numbers
  setActiveFormKey(recordType);

  // Set generation timestamp
  setGenerationTimestamp(new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }));

  // Watermark on first page
  addConfidentialWatermark(doc);
  // @ts-expect-error jsPDF GState — safety reset after watermark
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  switch (recordType) {
    case 'call':
      generateCallReport(doc, data as CallPdfData);
      break;
    case 'person':
      generatePersonReport(doc, data as PersonPdfData);
      break;
    case 'vehicle':
      generateVehicleReport(doc, data as VehiclePdfData);
      break;
    case 'warrant':
      generateWarrantReport(doc, data as WarrantPdfData);
      break;
    case 'evidence':
      generateEvidenceReport(doc, data as EvidencePdfData);
      break;
    case 'fleet':
      generateFleetReport(doc, data as FleetPdfData);
      break;
    case 'personnel':
      generatePersonnelReport(doc, data as PersonnelPdfData);
      break;
    case 'property':
      generatePropertyReport(doc, data as PropertyPdfData);
      break;
    case 'citation':
      generateCitationReport(doc, data as CitationPdfData);
      break;
    default:
      throw new Error(`Unknown record type: ${recordType}`);
  }

  // Add page footers and watermarks to all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages);
    if (i > 1) {
      addConfidentialWatermark(doc);
    }
  }

  return doc;
}

/** Download record PDF — async to fetch admin branding + seal first */
export async function downloadRecordPdf<T extends RecordPdfType>(
  recordType: T,
  data: RecordDataMap[T],
  identifier?: string,
) {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();

  // Extract officer digital signature from enriched data
  const anyData = data as any;
  if (anyData._officerSignature) {
    setActiveOfficerSignature({
      signatureImage: anyData._officerSignature,
      printedName: anyData.officer_name || anyData.full_name || anyData.issuing_officer_name || '',
      badgeNumber: anyData.badge_number || '',
    });
  } else {
    setActiveOfficerSignature(undefined);
  }

  const doc = generateRecordPdf(recordType, data);
  setActiveOfficerSignature(undefined); // clear after generation
  const id = identifier || 'record';
  const filename = `${id}_${recordType}.pdf`;
  doc.save(filename);
}

/** Generate record PDF and return a blob URL for in-app preview */
export async function generateRecordPdfBlobUrl<T extends RecordPdfType>(
  recordType: T,
  data: RecordDataMap[T],
): Promise<string> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();

  // Extract officer digital signature from enriched data
  const anyData = data as any;
  if (anyData._officerSignature) {
    setActiveOfficerSignature({
      signatureImage: anyData._officerSignature,
      printedName: anyData.officer_name || anyData.full_name || anyData.issuing_officer_name || '',
      badgeNumber: anyData.badge_number || '',
    });
  } else {
    setActiveOfficerSignature(undefined);
  }

  const doc = generateRecordPdf(recordType, data);
  setActiveOfficerSignature(undefined); // clear after generation
  const blob = doc.output('blob');
  return URL.createObjectURL(blob);
}
