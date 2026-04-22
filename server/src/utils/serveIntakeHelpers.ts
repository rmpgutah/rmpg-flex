export interface AddressParts {
  building: string;
  floor: string;
  suite: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface AttorneyBlock {
  name: string;
  barNumber: string;
  firm: string;
  addressLine1: string;
  addressLine2: string;
  tel: string;
  fax: string;
  email: string;
}

export function extractAttorneyBlock(text: string): AttorneyBlock {
  const empty: AttorneyBlock = { name: '', barNumber: '', firm: '', addressLine1: '', addressLine2: '', tel: '', fax: '', email: '' };
  if (!text) return empty;

  // Anchor on the Bar# line
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const barIdx = lines.findIndex(l => /Bar#\s*\d+/i.test(l));
  if (barIdx < 0) return empty;

  const barLine = lines[barIdx];
  const barMatch = barLine.match(/Bar#\s*(\d+)/i);
  const barNumber = barMatch ? barMatch[1] : '';

  // Name — before the comma before "(Utah" or before the parenthetical
  const nameMatch = barLine.match(/^([A-Za-z.\s]+?)(?:,|\s*\()/);
  const name = nameMatch ? nameMatch[1].trim() : '';

  // Firm — scan upwards for ALL-CAPS line
  const before = lines.slice(0, barIdx);
  const firm = [...before].reverse().find(l =>
    l.length > 3 &&
    /^[A-Z][A-Z& .,]{3,}$/.test(l) &&
    !/JUDICIAL|COURT|SUMMONS|NOTICE|RESPOND/.test(l)
  ) || '';

  // Scan downward for address / tel / fax / email
  const after = lines.slice(barIdx + 1);
  let addressLine1 = '';
  let addressLine2 = '';
  let tel = '';
  let fax = '';
  let email = '';

  for (const l of after) {
    if (/^Tel[:\s]/i.test(l)) {
      tel = l.replace(/\D/g, '');
    } else if (/^FAX[:\s]/i.test(l)) {
      fax = l.replace(/\D/g, '');
    } else if (/@/.test(l) && !email) {
      const em = l.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
      email = em ? em[0] : '';
    } else if (/^Attorney/i.test(l)) {
      break;
    } else if (!addressLine1) {
      addressLine1 = l;
    } else if (!addressLine2) {
      addressLine2 = l;
    }
  }

  return { name, barNumber, firm, addressLine1, addressLine2, tel, fax, email };
}

export interface InfoSheetLabels {
  case: string;
  plaintiff: string;
  defendant: string;
  filed: string;
  courtDate: string;
  court: string;
  courtAddress: string;
  county: string;
  jobCreated: string;
  createdBy: string;
}

export function parseInfoSheetLabels(text: string): InfoSheetLabels {
  const empty: InfoSheetLabels = {
    case: '', plaintiff: '', defendant: '', filed: '', courtDate: '',
    court: '', courtAddress: '', county: '', jobCreated: '', createdBy: '',
  };
  if (!text) return empty;

  const labels: { key: keyof InfoSheetLabels; label: string }[] = [
    { key: 'case', label: 'Case' },
    { key: 'plaintiff', label: 'Plaintiff' },
    { key: 'defendant', label: 'Defendant' },
    { key: 'filed', label: 'Filed' },
    { key: 'courtDate', label: 'Court Date' },
    { key: 'court', label: 'Court' },
    { key: 'courtAddress', label: 'Address' },
    { key: 'county', label: 'County' },
    { key: 'jobCreated', label: 'Job Created' },
    { key: 'createdBy', label: 'Created By' },
  ];

  // Slice from "Court Case" section start if present
  const startIdx = text.search(/Court Case/i);
  const body = startIdx >= 0 ? text.slice(startIdx) : text;

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Find each label's char offset (first occurrence after previous label position)
  const positions: { key: keyof InfoSheetLabels; contentStart: number; labelStart: number }[] = [];
  let cursor = 0;
  for (const { key, label } of labels) {
    const re = new RegExp(`(^|\\n)\\s*${escapeRe(label)}\\s{2,}`, 'g');
    re.lastIndex = cursor;
    const m = re.exec(body);
    if (m) {
      const labelStart = m.index + (m[1] ? m[1].length : 0);
      const contentStart = m.index + m[0].length;
      positions.push({ key, contentStart, labelStart });
      cursor = contentStart;
    }
  }

  const out: InfoSheetLabels = { ...empty };
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].labelStart : body.length;
    const raw = body.slice(positions[i].contentStart, end);
    const collapsed = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join(' ').trim();
    out[positions[i].key] = collapsed;
  }

  return out;
}

export interface JobActivityEntry {
  when: string;
  action: string;
  detail: string;
}

export function parseJobActivity(text: string): JobActivityEntry[] {
  if (!text) return [];
  const startMatch = text.match(/Job Activity/i);
  if (!startMatch) return [];
  const startIdx = (startMatch.index ?? 0) + startMatch[0].length;
  const body = text.slice(startIdx);

  const out: JobActivityEntry[] = [];
  const lines = body.split(/\r?\n/);
  // Line pattern: M/D/YY, H:MM (am|pm) <spaces> action <spaces> detail...
  const lineRe = /^\s*(\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}\s*(?:am|pm|AM|PM))\s{2,}(.+)$/;
  for (const raw of lines) {
    const m = raw.match(lineRe);
    if (!m) {
      // If we hit a non-activity line after finding some entries, stop
      if (out.length > 0 && raw.trim() && !/^\s*$/.test(raw)) {
        // only stop on clearly structural breaks (section header with label-value pattern)
        if (/^\s*[A-Z][A-Za-z ]+\s{2,}/.test(raw)) break;
      }
      continue;
    }
    const when = m[1].trim();
    const rest = m[2];
    // Split rest by 2+ spaces — first chunk is action, remainder joined is detail
    const parts = rest.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
    const action = parts[0] || '';
    const detail = parts.slice(1).join(' ');
    out.push({ when, action, detail });
  }
  return out;
}

export interface DiligenceSlot {
  date: Date;
  window: '6AM-9AM' | '9AM-6PM' | '6PM-9PM';
  weekend: boolean;
}

export function computeDiligenceSchedule(due: Date, now: Date): DiligenceSlot[] {
  const windows: Array<{ name: DiligenceSlot['window']; hour: number; minute: number }> = [
    { name: '6AM-9AM', hour: 7, minute: 30 },
    { name: '9AM-6PM', hour: 12, minute: 0 },
    { name: '6PM-9PM', hour: 19, minute: 30 },
  ];

  const isWeekend = (d: Date) => {
    const day = d.getDay();
    return day === 0 || day === 6;
  };

  // Enumerate candidate (day, window) slots between now and due
  const candidates: DiligenceSlot[] = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  const endDay = new Date(due);
  endDay.setHours(23, 59, 59, 999);
  while (cursor.getTime() <= endDay.getTime()) {
    for (const w of windows) {
      const slot = new Date(cursor);
      slot.setHours(w.hour, w.minute, 0, 0);
      if (slot.getTime() >= now.getTime() && slot.getTime() <= due.getTime()) {
        candidates.push({ date: slot, window: w.name, weekend: isWeekend(slot) });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (candidates.length === 0) return [];

  // Need 3 slots, each with a distinct window, and at least one weekend (if any candidate is weekend)
  const hasWeekendCandidate = candidates.some(c => c.weekend);

  // Try: pick one slot per distinct window, spread across days, with a weekend if possible
  const pickByWindow = (name: DiligenceSlot['window'], preferWeekend: boolean, exclude: DiligenceSlot[]): DiligenceSlot | undefined => {
    const pool = candidates.filter(c => c.window === name && !exclude.includes(c));
    if (preferWeekend) {
      const w = pool.find(c => c.weekend);
      if (w) return w;
    }
    return pool[0];
  };

  const chosen: DiligenceSlot[] = [];
  let weekendSatisfied = !hasWeekendCandidate;

  for (const w of windows) {
    const slot = pickByWindow(w.name, !weekendSatisfied, chosen);
    if (slot) {
      chosen.push(slot);
      if (slot.weekend) weekendSatisfied = true;
    }
  }

  // If we still don't have 3 (because one window had no candidates), fall back to taking any remaining candidates in time order
  if (chosen.length < 3) {
    const remaining = candidates.filter(c => !chosen.includes(c)).sort((a, b) => a.date.getTime() - b.date.getTime());
    for (const r of remaining) {
      if (chosen.length >= 3) break;
      chosen.push(r);
    }
  }

  // Sort by date ascending
  chosen.sort((a, b) => a.date.getTime() - b.date.getTime());
  return chosen.slice(0, 3);
}

export interface NotesInput {
  plaintiff: string;
  orderingClientRule: string;
  clientJobNumber: string;
  documents: string;
  documentPages: number;
  bilingual: boolean;
  signedDate: string;
  responseDeadlineDays: number;
  court: string;
  courtAddress: string;
  clerkPhone: string;
  attorney: AttorneyBlock;
  serviceRulesSummary: string;
  serviceWindows: string;
  dueDate: string;
  daysRemaining: number;
  recommendedAttempts: Array<{ label: string; weekend: boolean }>;
  jobActivity: JobActivityEntry[];
  instructionsVerbatim: string;
  timestamp: string;
}

export interface NotesEntry {
  text: string;
}

export function buildNotesNarrative(i: NotesInput): NotesEntry[] {
  const up = (s: string) => (s || '').toUpperCase();

  // CASE line
  const clauses = (i.documents || '').split(/\s*;\s*/).map(s => s.trim()).filter(Boolean);
  const docCount = clauses.length;
  const docList = clauses.map(c => c.toUpperCase().replace(/\s+AND\s+/g, ' + ')).join(' + ');
  const caseParts = [
    `PLAINTIFF: ${up(i.plaintiff)}`,
    `CASE #${i.clientJobNumber}`,
    `${docCount} DOCS (${docList}), ${i.documentPages} PAGES${i.bilingual ? ', BILINGUAL' : ''}`,
    `SIGNED/FILED: ${up(i.signedDate)}`,
    `RESPONSE DEADLINE: ${i.responseDeadlineDays} DAYS AFTER SERVICE`,
  ];
  const caseLine = `CASE -- ${caseParts.join(' | ')}`;

  // COURT line
  const courtLine = `COURT -- ${up(i.court)} | ${up(i.courtAddress)}${i.clerkPhone ? ` | CLERK: ${i.clerkPhone}` : ''}`;

  // ATTORNEY line
  const attyParts: string[] = [];
  attyParts.push(`${up(i.attorney.name)} (${up(i.attorney.firm)}) BAR#${i.attorney.barNumber}`);
  const attyAddr = [i.attorney.addressLine1, i.attorney.addressLine2].filter(Boolean).map(up).join(', ');
  if (attyAddr) attyParts.push(attyAddr);
  if (i.attorney.tel) attyParts.push(`TEL: ${i.attorney.tel}`);
  if (i.attorney.fax) attyParts.push(`FAX: ${i.attorney.fax}`);
  if (i.attorney.email) attyParts.push(`EMAIL: ${up(i.attorney.email)}`);
  const attorneyLine = `ATTORNEY -- ${attyParts.join(' | ')}`;

  // SERVICE RULES
  const serviceRulesLine = `SERVICE RULES -- ${up(i.serviceRulesSummary)}`;

  // SCHEDULE
  const scheduleLine = `SCHEDULE -- WINDOWS: ${up(i.serviceWindows)} | DUE: ${i.dueDate} | DAYS REMAINING: ${i.daysRemaining}`;

  // RECOMMENDED SCHEDULE
  const recLines = i.recommendedAttempts.map((a, idx) => `  ${idx + 1}. ${a.label}${a.weekend ? ' [WEEKEND]' : ''}`).join('\n');
  const recommendedLine = `RECOMMENDED SCHEDULE --\n${recLines}`;

  // CLIENT HISTORY
  const historyLines = i.jobActivity.map(e => `  ${e.when} -- ${e.action}${e.detail ? ': ' + e.detail : ''}`).join('\n');
  const clientHistoryLine = `CLIENT HISTORY --\n${historyLines}`;

  // INSTRUCTIONS
  const instructionsLine = `INSTRUCTIONS (VERBATIM) -- ${i.instructionsVerbatim}\n\n[Generated ${i.timestamp}]`;

  return [
    { text: caseLine },
    { text: courtLine },
    { text: attorneyLine },
    { text: serviceRulesLine },
    { text: scheduleLine },
    { text: recommendedLine },
    { text: clientHistoryLine },
    { text: instructionsLine },
  ];
}

export function deriveServiceType(primaryToken: string): string {
  const t = (primaryToken || '').toUpperCase();
  if (t.includes('SUBPOENA')) return 'SUBPOENA SERVICE';
  if (t.includes('UNLAWFUL DETAINER') || t.includes('EVICTION')) return 'EVICTION SERVICE';
  if (t.includes('SUMMONS')) return 'SUMMONS SERVICE';
  if (t.includes('COMPLAINT')) return 'COMPLAINT SERVICE';
  return 'PROCESS SERVICE';
}

export function primaryDocToken(documents: string): string {
  if (!documents) return '';
  const firstClause = documents.split(/[;,]/)[0].trim();
  const firstToken = firstClause.split(/\s+and\s+/i)[0].trim();
  const word = firstToken.split(/\s+/)[0] || '';
  return word.toUpperCase();
}

export function classifyEntityType(name: string): 'individual' | 'organization' {
  if (!name) return 'individual';
  const orgPatterns = [
    /\bLLC\b/i,
    /\bINC\.?\b/i,
    /\bCORP\.?\b/i,
    /\bCO\.?\b/i,
    /\bCOMPANY\b/i,
    /\bLP\b/i,
    /\bLLP\b/i,
    /\bN\.A\.?\b/i,
    /\bBANK\b/i,
    /\bTRUST\b/i,
    /\bASSOCIATES\b/i,
    /\bASSOCIATION\b/i,
    /&/,
  ];
  for (const re of orgPatterns) {
    if (re.test(name)) return 'organization';
  }
  return 'individual';
}

export function parseAddressParts(address: string): AddressParts {
  const empty: AddressParts = { building: '', floor: '', suite: '', street: '', city: '', state: '', zip: '' };
  if (!address) return empty;
  const tailMatch = address.match(/^(.+?),\s*([^,]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/);
  if (!tailMatch) return { ...empty, street: address };
  const street = tailMatch[1].trim();
  const city = tailMatch[2].trim();
  const state = tailMatch[3];
  const zip = tailMatch[4];
  const buildingMatch = street.match(/^(\d+[A-Z]?)\b/);
  const building = buildingMatch ? buildingMatch[1] : '';
  const unitMatch = street.match(/(?:\b(?:UNIT|STE|SUITE|APT|APARTMENT)\b|#)\s*([A-Z0-9-]+)\b/i);
  const suite = unitMatch ? unitMatch[1].toUpperCase() : 'NOT APPLICABLE';
  const floor = '1ST';
  return { building, floor, suite, street, city: city.toUpperCase(), state, zip };
}
