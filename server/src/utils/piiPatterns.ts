// PII regex patterns used by the email redactor before external forwards.
// Shared module so future redaction call sites (e.g. report export) can reuse.

export interface PiiPattern {
  type: 'SSN' | 'DOB' | 'PHONE' | 'DL';
  regex: RegExp;
}

export const PII_PATTERNS: PiiPattern[] = [
  { type: 'SSN',   regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'DOB',   regex: /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g },
  { type: 'PHONE', regex: /\(\d{3}\)\s*\d{3}-\d{4}/g },
  { type: 'DL',    regex: /\b[A-Z]\d{6,8}\b/g },
];
