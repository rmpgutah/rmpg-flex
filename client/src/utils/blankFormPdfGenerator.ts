// ============================================================
// RMPG Flex — Blank Printable Field Forms Generator
// Generates empty PDF forms officers can fill out by hand
// in the field and input into the system later.
// Reuses helpers from pdfGenerator.ts + pdfTokens.ts
// ============================================================

import jsPDF from 'jspdf';
import {
  openAutoSection,
  closeAutoSection,
  addFieldPair,
  addCheckboxField,
  addSignatureBlock,
  addStackedSignatures,
  addPageFooter,
  checkPageBreak,
  loadPdfAssets,
  fetchPdfBranding,
  setActiveBranding,
  setActiveFormKey,
  setActiveCaseNumber,
  setGenerationTimestamp,
  sanitizePdfText,
  finalizePoliceReport,
} from './pdfGenerator';
import {
  LAYOUT, SPACING, FONT, COLOR, BORDER,
  PDF_VALUE_FONT,
  getContentWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth,
  getThirdWidth, getQuarterWidth,
} from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';
import { FORM_REVISION } from './pdfAssets';

// ── Types ────────────────────────────────────────────────────

export type BlankFormType =
  | 'incident'
  | 'person'
  | 'vehicle'
  | 'property'
  | 'citation'
  | 'field_interview'
  | 'fleet_pre_trip'
  | 'fleet_checkout'
  | 'fleet_damage'
  | 'fleet_fuel_voucher'
  | 'fleet_fuel_log'
  | 'fleet_expense';

export interface BlankFormConfig {
  type: BlankFormType;
  label: string;
  formNumber: string;
  formTitle: string;
}

export const BLANK_FORMS: BlankFormConfig[] = [
  { type: 'incident',        label: 'Incident Report',  formNumber: 'FORM PS-205-BLK', formTitle: 'INCIDENT REPORT' },
  { type: 'person',          label: 'Person Record',    formNumber: 'FORM PS-206-BLK', formTitle: 'PERSON RECORD' },
  { type: 'vehicle',         label: 'Vehicle Record',   formNumber: 'FORM PS-207-BLK', formTitle: 'VEHICLE RECORD' },
  { type: 'property',        label: 'Property Record',  formNumber: 'FORM PS-208-BLK', formTitle: 'PROPERTY RECORD' },
  { type: 'citation',        label: 'Citation',         formNumber: 'FORM PS-209-BLK', formTitle: 'CITATION' },
  { type: 'field_interview', label: 'Field Interview',  formNumber: 'FORM PS-211-BLK', formTitle: 'FIELD INTERVIEW CARD' },
  // Fleet operational forms (printable blank, filled in the field)
  { type: 'fleet_pre_trip',  label: 'Pre-Trip Inspection', formNumber: 'FORM PS-206-PTI', formTitle: 'PRE-TRIP VEHICLE INSPECTION' },
  { type: 'fleet_checkout',  label: 'Vehicle Check-Out',   formNumber: 'FORM PS-206-CKO', formTitle: 'FLEET VEHICLE CHECK-OUT' },
  { type: 'fleet_damage',    label: 'Fleet Damage Report', formNumber: 'FORM PS-206-DMG', formTitle: 'FLEET VEHICLE DAMAGE REPORT' },
  // Fleet fuel + expense blanks
  { type: 'fleet_fuel_voucher', label: 'Fuel Voucher',          formNumber: 'FORM PS-206-FV',  formTitle: 'FLEET FUEL PURCHASE VOUCHER' },
  { type: 'fleet_fuel_log',     label: 'Fuel Log Sheet',        formNumber: 'FORM PS-206-FL',  formTitle: 'FLEET FUEL LOG SHEET' },
  { type: 'fleet_expense',      label: 'Expense Reimbursement', formNumber: 'FORM PS-206-EXP', formTitle: 'FLEET EXPENSE REIMBURSEMENT' },
];

// ── Helpers ──────────────────────────────────────────────────

/** Draw horizontal writing lines for handwritten narrative areas */
function addLinedArea(doc: jsPDF, y: number, lineCount: number, indent = 0): number {
  const lx = getLeftX() + indent;
  const ffw = getFullFieldWidth(doc) - indent;
  const lineGap = 8; // spacing between lines for handwriting
  // Check for at least 3 lines or the full block, whichever is smaller
  const minCheckH = Math.min(lineCount * lineGap, lineGap * 3 + 4);
  y = checkPageBreak(doc, y, minCheckH);
  doc.setDrawColor(...COLOR.BORDER_FIELD);
  doc.setLineWidth(BORDER.FIELD);
  for (let i = 0; i < lineCount; i++) {
    y = checkPageBreak(doc, y, lineGap + LAYOUT.FOOTER_HEIGHT);
    doc.line(lx, y, lx + ffw, y);
    y += lineGap;
  }
  return y;
}

/** Add a row of 2 empty field pairs */
function row2(doc: jsPDF, l1: string, l2: string, y: number): number {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const y1 = addFieldPair(doc, l1, '', lx, y, hfw);
  const y2 = addFieldPair(doc, l2, '', rx, y, hfw);
  return Math.max(y1, y2);
}

/** Add a row of 3 empty field pairs */
function row3(doc: jsPDF, l1: string, l2: string, l3: string, y: number): number {
  const lx = getLeftX();
  const tw = getThirdWidth(doc);
  const y1 = addFieldPair(doc, l1, '', lx, y, tw);
  const y2 = addFieldPair(doc, l2, '', lx + tw, y, tw);
  const y3 = addFieldPair(doc, l3, '', lx + tw * 2, y, tw);
  return Math.max(y1, y2, y3);
}

/** Add a row of 4 empty field pairs */
function row4(doc: jsPDF, l1: string, l2: string, l3: string, l4: string, y: number): number {
  const lx = getLeftX();
  const qw = getQuarterWidth(doc);
  const gap = SPACING.MD;
  const y1 = addFieldPair(doc, l1, '', lx, y, qw);
  const y2 = addFieldPair(doc, l2, '', lx + qw + gap, y, qw);
  const y3 = addFieldPair(doc, l3, '', lx + qw * 2 + gap * 2, y, qw);
  const y4 = addFieldPair(doc, l4, '', lx + qw * 3 + gap * 3, y, qw);
  return Math.max(y1, y2, y3, y4);
}

/** Full-width empty field pair */
function rowFull(doc: jsPDF, label: string, y: number): number {
  return addFieldPair(doc, label, '', getLeftX(), y, getFullFieldWidth(doc));
}

/** Add a row of checkboxes (horizontally) */
function addCheckboxRow(doc: jsPDF, labels: string[], y: number): number {
  let x = getLeftX();
  const maxX = getLeftX() + getFullFieldWidth(doc);
  const rowH = 5;
  for (const label of labels) {
    const safeLabel = sanitizePdfText(label);
    const nextX = addCheckboxField(doc, safeLabel, false, x, y);
    if (nextX > maxX && x > getLeftX()) {
      // Wrap to next line
      y += rowH;
      y = checkPageBreak(doc, y, rowH + LAYOUT.FOOTER_HEIGHT);
      x = getLeftX();
      x = addCheckboxField(doc, safeLabel, false, x, y);
    } else {
      x = nextX;
    }
  }
  return y + rowH;
}

/** Watermark: "BLANK FORM — FOR FIELD USE" */
function addBlankFormWatermark(doc: jsPDF) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(48);
  doc.setTextColor(0, 0, 0);
  doc.text('BLANK FORM', pageW / 2, pageH / 2 - 10, { align: 'center', angle: 45 });
  doc.setFontSize(20);
  doc.text('FOR FIELD USE', pageW / 2, pageH / 2 + 10, { align: 'center', angle: 45 });
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));
}

// ── Form Generators ──────────────────────────────────────────

function generateBlankIncidentForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-205-BLK');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'INCIDENT REPORT',
    formNumber: 'FORM PS-205-BLK',
    reportDate: '',
  });

  // Classification
  { const sec = openAutoSection(doc, 'Classification', y); y = sec.contentY;
    y = row3(doc, 'Incident Type', 'Priority', 'Status', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Date / Time / Location
  { const sec = openAutoSection(doc, 'Date, Time & Location', y); y = sec.contentY;
    y = row4(doc, 'Occurred Date', 'Occurred Time', 'End Date', 'End Time', y);
    y = rowFull(doc, 'Location Address', y);
    y = row3(doc, 'Section', 'Zone', 'Beat', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Scene Details
  { const sec = openAutoSection(doc, 'Scene Details', y); y = sec.contentY;
    y = row3(doc, 'Weather Conditions', 'Lighting Conditions', 'Weapons Involved', y);
    y = row2(doc, 'Damage Estimate', 'Injury Description', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Operational Flags
  { const sec = openAutoSection(doc, 'Operational Flags', y); y = sec.contentY;
    const flags = [
      'Alcohol Involved', 'Drugs Involved', 'Domestic Violence', 'Injuries Reported',
      'Mental Health Crisis', 'Juvenile Involved', 'Felony in Progress', 'Officer Safety',
      'K9 Requested', 'EMS Requested', 'Fire Requested', 'HAZMAT',
      'Gang Related', 'Evidence Collected', 'Body Camera Active', 'Photos Taken',
      'Trespass Issued', 'Vehicle Pursuit', 'Foot Pursuit', 'LE Notified',
    ];
    // 4-column checkbox grid
    const lx = getLeftX();
    const colW = getFullFieldWidth(doc) / 4;
    for (let r = 0; r < flags.length; r += 4) {
      y = checkPageBreak(doc, y, 6);
      for (let c = 0; c < 4 && r + c < flags.length; c++) {
        addCheckboxField(doc, flags[r + c], false, lx + c * colW, y);
      }
      y += 5;
    }
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Linked Records
  { const sec = openAutoSection(doc, 'Linked Records', y); y = sec.contentY;
    y = row3(doc, 'Call Number', 'Responding LE Agency', 'LE Case Number', y);
    y = row3(doc, 'Client / Property', 'Contract ID', 'Disposition', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Narrative
  y = checkPageBreak(doc, y, 40);
  { const sec = openAutoSection(doc, 'Narrative / Report', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 30);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signatures
  y = checkPageBreak(doc, y, 60);
  y = addStackedSignatures(doc, 'Reporting Officer', 'Supervisor Review', y);
}

function generateBlankPersonForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-206-BLK');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'PERSON RECORD',
    formNumber: 'FORM PS-206-BLK',
    reportDate: '',
  });

  // Identity
  { const sec = openAutoSection(doc, 'Identity', y); y = sec.contentY;
    y = row3(doc, 'Last Name', 'First Name', 'Middle Name', y);
    y = row3(doc, 'Date of Birth', 'Place of Birth', 'Alias / Nickname', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Physical Description
  { const sec = openAutoSection(doc, 'Physical Description', y); y = sec.contentY;
    y = row4(doc, 'Gender', 'Race', 'Height', 'Weight', y);
    y = row4(doc, 'Build', 'Complexion', 'Hair Color', 'Eye Color', y);
    y = row3(doc, 'Facial Hair', 'Glasses', 'Hair Style', y);
    y = rowFull(doc, 'Scars / Marks / Tattoos', y);
    y = rowFull(doc, 'Clothing Description', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Contact Information
  { const sec = openAutoSection(doc, 'Contact Information', y); y = sec.contentY;
    y = row3(doc, 'Phone', 'Secondary Phone', 'Email', y);
    y = rowFull(doc, 'Street Address', y);
    y = row3(doc, 'City', 'State', 'ZIP', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Identification
  y = checkPageBreak(doc, y, 30);
  { const sec = openAutoSection(doc, 'Identification', y); y = sec.contentY;
    y = row4(doc, 'DL Number', 'DL State', 'DL Class', 'DL Expiry', y);
    y = row3(doc, 'Alt ID Type', 'Alt ID Number', 'Alt ID State', y);
    y = row2(doc, 'SSN (Last 4)', 'Citizenship', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Employment
  { const sec = openAutoSection(doc, 'Employment & Demographics', y); y = sec.contentY;
    y = row3(doc, 'Employer', 'Occupation', 'Language', y);
    y = row2(doc, 'Marital Status', 'Social Media', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Flags
  { const sec = openAutoSection(doc, 'Flags & Status', y); y = sec.contentY;
    const lx = getLeftX();
    const colW = getFullFieldWidth(doc) / 4;
    addCheckboxField(doc, 'Sex Offender', false, lx, y);
    addCheckboxField(doc, 'Veteran', false, lx + colW, y);
    addCheckboxField(doc, 'Gang Affiliation', false, lx + colW * 2, y);
    addCheckboxField(doc, 'Probation/Parole', false, lx + colW * 3, y);
    y += 6;
    y = row2(doc, 'Gang Affiliation Details', 'Probation/Parole Officer', y);
    y = rowFull(doc, 'Caution Flags / Known Associates', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Emergency Contact
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, 'Emergency Contact', y); y = sec.contentY;
    y = row3(doc, 'Contact Name', 'Phone', 'Relationship', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Notes
  { const sec = openAutoSection(doc, 'Notes', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 10);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signature
  y = checkPageBreak(doc, y, 30);
  y = addSignatureBlock(doc, 'Recording Officer', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
}

function generateBlankVehicleForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-207-BLK');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'VEHICLE RECORD',
    formNumber: 'FORM PS-207-BLK',
    reportDate: '',
  });

  // Registration
  { const sec = openAutoSection(doc, 'Registration', y); y = sec.contentY;
    y = row3(doc, 'License Plate', 'State', 'Plate Type', y);
    y = row3(doc, 'Make', 'Model', 'Year', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Vehicle Description
  { const sec = openAutoSection(doc, 'Vehicle Description', y); y = sec.contentY;
    y = row3(doc, 'Body Style', 'Primary Color', 'Secondary Color', y);
    y = rowFull(doc, 'VIN', y);
    y = row3(doc, 'Doors', 'Trim', 'Odometer', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Mechanical
  { const sec = openAutoSection(doc, 'Mechanical', y); y = sec.contentY;
    y = row4(doc, 'Engine Type', 'Fuel Type', 'Transmission', 'Drive Type', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Registration & Insurance
  { const sec = openAutoSection(doc, 'Registration & Insurance', y); y = sec.contentY;
    y = row3(doc, 'Registration Expiry', 'Insurance Company', 'Policy Number', y);
    const lx = getLeftX();
    const colW = getFullFieldWidth(doc) / 4;
    addCheckboxField(doc, 'Commercial Vehicle', false, lx, y);
    addCheckboxField(doc, 'HAZMAT', false, lx + colW, y);
    y += 6;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Ownership
  { const sec = openAutoSection(doc, 'Ownership', y); y = sec.contentY;
    y = row3(doc, 'Owner Address', 'Owner Phone', 'Lien Holder', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Tow Information
  { const sec = openAutoSection(doc, 'Tow Information', y); y = sec.contentY;
    y = row3(doc, 'Tow Status', 'Tow Company', 'Tow Date', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Stolen Status
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, 'Stolen Status', y); y = sec.contentY;
    y = row3(doc, 'Stolen Status', 'Stolen Date', 'Recovery Date', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Damage / Notes
  { const sec = openAutoSection(doc, 'Damage & Notes', y); y = sec.contentY;
    y = rowFull(doc, 'Distinguishing Features', y);
    y += SPACING.SM;
    y = addLinedArea(doc, y, 8);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signature
  y = checkPageBreak(doc, y, 30);
  y = addSignatureBlock(doc, 'Recording Officer', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
}

function generateBlankPropertyForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-208-BLK');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'PROPERTY RECORD',
    formNumber: 'FORM PS-208-BLK',
    reportDate: '',
  });

  // Location
  { const sec = openAutoSection(doc, 'Property Location', y); y = sec.contentY;
    y = rowFull(doc, 'Property Name', y);
    y = rowFull(doc, 'Street Address', y);
    y = row3(doc, 'City', 'State', 'ZIP', y);
    y = row2(doc, 'Property Type', 'Client', y);
    y = row2(doc, 'Latitude', 'Longitude', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Security & Access
  { const sec = openAutoSection(doc, 'Security & Access', y); y = sec.contentY;
    y = row2(doc, 'Gate Code', 'Alarm Code', y);
    y = rowFull(doc, 'Emergency Contact', y);
    y = rowFull(doc, 'Access Instructions', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Post Orders
  { const sec = openAutoSection(doc, 'Post Orders', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 12);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Hazard Notes
  { const sec = openAutoSection(doc, 'Hazard Notes', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 6);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Notes
  { const sec = openAutoSection(doc, 'Additional Notes', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 8);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signature
  y = checkPageBreak(doc, y, 30);
  y = addSignatureBlock(doc, 'Recording Officer', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
}

function generateBlankCitationForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-209-BLK');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'CITATION',
    formNumber: 'FORM PS-209-BLK',
    reportDate: '',
  });

  // Citation Info
  { const sec = openAutoSection(doc, 'Citation Information', y); y = sec.contentY;
    y = row3(doc, 'Citation Number', 'Type (Traffic/Criminal/Parking/Warning)', 'Status', y);
    y = row3(doc, 'Violation Date', 'Violation Time', 'Offense Level', y);
    y = rowFull(doc, 'Location', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Subject
  { const sec = openAutoSection(doc, 'Subject', y); y = sec.contentY;
    y = row3(doc, 'Full Name', 'Date of Birth', 'DL Number', y);
    y = rowFull(doc, 'Address', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Vehicle
  { const sec = openAutoSection(doc, 'Vehicle Information', y); y = sec.contentY;
    y = row3(doc, 'License Plate', 'State', 'Vehicle Description (Year/Make/Model/Color)', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Violation
  { const sec = openAutoSection(doc, 'Violation Details', y); y = sec.contentY;
    y = row2(doc, 'Statute / Code', 'Fine Amount', y);
    y = rowFull(doc, 'Violation Description', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Court
  y = checkPageBreak(doc, y, 25);
  { const sec = openAutoSection(doc, 'Court Information', y); y = sec.contentY;
    y = row2(doc, 'Court Date', 'Court Name', y);
    y = rowFull(doc, 'Court Address', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Notes
  { const sec = openAutoSection(doc, 'Notes', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 12);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signatures — officer + subject
  y = checkPageBreak(doc, y, 60);
  y = addSignatureBlock(doc, 'Issuing Officer', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
  y = checkPageBreak(doc, y, 30);
  y = addSignatureBlock(doc, 'Subject Acknowledgment', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
}

function generateBlankFieldInterviewForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-211-BLK');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'FIELD INTERVIEW CARD',
    formNumber: 'FORM PS-211-BLK',
    reportDate: '',
  });

  // Contact Details
  { const sec = openAutoSection(doc, 'Contact Details', y); y = sec.contentY;
    y = row3(doc, 'Date', 'Time', 'Location', y);
    y = row3(doc, 'Contact Reason', 'Contact Type', 'Action Taken', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Subject
  { const sec = openAutoSection(doc, 'Subject Information', y); y = sec.contentY;
    y = row3(doc, 'First Name', 'Last Name', 'Date of Birth', y);
    y = row4(doc, 'Gender', 'Race', 'Height', 'Weight', y);
    y = row3(doc, 'Hair Color / Style', 'Eye Color', 'Clothing Description', y);
    y = rowFull(doc, 'Additional Physical Description', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Vehicle
  { const sec = openAutoSection(doc, 'Vehicle Information', y); y = sec.contentY;
    y = row2(doc, 'License Plate', 'Vehicle Description (Year/Make/Model/Color)', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Linked Records
  { const sec = openAutoSection(doc, 'Linked Records', y); y = sec.contentY;
    y = row3(doc, 'Person ID', 'Call ID', 'Incident ID', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Narrative
  y = checkPageBreak(doc, y, 40);
  { const sec = openAutoSection(doc, 'Narrative', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 22);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signature
  y = checkPageBreak(doc, y, 30);
  y = addSignatureBlock(doc, 'Interviewing Officer', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
}

// ── Fleet Operational Forms (printable blanks) ────────────────

/**
 * Pre-Trip Inspection — daily driver vehicle check conducted before
 * going into service. Standard police/government fleet requirement.
 * 30+ inspection items across exterior / interior / fluids / emergency.
 */
function generateBlankPreTripForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-206-PTI');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'PRE-TRIP VEHICLE INSPECTION',
    formNumber: 'FORM PS-206-PTI',
    reportDate: '',
  });

  // Header
  { const sec = openAutoSection(doc, 'Inspection Header', y); y = sec.contentY;
    y = row4(doc, 'Date', 'Time', 'Vehicle Unit #', 'Call Sign', y);
    y = row4(doc, 'Officer Name', 'Badge #', 'Starting Odometer', 'Shift', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Exterior Checks
  y = checkPageBreak(doc, y, 40);
  { const sec = openAutoSection(doc, 'Exterior Inspection', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Tires (tread, inflation)', 'Lug nuts tight', 'Headlights', 'Taillights'], y);
    y = addCheckboxRow(doc, ['Brake lights', 'Turn signals', 'Emergency lights', 'Body damage'], y);
    y = addCheckboxRow(doc, ['Mirrors intact', 'License plate legible', 'Windshield', 'Wipers / fluid'], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Interior Checks
  y = checkPageBreak(doc, y, 40);
  { const sec = openAutoSection(doc, 'Interior Inspection', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Seatbelts functional', 'Horn works', 'Steering / brakes', 'Parking brake'], y);
    y = addCheckboxRow(doc, ['Gauges (fuel/temp/oil)', 'AC / heat', 'Defroster', 'Dash cam'], y);
    y = addCheckboxRow(doc, ['Radio / push-to-talk', 'MDT / computer', 'GPS', 'Interior lights'], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Fluids
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, 'Fluid Levels', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Engine oil', 'Brake fluid', 'Coolant', 'Windshield washer'], y);
    y = addCheckboxRow(doc, ['Power steering', 'Transmission fluid', 'Fuel (>1/2 tank)'], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Emergency Equipment
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, 'Emergency Equipment', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Fire extinguisher', 'First-aid kit', 'Road flares / cones', 'Biohazard kit'], y);
    y = addCheckboxRow(doc, ['Tire iron / jack', 'Spare tire', 'Blanket', 'Flashlight'], y);
    y = addCheckboxRow(doc, ['AED (if equipped)', 'Tow strap', 'Window breaker', 'Tourniquet'], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Defects / Issues
  y = checkPageBreak(doc, y, 40);
  { const sec = openAutoSection(doc, 'Defects / Issues Noted', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 6);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Disposition
  y = checkPageBreak(doc, y, 16);
  { const sec = openAutoSection(doc, 'Disposition', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Vehicle in service', 'Needs maintenance', 'Out of service', 'Reported to supervisor'], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signature
  y = checkPageBreak(doc, y, 30);
  y = addSignatureBlock(doc, 'Inspecting Officer', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
}

/**
 * Vehicle Check-Out — officer takes custody of a fleet unit.
 * Logs starting condition + fuel + damage + equipment confirmation.
 */
function generateBlankCheckoutForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-206-CKO');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'FLEET VEHICLE CHECK-OUT',
    formNumber: 'FORM PS-206-CKO',
    reportDate: '',
  });

  // Assignment
  { const sec = openAutoSection(doc, 'Assignment', y); y = sec.contentY;
    y = row4(doc, 'Date', 'Time', 'Vehicle Unit #', 'Call Sign', y);
    y = row3(doc, 'Officer Name', 'Badge #', 'Supervisor Approval', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Starting Condition
  { const sec = openAutoSection(doc, 'Starting Condition', y); y = sec.contentY;
    y = row3(doc, 'Starting Odometer', 'Estimated Return', 'Purpose of Use', y);
    y += 1.5;
    y = addCheckboxRow(doc, ['Fuel: Full', '3/4 tank', '1/2 tank', '1/4 tank', 'Empty'], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Pre-Existing Damage
  y = checkPageBreak(doc, y, 32);
  { const sec = openAutoSection(doc, 'Pre-Existing Damage (note before use)', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Equipment Verification
  y = checkPageBreak(doc, y, 28);
  { const sec = openAutoSection(doc, 'Equipment Verified Present', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Radio', 'MDT', 'Body camera', 'Dash camera'], y);
    y = addCheckboxRow(doc, ['Fire extinguisher', 'First-aid kit', 'Less-lethal', 'AED'], y);
    y = addCheckboxRow(doc, ['Patrol bag', 'Shotgun / rifle', 'Keys', 'Fuel card'], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Notes
  y = checkPageBreak(doc, y, 30);
  { const sec = openAutoSection(doc, 'Additional Notes', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signatures
  y = checkPageBreak(doc, y, 30);
  y = addSignatureBlock(doc, 'Receiving Officer', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
}

/**
 * Fleet Damage Report — documents vehicle damage (minor accident,
 * parking lot incident, vandalism, etc.) for fleet management records.
 */
function generateBlankDamageForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-206-DMG');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'FLEET VEHICLE DAMAGE REPORT',
    formNumber: 'FORM PS-206-DMG',
    reportDate: '',
  });

  // Incident Header
  { const sec = openAutoSection(doc, 'Damage Event', y); y = sec.contentY;
    y = row4(doc, 'Date of Damage', 'Time', 'Vehicle Unit #', 'Call Sign', y);
    y = row3(doc, 'Incident / Case #', 'LE Agency Report #', 'Insurance Claim #', y);
    y = rowFull(doc, 'Location of Damage (address / intersection / parking lot)', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Driver / Operator
  { const sec = openAutoSection(doc, 'Driver / Operator', y); y = sec.contentY;
    y = row3(doc, 'Officer Name', 'Badge #', 'POST Cert #', y);
    y = row3(doc, 'Starting Odometer', 'Ending Odometer', 'Speed at Time (MPH)', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Damage Classification
  y = checkPageBreak(doc, y, 28);
  { const sec = openAutoSection(doc, 'Damage Classification', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Collision', 'Parking / Low-speed', 'Vandalism', 'Pursuit-related'], y);
    y = addCheckboxRow(doc, ['Weather / road', 'Animal strike', 'Mechanical failure', 'Other'], y);
    y = addCheckboxRow(doc, ['Minor (cosmetic)', 'Moderate (body/panel)', 'Major (frame/drivable)', 'Total loss'], y);
    y = addCheckboxRow(doc, ['Drivable', 'Towed from scene', 'Airbag deployed', 'Injuries reported'], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Damage Description
  y = checkPageBreak(doc, y, 45);
  { const sec = openAutoSection(doc, 'Damage Description', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 7);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Other Party (if applicable)
  y = checkPageBreak(doc, y, 24);
  { const sec = openAutoSection(doc, 'Other Party (if applicable)', y); y = sec.contentY;
    y = row4(doc, 'Full Name', 'Phone', 'DL #', 'Plate #', y);
    y = row2(doc, 'Insurance Carrier', 'Policy #', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Witnesses
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Witnesses', y); y = sec.contentY;
    y = row3(doc, 'Witness Name', 'Phone', 'Role', y);
    y = row3(doc, 'Witness Name', 'Phone', 'Role', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Photos / Evidence
  y = checkPageBreak(doc, y, 16);
  { const sec = openAutoSection(doc, 'Photos & Evidence Collected', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Scene photos', 'Damage photos (all sides)', 'VIN photo', 'Other-party photos'], y);
    y = addCheckboxRow(doc, ['Dash cam preserved', 'Body cam preserved', 'Insurance exchange', 'Police report filed'], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signatures — officer + supervisor
  y = checkPageBreak(doc, y, 50);
  y = addSignatureBlock(doc, 'Reporting Officer', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
  y = checkPageBreak(doc, y, 30);
  y = addSignatureBlock(doc, 'Fleet Supervisor', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
}

// ── Fleet Fuel + Expense Forms ────────────────────────────────

/**
 * Render an empty ruled table of N rows × M columns for manual entry.
 * Column widths in mm. Used by fuel log / expense forms.
 */
function addEmptyEntryTable(
  doc: jsPDF,
  headers: string[],
  colW: number[],
  rowCount: number,
  y: number,
): number {
  const lx = getLeftX();
  const rowH = 7;
  const headerH = 5.5;
  // Column positions
  const colX: number[] = [];
  { let cx = lx; for (const w of colW) { colX.push(cx); cx += w; } }
  const totalW = colW.reduce((a, b) => a + b, 0);

  y = checkPageBreak(doc, y, headerH + rowCount * rowH + 4);

  // Header row (light slate, matches addTableWithShading)
  doc.setFillColor(...COLOR.BG_TABLE_HDR_LIGHT);
  doc.rect(lx, y, totalW, headerH, 'F');
  doc.setDrawColor(...COLOR.BORDER_TABLE);
  doc.setLineWidth(BORDER.TABLE_ROW);
  doc.rect(lx, y, totalW, headerH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_TABLE_HEADER);
  doc.setTextColor(...COLOR.TEXT_TABLE_HDR_LIGHT);
  const capH = FONT.SIZE_TABLE_HEADER * 0.35;
  const hy = y + (headerH + capH) / 2;
  for (let i = 0; i < headers.length; i++) {
    doc.text(sanitizePdfText(headers[i]).toUpperCase(), colX[i] + 1, hy);
  }
  y += headerH;

  // Ruled empty rows
  doc.setDrawColor(...COLOR.BORDER_TABLE);
  doc.setLineWidth(BORDER.TABLE_ROW);
  for (let r = 0; r < rowCount; r++) {
    // Alt row zebra
    if (r % 2 === 0) {
      doc.setFillColor(...COLOR.BG_ZEBRA);
      doc.rect(lx, y, totalW, rowH, 'F');
    }
    doc.line(lx, y + rowH, lx + totalW, y + rowH);
    y += rowH;
  }

  // Column dividers
  doc.setDrawColor(...COLOR.BORDER_COLUMN);
  doc.setLineWidth(BORDER.TABLE_COLUMN);
  const topY = y - rowCount * rowH - headerH;
  for (let i = 1; i < colX.length; i++) {
    doc.line(colX[i], topY, colX[i], y);
  }
  // Outer
  doc.setDrawColor(...COLOR.BORDER_TABLE);
  doc.setLineWidth(BORDER.TABLE_ROW);
  doc.rect(lx, topY, totalW, rowCount * rowH + headerH);

  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + 2;
}

/**
 * Fuel Voucher — pre-authorization to purchase fuel at an approved
 * station. Carried by officer; presented at fueling. Records the
 * authorized amount + vehicle + card + signature.
 */
function generateBlankFuelVoucherForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-206-FV');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'FLEET FUEL PURCHASE VOUCHER',
    formNumber: 'FORM PS-206-FV',
    reportDate: '',
  });

  // Authorization
  { const sec = openAutoSection(doc, 'Purchase Authorization', y); y = sec.contentY;
    y = row4(doc, 'Voucher #', 'Issue Date', 'Issue Time', 'Valid Through', y);
    y = row3(doc, 'Vehicle Unit #', 'Call Sign', 'Current Odometer', y);
    y = row3(doc, 'Officer Name', 'Badge #', 'Supervisor Approval', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Payment Method
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, 'Payment Method', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Fleet card', 'Purchase card', 'Cash (receipt required)', 'Vendor account'], y);
    y = row3(doc, 'Card / Account Last 4', 'Authorized Amount ($)', 'Fuel Type', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Approved Stations
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Approved Fueling Stations', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Maverik', 'Chevron', 'Holiday', 'Sinclair'], y);
    y = addCheckboxRow(doc, ['Costco', "Smith's Fuel", 'Phillips 66', 'Other (specify below)'], y);
    y = rowFull(doc, 'Other Station (name / address)', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Purchase Record (filled at pump)
  y = checkPageBreak(doc, y, 28);
  { const sec = openAutoSection(doc, 'Purchase Record (fill at pump)', y); y = sec.contentY;
    y = row4(doc, 'Date / Time of Purchase', 'Station', 'Pump #', 'Receipt #', y);
    y = row4(doc, 'Gallons', 'Price per Gallon', 'Total Cost', 'Odometer at Fill', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Receipt attachment note
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Receipt & Notes', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Receipt attached', 'Photo receipt uploaded', 'No receipt (explain below)'], y);
    y = addLinedArea(doc, y, 3);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signatures
  y = checkPageBreak(doc, y, 30);
  y = addSignatureBlock(doc, 'Purchasing Officer', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
}

/**
 * Fuel Log Sheet — multi-row blank log for tracking every fuel
 * purchase across a shift / week / month. Handwritten entries.
 */
function generateBlankFuelLogForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-206-FL');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'FLEET FUEL LOG SHEET',
    formNumber: 'FORM PS-206-FL',
    reportDate: '',
  });

  // Log Header
  { const sec = openAutoSection(doc, 'Log Header', y); y = sec.contentY;
    y = row4(doc, 'Vehicle Unit #', 'Call Sign', 'Log Period Start', 'Log Period End', y);
    y = row3(doc, 'Officer / Driver', 'Badge #', 'Starting Odometer', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Multi-row entry table (15 rows)
  y = checkPageBreak(doc, y, 14);
  { const sec = openAutoSection(doc, 'Fuel Entries', y); y = sec.sectionY + SPACING.SECTION_HEADER_H; }
  // Columns: Date | Time | Station | Gallons | $/Gal | Total $ | Odometer | Pump # | Initials
  const cols = ['DATE', 'TIME', 'STATION', 'GAL', '$/GAL', 'TOTAL $', 'ODOMETER', 'PUMP #', 'INIT'];
  const colW = [18, 14, 42, 14, 14, 18, 24, 14, 14];
  y = addEmptyEntryTable(doc, cols, colW, 15, y);

  // Period Summary
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Period Summary', y); y = sec.contentY;
    y = row4(doc, 'Total Gallons', 'Total Cost ($)', 'Ending Odometer', 'Miles This Period', y);
    y = row3(doc, 'Avg $/Gallon', 'Avg MPG', 'Cost per Mile', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signatures
  y = checkPageBreak(doc, y, 30);
  y = addSignatureBlock(doc, 'Reporting Officer', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
}

/**
 * Expense Reimbursement — tolls, parking, car washes, roadside
 * incidentals. Multi-row line-item claim with receipts attached.
 */
function generateBlankExpenseForm(doc: jsPDF) {
  setActiveFormKey('FORM PS-206-EXP');
  setActiveCaseNumber('');

  addBlankFormWatermark(doc);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'FLEET EXPENSE REIMBURSEMENT',
    formNumber: 'FORM PS-206-EXP',
    reportDate: '',
  });

  // Claimant
  { const sec = openAutoSection(doc, 'Claimant Information', y); y = sec.contentY;
    y = row4(doc, 'Claim #', 'Submission Date', 'Pay Period', 'Claim Total ($)', y);
    y = row3(doc, 'Officer Name', 'Badge #', 'Vehicle Unit #', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Expense categories
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Expense Categories (check all that apply)', y); y = sec.contentY;
    y += 1.5;
    y = addCheckboxRow(doc, ['Tolls', 'Parking', 'Car wash', 'Tire repair'], y);
    y = addCheckboxRow(doc, ['Roadside assistance', 'Minor repair (<$50)', 'Supplies (fluids)', 'Lodging'], y);
    y = addCheckboxRow(doc, ['Meals (on-duty travel)', 'Training material', 'Equipment replacement', 'Other'], y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Itemized line entries (10 rows)
  y = checkPageBreak(doc, y, 14);
  { const sec = openAutoSection(doc, 'Itemized Expenses', y); y = sec.sectionY + SPACING.SECTION_HEADER_H; }
  const cols = ['DATE', 'CATEGORY', 'VENDOR / DESCRIPTION', 'RECEIPT #', 'AMOUNT'];
  const colW = [20, 28, 92, 20, 26];
  y = addEmptyEntryTable(doc, cols, colW, 10, y);

  // Summary
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Claim Summary', y); y = sec.contentY;
    y = row4(doc, 'Subtotal ($)', 'Receipts Attached (#)', 'Line Items (#)', 'Claim Total ($)', y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Narrative / business purpose
  y = checkPageBreak(doc, y, 32);
  { const sec = openAutoSection(doc, 'Business Purpose / Notes', y); y = sec.contentY;
    y += SPACING.SM;
    y = addLinedArea(doc, y, 4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signatures — officer certification + supervisor approval
  y = checkPageBreak(doc, y, 60);
  y = addSignatureBlock(doc, 'Claiming Officer', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
  y = checkPageBreak(doc, y, 30);
  y = addSignatureBlock(doc, 'Supervisor / Approver', LAYOUT.PAGE_MARGIN, y, getContentWidth(doc));
}

// ── Main Export ──────────────────────────────────────────────

const GENERATORS: Record<BlankFormType, (doc: jsPDF) => void> = {
  incident: generateBlankIncidentForm,
  person: generateBlankPersonForm,
  vehicle: generateBlankVehicleForm,
  property: generateBlankPropertyForm,
  citation: generateBlankCitationForm,
  field_interview: generateBlankFieldInterviewForm,
  fleet_pre_trip: generateBlankPreTripForm,
  fleet_checkout: generateBlankCheckoutForm,
  fleet_damage: generateBlankDamageForm,
  fleet_fuel_voucher: generateBlankFuelVoucherForm,
  fleet_fuel_log: generateBlankFuelLogForm,
  fleet_expense: generateBlankExpenseForm,
};

/**
 * Generate a blank printable PDF form for field use.
 * Returns the jsPDF doc for download.
 */
export async function generateBlankForm(formType: BlankFormType): Promise<jsPDF> {
  const config = BLANK_FORMS.find(f => f.type === formType);
  if (!config) throw new Error(`Unknown blank form type: ${formType}`);

  // Load assets & branding
  await loadPdfAssets();
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  setGenerationTimestamp('');
  setActiveCaseNumber('');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  // Generate form content
  GENERATORS[formType](doc);

  // Add page footers to all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    addPageFooter(doc, p, totalPages, config.formNumber);
  }

  // Blank forms are empty templates — barcode encodes form identity so a
  // scanner can identify which form type was filled out when paper copies
  // are scanned back in.
  finalizePoliceReport(doc, {
    barcode: {
      formMetadata: {
        form: `BLANK-${config.type.toUpperCase()}`,
        formNumber: config.formNumber,
        caseNumber: config.formNumber,
        agency: 'RMPG',
        agencyOri: 'UT0180100',
      },
    },
  });

  return doc;
}

/**
 * Generate and download a blank form PDF.
 */
export async function downloadBlankForm(formType: BlankFormType): Promise<void> {
  const config = BLANK_FORMS.find(f => f.type === formType);
  if (!config) throw new Error(`Unknown blank form type: ${formType}`);

  const doc = await generateBlankForm(formType);
  doc.save(`RMPG_${config.formTitle.replace(/\s+/g, '_')}_Blank.pdf`);
}
