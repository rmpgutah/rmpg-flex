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
