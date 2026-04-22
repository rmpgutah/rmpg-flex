import type jsPDF from 'jspdf';
import type { FormMeta } from './types';
import { drawNibrsHeader } from '../../../pdfFormHelpers';

const STATE_ID = 'STATE OF UTAH';
const AGENCY = 'ROCKY MOUNTAIN PROTECTIVE GROUP';

export interface HeaderOptions {
  caseNumber?: string;
}

/**
 * Draws the NIBRS-style header at the top of the page using v1's helper.
 * Requires the doc to be in mm units (v2 renderer creates the doc as mm).
 */
export function drawDefaultHeader(doc: jsPDF, meta: FormMeta, opts: HeaderOptions): number {
  return drawNibrsHeader(doc, {
    stateIdentifier: STATE_ID,
    agencyName: AGENCY,
    formTitle: meta.title,
    formNumber: meta.formNumber,
    reportDate: '',
    caseNumber: opts.caseNumber ?? '',
  });
}
