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
  const clauses = (i.documents || '').split(/\s*;\s*/).map(s => s.trim()).filter(Boolean);
  const docCount = clauses.length;
  const docList = clauses.map(c => c.toUpperCase().replace(/\s+AND\s+/g, ' + ')).join(' + ');

  // ═══════════════════════════════════════════════════════════
  // NOTE 1: 🚨 OFFICER ALERT ESSENTIALS (quick-scan at the door)
  // ═══════════════════════════════════════════════════════════
  const alertLines: string[] = [];
  alertLines.push('🚨 OFFICER ALERT ESSENTIALS');
  alertLines.push('═'.repeat(50));
  alertLines.push(`SERVICE TYPE: ${up(i.orderingClientRule).split('.')[0] || 'PROCESS SERVICE'}`);
  alertLines.push(`SERVE TO: NAMED DEFENDANT ONLY — ${i.bilingual ? 'BILINGUAL DOCS' : 'ENGLISH ONLY'}`);
  alertLines.push(`DUE: ${i.dueDate || 'NO DEADLINE'}${i.daysRemaining > 0 ? ` (${i.daysRemaining} DAYS REMAINING)` : i.daysRemaining === 0 ? ' ⚠️ DUE TODAY' : ''}`);
  if (i.serviceRulesSummary) {
    alertLines.push('');
    alertLines.push('⚠️ RESTRICTIONS:');
    i.serviceRulesSummary.split('. ').filter(Boolean).forEach(r => {
      alertLines.push(`  • ${r.endsWith('.') ? r : r + '.'}`);
    });
  }
  if (i.serviceWindows) alertLines.push(`\nSERVICE WINDOWS: ${up(i.serviceWindows)}`);
  alertLines.push(`\nDOCUMENTS: ${docCount} DOC${docCount !== 1 ? 'S' : ''} (${i.documentPages} PAGES) — ${docList}`);
  const alertNote = alertLines.join('\n');

  // ═══════════════════════════════════════════════════════════
  // NOTE 2: 📋 RECOMMENDED DILIGENCE SCHEDULE
  // ═══════════════════════════════════════════════════════════
  const schedLines: string[] = [];
  schedLines.push('📋 RECOMMENDED DILIGENCE SCHEDULE');
  schedLines.push('═'.repeat(50));
  schedLines.push(`DEADLINE: ${i.dueDate || 'NONE'} | DAYS REMAINING: ${i.daysRemaining}`);
  schedLines.push(`WINDOWS: ${up(i.serviceWindows) || 'STANDARD (6AM-9AM, 9AM-6PM, 6PM-9PM)'}`);
  schedLines.push('');
  if (i.recommendedAttempts.length > 0) {
    schedLines.push('PLANNED ATTEMPTS:');
    i.recommendedAttempts.forEach((a, idx) => {
      schedLines.push(`  ATTEMPT ${idx + 1}: ${a.label}${a.weekend ? ' [WEEKEND]' : ''}`);
    });
  } else {
    schedLines.push('NO AUTOMATED SCHEDULE — deadline may be in the past or not set.');
    schedLines.push('MANUALLY PLAN 3 ATTEMPTS ON 3 DIFFERENT DAYS:');
    schedLines.push('  1. Morning attempt (before 10:00 AM)');
    schedLines.push('  2. Afternoon attempt (10:00 AM - 5:00 PM)');
    schedLines.push('  3. Evening attempt (after 4:00 PM)');
  }
  schedLines.push('');
  schedLines.push('AFTER EACH ATTEMPT: Log result in serve queue. If sub-served, notify client IMMEDIATELY.');
  const schedNote = schedLines.join('\n');

  // ═══════════════════════════════════════════════════════════
  // NOTE 3: 📂 CASE DETAILS (legal reference)
  // ═══════════════════════════════════════════════════════════
  const caseLines: string[] = [];
  caseLines.push('📂 CASE DETAILS');
  caseLines.push('═'.repeat(50));
  caseLines.push(`CASE #: ${i.clientJobNumber || 'N/A'}`);
  caseLines.push(`PLAINTIFF: ${up(i.plaintiff)}`);
  caseLines.push(`DOCUMENTS: ${docList}`);
  caseLines.push(`PAGES: ${i.documentPages}${i.bilingual ? ' (BILINGUAL)' : ''}`);
  caseLines.push(`SIGNED/FILED: ${up(i.signedDate) || 'N/A'}`);
  caseLines.push(`RESPONSE DEADLINE: ${i.responseDeadlineDays} DAYS AFTER SERVICE`);
  caseLines.push('');
  caseLines.push(`COURT: ${up(i.court)}`);
  if (i.courtAddress) caseLines.push(`COURT ADDRESS: ${up(i.courtAddress)}`);
  if (i.clerkPhone) caseLines.push(`CLERK PHONE: ${i.clerkPhone}`);
  caseLines.push('');
  if (i.attorney.name) {
    caseLines.push(`ATTORNEY: ${up(i.attorney.name)}`);
    if (i.attorney.firm) caseLines.push(`FIRM: ${up(i.attorney.firm)}`);
    if (i.attorney.barNumber) caseLines.push(`BAR #: ${i.attorney.barNumber}`);
    const attyAddr = [i.attorney.addressLine1, i.attorney.addressLine2].filter(Boolean).join(', ');
    if (attyAddr) caseLines.push(`ADDRESS: ${up(attyAddr)}`);
    if (i.attorney.tel) caseLines.push(`PHONE: ${i.attorney.tel}`);
    if (i.attorney.email) caseLines.push(`EMAIL: ${i.attorney.email}`);
  }
  const caseNote = caseLines.join('\n');

  // ═══════════════════════════════════════════════════════════
  // NOTE 4: ☕ CASE SUMMARY (the "tea spill" — plain English brief)
  // ═══════════════════════════════════════════════════════════
  const teaLines: string[] = [];
  teaLines.push('☕ CASE SUMMARY');
  teaLines.push('═'.repeat(50));
  // Build a human-readable summary of what this case is about
  const plaintiffShort = (i.plaintiff || 'The plaintiff').split(',')[0].trim();
  const serviceDesc = (i.orderingClientRule || '').replace(/\.$/, '').trim();
  const docDesc = clauses.length > 0
    ? clauses.map(c => c.toLowerCase()).join(' and ')
    : 'legal documents';
  teaLines.push(`${plaintiffShort} is suing and needs ${docDesc} served.`);
  teaLines.push('');
  teaLines.push(`The defendant needs to be personally served at their residence.`);
  if (i.dueDate) {
    teaLines.push(`Service must be completed by ${i.dueDate} (${i.daysRemaining} days from now).`);
  }
  if (i.responseDeadlineDays) {
    teaLines.push(`Once served, the defendant has ${i.responseDeadlineDays} days to respond to the court.`);
  }
  teaLines.push('');
  // Service approach summary
  if (/personal\s+(?:service\s+)?only/i.test(i.instructionsVerbatim)) {
    teaLines.push('⚠️ PERSONAL SERVICE ONLY — cannot leave with another person on first attempts.');
  }
  if (/sub-?serve/i.test(i.instructionsVerbatim)) {
    teaLines.push('After diligence (3 attempts on different days/times), sub-service to a competent adult (18+) at the residence or workplace is allowed.');
  }
  if (/notify.*?immediately|please notify/i.test(i.instructionsVerbatim)) {
    teaLines.push('📞 If sub-served: CALL THE CLIENT IMMEDIATELY so they can mail an additional copy.');
  }
  if (i.court) {
    teaLines.push(`\nThis case is filed in ${i.court}.`);
  }
  teaLines.push(`\n[Auto-generated ${i.timestamp}]`);
  const teaNote = teaLines.join('\n');

  // ═══════════════════════════════════════════════════════════
  // NOTE 5: 🕐 CLIENT HISTORY + INSTRUCTIONS (reference)
  // ═══════════════════════════════════════════════════════════
  const refLines: string[] = [];
  refLines.push('🕐 CLIENT HISTORY & INSTRUCTIONS');
  refLines.push('═'.repeat(50));
  if (i.jobActivity.length > 0) {
    refLines.push('JOB ACTIVITY:');
    i.jobActivity.forEach(e => {
      refLines.push(`  ${e.when} — ${e.action}${e.detail ? ': ' + e.detail : ''}`);
    });
    refLines.push('');
  }
  refLines.push('VERBATIM INSTRUCTIONS:');
  refLines.push(i.instructionsVerbatim || '(none provided)');
  const refNote = refLines.join('\n');

  return [
    { text: alertNote },
    { text: schedNote },
    { text: caseNote },
    { text: teaNote },
    { text: refNote },
  ];
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
}

export function parseAllDocuments(src: ParseInput): ParseOutput {
  const { fieldSheet, infoSheet, courtDocket } = src;
  const allText = [fieldSheet, infoSheet, courtDocket].filter(Boolean).join('\n\n');

  const info = parseInfoSheetLabels(infoSheet);
  // Attorney: try court docket first (most structured), then all text
  let attorney = extractAttorneyBlock(courtDocket);
  if (!attorney.name && allText) {
    attorney = extractAttorneyBlock(allText);
  }

  // ── Defendant name extraction (multi-source fallback) ──
  const ptsMatch = fieldSheet.match(/Party to Serve[:\s]+([^\n]+)/i)
    || infoSheet.match(/Recipient[:\s]+([^\n]+)/i)
    || courtDocket.match(/(?:vs?\.?|versus)\s*\n?\s*([A-Z][A-Za-z ,.'-]+?)(?:\s*,\s*(?:an individual|Defendant|et al))/i)
    || courtDocket.match(/Defendant[:\s]+([^\n]+)/i);
  let rawPartyName = (ptsMatch?.[1] || info.defendant || '')
    .replace(/,\s*an\s+individual.*$/i, '')
    .replace(/,?\s*(?:Defendant|et al\.?)$/i, '')
    .replace(/^\s*Recipient[:\s]*/i, '')  // Strip "Recipient:" prefix that sometimes bleeds in
    .trim();
  // Strip trailing noise: "aka", "dba", court case numbers
  rawPartyName = rawPartyName.replace(/\s+(?:aka|a\.k\.a|dba|d\.b\.a)\.?\s+.*$/i, '').trim();
  // Rejoin hyphenated names split by pdftotext: "Campbell- Ryce" → "Campbell-Ryce"
  rawPartyName = rawPartyName.replace(/-\s+/g, '-');
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
  const defendant = {
    first: nameParts[0] || '',
    middle: nameParts.length >= 3 ? nameParts.slice(1, -1).join(' ') : '',
    last: nameParts[nameParts.length - 1] || '',
    dob,
  };

  // ── Address extraction — FIELD SHEET IS AUTHORITATIVE ──
  // The field sheet "Address" block is the service address. Court docket addresses
  // are often the COURT's address (e.g., Vista, CA) not the defendant's residence.
  // Only fall back to court docket for "residing at" patterns that clearly reference the defendant.
  let address = '';
  // 1. Field sheet — look for "Address" label followed by a line with a street address
  const fsAddrBlock = fieldSheet.match(/Address\s*\n([^\n]+)/i);
  if (fsAddrBlock) {
    const candidate = fsAddrBlock[1].trim();
    // Must start with a number (street address) — reject names like "Jamal Campbell-Ryce"
    if (/^\d+\s+\w/.test(candidate)) address = candidate;
  }
  // 2. Field sheet — standard address pattern anywhere
  if (!address) {
    const fsAddr = fieldSheet.match(/(\d+\s+[A-Za-z][^\n]*?,\s*[A-Za-z .]+,\s*(?:UT|Utah|CO|AZ|NV|ID|WY|NM|CA|TX|FL|IL|NY)\s*\d{5}(?:-\d{4})?)/i);
    if (fsAddr) address = fsAddr[1].trim();
  }
  // 3. Info sheet "Address" / "Recipient Address" label
  if (!address) {
    const isAddr = infoSheet.match(/(?:Address|Service Address|Recipient Address)[:\s]+([^\n]*?\d{5}(?:-\d{4})?)/i);
    if (isAddr) address = isAddr[1].trim();
  }
  // 4. Court docket — ONLY "residing at" / "resides at" (defendant address, not court address)
  if (!address) {
    const cdAddr = courtDocket.match(/(?:resid(?:es|ing)\s+at|located\s+at)[:\s]+(\d+\s+\w[^\n]{5,80},\s*[A-Za-z .]+,?\s*[A-Z]{2}\s*\d{5})/i);
    if (cdAddr) address = cdAddr[1].trim();
  }
  const addressParts = parseAddressParts(address);

  // ── Plaintiff extraction (multi-source) ──
  let plaintiff = info.plaintiff;
  if (!plaintiff) {
    // Standard docket caption: "NAME,\n  Plaintiff,"
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
  let court = info.court;
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
  const clerkPhone = clerkMatch ? `(${clerkMatch[1]}) ${clerkMatch[2]}-${clerkMatch[3]}` : '';

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

  // ── Job numbers (ICU Job + client subordinate job#) ──
  // Format: "Job: 15753566 (788691G)" — job# is digits, client# may have letters
  const jobMatch = fieldSheet.match(/Job[:\s#]+(\d+)\s*\(([A-Z0-9]+)\)/i)
    || fieldSheet.match(/(\d{7,})\s*\(([A-Z0-9]{5,})\)/i)
    || infoSheet.match(/JOB[:\s#]+(\d+)/i);
  const jobNumber = jobMatch?.[1] || '';
  const clientJobNumber = jobMatch?.[2]
    || (courtDocket.match(/\*S\d+(\d{6})\*/)?.[1] || '')
    || (courtDocket.match(/Case\s+(?:No\.?|Number|#)[:\s]*([A-Z0-9]+-?\d+[-A-Z0-9]*)/i)?.[1] || '');

  // Due date — field sheet, info sheet, or any "Due:" mention
  const dueDate = (fieldSheet.match(/Due[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]
    || infoSheet.match(/Due[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]
    || infoSheet.match(/Deadline[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]
    || '');

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
  // Court case number — try multiple patterns across all docs
  const courtCaseNumber = (
    courtDocket.match(/Civil\s+No\.\s*([A-Z0-9-]+)/i)?.[1]
    || courtDocket.match(/Case\s+(?:No\.?|Number|#)[:\s]*([A-Z0-9]+-?\d+[-A-Z0-9]*)/i)?.[1]
    || courtDocket.match(/(?:No\.|Docket)\s*:?\s*([A-Z0-9]{2,}-\d{2,}[-A-Z0-9]*)/i)?.[1]
    || infoSheet.match(/Case[:\s]+([A-Z0-9]+-?\d+[-A-Z0-9]*)/i)?.[1]
    || (info as any).case
    || ''
  ).trim();

  // County — try info sheet first, then court docket header
  const county = info.county
    || (courtDocket.match(/(?:IN AND FOR\s+)?(\w+)\s+COUNTY/i)?.[1] || '')
    || '';

  const vendorFingerprint = info.createdBy || (fieldSheet.match(/(ICU\s+Investigations[^,\n]*)/i)?.[1] || '');

  return {
    defendant, address, addressParts, plaintiff, court, courtAddress, county,
    attorney, documents, primaryDoc, serviceType, instructions,
    jobNumber, clientJobNumber, dueDate, signedDate, responseDeadlineDays, clerkPhone,
    documentPages, bilingual, orderingClientRule, serviceWindows, serviceRulesSummary,
    jobActivity, courtCaseNumber, vendorFingerprint,
  };
}

function summarizeRules(instructions: string): string {
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
