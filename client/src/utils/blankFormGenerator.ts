// ============================================================
// RMPG Flex — Blank Printable Form Generator
// Generates empty PDF forms matching the CFS report style
// for officers to fill in by hand during field operations
// ============================================================

import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { FORM_NUMBERS } from './pdfAssets';
import {
  COLOR, FONT, BORDER, LAYOUT, PDF_VALUE_FONT, getContentWidth, getLeftX, getRightColumnX,
  getHalfFieldWidth, getFullFieldWidth,
} from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';
import {
  openAutoSection, closeAutoSection, addConfidentialWatermark,
  addPageFooter, sanitizePdfText, setActiveCaseNumber, setActiveFormKey,
} from './pdfGenerator';
import {
  blankField, blankCheckbox, blankLogTable, blankCheckboxRow, blankTallyGrid,
  ensureRoom, darPageBreak, darField, darFieldRow, darBand, darLegend, darLines,
  darInspectionGrid, darMileageMath, darMathRow, addDarContinuationStrip,
  DAR_ROW_H, DAR_INSPECTION_ITEMS,
} from './blankForms/darPrimitives';
import { VEHICLE_MOVEMENT_FORMS, VEHICLE_MOVEMENT_GENERATORS } from './blankForms/vehicleMovementForms';

// All blank form definitions
export interface BlankFormDef {
  id: string;
  name: string;
  formNumber: string;
  description: string;
  category: 'incident' | 'record' | 'operations' | 'fleet' | 'administrative' | 'service' | 'communications';
}

export const BLANK_FORMS: BlankFormDef[] = [
  // Incident Reports
  { id: 'incident', name: 'Uniform Incident Report', formNumber: FORM_NUMBERS.incident, description: 'General incident/event documentation', category: 'incident' },
  { id: 'trespass', name: 'Trespass Warning Report', formNumber: FORM_NUMBERS.trespass, description: 'Criminal/civil trespass warning', category: 'incident' },
  { id: 'accident', name: 'Accident / Collision Report', formNumber: FORM_NUMBERS.accident, description: 'Vehicle accident documentation', category: 'incident' },
  { id: 'medical', name: 'Medical / Injury Report', formNumber: FORM_NUMBERS.medical, description: 'Medical emergency or injury', category: 'incident' },
  { id: 'use_of_force', name: 'Use of Force Report', formNumber: FORM_NUMBERS.use_of_force, description: 'Force deployment documentation', category: 'incident' },
  { id: 'arrest', name: 'Arrest Report', formNumber: FORM_NUMBERS.arrest, description: 'Custodial arrest documentation', category: 'incident' },
  // Record Forms
  { id: 'call', name: 'Call for Service Report', formNumber: FORM_NUMBERS.call, description: 'Dispatch call documentation', category: 'record' },
  { id: 'person', name: 'Person Record', formNumber: FORM_NUMBERS.person, description: 'Person identification & history', category: 'record' },
  { id: 'vehicle', name: 'Vehicle Record', formNumber: FORM_NUMBERS.vehicle, description: 'Vehicle identification & registration', category: 'record' },
  { id: 'citation', name: 'Citation Record', formNumber: FORM_NUMBERS.citation, description: 'Traffic/municipal citation', category: 'record' },
  { id: 'evidence', name: 'Evidence / Property Record', formNumber: FORM_NUMBERS.evidence, description: 'Evidence chain of custody', category: 'record' },
  // Operations
  { id: 'daily_activity', name: 'Daily Activity / Shift Report', formNumber: FORM_NUMBERS.daily_activity, description: 'Full handwritten shift report — vehicle mileage in/out, CFS log with dispatch/enroute/on-scene/clear/closed times + per-call mileage, patrol rounds, enforcement, tally, pass-down', category: 'operations' },
  { id: 'patrol_tracking', name: 'Patrol Tracking Report', formNumber: FORM_NUMBERS.patrol_tracking, description: 'Patrol route & activity log', category: 'operations' },
  // Fleet / vehicle movement (PS-106-A..E) — companion sheets to the DAR
  ...VEHICLE_MOVEMENT_FORMS,
  // Administrative
  { id: 'invoice', name: 'Invoice', formNumber: FORM_NUMBERS.invoice, description: 'Client billing invoice', category: 'administrative' },
  // Process Service (field service of legal documents)
  { id: 'serve_affidavit',   name: 'Affidavit / Proof of Service', formNumber: FORM_NUMBERS.serve_affidavit,   description: 'Sworn proof a document was served', category: 'service' },
  { id: 'service_log',       name: 'Service Attempt Log',          formNumber: FORM_NUMBERS.service_log,       description: 'Log of dated service attempts', category: 'service' },
  { id: 'serve_non_service', name: 'Return of Non-Service',        formNumber: FORM_NUMBERS.serve_non_service, description: 'Due-diligence return when not served', category: 'service' },
  // Communications (radio / dispatch / message)
  { id: 'radio_log',      name: 'Radio / Communications Log', formNumber: FORM_NUMBERS.radio_log,      description: 'Time-stamped radio traffic log', category: 'communications' },
  { id: 'comms_message',  name: 'Telephone / Message Log',    formNumber: FORM_NUMBERS.comms_message,  description: 'Incoming call & message log', category: 'communications' },
  { id: 'bolo_broadcast', name: 'BOLO Broadcast Record',      formNumber: FORM_NUMBERS.bolo_broadcast, description: 'Be-on-the-lookout broadcast record', category: 'communications' },
];

/** The PS-106 field-form family: multi-page sheets an officer writes on in the
 *  field. They share page furniture (no watermark, per-page identity strip) and
 *  each draws its own labelled certification block. */
function isFieldForm(formId: string): boolean {
  return formId === 'daily_activity' || formId in VEHICLE_MOVEMENT_GENERATORS;
}

/** Generate a blank form PDF with empty fields for handwriting */
export function generateBlankForm(formId: string): jsPDF {
  const form = BLANK_FORMS.find(f => f.id === formId);
  if (!form) throw new Error(`Unknown form: ${formId}`);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const ffw = getFullFieldWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const cw = getContentWidth(doc);

  setActiveFormKey(formId);
  setActiveCaseNumber('');

  // Watermark. Skipped on the whole PS-106 field-form family: these are written
  // on in the field and the 45° CONFIDENTIAL crosses the exact area a pen has to
  // work in. The footer's "INTERNAL USE ONLY" carries the same handling notice
  // without the interference.
  if (!isFieldForm(formId)) {
    addConfidentialWatermark(doc);
    // @ts-expect-error jsPDF GState
    doc.setGState(new doc.GState({ opacity: 1.0 }));
  }

  // Header
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: form.name.toUpperCase(),
    formNumber: form.formNumber,
    // A single space, deliberately. sanitizePdfText strips `_`, so the old
    // '____/____/________' reached the page as a bare "//". But '' is falsy and
    // drawNibrsHeader gates the whole row on truthiness, which dropped the DATE
    // and CASE NUMBER *labels* along with the value. ' ' keeps the labelled box
    // and leaves it blank to write in.
    caseNumber: ' ',
    reportDate: ' ',
  });

  // Generate blank sections based on form type. The vehicle movement family is
  // table-driven rather than five more switch arms.
  const vehicleGen = VEHICLE_MOVEMENT_GENERATORS[formId];
  if (vehicleGen) {
    y = vehicleGen(doc, y, lx, rx, ffw, hfw, cw);
  } else switch (formId) {
    case 'incident':
      y = blankIncidentForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'call':
      y = blankCallForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'person':
      y = blankPersonForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'vehicle':
      y = blankVehicleForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'citation':
      y = blankCitationForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'arrest':
      y = blankArrestForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'evidence':
      y = blankEvidenceForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'trespass':
      y = blankTrespassForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'accident':
      y = blankAccidentForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'medical':
      y = blankMedicalForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'use_of_force':
      y = blankUseOfForceForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'daily_activity':
      y = blankDailyActivityForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'serve_affidavit':
      y = blankServeAffidavitForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'service_log':
      y = blankServiceAttemptLogForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'serve_non_service':
      y = blankNonServiceForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'radio_log':
      y = blankRadioLogForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'comms_message':
      y = blankMessageLogForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    case 'bolo_broadcast':
      y = blankBoloBroadcastForm(doc, y, lx, rx, ffw, hfw, cw);
      break;
    default:
      y = blankGenericForm(doc, y, lx, rx, ffw, hfw, cw, form.name);
      break;
  }

  // Signature block at bottom. Every PS-106 field form draws its own labelled
  // certification inline (two-party on the DAR and the hand-off sheet), so the
  // generic block is skipped to avoid a duplicate, unlabelled officer signature.
  if (!isFieldForm(formId)) {
    y = addBlankSignatureBlock(doc, y, lx, ffw);
  }

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages, form.formNumber);
  }

  // Continuation-page identity strip. Only page 1 carries the agency header, so
  // a multi-page handwritten form that gets separated leaves pages 2+ with no
  // way to tell whose shift they belong to. Second pass, above the content
  // start (y=15mm), so it never perturbs the layout flow.
  if (isFieldForm(formId)) {
    const code = (form.formNumber || '').replace(/^FORM /, '') || formId.toUpperCase();
    for (let i = 2; i <= totalPages; i++) {
      doc.setPage(i);
      addDarContinuationStrip(doc, code, i, totalPages);
    }
  }

  return doc;
}


/** Download a blank form */
export function downloadBlankForm(formId: string): void {
  const form = BLANK_FORMS.find(f => f.id === formId);
  const doc = generateBlankForm(formId);
  const name = form ? form.name.replace(/[^a-zA-Z0-9]+/g, '_') : formId;
  doc.save(`RMPG_Blank_${name}.pdf`);
}

// ── Helper: draw a blank field line ─────────────────────────



function addBlankSignatureBlock(doc: jsPDF, y: number, lx: number, ffw: number): number {
  if (y > 230) { doc.addPage(); y = LAYOUT.PAGE_MARGIN + 5; }
  y += 5;
  const sec = openAutoSection(doc, 'Reporting Officer', y); y = sec.contentY;
  // Signature line
  y += 15;
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setLineWidth(BORDER.SIGNATURE_LINE);
  doc.line(lx, y, lx + ffw * 0.6, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text('SIGNATURE', lx, y + 3);
  y += 6;
  // Printed Name / Badge / Date
  const thirdW = ffw / 3;
  blankField(doc, 'Printed Name', lx, y, thirdW - 2);
  blankField(doc, 'Badge Number', lx + thirdW, y, thirdW - 2);
  blankField(doc, 'Date / Time', lx + thirdW * 2, y, thirdW - 2);
  y += 10;
  y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  return y;
}

// ── Blank form layouts ──────────────────────────────────────

function blankIncidentForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  // Administrative
  { const sec = openAutoSection(doc, 'Administrative Data', y); y = sec.contentY;
    const w4 = ffw / 4;
    y = blankField(doc, 'Incident Type', lx, y, ffw * 0.5);
    const prevY = y;
    blankField(doc, 'Incident #', lx + ffw * 0.5, prevY - 7.5, ffw * 0.3);
    blankField(doc, 'Status', lx + ffw * 0.8, prevY - 7.5, ffw * 0.2);
    y = blankField(doc, 'Occurred Date', lx, y, w4);
    blankField(doc, 'Time', lx + w4, y - 7.5, w4);
    blankField(doc, 'End Date', lx + w4 * 2, y - 7.5, w4);
    blankField(doc, 'End Time', lx + w4 * 3, y - 7.5, w4);
    y = blankField(doc, 'Reporting Officer', lx, y, ffw * 0.7);
    blankField(doc, 'Badge #', lx + ffw * 0.7, y - 7.5, ffw * 0.3);
    y = blankField(doc, 'Location / Address', lx, y, ffw);
    const w6 = ffw / 6;
    y = blankField(doc, 'Dispatch Code', lx, y, w6);
    blankField(doc, 'Section', lx + w6, y - 7.5, w6);
    blankField(doc, 'Zone', lx + w6 * 2, y - 7.5, w6);
    blankField(doc, 'Beat', lx + w6 * 3, y - 7.5, w6);
    blankField(doc, 'Agency', lx + w6 * 4, y - 7.5, w6);
    blankField(doc, 'LE Case #', lx + w6 * 5, y - 7.5, w6);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  // Subject
  { const sec = openAutoSection(doc, 'Subject / Involved Parties', y); y = sec.contentY;
    y = blankField(doc, 'Last Name', lx, y, ffw * 0.35);
    blankField(doc, 'First Name', lx + ffw * 0.35, y - 7.5, ffw * 0.35);
    blankField(doc, 'Middle', lx + ffw * 0.7, y - 7.5, ffw * 0.3);
    const w5 = ffw / 5;
    y = blankField(doc, 'DOB', lx, y, w5);
    blankField(doc, 'Gender', lx + w5, y - 7.5, w5);
    blankField(doc, 'Race', lx + w5 * 2, y - 7.5, w5);
    blankField(doc, 'Height', lx + w5 * 3, y - 7.5, w5);
    blankField(doc, 'Weight', lx + w5 * 4, y - 7.5, w5);
    y = blankField(doc, 'Address', lx, y, ffw);
    y = blankField(doc, 'Phone', lx, y, hfw);
    blankField(doc, 'DL #', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  // Flags
  { const sec = openAutoSection(doc, 'Flags', y); y = sec.contentY + 2;
    const flagW = ffw / 6;
    const flags = ['Injuries', 'Alcohol', 'Drugs', 'DV', 'Mental Health', 'Juvenile',
      'Felony IP', 'Ofc Safety', 'Gang', 'HAZMAT', 'Pursuit', 'Foot Pursuit',
      'K9 Req', 'EMS Req', 'Fire Req', 'Evidence', 'BWC Active', 'Photos'];
    for (let i = 0; i < flags.length; i++) {
      const col = i % 6;
      if (col === 0 && i > 0) y += 4;
      blankCheckbox(doc, flags[i], lx + col * flagW, y);
    }
    y += 5;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  // Narrative
  { const sec = openAutoSection(doc, 'Narrative / Service Notes', y); y = sec.contentY;
    // 15 blank lines for writing
    for (let i = 0; i < 15; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE);
      doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5);
      y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankCallForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Call Information', y); y = sec.contentY;
    const w4 = ffw / 4;
    y = blankField(doc, 'Call Number', lx, y, w4);
    blankField(doc, 'Call Type', lx + w4, y - 7.5, w4 * 2);
    blankField(doc, 'Priority', lx + w4 * 3, y - 7.5, w4);
    y = blankField(doc, 'Location / Address', lx, y, ffw);
    y = blankField(doc, 'Caller Name', lx, y, hfw);
    blankField(doc, 'Caller Phone', rx, y - 7.5, hfw);
    y = blankField(doc, 'Property / Client', lx, y, hfw);
    blankField(doc, 'Billing Code', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Officer / Location', y); y = sec.contentY;
    y = blankField(doc, 'Officer', lx, y, ffw * 0.4);
    blankField(doc, 'Call Sign', lx + ffw * 0.4, y - 7.5, ffw * 0.2);
    blankField(doc, 'Section', lx + ffw * 0.6, y - 7.5, ffw * 0.15);
    blankField(doc, 'Zone', lx + ffw * 0.75, y - 7.5, ffw * 0.15);
    blankField(doc, 'Beat', lx + ffw * 0.9, y - 7.5, ffw * 0.1);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Date / Time', y); y = sec.contentY;
    const w4 = ffw / 4;
    y = blankField(doc, 'Occurred Date', lx, y, w4);
    blankField(doc, 'Occurred Time', lx + w4, y - 7.5, w4);
    blankField(doc, 'End Date', lx + w4 * 2, y - 7.5, w4);
    blankField(doc, 'End Time', lx + w4 * 3, y - 7.5, w4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  // Narrative
  { const sec = openAutoSection(doc, 'Narrative / Service Notes', y); y = sec.contentY;
    for (let i = 0; i < 15; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5); y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankPersonForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Subject Identification', y); y = sec.contentY;
    y = blankField(doc, 'Last Name', lx, y, ffw * 0.35);
    blankField(doc, 'First Name', lx + ffw * 0.35, y - 7.5, ffw * 0.35);
    blankField(doc, 'Middle', lx + ffw * 0.7, y - 7.5, ffw * 0.3);
    const w5 = ffw / 5;
    y = blankField(doc, 'DOB', lx, y, w5);
    blankField(doc, 'Gender', lx + w5, y - 7.5, w5);
    blankField(doc, 'Race', lx + w5 * 2, y - 7.5, w5);
    blankField(doc, 'SSN Last 4', lx + w5 * 3, y - 7.5, w5);
    blankField(doc, 'Alias', lx + w5 * 4, y - 7.5, w5);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Physical Description', y); y = sec.contentY;
    const w6 = ffw / 6;
    y = blankField(doc, 'Height', lx, y, w6);
    blankField(doc, 'Weight', lx + w6, y - 7.5, w6);
    blankField(doc, 'Build', lx + w6 * 2, y - 7.5, w6);
    blankField(doc, 'Hair Color', lx + w6 * 3, y - 7.5, w6);
    blankField(doc, 'Eye Color', lx + w6 * 4, y - 7.5, w6);
    blankField(doc, 'Complexion', lx + w6 * 5, y - 7.5, w6);
    y = blankField(doc, 'Scars / Marks / Tattoos', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Contact / Identification', y); y = sec.contentY;
    y = blankField(doc, 'Address', lx, y, ffw);
    y = blankField(doc, 'Phone', lx, y, hfw);
    blankField(doc, 'Email', rx, y - 7.5, hfw);
    y = blankField(doc, 'DL Number', lx, y, ffw * 0.4);
    blankField(doc, 'DL State', lx + ffw * 0.4, y - 7.5, ffw * 0.2);
    blankField(doc, 'Employer', lx + ffw * 0.6, y - 7.5, ffw * 0.4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  // Notes
  { const sec = openAutoSection(doc, 'Notes', y); y = sec.contentY;
    for (let i = 0; i < 10; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5); y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankVehicleForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Vehicle Identification', y); y = sec.contentY;
    y = blankField(doc, 'Plate Number', lx, y, ffw * 0.25);
    blankField(doc, 'State', lx + ffw * 0.25, y - 7.5, ffw * 0.15);
    blankField(doc, 'VIN', lx + ffw * 0.4, y - 7.5, ffw * 0.6);
    const w6 = ffw / 6;
    y = blankField(doc, 'Year', lx, y, w6);
    blankField(doc, 'Make', lx + w6, y - 7.5, w6);
    blankField(doc, 'Model', lx + w6 * 2, y - 7.5, w6);
    blankField(doc, 'Color', lx + w6 * 3, y - 7.5, w6);
    blankField(doc, 'Body Type', lx + w6 * 4, y - 7.5, w6);
    blankField(doc, 'Style', lx + w6 * 5, y - 7.5, w6);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Owner / Registration', y); y = sec.contentY;
    y = blankField(doc, 'Registered Owner', lx, y, ffw);
    y = blankField(doc, 'Owner Address', lx, y, ffw);
    y = blankField(doc, 'Insurance Company', lx, y, hfw);
    blankField(doc, 'Policy #', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  // Notes
  { const sec = openAutoSection(doc, 'Notes', y); y = sec.contentY;
    for (let i = 0; i < 10; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5); y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankCitationForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Citation Information', y); y = sec.contentY;
    y = blankField(doc, 'Citation #', lx, y, ffw * 0.3);
    blankField(doc, 'Type', lx + ffw * 0.3, y - 7.5, ffw * 0.3);
    blankField(doc, 'Date', lx + ffw * 0.6, y - 7.5, ffw * 0.2);
    blankField(doc, 'Time', lx + ffw * 0.8, y - 7.5, ffw * 0.2);
    y = blankField(doc, 'Location', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Violation Details', y); y = sec.contentY;
    y = blankField(doc, 'Violation Description', lx, y, ffw);
    y = blankField(doc, 'Statute / Code', lx, y, hfw);
    blankField(doc, 'Offense Level', rx, y - 7.5, hfw);
    y = blankField(doc, 'Fine Amount', lx, y, ffw * 0.3);
    blankField(doc, 'Speed', lx + ffw * 0.3, y - 7.5, ffw * 0.2);
    blankField(doc, 'Posted Limit', lx + ffw * 0.5, y - 7.5, ffw * 0.2);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Subject', y); y = sec.contentY;
    y = blankField(doc, 'Name', lx, y, ffw * 0.6);
    blankField(doc, 'DOB', lx + ffw * 0.6, y - 7.5, ffw * 0.4);
    y = blankField(doc, 'Address', lx, y, ffw);
    y = blankField(doc, 'DL #', lx, y, hfw);
    blankField(doc, 'State', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Court Information', y); y = sec.contentY;
    y = blankField(doc, 'Court Name', lx, y, hfw);
    blankField(doc, 'Court Date', rx, y - 7.5, hfw);
    y = blankField(doc, 'Court Address', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankArrestForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Arrest Information', y); y = sec.contentY;
    y = blankField(doc, 'Arrest Date', lx, y, ffw * 0.3);
    blankField(doc, 'Time', lx + ffw * 0.3, y - 7.5, ffw * 0.2);
    blankField(doc, 'Location', lx + ffw * 0.5, y - 7.5, ffw * 0.5);
    y = blankField(doc, 'Arrest Type', lx, y, hfw);
    blankField(doc, 'Booking #', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Subject', y); y = sec.contentY;
    y = blankField(doc, 'Last Name', lx, y, ffw * 0.35);
    blankField(doc, 'First Name', lx + ffw * 0.35, y - 7.5, ffw * 0.35);
    blankField(doc, 'Middle', lx + ffw * 0.7, y - 7.5, ffw * 0.3);
    y = blankField(doc, 'DOB', lx, y, ffw * 0.25);
    blankField(doc, 'Gender', lx + ffw * 0.25, y - 7.5, ffw * 0.15);
    blankField(doc, 'Race', lx + ffw * 0.4, y - 7.5, ffw * 0.15);
    blankField(doc, 'Address', lx + ffw * 0.55, y - 7.5, ffw * 0.45);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Charges', y); y = sec.contentY;
    for (let i = 1; i <= 5; i++) {
      y = blankField(doc, `Charge ${i}`, lx, y, ffw * 0.7);
      blankField(doc, 'Statute', lx + ffw * 0.7, y - 7.5, ffw * 0.3);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Miranda / Rights', y); y = sec.contentY + 2;
    blankCheckbox(doc, 'Miranda Advised', lx, y);
    blankCheckbox(doc, 'Waived Rights', lx + ffw * 0.25, y);
    blankCheckbox(doc, 'Invoked Rights', lx + ffw * 0.5, y);
    y += 5;
    y = blankField(doc, 'Miranda Time', lx, y, hfw);
    blankField(doc, 'Advised By', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  // Narrative
  { const sec = openAutoSection(doc, 'Narrative', y); y = sec.contentY;
    for (let i = 0; i < 12; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5); y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankEvidenceForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Evidence Identification', y); y = sec.contentY;
    y = blankField(doc, 'Evidence #', lx, y, ffw * 0.3);
    blankField(doc, 'Case / Incident #', lx + ffw * 0.3, y - 7.5, ffw * 0.4);
    blankField(doc, 'Type', lx + ffw * 0.7, y - 7.5, ffw * 0.3);
    y = blankField(doc, 'Description', lx, y, ffw);
    y = blankField(doc, 'Location Found', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Collection', y); y = sec.contentY;
    y = blankField(doc, 'Collected By', lx, y, hfw);
    blankField(doc, 'Date / Time', rx, y - 7.5, hfw);
    y = blankField(doc, 'Storage Location', lx, y, hfw);
    blankField(doc, 'Condition', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Chain of Custody', y); y = sec.contentY;
    // Table header
    doc.setFillColor(...COLOR.BG_ZEBRA);
    const tw = ffw;
    doc.rect(lx, y, tw, 4.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(FONT.SIZE_FIELD_LABEL); doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('DATE/TIME', lx + 1.5, y + 3);
    doc.text('RELEASED BY', lx + tw * 0.25 + 1.5, y + 3);
    doc.text('RECEIVED BY', lx + tw * 0.5 + 1.5, y + 3);
    doc.text('PURPOSE', lx + tw * 0.75 + 1.5, y + 3);
    doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
    doc.line(lx, y + 4.5, lx + tw, y + 4.5);
    y += 4.5;
    // 6 blank rows
    for (let i = 0; i < 6; i++) {
      y += 5;
      doc.line(lx, y, lx + tw, y);
    }
    y += 2;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankTrespassForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Trespass Details', y); y = sec.contentY;
    y = blankField(doc, 'Property / Location', lx, y, ffw);
    y = blankField(doc, 'Property Owner / Manager', lx, y, hfw);
    blankField(doc, 'Phone', rx, y - 7.5, hfw);
    y = blankField(doc, 'Duration', lx, y, ffw * 0.3);
    blankField(doc, 'Effective Date', lx + ffw * 0.3, y - 7.5, ffw * 0.35);
    blankField(doc, 'Expiration', lx + ffw * 0.65, y - 7.5, ffw * 0.35);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Subject', y); y = sec.contentY;
    y = blankField(doc, 'Name', lx, y, ffw * 0.6);
    blankField(doc, 'DOB', lx + ffw * 0.6, y - 7.5, ffw * 0.4);
    y = blankField(doc, 'Address', lx, y, ffw);
    y = blankField(doc, 'Description', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  // Narrative
  { const sec = openAutoSection(doc, 'Narrative', y); y = sec.contentY;
    for (let i = 0; i < 12; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5); y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankAccidentForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Accident Information', y); y = sec.contentY;
    y = blankField(doc, 'Date', lx, y, ffw * 0.25);
    blankField(doc, 'Time', lx + ffw * 0.25, y - 7.5, ffw * 0.25);
    blankField(doc, 'Location', lx + ffw * 0.5, y - 7.5, ffw * 0.5);
    const w4 = ffw / 4;
    y = blankField(doc, 'Road Conditions', lx, y, w4);
    blankField(doc, 'Weather', lx + w4, y - 7.5, w4);
    blankField(doc, 'Lighting', lx + w4 * 2, y - 7.5, w4);
    blankField(doc, 'Traffic Control', lx + w4 * 3, y - 7.5, w4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Vehicle 1', y); y = sec.contentY;
    y = blankField(doc, 'Year/Make/Model', lx, y, ffw * 0.5);
    blankField(doc, 'Color', lx + ffw * 0.5, y - 7.5, ffw * 0.2);
    blankField(doc, 'Plate', lx + ffw * 0.7, y - 7.5, ffw * 0.3);
    y = blankField(doc, 'Driver Name', lx, y, hfw);
    blankField(doc, 'DL #', rx, y - 7.5, hfw);
    y = blankField(doc, 'Insurance', lx, y, hfw);
    blankField(doc, 'Policy #', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Vehicle 2', y); y = sec.contentY;
    y = blankField(doc, 'Year/Make/Model', lx, y, ffw * 0.5);
    blankField(doc, 'Color', lx + ffw * 0.5, y - 7.5, ffw * 0.2);
    blankField(doc, 'Plate', lx + ffw * 0.7, y - 7.5, ffw * 0.3);
    y = blankField(doc, 'Driver Name', lx, y, hfw);
    blankField(doc, 'DL #', rx, y - 7.5, hfw);
    y = blankField(doc, 'Insurance', lx, y, hfw);
    blankField(doc, 'Policy #', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  // Narrative
  { const sec = openAutoSection(doc, 'Narrative', y); y = sec.contentY;
    for (let i = 0; i < 12; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5); y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankMedicalForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Patient / Subject', y); y = sec.contentY;
    y = blankField(doc, 'Name', lx, y, ffw * 0.6);
    blankField(doc, 'DOB', lx + ffw * 0.6, y - 7.5, ffw * 0.4);
    y = blankField(doc, 'Address', lx, y, ffw);
    y = blankField(doc, 'Phone', lx, y, hfw);
    blankField(doc, 'Emergency Contact', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Medical Details', y); y = sec.contentY;
    y = blankField(doc, 'Nature of Injury / Illness', lx, y, ffw);
    y = blankField(doc, 'Location on Body', lx, y, hfw);
    blankField(doc, 'Severity', rx, y - 7.5, hfw);
    y = blankField(doc, 'Treatment Provided', lx, y, ffw);
    y = blankField(doc, 'Transported To', lx, y, hfw);
    blankField(doc, 'By', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  // Narrative
  { const sec = openAutoSection(doc, 'Narrative', y); y = sec.contentY;
    for (let i = 0; i < 12; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5); y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankUseOfForceForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Incident Information', y); y = sec.contentY;
    y = blankField(doc, 'Date', lx, y, ffw * 0.25);
    blankField(doc, 'Time', lx + ffw * 0.25, y - 7.5, ffw * 0.25);
    blankField(doc, 'Location', lx + ffw * 0.5, y - 7.5, ffw * 0.5);
    y = blankField(doc, 'Incident #', lx, y, hfw);
    blankField(doc, 'Call #', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Force Used', y); y = sec.contentY + 2;
    const flagW = ffw / 4;
    const forces = ['Verbal Commands', 'Physical Control', 'OC Spray', 'Taser', 'Baton', 'Firearm', 'K9', 'Other'];
    for (let i = 0; i < forces.length; i++) {
      const col = i % 4;
      if (col === 0 && i > 0) y += 4;
      blankCheckbox(doc, forces[i], lx + col * flagW, y);
    }
    y += 5;
    y = blankField(doc, 'Force Description', lx, y, ffw);
    y = blankField(doc, 'Subject Resistance Level', lx, y, hfw);
    blankField(doc, 'Subject Injuries', rx, y - 7.5, hfw);
    y = blankField(doc, 'Officer Injuries', lx, y, hfw);
    blankField(doc, 'Medical Aid Rendered', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  // Narrative
  { const sec = openAutoSection(doc, 'Narrative', y); y = sec.contentY;
    for (let i = 0; i < 12; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5); y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

// ── Daily Activity / Shift Report (FORM PS-106) ─────────────────────────────
// The DAR is the one blank form a guard fills for EVERY shift, so it is laid
// out to the SHAPE OF A SHIFT rather than by topic: everything recorded at
// check-in is on the front pages, everything logged while working is in the
// middle, and everything computed at check-out (odometer in, mileage math,
// equipment return, tally, sign-off) is at the back — so the officer never
// flips backwards with a clipboard on their knee. Field labels mirror the CAD
// column names so a records clerk keys a paper sheet straight into Dispatch
// without translating.
//
// Check-in and check-out carry the heaviest detail because they are the two
// moments a shift can be reconstructed from: an odometer, a fuel level and an
// inspection state at each end bound everything that happened in between, and
// they are the fields a client, an insurer or a payroll dispute actually asks
// for months later.
//
// Print ergonomics: no diagonal watermark across the writing area, ~8mm log
// rows and ~5mm field write-space (a pen needs more room than printed text),
// and every continuation page carries an officer/date/unit strip so a loose
// sheet can never be orphaned.













function blankDailyActivityForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  const w3 = ffw / 3;

  // ═══ CHECK-IN ══════════════════════════════════════════════
  { const sec = openAutoSection(doc, 'Shift Information', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Officer Name (Last, First)', 'Badge #', 'Employee ID', 'Rank / Title', 'Call Sign']);
    y = darFieldRow(doc, lx, y, ffw, ['Shift Date', 'Day of Week', 'Sched. Start', 'Sched. End', 'Actual Start', 'Actual End']);
    y = darFieldRow(doc, lx, y, ffw, ['Total Hours', 'OT Hours', 'Unpaid Meal (min)', 'Armed / Unarmed', 'Uniform / Attire']);
    y = darFieldRow(doc, lx, y, ffw, ['Post / Property / Client', 'Contract / Site #', 'Shift (Day/Swing/Grave)']);
    y = darFieldRow(doc, lx, y, ffw, ['Section', 'Zone', 'Beat', 'Supervisor on Duty', 'DAR #']);
    y = darFieldRow(doc, lx, y, ffw, ['Partner / 2nd Officer', 'Relieved From (name / time)', 'Relieved By (name / time)', 'Weather / Conditions']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Duty Status & Muster', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Time Reported for Duty', 'Time In Service (10-8)', 'Briefing Given By', 'Briefing Time']);
    y = darBand(doc, 'Fitness & attendance - check each', lx, y + 1);
    y = blankCheckboxRow(doc, ['Fit for duty', 'Roll call attended', 'Uniform / grooming OK', 'Licence + credentials carried'], lx, y + 2, lx + ffw);
    y = blankCheckboxRow(doc, ['No impairing medication', 'Court / training today', 'Restricted duty', 'Working alone (no partner)'], lx, y, lx + ffw);
    y = darBand(doc, 'Briefing notes / BOLOs / persons of interest', lx, y + 1);
    y = darLines(doc, lx, y + 1, ffw, 4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Communications & Systems Check', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Radio ID / Serial', 'Channel / Talkgroup', 'Radio Check w/ Dispatch (time)', 'Duty Phone #']);
    y = blankCheckboxRow(doc, ['Radio check OK', 'Spare battery', 'Earpiece / mic', 'MDT login OK', 'GPS / AVL reporting'], lx, y + 1, lx + ffw);
    y = blankCheckboxRow(doc, ['Panic / duress tested', 'Flex app logged in', 'Body cam paired', 'After-hours contact list'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Vehicle radio / repeater', 'Backup comms plan agreed', 'Dispatch notified 10-8'], lx, y, lx + ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Personal Equipment & Readiness', y); y = sec.contentY + 1;
    y = blankCheckboxRow(doc, ['Body cam charged', 'Test recording', 'Prior footage uploaded', 'Radio + spare batt', 'MDT / phone'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Duty belt complete', 'OC spray', 'Taser + cartridge', 'Baton', 'Handcuffs (x2)'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Vest worn', 'Flashlight', 'First aid / IFAK', 'AED', 'Narcan'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Site keys / fobs', 'Citation book', 'Blank forms', 'ID visible', 'Notebook / pen'], lx, y, lx + ffw);
    y = darField(doc, 'Missing / deficient equipment - describe and note who it was reported to', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ═══ PAGE 2 - vehicle out, post orders, breaks ═════════════
  y = darPageBreak(doc);
  { const sec = openAutoSection(doc, 'Start of Shift: Vehicle & Odometer Out', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Unit #', 'License Plate', 'Year / Make / Model', 'VIN (last 6)', 'Key / Fob #']);
    y = darFieldRow(doc, lx, y, ffw, ['ODOMETER OUT (start)', 'Engine Hours Out', 'Time Out', 'Fuel Level Out (1/4 1/2 3/4 F)', 'Fuel Type']);
    y = darBand(doc, 'Pre-trip inspection - mark OK or DEF (defect) for each point', lx, y + 1);
    y = darInspectionGrid(doc, lx, y + 1, ffw, DAR_INSPECTION_ITEMS);
    y = darBand(doc, 'Pre-existing damage / defects noted before driving (photograph and describe)', lx, y);
    y = darLines(doc, lx, y + 1, ffw, 3);
    y = darBand(doc, 'Vehicle equipment inventory', lx, y + 1);
    y = blankCheckboxRow(doc, ['First aid kit', 'AED', 'Fire extinguisher', 'Road flares / cones', 'Jumper cables'], lx, y + 2, lx + ffw);
    y = blankCheckboxRow(doc, ['Spill / biohazard kit', 'Blanket', 'Tow strap', 'Long gun secured', 'Spare tire + jack'], lx, y, lx + ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Post Orders, Access & Key Control', y); y = sec.contentY + 1;
    y = blankCheckboxRow(doc, ['Post orders reviewed', 'Pass-down from prior shift read', 'BOLOs reviewed', 'Client instructions received'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Alarm codes verified', 'Key control log signed', 'Access card tested', 'Emergency contacts on hand'], lx, y, lx + ffw);
    y = darFieldRow(doc, lx, y + 1, ffw, ['Keys / Fobs Issued (#)', 'Key Log #', 'Access Card #', 'Alarm Code Verified By']);
    y = darBand(doc, 'Special instructions for this shift', lx, y + 1);
    y = darLines(doc, lx, y + 1, ffw, 4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Breaks / Meal Periods & Out-of-Service', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Out of Svc',              frac: 0.14 },
      { label: 'Back in Svc',             frac: 0.14 },
      { label: 'Type (meal/break/admin)', frac: 0.26 },
      { label: 'Location',                frac: 0.26 },
      { label: 'Minutes',                 frac: 0.10 },
      { label: 'Paid? Y/N',               frac: 0.10 },
    ], 5, DAR_ROW_H);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ═══ PAGE 3 - calls for service ════════════════════════════
  y = darPageBreak(doc);
  { const sec = openAutoSection(doc, 'Calls for Service (CFS) - CAD Times & Per-Call Mileage', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'CFS #',    frac: 0.095 },
      { label: 'Type',     frac: 0.110 },
      { label: 'Location', frac: 0.195 },
      { label: 'Disp',     frac: 0.058 },
      { label: 'Enrt',     frac: 0.058 },
      { label: 'On Scn',   frac: 0.058 },
      { label: 'Clear',    frac: 0.058 },
      { label: 'Closed',   frac: 0.058 },
      { label: 'Mi Out',   frac: 0.068 },
      { label: 'Mi In',    frac: 0.068 },
      { label: 'Mi Tot',   frac: 0.062 },
      { label: 'Dispo',    frac: 0.112 },
    ], 25, DAR_ROW_H);
    y = darLegend(doc, lx, y, [
      'Times 24-hour (HHMM). DISP = dispatched - ENRT = enroute - ON SCN = arrived on scene - CLEAR = cleared scene - CLOSED = call closed in CAD.',
      'Dispo: RPT = report taken - ARR = arrest - CIT = citation - TW = trespass warning - GOA = gone on arrival',
      'UTL = unable to locate - UNF = unfounded - ASST = assist - CBS = cleared by service.',
    ]);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ═══ PAGE 4 - hourly odometer + patrol ═════════════════════
  // Odometer only at the ends of a shift gives one number and no way to place
  // it in time. An hourly reading turns mileage into a timeline a supervisor
  // can reconcile against CAD, GPS/AVL and the patrol log.
  y = darPageBreak(doc);
  { const sec = openAutoSection(doc, 'Hourly Odometer & Unit Status Log', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Hour',              frac: 0.075 },
      { label: 'Odometer',          frac: 0.115 },
      { label: 'Miles This Hr',     frac: 0.105 },
      { label: 'Location / Zone',   frac: 0.28 },
      { label: 'Status',            frac: 0.10 },
      { label: 'Engine Hrs',        frac: 0.10 },
      { label: 'Notes',             frac: 0.225 },
    ], 12, DAR_ROW_H);
    y = darLegend(doc, lx, y, [
      'Status: 10-8 = in service - 10-7 = out of service - 10-6 = busy / on scene - 10-23 = arrived - OOS = mechanical.',
      'Take a reading at the top of every hour. Hourly readings are what let a mileage dispute be narrowed to an hour instead of a whole shift.',
    ]);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Patrol Rounds & Post Checks', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Time',                 frac: 0.09 },
      { label: 'Checkpoint / Area',    frac: 0.26 },
      { label: 'Method',               frac: 0.09 },
      { label: 'Odometer',             frac: 0.11 },
      { label: 'Findings / Condition', frac: 0.36 },
      { label: 'Init',                 frac: 0.09 },
    ], 11, DAR_ROW_H);
    y = darLegend(doc, lx, y, ['Method: F = foot - V = vehicle - B = bike - S = static post.']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // One merged event log. Three separate tables (other activity / enforcement /
  // contacts) cost three section headers and forced the officer to decide which
  // grid an event belonged in mid-shift; a type code does that job in one column.
  // ═══ PAGE 5 - activity log ═════════════════════════════════
  y = darPageBreak(doc);
  { const sec = openAutoSection(doc, 'Activity, Contacts & Enforcement Log', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Time',                       frac: 0.09 },
      { label: 'Code',                       frac: 0.08 },
      { label: 'Subject / Plate / Report #', frac: 0.28 },
      { label: 'Location',                   frac: 0.24 },
      { label: 'Action / Outcome',           frac: 0.31 },
    ], 11, DAR_ROW_H);
    y = darLegend(doc, lx, y, [
      'Code: PC = person contact - VC = vehicle check - IR = incident report - CIT = citation - TW = trespass warning - ARR = arrest - UOF = use of force',
      'ESC = escort - ALM = alarm response - MNT = maintenance / facility issue - LE = law-enforcement assist - OTH = other (describe).',
      'Wants / warrants run on a contact? Note WW-CLR (clear) or WW-HIT in the Action column.',
    ]);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Shift Mileage Distribution - must total to miles driven', y); y = sec.contentY + 1;
    y = blankTallyGrid(doc, lx, y, ffw, [
      'Patrol', 'CFS Response', 'Escort / Transport', 'Deadhead / Repo',
      'Fuel / Service', 'Admin / Court', 'Training', 'Commute / Personal',
    ], 4);
    y = darMathRow(doc, lx, y + 1, ffw,
      ['Sum of Categories', 'Total Miles Driven', 'VARIANCE (must be 0)'], ['vs', '=']);
    y = darBand(doc, 'Explanation of any variance', lx, y);
    y = darLines(doc, lx, y + 1, ffw, 2);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ═══ CHECK-OUT ═════════════════════════════════════════════
  // ═══ PAGE 5 - vehicle in, equipment return, tally ══════════
  y = darPageBreak(doc);
  { const sec = openAutoSection(doc, 'End of Shift: Vehicle & Odometer In', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Time In', 'Engine Hours In', 'Fuel Level In (1/4 1/2 3/4 F)', 'Post-Trip Pass / Fail']);
    y = darMileageMath(doc, lx, y + 1, ffw);
    y = darFieldRow(doc, lx, y, ffw, ['Billable / Patrol Miles', 'Non-Billable / Deadhead', 'CFS Response Miles', 'Commute / Personal', 'Discrepancy (mi)']);
    y = darFieldRow(doc, lx, y, ffw, ['Fuel Added (gal)', 'Fuel Cost ($)', 'Receipt # / Attached', 'Fuel Station', 'Odometer Photo Taken']);
    y = darBand(doc, 'Post-trip inspection - mark OK or DEF (defect) for each point', lx, y + 1);
    y = darInspectionGrid(doc, lx, y + 1, ffw, DAR_INSPECTION_ITEMS);
    y = darBand(doc, 'NEW damage or mechanical issues arising THIS shift (photograph, describe, report to supervisor)', lx, y);
    y = darLines(doc, lx, y + 1, ffw, 4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Vehicle Secured, Equipment Return & Evidence', y); y = sec.contentY + 1;
    y = blankCheckboxRow(doc, ['Fueled for next shift', 'Interior cleaned', 'Trash removed', 'Locked / alarmed', 'Plugged in / charging'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Body cam docked', 'Footage uploaded', 'Radio returned / charging', 'Keys returned'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Citation book returned', 'All issued equipment returned', 'Lost / damaged reported', 'Evidence submitted'], lx, y, lx + ffw);
    y = darFieldRow(doc, lx, y + 1, ffw, ['Parked / Stored At', 'Keys Returned To', 'Mileage Verified By', 'Time Out of Service (10-7)']);
    y = darFieldRow(doc, lx, y, ffw, ['BWC Videos (#)', 'Photos (#)', 'Evidence Items (#)', 'Evidence Locker #', 'Submitted To']);
    y = darFieldRow(doc, lx, y, ffw, ['Report #s Written This Shift', 'Property / Found Items Logged', 'Uniform / Gear Damage']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Vehicle Utilization & Economy', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Engine Hours Out', 'Engine Hours In', 'Total Engine Hours', 'Idle Hours', 'Moving Hours']);
    y = darFieldRow(doc, lx, y, ffw, ['Total Miles', 'Gallons Used', 'Miles per Gallon', 'Cost per Mile ($)', 'Miles per Engine Hr']);
    y = darFieldRow(doc, lx, y, ffw, ['Avg Speed (mph)', 'Longest Single Leg (mi)', 'Idle Events > 10 min', 'Hard Brake / Accel Events']);
    y = darFieldRow(doc, lx, y, ffw, ['Odometer Photo Taken (Y/N)', 'GPS / AVL Miles (system)', 'Variance vs Odometer', 'Variance Explained To']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ═══ PAGE 7 - tally + narrative ════════════════════════════
  y = darPageBreak(doc);
  { const sec = openAutoSection(doc, 'Shift Tally (enter counts)', y); y = sec.contentY + 1;
    y = blankTallyGrid(doc, lx, y, ffw, [
      'CFS Handled', 'Incid. Rpts', 'Citations', 'Tresp. Warns',
      'Arrests', 'Use of Force', 'Alarms', 'Escorts',
      'Patrol Rnds', 'Doors/Gates', 'Persons Cont.', 'Vehicles Chk',
      'BWC Videos', 'Photos', 'LE Assists', 'Total Miles',
    ], 8);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Shift Narrative & Notable Events', y); y = sec.contentY;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(sanitizePdfText('Chronological account of the shift. Reference CFS and report numbers rather than repeating their detail. Continue on a supplemental sheet if needed.'), lx, y + 2.5);
    y = darLines(doc, lx, y + 3, ffw, 18);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Safety Concerns, Hazards & Suspicious Activity', y); y = sec.contentY;
    y = darLines(doc, lx, y + 1, ffw, 5);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ═══ PAGE 7 - maintenance, pass-down, records, sign-off ════
  y = darPageBreak(doc);
  { const sec = openAutoSection(doc, 'Equipment, Vehicle & Facility Issues - Maintenance Requested', y); y = sec.contentY;
    y = darLines(doc, lx, y + 1, ffw, 5);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Pass-Down to Next Shift / Follow-Up Required', y); y = sec.contentY;
    y = darLines(doc, lx, y + 1, ffw, 7);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ═══ RECORDS ═══════════════════════════════════════════════
  // Closes the paper-to-system loop: without it a handwritten sheet can sit in
  // a clipboard for days with nobody able to tell what was keyed and what wasn't.
  { const sec = openAutoSection(doc, 'RMPG Flex Data Entry (records use)', y); y = sec.contentY + 1;
    y = blankCheckboxRow(doc, ['CFS entered', 'Incident reports entered', 'Citations entered', 'Mileage / fuel entered'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Patrol scans synced', 'Photos / BWC uploaded', 'Evidence logged', 'DAR submitted in Flex'], lx, y, lx + ffw);
    y = darFieldRow(doc, lx, y + 1, ffw, ['Entered By', 'Date / Time Entered', 'Flex DAR #', 'Discrepancies Found (Y/N)']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Certification & supervisor review ─────────────────────
  { const sec = openAutoSection(doc, 'Certification & Supervisor Review', y); y = sec.contentY;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    // Wrap to the content width — a single doc.text() call does NOT wrap, it
    // just runs off the page and over whatever is to the right.
    const certLines = doc.splitTextToSize(
      sanitizePdfText('I certify that the information recorded on this Daily Activity Report - including all times, odometer readings, inspection results and call dispositions - is true, complete and accurate to the best of my knowledge.'),
      ffw,
    ) as string[];
    certLines.forEach((line, i) => doc.text(line, lx, y + 2.5 + i * 3.4));
    y += certLines.length * 3.4 + 8;

    doc.setDrawColor(...COLOR.TEXT_PRIMARY); doc.setLineWidth(BORDER.SIGNATURE_LINE);
    doc.line(lx, y, lx + ffw * 0.55, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('REPORTING OFFICER SIGNATURE', lx, y + 3);
    darField(doc, 'Date / Time Submitted', lx + ffw * 0.6, y - 7, ffw * 0.4);
    y += 6;
    darField(doc, 'Printed Name', lx, y, w3 - 2);
    darField(doc, 'Badge #', lx + w3, y, w3 - 2);
    y = darField(doc, 'Employee ID', lx + w3 * 2, y, w3 - 2);
    y += 3;

    y = blankCheckboxRow(doc, ['Approved', 'Returned for correction', 'Mileage verified', 'CAD times verified', 'Inspection reviewed'], lx, y, lx + ffw);
    doc.setDrawColor(...COLOR.TEXT_PRIMARY); doc.setLineWidth(BORDER.SIGNATURE_LINE);
    doc.line(lx, y + 6, lx + ffw * 0.55, y + 6);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('SUPERVISOR SIGNATURE', lx, y + 9);
    darField(doc, 'Review Date / Time', lx + ffw * 0.6, y - 1, ffw * 0.4);
    y += 12;
    y = darBand(doc, 'Supervisor comments', lx, y);
    y = darLines(doc, lx, y + 1, ffw, 4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  return y;
}

function blankGenericForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number, title: string): number {
  { const sec = openAutoSection(doc, title, y); y = sec.contentY;
    y = blankField(doc, 'Date', lx, y, ffw * 0.3);
    blankField(doc, 'Time', lx + ffw * 0.3, y - 7.5, ffw * 0.2);
    blankField(doc, 'Officer', lx + ffw * 0.5, y - 7.5, ffw * 0.5);
    y = blankField(doc, 'Location', lx, y, ffw);
    y = blankField(doc, 'Description', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Details', y); y = sec.contentY;
    for (let i = 0; i < 20; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5); y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

// ── Shared helpers for the service + communications log forms ───────────────




// ── Process Service forms (category: service) ───────────────────────────────

function blankServeAffidavitForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Court / Case', y); y = sec.contentY;
    y = blankField(doc, 'Court / Jurisdiction', lx, y, ffw);
    y = blankField(doc, 'Case Number', lx, y, ffw * 0.4);
    blankField(doc, 'Plaintiff / Petitioner', lx + ffw * 0.4, y - 7.5, ffw * 0.6);
    y = blankField(doc, 'Defendant / Respondent', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Document(s) Served', y); y = sec.contentY;
    y = blankField(doc, 'Document(s) (Summons, Subpoena, Complaint, etc.)', lx, y, ffw);
    y = blankField(doc, 'Issued / Filed Date', lx, y, hfw);
    blankField(doc, 'Fee', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Service', y); y = sec.contentY;
    y = blankField(doc, 'Served Upon (Name)', lx, y, ffw * 0.6);
    blankField(doc, 'Relationship to Party', lx + ffw * 0.6, y - 7.5, ffw * 0.4);
    y = blankField(doc, 'Address of Service', lx, y, ffw);
    y = blankField(doc, 'Date of Service', lx, y, ffw * 0.34);
    blankField(doc, 'Time', lx + ffw * 0.34, y - 7.5, ffw * 0.22);
    blankField(doc, 'County / State', lx + ffw * 0.56, y - 7.5, ffw * 0.44);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(FONT.SIZE_FIELD_LABEL); doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('MANNER OF SERVICE', lx + 0.5, y + 2); y += 4;
    y = blankCheckboxRow(doc, ['Personal', 'Substituted (resident 18+)', 'Posted', 'Certified Mail', 'Refused / Left in presence'], lx, y, lx + ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Person Served — Description', y); y = sec.contentY;
    y = blankField(doc, 'Sex', lx, y, ffw * 0.16);
    blankField(doc, 'Race', lx + ffw * 0.16, y - 7.5, ffw * 0.16);
    blankField(doc, 'Age', lx + ffw * 0.32, y - 7.5, ffw * 0.14);
    blankField(doc, 'Height', lx + ffw * 0.46, y - 7.5, ffw * 0.16);
    blankField(doc, 'Weight', lx + ffw * 0.62, y - 7.5, ffw * 0.16);
    blankField(doc, 'Hair', lx + ffw * 0.78, y - 7.5, ffw * 0.22);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Server / Affiant', y); y = sec.contentY;
    y = blankField(doc, 'Process Server (Print Name)', lx, y, ffw * 0.6);
    blankField(doc, 'Server License / ID #', lx + ffw * 0.6, y - 7.5, ffw * 0.4);
    y += 8;
    doc.setDrawColor(...COLOR.TEXT_PRIMARY); doc.setLineWidth(BORDER.SIGNATURE_LINE);
    doc.line(lx, y, lx + ffw * 0.6, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL); doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('SIGNATURE OF SERVER', lx, y + 3); y += 10;
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.text('Subscribed and sworn to before me this ____ day of ____________, 20____', lx, y); y += 9;
    doc.setDrawColor(...COLOR.TEXT_PRIMARY); doc.setLineWidth(BORDER.SIGNATURE_LINE);
    doc.line(lx, y, lx + ffw * 0.55, y);
    blankField(doc, 'Commission Expires', lx + ffw * 0.6, y - 5.5, ffw * 0.4);
    doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL); doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('NOTARY PUBLIC', lx, y + 3); y += 8;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankServiceAttemptLogForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Service Assignment', y); y = sec.contentY;
    y = blankField(doc, 'Case Number', lx, y, ffw * 0.4);
    blankField(doc, 'Document(s)', lx + ffw * 0.4, y - 7.5, ffw * 0.6);
    y = blankField(doc, 'Recipient / Party to Serve', lx, y, ffw * 0.6);
    blankField(doc, 'Client / Requestor', lx + ffw * 0.6, y - 7.5, ffw * 0.4);
    y = blankField(doc, 'Service Address', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Attempts', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: '#', frac: 0.06 }, { label: 'Date', frac: 0.16 }, { label: 'Time', frac: 0.12 },
      { label: 'Address / Location', frac: 0.34 }, { label: 'Result', frac: 0.20 }, { label: 'Server', frac: 0.12 },
    ], 10);
    y += 1;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL); doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('Result codes: S = Served · NS = Not Served · NA = No Answer · REF = Refused · MV = Moved / Vacant · BAD = Bad Address', lx, y + 3); y += 6;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankNonServiceForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Case / Recipient', y); y = sec.contentY;
    y = blankField(doc, 'Court / Jurisdiction', lx, y, ffw);
    y = blankField(doc, 'Case Number', lx, y, ffw * 0.4);
    blankField(doc, 'Document(s)', lx + ffw * 0.4, y - 7.5, ffw * 0.6);
    y = blankField(doc, 'Recipient / Party', lx, y, ffw * 0.6);
    blankField(doc, 'Last Known Address', lx + ffw * 0.6, y - 7.5, ffw * 0.4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Reason Not Served', y); y = sec.contentY;
    y = blankCheckboxRow(doc, ['Moved / Unknown', 'Vacant', 'Insufficient Address', 'Refused', 'Evading Service', 'Deceased', 'Unable to Locate', 'Other'], lx, y, lx + ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Attempts Made', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: '#', frac: 0.06 }, { label: 'Date', frac: 0.18 }, { label: 'Time', frac: 0.14 },
      { label: 'Address / Location', frac: 0.40 }, { label: 'Result', frac: 0.22 },
    ], 5);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Due-Diligence Narrative', y); y = sec.contentY;
    for (let i = 0; i < 10; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5); y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

// ── Communications forms (category: communications) ─────────────────────────

function blankRadioLogForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Log Header', y); y = sec.contentY;
    y = blankField(doc, 'Date', lx, y, ffw * 0.28);
    blankField(doc, 'Shift', lx + ffw * 0.28, y - 7.5, ffw * 0.22);
    blankField(doc, 'Operator / Dispatcher', lx + ffw * 0.5, y - 7.5, ffw * 0.5);
    y = blankField(doc, 'Channel / Talkgroup', lx, y, ffw * 0.5);
    blankField(doc, 'Page ____ of ____', lx + ffw * 0.5, y - 7.5, ffw * 0.5);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Radio Traffic', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Time', frac: 0.12 }, { label: 'Unit', frac: 0.12 }, { label: 'From → To', frac: 0.20 },
      { label: 'Message / Traffic', frac: 0.46 }, { label: 'Disp', frac: 0.10 },
    ], 22, 6.5);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankMessageLogForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Log Header', y); y = sec.contentY;
    y = blankField(doc, 'Date', lx, y, ffw * 0.3);
    blankField(doc, 'Operator', lx + ffw * 0.3, y - 7.5, ffw * 0.4);
    blankField(doc, 'Shift', lx + ffw * 0.7, y - 7.5, ffw * 0.3);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Telephone / Message Log', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Time', frac: 0.12 }, { label: 'Caller / From', frac: 0.24 }, { label: 'Phone', frac: 0.18 },
      { label: 'Message', frac: 0.30 }, { label: 'Action / Routed To', frac: 0.16 },
    ], 18, 6.5);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

function blankBoloBroadcastForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'BOLO Details', y); y = sec.contentY;
    y = blankCheckboxRow(doc, ['Person', 'Vehicle', 'Property', 'Suspect', 'Missing Person'], lx, y, lx + ffw);
    y = blankField(doc, 'Priority', lx, y, ffw * 0.2);
    blankField(doc, 'Originating Officer / Agency', lx + ffw * 0.2, y - 7.5, ffw * 0.5);
    blankField(doc, 'Reference / Case #', lx + ffw * 0.7, y - 7.5, ffw * 0.3);
    y = blankField(doc, 'Date / Time Issued', lx, y, hfw);
    blankField(doc, 'Expires', rx, y - 7.5, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Subject Description', y); y = sec.contentY;
    y = blankField(doc, 'Name / Alias', lx, y, ffw * 0.6);
    blankField(doc, 'DOB', lx + ffw * 0.6, y - 7.5, ffw * 0.4);
    y = blankField(doc, 'Sex', lx, y, ffw * 0.16);
    blankField(doc, 'Race', lx + ffw * 0.16, y - 7.5, ffw * 0.16);
    blankField(doc, 'Height', lx + ffw * 0.32, y - 7.5, ffw * 0.16);
    blankField(doc, 'Weight', lx + ffw * 0.48, y - 7.5, ffw * 0.16);
    blankField(doc, 'Hair / Eyes', lx + ffw * 0.64, y - 7.5, ffw * 0.36);
    y = blankField(doc, 'Clothing / Distinguishing Features', lx, y, ffw);
    y = blankCheckboxRow(doc, ['Armed', 'Dangerous', 'Caution', 'Do Not Approach'], lx, y, lx + ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Vehicle (if applicable)', y); y = sec.contentY;
    y = blankField(doc, 'Year', lx, y, ffw * 0.12);
    blankField(doc, 'Make', lx + ffw * 0.12, y - 7.5, ffw * 0.2);
    blankField(doc, 'Model', lx + ffw * 0.32, y - 7.5, ffw * 0.2);
    blankField(doc, 'Color', lx + ffw * 0.52, y - 7.5, ffw * 0.16);
    blankField(doc, 'Plate', lx + ffw * 0.68, y - 7.5, ffw * 0.2);
    blankField(doc, 'State', lx + ffw * 0.88, y - 7.5, ffw * 0.12);
    y = blankField(doc, 'Direction of Travel / Last Seen', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Reason / Caution', y); y = sec.contentY;
    for (let i = 0; i < 6; i++) {
      doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(lx, y + 5, lx + ffw, y + 5); y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Broadcast', y); y = sec.contentY;
    y = blankField(doc, 'Broadcast By', lx, y, hfw);
    blankField(doc, 'Time Aired', rx, y - 7.5, hfw);
    y = blankField(doc, 'Channels / Agencies Notified', lx, y, ffw);
    y = blankField(doc, 'Cancelled — Date / Time / By', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}
