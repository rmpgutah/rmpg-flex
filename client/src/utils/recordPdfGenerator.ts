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
  addPageFooter,
  checkPageBreak,
  setGenerationTimestamp,
  fetchPdfBranding,
  setActiveBranding,
  resetSectionCounter,
  loadPdfAssets,
  setActiveFormKey,
  setActiveCaseNumber,
  addAttachmentsSection,
  addImageToPage,
} from './pdfGenerator';
import type { PdfImage } from './pdfGenerator';
import {
  LAYOUT, SPACING, FONT, COLOR, BORDER,
  getContentWidth, getHalfWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth,
} from './pdfTokens';

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
  // Damage
  damage_estimate?: number;
  damage_description?: string;
  // Resolution
  action_taken?: string;
  responding_officer?: string;
  // Units
  assigned_units?: string[];
  // Timeline
  created_at?: string;
  dispatched_at?: string;
  enroute_at?: string;
  onscene_at?: string;
  cleared_at?: string;
  closed_at?: string;
  created_by?: string;
  // Notes
  notes?: { id: string; author: string; content: string; created_at: string }[];
  attachment_images?: PdfImage[];
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
  // Employment
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

function fmtDate(ts?: string): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      month: '2-digit', day: '2-digit', year: 'numeric',
    });
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

  resetSectionCounter();
  setActiveCaseNumber(data.call_number);
  let y = addReportHeader(doc, data.call_number, 'Call for Service Report', prio, undefined, { useLogo: true });

  // Classification
  { const sec = openAutoSection(doc, 'Classification', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Call Number', value: data.call_number },
      { label: 'Incident Type', value: (data.incident_type || '').replace(/_/g, ' ').toUpperCase() },
      { label: 'Priority', value: data.priority },
      { label: 'Status', value: (data.status || '').toUpperCase() },
      { label: 'Source', value: (data.source || '').replace(/_/g, ' ').toUpperCase() },
      { label: 'Disposition', value: data.disposition || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Caller Information
  y = checkPageBreak(doc, y, 25, prio);
  { const sec = openAutoSection(doc, 'Caller Information', y); y = sec.contentY;
    addFieldPair(doc, 'Caller Name', data.caller_name || '', lx, y, hfw);
    y = addFieldPair(doc, 'Phone', data.caller_phone || '', rx, y, hfw);
    addFieldPair(doc, 'Relationship', data.caller_relationship || '', lx, y, hfw);
    y = addFieldPair(doc, 'Caller Address', data.caller_address || '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Location
  y = checkPageBreak(doc, y, 35, prio);
  { const sec = openAutoSection(doc, 'Incident Location', y); y = sec.contentY;
    y = addFieldPair(doc, 'Address', data.location || '', lx, y, ffw);
    addFieldPair(doc, 'Cross Street', data.cross_street || '', lx, y, hfw);
    y = addFieldPair(doc, 'Property', data.property_name || '', rx, y, hfw);
    y = addThreeColumnFields(doc, [
      { label: 'Building', value: data.location_building || '' },
      { label: 'Floor', value: data.location_floor || '' },
      { label: 'Room', value: data.location_room || '' },
      { label: 'Zone/Beat', value: data.zone_beat || '' },
      { label: 'Latitude', value: data.latitude != null ? String(data.latitude) : '' },
      { label: 'Longitude', value: data.longitude != null ? String(data.longitude) : '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Incident Details
  y = checkPageBreak(doc, y, 35, prio);
  { const sec = openAutoSection(doc, 'Incident Details', y); y = sec.contentY;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('DESCRIPTION', lx, y);
    y += 3;
    doc.setFont('helvetica', 'normal');
    y = addWrappedText(doc, data.description || '', lx, y, ffw);
    y += SPACING.MD;
    y = addThreeColumnFields(doc, [
      { label: '# Subjects', value: data.num_subjects != null ? String(data.num_subjects) : '' },
      { label: '# Victims', value: data.num_victims != null ? String(data.num_victims) : '' },
      { label: 'Direction of Travel', value: data.direction_of_travel || '' },
    ], y);
    if (data.subject_description) {
      y = addFieldPair(doc, 'Subject Description', data.subject_description, lx, y, ffw);
    }
    if (data.vehicle_description) {
      y = addFieldPair(doc, 'Vehicle Description', data.vehicle_description, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Scene Conditions
  y = checkPageBreak(doc, y, 25, prio);
  { const sec = openAutoSection(doc, 'Scene Conditions', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Weather', value: data.weather_conditions || '' },
      { label: 'Lighting', value: data.lighting_conditions || '' },
      { label: 'Weapons Involved', value: data.weapons_involved || '' },
    ], y);
    if (data.scene_safety) {
      y = addFieldPair(doc, 'Scene Safety / Hazards', data.scene_safety, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Flags
  y = checkPageBreak(doc, y, 15, prio);
  { const sec = openAutoSection(doc, 'Flags', y); y = sec.contentY;
    let fx = lx;
    fx = addCheckboxField(doc, 'Injuries Reported', !!data.injuries_reported, fx, y);
    fx = addCheckboxField(doc, 'Alcohol', !!data.alcohol_involved, fx, y);
    fx = addCheckboxField(doc, 'Drugs', !!data.drugs_involved, fx, y);
    fx = addCheckboxField(doc, 'Domestic Violence', !!data.domestic_violence, fx, y);
    y += SPACING.LG;
    fx = lx;
    fx = addCheckboxField(doc, 'Supervisor Notified', !!data.supervisor_notified, fx, y);
    addCheckboxField(doc, 'LE Notified', !!data.le_notified, fx, y);
    y += SPACING.XL;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // LE Coordination
  if (data.le_agency || data.le_case_number) {
    y = checkPageBreak(doc, y, 15, prio);
    const sec = openAutoSection(doc, 'Law Enforcement Coordination', y); y = sec.contentY;
    addFieldPair(doc, 'Agency', data.le_agency || '', lx, y, hfw);
    y = addFieldPair(doc, 'LE Case Number', data.le_case_number || '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Damage Assessment
  if (data.damage_estimate || data.damage_description) {
    y = checkPageBreak(doc, y, 15, prio);
    const sec = openAutoSection(doc, 'Damage Assessment', y); y = sec.contentY;
    addFieldPair(doc, 'Estimate', fmtCurrency(data.damage_estimate), lx, y, hfw);
    y = addFieldPair(doc, 'Description', data.damage_description || '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Resolution
  y = checkPageBreak(doc, y, 20, prio);
  { const sec = openAutoSection(doc, 'Action Taken / Resolution', y); y = sec.contentY;
    addFieldPair(doc, 'Responding Officer', data.responding_officer || '', lx, y, hfw);
    y = addFieldPair(doc, 'Disposition', data.disposition || '', rx, y, hfw);
    if (data.action_taken) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text('ACTION TAKEN', lx, y);
      y += 3;
      doc.setFont('helvetica', 'normal');
      y = addWrappedText(doc, data.action_taken, lx, y, ffw);
      y += SPACING.MD;
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Assigned Units
  if (data.assigned_units && data.assigned_units.length > 0) {
    y = checkPageBreak(doc, y, 15, prio);
    const sec = openAutoSection(doc, 'Assigned Units', y); y = sec.contentY;
    y = addFieldPair(doc, 'Units', data.assigned_units.join(', '), lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Call Timeline
  y = checkPageBreak(doc, y, 30, prio);
  { const sec = openAutoSection(doc, 'Call Timeline', y); y = sec.contentY;
    const timelineRows: string[][] = [];
    if (data.created_at) timelineRows.push(['CREATED', fmtTimestamp(data.created_at)]);
    if (data.dispatched_at) timelineRows.push(['DISPATCHED', fmtTimestamp(data.dispatched_at)]);
    if (data.enroute_at) timelineRows.push(['ENROUTE', fmtTimestamp(data.enroute_at)]);
    if (data.onscene_at) timelineRows.push(['ON SCENE', fmtTimestamp(data.onscene_at)]);
    if (data.cleared_at) timelineRows.push(['CLEARED', fmtTimestamp(data.cleared_at)]);
    if (data.closed_at) timelineRows.push(['CLOSED', fmtTimestamp(data.closed_at)]);

    if (timelineRows.length > 0) {
      y = addTableWithShading(
        doc,
        [{ label: 'STATUS', x: LAYOUT.PAGE_MARGIN + 5 }, { label: 'DATE / TIME', x: LAYOUT.PAGE_MARGIN + 55 }],
        timelineRows,
        y,
        [LAYOUT.PAGE_MARGIN + 5, LAYOUT.PAGE_MARGIN + 55],
      );
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

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40, prio);
  addSignatureBlock(doc, 'Reporting Officer', LAYOUT.PAGE_MARGIN, y, hfw);
  addSignatureBlock(doc, 'Supervisor', rx - SPACING.CONTENT_INSET, y, hfw);
}

// ── Person Record ────────────────────────────────────────────

function generatePersonReport(doc: jsPDF, data: PersonPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);

  resetSectionCounter();
  const personName = `${data.last_name}, ${data.first_name}`.toUpperCase();
  setActiveCaseNumber(personName);
  let y = addReportHeader(doc, personName, 'Individual Record', 'routine', undefined, { caseBoxLabel: 'INDIVIDUAL RECORD', useLogo: true });

  // ID Photo (if available)
  if (data.id_photo) {
    const photoW = 25;
    const photoH = 32;
    const photoX = doc.internal.pageSize.getWidth() - LAYOUT.PAGE_MARGIN - photoW - SPACING.MD;
    addImageToPage(doc, data.id_photo, photoX, y - 3, photoW, photoH);
    doc.setDrawColor(...COLOR.BORDER_FIELD);
    doc.setLineWidth(BORDER.FIELD);
    doc.rect(photoX, y - 3, photoW, photoH);
  }

  // Subject Identification
  { const sec = openAutoSection(doc, 'Subject Identification', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Last Name', value: data.last_name },
      { label: 'First Name', value: data.first_name },
      { label: 'Middle Name', value: data.middle_name || '' },
      { label: 'Alias / Nickname', value: data.alias_nickname || '' },
      { label: 'Date of Birth', value: fmtDate(data.date_of_birth) },
      { label: 'Gender', value: data.gender || '' },
      { label: 'Race', value: data.race || '' },
      { label: 'Citizenship', value: data.citizenship || '' },
      { label: 'Place of Birth', value: data.place_of_birth || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Physical Description
  y = checkPageBreak(doc, y, 35);
  { const sec = openAutoSection(doc, 'Physical Description', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Height', value: data.height || '' },
      { label: 'Weight', value: data.weight || '' },
      { label: 'Build', value: data.build || '' },
      { label: 'Complexion', value: data.complexion || '' },
      { label: 'Hair Color', value: data.hair_color || '' },
      { label: 'Hair Length', value: data.hair_length || '' },
      { label: 'Hair Style', value: data.hair_style || '' },
      { label: 'Eye Color', value: data.eye_color || '' },
      { label: 'Facial Hair', value: data.facial_hair || '' },
      { label: 'Glasses', value: data.glasses || '' },
      { label: 'Blood Type', value: data.blood_type || '' },
      { label: 'Shoe Size', value: data.shoe_size || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  if (data.scars_marks_tattoos) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Scars / Marks / Tattoos', y); y = sec.contentY;
    y = addWrappedText(doc, data.scars_marks_tattoos, lx, y, ffw);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Contact Information
  y = checkPageBreak(doc, y, 25);
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

  // Identification Documents
  y = checkPageBreak(doc, y, 25);
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

  // Employment
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Employment', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Employer', value: data.employer || '' },
      { label: 'Occupation', value: data.occupation || '' },
      { label: 'Language', value: data.language || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Flags & Warnings
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, 'Flags & Warnings', y); y = sec.contentY;
    let fx2 = lx;
    fx2 = addCheckboxField(doc, 'Sex Offender', !!data.is_sex_offender, fx2, y);
    addCheckboxField(doc, 'Veteran', !!data.is_veteran, fx2, y);
    y += SPACING.XL;
    if (data.gang_affiliation) {
      addFieldPair(doc, 'Gang Affiliation', data.gang_affiliation, lx, y, hfw);
    }
    if (data.probation_parole && data.probation_parole !== 'None') {
      addFieldPair(doc, 'Probation/Parole', `${data.probation_parole}${data.probation_parole_officer ? ` (Officer: ${data.probation_parole_officer})` : ''}`, rx, y, hfw);
    }
    y += SPACING.FIELD_ROW_ADVANCE;
    if (data.flags && data.flags.length > 0) {
      y = addFieldPair(doc, 'Active Flags', data.flags.join(', '), lx, y, ffw);
    }
    if (data.caution_flags) {
      y = addFieldPair(doc, 'Caution / Officer Safety', data.caution_flags, lx, y, ffw);
    }
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

  // Notes
  if (data.notes) {
    y = checkPageBreak(doc, y, 18);
    const sec = openAutoSection(doc, 'Notes', y); y = sec.contentY;
    y = addWrappedText(doc, data.notes, lx, y, ffw);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'Entering Officer', LAYOUT.PAGE_MARGIN, y, cw);
}

// ── Vehicle Record ───────────────────────────────────────────

function generateVehicleReport(doc: jsPDF, data: VehiclePdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);

  resetSectionCounter();
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
      { label: 'Lien Holder', value: data.lien_holder || '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Distinguishing Features
  if (data.distinguishing_features) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Distinguishing Features', y); y = sec.contentY;
    y = addWrappedText(doc, data.distinguishing_features, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Damage
  if (data.damage_description) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Damage Description', y); y = sec.contentY;
    y = addWrappedText(doc, data.damage_description, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Flags
  if (data.flags && data.flags.length > 0) {
    y = checkPageBreak(doc, y, 12);
    y = addFieldPair(doc, 'Active Flags', data.flags.join(', '), lx, y, ffw);
  }

  // Notes
  if (data.notes) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Notes', y); y = sec.contentY;
    y = addWrappedText(doc, data.notes, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'Entering Officer', LAYOUT.PAGE_MARGIN, y, cw);
}

// ── Warrant ──────────────────────────────────────────────────

function generateWarrantReport(doc: jsPDF, data: WarrantPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);

  const statusPrio = data.status === 'active' ? 'critical' : data.status === 'served' ? 'low' : 'medium';
  resetSectionCounter();
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
  if (data.notes) {
    y = checkPageBreak(doc, y, 15, statusPrio);
    const sec = openAutoSection(doc, 'Notes', y); y = sec.contentY;
    y = addWrappedText(doc, data.notes, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40, statusPrio);
  const hw = getHalfWidth(doc);
  addSignatureBlock(doc, 'Entering Officer', LAYOUT.PAGE_MARGIN, y, hw);
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

  resetSectionCounter();
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

  // Collection Information
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, 'Collection Information', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Collected By', value: data.collected_by || '' },
      { label: 'Collection Date', value: fmtTimestamp(data.collected_date) },
      { label: 'Packaging Type', value: data.packaging_type || '' },
    ], y);
    addFieldPair(doc, 'Location Found', data.location_found || '', lx, y, hfw);
    addCheckboxField(doc, 'Photo Taken', !!data.photo_taken, rx, y);
    y += SPACING.FIELD_ROW_ADVANCE;
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
  if (data.notes) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Notes', y); y = sec.contentY;
    y = addWrappedText(doc, data.notes, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'Collecting Officer', LAYOUT.PAGE_MARGIN, y, hw);
  addSignatureBlock(doc, 'Evidence Custodian', LAYOUT.PAGE_MARGIN + hw + SPACING.LG, y, hw);
}

// ── Fleet Vehicle Status Report ──────────────────────────────

function generateFleetReport(doc: jsPDF, data: FleetPdfData) {
  const lx = getLeftX();
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);

  const statusPrio = data.status === 'in_service' ? 'low' : data.status === 'maintenance' ? 'medium' : data.status === 'out_of_service' ? 'high' : 'routine';
  resetSectionCounter();
  setActiveCaseNumber(data.vehicle_number);
  let y = addReportHeader(doc, data.vehicle_number, 'Fleet Vehicle Status Report', statusPrio, undefined, { useLogo: true });

  // Vehicle Information
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

  // Assignment
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Assignment', y); y = sec.contentY;
    y = addThreeColumnFields(doc, [
      { label: 'Assigned Unit', value: data.assigned_unit_call_sign || 'Unassigned' },
      { label: 'Current Mileage', value: data.current_mileage ? data.current_mileage.toLocaleString() : '' },
    ], y);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

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

  // Notes
  if (data.notes) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Notes', y); y = sec.contentY;
    y = addWrappedText(doc, data.notes, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'Fleet Manager', LAYOUT.PAGE_MARGIN, y, cw);
}

// ── Personnel / Officer Record ───────────────────────────────

function generatePersonnelReport(doc: jsPDF, data: PersonnelPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);
  const hw = getHalfWidth(doc);

  resetSectionCounter();
  setActiveCaseNumber(data.badge_number || data.employee_id || 'N/A');
  let y = addReportHeader(doc, data.badge_number || data.employee_id || 'N/A', 'Personnel Record', 'routine', undefined, { useLogo: true });

  // Officer Identification
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
    y = addThreeColumnFields(doc, [
      { label: 'Hire Date', value: fmtDate(data.hire_date) },
      { label: 'Termination Date', value: fmtDate(data.termination_date) },
      { label: 'Shift Preference', value: data.shift_preference || '' },
      { label: 'Uniform Size', value: data.uniform_size || '' },
    ], y);
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
  if (data.certifications) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Certifications', y); y = sec.contentY;
    y = addWrappedText(doc, data.certifications, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Notes
  if (data.notes) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Notes', y); y = sec.contentY;
    y = addWrappedText(doc, data.notes, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'HR / Supervisor', LAYOUT.PAGE_MARGIN, y, hw);
  addSignatureBlock(doc, 'Officer', LAYOUT.PAGE_MARGIN + hw + SPACING.LG, y, hw);
}

// ── Property Record ──────────────────────────────────────────

function generatePropertyReport(doc: jsPDF, data: PropertyPdfData) {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const cw = getContentWidth(doc);

  resetSectionCounter();
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
  if (data.access_instructions) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Access Instructions', y); y = sec.contentY;
    y = addWrappedText(doc, data.access_instructions, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Post Orders
  if (data.post_orders) {
    y = checkPageBreak(doc, y, 18);
    const sec = openAutoSection(doc, 'Post Orders', y); y = sec.contentY;
    y = addWrappedText(doc, data.post_orders, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Hazard Notes
  if (data.hazard_notes) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Hazard Notes', y); y = sec.contentY;
    y = addWrappedText(doc, data.hazard_notes, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Attachments
  if (data.attachment_images && data.attachment_images.length > 0) {
    y = addAttachmentsSection(doc, data.attachment_images, y);
  }

  // Signature Block
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'Officer', LAYOUT.PAGE_MARGIN, y, cw);
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
  resetSectionCounter();
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
  if (data.notes) {
    y = checkPageBreak(doc, y, 15);
    const sec = openAutoSection(doc, 'Notes', y); y = sec.contentY;
    y = addWrappedText(doc, data.notes, lx, y, ffw);
    y += SPACING.MD; y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Dual Signature Block — Officer and Recipient
  y = checkPageBreak(doc, y, 40);
  addSignatureBlock(doc, 'Issuing Officer', LAYOUT.PAGE_MARGIN, y, hw);
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

  const doc = generateRecordPdf(recordType, data);
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

  const doc = generateRecordPdf(recordType, data);
  const blob = doc.output('blob');
  return URL.createObjectURL(blob);
}
