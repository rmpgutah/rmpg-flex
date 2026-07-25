// ============================================================
// RMPG Flex — Vehicle Movement Field Forms (PS-106-A .. PS-106-E)
//
// Companion sheets to the Daily Activity / Shift Report (PS-106). The DAR
// records a shift from the OFFICER's point of view and brackets it with a
// single odometer pair. These five record it from the VEHICLE's point of
// view, where the unit of account is a movement rather than a shift:
//
//   A  Run Sheet .......... every leg the unit drove, reconciled to the odometer
//   B  Hand-Off ........... the unit changing hands, with an agreed odometer
//   C  Route Sheet ........ a contracted patrol route, stop by stop
//   D  Transport Log ...... a single A-to-B movement with waypoints
//   E  Breakdown & Swap ... a unit failing mid-shift and being replaced
//
// Together they keep an unbroken odometer chain: A accounts for the miles
// inside one shift, B carries the reading across a change of driver, and E
// carries it across a change of vehicle. A gap in that chain is what makes
// per-client mileage billing and fleet cost-per-mile unauditable, which is
// the failure these forms exist to prevent.
//
// Every generator matches the dispatcher signature in blankFormGenerator.ts
// and draws its own signature block, so the generic one is skipped.
// ============================================================

import jsPDF from 'jspdf';
import type { BlankFormDef } from '../blankFormGenerator';
import { COLOR, FONT, BORDER } from '../pdfTokens';
import { openAutoSection, closeAutoSection, sanitizePdfText } from '../pdfGenerator';
import {
  blankCheckboxRow, blankLogTable, darBand, darField, darFieldRow, darInspectionGrid,
  darLegend, darLines, darMathRow, darPageBreak, ensureRoom,
  DAR_ROW_H, DAR_INSPECTION_ITEMS,
} from './darPrimitives';

export type VehicleFormGenerator = (
  doc: jsPDF, y: number, lx: number, rx: number, ffw: number, hfw: number, cw: number,
) => number;

// ── Local helpers ────────────────────────────────────────────

/** Officer + supervisor signature pair used to close every sheet here. */
function signOff(
  doc: jsPDF, lx: number, y: number, ffw: number,
  primaryLabel = 'Reporting Officer Signature',
  secondaryLabel = 'Supervisor / Fleet Review',
): number {
  const w3 = ffw / 3;
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setLineWidth(BORDER.SIGNATURE_LINE);
  doc.line(lx, y, lx + ffw * 0.55, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(sanitizePdfText(primaryLabel).toUpperCase(), lx, y + 3);
  darField(doc, 'Date / Time', lx + ffw * 0.6, y - 7, ffw * 0.4);
  y += 6;
  darField(doc, 'Printed Name', lx, y, w3 - 2);
  darField(doc, 'Badge #', lx + w3, y, w3 - 2);
  y = darField(doc, 'Unit #', lx + w3 * 2, y, w3 - 2);
  y += 5;

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setLineWidth(BORDER.SIGNATURE_LINE);
  doc.line(lx, y, lx + ffw * 0.55, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(sanitizePdfText(secondaryLabel).toUpperCase(), lx, y + 3);
  darField(doc, 'Review Date / Time', lx + ffw * 0.6, y - 7, ffw * 0.4);
  return y + 6;
}

/** Wrapped instruction/caution paragraph. */
function note(doc: jsPDF, lx: number, y: number, ffw: number, text: string): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  const rows = doc.splitTextToSize(sanitizePdfText(text), ffw) as string[];
  rows.forEach((r, i) => doc.text(r, lx, y + 2.5 + i * 3.2));
  return y + rows.length * 3.2 + 2;
}

// ── PS-106-A — Vehicle Run Sheet ─────────────────────────────
// Leg-by-leg movement. The reconciliation block at the end is the point of
// the form: summed leg miles must equal the odometer difference, and a
// variance the officer has to write down is a variance a supervisor can see.

const RUN_SHEET_PURPOSE_CODES = [
  'Purpose: PAT = routine patrol - CFS = call response - ESC = escort - TRN = transport - ADM = administrative',
  'FUEL = fuel or service stop - SHOP = maintenance run - DH = deadhead / repositioning - TRG = training - BRK = break / meal.',
];

function vehicleRunSheetForm(doc: jsPDF, y: number, lx: number, _rx: number, ffw: number): number {
  { const sec = openAutoSection(doc, 'Unit & Shift', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Unit #', 'License Plate', 'Year / Make / Model', 'Officer', 'Badge #']);
    y = darFieldRow(doc, lx, y, ffw, ['Date', 'Shift (Day/Swing/Grave)', 'Client / Contract', 'Sheet No.', 'Total Sheets']);
    y = darFieldRow(doc, lx, y, ffw, ['Odometer at Shift Start', 'Odometer at Shift End', 'Engine Hours Out', 'Engine Hours In']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Movement Legs - every time the unit moves', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Leg',     frac: 0.045 },
      { label: 'Out',     frac: 0.065 },
      { label: 'From',    frac: 0.175 },
      { label: 'In',      frac: 0.065 },
      { label: 'To',      frac: 0.175 },
      { label: 'Odo Out', frac: 0.075 },
      { label: 'Odo In',  frac: 0.075 },
      { label: 'Miles',   frac: 0.060 },
      { label: 'Purp',    frac: 0.055 },
      { label: 'CFS #',   frac: 0.080 },
      { label: 'Bill To', frac: 0.130 },
    ], 19, DAR_ROW_H);
    y = darLegend(doc, lx, y, RUN_SHEET_PURPOSE_CODES);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  y = darPageBreak(doc);
  { const sec = openAutoSection(doc, 'Mileage Reconciliation', y); y = sec.contentY;
    y = note(doc, lx, y, ffw,
      'Summed leg miles must equal the odometer difference. Any variance must be explained below before the sheet is signed - an unexplained gap makes per-client mileage billing unauditable.');
    y = darMathRow(doc, lx, y + 2, ffw,
      ['Sum of Leg Miles', 'Odometer End - Start', 'VARIANCE (must be 0)'], ['vs', '=']);
    y = darBand(doc, 'Explanation of variance', lx, y);
    y = darLines(doc, lx, y + 1, ffw, 3);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Miles by Client / Cost Centre', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Client / Site / Cost Centre', frac: 0.38 },
      { label: 'Legs',                        frac: 0.10 },
      { label: 'Miles',                       frac: 0.12 },
      { label: 'Billable? Y/N',               frac: 0.14 },
      { label: 'Notes',                       frac: 0.26 },
    ], 7, DAR_ROW_H);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Fuel & Service Stops This Shift', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Time',            frac: 0.10 },
      { label: 'Station / Vendor', frac: 0.28 },
      { label: 'Odometer',        frac: 0.12 },
      { label: 'Gallons',         frac: 0.10 },
      { label: 'Cost ($)',        frac: 0.12 },
      { label: 'Receipt #',       frac: 0.14 },
      { label: 'Init',            frac: 0.14 },
    ], 4, DAR_ROW_H);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  y = ensureRoom(doc, y, 52);
  { const sec = openAutoSection(doc, 'Certification', y); y = sec.contentY;
    y = note(doc, lx, y, ffw,
      'I certify that every movement of this unit during my shift is recorded above and that the odometer readings are as observed.');
    y = signOff(doc, lx, y + 6, ffw, 'Operating Officer Signature', 'Supervisor / Fleet Review');
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

// ── PS-106-B — Vehicle Hand-Off / Unit Transfer ──────────────
// The odometer chain across a change of driver. Both officers sign the SAME
// reading, which is what makes a later dispute resolvable.

function vehicleHandoffForm(doc: jsPDF, y: number, lx: number, _rx: number, ffw: number): number {
  { const sec = openAutoSection(doc, 'Vehicle', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Unit #', 'License Plate', 'Year / Make / Model', 'VIN (last 6)', 'Key / Fob #']);
    y = darFieldRow(doc, lx, y, ffw, ['Hand-Off Date', 'Hand-Off Time', 'Location of Hand-Off', 'Reason (shift change / relief / reassignment)']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Releasing Officer (giving the unit up)', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Name (Last, First)', 'Badge #', 'Call Sign', 'Shift Ended']);
    y = darFieldRow(doc, lx, y, ffw, ['Odometer at Release', 'Engine Hours', 'Fuel Level', 'Miles Driven This Shift']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Receiving Officer (taking the unit)', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Name (Last, First)', 'Badge #', 'Call Sign', 'Shift Begins']);
    y = darFieldRow(doc, lx, y, ffw, ['Odometer Observed', 'Engine Hours Observed', 'Fuel Level Observed', 'Time Placed In Service']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Odometer Agreement', y); y = sec.contentY;
    y = note(doc, lx, y, ffw,
      'Both officers must read the odometer together. The unit does not move until any variance is explained and reported - this reading is the seam between two officers’ mileage and the only place a discrepancy can still be resolved.');
    y = darMathRow(doc, lx, y + 2, ffw,
      ['Releasing Reading', 'Receiving Reading', 'VARIANCE (must be 0)'], ['vs', '=']);
    y = darField(doc, 'Variance explained / reported to', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Condition at Hand-Off - both officers inspect together', y); y = sec.contentY;
    y = darInspectionGrid(doc, lx, y + 1, ffw, DAR_INSPECTION_ITEMS);
    y = darBand(doc, 'Damage or defects present at hand-off (photograph and describe - note if pre-existing)', lx, y);
    y = darLines(doc, lx, y + 1, ffw, 4);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Equipment Transferred With the Unit', y); y = sec.contentY + 1;
    y = blankCheckboxRow(doc, ['Keys / fobs', 'Site keys', 'Radio', 'MDT / laptop', 'Fuel card'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Dashcam / ALPR', 'First aid kit', 'AED', 'Fire extinguisher', 'Flares / cones'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Long gun secured', 'Spare tire + jack', 'Tow strap', 'Spill kit', 'Blanket'], lx, y, lx + ffw);
    y = darFieldRow(doc, lx, y + 1, ffw, ['Items NOT transferred (list)', 'Fuel Card #', 'Radio ID']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Open Defects Carried Over', y); y = sec.contentY;
    y = note(doc, lx, y, ffw,
      'Known defects the unit already has. Listing them here is what stops the incoming officer from being held to them at their own hand-off.');
    y = blankLogTable(doc, lx, y + 2, ffw, [
      { label: 'Date Noted',          frac: 0.14 },
      { label: 'Defect / Fault',      frac: 0.40 },
      { label: 'Reported To',         frac: 0.18 },
      { label: 'Work Order #',        frac: 0.14 },
      { label: 'Status',              frac: 0.14 },
    ], 5, DAR_ROW_H);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Notes to the Receiving Officer', y); y = sec.contentY;
    y = darLines(doc, lx, y + 1, ffw, 5);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  y = ensureRoom(doc, y, 72);
  { const sec = openAutoSection(doc, 'Signatures - Both Parties', y); y = sec.contentY;
    y = note(doc, lx, y, ffw,
      'We each confirm the odometer, fuel level, condition and equipment recorded above were verified jointly at the time of hand-off.');
    y = signOff(doc, lx, y + 6, ffw, 'Releasing Officer Signature', 'Receiving Officer Signature');
    y += 4;
    doc.setDrawColor(...COLOR.TEXT_PRIMARY);
    doc.setLineWidth(BORDER.SIGNATURE_LINE);
    doc.line(lx, y, lx + ffw * 0.55, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('SUPERVISOR WITNESS (IF PRESENT)', lx, y + 3);
    darField(doc, 'Date / Time', lx + ffw * 0.6, y - 7, ffw * 0.4);
    y += 8;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

// ── PS-106-C — Mobile Patrol Route Sheet ─────────────────────
// A contracted route, stop by stop. Odometer at each stop is what turns
// "route completed" into something a client can actually verify.

function patrolRouteSheetForm(doc: jsPDF, y: number, lx: number, _rx: number, ffw: number): number {
  { const sec = openAutoSection(doc, 'Route Assignment', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Route Name / #', 'Client', 'Contract / Site Group', 'Date']);
    y = darFieldRow(doc, lx, y, ffw, ['Unit #', 'License Plate', 'Officer', 'Badge #', 'Shift']);
    y = darFieldRow(doc, lx, y, ffw, ['Route Start Time', 'Route End Time', 'Odometer Start', 'Odometer End', 'Stops Scheduled']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Route Stops', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Stop',      frac: 0.05 },
      { label: 'Site / Address', frac: 0.23 },
      { label: 'Sched',     frac: 0.075 },
      { label: 'Arrive',    frac: 0.075 },
      { label: 'Depart',    frac: 0.075 },
      { label: 'Odometer',  frac: 0.09 },
      { label: 'Checks',    frac: 0.11 },
      { label: 'Findings',  frac: 0.245 },
      { label: 'Init',      frac: 0.05 },
    ], 18, DAR_ROW_H);
    y = darLegend(doc, lx, y, [
      'Checks: EXT = exterior walk - INT = interior - DR = doors secure - GT = gates - LT = lighting - ALM = alarm panel - PKG = parking lot - TRS = trespass sweep.',
      'Record the odometer at EVERY stop. A route with no per-stop readings cannot be proven to a client who disputes it.',
    ]);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  y = darPageBreak(doc);
  { const sec = openAutoSection(doc, 'Route Summary', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Stops Scheduled', 'Stops Completed', 'Stops Missed', 'Completion %']);
    y = darFieldRow(doc, lx, y, ffw, ['Total Route Miles', 'Total Route Time', 'Avg Min per Stop', 'Avg Miles per Stop']);
    y = darFieldRow(doc, lx, y, ffw, ['Route Repeated (# of passes)', 'First Pass Start', 'Last Pass End', 'Client Notified of Gaps']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Missed or Skipped Stops - justification required', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Stop',                  frac: 0.07 },
      { label: 'Site',                  frac: 0.27 },
      { label: 'Reason Not Completed',  frac: 0.40 },
      { label: 'Reported To',           frac: 0.16 },
      { label: 'Time',                  frac: 0.10 },
    ], 5, DAR_ROW_H);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Route Deviations, Traffic, Weather & Delays', y); y = sec.contentY;
    y = darLines(doc, lx, y + 1, ffw, 5);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Findings Requiring Follow-Up', y); y = sec.contentY;
    y = darLines(doc, lx, y + 1, ffw, 5);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  y = ensureRoom(doc, y, 52);
  { const sec = openAutoSection(doc, 'Certification', y); y = sec.contentY;
    y = signOff(doc, lx, y + 2, ffw, 'Patrol Officer Signature', 'Supervisor / Account Manager Review');
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

// ── PS-106-D — Vehicle Transport / Escort Movement Log ───────
// One A-to-B movement under escort. Waypoints exist because an unexplained
// stop between origin and destination is the thing an investigation asks about.

function vehicleTransportLogForm(doc: jsPDF, y: number, lx: number, _rx: number, ffw: number): number {
  { const sec = openAutoSection(doc, 'Transport Assignment', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Transport #', 'Client', 'Authorized By', 'Date']);
    y = darBand(doc, 'Type of movement', lx, y + 1);
    y = blankCheckboxRow(doc, ['Person', 'Asset / property', 'Funds', 'Documents', 'Vehicle tow / relocation'], lx, y + 1, lx + ffw);
    y = darFieldRow(doc, lx, y, ffw, ['Cargo / Principal Description', 'Declared Value ($)', 'Seal # (if sealed)', 'Threat Level']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Unit & Crew', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Unit #', 'License Plate', 'Lead Officer', 'Badge #']);
    y = darFieldRow(doc, lx, y, ffw, ['2nd Officer', 'Badge #', 'Chase / Follow Unit #', 'Radio Channel']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Origin - Departure', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Origin Location', 'Departure Time', 'Odometer OUT', 'Fuel Level']);
    y = darBand(doc, 'Pre-departure security check', lx, y + 1);
    y = blankCheckboxRow(doc, ['Route briefed', 'Alternate route identified', 'Comms tested', 'GPS tracking active'], lx, y + 1, lx + ffw);
    y = blankCheckboxRow(doc, ['Cargo secured', 'Seal applied + recorded', 'Vehicle searched', 'Fuel sufficient for route'], lx, y, lx + ffw);
    y = darFieldRow(doc, lx, y + 1, ffw, ['Released to Transport By (name / title)', 'Time', 'Signature Obtained (Y/N)']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Waypoints & Stops En Route', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Time',            frac: 0.09 },
      { label: 'Location',        frac: 0.27 },
      { label: 'Odometer',        frac: 0.11 },
      { label: 'Reason for Stop', frac: 0.24 },
      { label: 'Min',             frac: 0.07 },
      { label: 'Cargo / Seal Checked', frac: 0.17 },
      { label: 'Init',            frac: 0.05 },
    ], 10, DAR_ROW_H);
    y = darLegend(doc, lx, y, [
      'Log EVERY stop, including fuel and comfort stops. An unrecorded gap between origin and destination cannot be accounted for after the fact.',
    ]);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  y = ensureRoom(doc, y, 62);
  { const sec = openAutoSection(doc, 'Destination - Arrival & Release', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Destination Location', 'Arrival Time', 'Odometer IN', 'Fuel Level']);
    y = darFieldRow(doc, lx, y, ffw, ['Received By (print)', 'Title / Role', 'ID Verified (Y/N)', 'Seal Intact (Y/N)']);
    y += 4;
    doc.setDrawColor(...COLOR.TEXT_PRIMARY);
    doc.setLineWidth(BORDER.SIGNATURE_LINE);
    doc.line(lx, y, lx + ffw * 0.55, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('SIGNATURE OF PERSON RECEIVING CUSTODY', lx, y + 3);
    darField(doc, 'Date / Time', lx + ffw * 0.6, y - 7, ffw * 0.4);
    y += 9;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Transport Mileage', y); y = sec.contentY;
    y = darMathRow(doc, lx, y + 1, ffw,
      ['Odometer IN (arrival)', 'Odometer OUT (departure)', 'TOTAL TRANSPORT MILES']);
    y = darFieldRow(doc, lx, y, ffw, ['Planned Route Miles', 'Actual Miles', 'Deviation (mi)', 'Total Elapsed Time']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Condition on Arrival', y); y = sec.contentY + 1;
    y = blankCheckboxRow(doc, ['Seal intact', 'Cargo count verified', 'No visible damage', 'Principal in good health'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Documentation handed over', 'Receipt obtained', 'Photos taken on arrival', 'Discrepancy noted (describe)'], lx, y, lx + ffw);
    y = darLines(doc, lx, y + 1, ffw, 3);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Route Deviations, Delays, Surveillance Concerns or Incidents', y); y = sec.contentY;
    y = darLines(doc, lx, y + 1, ffw, 6);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  y = ensureRoom(doc, y, 52);
  { const sec = openAutoSection(doc, 'Certification', y); y = sec.contentY;
    y = signOff(doc, lx, y + 2, ffw, 'Lead Transport Officer Signature', 'Supervisor Review');
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

// ── PS-106-E — Vehicle Breakdown, Swap & Recovery ────────────
// The odometer chain across a change of VEHICLE. Without both readings the
// shift's miles land on whichever unit happened to be logged, and fleet
// cost-per-mile silently drifts.

function vehicleBreakdownForm(doc: jsPDF, y: number, lx: number, _rx: number, ffw: number): number {
  { const sec = openAutoSection(doc, 'Disabled Unit', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Unit #', 'License Plate', 'Year / Make / Model', 'Officer', 'Badge #']);
    y = darFieldRow(doc, lx, y, ffw, ['Date', 'Time of Failure', 'ODOMETER AT FAILURE', 'Engine Hours', 'Fuel Level']);
    y = darField(doc, 'Exact location (address / mile marker / cross streets / on-site)', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Nature of Failure', y); y = sec.contentY + 1;
    y = blankCheckboxRow(doc, ['Engine', 'Transmission', 'Brakes', 'Flat / tire', 'Electrical'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Battery / no start', 'Overheating', 'Fluid leak', 'Steering / suspension', 'Warning light'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Collision damage', 'Vandalism', 'Fuel system', 'Lighting / lightbar', 'Other (describe)'], lx, y, lx + ffw);
    y = darBand(doc, 'Symptoms - what happened, what the officer saw, heard or smelled', lx, y + 1);
    y = darLines(doc, lx, y + 1, ffw, 4);
    y = darFieldRow(doc, lx, y + 1, ffw, ['Was unit driveable? (Y/N)', 'Warning lights shown', 'Occupants / passengers', 'Injuries (Y/N)']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Immediate Actions Taken', y); y = sec.contentY + 1;
    y = blankCheckboxRow(doc, ['Moved to safe location', 'Hazards / triangles out', 'Scene secured', 'Dispatch notified'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Supervisor notified', 'Roadside assistance called', 'Tow requested', 'Driven to shop'], lx, y, lx + ffw);
    y = blankCheckboxRow(doc, ['Left on site secured', 'Equipment removed', 'Long gun secured / transferred', 'Photos taken'], lx, y, lx + ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Tow / Recovery', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Tow Company', 'Phone', 'Driver Name', 'Truck #']);
    y = darFieldRow(doc, lx, y, ffw, ['Time Called', 'Time Arrived', 'Towed To (shop / yard)', 'Release / Receipt #']);
    y = darFieldRow(doc, lx, y, ffw, ['Odometer at Tow Pickup', 'Vehicle Released To', 'Keys Left With', 'Estimated Repair Date']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Replacement Unit Placed In Service', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Replacement Unit #', 'License Plate', 'ODOMETER OUT', 'Fuel Level', 'Time In Service']);
    y = darFieldRow(doc, lx, y, ffw, ['Keys Obtained From', 'Pre-Trip Pass / Fail', 'Equipment Transferred (Y/N)', 'Dispatch Advised of New Unit']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Downtime & Split Mileage', y); y = sec.contentY;
    y = note(doc, lx, y, ffw,
      'Record miles against BOTH units. If the shift total lands on one unit, that vehicle’s cost-per-mile is overstated and the other’s is understated for the life of the record.');
    y = darFieldRow(doc, lx, y + 2, ffw, ['Out of Service At', 'Back In Service At', 'Total Downtime', 'Shift Interrupted? (Y/N)']);
    y = darMathRow(doc, lx, y + 1, ffw,
      ['Miles on Disabled Unit', 'Miles on Replacement', 'COMBINED SHIFT MILES'], ['+', '=']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Repair & Return to Service', y); y = sec.contentY;
    y = darFieldRow(doc, lx, y, ffw, ['Shop / Vendor', 'Work Order #', 'Diagnosis', 'Parts on Order (Y/N)']);
    y = darFieldRow(doc, lx, y, ffw, ['Repair Completed', 'Odometer at Return', 'Returned to Service By', 'Date Back in Fleet']);
    y = darFieldRow(doc, lx, y, ffw, ['Estimated Cost ($)', 'Insurance Claim #', 'Client Billable (Y/N)', 'Deductible ($)']);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Notifications', y); y = sec.contentY;
    y = blankLogTable(doc, lx, y, ffw, [
      { label: 'Time',                     frac: 0.10 },
      { label: 'Notified (name / role)',   frac: 0.30 },
      { label: 'Method',                   frac: 0.15 },
      { label: 'Response / Instructions',  frac: 0.45 },
    ], 5, DAR_ROW_H);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  { const sec = openAutoSection(doc, 'Fleet Review Determination (fleet manager use)', y); y = sec.contentY + 1;
    y = blankCheckboxRow(doc, ['Preventable', 'Non-preventable', 'Under review'], lx, y, lx + ffw);
    y = darBand(doc, 'Contributing factors', lx, y + 1);
    y = blankCheckboxRow(doc, ['Deferred maintenance', 'Operator error', 'Road hazard', 'Weather'], lx, y + 1, lx + ffw);
    y = blankCheckboxRow(doc, ['Age / normal wear', 'Manufacturer defect', 'Missed PM interval', 'Undetermined'], lx, y, lx + ffw);
    y = darBand(doc, 'Corrective action / PM schedule change', lx, y + 1);
    y = darLines(doc, lx, y + 1, ffw, 3);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  y = ensureRoom(doc, y, 52);
  { const sec = openAutoSection(doc, 'Certification', y); y = sec.contentY;
    y = signOff(doc, lx, y + 2, ffw, 'Reporting Officer Signature', 'Fleet Manager / Supervisor Review');
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }
  return y;
}

// ── Registry ─────────────────────────────────────────────────

export const VEHICLE_MOVEMENT_FORMS: BlankFormDef[] = [
  {
    id: 'vehicle_run_sheet',
    name: 'Vehicle Run Sheet',
    formNumber: 'FORM PS-106-A',
    description: 'Leg-by-leg movement log — time/odometer out and in for every leg, purpose code, CFS link, and a mileage reconciliation that must balance to the odometer',
    category: 'fleet',
  },
  {
    id: 'vehicle_handoff',
    name: 'Vehicle Hand-Off / Unit Transfer',
    formNumber: 'FORM PS-106-B',
    description: 'Unit changing officers — jointly read odometer with variance check, condition inspection, equipment transferred, both signatures',
    category: 'fleet',
  },
  {
    id: 'patrol_route_sheet',
    name: 'Mobile Patrol Route Sheet',
    formNumber: 'FORM PS-106-C',
    description: 'Contracted route stop by stop — scheduled vs actual arrival, odometer at every stop, checks performed, missed-stop justification',
    category: 'fleet',
  },
  {
    id: 'vehicle_transport_log',
    name: 'Transport / Escort Movement Log',
    formNumber: 'FORM PS-106-D',
    description: 'Single A-to-B movement — origin and destination odometer, waypoint log, cargo/seal checks, custody signatures',
    category: 'fleet',
  },
  {
    id: 'vehicle_breakdown',
    name: 'Breakdown, Swap & Recovery',
    formNumber: 'FORM PS-106-E',
    description: 'Mid-shift unit failure — odometer at failure, tow/recovery detail, replacement unit placed in service, split mileage across both units',
    category: 'fleet',
  },
];

export const VEHICLE_MOVEMENT_GENERATORS: Record<string, VehicleFormGenerator> = {
  vehicle_run_sheet: vehicleRunSheetForm,
  vehicle_handoff: vehicleHandoffForm,
  patrol_route_sheet: patrolRouteSheetForm,
  vehicle_transport_log: vehicleTransportLogForm,
  vehicle_breakdown: vehicleBreakdownForm,
};

/** Ids of forms that draw their own signature blocks and page furniture, and
 *  that suppress the diagonal watermark because they are written on in the
 *  field. Consumed by blankFormGenerator.generateBlankForm. */
export const VEHICLE_MOVEMENT_IDS = new Set(Object.keys(VEHICLE_MOVEMENT_GENERATORS));
