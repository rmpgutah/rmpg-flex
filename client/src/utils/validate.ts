// ============================================================
// RMPG Flex — Validation Utility Functions
// ============================================================
// Centralized validators for law-enforcement data fields.
// Each function returns true if valid, false if invalid.
// Use the companion `format*` functions in formatters.ts
// to display validated values in the UI.
// ============================================================

import { parseTimestamp } from './dateUtils';

/** Validate an email address (RFC 5322 simplified). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/** Validate a US phone number (10 digits, with or without formatting). */
export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  // 10 digits, or 11 digits starting with 1
  return digits.length === 10 || (digits.length === 11 && digits[0] === '1');
}

/** Validate a VIN (17 alphanumeric, excluding I, O, Q). */
export function isValidVIN(vin: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin.trim());
}

/** Validate a US license plate (2–8 alphanumeric characters). */
export function isValidPlate(plate: string): boolean {
  return /^[A-Z0-9]{2,8}$/i.test(plate.trim().replace(/[\s-]/g, ''));
}

/**
 * Validate a US driver's license number.
 * Format varies by state; this accepts 4–20 alphanumeric chars.
 */
export function isValidDLNumber(dl: string): boolean {
  return /^[A-Z0-9]{4,20}$/i.test(dl.trim().replace(/[\s-]/g, ''));
}

/** Validate a US SSN pattern (XXX-XX-XXXX, with or without dashes). */
export function isValidSSN(ssn: string): boolean {
  const digits = ssn.replace(/\D/g, '');
  if (digits.length !== 9) return false;
  // SSA rules: no area 000, 666, 900-999; no group 00; no serial 0000
  const area = parseInt(digits.substring(0, 3), 10);
  const group = parseInt(digits.substring(3, 5), 10);
  const serial = parseInt(digits.substring(5, 9), 10);
  return area > 0 && area !== 666 && area < 900 && group > 0 && serial > 0;
}

/** Validate a badge number (1–10 alphanumeric characters). */
export function isValidBadge(badge: string): boolean {
  return /^[A-Z0-9]{1,10}$/i.test(badge.trim());
}

/** Validate a US ZIP code (5 digits or ZIP+4 format). */
export function isValidZip(zip: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(zip.trim());
}

/** Validate a date string (YYYY-MM-DD format, must be a real date). */
export function isValidDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = parseTimestamp(dateStr);
  if (isNaN(d.getTime())) return false;
  // Verify the date components match (catches invalid dates like Feb 30)
  const [y, m, day] = dateStr.split('-').map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

/** Validate that a date is not in the future. */
export function isNotFutureDate(dateStr: string): boolean {
  if (!isValidDate(dateStr)) return false;
  const d = parseTimestamp(dateStr);
  return d.getTime() <= Date.now();
}

/** Validate that a date range is valid (start <= end). */
export function isValidDateRange(start: string, end: string): boolean {
  if (!isValidDate(start) || !isValidDate(end)) return false;
  return parseTimestamp(start) <= parseTimestamp(end);
}

/** Validate an incident/case number format (e.g., RKY26-00001-BURG). */
export function isValidCaseNumber(caseNum: string): boolean {
  return /^[A-Z]{2,4}\d{2}-\d{4,6}(-[A-Z]{2,6})?$/i.test(caseNum.trim());
}

/** Validate a warrant number. */
export function isValidWarrantNumber(warrantNum: string): boolean {
  return /^[A-Z0-9-]{3,30}$/i.test(warrantNum.trim());
}

/** Validate age (0–150 years). */
export function isValidAge(age: number): boolean {
  return Number.isInteger(age) && age >= 0 && age <= 150;
}

/** Validate a URL. */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Validate a US state abbreviation. */
export function isValidState(state: string): boolean {
  const states = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC','PR','GU','VI','AS','MP',
  ];
  return states.includes(state.toUpperCase().trim());
}

/**
 * Calculate age from date of birth.
 * Returns null if the date is invalid.
 */
export function calculateAge(dob: string): number | null {
  if (!isValidDate(dob)) return null;
  const birth = parseTimestamp(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
}

// ============================================================
// Field-level validation with error messages
// ============================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Run a named validator and return a result with error message. */
export function validateField(
  fieldName: string,
  value: string,
  rules: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    custom?: (v: string) => boolean;
    customMessage?: string;
  },
): ValidationResult {
  const v = value.trim();

  if (rules.required && !v) {
    return { valid: false, error: `${fieldName} is required` };
  }

  if (!v) return { valid: true }; // Empty non-required field is OK

  if (rules.minLength && v.length < rules.minLength) {
    return { valid: false, error: `${fieldName} must be at least ${rules.minLength} characters` };
  }

  if (rules.maxLength && v.length > rules.maxLength) {
    return { valid: false, error: `${fieldName} must be at most ${rules.maxLength} characters` };
  }

  if (rules.pattern && !rules.pattern.test(v)) {
    return { valid: false, error: rules.customMessage || `${fieldName} format is invalid` };
  }

  if (rules.custom && !rules.custom(v)) {
    return { valid: false, error: rules.customMessage || `${fieldName} is invalid` };
  }

  return { valid: true };
}

// ============================================================
// Input format patterns (for HTML pattern attribute)
// ============================================================

/** Regex pattern strings for use with HTML input `pattern` attribute */
export const INPUT_PATTERNS = {
  /** US phone: (801) 555-1234 or 8015551234 or 801-555-1234 */
  phone: '[0-9()\\-\\s+]{7,20}',
  /** Email: simple pattern for HTML validation */
  email: '[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}',
  /** Badge number: 1-10 alphanumeric */
  badge: '[A-Za-z0-9]{1,10}',
  /** ZIP code: 5 digits or ZIP+4 */
  zip: '\\d{5}(-\\d{4})?',
  /** VIN: 17 alphanumeric (no I, O, Q) */
  vin: '[A-HJ-NPR-Za-hj-npr-z0-9]{17}',
  /** License plate: 2-8 alphanumeric */
  plate: '[A-Za-z0-9\\s-]{2,8}',
  /** Date: YYYY-MM-DD */
  date: '\\d{4}-\\d{2}-\\d{2}',
  /** Currency amount: optional decimals */
  currency: '\\d+(\\.\\d{1,2})?',
  /** Percentage: 0-100 with optional decimal */
  percentage: '(100(\\.0{1,2})?|\\d{1,2}(\\.\\d{1,2})?)',
} as const;

/** Placeholder hints for common field types */
export const INPUT_PLACEHOLDERS = {
  phone: '(801) 555-1234',
  email: 'user@example.com',
  badge: 'e.g. B1234',
  zip: 'e.g. 84101',
  vin: '17-character VIN',
  plate: 'e.g. ABC 1234',
  date: 'YYYY-MM-DD',
  currency: 'e.g. 1500.00',
  ssn: 'XXX-XX-XXXX',
} as const;

// ============================================================
// Compound validators
// ============================================================

/** Validate that a string is a valid non-negative number */
export function isValidPositiveNumber(value: string): boolean {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0;
}

/** Validate that a string is a valid integer within range */
export function isValidIntegerInRange(value: string, min: number, max: number): boolean {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && Number.isInteger(n) && n >= min && n <= max;
}

/** Validate a Tax ID / EIN format (XX-XXXXXXX) */
export function isValidTaxId(taxId: string): boolean {
  return /^\d{2}-\d{7}$/.test(taxId.trim());
}

/** Validate required fields in a form object. Returns array of missing field names. */
export function getMissingRequiredFields(
  data: Record<string, any>,
  requiredFields: string[],
): string[] {
  return requiredFields.filter((field) => {
    const val = data[field];
    if (val == null) return true;
    if (typeof val === 'string' && val.trim() === '') return true;
    return false;
  });
}
