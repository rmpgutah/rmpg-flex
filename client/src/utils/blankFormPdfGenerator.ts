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
} from './pdfGenerator';
import {
  LAYOUT, SPACING, FONT, COLOR, BORDER,
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
  | 'field_interview';

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
];

// ── Helpers ──────────────────────────────────────────────────

/** Draw horizontal writing lines for handwritten narrative areas */
function addLinedArea(doc: jsPDF, y: number, lineCount: number, indent = 0): number {
  const lx = getLeftX() + indent;
  const ffw = getFullFieldWidth(doc) - indent;
  const lineGap = 8; // spacing between lines for handwriting
  const totalH = lineCount * lineGap;
  y = checkPageBreak(doc, y, Math.min(totalH, 50)); // check for at least 50mm or total
  doc.setDrawColor(...COLOR.BORDER_FIELD);
  doc.setLineWidth(BORDER.FIELD);
  for (let i = 0; i < lineCount; i++) {
    y = checkPageBreak(doc, y, lineGap + 2);
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
    const nextX = addCheckboxField(doc, label, false, x, y);
    if (nextX > maxX && x > getLeftX()) {
      // Wrap to next line
      y += rowH;
      y = checkPageBreak(doc, y, rowH + 2);
      x = getLeftX();
      x = addCheckboxField(doc, label, false, x, y);
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

// ── Main Export ──────────────────────────────────────────────

const GENERATORS: Record<BlankFormType, (doc: jsPDF) => void> = {
  incident: generateBlankIncidentForm,
  person: generateBlankPersonForm,
  vehicle: generateBlankVehicleForm,
  property: generateBlankPropertyForm,
  citation: generateBlankCitationForm,
  field_interview: generateBlankFieldInterviewForm,
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
