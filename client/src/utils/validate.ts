// ============================================================
// RMPG Flex — Validation Utility Functions
// ============================================================
// Centralized validators for law-enforcement data fields.
// Each function returns true if valid, false if invalid.
// Use the companion `format*` functions in formatters.ts
// to display validated values in the UI.
// ============================================================

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
  const d = new Date(dateStr + 'T00:00:00');
  return !isNaN(d.getTime()) && d.toISOString().startsWith(dateStr);
}

/** Validate that a date is not in the future. */
export function isNotFutureDate(dateStr: string): boolean {
  if (!isValidDate(dateStr)) return false;
  const d = new Date(dateStr + 'T23:59:59');
  return d.getTime() <= Date.now();
}

/** Validate that a date range is valid (start <= end). */
export function isValidDateRange(start: string, end: string): boolean {
  if (!isValidDate(start) || !isValidDate(end)) return false;
  return new Date(start) <= new Date(end);
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
  const birth = new Date(dob);
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
