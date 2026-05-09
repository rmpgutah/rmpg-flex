// Data validation utilities

/** Enforce pagination bounds */
export function normalizePagination(
  page: unknown,
  limit: unknown,
  maxLimit = 500
): { page: number; limit: number; offset: number } {
  let p = Number(page) || 1;
  let l = Number(limit) || 50;

  p = Math.max(1, Math.floor(p));
  l = Math.max(1, Math.min(maxLimit, Math.floor(l)));

  return { page: p, limit: l, offset: (p - 1) * l };
}

/** Validate date range with max span limit */
export function validateDateRange(
  from: string | undefined,
  to: string | undefined,
  maxSpanDays = 365
): { from: Date | null; to: Date | null; error: string | null } {
  let fromDate: Date | null = null;
  let toDate: Date | null = null;

  if (from) {
    fromDate = new Date(from);
    if (isNaN(fromDate.getTime()))
      return { from: null, to: null, error: 'Invalid "from" date' };
  }
  if (to) {
    toDate = new Date(to);
    if (isNaN(toDate.getTime()))
      return { from: null, to: null, error: 'Invalid "to" date' };
  }

  if (fromDate && toDate) {
    if (fromDate > toDate)
      return { from: null, to: null, error: '"from" date must be before "to" date' };

    const spanMs = toDate.getTime() - fromDate.getTime();
    const spanDays = spanMs / (1000 * 60 * 60 * 24);
    if (spanDays > maxSpanDays) {
      return {
        from: null,
        to: null,
        error: `Date range exceeds maximum span of ${maxSpanDays} days`,
      };
    }
  }

  return { from: fromDate, to: toDate, error: null };
}

/** Validate coordinates are within Utah jurisdiction bounds (roughly) */
export function validateUtahCoordinates(lat: number, lng: number): boolean {
  return lat >= 36.99 && lat <= 42.01 && lng >= -114.05 && lng <= -109.04;
}

/** Validate coordinates are reasonable (not null island, etc.) */
export function validateCoordinates(
  lat: number,
  lng: number
): { valid: boolean; error?: string } {
  if (typeof lat !== 'number' || typeof lng !== 'number')
    return { valid: false, error: 'Coordinates must be numbers' };
  if (isNaN(lat) || isNaN(lng))
    return { valid: false, error: 'Coordinates cannot be NaN' };
  if (lat < -90 || lat > 90)
    return { valid: false, error: 'Latitude must be between -90 and 90' };
  if (lng < -180 || lng > 180)
    return { valid: false, error: 'Longitude must be between -180 and 180' };
  if (lat === 0 && lng === 0)
    return { valid: false, error: 'Coordinates appear to be null island (0,0)' };
  return { valid: true };
}

/** Normalize a US phone number to E.164-ish format */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1')
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return phone.trim();
}

/** Normalize a person name to proper case */
export function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/(?:^|\s|[-'])\S/g, (char) => char.toUpperCase())
    // Handle common suffixes
    .replace(/\b(Ii|Iii|Iv)\b/g, (s) => s.toUpperCase())
    .replace(/\bMc(\w)/g, (_, c) => `Mc${c.toUpperCase()}`)
    .replace(/\bO'(\w)/g, (_, c) => `O'${c.toUpperCase()}`);
}

/** Normalize an address */
export function normalizeAddress(address: string): string {
  if (!address) return '';
  return (
    address
      .trim()
      // Standardize common abbreviations
      .replace(/\bSt\.?\b/gi, 'St')
      .replace(/\bAve\.?\b/gi, 'Ave')
      .replace(/\bBlvd\.?\b/gi, 'Blvd')
      .replace(/\bDr\.?\b/gi, 'Dr')
      .replace(/\bLn\.?\b/gi, 'Ln')
      .replace(/\bCt\.?\b/gi, 'Ct')
      .replace(/\bPl\.?\b/gi, 'Pl')
      .replace(/\bRd\.?\b/gi, 'Rd')
      .replace(/\bHwy\.?\b/gi, 'Hwy')
      // Directionals
      .replace(/\bN\.?\b/g, 'N')
      .replace(/\bS\.?\b/g, 'S')
      .replace(/\bE\.?\b/g, 'E')
      .replace(/\bW\.?\b/g, 'W')
      .replace(/\bNe\.?\b/gi, 'NE')
      .replace(/\bNw\.?\b/gi, 'NW')
      .replace(/\bSe\.?\b/gi, 'SE')
      .replace(/\bSw\.?\b/gi, 'SW')
  );
}

/** Validate a VIN (Vehicle Identification Number) */
export function validateVin(vin: string): { valid: boolean; error?: string } {
  if (!vin) return { valid: false, error: 'VIN is required' };
  const cleaned = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  if (cleaned.length !== 17) return { valid: false, error: 'VIN must be 17 characters' };
  if (/[IOQ]/.test(cleaned))
    return { valid: false, error: 'VIN cannot contain I, O, or Q' };

  // Check digit validation (position 9)
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  const transliteration: Record<string, number> = {
    A: 1,
    B: 2,
    C: 3,
    D: 4,
    E: 5,
    F: 6,
    G: 7,
    H: 8,
    J: 1,
    K: 2,
    L: 3,
    M: 4,
    N: 5,
    P: 7,
    R: 9,
    S: 2,
    T: 3,
    U: 4,
    V: 5,
    W: 6,
    X: 7,
    Y: 8,
    Z: 9,
  };

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const char = cleaned[i];
    const val = /\d/.test(char) ? parseInt(char) : transliteration[char] || 0;
    sum += val * weights[i];
  }
  const remainder = sum % 11;
  const checkChar = remainder === 10 ? 'X' : String(remainder);
  if (cleaned[8] !== checkChar) {
    return { valid: false, error: 'VIN check digit is invalid' };
  }

  return { valid: true };
}

/** Validate a US license plate format (basic) */
export function validateLicensePlate(plate: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  if (!plate) return { valid: false, normalized: '', error: 'Plate is required' };
  const normalized = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.length < 2 || normalized.length > 8) {
    return { valid: false, normalized, error: 'Plate must be 2-8 characters' };
  }
  return { valid: true, normalized };
}

/** Validate case number format (RKY-YY-NNNNN) */
export function validateCaseNumber(caseNum: string): boolean {
  return /^[A-Z]{2,4}-?\d{2}-?\d{3,6}$/i.test(caseNum);
}

/** Validate statute code format */
export function validateStatuteCode(code: string): boolean {
  return (
    /^[\d]{1,3}[-.][\d]{1,3}[-.][\d]{1,5}[a-z]?$/i.test(code) ||
    /^[\d]{1,3}[-.][\d]{1,3}$/.test(code)
  );
}

/** Validate batch operation size */
export function validateBatchSize(
  items: any[],
  maxSize = 100
): { valid: boolean; error?: string } {
  if (!Array.isArray(items)) return { valid: false, error: 'Batch must be an array' };
  if (items.length === 0) return { valid: false, error: 'Batch cannot be empty' };
  if (items.length > maxSize)
    return {
      valid: false,
      error: `Batch size ${items.length} exceeds maximum of ${maxSize}`,
    };
  return { valid: true };
}

/** Check timestamp consistency (not in the future, not too old) */
export function validateTimestamp(
  ts: string,
  maxAgeDays = 365
): { valid: boolean; error?: string } {
  const date = new Date(ts);
  if (isNaN(date.getTime())) return { valid: false, error: 'Invalid timestamp' };

  const now = Date.now();
  if (date.getTime() > now + 60000)
    return { valid: false, error: 'Timestamp is in the future' }; // 1min tolerance

  const ageMs = now - date.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > maxAgeDays)
    return { valid: false, error: `Timestamp is older than ${maxAgeDays} days` };

  return { valid: true };
}

/** Redact PII fields for data exports */
export function redactPii(
  record: Record<string, any>,
  fieldsToRedact?: string[]
): Record<string, any> {
  const defaultPiiFields = [
    'ssn',
    'social_security',
    'drivers_license',
    'dl_number',
    'date_of_birth',
    'dob',
    'phone',
    'email',
    'address',
    'bank_account',
    'credit_card',
    'fingerprint_id',
  ];
  const fields = new Set(fieldsToRedact || defaultPiiFields);

  const redacted: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    if (fields.has(key)) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
