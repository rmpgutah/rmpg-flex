// ============================================================
// RMPG Flex — Blank Printable Form Generator
// Generates empty PDF forms matching the CFS report style
// for officers to fill in by hand during field operations
// ============================================================

import jsPDF from 'jspdf';
import { FORM_NUMBERS } from './pdfAssets';
import {
  COLOR, FONT, BORDER, SPACING, LAYOUT,
  getContentWidth, getLeftX, getRightColumnX,
  getHalfFieldWidth, getFullFieldWidth,
} from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';
import { openAutoSection, closeAutoSection, addCheckboxField, addConfidentialWatermark, addPageFooter, setActiveCaseNumber, setActiveFormKey } from './pdfGenerator';

// All blank form definitions
export interface BlankFormDef {
  id: string;
  name: string;
  formNumber: string;
  description: string;
  category: 'incident' | 'record' | 'operations' | 'administrative';
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
  { id: 'daily_activity', name: 'Daily Activity Report', formNumber: FORM_NUMBERS.daily_activity, description: 'Shift activity log', category: 'operations' },
  { id: 'patrol_tracking', name: 'Patrol Tracking Report', formNumber: FORM_NUMBERS.patrol_tracking, description: 'Patrol route & activity log', category: 'operations' },
  // Administrative
  { id: 'invoice', name: 'Invoice', formNumber: FORM_NUMBERS.invoice, description: 'Client billing invoice', category: 'administrative' },
];

/** Generate a blank form PDF with empty fields for handwriting */
export function generateBlankForm(formId: string): jsPDF {
  const form = BLANK_FORMS.find(f => f.id === formId);
  if (!form) throw new Error(`Unknown form: ${formId}`);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const ffw = getFullFieldWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const cw = getContentWidth(doc);

  setActiveFormKey(formId);
  setActiveCaseNumber('');

  // Watermark
  addConfidentialWatermark(doc);
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  // Header
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: form.name.toUpperCase(),
    formNumber: form.formNumber,
    caseNumber: '________________',
    reportDate: '____/____/________',
  });

  // Generate blank sections based on form type
  switch (formId) {
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
    default:
      y = blankGenericForm(doc, y, lx, rx, ffw, hfw, cw, form.name);
      break;
  }

  // Signature block at bottom
  y = addBlankSignatureBlock(doc, y, lx, ffw);

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages);
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

function blankField(doc: jsPDF, label: string, x: number, y: number, w: number): number {
  const lineY = y + 5.5;
  // Label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(label.toUpperCase(), x + 0.5, y + 2);
  // Underline for writing
  doc.setDrawColor(...COLOR.BORDER_TABLE);
  doc.setLineWidth(BORDER.TABLE_ROW);
  doc.line(x, lineY, x + w, lineY);
  return lineY + 2;
}

function blankCheckbox(doc: jsPDF, label: string, x: number, y: number): number {
  return addCheckboxField(doc, label, false, x, y);
}

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

function blankDailyActivityForm(doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number): number {
  { const sec = openAutoSection(doc, 'Shift Information', y); y = sec.contentY;
    y = blankField(doc, 'Officer Name', lx, y, hfw);
    blankField(doc, 'Badge #', rx, y - 7.5, hfw);
    const w4 = ffw / 4;
    y = blankField(doc, 'Date', lx, y, w4);
    blankField(doc, 'Shift Start', lx + w4, y - 7.5, w4);
    blankField(doc, 'Shift End', lx + w4 * 2, y - 7.5, w4);
    blankField(doc, 'Total Hours', lx + w4 * 3, y - 7.5, w4);
    y = blankField(doc, 'Section', lx, y, ffw / 3);
    blankField(doc, 'Zone', lx + ffw / 3, y - 7.5, ffw / 3);
    blankField(doc, 'Beat', lx + ffw * 2 / 3, y - 7.5, ffw / 3);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  { const sec = openAutoSection(doc, 'Activity Log', y); y = sec.contentY;
    // Table header
    doc.setFillColor(...COLOR.BG_ZEBRA);
    doc.rect(lx, y, ffw, 4.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(FONT.SIZE_FIELD_LABEL); doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('TIME', lx + 1.5, y + 3);
    doc.text('ACTIVITY / CALL #', lx + ffw * 0.15 + 1.5, y + 3);
    doc.text('LOCATION', lx + ffw * 0.55 + 1.5, y + 3);
    doc.text('DISPOSITION', lx + ffw * 0.8 + 1.5, y + 3);
    doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
    doc.line(lx, y + 4.5, lx + ffw, y + 4.5);
    y += 4.5;
    for (let i = 0; i < 20; i++) { y += 5; doc.line(lx, y, lx + ffw, y); }
    y += 2;
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
