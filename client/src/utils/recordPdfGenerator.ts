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
  displayStatus,
} from './pdfGenerator';
import type { PdfImage, PdfSignatureData } from './pdfGenerator';
import { convertToGrayscale } from './pdfGenerator';
import {
  LAYOUT, SPACING, FONT, COLOR, BORDER,
  getContentWidth, getHalfWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth, getQuarterWidth,
} from './pdfTokens';
import {
  drawCheckboxGrid, drawNibrsHeader, drawFormSection, drawGeographyStrip,
  type CheckboxItem, type FormRow,
} from './pdfFormHelpers';
import { toDisplayLabel } from './formatters';

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

// ── Local Helpers ────────────────────────────────────────────

/**
 * Labeled narrative field: prints a small bold label then word-wrapped body text.
 * Used for multi-line descriptive fields inside open sections.
 */
function addNarrativeField(doc: jsPDF, label: string, value: string, x: number, y: number, width: number): number {
  if (!value || !value.trim()) return y;
  // Label line
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(label.toUpperCase(), x, y + 1.8);
  y += 3.0;
  // Body text — word-wrapped Courier
  doc.setFont('courier', 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  const lineH = 3.2;
  const raw = sanitizePdfText(value);
  const lines = doc.splitTextToSize(raw, width - 1) as string[];
  for (const line of lines) {
    y = checkPageBreak(doc, y, lineH + 2);
    doc.text(line, x, y);
    y += lineH;
  }
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + 1;
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
  sector_id?: string;
  zone_id?: string;
  beat_id?: string;
  dispatch_code?: string;
  // District names (green columns — shown on PDF header)
  sector_name?: string;
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
  // Geography / Contract
  area_name?: string;
  sector_name?: string;
  zone_name?: string;
  beat_name?: string;
  contract_id?: string;
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
  // LE Identifiers
  ncic_number?: string;
  sor_number?: string;
  fbi_number?: string;
  state_id_number?: string;
  passport_number?: string;
  passport_country?: string;
  immigration_status?: string;
  // Military / Education
  military_branch?: string;
  military_status?: string;
  education_level?: string;
  tribal_affiliation?: string;
  // Medical / Behavioral
  disability_flags?: string;
  mental_health_flags?: string;
  substance_abuse?: string;
  medication_notes?: string;
  // Detailed Marks
  tattoo_description?: string;
  scar_description?: string;
  piercing_description?: string;
  distinguishing_features?: string;
  identifying_marks_location?: string;
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
  // Geography / Contract
  area_name?: string;
  sector_name?: string;
  zone_name?: string;
  beat_name?: string;
  contract_id?: string;
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
  // Condition
  title_status?: string;
  exterior_condition?: string;
  interior_condition?: string;
  estimated_value?: string;
  // Features
  window_tint?: string;
  modifications?: string;
  equipment_notes?: string;
  // Additional Registration
  registered_owner?: string;
  registration_state?: string;
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
  subject_photo_url?: string;
  service_attempts?: { attempted_at: string; location: string; method: string; result: string; notes: string }[];
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
  // Source / Verification (for Utah search results)
  county?: string;
  case_number?: string;
  filing_date?: string;
  data_source?: string;
  search_date?: string;
  verified_by?: string;
  verification_date?: string;
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
  mpg?: number | null;
  calc_distance?: number | null;
  cost_per_mile?: number | null;
  running_avg_mpg?: number | null;
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
  // Fuel summary stats (passed from frontend)
  fuel_summary?: {
    total_gallons?: number;
    total_cost?: number;
    avg_mpg?: number | null;
    avg_cost_per_gallon?: number;
    best_mpg?: number | null;
    worst_mpg?: number | null;
    total_distance?: number | null;
    cost_per_mile?: number | null;
    fuel_cost_per_day?: number | null;
  };
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
  // Geography / Contract
  area_name?: string;
  sector_name?: string;
  zone_name?: string;
  beat_name?: string;
  contract_id?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  property_type?: string;
  is_active?: boolean;
  // Building Details
  business_type?: string;
  structure_type?: string;
  occupancy_status?: string;
  year_built?: string;
  square_footage?: string;
  number_of_stories?: string;
  // Owner & Key Holder
  owner_name?: string;
  owner_phone?: string;
  key_holder_name?: string;
  key_holder_phone?: string;
  key_holder_relationship?: string;
  // Security
  gate_code?: string;
  alarm_code?: string;
  alarm_company?: string;
  alarm_account?: string;
  camera_system?: string;
  security_features?: string;
  emergency_contact?: string;
  // Facility
  parking_info?: string;
  roof_access?: string;
  utility_shutoffs?: string;
  known_hazards?: string;
  last_inspection_date?: string;
  inspection_status?: string;
  // Instructions
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
    const d = new Date(ts.includes('T') ? ts : ts + 'T00:00:00');
    if (isNaN(d.getTime())) return ts;
    const { mm, dd, yyyy, hh, min, sec } = toMountain(d);
    return `${mm}/${dd}/${yyyy} @ ${hh}:${min}:${sec}`;
  } catch { return ts; }
}

/** Format: MM/DD/YYYY */
function fmtDate(ts?: string | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts.includes('T') ? ts : ts + 'T00:00:00');
    if (isNaN(d.getTime())) return ts;
    const { mm, dd, yyyy } = toMountain(d);
    return `${mm}/${dd}/${yyyy}`;
  } catch { return ts; }
}

/** Format: MM/DD/YYYY @ HH:MM:SS (military time) */
function fmtDateTime(ts?: string | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts.includes('T') ? ts : ts + 'T00:00:00');
    if (isNaN(d.getTime())) return ts;
    const { mm, dd, yyyy, hh, min, sec } = toMountain(d);
    return `${mm}/${dd}/${yyyy} @ ${hh}:${min}:${sec}`;
  } catch { return ts; }
}

function fmtCurrency(val?: number | null): string {
  if (val == null) return 'N/A';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

/** Capitalize the first letter of each word (e.g., "suspect" → "Suspect", "co owner" → "Co Owner") */
function titleCase(str: string): string {
  if (!str) return '';
  return str.replace(/\b\w/g, (c: string) => c.toUpperCase());
}

// ── Call for Service Report ──────────────────────────────────

async function generateCallReport(doc: jsPDF, data: CallPdfData) {
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
    doc.setFillColor(...COLOR.TEXT_PRIMARY);
    doc.rect(LAYOUT.PAGE_MARGIN, barY, cw, barH, 'F');

    const distFields = [
      { label: 'SECTION', value: data.sector_name || 'N/A' },
      { label: 'ZONE', value: data.zone_name || 'N/A' },
      { label: 'BEAT', value: data.beat_id || 'N/A' },
      { label: 'AREA', value: data.beat_descriptor || 'N/A' },
      { label: 'CODE', value: data.dispatch_code || 'N/A' },
      ...(hasContract ? [{ label: 'CONTRACT ID', value: data.contract_id || 'N/A' }] : []),
    ];

    // Dynamic column widths — measure all values, no truncation
    const dValSize = 6; // compact font for district bar
    const dPad = 3; // padding between columns — enough to prevent truncation
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
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
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
      { label: 'Incident Type', value: toDisplayLabel(data.incident_type || '') },
      { label: 'Priority', value: data.priority },
      { label: 'Status', value: displayStatus(data.status || '') },
      { label: 'Source', value: toDisplayLabel(data.source || '') },
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
  y = checkPageBreak(doc, y, 18, prio);
  { const sec = openAutoSection(doc, 'Caller Information', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Caller Name', data.caller_name || '', lx, y, hfw);
      const yR = addFieldPair(doc, 'Phone', data.caller_phone || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    { const rel = data.caller_relationship || '';
      const yL = addFieldPair(doc, 'Relationship', rel.toUpperCase(), lx, y, hfw);
      const yR = addFieldPair(doc, 'Caller Address', data.caller_address || '', rx, y, hfw);
      y = Math.max(yL, yR); }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // PSO Client Request Details — right after Caller Information
  if (data.incident_type === 'pso_client_request') {
    y = checkPageBreak(doc, y, 18, prio);
    const attemptNum = data.pso_attempt_number || 1;
    const attemptLabel = attemptNum > 1
      ? ` -- ${attemptNum === 2 ? '2nd' : attemptNum === 3 ? '3rd' : attemptNum + 'th'} Attempt`
      : '';
    const psoSec = openAutoSection(doc, `PSO Client Request Details${attemptLabel}`, y); y = psoSec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Service Type', value: toDisplayLabel(data.pso_service_type || '') },
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
      y = checkPageBreak(doc, y, 18, prio);
      const psSec = openAutoSection(doc, 'Process Service Details', y); y = psSec.contentY;
      y = addThreeColumnFields(doc, [
        { label: 'Document Type', value: toDisplayLabel(data.process_service_type || '') },
        { label: 'Serve To', value: data.process_served_to || '' },
        { label: 'Attempts', value: String(data.process_attempts || 0) },
      ], y);
      y = addThreeColumnFields(doc, [
        { label: 'Service Address', value: data.process_served_address || '' },
        { label: 'Served At', value: fmtTimestamp(data.process_served_at) },
        { label: 'Result', value: toDisplayLabel(data.process_service_result || '') },
      ], y);
      y = closeAutoSection(doc, psSec.sectionY, y, undefined, psSec.sectionPage);
    }
  }

  // Location
  y = checkPageBreak(doc, y, 18, prio);
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
        { label: 'Section ID', value: data.sector_id || '' },
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
  { const flagSec = openAutoSection(doc, 'Flags', y);
    // Checkboxes draw at y-1.5, so need extra offset to clear header bar
    y = flagSec.contentY + 2;
    const flagCols = 6;
    const flagColW = ffw / flagCols;
    const flagRowH = 3.5;
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
  y = checkPageBreak(doc, y, 18, prio);
  { const sec = openAutoSection(doc, 'Scene Conditions', y); y = sec.contentY;
    // All 4 fields in one row
    const scW = ffw / 4;
    const scFields = [
      { label: 'Weather', value: data.weather_conditions || '' },
      { label: 'Lighting', value: data.lighting_conditions || '' },
      { label: 'Weapons', value: (!data.weapons_involved || data.weapons_involved === '0') ? 'N/A' : data.weapons_involved },
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
      y = checkPageBreak(doc, y, 18, prio); // header + at least 1 unit row
      const uSec = openAutoSection(doc, 'Assigned Units', y); y = uSec.sectionY + SPACING.SECTION_HEADER_H;
      if (unitDetail2 && unitDetail2.length > 0) {
        const UNIT_ROLES2 = ['Primary Officer', 'Secondary Officer', 'Assisting Officer', 'Cover Officer', 'Supervisor On Scene'];
        const uqw = ffw / 4;
        for (let idx = 0; idx < unitDetail2.length; idx++) {
          const u = unitDetail2[idx];
          y = checkPageBreak(doc, y, 12);
          const uFields = [
            { label: 'Call Sign', value: u.call_sign || 'N/A' },
            { label: 'Officer', value: u.officer_name || 'N/A' },
            { label: 'Badge #', value: u.badge_number || 'N/A' },
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

  // Mileage — single row: Vehicle ID | Starting | Ending | Total (keep on current page if possible)
  if (data.starting_mileage != null || data.ending_mileage != null || data.responding_vehicle_id) {
    y = checkPageBreak(doc, y, 16, prio); // header + 1 mileage row
    const sec = openAutoSection(doc, 'Mileage', y); y = sec.contentY;
    const totalMiles = (data.starting_mileage != null && data.ending_mileage != null)
      ? (Number(data.ending_mileage) - Number(data.starting_mileage)).toFixed(1)
      : '';
    const qw = ffw / 4;
    let maxY = y + SPACING.FIELD_ROW_ADVANCE;
    const mileFields = [
      { label: 'Vehicle ID', value: data.responding_vehicle_id || 'N/A' },
      { label: 'Starting Mileage', value: data.starting_mileage != null ? Number(data.starting_mileage).toLocaleString() : 'N/A' },
      { label: 'Ending Mileage', value: data.ending_mileage != null ? Number(data.ending_mileage).toLocaleString() : 'N/A' },
      { label: 'Total Miles', value: totalMiles || 'N/A' },
    ];
    for (let i = 0; i < 4; i++) {
      const fy = addFieldPair(doc, mileFields[i].label, mileFields[i].value, lx + i * qw, y, qw);
      if (fy > maxY) maxY = fy;
    }
    y = maxY;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Linked Persons — clean table: section header + column headers + data rows
  if (data.linked_persons && data.linked_persons.length > 0) {
    y = checkPageBreak(doc, y, 22, prio);
    const sec = openAutoSection(doc, 'LINKED PERSONS', y); y = sec.sectionY + SPACING.SECTION_HEADER_H;
    const pHeaders = ['NAME', 'ROLE', 'DOB', 'RACE/SEX', 'PHONE'];
    const pColW = [ffw * 0.25, ffw * 0.15, ffw * 0.14, ffw * 0.26, ffw * 0.20];
    const rowH = 4.5;
    // Column header — matches addTableWithShading style exactly
    const cw = getContentWidth(doc);
    doc.setFillColor(...COLOR.BG_TABLE_HDR);
    doc.rect(LAYOUT.PAGE_MARGIN, y, cw, rowH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_TABLE_HEADER);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    let hx = lx;
    for (let i = 0; i < pHeaders.length; i++) {
      const capH = FONT.SIZE_TABLE_HEADER * 0.35;
      doc.text(pHeaders[i], hx + 1, y + (rowH + capH) / 2);
      hx += pColW[i];
    }
    y += rowH;
    // Data rows
    doc.setFont('courier', 'normal');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE);
    for (const p of data.linked_persons) {
      y = checkPageBreak(doc, y, rowH);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      const pVals = [
        `${p.last_name || ''}, ${p.first_name || ''}`.trim().replace(/^,\s*/, '').toUpperCase() || '—',
        toDisplayLabel(p.role || '') || '—',
        (p.dob || '—').toUpperCase(),
        [p.race, p.gender].filter(Boolean).join('/').toUpperCase() || '—',
        (p.phone || '—').toUpperCase(),
      ];
      let dx = lx;
      for (let i = 0; i < pVals.length; i++) {
        doc.text(pVals[i], dx + 1.5, y + rowH * 0.65);
        dx += pColW[i];
      }
      y += rowH;
      // Bottom separator
      doc.setDrawColor(...COLOR.BORDER_TABLE);
      doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y, lx + ffw, y);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Linked Vehicles — clean table: section header + column headers + data rows
  if (data.linked_vehicles && data.linked_vehicles.length > 0) {
    y = checkPageBreak(doc, y, 22, prio);
    const sec = openAutoSection(doc, 'LINKED VEHICLES', y); y = sec.sectionY + SPACING.SECTION_HEADER_H;
    const vHeaders = ['ROLE', 'YEAR/MAKE/MODEL', 'COLOR', 'PLATE', 'OWNER'];
    const vColW = [ffw * 0.13, ffw * 0.28, ffw * 0.12, ffw * 0.17, ffw * 0.30];
    const rowH = 4.5;
    // Column header — matches addTableWithShading style
    const vcw = getContentWidth(doc);
    doc.setFillColor(...COLOR.BG_TABLE_HDR);
    doc.rect(LAYOUT.PAGE_MARGIN, y, vcw, rowH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_TABLE_HEADER);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    let vhx = lx;
    for (let i = 0; i < vHeaders.length; i++) {
      const capH = FONT.SIZE_TABLE_HEADER * 0.35;
      doc.text(vHeaders[i], vhx + 1, y + (rowH + capH) / 2);
      vhx += vColW[i];
    }
    y += rowH;
    // Data rows
    doc.setFont('courier', 'normal');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE);
    for (const v of data.linked_vehicles) {
      y = checkPageBreak(doc, y, rowH);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      const stolen = v.stolen_status && !['none', 'not_stolen', 'recovered', ''].includes(v.stolen_status.toLowerCase()) ? ` [${toDisplayLabel(v.stolen_status)}]` : '';
      const vVals = [
        toDisplayLabel(v.role || '') || '—',
        [v.year, v.make, v.model].filter(Boolean).join(' ').toUpperCase() || '—',
        (v.color || '—').toUpperCase(),
        ((v.plate_number || '') + (v.plate_state ? `/${v.plate_state}` : '')).toUpperCase() || '—',
        ([v.owner_last_name, v.owner_first_name].filter(Boolean).join(', ') + stolen).toUpperCase() || '—',
      ];
      let vdx = lx;
      for (let i = 0; i < vVals.length; i++) {
        doc.text(vVals[i], vdx + 1.5, y + rowH * 0.65);
        vdx += vColW[i];
      }
      y += rowH;
      // Bottom separator
      doc.setDrawColor(...COLOR.BORDER_TABLE);
      doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y, lx + ffw, y);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Incident Details — dynamic page break ──
  y = checkPageBreak(doc, y, 25, prio);
  { const sec = openAutoSection(doc, 'Incident Details', y); y = sec.contentY;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('DESCRIPTION', lx, y + 2);
    y += 4.5;
    doc.setFont('courier', 'normal');
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    // Page break callback: draw "INCIDENT DETAILS -- CONTINUED" header on new page
    const descPageBreak = (newY: number): number => {
      const cw = getContentWidth(doc);
      doc.setFillColor(...COLOR.BG_SECTION_HDR);
      doc.rect(LAYOUT.PAGE_MARGIN, newY, cw, SPACING.SECTION_HEADER_H, 'F');
      doc.setDrawColor(...COLOR.BORDER_SECTION);
      doc.setLineWidth(BORDER.SECTION_OUTER);
      doc.rect(LAYOUT.PAGE_MARGIN, newY, cw, SPACING.SECTION_HEADER_H);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_SECTION_TITLE);
      doc.setTextColor(...COLOR.TEXT_INVERTED);
      const capH = FONT.SIZE_SECTION_TITLE * 0.35;
      doc.text('INCIDENT DETAILS -- CONTINUED', LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET + 1, newY + (SPACING.SECTION_HEADER_H + capH) / 2);
      doc.setFont('courier', 'normal');
      doc.setFontSize(FONT.SIZE_FIELD_VALUE);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      // Extra padding so text clears the header bar (matching other section body spacing)
      return newY + SPACING.SECTION_HEADER_H + SPACING.SECTION_CONTENT_PAD + 2;
    };
    y = addFormattedText(doc, (data.description || '').toUpperCase(), lx, y, ffw, FONT.SIZE_FIELD_VALUE, descPageBreak);
    y += SPACING.MD; // Tight gap before # Subjects row
    // Pack remaining fields tightly — check page break before each group
    y = checkPageBreak(doc, y, 10, prio);
    y = addThreeColumnFields(doc, [
      { label: '# Subjects', value: data.num_subjects != null ? String(data.num_subjects) : '' },
      { label: '# Victims', value: data.num_victims != null ? String(data.num_victims) : '' },
      { label: 'Direction of Travel', value: data.direction_of_travel || '' },
    ], y);
    // Subject + Vehicle on same line — only show if non-empty
    const hasSubjDesc = data.subject_description && data.subject_description.trim() && data.subject_description.trim() !== '--';
    const hasVehDesc = data.vehicle_description && data.vehicle_description.trim() && data.vehicle_description.trim() !== '--';
    if (hasSubjDesc || hasVehDesc) {
      y = checkPageBreak(doc, y, 8, prio);
      const yL = addFieldPair(doc, 'Subject Description', hasSubjDesc ? data.subject_description!.trim() : 'N/A', lx, y, hfw);
      const yR = addFieldPair(doc, 'Vehicle Description', hasVehDesc ? data.vehicle_description!.trim() : 'N/A', rx, y, hfw);
      y = Math.max(yL, yR);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Flags — already rendered above (before Scene Conditions)

  // LE Coordination
  if (data.le_agency || data.le_case_number) {
    y = checkPageBreak(doc, y, 18, prio);
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
      y = checkPageBreak(doc, y, 12, prio);
      if (vi > 0) {
        doc.setDrawColor(...COLOR.BORDER_TABLE);
        doc.setLineWidth(BORDER.TABLE_ROW);
        doc.line(lx, y, lx + ffw, y);
        y += 0.3;
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
      doc.setFontSize(FONT.SIZE_TABLE_HEADER);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text(statusText, lx + visitLabelW, y);

      // Units on the right
      let unitsList: string[] = [];
      try { unitsList = JSON.parse(visit.assigned_units || '[]'); } catch { /* ignore */ }
      if (unitsList.length > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(FONT.SIZE_TABLE_HEADER);
        doc.setTextColor(...COLOR.TEXT_TERTIARY);
        const unitsText = sanitizePdfText(`Units: ${unitsList.join(', ')}`);
        const unitsW = doc.getTextWidth(unitsText);
        doc.text(unitsText, lx + ffw - unitsW, y);
      }
      y += SPACING.SM;

      // Timestamps row
      const timeFields: string[] = [];
      if (visit.dispatched_at) timeFields.push(`Disp: ${fmtDateTime(visit.dispatched_at)}`);
      if (visit.enroute_at) timeFields.push(`EnRt: ${fmtDateTime(visit.enroute_at)}`);
      if (visit.onscene_at) timeFields.push(`OnSc: ${fmtDateTime(visit.onscene_at)}`);
      if (visit.cleared_at) timeFields.push(`Clr: ${fmtDateTime(visit.cleared_at)}`);
      if (visit.closed_at) timeFields.push(`Cls: ${fmtDateTime(visit.closed_at)}`);

      if (timeFields.length > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(FONT.SIZE_TABLE_HEADER);
        doc.setTextColor(...COLOR.TEXT_TERTIARY);
        doc.text(sanitizePdfText(timeFields.join('    ')), lx + SPACING.MD, y);
        y += SPACING.SM;
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
        doc.setFontSize(FONT.SIZE_TABLE_HEADER);
        doc.setTextColor(...COLOR.TEXT_TERTIARY);
        doc.text(sanitizePdfText(mileageFields.join('    ')), lx + SPACING.MD, y);
        y += SPACING.SM;
      }

      // Disposition
      if (visit.disposition) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(FONT.SIZE_TABLE_HEADER);
        doc.setTextColor(...COLOR.TEXT_PRIMARY);
        doc.text(sanitizePdfText(`Disposition: ${visit.disposition}`), lx + SPACING.MD, y);
        y += SPACING.SM;
      }
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Assigned Units — already rendered above (after Scene Conditions)

  // Damage Assessment (conditional)
  if (data.damage_estimate || data.damage_description) {
    y = checkPageBreak(doc, y, 18, prio);
    const sec = openAutoSection(doc, 'Damage Assessment', y); y = sec.contentY;
    { const yL = addFieldPair(doc, 'Estimate', fmtCurrency(data.damage_estimate), lx, y, hfw);
      const yR = addFieldPair(doc, 'Description', data.damage_description || 'UNDETERMINED', rx, y, hfw);
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
    y = addFieldPair(doc, 'Action Taken', data.action_taken || 'N/A', lx, y, ffw);
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
      doc.setFontSize(FONT.SIZE_TABLE_HEADER);
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
    // Render notes: DATE/TIME on left, AUTHOR on right, content below
    y += 1.5;  // Space after header bar
    for (let ni = 0; ni < data.notes.length; ni++) {
      const n = data.notes[ni];
      y = checkPageBreak(doc, y, 10, prio);
      // Date/time on far left, author on far right — same line
      doc.setFont('courier', 'bold');
      doc.setFontSize(6);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      const tsText = fmtTimestamp(n.created_at).toUpperCase();
      doc.text(tsText, lx, y);
      const authorName = (n.author || 'System').toUpperCase();
      const authorW = doc.getTextWidth(authorName);
      doc.text(authorName, lx + ffw - authorW, y);
      y += 3.5;  // More space between timestamp and content
      // Note content
      doc.setFont('courier', 'normal');
      doc.setFontSize(FONT.SIZE_FIELD_VALUE);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.setDrawColor(...COLOR.TEXT_PRIMARY);
      y = addFormattedText(doc, (n.content || '').toUpperCase(), lx, y, ffw);
      // Visible gap between entries (matching Resolution Details spacing)
      if (ni < data.notes.length - 1) {
        y += 2;
        // Light separator line between notes
        doc.setDrawColor(...COLOR.BORDER_TABLE);
        doc.setLineWidth(BORDER.TABLE_ROW);
        doc.line(lx, y, lx + ffw, y);
        y += 2.5;
      }
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = await addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signatures — full-width stacked (one on top of the other)
  y = addStackedSignatures(doc, 'Reporting Officer', 'Supervisor Review', y, getOfficerSig(), undefined, prio);
}

// ── Person Record ────────────────────────────────────────────

async function generatePersonReport(doc: jsPDF, data: PersonPdfData) {
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

  // Geography / Contract strip — AREA | SECTOR | ZONE | BEAT | CONTRACT ID
  y = drawGeographyStrip(doc, y, {
    area: data.area_name,
    sector: data.sector_name,
    zone: data.zone_name,
    beat: data.beat_name,
    contract_id: data.contract_id,
  });

  // ── 1. Subject Identification ─────────────────────────────
  { const sec = openAutoSection(doc, 'Subject Identification', y); y = sec.contentY;
    const fifthW = ffw / 5;

    // Row 1: Last Name, First Name, Middle Name — full width, normal layout
    const fy1 = addFieldPair(doc, 'Last Name', data.last_name || '', lx, y, ffw * 0.4);
    const fy2 = addFieldPair(doc, 'First Name', data.first_name || '', lx + ffw * 0.4, y, ffw * 0.35);
    const fy3 = addFieldPair(doc, 'Middle Name', data.middle_name || '', lx + ffw * 0.75, y, ffw * 0.25);
    y = Math.max(fy1, fy2, fy3);
    // Row 2: Alias, DOB, Gender, Race — full width
    const fy4 = addFieldPair(doc, 'Alias / Nickname', data.alias_nickname || '', lx, y, hfw);
    const fy5 = addFieldPair(doc, 'Date of Birth', fmtDate(data.date_of_birth), rx, y, ffw * 0.2);
    const fy6 = addFieldPair(doc, 'Gender', data.gender || '', rx + ffw * 0.2, y, ffw * 0.15);
    const fy7 = addFieldPair(doc, 'Race', data.race || '', rx + ffw * 0.35, y, ffw * 0.15);
    y = Math.max(fy4, fy5, fy6, fy7);
    // Row 3: Marital Status, Citizenship, Place of Birth, Language, Record ID
    const fy8 = addFieldPair(doc, 'Marital Status', data.marital_status || '', lx, y, fifthW);
    const fy9 = addFieldPair(doc, 'Citizenship', data.citizenship || '', lx + fifthW, y, fifthW);
    const fy10 = addFieldPair(doc, 'Place of Birth', data.place_of_birth || '', lx + 2 * fifthW, y, fifthW);
    const fy11 = addFieldPair(doc, 'Language', data.language || '', lx + 3 * fifthW, y, fifthW);
    const fy12 = addFieldPair(doc, 'Record ID', String(data.id || ''), lx + 4 * fifthW, y, fifthW);
    y = Math.max(fy8, fy9, fy10, fy11, fy12);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);

    // Photo — B&W photocopy style, top-right corner, rows 1-2 only
    if (data.id_photo) {
      const photoW = 14;
      const photoH = 17;
      const photoX = doc.internal.pageSize.getWidth() - LAYOUT.PAGE_MARGIN - photoW - 1;
      const photoY = sec.contentY + 0.5;
      try {
        // Convert to grayscale for document legibility
        const grayUrl = await convertToGrayscale(data.id_photo!.dataUrl);
        const grayPhoto = { ...data.id_photo!, dataUrl: grayUrl };
        addImageToPage(doc, grayPhoto, photoX, photoY, photoW, photoH);
      } catch {
        try { addImageToPage(doc, data.id_photo!, photoX, photoY, photoW, photoH); } catch { /* skip */ }
      }
      doc.setDrawColor(120, 120, 120);
      doc.setLineWidth(0.2);
      doc.rect(photoX, photoY, photoW, photoH);
    }
  }

  // ── 2. Physical Description ───────────────────────────────
  y = checkPageBreak(doc, y, 18, prio);
  { const sec = openAutoSection(doc, 'Physical Description', y); y = sec.contentY;
    const sixthW = ffw / 6;
    // Row 1: Height, Weight, Build, Complexion, Blood Type, Shoe Size
    const p1 = addFieldPair(doc, 'Height', data.height || '', lx, y, sixthW);
    const p2 = addFieldPair(doc, 'Weight', data.weight || '', lx + sixthW, y, sixthW);
    const p3 = addFieldPair(doc, 'Build', data.build || '', lx + 2 * sixthW, y, sixthW);
    const p4 = addFieldPair(doc, 'Complexion', data.complexion || '', lx + 3 * sixthW, y, sixthW);
    const p5 = addFieldPair(doc, 'Blood Type', data.blood_type || '', lx + 4 * sixthW, y, sixthW);
    const p6 = addFieldPair(doc, 'Shoe Size', data.shoe_size || '', lx + 5 * sixthW, y, sixthW);
    y = Math.max(p1, p2, p3, p4, p5, p6);
    // Row 2: Hair Color, Hair Length, Hair Style, Eye Color, Facial Hair, Glasses
    const h1 = addFieldPair(doc, 'Hair Color', data.hair_color || '', lx, y, sixthW);
    const h2 = addFieldPair(doc, 'Hair Length', data.hair_length || '', lx + sixthW, y, sixthW);
    const h3 = addFieldPair(doc, 'Hair Style', data.hair_style || '', lx + 2 * sixthW, y, sixthW);
    const h4 = addFieldPair(doc, 'Eye Color', data.eye_color || '', lx + 3 * sixthW, y, sixthW);
    const h5 = addFieldPair(doc, 'Facial Hair', data.facial_hair || '', lx + 4 * sixthW, y, sixthW);
    const h6 = addFieldPair(doc, 'Glasses', data.glasses || '', lx + 5 * sixthW, y, sixthW);
    y = Math.max(h1, h2, h3, h4, h5, h6);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── 3. Scars / Marks / Tattoos ────────────────────────────
  y += 1; // ensure clear gap after Physical Description section border
  y = addNarrativeSection(doc, 'Scars / Marks / Tattoos', data.scars_marks_tattoos || '', y, prio);

  // ── 4. Clothing Description ───────────────────────────────
  y = addNarrativeSection(doc, 'Clothing Description', data.clothing_description || '', y, prio);

  // ── 5. Contact Information ────────────────────────────────
  y = checkPageBreak(doc, y, 18, prio);
  { const sec = openAutoSection(doc, 'Contact Information', y); y = sec.contentY;
    const fullAddress = `${data.address || ''}${data.city ? `, ${data.city}` : ''}${data.state ? `, ${data.state}` : ''} ${data.zip || ''}`.trim();
    const thirdW = ffw / 3;
    // Row 1: Phone Primary, Phone Secondary, Email
    const c1 = addFieldPair(doc, 'Phone (Primary)', data.phone || '', lx, y, thirdW);
    const c2 = addFieldPair(doc, 'Phone (Secondary)', data.phone_secondary || '', lx + thirdW, y, thirdW);
    const c3 = addFieldPair(doc, 'Email', data.email || '', lx + 2 * thirdW, y, thirdW);
    y = Math.max(c1, c2, c3);
    // Row 2: Address (full width)
    y = addFieldPair(doc, 'Address', fullAddress, lx, y, ffw);
    // Row 3: Social Media (if present)
    if (data.social_media) {
      y = addFieldPair(doc, 'Social Media', data.social_media, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── 6. Identification Documents ───────────────────────────
  y = checkPageBreak(doc, y, 22, prio);
  { const sec = openAutoSection(doc, 'Identification Documents', y); y = sec.contentY;
    const fifthW = ffw / 5;
    // Row 1: DL Number (2/5), DL State (1/5), DL Class (1/5), DL Expiry (1/5)
    const d1 = addFieldPair(doc, 'DL Number', data.dl_number || '', lx, y, fifthW * 2);
    const d2 = addFieldPair(doc, 'DL State', data.dl_state || '', lx + fifthW * 2, y, fifthW);
    const d3 = addFieldPair(doc, 'DL Class', data.dl_class || '', lx + fifthW * 3, y, fifthW);
    const d4 = addFieldPair(doc, 'DL Expiry', fmtDate(data.dl_expiry), lx + fifthW * 4, y, fifthW);
    y = Math.max(d1, d2, d3, d4);
    // Row 2: ID Type (1/5), ID Number (2/5), ID State (1/5), ID Expiry (1/5)
    const i1 = addFieldPair(doc, 'ID Type', data.id_type || '', lx, y, fifthW);
    const i2 = addFieldPair(doc, 'ID Number', data.id_number || '', lx + fifthW, y, fifthW * 2);
    const i3 = addFieldPair(doc, 'ID State', data.id_state || '', lx + fifthW * 3, y, fifthW);
    const i4 = addFieldPair(doc, 'ID Expiry', fmtDate(data.id_expiry), lx + fifthW * 4, y, fifthW);
    y = Math.max(i1, i2, i3, i4);
    // Row 3: SSN Last 4
    y = addFieldPair(doc, 'SSN Last 4', data.ssn_last4 ? `***-**-${data.ssn_last4}` : '', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── 7. Employment / Demographics ──────────────────────────
  y = checkPageBreak(doc, y, 12, prio);
  { const sec = openAutoSection(doc, 'Employment', y); y = sec.contentY;
    const thirdW = ffw / 3;
    const e1 = addFieldPair(doc, 'Employer', data.employer || '', lx, y, thirdW);
    const e2 = addFieldPair(doc, 'Occupation', data.occupation || '', lx + thirdW, y, thirdW);
    const e3 = addFieldPair(doc, 'Language', data.language || '', lx + 2 * thirdW, y, thirdW);
    y = Math.max(e1, e2, e3);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── 7b. Law Enforcement Identifiers ────────────────────────
  if (data.ncic_number || data.sor_number || data.fbi_number || data.state_id_number || data.passport_number || data.immigration_status) {
    y = checkPageBreak(doc, y, 12, prio);
    const sec = openAutoSection(doc, 'Law Enforcement Identifiers', y); y = sec.contentY;
    const qw = ffw / 4;
    const le1 = addFieldPair(doc, 'NCIC #', data.ncic_number || '', lx, y, qw);
    const le2 = addFieldPair(doc, 'SOR #', data.sor_number || '', lx + qw, y, qw);
    const le3 = addFieldPair(doc, 'FBI #', data.fbi_number || '', lx + 2 * qw, y, qw);
    const le4 = addFieldPair(doc, 'State ID #', data.state_id_number || '', lx + 3 * qw, y, qw);
    y = Math.max(le1, le2, le3, le4);
    const tw = ffw / 3;
    const pp1 = addFieldPair(doc, 'Passport #', data.passport_number || '', lx, y, tw);
    const pp2 = addFieldPair(doc, 'Passport Country', data.passport_country || '', lx + tw, y, tw);
    const pp3 = addFieldPair(doc, 'Immigration Status', data.immigration_status || '', lx + 2 * tw, y, tw);
    y = Math.max(pp1, pp2, pp3);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── 7c. Military Service ──────────────────────────────────
  if (data.military_branch || data.military_status || data.education_level || data.tribal_affiliation) {
    y = checkPageBreak(doc, y, 12, prio);
    const sec = openAutoSection(doc, 'Military Service & Demographics', y); y = sec.contentY;
    const qw = ffw / 4;
    const m1 = addFieldPair(doc, 'Military Branch', data.military_branch || '', lx, y, qw);
    const m2 = addFieldPair(doc, 'Military Status', data.military_status || '', lx + qw, y, qw);
    const m3 = addFieldPair(doc, 'Education Level', data.education_level || '', lx + 2 * qw, y, qw);
    const m4 = addFieldPair(doc, 'Tribal Affiliation', data.tribal_affiliation || '', lx + 3 * qw, y, qw);
    y = Math.max(m1, m2, m3, m4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── 7d. Medical / Behavioral Flags ────────────────────────
  if (data.disability_flags || data.mental_health_flags || data.substance_abuse || data.medication_notes) {
    y = checkPageBreak(doc, y, 14, prio);
    const sec = openAutoSection(doc, 'Medical / Behavioral Flags', y); y = sec.contentY;
    const hw = ffw / 2;
    const md1 = addFieldPair(doc, 'Disability', data.disability_flags || '', lx, y, hw);
    const md2 = addFieldPair(doc, 'Mental Health', data.mental_health_flags || '', lx + hw, y, hw);
    y = Math.max(md1, md2);
    const md3 = addFieldPair(doc, 'Substance Abuse', data.substance_abuse || '', lx, y, hw);
    const md4 = addFieldPair(doc, 'Medication Notes', data.medication_notes || '', lx + hw, y, hw);
    y = Math.max(md3, md4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── 7e. Detailed Identifying Marks ────────────────────────
  if (data.tattoo_description || data.scar_description || data.piercing_description || data.distinguishing_features || data.identifying_marks_location) {
    y = checkPageBreak(doc, y, 14, prio);
    const sec = openAutoSection(doc, 'Detailed Identifying Marks', y); y = sec.contentY;
    if (data.tattoo_description) y = addNarrativeField(doc, 'Tattoo Description', data.tattoo_description, lx, y, ffw);
    if (data.scar_description) y = addNarrativeField(doc, 'Scar Description', data.scar_description, lx, y, ffw);
    if (data.piercing_description) y = addNarrativeField(doc, 'Piercing Description', data.piercing_description, lx, y, ffw);
    if (data.distinguishing_features) y = addNarrativeField(doc, 'Distinguishing Features', data.distinguishing_features, lx, y, ffw);
    if (data.identifying_marks_location) y = addNarrativeField(doc, 'Marks Location', data.identifying_marks_location, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── 8. Flags & Warnings ───────────────────────────────────
  y = checkPageBreak(doc, y, 18, prio);
  { const sec = openAutoSection(doc, 'Flags & Warnings', y); y = sec.contentY;
    // Checkbox row — add breathing room below header
    y += 1;
    let flagX = lx;
    flagX = addCheckboxField(doc, 'Sex Offender', !!data.is_sex_offender, flagX, y);
    flagX = addCheckboxField(doc, 'Veteran', !!data.is_veteran, flagX + SPACING.SM, y);
    addCheckboxField(doc, 'Active BOLO', !!data.bolo_active, flagX + SPACING.SM, y);
    y += 4;
    // Row 2: Gang Affiliation (1/3), Probation/Parole (2/3)
    const probParole = `${data.probation_parole || ''}${data.probation_parole_officer ? ` (Officer: ${data.probation_parole_officer})` : ''}`.trim();
    const thirdW = ffw / 3;
    const gangVal = data.gang_affiliation && !['none', '0', 'n/a', 'na', ''].includes(data.gang_affiliation.toLowerCase().trim()) ? data.gang_affiliation : '';
    const f1 = addFieldPair(doc, 'Gang Affiliation', gangVal, lx, y, thirdW);
    const f2 = addFieldPair(doc, 'Probation / Parole', probParole, lx + thirdW, y, thirdW * 2);
    y = Math.max(f1, f2);
    // Row 3: Known Associates (if present)
    if (data.known_associates) {
      y = addFieldPair(doc, 'Known Associates', data.known_associates, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Active Flags — parse any format into display strings
  if (data.flags) {
    let flagList: string[] = [];
    const rf: any = data.flags;
    // Handle: string, JSON string, array of strings, array of objects
    if (typeof rf === 'string' && rf.length > 1) {
      try {
        const parsed = JSON.parse(rf);
        if (Array.isArray(parsed)) {
          flagList = parsed.map((f: any) => typeof f === 'string' ? f : (f?.type || f?.name || f?.label || '')).filter(Boolean);
        } else if (typeof parsed === 'object') {
          flagList = [parsed.type || parsed.name || parsed.label || ''].filter(Boolean);
        }
      } catch {
        flagList = rf.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    } else if (Array.isArray(rf)) {
      flagList = rf.map((f: any) => typeof f === 'string' ? f : (f?.type || f?.name || f?.label || '')).filter(Boolean);
    }
    // Clean up: replace underscores, title case
    flagList = flagList.map(f => toDisplayLabel(f));
    if (flagList.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_TABLE_HEADER);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text('ACTIVE FLAGS', lx + 1.5, y + 1.5);
      y += 2.5;
      y = addFlagBadges(doc, flagList, lx, y, ffw, prio);
      y += 0.5;
    }
  }

  // Caution block — amber warning styling for officer safety (kept as-is)
  if (data.caution_flags) {
    y = addCautionBlock(doc, data.caution_flags, lx, y, ffw);
  }

  // ── 9. Emergency Contact ──────────────────────────────────
  y = checkPageBreak(doc, y, 12, prio);
  { const sec = openAutoSection(doc, 'Emergency Contact', y); y = sec.contentY;
    const quarterW = ffw / 4;
    const ec1 = addFieldPair(doc, 'Name', data.emergency_contact_name || '', lx, y, quarterW * 2);
    const ec2 = addFieldPair(doc, 'Phone', data.emergency_contact_phone || '', lx + quarterW * 2, y, quarterW);
    const ec3 = addFieldPair(doc, 'Relationship', data.emergency_contact_relationship || '', lx + quarterW * 3, y, quarterW);
    y = Math.max(ec1, ec2, ec3);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── 10. Active Warrants ───────────────────────────────────
  if (data.warrants && data.warrants.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    { const sec = openAutoSection(doc, 'Active Warrants', y); y = sec.sectionY + SPACING.SECTION_HEADER_H; }
    const warrantRows = data.warrants.map(w => [
      w.warrant_number || 'N/A',
      toDisplayLabel(w.type || ''),
      toDisplayLabel(w.status || ''),
      w.charge_description || 'N/A',
      toDisplayLabel(w.offense_level || ''),
      fmtDate(w.date_issued),
    ]);
    y = addTableWithShading(
      doc,
      [
        { label: 'WARRANT #', x: lx },
        { label: 'TYPE', x: lx + 29 },
        { label: 'STATUS', x: lx + 49 },
        { label: 'CHARGE', x: lx + 72 },
        { label: 'LEVEL', x: lx + 127 },
        { label: 'DATE', x: lx + 152 },
      ],
      warrantRows,
      y,
      [lx, lx + 29, lx + 49, lx + 72, lx + 127, lx + 152],
    );
  }

  // ── 11. Incident History ──────────────────────────────────
  if (data.incidents && data.incidents.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    { const sec = openAutoSection(doc, 'Incident History', y); y = sec.sectionY + SPACING.SECTION_HEADER_H; }
    const incidentRows = data.incidents.map(inc => [
      inc.incident_number || 'N/A',
      toDisplayLabel(inc.incident_type || ''),
      toDisplayLabel(inc.role || ''),
      toDisplayLabel(inc.status || ''),
      fmtDate(inc.created_at),
    ]);
    y = addTableWithShading(
      doc,
      [
        { label: 'INCIDENT #', x: lx },
        { label: 'TYPE', x: lx + 32 },
        { label: 'ROLE', x: lx + 82 },
        { label: 'STATUS', x: lx + 112 },
        { label: 'DATE', x: lx + 147 },
      ],
      incidentRows,
      y,
      [lx, lx + 32, lx + 82, lx + 112, lx + 147],
    );
  }

  // ── 12. Citation History ──────────────────────────────────
  if (data.citations && data.citations.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    { const sec = openAutoSection(doc, 'Citation History', y); y = sec.sectionY + SPACING.SECTION_HEADER_H; }
    const citationRows = data.citations.map(c => [
      c.citation_number || 'N/A',
      toDisplayLabel(c.type || ''),
      toDisplayLabel(c.status || ''),
      c.violation_description || c.statute_citation || 'N/A',
      fmtDate(c.violation_date),
    ]);
    y = addTableWithShading(
      doc,
      [
        { label: 'CITATION #', x: lx },
        { label: 'TYPE', x: lx + 32 },
        { label: 'STATUS', x: lx + 57 },
        { label: 'VIOLATION', x: lx + 85 },
        { label: 'DATE', x: lx + 152 },
      ],
      citationRows,
      y,
      [lx, lx + 32, lx + 57, lx + 85, lx + 152],
    );
  }

  // ── 13. Dispatch Call History ──────────────────────────────
  if (data.calls && data.calls.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    { const sec = openAutoSection(doc, 'Dispatch Call History', y); y = sec.sectionY + SPACING.SECTION_HEADER_H; }
    const callRows = data.calls.map(c => [
      c.call_number || 'N/A',
      toDisplayLabel(c.incident_type || ''),
      displayStatus(c.status || ''),
      c.location || 'N/A',
      fmtDate(c.created_at),
    ]);
    y = addTableWithShading(
      doc,
      [
        { label: 'CALL #', x: lx },
        { label: 'TYPE', x: lx + 27 },
        { label: 'STATUS', x: lx + 69 },
        { label: 'LOCATION', x: lx + 97 },
        { label: 'DATE', x: lx + 152 },
      ],
      callRows,
      y,
      [lx, lx + 27, lx + 69, lx + 97, lx + 152],
    );
  }

  // ── 14. Criminal History — condensed single table ──────────
  if (data.criminal_records && data.criminal_records.length > 0) {
    y = checkPageBreak(doc, y, 30, prio);
    { const sec = openAutoSection(doc, 'Criminal History', y); y = sec.sectionY + SPACING.SECTION_HEADER_H; }
    const crCw = getContentWidth(doc);
    const crRows = data.criminal_records.map(r => [
      toDisplayLabel(r.record_type || ''),
      r.offense || 'N/A',
      toDisplayLabel(r.offense_level || '') || 'N/A',
      r.case_number || 'N/A',
      r.disposition || 'N/A',
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
    y = await addAttachmentsSection(doc, data.attachment_images, y, 'Attachments / Evidence Photos', prio);
  }

  // ── 18. Signature Block — full-width stacked ──────────────
  y = addStackedSignatures(doc, 'Entering Officer', '', y, getOfficerSig(), undefined, prio);
}

// ── Vehicle Record ───────────────────────────────────────────

async function generateVehicleReport(doc: jsPDF, data: VehiclePdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  setActiveCaseNumber(data.license_plate || 'N/A');
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'VEHICLE RECORD',
    formNumber: 'FORM PS-203',
    caseNumber: data.license_plate || 'N/A',
  });

  // Geography / Contract strip
  y = drawGeographyStrip(doc, y, {
    area: data.area_name,
    sector: data.sector_name,
    zone: data.zone_name,
    beat: data.beat_name,
    contract_id: data.contract_id,
  });

  // ── Vehicle Identification ──
  y = checkPageBreak(doc, y, 25);
  { const sec = openAutoSection(doc, 'Vehicle Identification', y); y = sec.contentY;
    const sixthW = ffw / 6;
    // Row 1: License Plate (2/6), State (1/6), Plate Type (1/6), VIN (2/6)
    const r1a = addFieldPair(doc, 'License Plate', data.license_plate || '', lx, y, sixthW * 2);
    const r1b = addFieldPair(doc, 'State', data.plate_state || '', lx + sixthW * 2, y, sixthW);
    const r1c = addFieldPair(doc, 'Plate Type', data.plate_type || '', lx + sixthW * 3, y, sixthW);
    const r1d = addFieldPair(doc, 'VIN', data.vin || '', lx + sixthW * 4, y, sixthW * 2);
    y = Math.max(r1a, r1b, r1c, r1d);
    // Row 2: Year, Make, Model, Body Style, Trim, Doors (6 cols)
    const r2a = addFieldPair(doc, 'Year', data.year ? String(data.year) : '', lx, y, sixthW);
    const r2b = addFieldPair(doc, 'Make', data.make || '', lx + sixthW, y, sixthW);
    const r2c = addFieldPair(doc, 'Model', data.model || '', lx + sixthW * 2, y, sixthW);
    const r2d = addFieldPair(doc, 'Body Style', data.body_style || '', lx + sixthW * 3, y, sixthW);
    const r2e = addFieldPair(doc, 'Trim', data.trim || '', lx + sixthW * 4, y, sixthW);
    const r2f = addFieldPair(doc, 'Doors', data.doors ? String(data.doors) : '', lx + sixthW * 5, y, sixthW);
    y = Math.max(r2a, r2b, r2c, r2d, r2e, r2f);
    // Row 3: Color, Secondary Color, Engine, Fuel, Transmission, Drive (6 cols)
    const r3a = addFieldPair(doc, 'Color', data.color || '', lx, y, sixthW);
    const r3b = addFieldPair(doc, 'Secondary Color', data.secondary_color || '', lx + sixthW, y, sixthW);
    const r3c = addFieldPair(doc, 'Engine', data.engine_type || '', lx + sixthW * 2, y, sixthW);
    const r3d = addFieldPair(doc, 'Fuel', data.fuel_type || '', lx + sixthW * 3, y, sixthW);
    const r3e = addFieldPair(doc, 'Transmission', data.transmission || '', lx + sixthW * 4, y, sixthW);
    const r3f = addFieldPair(doc, 'Drive', data.drive_type || '', lx + sixthW * 5, y, sixthW);
    y = Math.max(r3a, r3b, r3c, r3d, r3e, r3f);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Owner Information ──
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, 'Owner Information', y); y = sec.contentY;
    // Row 1: Owner Name (half), Phone (quarter), Odometer (quarter)
    const r1a = addFieldPair(doc, 'Owner Name', data.owner_name || '', lx, y, hfw);
    const quarterW = ffw / 4;
    const r1b = addFieldPair(doc, 'Phone', data.owner_phone || '', rx, y, quarterW);
    const r1c = addFieldPair(doc, 'Odometer', data.odometer || '', rx + quarterW, y, quarterW);
    y = Math.max(r1a, r1b, r1c);
    // Row 2: Owner Address (full width)
    y = addFieldPair(doc, 'Owner Address', data.owner_address || '', lx, y, ffw);
    // Row 3: Checkboxes + Lien Holder (clear gap after address)
    y += 4;
    let flagX = lx;
    flagX = addCheckboxField(doc, 'Commercial', !!data.commercial_vehicle, flagX, y);
    flagX = addCheckboxField(doc, 'Hazmat', !!data.hazmat, flagX + SPACING.SM, y);
    y += 5;
    y = addFieldPair(doc, 'Lien Holder', data.lien_holder || '', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Insurance & Registration ──
  y = checkPageBreak(doc, y, 12);
  { const sec = openAutoSection(doc, 'Insurance & Registration', y); y = sec.contentY;
    const fifthW = ffw / 5;
    const r1a = addFieldPair(doc, 'Insurance Company', data.insurance_company || '', lx, y, fifthW * 2);
    const r1b = addFieldPair(doc, 'Policy Number', data.insurance_policy || '', lx + fifthW * 2, y, fifthW * 2);
    const r1c = addFieldPair(doc, 'Reg. Expiry', fmtDate(data.registration_expiry), lx + fifthW * 4, y, fifthW);
    y = Math.max(r1a, r1b, r1c);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Legal Status ──
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Legal Status', y); y = sec.contentY;
    const thirdW = ffw / 3;
    // Row 1: Stolen Status, Stolen Date, Recovery Date
    const r1a = addFieldPair(doc, 'Stolen Status', (data.stolen_status || 'Not Stolen').toUpperCase(), lx, y, thirdW);
    const r1b = addFieldPair(doc, 'Stolen Date', fmtDate(data.stolen_date), lx + thirdW, y, thirdW);
    const r1c = addFieldPair(doc, 'Recovery Date', fmtDate(data.recovery_date), lx + thirdW * 2, y, thirdW);
    y = Math.max(r1a, r1b, r1c);
    // Row 2: Tow Status, Tow Company, Tow Date
    const r2a = addFieldPair(doc, 'Tow Status', data.tow_status || '', lx, y, thirdW);
    const r2b = addFieldPair(doc, 'Tow Company', data.tow_company || '', lx + thirdW, y, thirdW);
    const r2c = addFieldPair(doc, 'Tow Date', fmtDate(data.tow_date), lx + thirdW * 2, y, thirdW);
    y = Math.max(r2a, r2b, r2c);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Vehicle Condition ──
  if (data.title_status || data.exterior_condition || data.interior_condition || data.estimated_value) {
    y = checkPageBreak(doc, y, 12);
    const sec = openAutoSection(doc, 'Vehicle Condition', y); y = sec.contentY;
    const qw = ffw / 4;
    const c1 = addFieldPair(doc, 'Title Status', data.title_status || '', lx, y, qw);
    const c2 = addFieldPair(doc, 'Exterior', data.exterior_condition || '', lx + qw, y, qw);
    const c3 = addFieldPair(doc, 'Interior', data.interior_condition || '', lx + 2 * qw, y, qw);
    const c4 = addFieldPair(doc, 'Est. Value', data.estimated_value ? `$${data.estimated_value}` : '', lx + 3 * qw, y, qw);
    y = Math.max(c1, c2, c3, c4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Features & Modifications ──
  if (data.window_tint || data.modifications || data.equipment_notes) {
    y = checkPageBreak(doc, y, 12);
    const sec = openAutoSection(doc, 'Features & Modifications', y); y = sec.contentY;
    if (data.window_tint) y = addFieldPair(doc, 'Window Tint', data.window_tint, lx, y, ffw);
    if (data.modifications) y = addNarrativeField(doc, 'Modifications', data.modifications, lx, y, ffw);
    if (data.equipment_notes) y = addNarrativeField(doc, 'Equipment Notes', data.equipment_notes, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Free-form sections (keep as narrative — these have long text)
  y = addNarrativeSection(doc, 'Distinguishing Features', data.distinguishing_features || '', y);
  y = addNarrativeSection(doc, 'Damage Description', data.damage_description || '', y);

  if (data.flags && data.flags.length > 0) {
    y = checkPageBreak(doc, y, 10);
    { const sec = openAutoSection(doc, 'Flags', y); y = sec.contentY;
      y = addFieldPair(doc, 'Active Flags', data.flags.join(', '), lx, y, ffw);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }
  }

  y = addNarrativeSection(doc, 'Notes', data.notes || '', y);

  if (data.attachment_images && data.attachment_images.length > 0) {
    y = await addAttachmentsSection(doc, data.attachment_images, y);
  }

  y = addStackedSignatures(doc, 'Entering Officer', '', y, getOfficerSig());
}

// ── Warrant ──────────────────────────────────────────────────

async function generateWarrantReport(doc: jsPDF, data: WarrantPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

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

  // ── Warrant Information ──
  y = checkPageBreak(doc, y, 18, statusPrio);
  { const sec = openAutoSection(doc, 'Warrant Information', y); y = sec.contentY;
    const quarterW = ffw / 4;
    // Row 1: Warrant Number (2/5), Type (1/5), Status (1/5), Offense Level (1/5)
    const fifthW = ffw / 5;
    const r1a = addFieldPair(doc, 'Warrant Number', data.warrant_number || '', lx, y, fifthW * 2);
    const r1b = addFieldPair(doc, 'Type', (data.type || '').toUpperCase(), lx + fifthW * 2, y, fifthW);
    const r1c = addFieldPair(doc, 'Status', displayStatus(data.status || ''), lx + fifthW * 3, y, fifthW);
    const r1d = addFieldPair(doc, 'Offense Level', (data.offense_level || '').toUpperCase(), lx + fifthW * 4, y, fifthW);
    y = Math.max(r1a, r1b, r1c, r1d);
    // Row 2: Charge Description (full width)
    y = addFieldPair(doc, 'Charge Description', data.charge_description || '', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Subject Information ──
  y = checkPageBreak(doc, y, 20, statusPrio);
  { const sec = openAutoSection(doc, 'Subject Information', y); y = sec.contentY;
    const sixthW = ffw / 6;
    // Row 1: Last Name (2/5), First Name (2/5), DOB (1/5)
    const fifthW = ffw / 5;
    const r1a = addFieldPair(doc, 'Last Name', data.subject_last_name || '', lx, y, fifthW * 2);
    const r1b = addFieldPair(doc, 'First Name', data.subject_first_name || '', lx + fifthW * 2, y, fifthW * 2);
    const r1c = addFieldPair(doc, 'DOB', fmtDate(data.subject_dob), lx + fifthW * 4, y, fifthW);
    y = Math.max(r1a, r1b, r1c);
    // Row 2: Gender, Race, Height, Weight, Hair, Eyes (6 cols)
    const r2a = addFieldPair(doc, 'Gender', data.subject_gender || '', lx, y, sixthW);
    const r2b = addFieldPair(doc, 'Race', data.subject_race || '', lx + sixthW, y, sixthW);
    const r2c = addFieldPair(doc, 'Height', data.subject_height || '', lx + sixthW * 2, y, sixthW);
    const r2d = addFieldPair(doc, 'Weight', data.subject_weight || '', lx + sixthW * 3, y, sixthW);
    const r2e = addFieldPair(doc, 'Hair', data.subject_hair_color || '', lx + sixthW * 4, y, sixthW);
    const r2f = addFieldPair(doc, 'Eyes', data.subject_eye_color || '', lx + sixthW * 5, y, sixthW);
    y = Math.max(r2a, r2b, r2c, r2d, r2e, r2f);
    // Row 3: Address (full width, conditional)
    if (data.subject_address) {
      y = addFieldPair(doc, 'Address', data.subject_address, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Court Information ──
  y = checkPageBreak(doc, y, 18, statusPrio);
  { const sec = openAutoSection(doc, 'Court Information', y); y = sec.contentY;
    // Row 1: Issuing Court (half), Issuing Judge (half)
    const r1a = addFieldPair(doc, 'Issuing Court', data.issuing_court || '', lx, y, hfw);
    const r1b = addFieldPair(doc, 'Issuing Judge', data.issuing_judge || '', rx, y, hfw);
    y = Math.max(r1a, r1b);
    // Row 2: Bail Amount, Expiration Date, Entered By, Entry Date (4 cols)
    const quarterW = ffw / 4;
    const r2a = addFieldPair(doc, 'Bail Amount', fmtCurrency(data.bail_amount), lx, y, quarterW);
    const r2b = addFieldPair(doc, 'Expiration Date', fmtDate(data.expires_at), lx + quarterW, y, quarterW);
    const r2c = addFieldPair(doc, 'Entered By', data.entered_by_name || '', lx + quarterW * 2, y, quarterW);
    const r2d = addFieldPair(doc, 'Entry Date', fmtTimestamp(data.created_at), lx + quarterW * 3, y, quarterW);
    y = Math.max(r2a, r2b, r2c, r2d);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Service Information (conditional) ──
  if (data.served_at || data.served_by_name) {
    y = checkPageBreak(doc, y, 12, statusPrio);
    { const sec = openAutoSection(doc, 'Service Information', y); y = sec.contentY;
      const fifthW = ffw / 5;
      const r1a = addFieldPair(doc, 'Served By', data.served_by_name || '', lx, y, fifthW * 2);
      const r1b = addFieldPair(doc, 'Served Date', fmtTimestamp(data.served_at), lx + fifthW * 2, y, fifthW);
      const r1c = addFieldPair(doc, 'Served Location', data.served_location || '', lx + fifthW * 3, y, fifthW * 2);
      y = Math.max(r1a, r1b, r1c);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }
  }

  // ── Source / Verification (conditional) ──
  if (data.data_source || data.search_date || data.verified_by) {
    y = checkPageBreak(doc, y, 18, statusPrio);
    { const sec = openAutoSection(doc, 'Source / Verification', y); y = sec.contentY;
      const thirdW = ffw / 3;
      // Row 1: Data Source (2/3), Search Date (1/3)
      const r1a = addFieldPair(doc, 'Data Source', data.data_source || '', lx, y, thirdW * 2);
      const r1b = addFieldPair(doc, 'Search Date', data.search_date || '', lx + thirdW * 2, y, thirdW);
      y = Math.max(r1a, r1b);
      // Row 2: County, Case Number, Filing Date (conditional)
      if (data.county || data.case_number) {
        const r2a = addFieldPair(doc, 'County', data.county || '', lx, y, thirdW);
        const r2b = addFieldPair(doc, 'Case Number', data.case_number || '', lx + thirdW, y, thirdW);
        const r2c = addFieldPair(doc, 'Filing Date', fmtDate(data.filing_date), lx + thirdW * 2, y, thirdW);
        y = Math.max(r2a, r2b, r2c);
      }
      // Row 3: Verified By, Verification Date (conditional)
      if (data.verified_by) {
        const r3a = addFieldPair(doc, 'Verified By', data.verified_by || '', lx, y, hfw);
        const r3b = addFieldPair(doc, 'Verification Date', data.verification_date || '', rx, y, hfw);
        y = Math.max(r3a, r3b);
      }
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y, statusPrio);

  // Signature Block — full-width stacked
  y = addStackedSignatures(doc, 'Reporting Officer', '', y, getOfficerSig(), undefined, statusPrio);
}

// ── Evidence / Property Custody Report ───────────────────────

async function generateEvidenceReport(doc: jsPDF, data: EvidencePdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  setActiveCaseNumber(data.evidence_number);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'EVIDENCE / PROPERTY CUSTODY REPORT',
    formNumber: 'FORM PS-205',
    caseNumber: data.evidence_number,
  });

  // ── Evidence Identification ──
  y = checkPageBreak(doc, y, 25);
  { const sec = openAutoSection(doc, 'Evidence Identification', y); y = sec.contentY;
    const quarterW = ffw / 4;
    // Row 1: Evidence Number (2/5), Type (1/5), Category (1/5), Status (1/5)
    const fifthW = ffw / 5;
    const r1a = addFieldPair(doc, 'Evidence Number', data.evidence_number || '', lx, y, fifthW * 2);
    const r1b = addFieldPair(doc, 'Type', toDisplayLabel(data.evidence_type || ''), lx + fifthW * 2, y, fifthW);
    const r1c = addFieldPair(doc, 'Category', data.category || '', lx + fifthW * 3, y, fifthW);
    const r1d = addFieldPair(doc, 'Status', displayStatus((data.status || '').replace(/_/g, ' ')), lx + fifthW * 4, y, fifthW);
    y = Math.max(r1a, r1b, r1c, r1d);
    // Row 2: Related Incident, Serial Number, Brand, Model (4 cols)
    const r2a = addFieldPair(doc, 'Related Incident', data.incident_number || '', lx, y, quarterW);
    const r2b = addFieldPair(doc, 'Serial Number', data.serial_number || '', lx + quarterW, y, quarterW);
    const r2c = addFieldPair(doc, 'Brand', data.brand || '', lx + quarterW * 2, y, quarterW);
    const r2d = addFieldPair(doc, 'Model', data.model || '', lx + quarterW * 3, y, quarterW);
    y = Math.max(r2a, r2b, r2c, r2d);
    // Row 3: Dimensions, Weight, Est. Value, Quantity (4 cols)
    const r3a = addFieldPair(doc, 'Dimensions', data.dimensions || '', lx, y, quarterW);
    const r3b = addFieldPair(doc, 'Weight', data.weight || '', lx + quarterW, y, quarterW);
    const r3c = addFieldPair(doc, 'Est. Value', fmtCurrency(data.estimated_value), lx + quarterW * 2, y, quarterW);
    const r3d = addFieldPair(doc, 'Quantity', data.quantity != null ? String(data.quantity) : '', lx + quarterW * 3, y, quarterW);
    y = Math.max(r3a, r3b, r3c, r3d);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Description (narrative — can be long)
  if (data.description) {
    y = addNarrativeSection(doc, 'Item Description', data.description, y);
  }

  // ── Collection Information ──
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Collection Information', y); y = sec.contentY;
    const quarterW = ffw / 4;
    // Row 1: Collected By (half), Collection Date (quarter), Packaging (quarter)
    const r1a = addFieldPair(doc, 'Collected By', data.collected_by || '', lx, y, hfw);
    const r1b = addFieldPair(doc, 'Collection Date', fmtTimestamp(data.collected_date), rx, y, quarterW);
    const r1c = addFieldPair(doc, 'Packaging', data.packaging_type || '', rx + quarterW, y, quarterW);
    y = Math.max(r1a, r1b, r1c);
    // Row 2: Location Found (2/5), Photo Taken (1/5), Storage Location (2/5)
    const fifthW = ffw / 5;
    const r2a = addFieldPair(doc, 'Location Found', data.location_found || '', lx, y, fifthW * 2);
    const r2b = addFieldPair(doc, 'Photo Taken', data.photo_taken ? 'Yes' : 'No', lx + fifthW * 2, y, fifthW);
    const r2c = addFieldPair(doc, 'Storage Location', data.storage_location || '', lx + fifthW * 3, y, fifthW * 2);
    y = Math.max(r2a, r2b, r2c);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

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

  // ── Lab Analysis (conditional) ──
  if (data.lab_submitted) {
    y = checkPageBreak(doc, y, 12);
    { const sec = openAutoSection(doc, 'Lab Analysis', y); y = sec.contentY;
      let flagX = lx;
      flagX = addCheckboxField(doc, 'Submitted to Lab', true, flagX, y);
      y += SPACING.LG;
      const r1a = addFieldPair(doc, 'Lab Name', data.lab_name || '', lx, y, hfw);
      const r1b = addFieldPair(doc, 'Lab Case #', data.lab_case_number || '', rx, y, hfw);
      y = Math.max(r1a, r1b);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }
  }

  // ── Disposition / Disposal (conditional) ──
  if (data.disposal_method) {
    y = checkPageBreak(doc, y, 12);
    { const sec = openAutoSection(doc, 'Disposition / Disposal', y); y = sec.contentY;
      const thirdW = ffw / 3;
      const r1a = addFieldPair(doc, 'Method', data.disposal_method, lx, y, thirdW);
      const r1b = addFieldPair(doc, 'Date', fmtDate(data.disposal_date), lx + thirdW, y, thirdW);
      const r1c = addFieldPair(doc, 'Authorized By', data.disposal_authorized_by || '', lx + thirdW * 2, y, thirdW);
      y = Math.max(r1a, r1b, r1c);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = await addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block — full-width stacked
  y = addStackedSignatures(doc, 'Collecting Officer', 'Evidence Custodian', y, getOfficerSig());
}

// ── Fleet Vehicle Status Report ──────────────────────────────

async function generateFleetReport(doc: jsPDF, data: FleetPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
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

  // ── Vehicle Information ──
  y = checkPageBreak(doc, y, 25);
  { const sec = openAutoSection(doc, 'Vehicle Information', y); y = sec.contentY;
    const thirdW = ffw / 3;
    // Row 1: Unit Number, Make, Model (3 cols)
    const r1a = addFieldPair(doc, 'Unit Number', data.vehicle_number || '', lx, y, thirdW);
    const r1b = addFieldPair(doc, 'Make', data.make || '', lx + thirdW, y, thirdW);
    const r1c = addFieldPair(doc, 'Model', data.model || '', lx + thirdW * 2, y, thirdW);
    y = Math.max(r1a, r1b, r1c);
    // Row 2: Year, Color, VIN (year 1/4, color 1/4, VIN 2/4)
    const quarterW = ffw / 4;
    const r2a = addFieldPair(doc, 'Year', data.year ? String(data.year) : '', lx, y, quarterW);
    const r2b = addFieldPair(doc, 'Color', data.color || '', lx + quarterW, y, quarterW);
    const r2c = addFieldPair(doc, 'VIN', data.vin || '', lx + quarterW * 2, y, quarterW * 2);
    y = Math.max(r2a, r2b, r2c);
    // Row 3: Plate Number, Plate State, Status (3 cols)
    const r3a = addFieldPair(doc, 'Plate Number', data.plate_number || '', lx, y, thirdW);
    const r3b = addFieldPair(doc, 'Plate State', data.plate_state || '', lx + thirdW, y, thirdW);
    const r3c = addFieldPair(doc, 'Status', displayStatus((data.status || '').replace(/_/g, ' ')), lx + thirdW * 2, y, thirdW);
    y = Math.max(r3a, r3b, r3c);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Assignment ──
  y = checkPageBreak(doc, y, 12);
  { const sec = openAutoSection(doc, 'Assignment', y); y = sec.contentY;
    const r1a = addFieldPair(doc, 'Assigned Unit', data.assigned_unit_call_sign || 'Unassigned', lx, y, hfw);
    const r1b = addFieldPair(doc, 'Current Mileage', data.current_mileage ? data.current_mileage.toLocaleString() : '', rx, y, hfw);
    y = Math.max(r1a, r1b);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── FUEL LOG REPORT ──
  if (reportType === 'fuel_logs' && data.fuel_logs && data.fuel_logs.length > 0) {
    // Use fuel_summary from backend if available, otherwise compute locally
    const fs = data.fuel_summary;
    const totalGal = fs?.total_gallons ?? data.fuel_logs.reduce((sum, f) => sum + (f.gallons || 0), 0);
    const totalCost = fs?.total_cost ?? data.fuel_logs.reduce((sum, f) => sum + (f.total_cost || 0), 0);
    const avgMpg = fs?.avg_mpg ?? (() => {
      const eff = data.fuel_logs!.filter(f => f.mpg != null && f.mpg! > 0);
      return eff.length > 0 ? eff.reduce((s, f) => s + f.mpg!, 0) / eff.length : null;
    })();
    const bestMpg = fs?.best_mpg ?? null;
    const worstMpg = fs?.worst_mpg ?? null;
    const totalDist = fs?.total_distance ?? null;
    const costPerMile = fs?.cost_per_mile ?? null;
    const fuelCostPerDay = fs?.fuel_cost_per_day ?? null;

    // ── Fuel Summary ──
    y = checkPageBreak(doc, y, 25);
    { const sec = openAutoSection(doc, 'Fuel Summary', y); y = sec.contentY;
      const thirdW = ffw / 3;
      // Row 1: Total Gallons, Total Cost, Avg MPG
      const r1a = addFieldPair(doc, 'Total Gallons', totalGal.toFixed(2), lx, y, thirdW);
      const r1b = addFieldPair(doc, 'Total Cost', `$${totalCost.toFixed(2)}`, lx + thirdW, y, thirdW);
      const r1c = addFieldPair(doc, 'Avg MPG', avgMpg != null ? `${avgMpg.toFixed(1)} MPG` : 'N/A', lx + thirdW * 2, y, thirdW);
      y = Math.max(r1a, r1b, r1c);
      // Row 2: Best MPG, Worst MPG, Total Distance
      const r2a = addFieldPair(doc, 'Best MPG', bestMpg != null ? `${bestMpg.toFixed(1)} MPG` : 'N/A', lx, y, thirdW);
      const r2b = addFieldPair(doc, 'Worst MPG', worstMpg != null ? `${worstMpg.toFixed(1)} MPG` : 'N/A', lx + thirdW, y, thirdW);
      const r2c2 = addFieldPair(doc, 'Total Distance', totalDist != null ? `${totalDist.toLocaleString(undefined, { maximumFractionDigits: 1 })} MI` : 'N/A', lx + thirdW * 2, y, thirdW);
      y = Math.max(r2a, r2b, r2c2);
      // Row 3: Cost/Mile, Fuel $/Day, Fill Count
      const r3a = addFieldPair(doc, 'Cost/Mile', costPerMile != null ? `$${costPerMile.toFixed(3)}` : 'N/A', lx, y, thirdW);
      const r3b = addFieldPair(doc, 'Fuel $/Day', fuelCostPerDay != null ? `$${fuelCostPerDay.toFixed(2)}` : 'N/A', lx + thirdW, y, thirdW);
      const r3c2 = addFieldPair(doc, 'Fill Count', String(data.fuel_logs!.length), lx + thirdW * 2, y, thirdW);
      y = Math.max(r3a, r3b, r3c2);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

    // Fuel logs table — columns: Date, Station, Gallons, $/Gal, Cost, Odometer, Distance, MPG, $/Mile
    const adjFuelColW = [18, cw - 132, 14, 14, 18, 22, 16, 14, 16];
    const fuelColPos: number[] = [];
    { let cx = lx; for (const w of adjFuelColW) { fuelColPos.push(cx); cx += w; } }
    const fuelHeaders = ['Date', 'Station', 'Gal', '$/Gal', 'Cost', 'Odometer', 'Dist', 'MPG', '$/Mi']
      .map((label, i) => ({ label, x: fuelColPos[i] }));
    const fuelRows = data.fuel_logs.map(f => {
      const dist = f.calc_distance ?? f.distance ?? null;
      const mpg = f.mpg ?? f.efficiency ?? null;
      const cpm = f.cost_per_mile ?? null;
      return [
        fmtDate(f.fuel_date),
        (f.station || '').substring(0, 22),
        f.gallons?.toFixed(2) || '',
        f.cost_per_gallon ? `$${f.cost_per_gallon.toFixed(2)}` : '',
        f.total_cost ? `$${f.total_cost.toFixed(2)}` : '',
        f.odometer_reading ? Number(f.odometer_reading).toLocaleString() : '',
        dist != null && dist > 0 ? dist.toFixed(0) : '',
        mpg != null && mpg > 0 ? mpg.toFixed(1) : '',
        cpm != null ? `$${cpm.toFixed(3)}` : '',
      ];
    });
    y = addTableWithShading(doc, fuelHeaders, fuelRows, y, fuelColPos);
  }

  // ── MAINTENANCE REPORT ──
  if (reportType === 'maintenance' && data.maintenance_logs && data.maintenance_logs.length > 0) {
    // Summary row
    const totalCost = data.maintenance_logs.reduce((sum, m) => sum + (m.cost || 0), 0);
    const totalLabor = data.maintenance_logs.reduce((sum, m) => sum + (m.labor_cost || 0), 0);

    y = checkPageBreak(doc, y, 15);
    { const sec = openAutoSection(doc, 'Maintenance Summary', y); y = sec.contentY;
      const thirdW = ffw / 3;
      const r1a = addFieldPair(doc, 'Total Cost', `$${totalCost.toFixed(2)}`, lx, y, thirdW);
      const r1b = addFieldPair(doc, 'Total Labor', `$${totalLabor.toFixed(2)}`, lx + thirdW, y, thirdW);
      const r1c = addFieldPair(doc, 'Records', String(data.maintenance_logs.length), lx + thirdW * 2, y, thirdW);
      y = Math.max(r1a, r1b, r1c);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

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

    y = checkPageBreak(doc, y, 15);
    { const sec = openAutoSection(doc, 'Mileage Summary', y); y = sec.contentY;
      const thirdW = ffw / 3;
      const r1a = addFieldPair(doc, 'Total Distance', `${totalDist.toFixed(1)} mi`, lx, y, thirdW);
      const r1b = addFieldPair(doc, 'Total Fuel', `${totalGal.toFixed(2)} gal`, lx + thirdW, y, thirdW);
      const r1c = addFieldPair(doc, 'Total Cost', `$${totalCost.toFixed(2)}`, lx + thirdW * 2, y, thirdW);
      y = Math.max(r1a, r1b, r1c);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

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
    // ── Service / Compliance ──
    y = checkPageBreak(doc, y, 18);
    { const sec = openAutoSection(doc, 'Service / Compliance', y); y = sec.contentY;
      // Row 1: Registration Expiry, Insurance Expiry
      const r1a = addFieldPair(doc, 'Registration Expiry', fmtDate(data.registration_expiry), lx, y, hfw);
      const r1b = addFieldPair(doc, 'Insurance Expiry', fmtDate(data.insurance_expiry), rx, y, hfw);
      y = Math.max(r1a, r1b);
      // Row 2: Next Service Due, Last Service Date
      const r2a = addFieldPair(doc, 'Next Service Due', fmtDate(data.next_service_due), lx, y, hfw);
      const r2b = addFieldPair(doc, 'Last Service Date', fmtDate(data.last_service_date), rx, y, hfw);
      y = Math.max(r2a, r2b);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

    // ── Equipment ──
    if (data.equipment && data.equipment.length > 0) {
      y = checkPageBreak(doc, y, 10);
      { const sec = openAutoSection(doc, 'Installed Equipment', y); y = sec.contentY;
        y = addFieldPair(doc, 'Equipment', data.equipment.join(', '), lx, y, ffw);
        y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
      }
    }
  }

  // Notes
  y = addNarrativeSection(doc, 'Notes', data.notes || '', y);

  // Signature Block — officer + company seal
  y = addStackedSignatures(doc, 'Fleet Manager', '', y, getOfficerSig());
}

// ── Personnel / Officer Record ───────────────────────────────

async function generatePersonnelReport(doc: jsPDF, data: PersonnelPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
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

  // ── Officer Identification (always shown) ──
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, 'Officer Identification', y); y = sec.contentY;
    const fifthW = ffw / 5;
    // Row 1: Last Name (2/5), First Name (2/5), Middle Name (1/5)
    const r1a = addFieldPair(doc, 'Last Name', data.last_name || '', lx, y, fifthW * 2);
    const r1b = addFieldPair(doc, 'First Name', data.first_name || '', lx + fifthW * 2, y, fifthW * 2);
    const r1c = addFieldPair(doc, 'Middle Name', data.middle_name || '', lx + fifthW * 4, y, fifthW);
    y = Math.max(r1a, r1b, r1c);
    // Row 2: Badge Number, Employee ID, Rank, Role, Department (5 cols)
    const r2a = addFieldPair(doc, 'Badge Number', data.badge_number || '', lx, y, fifthW);
    const r2b = addFieldPair(doc, 'Employee ID', data.employee_id || '', lx + fifthW, y, fifthW);
    const r2c = addFieldPair(doc, 'Rank', data.rank || '', lx + fifthW * 2, y, fifthW);
    const r2d = addFieldPair(doc, 'Role', (data.role || '').toUpperCase(), lx + fifthW * 3, y, fifthW);
    const r2e = addFieldPair(doc, 'Department', data.department || '', lx + fifthW * 4, y, fifthW);
    y = Math.max(r2a, r2b, r2c, r2d, r2e);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── FULL / DEFAULT sections ──
  if (reportType === 'full') {
    // ── Personal Information ──
    y = checkPageBreak(doc, y, 15);
    { const sec = openAutoSection(doc, 'Personal Information', y); y = sec.contentY;
      const thirdW = ffw / 3;
      const r1a = addFieldPair(doc, 'Date of Birth', fmtDate(data.date_of_birth), lx, y, thirdW);
      const r1b = addFieldPair(doc, 'Gender', data.gender || '', lx + thirdW, y, thirdW);
      const r1c = addFieldPair(doc, 'Blood Type', data.blood_type || '', lx + thirdW * 2, y, thirdW);
      y = Math.max(r1a, r1b, r1c);
      if (data.allergies) {
        y = addFieldPair(doc, 'Allergies', data.allergies, lx, y, ffw);
      }
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

    // ── Contact ──
    y = checkPageBreak(doc, y, 15);
    { const sec = openAutoSection(doc, 'Contact Information', y); y = sec.contentY;
      const thirdW = ffw / 3;
      // Row 1: Phone, Email
      const r1a = addFieldPair(doc, 'Phone', data.phone || '', lx, y, thirdW);
      const r1b = addFieldPair(doc, 'Email', data.email || '', lx + thirdW, y, thirdW * 2);
      y = Math.max(r1a, r1b);
      // Row 2: Address (full width)
      const fullAddr = `${data.address || ''}${data.city ? `, ${data.city}` : ''}${data.state ? `, ${data.state}` : ''} ${data.zip || ''}`.trim();
      y = addFieldPair(doc, 'Address', fullAddr, lx, y, ffw);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

    // ── Employment ──
    y = checkPageBreak(doc, y, 15);
    { const sec = openAutoSection(doc, 'Employment', y); y = sec.contentY;
      // Row 1: Hire Date, Termination Date
      const r1a = addFieldPair(doc, 'Hire Date', fmtDate(data.hire_date), lx, y, hfw);
      const r1b = addFieldPair(doc, 'Termination Date', fmtDate(data.termination_date), rx, y, hfw);
      y = Math.max(r1a, r1b);
      // Row 2: Shift Preference, Uniform Size
      const r2a = addFieldPair(doc, 'Shift Preference', data.shift_preference || '', lx, y, hfw);
      const r2b = addFieldPair(doc, 'Uniform Size', data.uniform_size || '', rx, y, hfw);
      y = Math.max(r2a, r2b);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

    // ── Identification ──
    y = checkPageBreak(doc, y, 12);
    { const sec = openAutoSection(doc, 'Identification', y); y = sec.contentY;
      const quarterW = ffw / 4;
      const r1a = addFieldPair(doc, 'DL Number', data.dl_number || '', lx, y, hfw);
      const r1b = addFieldPair(doc, 'DL State', data.dl_state || '', rx, y, quarterW);
      const r1c = addFieldPair(doc, 'DL Expiry', fmtDate(data.dl_expiry), rx + quarterW, y, quarterW);
      y = Math.max(r1a, r1b, r1c);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

    // ── Emergency Contact ──
    y = checkPageBreak(doc, y, 12);
    { const sec = openAutoSection(doc, 'Emergency Contact', y); y = sec.contentY;
      const quarterW = ffw / 4;
      const r1a = addFieldPair(doc, 'Contact Name', data.emergency_contact_name || '', lx, y, hfw);
      const r1b = addFieldPair(doc, 'Phone', data.emergency_contact_phone || '', rx, y, quarterW);
      const r1c = addFieldPair(doc, 'Relationship', data.emergency_contact_relationship || '', rx + quarterW, y, quarterW);
      y = Math.max(r1a, r1b, r1c);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

    // Certifications
    y = addNarrativeSection(doc, 'Certifications', data.certifications || '', y);
  }

  // ── CREDENTIALS TABLE ──
  if ((reportType === 'full' || reportType === 'credentials') && data.credentials && data.credentials.length > 0) {
    y = checkPageBreak(doc, y, 12);
    { const sec = openAutoSection(doc, 'Credentials', y); y = sec.contentY;
      y = addFieldPair(doc, 'Credentials', `${data.credentials.length} on file`, lx, y, ffw);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

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

    y = checkPageBreak(doc, y, 15);
    { const sec = openAutoSection(doc, 'Training Summary', y); y = sec.contentY;
      const thirdW = ffw / 3;
      const r1a = addFieldPair(doc, 'Total Courses', String(data.training_records.length), lx, y, thirdW);
      const r1b = addFieldPair(doc, 'Completed', String(completedCount), lx + thirdW, y, thirdW);
      const r1c = addFieldPair(doc, 'Total Hours', totalHours.toFixed(1), lx + thirdW * 2, y, thirdW);
      y = Math.max(r1a, r1b, r1c);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

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
    y = checkPageBreak(doc, y, 12);
    { const sec = openAutoSection(doc, 'Assigned Equipment', y); y = sec.contentY;
      y = addFieldPair(doc, 'Equipment', `${data.equipment_list.length} items`, lx, y, ffw);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

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
    y = checkPageBreak(doc, y, 12);
    { const sec = openAutoSection(doc, 'Body Cameras', y); y = sec.contentY;
      y = addFieldPair(doc, 'Cameras', `${data.body_cameras.length} assigned`, lx, y, ffw);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

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
    y = checkPageBreak(doc, y, 12);
    { const sec = openAutoSection(doc, 'Deployments', y); y = sec.contentY;
      y = addFieldPair(doc, 'Deployments', `${data.deployments.length} records`, lx, y, ffw);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

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

    y = checkPageBreak(doc, y, 12);
    { const sec = openAutoSection(doc, 'Time & Attendance', y); y = sec.contentY;
      const r1a = addFieldPair(doc, 'Entries', String(data.time_entries.length), lx, y, hfw);
      const r1b = addFieldPair(doc, 'Total Hours', totalHours.toFixed(1), rx, y, hfw);
      y = Math.max(r1a, r1b);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }

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
    y = await addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block — full-width stacked
  y = addStackedSignatures(doc, 'HR / Supervisor', 'Officer', y, undefined, getOfficerSig());
}

// ── Property Record ──────────────────────────────────────────

async function generatePropertyReport(doc: jsPDF, data: PropertyPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  setActiveCaseNumber(data.name || 'N/A');
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'PROPERTY RECORD',
    formNumber: 'FORM PS-208',
    caseNumber: data.name || 'N/A',
  });

  // Geography / Contract strip
  y = drawGeographyStrip(doc, y, {
    area: data.area_name,
    sector: data.sector_name,
    zone: data.zone_name,
    beat: data.beat_name,
    contract_id: data.contract_id,
  });

  // ── Property Information ──
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Property Information', y); y = sec.contentY;
    // Row 1: Property Name (half), Client (half)
    const r1a = addFieldPair(doc, 'Property Name', data.name || '', lx, y, hfw);
    const r1b = addFieldPair(doc, 'Client', data.client_name || '', rx, y, hfw);
    y = Math.max(r1a, r1b);
    // Row 2: Property Type (half), Status (half)
    const r2a = addFieldPair(doc, 'Property Type', data.property_type || '', lx, y, hfw);
    const r2b = addFieldPair(doc, 'Status', data.is_active ? 'ACTIVE' : 'INACTIVE', rx, y, hfw);
    y = Math.max(r2a, r2b);
    // Row 3: Building details (if any)
    if (data.business_type || data.structure_type || data.occupancy_status) {
      const tw = ffw / 3;
      const b1 = addFieldPair(doc, 'Business Type', data.business_type || '', lx, y, tw);
      const b2 = addFieldPair(doc, 'Structure Type', data.structure_type || '', lx + tw, y, tw);
      const b3 = addFieldPair(doc, 'Occupancy', data.occupancy_status || '', lx + 2 * tw, y, tw);
      y = Math.max(b1, b2, b3);
    }
    if (data.year_built || data.square_footage || data.number_of_stories) {
      const tw = ffw / 3;
      const b4 = addFieldPair(doc, 'Year Built', data.year_built || '', lx, y, tw);
      const b5 = addFieldPair(doc, 'Sq. Footage', data.square_footage || '', lx + tw, y, tw);
      const b6 = addFieldPair(doc, 'Stories', data.number_of_stories || '', lx + 2 * tw, y, tw);
      y = Math.max(b4, b5, b6);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Location ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Location', y); y = sec.contentY;
    const fullAddr = `${data.address || ''}${data.city ? `, ${data.city}` : ''}${data.state ? `, ${data.state}` : ''} ${data.zip || ''}`.trim();
    // Row 1: Address (full width)
    y = addFieldPair(doc, 'Address', fullAddr, lx, y, ffw);
    // Row 2: Latitude, Longitude
    const r2a = addFieldPair(doc, 'Latitude', data.latitude != null ? String(data.latitude) : '', lx, y, hfw);
    const r2b = addFieldPair(doc, 'Longitude', data.longitude != null ? String(data.longitude) : '', rx, y, hfw);
    y = Math.max(r2a, r2b);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Access & Security ──
  y = checkPageBreak(doc, y, 12);
  { const sec = openAutoSection(doc, 'Access & Security', y); y = sec.contentY;
    const tw = ffw / 4;
    const r1a = addFieldPair(doc, 'Gate Code', data.gate_code || '', lx, y, tw);
    const r1b = addFieldPair(doc, 'Alarm Code', data.alarm_code || '', lx + tw, y, tw);
    const r1c = addFieldPair(doc, 'Emergency Contact', data.emergency_contact || '', lx + tw * 2, y, tw * 2);
    y = Math.max(r1a, r1b, r1c);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Owner & Key Holder ──
  if (data.owner_name || data.key_holder_name) {
    y = checkPageBreak(doc, y, 12);
    const sec = openAutoSection(doc, 'Owner & Key Holder', y); y = sec.contentY;
    const hw = ffw / 2;
    if (data.owner_name || data.owner_phone) {
      const o1 = addFieldPair(doc, 'Owner Name', data.owner_name || '', lx, y, hw);
      const o2 = addFieldPair(doc, 'Owner Phone', data.owner_phone || '', rx, y, hw);
      y = Math.max(o1, o2);
    }
    if (data.key_holder_name || data.key_holder_phone) {
      const tw = ffw / 3;
      const k1 = addFieldPair(doc, 'Key Holder', data.key_holder_name || '', lx, y, tw);
      const k2 = addFieldPair(doc, 'Key Holder Phone', data.key_holder_phone || '', lx + tw, y, tw);
      const k3 = addFieldPair(doc, 'Relationship', data.key_holder_relationship || '', lx + 2 * tw, y, tw);
      y = Math.max(k1, k2, k3);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Security Systems ──
  if (data.alarm_company || data.camera_system || data.security_features) {
    y = checkPageBreak(doc, y, 12);
    const sec = openAutoSection(doc, 'Security Systems', y); y = sec.contentY;
    const tw = ffw / 3;
    const s1 = addFieldPair(doc, 'Alarm Company', data.alarm_company || '', lx, y, tw);
    const s2 = addFieldPair(doc, 'Alarm Account', data.alarm_account || '', lx + tw, y, tw);
    const s3 = addFieldPair(doc, 'Camera System', data.camera_system || '', lx + 2 * tw, y, tw);
    y = Math.max(s1, s2, s3);
    if (data.security_features) y = addNarrativeField(doc, 'Security Features', data.security_features, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Facility Details ──
  if (data.parking_info || data.roof_access || data.utility_shutoffs || data.known_hazards || data.last_inspection_date) {
    y = checkPageBreak(doc, y, 14);
    const sec = openAutoSection(doc, 'Facility Details', y); y = sec.contentY;
    const tw = ffw / 3;
    if (data.parking_info) y = addFieldPair(doc, 'Parking', data.parking_info, lx, y, ffw);
    if (data.roof_access || data.utility_shutoffs) {
      const f1 = addFieldPair(doc, 'Roof Access', data.roof_access || '', lx, y, hfw);
      const f2 = addFieldPair(doc, 'Utility Shutoffs', data.utility_shutoffs || '', rx, y, hfw);
      y = Math.max(f1, f2);
    }
    if (data.known_hazards) y = addNarrativeField(doc, 'Known Hazards', data.known_hazards, lx, y, ffw);
    if (data.last_inspection_date || data.inspection_status) {
      const i1 = addFieldPair(doc, 'Last Inspection', fmtDate(data.last_inspection_date), lx, y, hfw);
      const i2 = addFieldPair(doc, 'Inspection Status', data.inspection_status || '', rx, y, hfw);
      y = Math.max(i1, i2);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Access Instructions
  y = addNarrativeSection(doc, 'Access Instructions', data.access_instructions || '', y);

  // Post Orders
  y = addNarrativeSection(doc, 'Post Orders', data.post_orders || '', y);

  // Hazard Notes
  y = addNarrativeSection(doc, 'Hazard Notes', data.hazard_notes || '', y);

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = await addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block — officer + company seal
  y = addStackedSignatures(doc, 'Officer', '', y, getOfficerSig());
}

// ── Citation Report ──────────────────────────────────────────

async function generateCitationReport(doc: jsPDF, data: CitationPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

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

  // ── Citation Information ──
  y = checkPageBreak(doc, y, 18, prio);
  { const sec = openAutoSection(doc, 'Citation Information', y); y = sec.contentY;
    const quarterW = ffw / 4;
    // Row 1: Citation Number (2/4), Type (1/4), Status (1/4)
    const r1a = addFieldPair(doc, 'Citation Number', data.citation_number || '', lx, y, quarterW * 2);
    const r1b = addFieldPair(doc, 'Type', toDisplayLabel(data.type || ''), lx + quarterW * 2, y, quarterW);
    const r1c = addFieldPair(doc, 'Status', displayStatus((data.status || '').replace(/_/g, ' ')), lx + quarterW * 3, y, quarterW);
    y = Math.max(r1a, r1b, r1c);
    // Row 2: Date of Violation, Time, Location
    const r2a = addFieldPair(doc, 'Date of Violation', data.violation_date || '', lx, y, quarterW);
    const r2b = addFieldPair(doc, 'Time', data.violation_time || '', lx + quarterW, y, quarterW);
    const r2c = addFieldPair(doc, 'Location', data.location || '', lx + quarterW * 2, y, quarterW * 2);
    y = Math.max(r2a, r2b, r2c);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Violation Details ──
  y = checkPageBreak(doc, y, 15, prio);
  { const sec = openAutoSection(doc, 'Violation Details', y); y = sec.contentY;
    const quarterW = ffw / 4;
    // Row 1: Statute/Code (half), Offense Level (quarter), Fine Amount (quarter)
    const r1a = addFieldPair(doc, 'Statute / Code', data.statute_citation || '', lx, y, hfw);
    const r1b = addFieldPair(doc, 'Offense Level', toDisplayLabel(data.offense_level || ''), rx, y, quarterW);
    const r1c = addFieldPair(doc, 'Fine Amount', data.fine_amount != null ? fmtCurrency(data.fine_amount) : 'N/A', rx + quarterW, y, quarterW);
    y = Math.max(r1a, r1b, r1c);
    // Row 2: Violation Description (full width, conditional)
    if (data.violation_description) {
      y = addFieldPair(doc, 'Violation Description', data.violation_description, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Subject Information ──
  y = checkPageBreak(doc, y, 15, prio);
  { const sec = openAutoSection(doc, 'Subject Information', y); y = sec.contentY;
    const thirdW = ffw / 3;
    // Row 1: Name (2/3), Date of Birth (1/3)
    const r1a = addFieldPair(doc, 'Name', data.person_name || '', lx, y, thirdW * 2);
    const r1b = addFieldPair(doc, 'Date of Birth', fmtDate(data.person_dob), lx + thirdW * 2, y, thirdW);
    y = Math.max(r1a, r1b);
    // Row 2: Driver's License (1/3), Address (2/3)
    const r2a = addFieldPair(doc, "Driver's License", data.person_dl || '', lx, y, thirdW);
    const r2b = addFieldPair(doc, 'Address', data.person_address || '', lx + thirdW, y, thirdW * 2);
    y = Math.max(r2a, r2b);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Vehicle Information ──
  if (data.vehicle_description || data.vehicle_plate) {
    y = checkPageBreak(doc, y, 12, prio);
    { const sec = openAutoSection(doc, 'Vehicle Information', y); y = sec.contentY;
      const quarterW = ffw / 4;
      const r1a = addFieldPair(doc, 'Vehicle Description', data.vehicle_description || '', lx, y, hfw);
      const r1b = addFieldPair(doc, 'Plate', data.vehicle_plate || '', rx, y, quarterW);
      const r1c = addFieldPair(doc, 'State', data.vehicle_state || '', rx + quarterW, y, quarterW);
      y = Math.max(r1a, r1b, r1c);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }
  }

  // ── Issuing Officer ──
  y = checkPageBreak(doc, y, 12, prio);
  { const sec = openAutoSection(doc, 'Issuing Officer', y); y = sec.contentY;
    const thirdW = ffw / 3;
    const r1a = addFieldPair(doc, 'Officer Name', data.issuing_officer_name || '', lx, y, thirdW * 2);
    const r1b = addFieldPair(doc, 'Badge Number', data.badge_number || '', lx + thirdW * 2, y, thirdW);
    y = Math.max(r1a, r1b);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Court Information ──
  if (data.court_name || data.court_date) {
    y = checkPageBreak(doc, y, 15, prio);
    { const sec = openAutoSection(doc, 'Court Information', y); y = sec.contentY;
      const thirdW = ffw / 3;
      // Row 1: Court Name (2/3), Court Date (1/3)
      const r1a = addFieldPair(doc, 'Court Name', data.court_name || '', lx, y, thirdW * 2);
      const r1b = addFieldPair(doc, 'Court Date', fmtDate(data.court_date), lx + thirdW * 2, y, thirdW);
      y = Math.max(r1a, r1b);
      // Row 2: Court Address (full width, conditional)
      if (data.court_address) {
        y = addFieldPair(doc, 'Court Address', data.court_address, lx, y, ffw);
      }
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }
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

export async function generateRecordPdf<T extends RecordPdfType>(
  recordType: T,
  data: RecordDataMap[T],
): Promise<jsPDF> {
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
      await generateCallReport(doc, data as CallPdfData);
      break;
    case 'person':
      await generatePersonReport(doc, data as PersonPdfData);
      break;
    case 'vehicle':
      await generateVehicleReport(doc, data as VehiclePdfData);
      break;
    case 'warrant':
      await generateWarrantReport(doc, data as WarrantPdfData);
      break;
    case 'evidence':
      await generateEvidenceReport(doc, data as EvidencePdfData);
      break;
    case 'fleet':
      await generateFleetReport(doc, data as FleetPdfData);
      break;
    case 'personnel':
      await generatePersonnelReport(doc, data as PersonnelPdfData);
      break;
    case 'property':
      await generatePropertyReport(doc, data as PropertyPdfData);
      break;
    case 'citation':
      await generateCitationReport(doc, data as CitationPdfData);
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

    const doc = await generateRecordPdf(recordType, data);
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

    const doc = await generateRecordPdf(recordType, data);
    setActiveOfficerSignature(undefined); // clear after generation
    const blob = doc.output('blob');
    return URL.createObjectURL(blob);
  } catch (err) {
    setActiveOfficerSignature(undefined);
    console.error('Record PDF preview generation failed:', err);
    throw new Error(`Failed to generate ${recordType} PDF preview: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

// ── BOLO (Be On The Lookout) Packet PDF ────────────────────

export interface BoloSubject {
  first_name: string;
  last_name: string;
  dob?: string;
  gender?: string;
  race?: string;
  height?: string;
  weight?: string;
  hair_color?: string;
  eye_color?: string;
  address?: string;
  photo_url?: string | null;
  warrants: { warrant_number: string; type: string; charge_description: string; offense_level: string | null; issuing_court: string | null; bail_amount: number | null }[];
}

/** Generate a multi-page BOLO (Be On The Lookout) packet PDF */
export function generateBoloPdf(subjects: BoloSubject[]): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = LAYOUT.PAGE_MARGIN;
  const contentW = pageW - 2 * margin;

  setActiveFormKey('warrant');
  setGenerationTimestamp(new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }));

  // Sort by severity: felony first
  const severityOrder: Record<string, number> = { felony: 0, misdemeanor: 1, infraction: 2, civil: 3 };
  const sorted = [...subjects].sort((a, b) => {
    const aSev = Math.min(...a.warrants.map(w => severityOrder[w.offense_level || ''] ?? 4));
    const bSev = Math.min(...b.warrants.map(w => severityOrder[w.offense_level || ''] ?? 4));
    return aSev - bSev;
  });

  // Watermark on first page
  addConfidentialWatermark(doc);
  // @ts-expect-error jsPDF GState -- safety reset after watermark
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'BE ON THE LOOKOUT (BOLO) PACKET',
    formNumber: 'FORM PS-204B',
    reportDate: fmtDate(new Date().toISOString()),
  });

  y += 2;

  // Subtitle with count
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(`${sorted.length} SUBJECT${sorted.length !== 1 ? 'S' : ''} WITH ACTIVE WARRANTS`, margin, y);
  y += 5;

  for (let i = 0; i < sorted.length; i++) {
    const subj = sorted[i];

    // Check if we need a new page
    if (y > 240) {
      doc.addPage();
      addConfidentialWatermark(doc);
      // @ts-expect-error jsPDF GState
      doc.setGState(new doc.GState({ opacity: 1.0 }));
      y = LAYOUT.PAGE_MARGIN + 5;
    }

    const sectionStartY = y;

    // Subject header bar
    doc.setFillColor(...COLOR.BG_SECTION_HDR);
    doc.rect(margin, y, contentW, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(`${subj.last_name || '?'}, ${subj.first_name || '?'}`.toUpperCase(), margin + 2, y + 5);

    // Severity badge on right
    const topSev = subj.warrants.reduce((best, w) => {
      const o = severityOrder[w.offense_level || ''] ?? 4;
      return o < best.o ? { o, label: w.offense_level || '' } : best;
    }, { o: 4, label: '' });
    if (topSev.label) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      const sevColor: [number, number, number] = topSev.label === 'felony' ? [220, 50, 50] : topSev.label === 'misdemeanor' ? [220, 160, 40] : [120, 120, 120];
      doc.setTextColor(...sevColor);
      doc.text(topSev.label.toUpperCase(), margin + contentW - 2, y + 5, { align: 'right' });
    }

    y += 9;

    // Physical description row
    const descParts: string[] = [];
    if (subj.dob) descParts.push(`DOB: ${fmtDate(subj.dob)}`);
    if (subj.gender) descParts.push(`${subj.gender}`);
    if (subj.race) descParts.push(`${subj.race}`);
    if (subj.height) descParts.push(`Ht: ${subj.height}`);
    if (subj.weight) descParts.push(`Wt: ${subj.weight}`);
    if (subj.hair_color) descParts.push(`Hair: ${subj.hair_color}`);
    if (subj.eye_color) descParts.push(`Eyes: ${subj.eye_color}`);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(descParts.join('  |  '), margin + 2, y + 3);
    y += 5;

    if (subj.address) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text(`Address: ${subj.address}`, margin + 2, y + 3);
      y += 5;
    }

    // Photo (if available)
    if (subj.photo_url) {
      try {
        const photoW = 20;
        const photoH = 24;
        const photoX = margin + contentW - photoW - 2;
        const photoY = sectionStartY + 9;
        doc.addImage(subj.photo_url, 'JPEG', photoX, photoY, photoW, photoH);
        doc.setDrawColor(...COLOR.BORDER_FORM_GRID);
        doc.setLineWidth(BORDER.FORM_CELL);
        doc.rect(photoX, photoY, photoW, photoH, 'S');
      } catch {
        // Photo URL invalid -- skip
      }
    }

    // Warrants table
    if (subj.warrants.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      // Table header
      doc.setFillColor(30, 40, 55);
      doc.rect(margin + 2, y, contentW - 4, 5, 'F');
      doc.text('WARRANT #', margin + 4, y + 3.5);
      doc.text('TYPE', margin + 40, y + 3.5);
      doc.text('CHARGE', margin + 60, y + 3.5);
      doc.text('COURT', margin + 130, y + 3.5);
      doc.text('BAIL', margin + contentW - 8, y + 3.5, { align: 'right' });
      y += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);

      for (const w of subj.warrants) {
        if (y > 260) {
          doc.addPage();
          addConfidentialWatermark(doc);
          // @ts-expect-error jsPDF GState
          doc.setGState(new doc.GState({ opacity: 1.0 }));
          y = LAYOUT.PAGE_MARGIN + 5;
        }
        doc.text(w.warrant_number || '', margin + 4, y + 3);
        doc.text((w.type || '').toUpperCase(), margin + 40, y + 3);
        // Truncate charge if too long
        const charge = (w.charge_description || '').substring(0, 50);
        doc.text(charge, margin + 60, y + 3);
        doc.text((w.issuing_court || '').substring(0, 25), margin + 130, y + 3);
        doc.text(fmtCurrency(w.bail_amount), margin + contentW - 8, y + 3, { align: 'right' });
        y += 5;
      }
    }

    y += 3;

    // Separator line between subjects
    if (i < sorted.length - 1) {
      doc.setDrawColor(...COLOR.BORDER_FORM_GRID);
      doc.setLineWidth(0.2);
      doc.line(margin, y, margin + contentW, y);
      y += 3;
    }
  }

  // Add page footers and watermarks to all pages
  const totalPages = doc.getNumberOfPages();
  for (let pg = 1; pg <= totalPages; pg++) {
    doc.setPage(pg);
    addPageFooter(doc, pg, totalPages);
    if (pg > 1) {
      addConfidentialWatermark(doc);
    }
  }

  return doc;
}

// ── Warrant Summary Report PDF ──────────────────────────────

export interface WarrantSummaryData {
  period: { from: string | null; to: string | null };
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
  topCourts: { issuing_court: string; count: number }[];
  newThisPeriod: number | null;
  clearedThisPeriod: number | null;
  scanActivity: { totalScans: number; totalFound: number; totalCleared: number };
}

/** Generate a single-page Warrant Activity Summary Report */
export function generateWarrantSummaryPdf(data: WarrantSummaryData): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = LAYOUT.PAGE_MARGIN;
  const contentW = pageW - 2 * margin;
  const halfW = (contentW - 4) / 2;

  setActiveFormKey('warrant');
  setGenerationTimestamp(new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }));

  addConfidentialWatermark(doc);
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'WARRANT ACTIVITY SUMMARY REPORT',
    formNumber: 'FORM PS-204S',
    reportDate: fmtDate(new Date().toISOString()),
  });

  y += 2;

  // Period display
  const periodFrom = data.period.from ? fmtDate(data.period.from) : 'All Time';
  const periodTo = data.period.to ? fmtDate(data.period.to) : 'Present';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(`REPORTING PERIOD: ${periodFrom} -- ${periodTo}`, margin, y + 3);
  y += 7;

  // Summary stats
  const statusEntries = Object.entries(data.byStatus);
  const totalWarrants = statusEntries.reduce((s, [, n]) => s + n, 0);

  y = drawFormSection(doc, {
    sideTab: { label: 'SUMMARY' },
    topBanner: true,
    rows: [
      { cells: [
        { label: 'TOTAL WARRANTS', value: String(totalWarrants), ratio: 1, valueBold: true, align: 'center' },
        { label: 'NEW THIS PERIOD', value: data.newThisPeriod != null ? String(data.newThisPeriod) : 'N/A', ratio: 1, align: 'center' },
        { label: 'CLEARED THIS PERIOD', value: data.clearedThisPeriod != null ? String(data.clearedThisPeriod) : 'N/A', ratio: 1, align: 'center' },
      ]},
      { cells: statusEntries.map(([status, count]) => ({
        label: status.toUpperCase(),
        value: String(count),
        ratio: 1,
        align: 'center' as const,
        valueBold: status === 'active',
      }))},
    ],
    y,
  });

  y += 2;

  // Helper to draw a simple breakdown table
  function drawBreakdownTable(title: string, entries: [string, number][], startY: number, x: number, w: number): number {
    let ty = startY;
    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(title, x, ty + 3);
    ty += 5;

    // Header row
    doc.setFillColor(30, 40, 55);
    doc.rect(x, ty, w, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text('CATEGORY', x + 2, ty + 3.5);
    doc.text('COUNT', x + w - 2, ty + 3.5, { align: 'right' });
    ty += 6;

    // Data rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    for (const [label, count] of entries) {
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text(titleCase(label.replace(/_/g, ' ')), x + 2, ty + 3);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text(String(count), x + w - 2, ty + 3, { align: 'right' });
      ty += 5;
    }

    return ty + 2;
  }

  // Two-column layout for breakdown tables
  const leftX = margin;
  const rightX = margin + halfW + 4;

  const typeEntries = Object.entries(data.byType);
  const sevEntries = Object.entries(data.bySeverity);
  const sourceEntries = Object.entries(data.bySource);

  const y1 = drawBreakdownTable('BY TYPE', typeEntries, y, leftX, halfW);
  const y2 = drawBreakdownTable('BY SEVERITY', sevEntries, y, rightX, halfW);
  y = Math.max(y1, y2);

  y += 2;

  // Source breakdown (full width)
  if (sourceEntries.length > 0) {
    y = drawBreakdownTable('BY SOURCE', sourceEntries, y, leftX, contentW);
  }

  // Top Courts table
  if (data.topCourts.length > 0) {
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('TOP ISSUING COURTS', margin, y + 3);
    y += 5;

    doc.setFillColor(30, 40, 55);
    doc.rect(margin, y, contentW, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text('COURT', margin + 2, y + 3.5);
    doc.text('WARRANTS', margin + contentW - 2, y + 3.5, { align: 'right' });
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    for (const court of data.topCourts) {
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text(court.issuing_court || 'Unknown', margin + 2, y + 3);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text(String(court.count), margin + contentW - 2, y + 3, { align: 'right' });
      y += 5;
    }
    y += 2;
  }

  // Scan Activity
  y = drawFormSection(doc, {
    sideTab: { label: 'SCAN ACTIVITY' },
    topBanner: true,
    rows: [
      { cells: [
        { label: 'TOTAL SCANS', value: String(data.scanActivity?.totalScans ?? 0), ratio: 1, align: 'center' },
        { label: 'WARRANTS FOUND', value: String(data.scanActivity?.totalFound ?? 0), ratio: 1, align: 'center', valueBold: true },
        { label: 'WARRANTS CLEARED', value: String(data.scanActivity?.totalCleared ?? 0), ratio: 1, align: 'center' },
      ]},
    ],
    y,
  });

  // Footer + watermark
  const summaryTotalPages = doc.getNumberOfPages();
  for (let pg = 1; pg <= summaryTotalPages; pg++) {
    doc.setPage(pg);
    addPageFooter(doc, pg, summaryTotalPages);
    if (pg > 1) {
      addConfidentialWatermark(doc);
    }
  }

  return doc;
}
