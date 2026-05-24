// ============================================================
// Stub extractors — registered with conservative anchors
// ============================================================
// These document kinds are part of the user's stated scope but
// haven't been calibrated against real samples yet. They register
// detection + a minimal anchor set so /api/document-intake
// returns SOMETHING coherent (low confidence) rather than 'unknown'.
//
// Promote a stub to /extractors/<kind>.ts (and tier='implemented')
// once you have 3-5 real samples and have validated the anchor
// patterns. The detector heuristic stays useful even at stub tier
// because it stops misclassification (e.g. a court_order being
// labeled court_warrant when its only header marker is "ORDER").

import type { DocumentExtractor, FieldAnchor } from '../types';

const courtOrderAnchors: FieldAnchor[] = [
  { key: 'docket_number', label: 'Docket Number', patterns: [/(?:Docket|Case)\s*(?:No\.?|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i] },
  { key: 'order_type', label: 'Order Type', patterns: [/Order\s+for\s+([A-Za-z ]{3,60}?)(?:\n|$)/i] },
  { key: 'petitioner', label: 'Petitioner', patterns: [/Petitioner\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|vs?\.)/i] },
  { key: 'respondent', label: 'Respondent', patterns: [/Respondent\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|,)/i] },
  { key: 'judge', label: 'Judge', patterns: [/(?:Judge|Hon\.)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{2,80}?)(?:\n|$)/i] },
  { key: 'order_date', label: 'Order Date', patterns: [/(?:Date\s+(?:of\s+)?Order|Issued)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i] },
];

export const courtOrderExtractor: DocumentExtractor = {
  kind: 'court_order',
  tier: 'stub',
  detect(text) {
    const head = text.slice(0, 1500).toUpperCase();
    let score = 0;
    if (/\bORDER\b/.test(head) && !/WARRANT/.test(head)) score += 0.4;
    if (/IT\s+IS\s+(?:HEREBY\s+)?ORDERED/.test(text.toUpperCase())) score += 0.3;
    if (/PETITIONER|RESPONDENT/.test(head)) score += 0.1;
    return Math.min(score, 1);
  },
  anchors: courtOrderAnchors,
};

const trespassAnchors: FieldAnchor[] = [
  { key: 'subject_name', label: 'Subject Name', patterns: [/(?:Subject|Trespasser|Person\s+Trespassed)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|DOB)/i] },
  { key: 'subject_dob', label: 'Subject DOB', patterns: [/DOB\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i] },
  { key: 'property_address', label: 'Property Address', patterns: [/(?:Property\s+Address|Premises|Location)\s*[:\-]?\s*([^\n]{5,160}?)(?:\n|City)/i] },
  { key: 'property_owner', label: 'Property Owner', patterns: [/(?:Owner|Property\s+Owner|Authorized\s+Agent)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{2,80}?)(?:\n|Phone)/i] },
  { key: 'effective_date', label: 'Effective Date', patterns: [/(?:Effective\s+Date|Issued\s+On)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i] },
  { key: 'duration', label: 'Duration', patterns: [/(?:Duration|Valid\s+For|Period)\s*[:\-]?\s*([^\n]{1,80}?)(?:\n|$)/i] },
  { key: 'issuing_officer', label: 'Issuing Officer', patterns: [/(?:Officer|Issuing\s+Officer)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{2,80}?)(?:\n|Badge)/i] },
];

export const trespassOrderExtractor: DocumentExtractor = {
  kind: 'trespass_order',
  tier: 'stub',
  detect(text) {
    const head = text.slice(0, 1500).toUpperCase();
    let score = 0;
    if (/TRESPASS\s+(?:ORDER|NOTICE|WARNING|ADVISEMENT)/.test(head)) score += 0.7;
    if (/CRIMINAL\s+TRESPASS/.test(head)) score += 0.2;
    return Math.min(score, 1);
  },
  anchors: trespassAnchors,
};

const evidenceAnchors: FieldAnchor[] = [
  { key: 'case_number', label: 'Case Number', patterns: [/Case\s*(?:No\.?|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i] },
  { key: 'evidence_number', label: 'Evidence #', patterns: [/(?:Evidence|Item)\s*(?:No\.?|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i] },
  { key: 'description', label: 'Description', patterns: [/Description\s*[:\-]?\s*([^\n]{5,200}?)(?:\n|Quantity|Collected)/i] },
  { key: 'collected_by', label: 'Collected By', patterns: [/Collected\s+(?:By|by)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{2,80}?)(?:\n|Badge|#|Date)/i] },
  { key: 'collected_date', label: 'Collected Date', patterns: [/(?:Collected\s+Date|Date\s+Collected)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i] },
  { key: 'collected_location', label: 'Collected Location', patterns: [/(?:Collected\s+(?:At|From)|Location)\s*[:\-]?\s*([^\n]{5,160}?)(?:\n|GPS)/i] },
];

export const evidenceLogExtractor: DocumentExtractor = {
  kind: 'evidence_log',
  tier: 'stub',
  detect(text) {
    const head = text.slice(0, 1500).toUpperCase();
    let score = 0;
    if (/EVIDENCE\s+(?:LOG|RECEIPT|VOUCHER|CHAIN)/.test(head)) score += 0.7;
    if (/CHAIN\s+OF\s+CUSTODY/.test(head)) score += 0.2;
    return Math.min(score, 1);
  },
  anchors: evidenceAnchors,
};

const investigationAnchors: FieldAnchor[] = [
  { key: 'case_number', label: 'Case Number', patterns: [/(?:Case|Investigation)\s*(?:No\.?|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i] },
  { key: 'investigator', label: 'Lead Investigator', patterns: [/(?:Lead\s+Investigator|Investigator|Detective)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{2,80}?)(?:\n|Badge|#)/i] },
  { key: 'opened_date', label: 'Date Opened', patterns: [/(?:Opened|Date\s+Opened|Initiation\s+Date)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i] },
  { key: 'incident_type', label: 'Incident Type', patterns: [/(?:Incident\s+Type|Offense|Crime)\s*[:\-]?\s*([^\n]{3,80}?)(?:\n|$)/i] },
  { key: 'summary', label: 'Summary', patterns: [/(?:Summary|Synopsis|Overview)\s*[:\-]?\s*\n?([\s\S]{20,2000}?)(?:\n\s*\n|Witnesses|Evidence|Suspects)/i],
    postProcess: (s) => s.trim().slice(0, 2000) },
];

export const investigationReportExtractor: DocumentExtractor = {
  kind: 'investigation_report',
  tier: 'stub',
  detect(text) {
    const head = text.slice(0, 1500).toUpperCase();
    let score = 0;
    if (/INVESTIGATION\s+(?:REPORT|SUMMARY)|INVESTIGATIVE\s+REPORT|ICU\s+REPORT/.test(head)) score += 0.7;
    if (/LEAD\s+INVESTIGATOR|CASE\s+SYNOPSIS/.test(head)) score += 0.2;
    return Math.min(score, 1);
  },
  anchors: investigationAnchors,
};
