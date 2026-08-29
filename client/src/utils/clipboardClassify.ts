/** Classify clipboard text so CAD operators can jump to the right lookup. */

export type ClipKind =
  | 'plate'
  | 'phone'
  | 'url'
  | 'email'
  | 'case'
  | 'warrant'
  | 'dob'
  | 'address'
  | 'text';

const PLATE = /^[A-Z]{1,3}[ -]?\d{1,4}[A-Z]{0,3}$|^[0-9]{1,3}[A-Z]{2,3}[0-9]{0,4}$/i;
const PHONE = /^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CASE = /^(CFS|INC|WRT|CASE|RMPG)[-/]?\d/i;
const WARRANT_WORD = /\bwarrant\b/i;
const DOB = /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})$/;
const ADDRESS = /\d+\s+\S+.+\s+(st|street|ave|avenue|rd|road|dr|drive|blvd|ln|lane|ct|way|cir)\b/i;

export function classifyClipboard(text: string): ClipKind {
  const t = text.trim();
  if (!t) return 'text';
  if (/^https?:\/\//i.test(t)) return 'url';
  if (EMAIL.test(t) && !t.includes(' ')) return 'email';
  if (PHONE.test(t.replace(/\s+/g, ' '))) return 'phone';
  if (DOB.test(t)) return 'dob';
  if (CASE.test(t) || /^\d{4}-[A-Z]{2,}-\d+/i.test(t)) return 'case';
  if (WARRANT_WORD.test(t)) return 'warrant';
  if (ADDRESS.test(t)) return 'address';
  const compact = t.replace(/[\s-]/g, '');
  if (compact.length >= 5 && compact.length <= 8 && PLATE.test(t) && !/\s/.test(t.trim().slice(1))) {
    return 'plate';
  }
  if (compact.length >= 5 && compact.length <= 8 && /^[A-Z0-9]+$/i.test(compact) && /\d/.test(compact) && /[A-Z]/i.test(compact)) {
    return 'plate';
  }
  return 'text';
}

/** Deep-link into Flex — never includes raw PII in a new origin. */
export function cadPathForClip(kind: ClipKind, text: string): string {
  const q = encodeURIComponent(text.trim().slice(0, 200));
  switch (kind) {
    case 'warrant':
      return `/warrants?q=${q}`;
    case 'url':
      return text.trim();
    default:
      return `/intel/search?q=${q}`;
  }
}

export function clipKindLabel(kind: ClipKind): string {
  const labels: Record<ClipKind, string> = {
    plate: 'PLATE',
    phone: 'PHONE',
    url: 'URL',
    email: 'EMAIL',
    case: 'CASE #',
    warrant: 'WARRANT',
    dob: 'DOB',
    address: 'ADDRESS',
    text: 'TEXT',
  };
  return labels[kind];
}
