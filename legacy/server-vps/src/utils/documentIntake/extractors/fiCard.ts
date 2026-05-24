// ============================================================
// fi_card extractor — Field Interview / Field Contact card
// ============================================================
// Spillman-style FI cards have predictable label-value layouts:
//   Subject Name / DOB / Address / Reason for Contact / Officer
// Plus optional: vehicle, phone, gang affiliation, location.

import type { DocumentExtractor, FieldAnchor } from '../types';

const anchors: FieldAnchor[] = [
  {
    key: 'subject_name',
    label: 'Subject Name',
    patterns: [
      /(?:Subject(?:'s)?\s+Name|Name\s+of\s+Subject)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|DOB|Date)/i,
      /Subject\s*[:\-]\s*([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|DOB|Date)/i,
      /Name\s*[:\-]\s*([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|DOB|Date)/i,
    ],
  },
  {
    key: 'subject_dob',
    label: 'Subject DOB',
    patterns: [
      /(?:DOB|Date\s+of\s+Birth)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ],
  },
  {
    key: 'subject_address',
    label: 'Subject Address',
    patterns: [
      /Address\s*[:\-]?\s*([^\n]{5,120}?)(?:\n|Phone|City)/i,
      /Residence\s*[:\-]?\s*([^\n]{5,120}?)(?:\n|Phone)/i,
    ],
  },
  {
    key: 'phone',
    label: 'Phone',
    patterns: [
      /(?:Phone|Telephone|Cell)\s*[:\-]?\s*(\(?\d{3}\)?[\-.\s]?\d{3}[\-.\s]?\d{4})/i,
    ],
  },
  {
    key: 'reason_for_contact',
    label: 'Reason for Contact',
    patterns: [
      /(?:Reason\s+for\s+Contact|Reason|Circumstances)\s*[:\-]?\s*(.+?)(?:\n\s*(?:Action\s+Taken|Officer|Disposition|Location|Date)|\n\s*\n)/is,
    ],
  },
  {
    key: 'action_taken',
    label: 'Action Taken',
    patterns: [
      /Action\s+Taken\s*[:\-]?\s*(.+?)(?:\n\s*(?:Officer|Date|Disposition|Location)|\n\s*\n)/is,
      /Disposition\s*[:\-]?\s*(.+?)(?:\n\s*(?:Officer|Date|Location)|\n\s*\n)/is,
    ],
  },
  {
    key: 'contact_location',
    label: 'Location',
    patterns: [
      /(?:Location|Place\s+of\s+Contact|Contact\s+Location)\s*[:\-]?\s*([^\n]{3,160}?)(?:\n|GPS|Coords)/i,
    ],
  },
  {
    key: 'contact_date',
    label: 'Contact Date',
    patterns: [
      /(?:Contact\s+Date|Date\s+of\s+Contact|Date)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ],
  },
  {
    key: 'contact_time',
    label: 'Contact Time',
    patterns: [
      /(?:Contact\s+Time|Time\s+of\s+Contact|Time)\s*[:\-]?\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i,
    ],
  },
  {
    key: 'officer_name',
    label: 'Officer Name',
    patterns: [
      /(?:Officer|Reporting\s+Officer|Contact\s+Officer)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{2,80}?)(?:\n|Badge|#)/i,
    ],
  },
  {
    key: 'badge_number',
    label: 'Badge #',
    patterns: [
      /(?:Badge|Star)\s*#?\s*[:\-]?\s*([A-Z0-9\-]{1,12})/i,
    ],
  },
  {
    key: 'vehicle_plate',
    label: 'Vehicle Plate',
    patterns: [
      /(?:Plate|License\s+Plate|Tag)\s*#?\s*[:\-]?\s*([A-Z0-9\-]{2,10})/i,
    ],
  },
  {
    key: 'vehicle_description',
    label: 'Vehicle Description',
    patterns: [
      /(?:Vehicle|Veh)\s*[:\-]?\s*([^\n]{5,80}?)(?:\n|Plate)/i,
    ],
  },
];

export const fiCardExtractor: DocumentExtractor = {
  kind: 'fi_card',
  tier: 'implemented',
  detect(text) {
    const head = text.slice(0, 1500).toUpperCase();
    let score = 0;
    if (/FIELD\s+INTERVIEW|FIELD\s+CONTACT|FI\s+CARD\b/.test(head)) score += 0.7;
    if (/SUBJECT\s+NAME/.test(head)) score += 0.1;
    if (/REASON\s+FOR\s+CONTACT/.test(head)) score += 0.1;
    if (/ACTION\s+TAKEN/.test(head)) score += 0.1;
    return Math.min(score, 1);
  },
  anchors,
};
