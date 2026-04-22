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
