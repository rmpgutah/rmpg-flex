import * as levenshtein from 'fast-levenshtein';

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
    // Match LABEL surrounded by column gaps (2+ spaces) OR at line start.
    // pdftotext -layout places label+value panels side-by-side with other content,
    // so labels often appear mid-line after wide whitespace gaps.
    const re = new RegExp(`(^|\\n|\\s{2,})${escapeRe(label)}\\s{2,}`, 'g');
    re.lastIndex = cursor;
    const m = re.exec(body);
    if (m) {
      const prefix = m[1] || '';
      const labelStart = m.index + (prefix === '\n' ? 1 : 0);
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
    // Strip trailing job-activity-stream bleed: date/time entries like "4/13/26, 2:10 pm ..."
    // and JSON-import CSV leakage like `"rush": null,...`
    let cleaned = collapsed
      // Remove JSON-import CSV fragments inline (keep surrounding column content): `"key": value,` or `"key": value,...`
      .replace(/"[a-z_]+"\s*:\s*(?:"[^"]*"|null|true|false|\d+|\.\.\.)\s*,?/gi, ' ')
      .replace(/^\s*\{\s*/, '')
      .replace(/\s+\.{3,}/g, '')
      .replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}\s*(?:am|pm)\b.*$/i, '')
      .replace(/\s+Show More\b.*$/, '')
      .replace(/\s+Job Activity\b.*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    out[positions[i].key] = cleaned;
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

export interface ParseInput { fieldSheet: string; infoSheet: string; courtDocket: string; }
export interface ParseOutput {
  defendant: { first: string; middle: string; last: string; dob: string };
  address: string;
  addressParts: AddressParts;
  plaintiff: string;
  court: string;
  courtAddress: string;
  county: string;
  attorney: AttorneyBlock;
  documents: string;
  primaryDoc: string;
  serviceType: string;
  instructions: string;
  jobNumber: string;
  clientJobNumber: string;
  dueDate: string;
  signedDate: string;
  responseDeadlineDays: number;
  clerkPhone: string;
  documentPages: number;
  bilingual: boolean;
  orderingClientRule: string;
  serviceWindows: string;
  serviceRulesSummary: string;
  jobActivity: JobActivityEntry[];
  courtCaseNumber: string;
  vendorFingerprint: string;
  docketBarcodeJobNumber: string;
  complaintResidence: string;
}

export function parseAllDocuments(src: ParseInput): ParseOutput {
  const { fieldSheet, infoSheet, courtDocket } = src;
  const allText = [fieldSheet, infoSheet, courtDocket].filter(Boolean).join('\n\n');

  const info = parseInfoSheetLabels(infoSheet);
  const attorney = extractAttorneyBlock(courtDocket);

  // Defendant — Field Sheet "Party to Serve:" (preserves layout whitespace via \s+)
  const ptsMatch = fieldSheet.match(/Party to Serve[:\s]+([^\n]+)/i) || infoSheet.match(/Recipient[:\s]+([^\n]+)/i);
  const rawPartyName = (ptsMatch?.[1] || info.defendant || '').replace(/,\s*an\s+individual.*$/i, '').trim();
  const nameParts = rawPartyName.split(/\s+/);
  let dob = '';
  const dobMatch = fieldSheet.match(/DOB[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i) || infoSheet.match(/DOB[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (dobMatch) {
    const [m, d, y] = dobMatch[1].split('/');
    dob = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const defendant = {
    first: nameParts[0] || '',
    middle: nameParts.length >= 3 ? nameParts.slice(1, -1).join(' ') : '',
    last: nameParts[nameParts.length - 1] || '',
    dob,
  };

  // Address — Field Sheet block
  const addrMatch = fieldSheet.match(/(\d+\s+[A-Za-z][^\n]*?,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)/);
  const address = addrMatch ? addrMatch[1].trim() : '';
  const addressParts = parseAddressParts(address);

  // Plaintiff — info sheet first, then docket caption
  let plaintiff = info.plaintiff;
  if (!plaintiff) {
    const m = courtDocket.match(/([A-Z][^\n]{5,200}?),\s*\n\s*Plaintiff,/);
    if (m) plaintiff = m[1].replace(/\s+/g, ' ').trim();
  }

  // Court / clerk / court address
  const court = info.court || (courtDocket.match(/(THIRD|FIRST|SECOND|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+JUDICIAL\s+DISTRICT\s+COURT[^,\n]*/i)?.[0].trim() || '');
  const courtAddress = info.courtAddress || (courtDocket.match(/(\d+\s+South\s+State\s+St[^,\n]*,\s*[^,\n]*\d{5}(?:-\d{4})?)/i)?.[1] || '');
  const clerkMatch = courtDocket.match(/call\s+the\s+clerk[\s\S]*?at\s*\((\d{3})\)\s*(\d{3})[-.\s]?(\d{4})/i);
  const clerkPhone = clerkMatch ? `(${clerkMatch[1]}) ${clerkMatch[2]}-${clerkMatch[3]}` : '';

  // Documents list
  const documents = (fieldSheet.match(/Documents[:\s]+([^\n]+)/i)?.[1] || '').trim();
  const primaryDoc = primaryDocToken(documents);
  const serviceType = deriveServiceType(primaryDoc);
  const bilingual = /bilingual/i.test(documents);
  const documentPages = parseInt((infoSheet.match(/(\d+)\s*pages/i)?.[1] || '0'), 10);

  // Instructions verbatim
  const instrMatch = fieldSheet.match(/Instructions\s*\n([\s\S]*?)(?:\n\s*\n\s*Address|\n\s*\n\s*\n|$)/i);
  const instructions = instrMatch ? instrMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const orderingClientRule = instructions.split('.')[0].trim() + (instructions ? '.' : '');

  // Job numbers (ICU Job + client subordinate job# in parens)
  const jobMatch = fieldSheet.match(/Job[:\s]+(\d+)\s*\((\d+)\)/i) || fieldSheet.match(/(\d{7,})\s*\((\d{5,})\)/);
  const jobNumber = jobMatch?.[1] || '';
  const clientJobNumber = jobMatch?.[2] || (courtDocket.match(/\*S\d+(\d{6})\*/)?.[1] || '');

  const dueDate = (fieldSheet.match(/Due[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1] || '');

  // Signed + response deadline from docket URCP 4 text
  const signedDate = (courtDocket.match(/DATED\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/)?.[1] || '').replace(/,\s*$/, '');
  const responseDeadlineDays = parseInt((courtDocket.match(/[Ww]ithin\s+(\d+)\s+days\s+after\s+service/)?.[1] || '21'), 10);

  // Service windows (merged across all docs)
  const windows: string[] = [];
  if (/6AM-9AM|6am.*9am/i.test(allText)) windows.push('6AM-9AM');
  if (/9AM-6PM|9am.*6pm/i.test(allText)) windows.push('9AM-6PM');
  if (/6PM-9PM|6pm.*9pm/i.test(allText)) windows.push('6PM-9PM');
  if (/weekend/i.test(allText)) windows.push('WEEKEND REQUIRED');
  const serviceWindows = windows.join(', ');

  const serviceRulesSummary = summarizeRules(instructions);
  const jobActivity = parseJobActivity(infoSheet);
  const courtCaseNumber = (courtDocket.match(/Civil\s+No\.\s*([A-Z0-9-]+)/i)?.[1] || '').trim();
  const vendorFingerprint = info.createdBy || (fieldSheet.match(/(ICU\s+Investigations[^,\n]*)/i)?.[1] || '');
  const docketBarcodeJobNumber = extractDocketBarcodeJobNumber(courtDocket);
  const complaintResidence = extractComplaintResidence(courtDocket);

  return {
    defendant, address, addressParts, plaintiff, court, courtAddress, county: info.county,
    attorney, documents, primaryDoc, serviceType, instructions,
    jobNumber, clientJobNumber, dueDate, signedDate, responseDeadlineDays, clerkPhone,
    documentPages, bilingual, orderingClientRule, serviceWindows, serviceRulesSummary,
    jobActivity, courtCaseNumber, vendorFingerprint,
    docketBarcodeJobNumber, complaintResidence,
  };
}

function summarizeRules(instructions: string): string {
  const bits: string[] = [];
  if (/sub-?serve.*?occupant\s*16\+/i.test(instructions)) bits.push('SUB-SERVE OK TO OCCUPANT 16+');
  if (/personal.*?place\s+of\s+employment|personal.*?POE/i.test(instructions)) bits.push('PERSONAL SERVICE ONLY AT PLACE OF EMPLOYMENT');
  if (/call.*?phone|call.*?status/i.test(instructions)) bits.push('CALL CLIENT WITH STATUS AFTER EACH ATTEMPT');
  if (/hospitals?.*?churches?.*?jails?/i.test(instructions)) bits.push('NEVER SERVE AT: HOSPITALS, CHURCHES, JAILS');
  if (/BK\s*case\s*#/i.test(instructions)) bits.push('IF SUBJECT PRESENTS A BK CASE # -> STOP, DO NOT SERVE');
  return bits.join('. ') + (bits.length ? '.' : '');
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

/** Extract Code39 barcode from Utah court docket bottom-of-page-1 — embeds client job number. */
export function extractDocketBarcodeJobNumber(docketText: string): string {
  const m = docketText.match(/\*S\d+(\d{6,})\*/);
  return m ? m[1] : '';
}

/** Normalize an address for comparison — strip unit/apt/#, lowercase, punctuation off, collapse whitespace. */
export function normalizeAddressForMatch(addr: string): string {
  return (addr || '')
    .toLowerCase()
    .replace(/\b(unit|apt|apartment|ste|suite|#)\s*[a-z0-9-]+/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 0–100 confidence score comparing up to 3 address strings. Higher = more similar. */
export function addressConfidence(a: string, b: string, c?: string): number {
  const vals = [a, b, c].filter((v): v is string => Boolean(v)).map(normalizeAddressForMatch).filter(Boolean);
  if (vals.length < 2) return 100; // can't disagree with itself
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < vals.length; i++) {
    for (let j = i + 1; j < vals.length; j++) pairs.push([vals[i], vals[j]]);
  }
  const ratios = pairs.map(([x, y]) => {
    const dist = levenshtein.get(x, y);
    const maxLen = Math.max(x.length, y.length) || 1;
    return 1 - dist / maxLen;
  });
  const avg = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  return Math.round(avg * 100);
}

/** Extract the "who resides at" address from a Utah complaint paragraph 2. */
export function extractComplaintResidence(docketText: string): string {
  // Collapse blank-line wraps so the "resides at ... in X County" phrase matches on one logical line.
  const normalized = docketText.replace(/\n\s*\n/g, ' ').replace(/\n/g, ' ');
  const m = normalized.match(/who\s+resides\s+at\s+(.+?),?\s+in\s+([A-Z]+\s+County|[A-Z\s]+COUNTY)/i);
  if (!m) return '';
  return m[1].replace(/\s+/g, ' ').trim();
}
