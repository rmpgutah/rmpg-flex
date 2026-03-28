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
  addStackedSignatures,
  addFlagBadges,
  addCautionBlock,
  addTableWithShading,
  addThreeColumnFields,
  addWrappedText,
  addFormattedText,
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
  formSectionPageBreak,
  sanitizePdfText,
} from './pdfGenerator';
import type { PdfImage, PdfSignatureData } from './pdfGenerator';
import {
  LAYOUT, SPACING, FONT, COLOR, BORDER,
  getContentWidth, getHalfWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth, getQuarterWidth,
} from './pdfTokens';
import {
  drawCheckboxGrid, drawNibrsHeader, drawFormSection,
  type CheckboxItem, type FormRow,
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
  incident_number?: string;
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
  pso_attempt_number?: number;
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
  responding_vehicle_id?: string;
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
  // Linked persons (from call_persons join)
  linked_persons?: { role: string; first_name: string; last_name: string; dob?: string; race?: string; gender?: string; phone?: string }[];
  // Linked vehicles (from call_vehicles join)
  linked_vehicles?: { role: string; plate_number?: string; plate_state?: string; year?: number; color?: string; make?: string; model?: string; vin?: string; owner_first_name?: string; owner_last_name?: string; stolen_status?: string }[];
  attachment_images?: PdfImage[];
  // GPS breadcrumb trail
  breadcrumb_trail?: {
    points: { lat: number; lng: number; timestamp: string; speed_mph?: number; source?: string }[];
    stats: {
      total_distance_miles: number;
      duration_minutes: number;
      avg_speed_mph: number;
      max_speed_mph: number;
      total_points: number;
      source_breakdown?: Record<string, number>;
    };
  };
  // Visit history (PSO return visits)
  visit_history?: {
    visit_number: number;
    status: string;
    dispatched_at?: string;
    enroute_at?: string;
    onscene_at?: string;
    cleared_at?: string;
    closed_at?: string;
    assigned_units?: string;
    responding_vehicle_id?: string;
    starting_mileage?: number;
    ending_mileage?: number;
    disposition?: string;
    note?: string;
    created_by?: string;
    created_at: string;
  }[];
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

export interface PersonCriminalHistoryRecord {
  record_type: string;
  offense: string | null;
  offense_level: string | null;
  statute: string | null;
  case_number: string | null;
  agency: string | null;
  jurisdiction: string | null;
  offense_date: string | null;
  disposition: string | null;
  disposition_date: string | null;
  sentence: string | null;
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
  // Criminal History (fetched from /criminal-history endpoint)
  criminal_records?: PersonCriminalHistoryRecord[];
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

/** Format: MM/DD/YYYY @ HH:MM:SS AM/PM */
/** Convert a date to Mountain Time components */
function toMountain(d: Date): { mm: string; dd: string; yyyy: number; hh: string; min: string; sec: string } {
  const mt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  const mm = String(mt.getMonth() + 1).padStart(2, '0');
  const dd = String(mt.getDate()).padStart(2, '0');
  const yyyy = mt.getFullYear();
  const hh = String(mt.getHours()).padStart(2, '0');
  return { mm, dd, yyyy, hh, min: String(mt.getMinutes()).padStart(2, '0'), sec: String(mt.getSeconds()).padStart(2, '0') };
}

function fmtTimestamp(ts?: string): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const { mm, dd, yyyy, hh, min, sec } = toMountain(d);
    return `${mm}/${dd}/${yyyy} @ ${hh}:${min}:${sec}`;
  } catch { return ts; }
}

/** Format: MM/DD/YYYY */
function fmtDate(ts?: string | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const { mm, dd, yyyy } = toMountain(d);
    return `${mm}/${dd}/${yyyy}`;
  } catch { return ts; }
}

/** Format: MM/DD/YYYY @ HH:MM:SS (military time) */
function fmtDateTime(ts?: string | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const { mm, dd, yyyy, hh, min, sec } = toMountain(d);
    return `${mm}/${dd}/${yyyy} @ ${hh}:${min}:${sec}`;
  } catch { return ts; }
}

function fmtCurrency(val?: number): string {
  if (val == null) return '';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

/** Capitalize the first letter of each word (e.g., "suspect" → "Suspect", "co owner" → "Co Owner") */
function titleCase(str: string): string {
  if (!str) return '';
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// ── Call for Service Report ──────────────────────────────────

function generateCallReport(doc: jsPDF, data: CallPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const prio = callPriorityLabel(data.priority);

  setActiveCaseNumber(data.call_number);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'CALL FOR SERVICE REPORT',
    formNumber: 'FORM PS-201',
    caseNumber: data.call_number,
    caseNumberLabel: 'CALL FOR SERVICE',
    reportDate: fmtTimestamp(data.created_at || ''),
  });

  // Incident Report number is shown in Classification section — no separate banner needed

  // ── Dispatch District Info Bar (gold columns — below header) ──
  {
    const cw = getContentWidth(doc);
    const barY = y;
    const hasContract = !!(data.contract_id && data.incident_type === 'pso_client_request');
    const numCols = hasContract ? 6 : 5;
    const barH = 8;
    // Black background with white text
    doc.setFillColor(0, 0, 0);
    doc.rect(LAYOUT.PAGE_MARGIN, barY, cw, barH, 'F');

    const distFields = [
      { label: 'SECTION', value: data.section_name || '--' },
      { label: 'ZONE', value: data.zone_name || '--' },
      { label: 'BEAT', value: data.beat_id || '--' },
      { label: 'AREA', value: data.beat_descriptor || '--' },
      { label: 'CODE', value: data.dispatch_code || '--' },
      ...(hasContract ? [{ label: 'CONTRACT ID', value: data.contract_id || '--' }] : []),
    ];

    // Dynamic column widths — measure all values, no truncation
    const dValSize = 6; // compact font for district bar
    const dPad = 2; // tight padding — columns close together
    doc.setFont('courier', 'normal');
    doc.setFontSize(dValSize);
    // Measure each column's natural width
    const naturalWidths = distFields.map((f) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      const labelW = doc.getTextWidth(f.label);
      doc.setFont('courier', 'normal');
      doc.setFontSize(dValSize);
      const valW = doc.getTextWidth(sanitizePdfText(f.value));
      return Math.max(labelW, valW) + dPad;
    });
    // Scale proportionally to fill exactly cw
    const totalNat = naturalWidths.reduce((a, b) => a + b, 0);
    const finalWidths = naturalWidths.map(w => (w / totalNat) * cw);

    let colX = LAYOUT.PAGE_MARGIN;
    distFields.forEach((f, i) => {
      const fw = finalWidths[i];
      const fx = colX + 1.5;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5);
      doc.setTextColor(255, 255, 255);
      doc.text(f.label, fx, barY + 2.8);
      doc.setFont('courier', 'bold');
      doc.setFontSize(dValSize);
      doc.setTextColor(255, 255, 255);
      doc.text(sanitizePdfText(f.value), fx, barY + 6.5);
      colX += fw;
    });

    y = barY + barH + 1.5;
  }

  // Classification
  { const sec = openAutoSection(doc, 'Classification', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Call Number', value: data.call_number },
      { label: 'Incident Type', value: (data.incident_type || '').replace(/_/g, ' ').toUpperCase() },
      { label: 'Priority', value: data.priority },
      { label: 'Status', value: (data.status || '').toUpperCase() },
      { label: 'Source', value: (data.source || '').replace(/_/g, ' ').toUpperCase() },
      { label: 'Dispatch Code', value: data.dispatch_code || '' },
      { label: 'Disposition', value: data.disposition || '' },
      { label: 'Case Number', value: data.case_number || '' },
      { label: 'Incident Number', value: data.incident_number || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Date / Time — 3-column grid (6 timestamps in 2 rows of 3)
  y = checkPageBreak(doc, y, 15, prio);
  { const sec = openAutoSection(doc, 'Date / Time', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Created', value: fmtTimestamp(data.created_at || '') },
      { label: 'Dispatched', value: fmtTimestamp(data.dispatched_at || '') },
      { label: 'Enroute', value: fmtTimestamp(data.enroute_at || '') },
      { label: 'On Scene', value: fmtTimestamp(data.onscene_at || '') },
      { label: 'Cleared', value: fmtTimestamp(data.cleared_at || '') },
      { label: 'Closed', value: fmtTimestamp(data.closed_at || '') },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Caller Information
  y = checkPageBreak(doc, y, 12, prio);
  { const sec = openAutoSection(doc, 'Caller Information', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Caller Name', data.caller_name || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'Phone', data.caller_phone || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    { const rel = data.caller_relationship || '';
      const yL = addFieldPair(doc, 'Relationship', rel.charAt(0).toUpperCase() + rel.slice(1), lx, y, hfw);
      const yR = addFieldPair(doc, 'Caller Address', data.caller_address || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // PSO Client Request Details — right after Caller Information
  if (data.incident_type === 'pso_client_request') {
    y = checkPageBreak(doc, y, 12, prio);
    const attemptNum = data.pso_attempt_number || 1;
    const attemptLabel = attemptNum > 1
      ? ` -- ${attemptNum === 2 ? '2nd' : attemptNum === 3 ? '3rd' : attemptNum + 'th'} Attempt`
      : '';
    const psoSec = openAutoSection(doc, `PSO Client Request Details${attemptLabel}`, y); y = psoSec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Service Type', value: (data.pso_service_type || '').replace(/_/g, ' ').toUpperCase() },
      { label: 'Authorization / PO#', value: data.pso_authorization || '' },
      { label: 'Billing Code', value: data.pso_billing_code || '' },
    ], y);
    y = addThreeColumnFields(doc, [
      { label: 'Requestor Name', value: data.pso_requestor_name || '' },
      { label: 'Requestor Phone', value: data.pso_requestor_phone || '' },
      { label: 'Requestor Email', value: data.pso_requestor_email || '' },
    ], y);
    y = closeAutoSection(doc, psoSec.sectionY, y, undefined, psoSec.sectionPage);

    // Process Service sub-section
    if (data.pso_service_type === 'process_service' || data.process_service_type || data.process_served_to) {
      y = checkPageBreak(doc, y, 12, prio);
      const psSec = openAutoSection(doc, 'Process Service Details', y); y = psSec.contentY;
      y = addThreeColumnFields(doc, [
        { label: 'Document Type', value: (data.process_service_type || '').replace(/_/g, ' ').toUpperCase() },
        { label: 'Serve To', value: data.process_served_to || '' },
        { label: 'Attempts', value: String(data.process_attempts || 0) },
      ], y);
      y = addThreeColumnFields(doc, [
        { label: 'Service Address', value: data.process_served_address || '' },
        { label: 'Served At', value: fmtTimestamp(data.process_served_at) },
        { label: 'Result', value: (data.process_service_result || '').replace(/_/g, ' ').toUpperCase() },
      ], y);
      y = closeAutoSection(doc, psSec.sectionY, y, undefined, psSec.sectionPage);
    }
  }

  // Location
  y = checkPageBreak(doc, y, 12, prio);
  { const sec = openAutoSection(doc, 'Incident Location', y); y = sec.contentY;
    // Row 1: Address (full width)
    y = addFieldPair(doc, 'Address', data.location || '', lx, y, ffw);
    // Row 2: Latitude | Longitude | Dispatch Code (3 columns)
    y = addThreeColumnFields(doc, [
      { label: 'Latitude', value: data.latitude != null ? String(data.latitude) : '' },
      { label: 'Longitude', value: data.longitude != null ? String(data.longitude) : '' },
      { label: 'Dispatch Code', value: data.dispatch_code || data.zone_beat || '' },
    ], y);
    // Row 3: Cross Street | Property (2 columns)
    { const yL = addFieldPair(doc, 'Cross Street', data.cross_street || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'Property', data.property_name || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    // Row 4: Building | Floor | Suite/Room | Section ID | Zone ID | Beat ID (6 columns)
    { const sixW = ffw / 6;
      const r4Fields = [
        { label: 'Building', value: data.location_building || '' },
        { label: 'Floor', value: data.location_floor || '' },
        { label: 'Suite/Room', value: data.location_room || '' },
        { label: 'Section ID', value: data.section_id || '' },
        { label: 'Zone ID', value: data.zone_id || '' },
        { label: 'Beat ID', value: data.beat_id || '' },
      ];
      let maxY = y + SPACING.FIELD_ROW_ADVANCE;
      for (let i = 0; i < 6; i++) {
        const fy = addFieldPair(doc, r4Fields[i].label, r4Fields[i].value, lx + i * sixW, y, sixW);
        if (fy > maxY) maxY = fy;
      }
      y = maxY;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Flags — before Scene Conditions
  y = checkPageBreak(doc, y, 15, prio);
  { const flagSec = openAutoSection(doc, 'Flags', y); y = flagSec.contentY;
    y += SPACING.MD;
    const flagCols = 6;
    const flagColW = ffw / flagCols;
    const flagRowH = 4;
    const flagGrid2: { label: string; checked: boolean }[][] = [
      [
        { label: 'Injuries', checked: !!data.injuries_reported },
        { label: 'Alcohol', checked: !!data.alcohol_involved },
        { label: 'Drugs', checked: !!data.drugs_involved },
        { label: 'DV', checked: !!data.domestic_violence },
        { label: 'Mental Health', checked: !!data.mental_health_crisis },
        { label: 'Juvenile', checked: !!data.juvenile_involved },
      ],
      [
        { label: 'Felony IP', checked: !!data.felony_in_progress },
        { label: 'Ofc Safety', checked: !!data.officer_safety_caution },
        { label: 'Gang', checked: !!data.gang_related },
        { label: 'HAZMAT', checked: !!data.hazmat },
        { label: 'Veh Pursuit', checked: !!data.vehicle_pursuit },
        { label: 'Foot Pursuit', checked: !!data.foot_pursuit },
      ],
      [
        { label: 'K9 Req', checked: !!data.k9_requested },
        { label: 'EMS Req', checked: !!data.ems_requested },
        { label: 'Fire Req', checked: !!data.fire_requested },
        { label: 'Evidence', checked: !!data.evidence_collected },
        { label: 'BWC Active', checked: !!data.body_camera_active },
        { label: 'Photos', checked: !!data.photos_taken },
      ],
      [
        { label: 'Supvr Notified', checked: !!data.supervisor_notified },
        { label: 'LE Notified', checked: !!data.le_notified },
        { label: 'Trespass', checked: !!data.trespass_issued },
      ],
    ];
    for (const row of flagGrid2) {
      for (let c = 0; c < row.length; c++) {
        addCheckboxField(doc, row[c].label, row[c].checked, lx + c * flagColW, y);
      }
      y += flagRowH;
    }
    y += SPACING.SM;
    y = closeAutoSection(doc, flagSec.sectionY, y, undefined, flagSec.sectionPage);
  }

  // Scene Conditions (header 5.5 + row 10 + safety 10 + pad 1.5 = ~27mm, but try to keep on page 1)
  y = checkPageBreak(doc, y, 12, prio);
  { const sec = openAutoSection(doc, 'Scene Conditions', y); y = sec.contentY;
    // All 4 fields in one row
    const scW = ffw / 4;
    const scFields = [
      { label: 'Weather', value: data.weather_conditions || '' },
      { label: 'Lighting', value: data.lighting_conditions || '' },
      { label: 'Weapons', value: (!data.weapons_involved || data.weapons_involved === '0') ? 'None' : data.weapons_involved },
      { label: 'Scene Safety', value: data.scene_safety || 'Standard' },
    ];
    let maxScY = y + SPACING.FIELD_ROW_ADVANCE;
    for (let i = 0; i < 4; i++) {
      const fy = addFieldPair(doc, scFields[i].label, scFields[i].value, lx + i * scW, y, scW);
      if (fy > maxScY) maxScY = fy;
    }
    y = maxScY;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Assigned Units — after Scene Conditions
  { const unitDetail2 = data.assigned_units_detail;
    const unitCount2 = unitDetail2?.length || data.assigned_units?.length || 0;
    if (unitCount2 > 0) {
      y = checkPageBreak(doc, y, 12, prio);
      const uSec = openAutoSection(doc, 'Assigned Units', y); y = uSec.contentY;
      if (unitDetail2 && unitDetail2.length > 0) {
        const UNIT_ROLES2 = ['Primary Officer', 'Secondary Officer', 'Assisting Officer', 'Cover Officer', 'Supervisor On Scene'];
        const uqw = ffw / 4;
        for (let idx = 0; idx < unitDetail2.length; idx++) {
          const u = unitDetail2[idx];
          y = checkPageBreak(doc, y, 12);
          const uFields = [
            { label: 'Call Sign', value: u.call_sign || '--' },
            { label: 'Officer', value: u.officer_name || '--' },
            { label: 'Badge #', value: u.badge_number || '--' },
            { label: 'Role', value: UNIT_ROLES2[idx] || `Officer #${idx + 1}` },
          ];
          let maxUY = y + SPACING.FIELD_ROW_ADVANCE;
          for (let i = 0; i < 4; i++) {
            const fy = addFieldPair(doc, uFields[i].label, uFields[i].value, lx + i * uqw, y, uqw);
            if (fy > maxUY) maxUY = fy;
          }
          y = maxUY;
        }
      } else if (data.assigned_units && data.assigned_units.length > 0) {
        y = addFieldPair(doc, 'Assigned Units', data.assigned_units.join(', '), lx, y, ffw);
      }
      y = closeAutoSection(doc, uSec.sectionY, y, undefined, uSec.sectionPage);
    }
  }

  // Mileage — single row: Vehicle ID | Starting | Ending | Total
  if (data.starting_mileage != null || data.ending_mileage != null || data.responding_vehicle_id) {
    y = checkPageBreak(doc, y, 12, prio);
    const sec = openAutoSection(doc, 'Mileage', y); y = sec.contentY;
    const totalMiles = (data.starting_mileage != null && data.ending_mileage != null)
      ? (Number(data.ending_mileage) - Number(data.starting_mileage)).toFixed(1)
      : '';
    const qw = ffw / 4;
    let maxY = y + SPACING.FIELD_ROW_ADVANCE;
    const mileFields = [
      { label: 'Vehicle ID', value: data.responding_vehicle_id || '--' },
      { label: 'Starting Mileage', value: data.starting_mileage != null ? Number(data.starting_mileage).toLocaleString() : '--' },
      { label: 'Ending Mileage', value: data.ending_mileage != null ? Number(data.ending_mileage).toLocaleString() : '--' },
      { label: 'Total Miles', value: totalMiles || '--' },
    ];
    for (let i = 0; i < 4; i++) {
      const fy = addFieldPair(doc, mileFields[i].label, mileFields[i].value, lx + i * qw, y, qw);
      if (fy > maxY) maxY = fy;
    }
    y = maxY;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Linked Persons — field-pair box rows (matches Assigned Units style)
  if (data.linked_persons && data.linked_persons.length > 0) {
    y = checkPageBreak(doc, y, 12, prio);
    const sec = openAutoSection(doc, `Linked Persons (${data.linked_persons.length})`, y); y = sec.contentY;
    // 5 columns using ffw (inside section borders): Name | Role | DOB | Race/Sex | Phone
    const pColW = [ffw * 0.25, ffw * 0.15, ffw * 0.15, ffw * 0.22, ffw * 0.23];
    for (const p of data.linked_persons) {
      y = checkPageBreak(doc, y, 12);
      const np = 'Not Provided';
      const pFields = [
        { label: 'Name', value: `${p.last_name || ''}, ${p.first_name || ''}`.trim().replace(/^,\s*/, '') || np },
        { label: 'Role', value: titleCase((p.role || '').replace(/_/g, ' ')) || np },
        { label: 'DOB', value: p.dob || np },
        { label: 'Race/Sex', value: [p.race, p.gender].filter(Boolean).join('/') || np },
        { label: 'Phone', value: p.phone || np },
      ];
      let maxPY = y + SPACING.FIELD_ROW_ADVANCE;
      let pX = lx;
      for (let i = 0; i < 5; i++) {
        const fy = addFieldPair(doc, pFields[i].label, pFields[i].value, pX, y, pColW[i]);
        if (fy > maxPY) maxPY = fy;
        pX += pColW[i];
      }
      y = maxPY;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Linked Vehicles — field-pair box rows (matches Linked Persons style)
  if (data.linked_vehicles && data.linked_vehicles.length > 0) {
    y = checkPageBreak(doc, y, 12, prio);
    const sec = openAutoSection(doc, `Linked Vehicles (${data.linked_vehicles.length})`, y); y = sec.contentY;
    const vColW = [ffw * 0.15, ffw * 0.25, ffw * 0.12, ffw * 0.18, ffw * 0.30];
    const nv = 'Not Provided';
    for (const v of data.linked_vehicles) {
      y = checkPageBreak(doc, y, 12);
      const vFields = [
        { label: 'Role', value: titleCase((v.role || '').replace(/_/g, ' ')) || nv },
        { label: 'Year/Make/Model', value: [v.year, v.make, v.model].filter(Boolean).join(' ') || nv },
        { label: 'Color', value: v.color || nv },
        { label: 'Plate', value: (v.plate_number || '') + (v.plate_state ? `/${v.plate_state}` : '') || nv },
        { label: 'Owner', value: [v.owner_last_name, v.owner_first_name].filter(Boolean).join(', ') + (v.stolen_status && !['none', 'not_stolen', 'recovered', ''].includes(v.stolen_status.toLowerCase()) ? ` [${v.stolen_status.replace(/_/g, ' ').toUpperCase()}]` : '') || nv },
      ];
      let maxVY = y + SPACING.FIELD_ROW_ADVANCE;
      let vX = lx;
      for (let i = 0; i < 5; i++) {
        const fy = addFieldPair(doc, vFields[i].label, vFields[i].value, vX, y, vColW[i]);
        if (fy > maxVY) maxVY = fy;
        vX += vColW[i];
      }
      y = maxVY;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Incident Details — dynamic page break ──
  y = checkPageBreak(doc, y, 15, prio);
  { const sec = openAutoSection(doc, 'Incident Details', y); y = sec.contentY;
    y += SPACING.MD;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('DESCRIPTION', lx, y);
    y += 3.5;
    doc.setFont('helvetica', 'normal');
    y = addFormattedText(doc, (data.description || '').toUpperCase(), lx, y, ffw);
    y += SPACING.MD;
    y = addThreeColumnFields(doc, [
      { label: '# Subjects', value: data.num_subjects != null ? String(data.num_subjects) : '' },
      { label: '# Victims', value: data.num_victims != null ? String(data.num_victims) : '' },
      { label: 'Direction of Travel', value: data.direction_of_travel || '' },
    ], y);
    if (data.subject_description || data.vehicle_description) {
      const yL = addFieldPair(doc, 'Subject Description', data.subject_description || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'Vehicle Description', data.vehicle_description || '', rx, y, hfw);
      y = Math.max(yL, yR);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Flags — already rendered above (before Scene Conditions)

  // LE Coordination
  if (data.le_agency || data.le_case_number) {
    y = checkPageBreak(doc, y, 12, prio);
    const sec = openAutoSection(doc, 'External Agency Coordination', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Agency', data.le_agency || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'LE Case Number', data.le_case_number || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // PSO Client Request Details — already rendered after Caller Information above

  // Visit History Timeline (PSO calls with return visits)
  if (data.incident_type === 'pso_client_request' && data.visit_history && data.visit_history.length > 0) {
    y = checkPageBreak(doc, y, 25, prio);
    const sec = openAutoSection(doc, `Visit History -- ${data.visit_history.length} Prior ${data.visit_history.length === 1 ? 'Visit' : 'Visits'}`, y);
    y = sec.contentY;

    for (let vi = 0; vi < data.visit_history.length; vi++) {
      const visit = data.visit_history[vi];
      // Ensure each visit entry has page break checking (need ~14mm per entry)
      y = checkPageBreak(doc, y, 16, prio);
      // Consistent spacing between visit entries with separator line
      if (vi > 0) {
        doc.setDrawColor(...COLOR.BORDER_TABLE);
        doc.setLineWidth(BORDER.TABLE_ROW);
        doc.line(lx, y, lx + ffw, y);
        y += SPACING.SECTION_GAP;
      }

      // Visit header line
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_FIELD_VALUE);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text(`Visit #${visit.visit_number}`, lx, y);

      // Status badge
      const statusText = sanitizePdfText(` -- ${(visit.status || 'unknown').toUpperCase()}`);
      const visitLabelW = doc.getTextWidth(`Visit #${visit.visit_number}`);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text(statusText, lx + visitLabelW, y);

      // Units on the right
      let unitsList: string[] = [];
      try { unitsList = JSON.parse(visit.assigned_units || '[]'); } catch { /* ignore */ }
      if (unitsList.length > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(FONT.SIZE_FIELD_LABEL);
        doc.setTextColor(...COLOR.TEXT_TERTIARY);
        const unitsText = sanitizePdfText(`Units: ${unitsList.join(', ')}`);
        const unitsW = doc.getTextWidth(unitsText);
        doc.text(unitsText, lx + ffw - unitsW, y);
      }
      y += SPACING.SM + 1;

      // Timestamps row
      const timeFields: string[] = [];
      if (visit.dispatched_at) timeFields.push(`Disp: ${fmtDateTime(visit.dispatched_at)}`);
      if (visit.enroute_at) timeFields.push(`EnRt: ${fmtDateTime(visit.enroute_at)}`);
      if (visit.onscene_at) timeFields.push(`OnSc: ${fmtDateTime(visit.onscene_at)}`);
      if (visit.cleared_at) timeFields.push(`Clr: ${fmtDateTime(visit.cleared_at)}`);
      if (visit.closed_at) timeFields.push(`Cls: ${fmtDateTime(visit.closed_at)}`);

      if (timeFields.length > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(FONT.SIZE_FIELD_LABEL);
        doc.setTextColor(...COLOR.TEXT_TERTIARY);
        doc.text(sanitizePdfText(timeFields.join('    ')), lx + SPACING.MD, y);
        y += SPACING.SM + 0.5;
      }

      // Mileage row (if present)
      const mileageFields: string[] = [];
      if (visit.responding_vehicle_id) mileageFields.push(`Vehicle: ${visit.responding_vehicle_id}`);
      if (visit.starting_mileage != null) mileageFields.push(`Start: ${visit.starting_mileage.toLocaleString()} mi`);
      if (visit.ending_mileage != null) mileageFields.push(`End: ${visit.ending_mileage.toLocaleString()} mi`);
      if (visit.starting_mileage != null && visit.ending_mileage != null) {
        mileageFields.push(`Total: ${(visit.ending_mileage - visit.starting_mileage).toFixed(1)} mi`);
      }

      if (mileageFields.length > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(FONT.SIZE_FIELD_LABEL);
        doc.setTextColor(...COLOR.TEXT_TERTIARY);
        doc.text(sanitizePdfText(mileageFields.join('    ')), lx + SPACING.MD, y);
        y += SPACING.SM + 0.5;
      }

      // Disposition
      if (visit.disposition) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(FONT.SIZE_FIELD_LABEL);
        doc.setTextColor(...COLOR.TEXT_SECONDARY);
        doc.text(sanitizePdfText(`Disposition: ${visit.disposition}`), lx + SPACING.MD, y);
        y += SPACING.SM + 0.5;
      }

      y += SPACING.XS;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Assigned Units — already rendered above (after Scene Conditions)

  // Damage Assessment (conditional)
  if (data.damage_estimate || data.damage_description) {
    y = checkPageBreak(doc, y, 12, prio);
    const sec = openAutoSection(doc, 'Damage Assessment', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Estimate', fmtCurrency(data.damage_estimate), lx, y, hfw);
      const yR = addFieldPair(doc, 'Description', data.damage_description || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Resolution Details — dynamic page break (stays on current page if room) ──
  // Needs header (5) + officer/disp row (7) + action taken row (7+) + pad (1) ≈ 20mm min
  y = checkPageBreak(doc, y, 20, prio);

  { const sec = openAutoSection(doc, 'Resolution Details', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Responding Officer', data.responding_officer || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'Disposition', data.disposition || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = addFieldPair(doc, 'Action Taken', data.action_taken || '--', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ═══════════════════════════════════════════════════════════
  // FREE-FORM — GPS, Notes, Narrative, Attachments, Signatures
  // ═══════════════════════════════════════════════════════════

  // GPS Activity Log — only render when breadcrumb data exists
  const trail = data.breadcrumb_trail;
  if (trail && trail.points && trail.points.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    const sec = openAutoSection(doc, 'GPS Activity Log', y); y = sec.contentY;
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
    const sampled = trail.points.filter((_: any, i: number) => i % step === 0 || i === trail.points.length - 1);

    const colPositions = [lx, LAYOUT.PAGE_MARGIN + 38, LAYOUT.PAGE_MARGIN + 100, LAYOUT.PAGE_MARGIN + 130, LAYOUT.PAGE_MARGIN + 155];
    const tableHeaders = [
      { label: 'TIME', x: colPositions[0] },
      { label: 'LOCATION / ROAD', x: colPositions[1] },
      { label: 'SPEED', x: colPositions[2] },
      { label: 'SOURCE', x: colPositions[3] },
      { label: 'UNIT', x: colPositions[4] },
    ];
    const tableRows = sampled.map((p: any) => {
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
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Notes
  if (data.notes && data.notes.length > 0) {
    y = checkPageBreak(doc, y, 25, prio);
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
        { label: 'AUTHOR', x: LAYOUT.PAGE_MARGIN + 58 },
        { label: 'NOTE', x: LAYOUT.PAGE_MARGIN + 90 },
      ],
      noteRows,
      y,
      [LAYOUT.PAGE_MARGIN + 5, LAYOUT.PAGE_MARGIN + 58, LAYOUT.PAGE_MARGIN + 90],
      { lightHeader: true },
    );
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Narrative
  y = addNarrativeSection(doc, 'Narrative', data.narrative || '', y, prio);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signatures — full-width stacked (one on top of the other)
  y = addStackedSignatures(doc, 'Reporting Officer', 'Supervisor Review', y, getOfficerSig(), undefined, prio);
}

// ── Person Record ────────────────────────────────────────────

function generatePersonReport(doc: jsPDF, data: PersonPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);

  // Determine priority — escalate if active warrants or BOLO
  const hasActiveWarrants = data.warrants && data.warrants.some(w => w.status === 'active');
  const prio = hasActiveWarrants ? 'critical' : data.bolo_active ? 'high' : 'routine';

  const personName = `${data.last_name || 'UNKNOWN'}, ${data.first_name || ''}`.toUpperCase();
  setActiveCaseNumber(personName);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'PERSON RECORD',
    formNumber: 'FORM PS-202',
    caseNumber: personName,
    reportDate: fmtDate(data.created_at),
  });

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
  y = drawFormSection(doc, {
    sideTab: { label: 'SUBJECT ID' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '1. LAST NAME', value: data.last_name || '', ratio: 2, valueBold: true },
        { label: '2. FIRST NAME', value: data.first_name || '', ratio: 2, valueBold: true },
        { label: '3. MIDDLE NAME', value: data.middle_name || '', ratio: 1 },
      ]},
      { cells: [
        { label: '4. ALIAS / NICKNAME', value: data.alias_nickname || '', ratio: 2 },
        { label: '5. DATE OF BIRTH', value: fmtDate(data.date_of_birth), ratio: 1 },
        { label: '6. GENDER', value: data.gender || '', ratio: 1 },
        { label: '7. RACE', value: data.race || '', ratio: 1 },
      ]},
      { cells: [
        { label: '8. MARITAL STATUS', value: data.marital_status || '', ratio: 1 },
        { label: '9. CITIZENSHIP', value: data.citizenship || '', ratio: 1 },
        { label: '10. PLACE OF BIRTH', value: data.place_of_birth || '', ratio: 1 },
        { label: '11. LANGUAGE', value: data.language || '', ratio: 1 },
        { label: '12. RECORD ID', value: data.id || '', ratio: 1 },
      ]},
    ],
    y,
  });

  // ── 2. Physical Description ───────────────────────────────
  y = drawFormSection(doc, {
    sideTab: { label: 'PHYSICAL' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '13. HEIGHT', value: data.height || '', ratio: 1 },
        { label: '14. WEIGHT', value: data.weight || '', ratio: 1 },
        { label: '15. BUILD', value: data.build || '', ratio: 1 },
        { label: '16. COMPLEXION', value: data.complexion || '', ratio: 1 },
        { label: '17. BLOOD TYPE', value: data.blood_type || '', ratio: 1 },
        { label: '18. SHOE SIZE', value: data.shoe_size || '', ratio: 1 },
      ]},
      { cells: [
        { label: '19. HAIR COLOR', value: data.hair_color || '', ratio: 1 },
        { label: '20. HAIR LENGTH', value: data.hair_length || '', ratio: 1 },
        { label: '21. HAIR STYLE', value: data.hair_style || '', ratio: 1 },
        { label: '22. EYE COLOR', value: data.eye_color || '', ratio: 1 },
        { label: '23. FACIAL HAIR', value: data.facial_hair || '', ratio: 1 },
        { label: '24. GLASSES', value: data.glasses || '', ratio: 1 },
      ]},
    ],
    y,
  });

  // ── 3. Scars / Marks / Tattoos ────────────────────────────
  y = addNarrativeSection(doc, 'Scars / Marks / Tattoos', data.scars_marks_tattoos || '', y, prio);

  // ── 4. Clothing Description ───────────────────────────────
  y = addNarrativeSection(doc, 'Clothing Description', data.clothing_description || '', y, prio);

  // ── 5. Contact Information ────────────────────────────────
  const fullAddress = `${data.address || ''}${data.city ? `, ${data.city}` : ''}${data.state ? `, ${data.state}` : ''} ${data.zip || ''}`.trim();
  const contactRows: FormRow[] = [
    { cells: [
      { label: '25. PHONE (PRIMARY)', value: data.phone || '', ratio: 1 },
      { label: '26. PHONE (SECONDARY)', value: data.phone_secondary || '', ratio: 1 },
      { label: '27. EMAIL', value: data.email || '', ratio: 2 },
    ]},
    { cells: [
      { label: '28. ADDRESS', value: fullAddress, ratio: 3 },
    ]},
  ];
  if (data.social_media) {
    contactRows.push({ cells: [
      { label: '29. SOCIAL MEDIA', value: data.social_media, ratio: 3 },
    ]});
  }
  y = drawFormSection(doc, {
    sideTab: { label: 'CONTACT' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: contactRows,
    y,
  });

  // ── 6. Identification Documents ───────────────────────────
  y = drawFormSection(doc, {
    sideTab: { label: 'ID DOCS' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '30. DL NUMBER', value: data.dl_number || '', ratio: 2 },
        { label: '31. DL STATE', value: data.dl_state || '', ratio: 1, align: 'center' },
        { label: '32. DL CLASS', value: data.dl_class || '', ratio: 1 },
        { label: '33. DL EXPIRY', value: fmtDate(data.dl_expiry), ratio: 1 },
      ]},
      { cells: [
        { label: '34. ID TYPE', value: data.id_type || '', ratio: 1 },
        { label: '35. ID NUMBER', value: data.id_number || '', ratio: 2 },
        { label: '36. ID STATE', value: data.id_state || '', ratio: 1, align: 'center' },
        { label: '37. ID EXPIRY', value: fmtDate(data.id_expiry), ratio: 1 },
      ]},
      { cells: [
        { label: '38. SSN LAST 4', value: data.ssn_last4 ? `***-**-${data.ssn_last4}` : '', ratio: 1 },
      ]},
    ],
    y,
  });

  // ── 7. Employment / Demographics ──────────────────────────
  y = drawFormSection(doc, {
    sideTab: { label: 'EMPLOY' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '39. EMPLOYER', value: data.employer || '', ratio: 2 },
        { label: '40. OCCUPATION', value: data.occupation || '', ratio: 1 },
        { label: '41. LANGUAGE', value: data.language || '', ratio: 1 },
      ]},
    ],
    y,
  });

  // ── 8. Flags & Warnings ───────────────────────────────────
  const probParole = `${data.probation_parole || ''}${data.probation_parole_officer ? ` (Officer: ${data.probation_parole_officer})` : ''}`.trim();
  y = drawFormSection(doc, {
    sideTab: { label: 'FLAGS' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: 'SEX OFFENDER', value: '', checkbox: true, checked: !!data.is_sex_offender, ratio: 1 },
        { label: 'VETERAN', value: '', checkbox: true, checked: !!data.is_veteran, ratio: 1 },
        { label: 'ACTIVE BOLO', value: '', checkbox: true, checked: !!data.bolo_active, ratio: 1 },
      ]},
      { cells: [
        { label: '42. GANG AFFILIATION', value: data.gang_affiliation || '', ratio: 1 },
        { label: '43. PROBATION / PAROLE', value: probParole, ratio: 2 },
      ]},
      ...(data.known_associates ? [{ cells: [
        { label: '44. KNOWN ASSOCIATES', value: data.known_associates, ratio: 3 },
      ]} as FormRow] : []),
    ],
    y,
  });

  // Active Flags — colored pill badges (kept as-is)
  if (data.flags && data.flags.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('ACTIVE FLAGS', lx + 1.5, y + 2);
    y += 4;
    y = addFlagBadges(doc, data.flags, lx, y, ffw, prio);
    y += 1;
  }

  // Caution block — amber warning styling for officer safety (kept as-is)
  if (data.caution_flags) {
    y = addCautionBlock(doc, data.caution_flags, lx, y, ffw);
  }

  // ── 9. Emergency Contact ──────────────────────────────────
  y = drawFormSection(doc, {
    sideTab: { label: 'EMERG' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '45. NAME', value: data.emergency_contact_name || '', ratio: 2 },
        { label: '46. PHONE', value: data.emergency_contact_phone || '', ratio: 1 },
        { label: '47. RELATIONSHIP', value: data.emergency_contact_relationship || '', ratio: 1 },
      ]},
    ],
    y,
  });

  // ── 10. Active Warrants ───────────────────────────────────
  if (data.warrants && data.warrants.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    y = drawFormSection(doc, {
      sideTab: { label: 'WARRANTS' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [],
      y,
    });
    const warrantRows = data.warrants.map(w => [
      w.warrant_number || '--',
      titleCase(w.type || ''),
      titleCase(w.status || ''),
      w.charge_description || '--',
      titleCase(w.offense_level || ''),
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
  }

  // ── 11. Incident History ──────────────────────────────────
  if (data.incidents && data.incidents.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    y = drawFormSection(doc, {
      sideTab: { label: 'INCIDENTS' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [],
      y,
    });
    const incidentRows = data.incidents.map(inc => [
      inc.incident_number || '--',
      titleCase((inc.incident_type || '').replace(/_/g, ' ')),
      titleCase(inc.role || ''),
      titleCase(inc.status || ''),
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
  }

  // ── 12. Citation History ──────────────────────────────────
  if (data.citations && data.citations.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    y = drawFormSection(doc, {
      sideTab: { label: 'CITATIONS' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [],
      y,
    });
    const citationRows = data.citations.map(c => [
      c.citation_number || '--',
      titleCase(c.type || ''),
      titleCase(c.status || ''),
      c.violation_description || c.statute_citation || '--',
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
  }

  // ── 13. Dispatch Call History ──────────────────────────────
  if (data.calls && data.calls.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    y = drawFormSection(doc, {
      sideTab: { label: 'CALLS' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [],
      y,
    });
    const callRows = data.calls.map(c => [
      c.call_number || '--',
      (c.incident_type || '').replace(/_/g, ' ').toUpperCase(),
      (c.status || '').toUpperCase(),
      c.location || '--',
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
  }

  // ── 14. Criminal History (Full Detail) — force new page ─
  if (data.criminal_records && data.criminal_records.length > 0) {
    doc.addPage();
    addConfidentialWatermark(doc);
    y = 12; // start near top of new page
    y = drawFormSection(doc, {
      sideTab: { label: 'CRIMINAL' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [],
      y,
    });

    // Summary table — quick reference overview
    const crCw = getContentWidth(doc);
    const crRows = data.criminal_records.map(r => [
      (r.record_type || '').replace(/_/g, ' ').toUpperCase(),
      r.offense || '--',
      (r.offense_level || '').toUpperCase() || '--',
      r.case_number || '--',
      r.disposition || '--',
      fmtDate(r.offense_date),
    ]);
    y = addTableWithShading(
      doc,
      [
        { label: 'TYPE', x: lx },
        { label: 'OFFENSE', x: lx + crCw * 0.13 },
        { label: 'LEVEL', x: lx + crCw * 0.45 },
        { label: 'CASE #', x: lx + crCw * 0.55 },
        { label: 'DISPOSITION', x: lx + crCw * 0.70 },
        { label: 'DATE', x: lx + crCw * 0.87 },
      ],
      crRows,
      y,
      [lx, lx + crCw * 0.13, lx + crCw * 0.45, lx + crCw * 0.55, lx + crCw * 0.70, lx + crCw * 0.87],
    );
    y += SPACING.MD;

    // Detailed per-record cards — 3 per page, evenly spaced, never split
    const pageH = doc.internal.pageSize.getHeight();
    const recordsPerPage = 3;
    const pageTopY = 14;  // top margin for detail pages
    const pageBottomY = pageH - LAYOUT.FOOTER_HEIGHT - 4; // safe bottom (matches checkPageBreak)
    const usableH = pageBottomY - pageTopY;
    const slotH = usableH / recordsPerPage; // each record gets this vertical slot

    // Helper to render one record card at a given Y position
    const renderRecordCard = (r: PersonCriminalHistoryRecord, ri: number, startY: number) => {
      let cy = startY;

      // Record sub-header bar
      doc.setFillColor(30, 55, 90);
      doc.rect(lx, cy, ffw, 5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_TABLE_HEADER);
      doc.setTextColor(...COLOR.TEXT_INVERTED);
      doc.text(sanitizePdfText(`RECORD ${ri + 1} — ${(r.record_type || 'UNKNOWN').replace(/_/g, ' ').toUpperCase()}`), lx + 2, cy + 3.2);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      cy += 7;

      // Row 1: Offense + Level
      { const yL = addFieldPair(doc, 'Offense', r.offense || '--', lx, cy, hfw);
        const yR = addFieldPair(doc, 'Offense Level', (r.offense_level || '--').toUpperCase(), rx, cy, hfw);
        cy = Math.max(yL, yR); }

      // Row 2: Statute + Case Number
      { const yL = addFieldPair(doc, 'Statute', r.statute || '--', lx, cy, hfw);
        const yR = addFieldPair(doc, 'Case Number', r.case_number || '--', rx, cy, hfw);
        cy = Math.max(yL, yR); }

      // Row 3: Agency + Jurisdiction
      { const yL = addFieldPair(doc, 'Agency', r.agency || '--', lx, cy, hfw);
        const yR = addFieldPair(doc, 'Jurisdiction', r.jurisdiction || '--', rx, cy, hfw);
        cy = Math.max(yL, yR); }

      // Row 4: Offense Date + Disposition Date
      { const yL = addFieldPair(doc, 'Offense Date', fmtDate(r.offense_date), lx, cy, hfw);
        const yR = addFieldPair(doc, 'Disposition Date', fmtDate(r.disposition_date), rx, cy, hfw);
        cy = Math.max(yL, yR); }

      // Row 5: Disposition + Sentence
      { const yL = addFieldPair(doc, 'Disposition', r.disposition || '--', lx, cy, hfw);
        const yR = addFieldPair(doc, 'Sentence', r.sentence || '--', rx, cy, hfw);
        cy = Math.max(yL, yR); }

      return cy;
    };

    for (let ri = 0; ri < data.criminal_records.length; ri++) {
      const slotIndex = ri % recordsPerPage; // 0, 1, or 2 within current page

      // New page for every batch of 3 (including the first batch — summary table stays on its own page)
      if (slotIndex === 0) {
        doc.addPage();
        addConfidentialWatermark(doc);
      }

      // Position this record in its evenly-distributed slot
      const slotY = pageTopY + slotIndex * slotH;
      const cardEndY = renderRecordCard(data.criminal_records[ri], ri, slotY);

      // Draw subtle divider between records on same page
      if (slotIndex < recordsPerPage - 1 && ri < data.criminal_records.length - 1) {
        const dividerY = pageTopY + (slotIndex + 1) * slotH - 2;
        doc.setDrawColor(...COLOR.BORDER_TABLE);
        doc.setLineWidth(BORDER.TABLE_ROW);
        doc.line(lx, dividerY, lx + ffw, dividerY);
      }

      // Track y for last record position
      if (ri === data.criminal_records.length - 1) {
        y = cardEndY;
      }
    }
  }

  // ── 15. Notes ─────────────────────────────────────────────
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y, prio);

  // ── 16. Record Metadata ───────────────────────────────────
  y = drawFormSection(doc, {
    sideTab: { label: 'META' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '48. CREATED', value: fmtTimestamp(data.created_at || ''), ratio: 1 },
        { label: '49. LAST UPDATED', value: fmtTimestamp(data.updated_at || ''), ratio: 1 },
      ]},
    ],
    y,
  });

  // ── 17. Attachments ───────────────────────────────────────
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y, 'Attachments / Evidence Photos', prio);
  }

  // ── 18. Signature Block — full-width stacked ──────────────
  y = addStackedSignatures(doc, 'Entering Officer', '', y, getOfficerSig(), undefined, prio);
}

// ── Vehicle Record ───────────────────────────────────────────

function generateVehicleReport(doc: jsPDF, data: VehiclePdfData) {
  const cw = getContentWidth(doc);

  setActiveCaseNumber(data.license_plate || 'N/A');
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'VEHICLE RECORD',
    formNumber: 'FORM PS-203',
    caseNumber: data.license_plate || 'N/A',
  });

  // Vehicle Identification
  y = drawFormSection(doc, {
    sideTab: { label: 'VEHICLE ID' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '1. LICENSE PLATE', value: data.license_plate, ratio: 2, valueBold: true },
        { label: '2. STATE', value: data.plate_state || '', ratio: 1, align: 'center' },
        { label: '3. PLATE TYPE', value: data.plate_type || '', ratio: 1 },
        { label: '4. VIN', value: data.vin || '', ratio: 2 },
      ]},
      { cells: [
        { label: '5. YEAR', value: data.year ? String(data.year) : '', ratio: 1, align: 'center' },
        { label: '6. MAKE', value: data.make || '', ratio: 1 },
        { label: '7. MODEL', value: data.model || '', ratio: 1 },
        { label: '8. BODY STYLE', value: data.body_style || '', ratio: 1 },
        { label: '9. TRIM', value: data.trim || '', ratio: 1 },
        { label: '10. DOORS', value: data.doors ? String(data.doors) : '', ratio: 1, align: 'center' },
      ]},
      { cells: [
        { label: '11. COLOR', value: data.color || '', ratio: 1 },
        { label: '12. SECONDARY COLOR', value: data.secondary_color || '', ratio: 1 },
        { label: '13. ENGINE', value: data.engine_type || '', ratio: 1 },
        { label: '14. FUEL', value: data.fuel_type || '', ratio: 1 },
        { label: '15. TRANSMISSION', value: data.transmission || '', ratio: 1 },
        { label: '16. DRIVE', value: data.drive_type || '', ratio: 1 },
      ]},
    ],
    y,
  });

  // Owner Information
  y = drawFormSection(doc, {
    sideTab: { label: 'OWNER' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '17. OWNER NAME', value: data.owner_name || '', ratio: 2, valueBold: true },
        { label: '18. PHONE', value: data.owner_phone || '', ratio: 1 },
        { label: '19. ODOMETER', value: data.odometer || '', ratio: 1, align: 'center' },
      ]},
      { cells: [
        { label: '20. OWNER ADDRESS', value: data.owner_address || '', ratio: 1 },
      ]},
      { cells: [
        { label: 'COMMERCIAL', value: '', checkbox: true, checked: !!data.commercial_vehicle, ratio: 1 },
        { label: 'HAZMAT', value: '', checkbox: true, checked: !!data.hazmat, ratio: 1 },
        { label: '21. LIEN HOLDER', value: data.lien_holder || '', ratio: 3 },
      ]},
    ],
    y,
  });

  // Insurance & Registration
  y = drawFormSection(doc, {
    sideTab: { label: 'INSURANCE' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '22. INSURANCE COMPANY', value: data.insurance_company || '', ratio: 2 },
        { label: '23. POLICY NUMBER', value: data.insurance_policy || '', ratio: 2 },
        { label: '24. REG. EXPIRY', value: fmtDate(data.registration_expiry), ratio: 1 },
      ]},
    ],
    y,
  });

  // Legal Status
  y = drawFormSection(doc, {
    sideTab: { label: 'LEGAL STATUS' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '25. STOLEN STATUS', value: (data.stolen_status || 'Not Stolen').toUpperCase(), ratio: 1, valueBold: true, align: 'center' },
        { label: '26. STOLEN DATE', value: fmtDate(data.stolen_date), ratio: 1 },
        { label: '27. RECOVERY DATE', value: fmtDate(data.recovery_date), ratio: 1 },
      ]},
      { cells: [
        { label: '28. TOW STATUS', value: data.tow_status || '', ratio: 1 },
        { label: '29. TOW COMPANY', value: data.tow_company || '', ratio: 1 },
        { label: '30. TOW DATE', value: fmtDate(data.tow_date), ratio: 1 },
      ]},
    ],
    y,
  });

  // Free-form sections (keep as narrative — these have long text)
  y = addNarrativeSection(doc, 'Distinguishing Features', data.distinguishing_features || '', y);
  y = addNarrativeSection(doc, 'Damage Description', data.damage_description || '', y);

  if (data.flags && data.flags.length > 0) {
    y = drawFormSection(doc, {
      sideTab: { label: 'FLAGS' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [{ cells: [
        { label: 'ACTIVE FLAGS', value: data.flags.join(', '), ratio: 1 },
      ]}],
      y,
    });
  }

  y = addNarrativeSection(doc, 'Notes', data.notes || '', y);

  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  y = addStackedSignatures(doc, 'Entering Officer', '', y, getOfficerSig());
}

// ── Warrant ──────────────────────────────────────────────────

function generateWarrantReport(doc: jsPDF, data: WarrantPdfData) {
  const statusPrio = data.status === 'active' ? 'critical' : data.status === 'served' ? 'low' : 'medium';

  setActiveCaseNumber(data.warrant_number);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'WARRANT RECORD',
    formNumber: 'FORM PS-204',
    caseNumber: data.warrant_number,
    reportDate: fmtDate(data.created_at),
  });

  // Warrant Information
  y = drawFormSection(doc, {
    sideTab: { label: 'WARRANT INFO' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '1. WARRANT NUMBER', value: data.warrant_number, ratio: 2, valueBold: true },
        { label: '2. TYPE', value: (data.type || '').toUpperCase(), ratio: 1, align: 'center' },
        { label: '3. STATUS', value: (data.status || '').toUpperCase(), ratio: 1, align: 'center', valueBold: true },
        { label: '4. OFFENSE LEVEL', value: (data.offense_level || '').toUpperCase(), ratio: 1, align: 'center' },
      ]},
      { cells: [
        { label: '5. CHARGE DESCRIPTION', value: data.charge_description || '', ratio: 1 },
      ], height: data.charge_description && data.charge_description.length > 60 ? 12 : undefined },
    ],
    y,
  });

  // Subject Information
  y = drawFormSection(doc, {
    sideTab: { label: 'SUBJECT' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '6. LAST NAME', value: data.subject_last_name || '', ratio: 2, valueBold: true },
        { label: '7. FIRST NAME', value: data.subject_first_name || '', ratio: 2, valueBold: true },
        { label: '8. DOB', value: fmtDate(data.subject_dob), ratio: 1 },
      ]},
      { cells: [
        { label: '9. GENDER', value: data.subject_gender || '', ratio: 1, align: 'center' },
        { label: '10. RACE', value: data.subject_race || '', ratio: 1, align: 'center' },
        { label: '11. HEIGHT', value: data.subject_height || '', ratio: 1, align: 'center' },
        { label: '12. WEIGHT', value: data.subject_weight || '', ratio: 1, align: 'center' },
        { label: '13. HAIR', value: data.subject_hair_color || '', ratio: 1, align: 'center' },
        { label: '14. EYES', value: data.subject_eye_color || '', ratio: 1, align: 'center' },
      ]},
      ...(data.subject_address ? [{ cells: [
        { label: '15. ADDRESS', value: data.subject_address, ratio: 1 },
      ]} as FormRow] : []),
    ],
    y,
  });

  // Court Information
  y = drawFormSection(doc, {
    sideTab: { label: 'COURT' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '16. ISSUING COURT', value: data.issuing_court || '', ratio: 2 },
        { label: '17. ISSUING JUDGE', value: data.issuing_judge || '', ratio: 2 },
      ]},
      { cells: [
        { label: '18. BAIL AMOUNT', value: fmtCurrency(data.bail_amount), ratio: 1, align: 'center', valueBold: true },
        { label: '19. EXPIRATION DATE', value: fmtDate(data.expires_at), ratio: 1, align: 'center' },
        { label: '20. ENTERED BY', value: data.entered_by_name || '', ratio: 1 },
        { label: '21. ENTRY DATE', value: fmtTimestamp(data.created_at), ratio: 1 },
      ]},
    ],
    y,
  });

  // Service Information (conditional)
  if (data.served_at || data.served_by_name) {
    y = drawFormSection(doc, {
      sideTab: { label: 'SERVICE' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: '22. SERVED BY', value: data.served_by_name || '', ratio: 2 },
          { label: '23. SERVED DATE', value: fmtTimestamp(data.served_at), ratio: 1 },
          { label: '24. SERVED LOCATION', value: data.served_location || '', ratio: 2 },
        ]},
      ],
      y,
    });
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y, statusPrio);

  // Signature Block — full-width stacked
  y = addStackedSignatures(doc, 'Serving Officer', '', y, getOfficerSig(), undefined, statusPrio);
}

// ── Evidence / Property Custody Report ───────────────────────

function generateEvidenceReport(doc: jsPDF, data: EvidencePdfData) {
  const lx = getLeftX();
  const ffw = getFullFieldWidth(doc);

  setActiveCaseNumber(data.evidence_number);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'EVIDENCE / PROPERTY CUSTODY REPORT',
    formNumber: 'FORM PS-205',
    caseNumber: data.evidence_number,
  });

  // Evidence Identification
  y = drawFormSection(doc, {
    sideTab: { label: 'EVIDENCE ID' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '1. EVIDENCE NUMBER', value: data.evidence_number, ratio: 2, valueBold: true },
        { label: '2. TYPE', value: (data.evidence_type || '').replace(/_/g, ' ').toUpperCase(), ratio: 1 },
        { label: '3. CATEGORY', value: data.category || '', ratio: 1 },
        { label: '4. STATUS', value: (data.status || '').replace(/_/g, ' ').toUpperCase(), ratio: 1, align: 'center', valueBold: true },
      ]},
      { cells: [
        { label: '5. RELATED INCIDENT', value: data.incident_number || '', ratio: 1 },
        { label: '6. SERIAL NUMBER', value: data.serial_number || '', ratio: 1 },
        { label: '7. BRAND', value: data.brand || '', ratio: 1 },
        { label: '8. MODEL', value: data.model || '', ratio: 1 },
      ]},
      { cells: [
        { label: '9. DIMENSIONS', value: data.dimensions || '', ratio: 1 },
        { label: '10. WEIGHT', value: data.weight || '', ratio: 1 },
        { label: '11. EST. VALUE', value: fmtCurrency(data.estimated_value), ratio: 1, align: 'center' },
        { label: '12. QUANTITY', value: data.quantity != null ? String(data.quantity) : '', ratio: 1, align: 'center' },
      ]},
    ],
    y,
  });

  // Description (narrative — can be long)
  if (data.description) {
    y = addNarrativeSection(doc, 'Item Description', data.description, y);
  }

  // Collection Information
  y = drawFormSection(doc, {
    sideTab: { label: 'COLLECTION' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '13. COLLECTED BY', value: data.collected_by || '', ratio: 2 },
        { label: '14. COLLECTION DATE', value: fmtTimestamp(data.collected_date), ratio: 1 },
        { label: '15. PACKAGING', value: data.packaging_type || '', ratio: 1 },
      ]},
      { cells: [
        { label: '16. LOCATION FOUND', value: data.location_found || '', ratio: 2 },
        { label: '17. PHOTO TAKEN', value: data.photo_taken ? 'Yes' : 'No', ratio: 1, align: 'center' },
        { label: '18. STORAGE LOCATION', value: data.storage_location || '', ratio: 2 },
      ]},
    ],
    y,
  });

  // Chain of Custody (table — keep existing pattern, it works well)
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
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Lab Analysis (conditional)
  if (data.lab_submitted) {
    y = drawFormSection(doc, {
      sideTab: { label: 'LAB' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: 'SUBMITTED TO LAB', value: '', checkbox: true, checked: true, ratio: 1 },
          { label: '19. LAB NAME', value: data.lab_name || '', ratio: 2 },
          { label: '20. LAB CASE #', value: data.lab_case_number || '', ratio: 2 },
        ]},
      ],
      y,
    });
  }

  // Disposition / Disposal (conditional)
  if (data.disposal_method) {
    y = drawFormSection(doc, {
      sideTab: { label: 'DISPOSAL' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: '21. METHOD', value: data.disposal_method, ratio: 1 },
          { label: '22. DATE', value: fmtDate(data.disposal_date), ratio: 1 },
          { label: '23. AUTHORIZED BY', value: data.disposal_authorized_by || '', ratio: 1 },
        ]},
      ],
      y,
    });
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block — full-width stacked
  y = addStackedSignatures(doc, 'Collecting Officer', 'Evidence Custodian', y, getOfficerSig());
}

// ── Fleet Vehicle Status Report ──────────────────────────────

function generateFleetReport(doc: jsPDF, data: FleetPdfData) {
  const lx = getLeftX();
  const cw = getContentWidth(doc);

  const reportType = data.report_type || 'status';

  const reportTitles: Record<string, string> = {
    status: 'FLEET VEHICLE STATUS REPORT',
    fuel_logs: 'FLEET FUEL LOG REPORT',
    maintenance: 'FLEET MAINTENANCE REPORT',
    mileage_summary: 'FLEET MILEAGE SUMMARY REPORT',
  };

  setActiveCaseNumber(data.vehicle_number);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: reportTitles[reportType] || reportTitles.status,
    formNumber: 'FORM PS-206',
    caseNumber: data.vehicle_number,
  });

  // Vehicle Information
  y = drawFormSection(doc, {
    sideTab: { label: 'VEHICLE' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '1. UNIT NUMBER', value: data.vehicle_number, ratio: 1, valueBold: true },
        { label: '2. MAKE', value: data.make || '', ratio: 1 },
        { label: '3. MODEL', value: data.model || '', ratio: 1 },
      ]},
      { cells: [
        { label: '4. YEAR', value: data.year ? String(data.year) : '', ratio: 1, align: 'center' },
        { label: '5. COLOR', value: data.color || '', ratio: 1 },
        { label: '6. VIN', value: data.vin || '', ratio: 2 },
      ]},
      { cells: [
        { label: '7. PLATE NUMBER', value: data.plate_number || '', ratio: 1 },
        { label: '8. PLATE STATE', value: data.plate_state || '', ratio: 1, align: 'center' },
        { label: '9. STATUS', value: (data.status || '').replace(/_/g, ' ').toUpperCase(), ratio: 1, valueBold: true },
      ]},
    ],
    y,
  });

  // Assignment
  y = drawFormSection(doc, {
    sideTab: { label: 'ASSIGN' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '10. ASSIGNED UNIT', value: data.assigned_unit_call_sign || 'Unassigned', ratio: 1 },
        { label: '11. CURRENT MILEAGE', value: data.current_mileage ? data.current_mileage.toLocaleString() : '', ratio: 1, align: 'center' },
      ]},
    ],
    y,
  });

  // ── FUEL LOG REPORT ──
  if (reportType === 'fuel_logs' && data.fuel_logs && data.fuel_logs.length > 0) {
    // Summary row
    const totalGal = data.fuel_logs.reduce((sum, f) => sum + (f.gallons || 0), 0);
    const totalCost = data.fuel_logs.reduce((sum, f) => sum + (f.total_cost || 0), 0);
    const efficiencyLogs = data.fuel_logs.filter(f => f.efficiency);
    const avgEfficiency = efficiencyLogs.length > 0
      ? efficiencyLogs.reduce((sum, f) => sum + (f.efficiency || 0), 0) / efficiencyLogs.length
      : 0;
    y = drawFormSection(doc, {
      sideTab: { label: 'FUEL' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: 'TOTAL GALLONS', value: totalGal.toFixed(2), ratio: 1, align: 'center' },
          { label: 'TOTAL COST', value: `$${totalCost.toFixed(2)}`, ratio: 1, align: 'center' },
          { label: 'AVG EFFICIENCY', value: avgEfficiency > 0 ? `${avgEfficiency.toFixed(1)} MPG` : 'N/A', ratio: 1, align: 'center' },
        ]},
      ],
      y,
    });

    // Fuel logs table — standardised via addTableWithShading
    const fuelColW = [22, 18, 24, 22, 28, cw - 114];
    const fuelColPos: number[] = [];
    { let cx = lx; for (const w of fuelColW) { fuelColPos.push(cx); cx += w; } }
    const fuelHeaders = ['Date', 'Gallons', 'Cost', 'Odometer', 'Efficiency', 'Station']
      .map((label, i) => ({ label, x: fuelColPos[i] }));
    const fuelRows = data.fuel_logs.map(f => [
      fmtDate(f.fuel_date),
      f.gallons?.toFixed(2) || '',
      f.total_cost ? `$${f.total_cost.toFixed(2)}` : '',
      f.odometer_reading ? Number(f.odometer_reading).toLocaleString() : '',
      f.efficiency ? `${f.efficiency.toFixed(1)} MPG` : '',
      (f.station || '').substring(0, 30),
    ]);
    y = addTableWithShading(doc, fuelHeaders, fuelRows, y, fuelColPos);
  }

  // ── MAINTENANCE REPORT ──
  if (reportType === 'maintenance' && data.maintenance_logs && data.maintenance_logs.length > 0) {
    // Summary row
    const totalCost = data.maintenance_logs.reduce((sum, m) => sum + (m.cost || 0), 0);
    const totalLabor = data.maintenance_logs.reduce((sum, m) => sum + (m.labor_cost || 0), 0);
    y = drawFormSection(doc, {
      sideTab: { label: 'MAINT' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: 'TOTAL COST', value: `$${totalCost.toFixed(2)}`, ratio: 1, align: 'center' },
          { label: 'TOTAL LABOR', value: `$${totalLabor.toFixed(2)}`, ratio: 1, align: 'center' },
          { label: 'RECORDS', value: String(data.maintenance_logs.length), ratio: 1, align: 'center' },
        ]},
      ],
      y,
    });

    // Maintenance table — standardised via addTableWithShading
    const maintColW = [22, 50, 20, 22, cw - 114];
    const maintColPos: number[] = [];
    { let cx = lx; for (const w of maintColW) { maintColPos.push(cx); cx += w; } }
    const maintHeaders = ['Date', 'Description', 'Cost', 'Odometer', 'Vendor']
      .map((label, i) => ({ label, x: maintColPos[i] }));
    const maintRows = data.maintenance_logs.map(m => [
      fmtDate(m.service_date),
      (m.description || '').substring(0, 45),
      m.cost ? `$${m.cost.toFixed(2)}` : '',
      m.odometer_reading ? Number(m.odometer_reading).toLocaleString() : '',
      (m.vendor || '').substring(0, 30),
    ]);
    y = addTableWithShading(doc, maintHeaders, maintRows, y, maintColPos);
  }

  // ── MILEAGE SUMMARY REPORT ──
  if (reportType === 'mileage_summary' && data.fuel_logs && data.fuel_logs.length > 0) {
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

    y = drawFormSection(doc, {
      sideTab: { label: 'MILEAGE' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: 'TOTAL DISTANCE', value: `${totalDist.toFixed(1)} mi`, ratio: 1, align: 'center' },
          { label: 'TOTAL FUEL', value: `${totalGal.toFixed(2)} gal`, ratio: 1, align: 'center' },
          { label: 'TOTAL COST', value: `$${totalCost.toFixed(2)}`, ratio: 1, align: 'center' },
        ]},
      ],
      y,
    });

    // Mileage summary table — standardised via addTableWithShading
    const mileColW = [30, 30, 30, cw - 90];
    const mileColPos: number[] = [];
    { let cx = lx; for (const w of mileColW) { mileColPos.push(cx); cx += w; } }
    const mileHeaders = ['Date', 'Distance (mi)', 'Fuel (gal)', 'Cost']
      .map((label, i) => ({ label, x: mileColPos[i] }));
    const mileRows = sortedDates.map(dateKey => {
      const d = byDate[dateKey];
      return [
        dateKey,
        d.distance > 0 ? d.distance.toFixed(1) : '-',
        d.gallons > 0 ? d.gallons.toFixed(2) : '-',
        d.cost > 0 ? `$${d.cost.toFixed(2)}` : '-',
      ];
    });
    y = addTableWithShading(doc, mileHeaders, mileRows, y, mileColPos);
  }

  // ── STATUS REPORT (default) extras ──
  if (reportType === 'status') {
    // Compliance
    y = drawFormSection(doc, {
      sideTab: { label: 'SERVICE' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: '12. REGISTRATION EXPIRY', value: fmtDate(data.registration_expiry), ratio: 1 },
          { label: '13. INSURANCE EXPIRY', value: fmtDate(data.insurance_expiry), ratio: 1 },
        ]},
        { cells: [
          { label: '14. NEXT SERVICE DUE', value: fmtDate(data.next_service_due), ratio: 1 },
          { label: '15. LAST SERVICE DATE', value: fmtDate(data.last_service_date), ratio: 1 },
        ]},
      ],
      y,
    });

    // Equipment
    if (data.equipment && data.equipment.length > 0) {
      y = drawFormSection(doc, {
        sideTab: { label: 'EQUIP' },
        topBanner: true,
        onPageBreak: formSectionPageBreak,
        rows: [
          { cells: [
            { label: '16. INSTALLED EQUIPMENT', value: data.equipment.join(', '), ratio: 1 },
          ]},
        ],
        y,
      });
    }
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y);

  // Signature Block — officer + company seal
  y = addStackedSignatures(doc, 'Fleet Manager', '', y, getOfficerSig());
}

// ── Personnel / Officer Record ───────────────────────────────

function generatePersonnelReport(doc: jsPDF, data: PersonnelPdfData) {
  const lx = getLeftX();
  const cw = getContentWidth(doc);

  const reportType = data.report_type || 'full';

  setActiveCaseNumber(data.badge_number || data.employee_id || 'N/A');
  const reportTitle = reportType === 'credentials' ? 'CREDENTIALS REPORT'
    : reportType === 'training' ? 'TRAINING REPORT'
    : reportType === 'equipment' ? 'EQUIPMENT REPORT'
    : reportType === 'time' ? 'TIME & ATTENDANCE REPORT'
    : 'PERSONNEL RECORD';
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: reportTitle,
    formNumber: 'FORM PS-207',
    caseNumber: data.badge_number || data.employee_id || 'N/A',
  });

  // ── OFFICER IDENTIFICATION (always shown) ──
  y = drawFormSection(doc, {
    sideTab: { label: 'OFFICER' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '1. LAST NAME', value: data.last_name, ratio: 2, valueBold: true },
        { label: '2. FIRST NAME', value: data.first_name, ratio: 2 },
        { label: '3. MIDDLE NAME', value: data.middle_name || '', ratio: 1 },
      ]},
      { cells: [
        { label: '4. BADGE NUMBER', value: data.badge_number || '', ratio: 1, valueBold: true },
        { label: '5. EMPLOYEE ID', value: data.employee_id || '', ratio: 1 },
        { label: '6. RANK', value: data.rank || '', ratio: 1 },
        { label: '7. ROLE', value: (data.role || '').toUpperCase(), ratio: 1 },
        { label: '8. DEPARTMENT', value: data.department || '', ratio: 1 },
      ]},
    ],
    y,
  });

  // ── FULL / DEFAULT sections ──
  if (reportType === 'full') {
    // Personal Information
    y = drawFormSection(doc, {
      sideTab: { label: 'PERSONAL' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: '9. DATE OF BIRTH', value: fmtDate(data.date_of_birth), ratio: 1 },
          { label: '10. GENDER', value: data.gender || '', ratio: 1, align: 'center' },
          { label: '11. BLOOD TYPE', value: data.blood_type || '', ratio: 1, align: 'center' },
        ]},
        ...(data.allergies ? [{ cells: [
          { label: '12. ALLERGIES', value: data.allergies, ratio: 1 },
        ]}] : []),
      ],
      y,
    });

    // Contact
    y = drawFormSection(doc, {
      sideTab: { label: 'CONTACT' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: '13. PHONE', value: data.phone || '', ratio: 1 },
          { label: '14. EMAIL', value: data.email || '', ratio: 2 },
        ]},
        { cells: [
          { label: '15. ADDRESS', value: `${data.address || ''}${data.city ? `, ${data.city}` : ''}${data.state ? `, ${data.state}` : ''} ${data.zip || ''}`.trim(), ratio: 1 },
        ]},
      ],
      y,
    });

    // Employment
    y = drawFormSection(doc, {
      sideTab: { label: 'EMPLOY' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: '16. HIRE DATE', value: fmtDate(data.hire_date), ratio: 1 },
          { label: '17. TERMINATION DATE', value: fmtDate(data.termination_date), ratio: 1 },
        ]},
        { cells: [
          { label: '18. SHIFT PREFERENCE', value: data.shift_preference || '', ratio: 1 },
          { label: '19. UNIFORM SIZE', value: data.uniform_size || '', ratio: 1, align: 'center' },
        ]},
      ],
      y,
    });

    // Identification
    y = drawFormSection(doc, {
      sideTab: { label: 'ID' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: '20. DL NUMBER', value: data.dl_number || '', ratio: 2 },
          { label: '21. DL STATE', value: data.dl_state || '', ratio: 1, align: 'center' },
          { label: '22. DL EXPIRY', value: fmtDate(data.dl_expiry), ratio: 1 },
        ]},
      ],
      y,
    });

    // Emergency Contact
    y = drawFormSection(doc, {
      sideTab: { label: 'EMERG' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: '23. EMERGENCY CONTACT NAME', value: data.emergency_contact_name || '', ratio: 2 },
          { label: '24. PHONE', value: data.emergency_contact_phone || '', ratio: 1 },
          { label: '25. RELATIONSHIP', value: data.emergency_contact_relationship || '', ratio: 1 },
        ]},
      ],
      y,
    });

    // Certifications
    y = addNarrativeSection(doc, 'Certifications', data.certifications || '', y);
  }

  // ── CREDENTIALS TABLE ──
  if ((reportType === 'full' || reportType === 'credentials') && data.credentials && data.credentials.length > 0) {
    y = drawFormSection(doc, {
      sideTab: { label: 'CREDS' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: 'CREDENTIALS', value: `${data.credentials.length} on file`, ratio: 1 },
        ]},
      ],
      y,
    });

    // Credentials table — standardised via addTableWithShading
    const credColW = [cw * 0.22, cw * 0.18, cw * 0.22, cw * 0.14, cw * 0.14, cw * 0.10];
    const credColPos: number[] = [];
    { let cx = lx; for (const w of credColW) { credColPos.push(cx); cx += w; } }
    const credHeaders = ['Type', 'Number', 'Issuing Authority', 'Issued', 'Expiry', 'Status']
      .map((label, i) => ({ label, x: credColPos[i] }));
    const credRows = data.credentials.map(c => [
      (c.type || '').substring(0, 28),
      (c.credential_number || '').substring(0, 22),
      (c.issuing_authority || '').substring(0, 28),
      fmtDate(c.issued_date),
      fmtDate(c.expiry_date),
      (c.status || '').toUpperCase(),
    ]);
    y = addTableWithShading(doc, credHeaders, credRows, y, credColPos);
  }

  // ── TRAINING RECORDS TABLE ──
  if ((reportType === 'full' || reportType === 'training') && data.training_records && data.training_records.length > 0) {
    // Summary stats
    const totalHours = data.training_records.reduce((s, t) => s + (t.hours || 0), 0);
    const completedCount = data.training_records.filter(t => t.status === 'completed').length;
    y = drawFormSection(doc, {
      sideTab: { label: 'TRAIN' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: 'TOTAL COURSES', value: String(data.training_records.length), ratio: 1, align: 'center' },
          { label: 'COMPLETED', value: String(completedCount), ratio: 1, align: 'center' },
          { label: 'TOTAL HOURS', value: totalHours.toFixed(1), ratio: 1, align: 'center' },
        ]},
      ],
      y,
    });

    // Training table — standardised via addTableWithShading
    const trainColW = [cw * 0.28, cw * 0.14, cw * 0.20, cw * 0.12, cw * 0.10, cw * 0.08, cw * 0.08];
    const trainColPos: number[] = [];
    { let cx = lx; for (const w of trainColW) { trainColPos.push(cx); cx += w; } }
    const trainHeaders = ['Course', 'Category', 'Provider', 'Completed', 'Expiry', 'Hours', 'Status']
      .map((label, i) => ({ label, x: trainColPos[i] }));
    const trainRows = data.training_records.map(t => [
      (t.course_name || '').substring(0, 35),
      (t.category || '').substring(0, 16),
      (t.provider || '').substring(0, 24),
      fmtDate(t.completed_date),
      fmtDate(t.expiry_date),
      String(t.hours || 0),
      (t.status || '').toUpperCase().substring(0, 10),
    ]);
    y = addTableWithShading(doc, trainHeaders, trainRows, y, trainColPos);
  }

  // ── EQUIPMENT TABLE ──
  if ((reportType === 'full' || reportType === 'equipment') && data.equipment_list && data.equipment_list.length > 0) {
    y = drawFormSection(doc, {
      sideTab: { label: 'EQUIP' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: 'ASSIGNED EQUIPMENT', value: `${data.equipment_list.length} items`, ratio: 1 },
        ]},
      ],
      y,
    });

    // Equipment table — standardised via addTableWithShading
    const equipColW = [cw * 0.20, cw * 0.18, cw * 0.18, cw * 0.14, cw * 0.14, cw * 0.16];
    const equipColPos: number[] = [];
    { let cx = lx; for (const w of equipColW) { equipColPos.push(cx); cx += w; } }
    const equipHeaders = ['Type', 'Serial #', 'Make / Model', 'Condition', 'Status', 'Issued']
      .map((label, i) => ({ label, x: equipColPos[i] }));
    const equipRows = data.equipment_list.map(eq => [
      (eq.equipment_type || '').substring(0, 24),
      (eq.serial_number || '').substring(0, 22),
      [eq.make, eq.model].filter(Boolean).join(' ').substring(0, 22),
      (eq.condition || '').toUpperCase(),
      (eq.status || '').toUpperCase(),
      fmtDate(eq.issued_date),
    ]);
    y = addTableWithShading(doc, equipHeaders, equipRows, y, equipColPos);
  }

  // ── BODY CAMERAS TABLE ──
  if ((reportType === 'full' || reportType === 'equipment') && data.body_cameras && data.body_cameras.length > 0) {
    y = drawFormSection(doc, {
      sideTab: { label: 'CAMS' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: 'BODY CAMERAS', value: `${data.body_cameras.length} assigned`, ratio: 1 },
        ]},
      ],
      y,
    });

    // Body cameras table — standardised via addTableWithShading
    const camColW = [cw * 0.18, cw * 0.20, cw * 0.20, cw * 0.14, cw * 0.14, cw * 0.14];
    const camColPos: number[] = [];
    { let cx = lx; for (const w of camColW) { camColPos.push(cx); cx += w; } }
    const camHeaders = ['Camera ID', 'Make', 'Model', 'Status', 'Condition', 'Assigned']
      .map((label, i) => ({ label, x: camColPos[i] }));
    const camRows = data.body_cameras.map(cam => [
      (cam.camera_id || '').substring(0, 22),
      (cam.make || '').substring(0, 24),
      (cam.model || '').substring(0, 24),
      (cam.status || '').toUpperCase(),
      (cam.condition || '').toUpperCase(),
      fmtDate(cam.assigned_at),
    ]);
    y = addTableWithShading(doc, camHeaders, camRows, y, camColPos);
  }

  // ── DEPLOYMENTS TABLE ──
  if ((reportType === 'full') && data.deployments && data.deployments.length > 0) {
    y = drawFormSection(doc, {
      sideTab: { label: 'DEPLOY' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: 'DEPLOYMENTS', value: `${data.deployments.length} records`, ratio: 1 },
        ]},
      ],
      y,
    });

    // Deployments table — standardised via addTableWithShading
    const depColW = [cw * 0.28, cw * 0.14, cw * 0.16, cw * 0.16, cw * 0.12, cw * 0.14];
    const depColPos: number[] = [];
    { let cx = lx; for (const w of depColW) { depColPos.push(cx); cx += w; } }
    const depHeaders = ['Property', 'Position', 'Start', 'End', 'Hrs/Wk', 'Status']
      .map((label, i) => ({ label, x: depColPos[i] }));
    const depRows = data.deployments.map(d => [
      (d.property_name || '').substring(0, 35),
      (d.position || '').substring(0, 16),
      fmtDate(d.start_date),
      fmtDate(d.end_date),
      d.hours_per_week != null ? String(d.hours_per_week) : '',
      (d.status || '').toUpperCase(),
    ]);
    y = addTableWithShading(doc, depHeaders, depRows, y, depColPos);
  }

  // ── TIME & ATTENDANCE TABLE ──
  if ((reportType === 'full' || reportType === 'time') && data.time_entries && data.time_entries.length > 0) {
    const totalHours = data.time_entries.reduce((s, t) => s + (t.total_hours || 0), 0);
    y = drawFormSection(doc, {
      sideTab: { label: 'TIME' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: 'ENTRIES', value: String(data.time_entries.length), ratio: 1, align: 'center' },
          { label: 'TOTAL HOURS', value: totalHours.toFixed(1), ratio: 1, align: 'center' },
        ]},
      ],
      y,
    });

    // Time & attendance table — standardised via addTableWithShading
    const timeColW = [cw * 0.30, cw * 0.30, cw * 0.20, cw * 0.20];
    const timeColPos: number[] = [];
    { let cx = lx; for (const w of timeColW) { timeColPos.push(cx); cx += w; } }
    const timeHeaders = ['Clock In', 'Clock Out', 'Hours', 'Status']
      .map((label, i) => ({ label, x: timeColPos[i] }));
    const timeRows = data.time_entries.map(t => [
      fmtDateTime(t.clock_in),
      t.clock_out ? fmtDateTime(t.clock_out) : 'Active',
      t.total_hours != null ? t.total_hours.toFixed(2) : '-',
      (t.status || '').toUpperCase(),
    ]);
    y = addTableWithShading(doc, timeHeaders, timeRows, y, timeColPos);
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block — full-width stacked
  y = addStackedSignatures(doc, 'HR / Supervisor', 'Officer', y, undefined, getOfficerSig());
}

// ── Property Record ──────────────────────────────────────────

function generatePropertyReport(doc: jsPDF, data: PropertyPdfData) {
  const cw = getContentWidth(doc);

  setActiveCaseNumber(data.name || 'N/A');
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'PROPERTY RECORD',
    formNumber: 'FORM PS-208',
    caseNumber: data.name || 'N/A',
  });

  // Property Information
  y = drawFormSection(doc, {
    sideTab: { label: 'PROPERTY' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '1. PROPERTY NAME', value: data.name || '', ratio: 2, valueBold: true },
        { label: '2. CLIENT', value: data.client_name || '', ratio: 2 },
      ]},
      { cells: [
        { label: '3. PROPERTY TYPE', value: data.property_type || '', ratio: 1 },
        { label: '4. STATUS', value: data.is_active ? 'ACTIVE' : 'INACTIVE', ratio: 1, align: 'center' },
      ]},
    ],
    y,
  });

  // Location
  y = drawFormSection(doc, {
    sideTab: { label: 'LOCATION' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '5. ADDRESS', value: `${data.address || ''}${data.city ? `, ${data.city}` : ''}${data.state ? `, ${data.state}` : ''} ${data.zip || ''}`.trim(), ratio: 1 },
      ]},
      { cells: [
        { label: '6. LATITUDE', value: data.latitude != null ? String(data.latitude) : '', ratio: 1, align: 'center' },
        { label: '7. LONGITUDE', value: data.longitude != null ? String(data.longitude) : '', ratio: 1, align: 'center' },
      ]},
    ],
    y,
  });

  // Access & Security
  y = drawFormSection(doc, {
    sideTab: { label: 'ACCESS' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '8. GATE CODE', value: data.gate_code || '', ratio: 1 },
        { label: '9. ALARM CODE', value: data.alarm_code || '', ratio: 1 },
        { label: '10. EMERGENCY CONTACT', value: data.emergency_contact || '', ratio: 2 },
      ]},
    ],
    y,
  });

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

  // Signature Block — officer + company seal
  y = addStackedSignatures(doc, 'Officer', '', y, getOfficerSig());
}

// ── Citation Report ──────────────────────────────────────────

function generateCitationReport(doc: jsPDF, data: CitationPdfData) {
  // Map citation type to a priority for the standard classification bar
  const typePrioMap: Record<string, string> = {
    traffic: 'medium',
    criminal: 'critical',
    parking: 'low',
    warning: 'routine',
  };
  const prio = typePrioMap[data.type] || 'routine';

  setActiveCaseNumber(data.citation_number);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'CITATION / SUMMONS',
    formNumber: 'FORM PS-209',
    caseNumber: data.citation_number,
  });

  // Citation Information
  y = drawFormSection(doc, {
    sideTab: { label: 'CITATION' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '1. CITATION NUMBER', value: data.citation_number, ratio: 2, valueBold: true },
        { label: '2. TYPE', value: (data.type || '').replace(/_/g, ' ').toUpperCase(), ratio: 1, align: 'center' },
        { label: '3. STATUS', value: (data.status || '').replace(/_/g, ' ').toUpperCase(), ratio: 1, align: 'center' },
      ]},
      { cells: [
        { label: '4. DATE OF VIOLATION', value: data.violation_date || '', ratio: 1 },
        { label: '5. TIME', value: data.violation_time || '', ratio: 1, align: 'center' },
        { label: '6. LOCATION', value: data.location || '', ratio: 2 },
      ]},
    ],
    y,
  });

  // Violation Details
  y = drawFormSection(doc, {
    sideTab: { label: 'OFFENSE' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '7. STATUTE / CODE', value: data.statute_citation || '', ratio: 2 },
        { label: '8. OFFENSE LEVEL', value: (data.offense_level || '').replace(/_/g, ' ').toUpperCase(), ratio: 1, align: 'center' },
        { label: '9. FINE AMOUNT', value: data.fine_amount != null ? fmtCurrency(data.fine_amount) : '', ratio: 1, align: 'center' },
      ]},
      ...(data.violation_description ? [{ cells: [
        { label: '10. VIOLATION DESCRIPTION', value: data.violation_description, ratio: 1 },
      ]}] : []),
    ],
    y,
  });

  // Subject Information
  y = drawFormSection(doc, {
    sideTab: { label: 'SUBJECT' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '11. NAME', value: data.person_name || '', ratio: 2, valueBold: true },
        { label: '12. DATE OF BIRTH', value: fmtDate(data.person_dob), ratio: 1 },
      ]},
      { cells: [
        { label: "13. DRIVER'S LICENSE", value: data.person_dl || '', ratio: 1 },
        { label: '14. ADDRESS', value: data.person_address || '', ratio: 2 },
      ]},
    ],
    y,
  });

  // Vehicle Information
  if (data.vehicle_description || data.vehicle_plate) {
    y = drawFormSection(doc, {
      sideTab: { label: 'VEHICLE' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: '15. VEHICLE DESCRIPTION', value: data.vehicle_description || '', ratio: 2 },
          { label: '16. PLATE', value: data.vehicle_plate || '', ratio: 1 },
          { label: '17. STATE', value: data.vehicle_state || '', ratio: 1, align: 'center' },
        ]},
      ],
      y,
    });
  }

  // Issuing Officer
  y = drawFormSection(doc, {
    sideTab: { label: 'OFFICER' },
    topBanner: true,
    onPageBreak: formSectionPageBreak,
    rows: [
      { cells: [
        { label: '18. OFFICER NAME', value: data.issuing_officer_name || '', ratio: 2 },
        { label: '19. BADGE NUMBER', value: data.badge_number || '', ratio: 1 },
      ]},
    ],
    y,
  });

  // Court Information
  if (data.court_name || data.court_date) {
    y = drawFormSection(doc, {
      sideTab: { label: 'COURT' },
      topBanner: true,
      onPageBreak: formSectionPageBreak,
      rows: [
        { cells: [
          { label: '20. COURT NAME', value: data.court_name || '', ratio: 2 },
          { label: '21. COURT DATE', value: fmtDate(data.court_date), ratio: 1 },
        ]},
        ...(data.court_address ? [{ cells: [
          { label: '22. COURT ADDRESS', value: data.court_address, ratio: 1 },
        ]}] : []),
      ],
      y,
    });
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y, prio);

  // Dual Signature Block — full-width stacked
  y = addStackedSignatures(doc, 'Issuing Officer', 'Recipient', y, getOfficerSig(), undefined, prio);
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
  try {
    const branding = await fetchPdfBranding();
    setActiveBranding(branding);
    await loadPdfAssets();

    // Extract officer info for signature auto-fill (always populate name/badge/date)
    const anyData = data as any;
    const officerName = anyData.officer_name || anyData.reporting_officer || anyData.full_name || anyData.issuing_officer_name || anyData.entered_by || '';
    const badgeNum = anyData.badge_number || anyData.officer_badge || '';
    // Use call closed/cleared date if available, otherwise now — always include time with seconds
    const closedDate = anyData.closed_at || anyData.cleared_at || anyData.archived_at || null;
    const sigDate = closedDate ? new Date(closedDate) : new Date();
    const _p2 = (n: number) => String(n).padStart(2, '0');
    const sigDateStr = `${_p2(sigDate.getMonth() + 1)}/${_p2(sigDate.getDate())}/${sigDate.getFullYear()} ${_p2(sigDate.getHours())}:${_p2(sigDate.getMinutes())}:${_p2(sigDate.getSeconds())}`;
    setActiveOfficerSignature({
      signatureImage: anyData._officerSignature || null,
      printedName: officerName,
      badgeNumber: badgeNum,
      date: sigDateStr,
    });

    const doc = generateRecordPdf(recordType, data);
    setActiveOfficerSignature(undefined); // clear after generation
    const id = identifier || 'record';
    const filename = `${id}_${recordType}.pdf`;
    // Explicit blob download — works on Safari (doc.save uses window.open which strips filename)
    const blob = doc.output('blob');
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    setActiveOfficerSignature(undefined);
    console.error('Record PDF generation failed:', err);
    throw new Error(`Failed to generate ${recordType} PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/** Generate record PDF and return a blob URL for in-app preview */
export async function generateRecordPdfBlobUrl<T extends RecordPdfType>(
  recordType: T,
  data: RecordDataMap[T],
): Promise<string> {
  try {
    const branding = await fetchPdfBranding();
    setActiveBranding(branding);
    await loadPdfAssets();

    // Extract officer info for signature auto-fill (always populate name/badge/date)
    const anyData = data as any;
    const officerName = anyData.officer_name || anyData.reporting_officer || anyData.full_name || anyData.issuing_officer_name || anyData.entered_by || '';
    const badgeNum = anyData.badge_number || anyData.officer_badge || '';
    // Use call closed/cleared date if available, otherwise now — always include time with seconds
    const closedDate = anyData.closed_at || anyData.cleared_at || anyData.archived_at || null;
    const sigDate = closedDate ? new Date(closedDate) : new Date();
    const _p2 = (n: number) => String(n).padStart(2, '0');
    const sigDateStr = `${_p2(sigDate.getMonth() + 1)}/${_p2(sigDate.getDate())}/${sigDate.getFullYear()} ${_p2(sigDate.getHours())}:${_p2(sigDate.getMinutes())}:${_p2(sigDate.getSeconds())}`;
    setActiveOfficerSignature({
      signatureImage: anyData._officerSignature || null,
      printedName: officerName,
      badgeNumber: badgeNum,
      date: sigDateStr,
    });

    const doc = generateRecordPdf(recordType, data);
    setActiveOfficerSignature(undefined); // clear after generation
    const blob = doc.output('blob');
    return URL.createObjectURL(blob);
  } catch (err) {
    setActiveOfficerSignature(undefined);
    console.error('Record PDF preview generation failed:', err);
    throw new Error(`Failed to generate ${recordType} PDF preview: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}
