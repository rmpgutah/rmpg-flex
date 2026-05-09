import { boundForRegex } from './regexSafe';

// ═══════════════════════════════════════════════════════════════
// Universal Data Scanner — format-agnostic extraction across ANY document
// Scans ALL text for data points using pattern libraries, returns
// candidates with confidence scores. The main parser uses these as
// fallbacks when format-specific extraction fails.
// ═══════════════════════════════════════════════════════════════

interface ScanCandidate { value: string; confidence: number; source: string }

/** Scan all text for person names — returns candidates sorted by confidence */
export function scanForNames(text: string): ScanCandidate[] {
  if (!text) return [];
  text = boundForRegex(text);
  const candidates: ScanCandidate[] = [];
  const seen = new Set<string>();
  const add = (value: string, confidence: number, source: string) => {
    const key = value.toLowerCase().trim();
    if (key.length < 3 || seen.has(key)) return;
    seen.add(key);
    candidates.push({ value: value.trim(), confidence, source });
  };

  // "Party to Serve:" / "Serve to:" / "Recipient:" labels
  for (const m of text.matchAll(/(?:Party to Serve|Serve to|Recipient|Serve)[:\s]+([A-Z][A-Za-z .'-]+(?:\s+[A-Za-z .'-]+){0,4})/gi)) {
    add(m[1].replace(/\s{3,}.*$/, '').replace(/,\s*an\s+individual.*$/i, '').trim(), 95, 'label');
  }
  // "v. NAME," or "vs. NAME, Defendant"
  for (const m of text.matchAll(/(?:vs?\.?|versus)\s+([A-Z][A-Za-z ,.'-]+?)(?:\s*,\s*(?:an individual|Defendant|et al))/gi)) {
    add(m[1].trim(), 85, 'caption');
  }
  // "Defendant NAME" or "Defendant: NAME"
  for (const m of text.matchAll(/Defendant[:\s]+([A-Z][A-Za-z .'-]+?)(?:\s*,|\s*$)/gim)) {
    add(m[1].trim(), 80, 'defendant-label');
  }
  // "TO: NAME" (subpoena format)
  for (const m of text.matchAll(/^To[:\s]+([A-Z][A-Za-z .'-]+?)$/gim)) {
    add(m[1].trim(), 75, 'to-label');
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/** Scan all text for US addresses — returns candidates sorted by confidence */
export function scanForAddresses(text: string): ScanCandidate[] {
  if (!text) return [];
  text = boundForRegex(text);
  const candidates: ScanCandidate[] = [];
  const seen = new Set<string>();
  const states = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
  const add = (value: string, confidence: number, source: string) => {
    const key = value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (key.length < 10 || seen.has(key)) return;
    seen.add(key);
    candidates.push({ value: value.replace(/\s+/g, ' ').trim(), confidence, source });
  };

  // Process line-by-line to eliminate catastrophic backtracking on long unstructured text
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.length > 300) continue; // skip absurdly long lines (not real addresses)

    // Full address with ZIP: "1234 Street Name, City, ST 84123"
    const fullAddrRe = new RegExp(`(\\d+\\s+[A-Za-z][^,]{4,60},\\s*[A-Za-z .]+,\\s*(?:${states})\\s*\\d{5}(?:-\\d{4})?)`, 'gi');
    for (const m of line.matchAll(fullAddrRe)) {
      add(m[1], 90, 'full-address');
    }
    // Labeled: "Address: ..." or "Service Address: ..."
    for (const m of line.matchAll(/(?:Address|Service Address|Recipient Address|Serve at)[:\s]+(.{0,100}?\d{5}(?:-\d{4})?)/gi)) {
      add(m[1], 95, 'labeled-address');
    }
    // "residing at" / "located at" — defendant's address in court docs
    for (const m of line.matchAll(/(?:resid(?:es|ing)|located)\s+at[:\s]+(\d+\s+\w[^,]{4,80}\d{5})/gi)) {
      add(m[1], 85, 'residing-at');
    }
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/** Scan all text for phone numbers */
export function scanForPhones(text: string): ScanCandidate[] {
  if (!text) return [];
  text = boundForRegex(text);
  const candidates: ScanCandidate[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/g)) {
    const phone = `(${m[1]}) ${m[2]}-${m[3]}`;
    const digits = m[1] + m[2] + m[3];
    if (!seen.has(digits)) {
      seen.add(digits);
      // Check context for confidence
      const ctx = text.substring(Math.max(0, (m.index || 0) - 30), (m.index || 0) + m[0].length + 10).toLowerCase();
      const confidence = /tel|phone|call|fax|clerk/i.test(ctx) ? 90 : 60;
      const source = /clerk/i.test(ctx) ? 'clerk' : /fax/i.test(ctx) ? 'fax' : /tel|phone/i.test(ctx) ? 'phone' : 'unlabeled';
      candidates.push({ value: phone, confidence, source });
    }
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/** Scan all text for email addresses */
export function scanForEmails(text: string): ScanCandidate[] {
  if (!text) return [];
  text = boundForRegex(text);
  // Quick bail: if no '@' exists, skip the expensive matchAll entirely
  if (!text.includes('@')) return [];
  const candidates: ScanCandidate[] = [];
  for (const m of text.matchAll(/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g)) {
    candidates.push({ value: m[1], confidence: 90, source: 'email-pattern' });
  }
  return candidates;
}

/** Scan all text for dates */
export function scanForDates(text: string): ScanCandidate[] {
  if (!text) return [];
  text = boundForRegex(text);
  const candidates: ScanCandidate[] = [];
  const seen = new Set<string>();
  // MM/DD/YYYY
  for (const m of text.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); const ctx = text.substring(Math.max(0, (m.index||0)-20), (m.index||0)).toLowerCase(); const src = /due/i.test(ctx) ? 'due-date' : /filed|signed|dated/i.test(ctx) ? 'filed-date' : 'date'; candidates.push({ value: m[1], confidence: /due/i.test(ctx) ? 95 : 70, source: src }); }
  }
  // "Month DD, YYYY"
  for (const m of text.matchAll(/([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); candidates.push({ value: m[1], confidence: 75, source: 'written-date' }); }
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/** Scan for case numbers */
export function scanForCaseNumbers(text: string): ScanCandidate[] {
  if (!text) return [];
  text = boundForRegex(text);
  const candidates: ScanCandidate[] = [];
  const seen = new Set<string>();
  const patterns = [
    /(?:Case|Civil)\s+(?:No\.?|Number|#|Action No\.?)[:\s]*([A-Z0-9][\w:.-]+\d)/gi,
    /(\d{2}[A-Z]{2}\d{6,}[A-Z]?)/g,  // California: 26CU014094N
    /(\d:[:\-]\d{2}-[a-z]{2}-\d{4,})/gi, // Federal: 1:25-cv-00947
    /Civil\s+No\.\s*([A-Z0-9][\w.-]+)/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const val = (m[1] || m[0]).trim();
      if (val.length >= 5 && !seen.has(val.toUpperCase())) {
        seen.add(val.toUpperCase());
        candidates.push({ value: val, confidence: 85, source: 'case-number-pattern' });
      }
    }
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/** Scan for court names */
export function scanForCourts(text: string): ScanCandidate[] {
  if (!text) return [];
  text = boundForRegex(text);
  const candidates: ScanCandidate[] = [];
  const patterns = [
    /UNITED\s+STATES\s+DISTRICT\s+COURT[^\n]*/gi,
    /((?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+JUDICIAL\s+DISTRICT\s+COURT[^\n]*)/gi,
    /(?:SUPERIOR|CIRCUIT|DISTRICT|JUSTICE|MUNICIPAL)\s+COURT[^\n]*/gi,
    /((?:North|South|East|West|Central)\s+\w+\s+(?:Regional|Division|Branch)\s+\w*)/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      candidates.push({ value: (m[1] || m[0]).trim(), confidence: 85, source: 'court-pattern' });
    }
  }
  return candidates;
}

// ═══════════════════════════════════════════════════════════════

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
  text = boundForRegex(text);

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Strategy 1: Anchor on "Bar#" or "ARDC #" or "(Bar No." line (Utah / Illinois / federal formats)
  const barIdx = lines.findIndex(l => /Bar#\s*\d+|ARDC\s*#?\s*\d+|\(Bar\s+No\.?\s*\d+\)/i.test(l));
  if (barIdx >= 0) {
    const barLine = lines[barIdx];
    const barMatch = barLine.match(/(?:Bar#|ARDC\s*#?|Bar\s+No\.?)\s*(\d+)/i);
    const barNumber = barMatch ? barMatch[1] : '';
    const nameMatch = barLine.match(/^([A-Za-z.\s]+?)(?:,|\s*\()/);
    const name = nameMatch ? nameMatch[1].trim() : '';
    const before = lines.slice(0, barIdx);
    const firm = [...before].reverse().find(l =>
      l.length > 3 &&
      /^[A-Z][A-Z& .,]{3,}$/.test(l) &&
      !/JUDICIAL|COURT|SUMMONS|NOTICE|RESPOND|CERTIFICATE|PROOF/.test(l)
    ) || '';
    const after = lines.slice(barIdx + 1);
    let addressLine1 = '', addressLine2 = '', tel = '', fax = '', email = '';
    for (const l of after) {
      if (/^T(?:el)?[:\s]/i.test(l)) { tel = l.replace(/\D/g, ''); }
      else if (/^F(?:ax)?[:\s]/i.test(l)) { fax = l.replace(/\D/g, ''); }
      else if (/@/.test(l) && !email) { const em = l.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/); email = em ? em[0] : ''; }
      else if (/^Attorney/i.test(l)) break;
      else if (!addressLine1) addressLine1 = l;
      else if (!addressLine2) addressLine2 = l;
    }
    return { name, barNumber, firm, addressLine1, addressLine2, tel, fax, email };
  }

  // Strategy 2: Look for "who issues or requests this subpoena" block (federal subpoena form)
  const issuerIdx = lines.findIndex(l => /who issues or requests this subpoena/i.test(l));
  if (issuerIdx >= 0) {
    // Next line(s) contain: "Name, Address, City, State ZIP, email, phone"
    const after = lines.slice(issuerIdx + 1, issuerIdx + 5);
    const combined = after.join(' ');
    const nameMatch = combined.match(/^([A-Z][A-Za-z .]+?)(?:,\s*\d|\s+\d)/);
    const emailMatch = combined.match(/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/);
    const phoneMatch = combined.match(/(\d{3}[-.]?\d{3}[-.]?\d{4})/);
    // Scan nearby for firm name (bold/caps)
    const nearLines = lines.slice(Math.max(0, issuerIdx - 10), issuerIdx);
    const firm = [...nearLines].reverse().find(l =>
      l.length > 3 && /^[A-Z][A-Z& .,]{3,}$/.test(l) &&
      !/COURT|SUBPOENA|CERTIFICATE|NOTICE/.test(l)
    ) || '';
    return {
      name: nameMatch ? nameMatch[1].trim() : '',
      barNumber: '',
      firm,
      addressLine1: after[0] || '',
      addressLine2: '',
      tel: phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '',
      fax: '',
      email: emailMatch ? emailMatch[1] : '',
    };
  }

  // Strategy 3: California SUM-100 / state summons — "plaintiff's attorney ... is:"
  const caAttyIdx = lines.findIndex(l => /plaintiff.s\s+attorney|attorney.*plaintiff/i.test(l));
  if (caAttyIdx >= 0) {
    // Scan next few lines for "Name Esq., Address; Phone"
    const after = lines.slice(caAttyIdx + 1, caAttyIdx + 6);
    for (const l of after) {
      // Pattern: "Bradley G. Hayes Esq., 2648 Durfee Ave., Ste 101, El Monte, CA 91732; (323) 477-1415"
      const m = l.match(/^([A-Z][A-Za-z .]+?(?:\s+Esq\.?)?)\s*,\s*(\d+[^;]+?);\s*\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/);
      if (m) {
        return {
          name: m[1].trim(),
          barNumber: '',
          firm: '',
          addressLine1: m[2].trim(),
          addressLine2: '',
          tel: `${m[3]}${m[4]}${m[5]}`,
          fax: '',
          email: '',
        };
      }
      // Simpler: just a name line with Esq.
      const nameOnly = l.match(/^([A-Z][A-Za-z .]+\s+Esq\.?)/);
      if (nameOnly) {
        const remaining = after.slice(after.indexOf(l) + 1);
        let addr1 = '', tel2 = '', email2 = '';
        for (const r of remaining) {
          if (/^\d+\s+\w/.test(r) && !addr1) addr1 = r;
          else if (/\(\d{3}\)/.test(r)) tel2 = r.replace(/\D/g, '');
          else if (/@/.test(r)) { const em = r.match(/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/); email2 = em ? em[0] : ''; }
        }
        return { name: nameOnly[1].trim(), barNumber: '', firm: '', addressLine1: addr1, addressLine2: '', tel: tel2, fax: '', email: email2 };
      }
    }
  }

  // Strategy 4: Look for "/s/ Name" signature block — common in federal filings
  const sigIdx = lines.findIndex(l => /^\/s\/\s+[A-Z]/.test(l));
  if (sigIdx >= 0) {
    const sigLine = lines[sigIdx];
    const name = sigLine.replace(/^\/s\/\s*/, '').trim();
    // Scan below for firm, address, contact
    const after = lines.slice(sigIdx + 1, sigIdx + 15);
    let firm = '', tel = '', fax = '', email = '', addr1 = '', addr2 = '';
    for (const l of after) {
      if (/^[A-Z][A-Z& .,]{3,}$/.test(l) && !firm && !/COURT|CERTIFICATE/.test(l)) firm = l;
      else if (/^T(?:el)?\.?[:\s]/i.test(l)) tel = l.replace(/\D/g, '');
      else if (/^F(?:ax)?\.?[:\s]/i.test(l)) fax = l.replace(/\D/g, '');
      else if (/@/.test(l) && !email) { const em = l.match(/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/); email = em ? em[0] : ''; }
      else if (/^\d+\s+\w/.test(l) && !addr1) addr1 = l;
      else if (/^[A-Z][a-z]+,\s+[A-Z]{2}\s+\d{5}/.test(l) && !addr2) addr2 = l;
    }
    return { name, barNumber: '', firm, addressLine1: addr1, addressLine2: addr2, tel, fax, email };
  }

  return empty;
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
  text = boundForRegex(text);

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
  text = boundForRegex(text);
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

export function computeDiligenceSchedule(
  due: Date,
  now: Date,
  utcOffsetHours: number = 0,
): DiligenceSlot[] {
  const offsetMs = utcOffsetHours * 60 * 60 * 1000;
  // Shift timestamps into fixed-offset local clock space for deterministic window math.
  const toLocal = (d: Date) => new Date(d.getTime() + offsetMs);
  // Convert fixed-offset local clock timestamps back to UTC.
  const fromLocal = (d: Date) => new Date(d.getTime() - offsetMs);

  const windows: Array<{ name: DiligenceSlot['window']; hour: number; minute: number }> = [
    { name: '6AM-9AM', hour: 7, minute: 30 },
    { name: '9AM-6PM', hour: 12, minute: 0 },
    { name: '6PM-9PM', hour: 19, minute: 30 },
  ];

  const isWeekend = (utcDate: Date) => {
    const day = toLocal(utcDate).getUTCDay();
    return day === 0 || day === 6;
  };

  // Enumerate candidate (day, window) slots between now and due
  const candidates: DiligenceSlot[] = [];
  const localCursor = toLocal(now);
  localCursor.setUTCHours(0, 0, 0, 0);
  const localDue = toLocal(due);

  while (localCursor.getTime() <= localDue.getTime()) {
    for (const w of windows) {
      const localSlot = new Date(localCursor);
      localSlot.setUTCHours(w.hour, w.minute, 0, 0);
      const utcSlot = fromLocal(localSlot);
      if (utcSlot.getTime() >= now.getTime() && utcSlot.getTime() <= due.getTime()) {
        candidates.push({ date: utcSlot, window: w.name, weekend: isWeekend(utcSlot) });
      }
    }
    localCursor.setUTCDate(localCursor.getUTCDate() + 1);
  }

  if (candidates.length === 0) return [];

  // Need 3 slots, each with a distinct window, on 3 DIFFERENT DAYS where
  // possible (the diligence rule almost universally requires it), and at
  // least one weekend slot if any candidate falls on a weekend.
  const hasWeekendCandidate = candidates.some(c => c.weekend);

  // Day key in local-clock space so "Mon" candidates all share one key
  // regardless of the underlying UTC time.
  const dayKey = (utcDate: Date) => {
    const d = toLocal(utcDate);
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  };

  // Pick a slot for the given window:
  //   1. Prefer a slot on a day NOT yet used (so attempts spread across days)
  //   2. Within that, prefer weekend if weekend is still required
  //   3. Otherwise pick the earliest available day for this window
  //   4. Same-day fallback only if no other day has this window
  const pickByWindow = (
    name: DiligenceSlot['window'],
    preferWeekend: boolean,
    chosen: DiligenceSlot[],
    usedDays: Set<string>,
  ): DiligenceSlot | undefined => {
    const pool = candidates.filter(c => c.window === name && !chosen.includes(c));
    const newDayPool = pool.filter(c => !usedDays.has(dayKey(c.date)));
    // Prefer new day + weekend if both possible
    if (preferWeekend) {
      const wknd = newDayPool.find(c => c.weekend);
      if (wknd) return wknd;
    }
    // Prefer any new day
    if (newDayPool.length > 0) return newDayPool[0];
    // Last resort — same day as something already chosen
    if (preferWeekend) {
      const wknd = pool.find(c => c.weekend);
      if (wknd) return wknd;
    }
    return pool[0];
  };

  const chosen: DiligenceSlot[] = [];
  const usedDays = new Set<string>();
  let weekendSatisfied = !hasWeekendCandidate;

  for (const w of windows) {
    const slot = pickByWindow(w.name, !weekendSatisfied, chosen, usedDays);
    if (slot) {
      chosen.push(slot);
      usedDays.add(dayKey(slot.date));
      if (slot.weekend) weekendSatisfied = true;
    }
  }

  // If we still don't have 3 (some window had no candidate), fall back to
  // any remaining slot — but still prefer a day not already used.
  if (chosen.length < 3) {
    const remaining = candidates
      .filter(c => !chosen.includes(c))
      .sort((a, b) => {
        const aNewDay = usedDays.has(dayKey(a.date)) ? 1 : 0;
        const bNewDay = usedDays.has(dayKey(b.date)) ? 1 : 0;
        if (aNewDay !== bNewDay) return aNewDay - bNewDay; // prefer 0 (new day)
        return a.date.getTime() - b.date.getTime();
      });
    for (const r of remaining) {
      if (chosen.length >= 3) break;
      chosen.push(r);
      usedDays.add(dayKey(r.date));
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
  /** Auto-generated plain-English brief from caseSynopsis.ts (full text). Optional. */
  caseSynopsisText?: string;
  /** Aggregated enrichment narrative from serveIntakeEnrichment.ts. Optional. */
  enrichmentText?: string;
  /** Detailed Who / What / Where / When / Why narrative from caseNarrative.ts. Optional. */
  caseNarrativeText?: string;
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
  i = { ...i, documents: boundForRegex(i.documents), serviceRulesSummary: boundForRegex(i.serviceRulesSummary) };
  const up = (s: string) => (s || '').toUpperCase();
  const clauses = (i.documents || '').split(/\s*;\s*/).map(s => s.trim()).filter(Boolean);
  const docCount = clauses.length;
  const docList = clauses.map(c => c.toUpperCase().replace(/\s+AND\s+/g, ' + ')).join(' + ');

  // ═══════════════════════════════════════════════════════════
  // NOTE 1 — 🚨 OFFICER BRIEFING
  //   Combines: officer alert essentials + recommended diligence
  //   schedule + verbose 3-day attempt plan + "what to do at the door"
  //   This is the single note an officer reads BEFORE leaving the station.
  // ═══════════════════════════════════════════════════════════
  const briefingLines: string[] = [];
  briefingLines.push('OFFICER BRIEFING');
  briefingLines.push(`SERVICE TYPE      : ${up(i.orderingClientRule).split('.')[0] || 'PROCESS SERVICE'}`);
  briefingLines.push(`SERVE TO          : NAMED DEFENDANT ONLY - ${i.bilingual ? 'BILINGUAL DOCS' : 'ENGLISH ONLY'}`);
  briefingLines.push(`DUE               : ${i.dueDate || 'NO DEADLINE'}${i.daysRemaining > 0 ? `  (${i.daysRemaining} day(s) remaining)` : i.daysRemaining === 0 ? '  DUE TODAY' : ''}`);
  briefingLines.push(`DOCUMENTS         : ${docCount} doc${docCount !== 1 ? 's' : ''} - ${i.documentPages} pages - ${docList || 'unspecified'}`);
  if (i.serviceWindows) briefingLines.push(`REQUIRED WINDOWS  : ${up(i.serviceWindows)}`);

  if (i.serviceRulesSummary) {
    briefingLines.push('');
    briefingLines.push('CLIENT RESTRICTIONS:');
    i.serviceRulesSummary.split('. ').filter(Boolean).forEach((r) => {
      briefingLines.push(`   - ${r.endsWith('.') ? r : r + '.'}`);
    });
  }

  briefingLines.push('');
  briefingLines.push('3-DAY DILIGENCE PLAN (required before sub-service or affidavit of non-service):');
  if (i.recommendedAttempts.length > 0) {
    i.recommendedAttempts.forEach((a, idx) => {
      const tag = a.weekend ? '  [WEEKEND]' : '';
      briefingLines.push(`   ATTEMPT ${idx + 1}  ${a.label}${tag}`);
    });
  } else {
    briefingLines.push('   (No automated schedule - deadline missing or in the past. Plan manually.)');
  }
  briefingLines.push('');
  briefingLines.push('   Approach guidance per attempt:');
  briefingLines.push('     - Knock 3 times, wait 30 seconds between knocks. Step back from door, hands visible.');
  briefingLines.push('     - Listen for movement, lights, TV, dogs. If signs of presence, knock once more and announce.');
  briefingLines.push('     - If no answer: photograph front door + porch (timestamp, address visible) for affidavit.');
  briefingLines.push('     - If a competent adult 16+ answers but defendant absent: ID them, ask name/relationship.');
  briefingLines.push('     - Vary the day-of-week between attempts. Vary the hour by at least 4 hours from prior attempts.');
  briefingLines.push('     - Never serve at workplace unless instructions explicitly authorize POE service.');
  briefingLines.push('');
  briefingLines.push('   After EVERY attempt: log result + GPS-tagged photo in serve queue immediately.');
  briefingLines.push('   If sub-served (16+ at residence): notify client SAME DAY so they can mail an additional copy.');
  briefingLines.push('   If served personally: complete affidavit of service the same shift.');
  const briefingNote = briefingLines.join('\n');

  // ═══════════════════════════════════════════════════════════
  // NOTE 2 — 📂 CASE PACKET
  //   Combines: case details + court info + attorney + AUTO-SYNOPSIS
  //   (plain-English explanation of what the case is, so the PSO understands
  //   what they are serving without opening the underlying PDF).
  // ═══════════════════════════════════════════════════════════
  const packetLines: string[] = [];
  packetLines.push('CASE PACKET');

  if (i.caseSynopsisText) {
    packetLines.push(i.caseSynopsisText);
    packetLines.push('');
  }

  packetLines.push('LEGAL REFERENCE');
  packetLines.push(`  CASE #            : ${i.clientJobNumber || 'N/A'}`);
  packetLines.push(`  PLAINTIFF         : ${up(i.plaintiff)}`);
  packetLines.push(`  DOCUMENTS         : ${docList}`);
  packetLines.push(`  PAGES             : ${i.documentPages}${i.bilingual ? ' (BILINGUAL)' : ''}`);
  packetLines.push(`  SIGNED / FILED    : ${up(i.signedDate) || 'N/A'}`);
  packetLines.push(`  RESPONSE DEADLINE : ${i.responseDeadlineDays} day(s) after service`);
  packetLines.push('');
  packetLines.push('COURT');
  packetLines.push(`  COURT             : ${up(i.court) || 'N/A'}`);
  if (i.courtAddress) packetLines.push(`  ADDRESS           : ${up(i.courtAddress)}`);
  if (i.clerkPhone) packetLines.push(`  CLERK PHONE       : ${i.clerkPhone}`);

  if (i.attorney.name) {
    packetLines.push('');
    packetLines.push('ATTORNEY OF RECORD');
    packetLines.push(`  NAME              : ${up(i.attorney.name)}`);
    if (i.attorney.firm) packetLines.push(`  FIRM              : ${up(i.attorney.firm)}`);
    if (i.attorney.barNumber) packetLines.push(`  BAR #             : ${i.attorney.barNumber}`);
    const attyAddr = [i.attorney.addressLine1, i.attorney.addressLine2].filter(Boolean).join(', ');
    if (attyAddr) packetLines.push(`  ADDRESS           : ${up(attyAddr)}`);
    if (i.attorney.tel) packetLines.push(`  PHONE             : ${i.attorney.tel}`);
    if (i.attorney.email) packetLines.push(`  EMAIL             : ${i.attorney.email}`);
  }
  const packetNote = packetLines.join('\n');

  // ═══════════════════════════════════════════════════════════
  // NOTE 3 — 👤 SUBJECT & ADDRESS DOSSIER + CLIENT INSTRUCTIONS
  //   Combines: enrichment intelligence (subject/address/vehicles/
  //   associates/aliases/prior attempts/premise/trespass/closest unit/
  //   GPS proximity/open case) + verbatim client instructions + job
  //   activity history. Single note for "everything else the officer
  //   needs to know about this person and place".
  // ═══════════════════════════════════════════════════════════
  const dossierLines: string[] = [];
  dossierLines.push('SUBJECT & ADDRESS DOSSIER');
  if (i.enrichmentText) {
    dossierLines.push(i.enrichmentText);
    dossierLines.push('');
  } else {
    dossierLines.push('(No enrichment data available - defendant not previously in system.)');
  }
  dossierLines.push('');
  dossierLines.push('VERBATIM CLIENT INSTRUCTIONS:');
  dossierLines.push(i.instructionsVerbatim || '(none provided)');
  if (i.jobActivity.length > 0) {
    dossierLines.push('');
    dossierLines.push('JOB ACTIVITY HISTORY:');
    i.jobActivity.forEach((e) => {
      dossierLines.push(`   ${e.when} - ${e.action}${e.detail ? ': ' + e.detail : ''}`);
    });
  }
  dossierLines.push('');
  dossierLines.push(`[Auto-generated ${i.timestamp}]`);
  const dossierNote = dossierLines.join('\n');

  // ═══════════════════════════════════════════════════════════
  // NOTE 4 — 📝 CASE NARRATIVE (detailed Who/What/Where/When/Why)
  //   Separate, deeper-dive note that reviews the Complaint document
  //   beyond the elevator-pitch synopsis embedded in the CASE PACKET.
  //   Only emitted when narrative text is supplied by the route.
  // ═══════════════════════════════════════════════════════════
  const notes: NotesEntry[] = [
    { text: briefingNote },
    { text: packetNote },
  ];
  if (i.caseNarrativeText) {
    notes.push({ text: i.caseNarrativeText });
  }
  notes.push({ text: dossierNote });
  return notes;
}

export function deriveServiceType(primaryToken: string, fullDocuments?: string): string {
  // Check full documents string first (more context), then primary token
  const full = ((fullDocuments || '') + ' ' + (primaryToken || '')).toUpperCase();
  if (full.includes('SUBPOENA')) return 'SUBPOENA SERVICE';
  if (full.includes('SUMMONS')) return 'SUMMONS SERVICE';
  if (full.includes('UNLAWFUL DETAINER') || full.includes('EVICTION')) return 'EVICTION SERVICE';
  if (full.includes('COMPLAINT')) return 'COMPLAINT SERVICE';
  if (full.includes('NOTICE') && full.includes('DEPOSITION')) return 'SUBPOENA SERVICE';
  if (full.includes('RESTRAINING') || full.includes('PROTECTIVE ORDER')) return 'RESTRAINING ORDER SERVICE';
  if (full.includes('WRIT')) return 'WRIT SERVICE';
  return 'PROCESS SERVICE';
}

export function primaryDocToken(documents: string): string {
  if (!documents) return '';
  const upper = documents.toUpperCase();
  // Check for known document types in the full string — don't rely on first word
  if (upper.includes('SUBPOENA')) return 'SUBPOENA';
  if (upper.includes('SUMMONS')) return 'SUMMONS';
  if (upper.includes('COMPLAINT')) return 'COMPLAINT';
  if (upper.includes('EVICTION') || upper.includes('UNLAWFUL DETAINER')) return 'EVICTION';
  if (upper.includes('DEPOSITION')) return 'SUBPOENA';
  if (upper.includes('RESTRAINING') || upper.includes('PROTECTIVE ORDER')) return 'RESTRAINING ORDER';
  if (upper.includes('WRIT')) return 'WRIT';
  // Fallback: first word
  const firstClause = documents.split(/[;,]/)[0].trim();
  const word = firstClause.split(/\s+/)[0] || '';
  return word.toUpperCase();
}

export function classifyEntityType(name: string): 'individual' | 'organization' {
  if (!name) return 'individual';
  // Explicit org suffixes/keywords — high confidence
  const orgKeywords = [
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
    /\bFOUNDATION\b/i,
    /\bGROUP\b/i,
    /\bHOLDINGS\b/i,
    /\bENTERPRISES?\b/i,
    /\bSERVICES?\b/i,
    /\bINDUSTRIES\b/i,
  ];
  for (const re of orgKeywords) {
    if (re.test(name)) return 'organization';
  }
  // "&" only signals org if ALSO paired with an org keyword above, or
  // if the name doesn't look like a person name (e.g., "Tom & Mary" is
  // individual; "GUGLIELMO & ASSOCIATES" already caught by ASSOCIATES).
  // Common first names on both sides of "&" → individual (married couple).
  if (/&/.test(name)) {
    // If it looks like "WORD & WORD" with no org keyword, check if both
    // sides could be person names (2-word or 1-word parts typical of names)
    const parts = name.split(/\s*&\s*/);
    const looksLikePersonName = (s: string) => {
      const words = s.trim().split(/\s+/);
      return words.length >= 1 && words.length <= 3 && /^[A-Z][a-z]/.test(words[0]);
    };
    // If both sides look like person names, treat as individual (e.g. "Tom & Mary Johnson")
    if (parts.length === 2 && looksLikePersonName(parts[0]) && looksLikePersonName(parts[1])) {
      return 'individual';
    }
    return 'organization';
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
}

export function parseAllDocuments(src: ParseInput): ParseOutput {
  const fieldSheet = boundForRegex(src.fieldSheet);
  const infoSheet = boundForRegex(src.infoSheet);
  const courtDocket = boundForRegex(src.courtDocket);
  const allText = boundForRegex([fieldSheet, infoSheet, courtDocket].filter(Boolean).join('\n\n'));

  const info = parseInfoSheetLabels(infoSheet);
  // Attorney: try court docket first (most structured), then all text
  let attorney = extractAttorneyBlock(courtDocket);
  if (!attorney.name && allText) {
    attorney = extractAttorneyBlock(allText);
  }

  // ── Defendant name extraction (structured ICU field sheet parsing) ──
  // ICU field sheets have a VERY specific layout:
  //   Party to Serve:  <NAME>
  //   Server:          <officer>        Fee:
  // The name appears RIGHT AFTER "Party to Serve:" on the same line.
  // pdftotext -layout preserves this but sometimes bleeds column data.

  // Strategy 1: Field sheet "Party to Serve:" — most authoritative
  let rawPartyName = '';
  const ptsMatch = fieldSheet.match(/Party to Serve[:\s]+([^\n]+)/i);
  if (ptsMatch) {
    rawPartyName = ptsMatch[1]
      .replace(/\s{3,}.*$/, '')  // Trim anything after 3+ spaces (column bleed from "Due:", "Fee:", etc.)
      .replace(/,\s*an\s+individual.*$/i, '')
      .replace(/,?\s*(?:a\s+business.*|Defendant|et al\.?)$/i, '')
      .trim();
  }
  // Strategy 2: Info sheet "Recipient:" label
  if (!rawPartyName) {
    const isMatch = infoSheet.match(/Recipient[:\s]+([^\n]+)/i);
    if (isMatch) rawPartyName = isMatch[1].replace(/\s{3,}.*$/, '').trim();
  }
  // Strategy 3: Info sheet parsed labels
  if (!rawPartyName && info.defendant) {
    rawPartyName = info.defendant;
  }
  // Strategy 4: Court docket caption "v. NAME, Defendant"
  if (!rawPartyName) {
    const cdMatch = courtDocket.match(/(?:vs?\.?|versus)\s*\n?\s*([A-Z][A-Za-z ,.'-]+?)(?:\s*,\s*(?:an individual|Defendant|et al))/i)
      || courtDocket.match(/Defendant[:\s]+([^\n]+)/i);
    if (cdMatch) rawPartyName = cdMatch[1].trim();
  }
  // Clean the extracted name
  rawPartyName = rawPartyName
    .replace(/,\s*an\s+individual.*$/i, '')
    .replace(/,?\s*(?:Defendant|et al\.?)$/i, '')
    .replace(/^\s*(?:Recipient|Party to Serve)[:\s]*/i, '')
    .replace(/\s+(?:aka|a\.k\.a|dba|d\.b\.a)\.?\s+.*$/i, '')
    .replace(/-\s+/g, '-')  // Rejoin hyphenated names: "Campbell- Ryce" → "Campbell-Ryce"
    .replace(/\s{2,}/g, ' ')  // Collapse multiple spaces
    .trim();

  // Detect comma-inverted format: "LAST, FIRST MIDDLE" → "FIRST MIDDLE LAST"
  const commaInvertedMatch = rawPartyName.match(/^([A-Z][A-Za-z'-]+)\s*,\s+([A-Z][A-Za-z .'-]+)$/);
  if (commaInvertedMatch) {
    rawPartyName = `${commaInvertedMatch[2].trim()} ${commaInvertedMatch[1].trim()}`;
  }

  // Extract and strip generational/professional suffixes before splitting
  const NAME_SUFFIXES = /\b(?:Jr\.?|Sr\.?|III|IV|II|V|Esq\.?|Esquire|Ph\.?D\.?|M\.?D\.?)\s*$/i;
  const suffixMatch = rawPartyName.match(NAME_SUFFIXES);
  const nameSuffix = suffixMatch ? suffixMatch[0].trim() : '';
  if (nameSuffix) {
    rawPartyName = rawPartyName.replace(NAME_SUFFIXES, '').replace(/,\s*$/, '').trim();
  }

  // Smart name splitting — handle "Jamal Campbell-Ryce" correctly
  const nameParts = rawPartyName.split(/\s+/).filter(Boolean);

  // DOB extraction — try field sheet, info sheet, AND court docket
  let dob = '';
  const dobMatch = fieldSheet.match(/DOB[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
    || infoSheet.match(/DOB[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
    || allText.match(/(?:Date of Birth|D\.O\.B\.?|Born)[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
    || allText.match(/DOB[:\s]*(\d{4}-\d{2}-\d{2})/i);
  if (dobMatch) {
    const raw = dobMatch[1];
    if (raw.includes('-')) {
      dob = raw; // Already YYYY-MM-DD
    } else {
      const [m, d, y] = raw.split('/');
      dob = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }
  // Name splitting rules:
  // 1 part:  first="" last="NAME"
  // 2 parts: first="FIRST" last="LAST"
  // 3+ parts: first="FIRST" middle="MIDDLE..." last="LAST"
  // BUT: if last part contains a hyphen, it's a compound last name
  // AND: if last 2 parts look like "De La" + "Valle", combine as last name
  let defFirst = '', defMiddle = '', defLast = '';
  if (nameParts.length === 0) {
    defLast = rawPartyName; // Fallback: use entire raw name
  } else if (nameParts.length === 1) {
    defLast = nameParts[0];
  } else if (nameParts.length === 2) {
    defFirst = nameParts[0];
    defLast = nameParts[1];
  } else {
    defFirst = nameParts[0];
    // Check if the name has a compound last name pattern
    const lastTwo = nameParts.slice(-2).join(' ');
    const compoundPrefixes = ['de', 'del', 'de la', 'van', 'von', 'el', 'al', 'bin', 'ibn', 'mac', 'mc', 'o\'', 'st', 'san', 'santa'];
    const secondToLast = nameParts[nameParts.length - 2].toLowerCase();
    if (compoundPrefixes.includes(secondToLast) || nameParts[nameParts.length - 1].includes('-')) {
      // Compound last name — take last 2 parts as last name
      defMiddle = nameParts.slice(1, -2).join(' ');
      defLast = lastTwo;
    } else {
      defMiddle = nameParts.slice(1, -1).join(' ');
      defLast = nameParts[nameParts.length - 1];
    }
  }
  const defendant = { first: defFirst, middle: defMiddle, last: defLast, dob };

  // ── Address extraction — FIELD SHEET IS AUTHORITATIVE ──
  // ICU Field Sheet layout:
  //   Address
  //   6504 Ipswich Way, Herriman, UT 84096        Jamal Campbell-Ryce, an individual
  // The address is LEFT-aligned, the name is RIGHT-aligned on the same line.
  // pdftotext -layout preserves this — we need to grab only the LEFT part (the address).

  let address = '';
  // 1. Field sheet — "Address" label on its own line, next line has the actual address
  const fsLines = fieldSheet.split(/\r?\n/);
  const addrLabelIdx = fsLines.findIndex(l => /^\s*Address\s*$/i.test(l.trim()));
  if (addrLabelIdx >= 0 && addrLabelIdx + 1 < fsLines.length) {
    const nextLine = fsLines[addrLabelIdx + 1];
    // Split on 3+ spaces to separate left (address) from right (name)
    const leftPart = nextLine.split(/\s{3,}/)[0].trim();
    if (/^\d+\s+\w/.test(leftPart) && /\d{5}/.test(leftPart)) {
      address = leftPart;
    } else if (/^\d+\s+\w/.test(leftPart)) {
      // Address without ZIP — check if next part of the same line has city/state/zip
      const fullLine = nextLine.trim();
      const addrMatch = fullLine.match(/^(\d+[^,]+,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)/);
      if (addrMatch) address = addrMatch[1].trim();
      else address = leftPart; // Use what we have
    }
  }
  // 2. Field sheet — standard address pattern anywhere (fallback)
  if (!address) {
    const fsAddr = fieldSheet.match(/(\d+\s+[A-Za-z][^\n]*?,\s*[A-Za-z .]+,\s*(?:UT|Utah|CO|AZ|NV|ID|WY|NM|CA|TX|FL|IL|NY|OH|PA|GA|NC|MI|WA|OR)\s*\d{5}(?:-\d{4})?)/i);
    if (fsAddr) address = fsAddr[1].trim();
  }
  // 3. Info sheet "Address" / "Recipient Address" label
  if (!address) {
    const isAddr = infoSheet.match(/(?:Address|Service Address|Recipient Address)[:\s]+([^\n]*?\d{5}(?:-\d{4})?)/i);
    if (isAddr) address = isAddr[1].trim();
  }
  // 4. Info sheet — look for address in the Recipient section
  if (!address) {
    const isBlock = infoSheet.match(/(\d+\s+[A-Za-z][^\n]*?\d{5})/);
    if (isBlock) address = isBlock[1].trim();
  }
  // 5. Court docket — ONLY "residing at" / "resides at" (defendant address, NOT court address)
  if (!address) {
    const cdAddr = courtDocket.match(/(?:resid(?:es|ing)\s+at|located\s+at)[:\s]+(\d+\s+\w[^\n]{5,80},\s*[A-Za-z .]+,?\s*[A-Z]{2}\s*\d{5})/i);
    if (cdAddr) address = cdAddr[1].trim();
  }
  // 6. Multi-line address: street number on one line, city/state/zip 1-2 lines later
  if (!address) {
    const states = 'UT|CO|AZ|NV|ID|WY|NM|CA|TX|FL|IL|NY|OH|PA|GA|NC|MI|WA|OR';
    const allLines = allText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < allLines.length - 1; i++) {
      if (/^\d+\s+[A-Za-z]/.test(allLines[i]) && !/Party to Serve|Plaintiff|Defendant|Case|Court|Filed/i.test(allLines[i])) {
        // Look ahead 1-2 lines for city/state/zip
        for (let j = 1; j <= Math.min(2, allLines.length - i - 1); j++) {
          const cityStateZip = allLines[i + j].match(new RegExp(`^([A-Za-z .]+),\\s*(?:${states})\\s*\\d{5}`, 'i'));
          if (cityStateZip) {
            const joined = allLines.slice(i, i + j + 1).join(', ').replace(/,\s*,/g, ',');
            // Verify it parses as a valid address
            if (/\d{5}/.test(joined) && /[A-Z]{2}/.test(joined)) {
              address = joined;
              break;
            }
          }
        }
        if (address) break;
      }
    }
  }
  // Final cleanup — strip trailing name bleed from right-aligned text
  address = address.replace(/\s{3,}.*$/, '').trim();
  const addressParts = parseAddressParts(address);

  // Field sheet structured labels: Case, Court, Plaintiff, Defendant, Documents
  // These are in a table-like layout that pdftotext renders with spacing.
  // Hoisted above plaintiff/court extraction (which references fsPlaintiff/fsCourt).
  const fsCase = fieldSheet.match(/Case\s{2,}([^\s](?:[^\n]*?))\s{2,}Plaintiff/i)?.[1]?.trim() || '';
  const fsPlaintiff = fieldSheet.match(/Plaintiff\s{2,}([^\n]+?)(?:\s{3,}|$)/i)?.[1]?.trim() || '';
  const fsCourt = fieldSheet.match(/Court\s{2,}([^\s](?:[^\n]*?))\s{2,}Defendant/i)?.[1]?.trim() || '';
  const fsDefendant = fieldSheet.match(/Defendant\s{2,}([^\n]+?)(?:\s{3,}|$)/i)?.[1]?.trim() || '';
  void fsDefendant; // reserved for future name-conflict checks

  // ── Plaintiff extraction (multi-source) ──
  // Priority: field sheet structured → info sheet → court docket caption
  let plaintiff = fsPlaintiff || info.plaintiff;
  if (!plaintiff) {
    const m = courtDocket.match(/([A-Z][^\n]{5,200}?),\s*\n\s*Plaintiff/i)
      || courtDocket.match(/([A-Z][^\n]{3,200}?)\s*,?\s*Plaintiff/i);
    if (m) plaintiff = m[1].replace(/\s+/g, ' ').trim();
  }
  // Clean plaintiff: strip trailing comma/period, file metadata bleed, document references
  plaintiff = (plaintiff || '')
    .replace(/[,.\s]+$/, '')
    .replace(/\s+\d{6,}[A-Z]?\.\d+\.\w+\.pdf.*$/i, '')  // Strip "788691A.3318805.Complaint.pdf..." bleed
    .replace(/\s+\(\d+(\.\d+)?\s*(KB|MB|GB)\).*$/i, '')  // Strip "(809 KB) Jason..." file size bleed
    .replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}.*$/i, '')     // Strip trailing dates
    .trim();

  // ── Court extraction (broader matching — captures full jurisdiction) ──
  const courtPatterns = [
    // Federal: "UNITED STATES DISTRICT COURT\nNORTHERN DISTRICT OF ILLINOIS\nEASTERN DIVISION"
    /UNITED\s+STATES\s+DISTRICT\s+COURT\s*\n\s*([^\n]+(?:DISTRICT|DIVISION)[^\n]*)/i,
    /UNITED\s+STATES\s+DISTRICT\s+COURT[^\n]*/i,
    // State: "THIRD JUDICIAL DISTRICT COURT ..."
    /(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+JUDICIAL\s+DISTRICT\s+COURT[^,\n]*/i,
    /(?:IN THE\s+)?(\w+\s+DISTRICT\s+COURT[^,\n]*)/i,
    /(?:IN THE\s+)?(\w+\s+CIRCUIT\s+COURT[^,\n]*)/i,
    /(JUSTICE\s+COURT[^,\n]*)/i,
    /(SMALL\s+CLAIMS\s+COURT[^,\n]*)/i,
  ];
  let court = fsCourt || info.court;
  if (!court) {
    for (const re of courtPatterns) {
      const m = courtDocket.match(re);
      if (m) {
        // For federal courts, try to capture the jurisdiction line below
        let fullCourt = (m[1] || m[0]).trim();
        if (/UNITED STATES DISTRICT COURT/i.test(fullCourt) && m[1]) {
          fullCourt = `UNITED STATES DISTRICT COURT, ${m[1].trim()}`;
        }
        court = fullCourt;
        break;
      }
    }
  }
  court = court || '';
  // Court/deposition address — multiple strategies
  const courtAddress = info.courtAddress
    || (courtDocket.match(/Place[:\s]+([^\n]*?\d{5})/i)?.[1] || '')
    || (courtDocket.match(/(?:office of|at)\s+([^,\n]+,\s*\d+[^\n]*?\d{5})/i)?.[1] || '')
    // California SUM-100: "The name and address of the court is: ... \n 325 South Melrose Drive, Vista, CA, 92081"
    || (courtDocket.match(/(?:name and address of the court|address of the court)[^:]*:[^\n]*\n\s*(\d+[^\n]*?\d{5})/i)?.[1] || '')
    || (courtDocket.match(/(?:court\s+(?:is|address))[:\s]+([^\n]*?\d{5})/i)?.[1] || '')
    || (courtDocket.match(/(\d+\s+\w[^\n]{5,60},\s*[A-Za-z .]+,?\s*(?:UT|Utah|IL|CA|TX|NY|FL|AZ|CO|NV|WA|OR)\s*,?\s*\d{5})/i)?.[1] || '');
  const clerkMatch = courtDocket.match(/(?:call|contact)\s+(?:the\s+)?clerk[\s\S]*?(?:at\s*)?\(?(\d{3})\)?\s*[-.\s]?(\d{3})[-.\s]?(\d{4})/i)
    || courtDocket.match(/Clerk[:\s]*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/i);
  let clerkPhone = clerkMatch ? `(${clerkMatch[1]}) ${clerkMatch[2]}-${clerkMatch[3]}` : '';

  // ── Documents list (field sheet → info sheet → court docket) ──
  let documents = (fieldSheet.match(/Documents[:\s]+([^\n]+)/i)?.[1]
    || infoSheet.match(/Documents?[:\s]+([^\n]+)/i)?.[1]
    || '').trim();
  // Clean file IDs that bleed into the documents field from pdftotext:
  // "788691G.3318900.SUMMONS3.pdf,788691A.3318805.Complaint.pdf,..." → just the doc names
  if (/\d{6,}\.\d+\.\w+\.pdf/i.test(documents)) {
    // Extract human-readable document names from the file IDs
    const fileNames = documents.match(/\d+\.(\w+)\.pdf/gi);
    if (fileNames) {
      const cleaned = fileNames
        .map(f => f.replace(/^\d+\./, '').replace(/\.pdf$/i, '').replace(/\d+$/, '').replace(/[._]/g, ' ').trim())
        .filter(Boolean)
        .map(n => n.charAt(0).toUpperCase() + n.slice(1).toLowerCase());
      const unique = [...new Set(cleaned)];
      if (unique.length > 0) documents = unique.join('; ');
    }
  }
  const primaryDoc = primaryDocToken(documents);
  const serviceType = deriveServiceType(primaryDoc, documents);
  const bilingual = /bilingual/i.test(documents) || /bilingual/i.test(allText);
  // Document pages — info sheet "Docs to Be Served  XX pages" is most reliable
  const documentPages = parseInt((
    infoSheet.match(/(\d{2,})\s*pages?/i)?.[1]      // "26 pages" in info sheet sidebar
    || fieldSheet.match(/(\d{2,})\s*pages?/i)?.[1]
    || allText.match(/(?:total|document)\s*(?:of\s+)?(\d+)\s*pages?/i)?.[1]
    || '0'
  ), 10);

  // ── Instructions extraction (multiple fallback patterns) ──
  const instrMatch = fieldSheet.match(/Instructions\s*\n([\s\S]*?)(?:\n\s*\n\s*Address|\n\s*\n\s*\n|$)/i)
    || fieldSheet.match(/(?:Special Instructions|Service Instructions|Notes)[:\s]*\n([\s\S]*?)(?:\n\s*\n|$)/i)
    || infoSheet.match(/(?:Instructions|Service Notes)[:\s]*\n?([\s\S]*?)(?:\n\s*\n|$)/i);
  const instructions = instrMatch ? instrMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const orderingClientRule = instructions.split('.')[0].trim() + (instructions ? '.' : '');

  // ── ICU Field Sheet header parsing (structured) ──
  // The header has a very specific layout:
  //   Job:  15753566 (788691G)     Due:  04/30/2026
  //   Party to Serve:  NAME
  //   Server:  Christopher Zamora   Fee:  ____
  //   Case  26CU014094N    Plaintiff  Gilberto Rocha
  //   Court  North County Regional Center   Defendant  Real Salt Lake...

  // Job number from field sheet header
  const jobMatch = fieldSheet.match(/Job[:\s]+(\d+)\s*\(([A-Z0-9]+)\)/i)
    || fieldSheet.match(/(\d{7,})\s*\(([A-Z0-9]{5,})\)/i)
    || infoSheet.match(/JOB[:\s#]+(\d+)/i);
  const jobNumber = jobMatch?.[1] || '';
  const clientJobNumber = jobMatch?.[2]
    || (courtDocket.match(/\*S\d+(\d{6})\*/)?.[1] || '')
    || (courtDocket.match(/Case\s+(?:No\.?|Number|#)[:\s]*([A-Z0-9]+-?\d+[-A-Z0-9]*)/i)?.[1] || '');

  // (Field sheet structured labels hoisted earlier — see fsCase/fsPlaintiff/fsCourt above.)

  // Due date — field sheet, info sheet, or any "Due:" mention
  // Supports MM/DD/YYYY, ISO (YYYY-MM-DD), and written-month formats
  const MONTH_NAMES: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const normalizeDueDateStr = (raw: string): string => {
    if (!raw) return '';
    // Already MM/DD/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return raw;
    // ISO: YYYY-MM-DD → MM/DD/YYYY
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`;
    // Written month: "April 30, 2026" or "Apr 30, 2026"
    const writtenMatch = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
    if (writtenMatch) {
      const monthNum = MONTH_NAMES[writtenMatch[1].toLowerCase()];
      if (monthNum) return `${monthNum}/${writtenMatch[2].padStart(2, '0')}/${writtenMatch[3]}`;
    }
    return raw;
  };
  let dueDate = normalizeDueDateStr(
    fieldSheet.match(/Due[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]
    || infoSheet.match(/Due[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]
    || infoSheet.match(/Deadline[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]
    // ISO date format: Due: 2026-04-30
    || fieldSheet.match(/Due[:\s]*(\d{4}-\d{2}-\d{2})/i)?.[1]
    || infoSheet.match(/Due[:\s]*(\d{4}-\d{2}-\d{2})/i)?.[1]
    // Written month: Due: April 30, 2026
    || fieldSheet.match(/Due[:\s]*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/i)?.[1]
    || infoSheet.match(/Due[:\s]*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/i)?.[1]
    || infoSheet.match(/Deadline[:\s]*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/i)?.[1]
    || ''
  );

  // Signed/filed date — multiple patterns across all docs
  const signedDate = (
    courtDocket.match(/DATED\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/)?.[1]
    || courtDocket.match(/Filed[:\s]+([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/i)?.[1]
    || courtDocket.match(/(?:Signed|Entered|Issued)[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]
    || infoSheet.match(/Filed[:\s]+([^\n]{5,30})/i)?.[1]
    || info.filed
    || ''
  ).replace(/,\s*$/, '').trim();

  // Response deadline — try multiple phrasings
  const responseDeadlineDays = parseInt((
    courtDocket.match(/[Ww]ithin\s+(\d+)\s+(?:calendar\s+)?days?\s+(?:after|of|from)\s+service/)?.[1]
    || courtDocket.match(/(\d+)\s+days?\s+to\s+(?:answer|respond|appear)/i)?.[1]
    || '21'
  ), 10);

  // Service windows — broad matching across all docs
  const windows: string[] = [];
  if (/6\s*(?:AM|am|a\.m\.?)[\s-]*9\s*(?:AM|am|a\.m\.?)|(?:early\s+)?morning/i.test(allText)) windows.push('6AM-9AM');
  if (/9\s*(?:AM|am|a\.m\.?)[\s-]*6\s*(?:PM|pm|p\.m\.?)|(?:business|daytime|day\s*time)/i.test(allText)) windows.push('9AM-6PM');
  if (/6\s*(?:PM|pm|p\.m\.?)[\s-]*9\s*(?:PM|pm|p\.m\.?)|evening|after\s*(?:5|6)\s*(?:pm|p\.m\.?)/i.test(allText)) windows.push('6PM-9PM');
  if (/weekend|saturday|sunday/i.test(allText)) windows.push('WEEKEND REQUIRED');
  if (/24\s*(?:hour|hr)|any\s*time/i.test(allText)) { windows.length = 0; windows.push('24HR — ANY TIME'); }
  const serviceWindows = windows.join(', ');

  const serviceRulesSummary = summarizeRules(instructions);
  const jobActivity = parseJobActivity(infoSheet);
  // Court case number — try multiple patterns across all docs.
  // Court case numbers ALWAYS contain at least one digit (every
  // jurisdiction's docketing scheme prefixes the year or includes a
  // sequential numeric portion). We scrub the candidate against that
  // invariant at the end so a stray name token like "KEVIN" coming
  // through `info.case` (when the upstream ServeManager API
  // misreports a defendant first name as the case field) cannot
  // surface as "Case No. KEVIN" in the synthesized narrative.
  let courtCaseNumber = (
    fsCase  // Field sheet "Case  26CU014094N" — most reliable for ICU format
    || courtDocket.match(/Civil\s+No\.\s*([A-Z0-9-]+)/i)?.[1]
    || courtDocket.match(/(?:Civil\s+Action|Case)\s+(?:No\.?|Number|#)[:\s]*([A-Z0-9]+-?[:\-]?\d+[-A-Z0-9]*)/i)?.[1]
    || courtDocket.match(/(?:No\.|Docket)\s*:?\s*([A-Z0-9]{2,}-\d{2,}[-A-Z0-9]*)/i)?.[1]
    || infoSheet.match(/Case[:\s]+([A-Z0-9]+-?\d+[-A-Z0-9]*)/i)?.[1]
    || (info as any).case
    || ''
  ).trim();
  if (courtCaseNumber && !/\d/.test(courtCaseNumber)) {
    courtCaseNumber = '';
  }

  // County — try info sheet first, then court docket header
  const county = info.county
    || (courtDocket.match(/(?:IN AND FOR\s+)?(\w+)\s+COUNTY/i)?.[1] || '')
    || '';

  const vendorFingerprint = info.createdBy || (fieldSheet.match(/(ICU\s+Investigations[^,\n]*)/i)?.[1] || '');

  // ═══════════════════════════════════════════════════════════
  // UNIVERSAL SCANNER FALLBACKS — fill any gaps left by format-specific extraction
  // These run across ALL document text and pick the highest-confidence candidates
  // only when the primary extraction returned empty.
  // ═══════════════════════════════════════════════════════════

  // Defendant name — fallback to universal name scanner
  if (!defendant.first && !defendant.last) {
    const nameCandidates = scanForNames(allText);
    if (nameCandidates.length > 0) {
      const best = nameCandidates[0].value.replace(/,\s*an\s+individual.*$/i, '').replace(/-\s+/g, '-').trim();
      const parts = best.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        defendant.first = parts[0];
        defendant.last = parts[parts.length - 1];
        defendant.middle = parts.length >= 3 ? parts.slice(1, -1).join(' ') : '';
      } else if (parts.length === 1) {
        defendant.last = parts[0];
      }
    }
  }

  // Address — fallback to universal address scanner
  if (!address) {
    const addrCandidates = scanForAddresses(allText);
    if (addrCandidates.length > 0) {
      address = addrCandidates[0].value;
    }
  }

  // Plaintiff — fallback
  if (!plaintiff) {
    const pMatch = allText.match(/Plaintiff[:\s]+([A-Z][A-Za-z .'-]+?)(?:\s*,|\s*$)/im);
    if (pMatch) plaintiff = pMatch[1].trim();
  }

  // Court — fallback to universal court scanner
  if (!court) {
    const courtCandidates = scanForCourts(allText);
    if (courtCandidates.length > 0) court = courtCandidates[0].value;
  }

  // Court case number — fallback to universal scanner
  if (!courtCaseNumber) {
    const caseCandidates = scanForCaseNumbers(allText);
    if (caseCandidates.length > 0) {
      // Avoid picking up job numbers (7+ digits, no letters)
      const filtered = caseCandidates.filter(c => !/^\d{7,}$/.test(c.value));
      if (filtered.length > 0) courtCaseNumber = filtered[0].value;
    }
  }

  // Due date — fallback
  if (!dueDate) {
    const dateCandidates = scanForDates(allText);
    const dueDateCandidate = dateCandidates.find(d => d.source === 'due-date');
    if (dueDateCandidate) dueDate = dueDateCandidate.value;
  }

  // Attorney — fallback to universal email/phone scan
  if (!attorney.name) {
    // Look for "Esq." pattern anywhere
    const esqMatch = allText.match(/([A-Z][A-Za-z .]+\s+Esq\.?)/);
    if (esqMatch) {
      attorney.name = esqMatch[1].trim();
      // Grab nearby phone/email
      const nearby = allText.substring(Math.max(0, (esqMatch.index || 0) - 50), (esqMatch.index || 0) + 200);
      const emailCandidates = scanForEmails(nearby);
      if (emailCandidates.length > 0) attorney.email = emailCandidates[0].value;
      const phoneCandidates = scanForPhones(nearby);
      if (phoneCandidates.length > 0) attorney.tel = phoneCandidates[0].value.replace(/\D/g, '');
    }
  }

  // Clerk phone — fallback
  if (!clerkPhone) {
    const phoneCandidates = scanForPhones(allText);
    const clerkCandidate = phoneCandidates.find(p => p.source === 'clerk');
    if (clerkCandidate) clerkPhone = clerkCandidate.value;
  }

  // Recompute address parts if address changed via fallback
  const finalAddressParts = address !== addressParts.street ? parseAddressParts(address) : addressParts;

  return {
    defendant, address, addressParts: finalAddressParts, plaintiff, court, courtAddress, county,
    attorney, documents, primaryDoc, serviceType, instructions,
    jobNumber, clientJobNumber, dueDate, signedDate, responseDeadlineDays, clerkPhone,
    documentPages, bilingual, orderingClientRule, serviceWindows, serviceRulesSummary,
    jobActivity, courtCaseNumber, vendorFingerprint,
  };
}

function summarizeRules(instructions: string): string {
  instructions = boundForRegex(instructions);
  const bits: string[] = [];
  if (/sub-?serve.*?occupant\s*16\+|substitute.*?service/i.test(instructions)) bits.push('SUB-SERVE OK TO OCCUPANT 16+');
  if (/personal\s+service\s+only|personal.*?place\s+of\s+employment|personal.*?POE/i.test(instructions)) bits.push('PERSONAL SERVICE ONLY');
  if (/call.*?(?:phone|client|status)|notify.*?(?:client|attorney)/i.test(instructions)) bits.push('CALL CLIENT WITH STATUS AFTER EACH ATTEMPT');
  if (/hospitals?.*?churches?.*?jails?|do\s+not\s+serve\s+at/i.test(instructions)) bits.push('RESTRICTED SERVICE LOCATIONS');
  if (/BK\s*case\s*#|bankruptcy/i.test(instructions)) bits.push('IF SUBJECT HAS BANKRUPTCY -> STOP, DO NOT SERVE');
  if (/rush|urgent|expedit|asap|immediate/i.test(instructions)) bits.push('RUSH SERVICE REQUESTED');
  if (/skip\s*trace|locate|find/i.test(instructions)) bits.push('SKIP TRACE IF NOT AT ADDRESS');
  if (/photo|photograph|picture/i.test(instructions)) bits.push('PHOTO OF SERVICE REQUIRED');
  if (/gps|coordinate|pin\s*drop/i.test(instructions)) bits.push('GPS VERIFICATION REQUIRED');
  if (/leave.*?door|post.*?door|nail.*?door|tape.*?door/i.test(instructions)) bits.push('NAIL & MAIL / DOOR SERVICE AUTHORIZED');
  if (/certified\s*mail|registered\s*mail/i.test(instructions)) bits.push('CERTIFIED MAIL BACKUP');
  if (/do\s+not\s+(?:leave|post)|no\s+(?:posting|leaving)/i.test(instructions)) bits.push('DO NOT POST OR LEAVE DOCUMENTS');
  if (/3\s+attempts?\s+(?:done\s+)?on\s+3\s+different\s+days|diligence\s+is\s+3\s+attempts/i.test(instructions)) bits.push('3 ATTEMPTS ON 3 DIFFERENT DAYS (AM/PM/EVE)');
  if (/sub-?served?.*?(?:notify|mail|additional\s+copy)/i.test(instructions)) bits.push('IF SUB-SERVED: NOTIFY CLIENT + MAIL ADDITIONAL COPY');
  if (/competent\s+member.*?household.*?18|person.*?(?:over|above)\s+(?:the\s+age\s+of\s+)?18/i.test(instructions)) bits.push('SUB-SERVE TO HOUSEHOLD MEMBER 18+ OR PERSON IN CHARGE');
  return bits.join('. ') + (bits.length ? '.' : '');
}

export function parseAddressParts(address: string): AddressParts {
  const empty: AddressParts = { building: '', floor: '', suite: '', street: '', city: '', state: '', zip: '' };
  if (!address) return empty;
  address = boundForRegex(address);
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
  // Extract floor from address patterns instead of hardcoding
  const floorMatch = street.match(/\b(\d+)(?:ST|ND|RD|TH)\s+(?:FLOOR|FL)\b/i)
    || street.match(/\b(?:FLOOR|LEVEL|LVL)\.?\s*([A-Z0-9]+)\b/i)
    || street.match(/\bFL\.?\s+(\d+)\b/i);
  const floor = floorMatch ? floorMatch[1].toUpperCase() : '';
  return { building, floor, suite, street, city: city.toUpperCase(), state, zip };
}

// ═══════════════════════════════════════════════════════════════
// Address validation — checks for required components before geocoding.
// Returns a list of warnings. An empty list means the address looks valid.
// ═══════════════════════════════════════════════════════════════
export interface AddressValidation {
  valid: boolean;
  warnings: string[];
}

export function validateAddressFormat(address: string): AddressValidation {
  if (!address || address.trim().length < 5) {
    return { valid: false, warnings: ['Address is empty or too short'] };
  }
  const warnings: string[] = [];

  // Check for street number
  if (!/^\d+\s/.test(address.trim())) {
    warnings.push('Missing street number');
  }
  // Check for state abbreviation
  if (!/\b[A-Z]{2}\b/.test(address)) {
    warnings.push('Missing state abbreviation');
  }
  // Check for ZIP code
  if (!/\b\d{5}(?:-\d{4})?\b/.test(address)) {
    warnings.push('Missing ZIP code');
  }
  // Check for city (at least one comma separating components)
  if (!address.includes(',')) {
    warnings.push('Missing city/state separator — address may not geocode correctly');
  }

  return { valid: warnings.length === 0, warnings };
}

// ═══════════════════════════════════════════════════════════════
// Address normalization — expands common abbreviations for
// consistent duplicate detection across different address formats.
// ═══════════════════════════════════════════════════════════════
const STREET_ABBREVS: Record<string, string> = {
  'ST': 'STREET', 'AVE': 'AVENUE', 'BLVD': 'BOULEVARD', 'DR': 'DRIVE',
  'LN': 'LANE', 'RD': 'ROAD', 'CT': 'COURT', 'PL': 'PLACE',
  'CIR': 'CIRCLE', 'WAY': 'WAY', 'PKWY': 'PARKWAY', 'HWY': 'HIGHWAY',
  'TER': 'TERRACE', 'TRL': 'TRAIL', 'SQ': 'SQUARE',
};

const CITY_ABBREVS: Record<string, string> = {
  'SLC': 'SALT LAKE CITY', 'WVC': 'WEST VALLEY CITY', 'WJC': 'WEST JORDAN CITY',
  'WJ': 'WEST JORDAN', 'SJ': 'SOUTH JORDAN', 'PROVO': 'PROVO', 'OGDEN': 'OGDEN',
};

const DIRECTIONAL_ABBREVS: Record<string, string> = {
  'N': 'NORTH', 'S': 'SOUTH', 'E': 'EAST', 'W': 'WEST',
  'NE': 'NORTHEAST', 'NW': 'NORTHWEST', 'SE': 'SOUTHEAST', 'SW': 'SOUTHWEST',
};

// Pre-compiled regex patterns for normalizeAddress to avoid repeated construction
const STREET_PATTERNS = Object.entries(STREET_ABBREVS).map(([abbr, full]) => ({
  re: new RegExp(`\\b${abbr}\\.?(?=\\s*,|\\s+[A-Z]{2}\\s|$)`, 'g'),
  full,
}));
const DIRECTIONAL_PATTERNS = Object.entries(DIRECTIONAL_ABBREVS).map(([abbr, full]) => ({
  reAfterNum: new RegExp(`(?<=^\\d+\\s+)${abbr}\\.?\\b`, 'g'),
  reAfterComma: new RegExp(`(?<=,\\s*)${abbr}\\.?\\b(?=\\s)`, 'g'),
  full,
}));
const CITY_PATTERNS = Object.entries(CITY_ABBREVS).map(([abbr, full]) => ({
  re: new RegExp(`\\b${abbr}\\b(?=\\s*,)`, 'g'),
  full,
}));

export function normalizeAddress(address: string): string {
  if (!address) return '';
  let normalized = address.toUpperCase().trim();
  // Expand street type abbreviations (at word boundary, followed by comma or end/space+state)
  for (const { re, full } of STREET_PATTERNS) {
    normalized = normalized.replace(re, full);
  }
  // Expand directionals at start of street name or after street number
  for (const { reAfterNum, reAfterComma, full } of DIRECTIONAL_PATTERNS) {
    normalized = normalized.replace(reAfterNum, full);
    normalized = normalized.replace(reAfterComma, full);
  }
  // Expand city abbreviations
  for (const { re, full } of CITY_PATTERNS) {
    normalized = normalized.replace(re, full);
  }
  // Collapse multiple spaces and normalize separators
  normalized = normalized.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  // Strip trailing period
  normalized = normalized.replace(/\.\s*$/, '');
  return normalized;
}

// Compare two addresses for likely duplicates using normalization
export function addressesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  return na === nb;
}
