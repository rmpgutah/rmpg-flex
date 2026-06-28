// ============================================================
// genericDiscovery — entity-level fallback when no extractor matches
// ============================================================
// "Hyper advanced learning" layer — when the kind-specific
// extractor finds zero anchors (or when kind = unknown), we still
// surface useful structured candidates by running the existing
// serveIntakeHelpers scanners (names, addresses, phones, emails,
// dates, case numbers, courts) plus the attorney-block parser.
//
// Result: a clerk who drops an unrecognized document gets a list
// of discovered entities to assign manually — never a blank
// "0 fields extracted" screen. The candidates carry a `source`
// label (e.g., "label" / "caption" / "phone-pattern") so the UI
// can show *why* a value was picked.
//
// Confidence model: scanner candidates are normalized to 0–1 from
// their internal 0–100 scale and capped at 0.5 — they're
// inherently lower-trust than anchor-matched fields, which is the
// honest signal to the clerk that these need more review.

import {
  scanForNames, scanForAddresses, scanForPhones,
  scanForEmails, scanForDates, scanForCaseNumbers, scanForCourts,
  extractAttorneyBlock,
} from '../serveIntakeHelpers';
import type { ExtractedField } from './types';

const MAX_PER_KIND = 5; // cap candidates per scanner type so the UI doesn't drown

export function discoverEntities(text: string): ExtractedField[] {
  const out: ExtractedField[] = [];
  const cap = (raw: number): number => Math.min(0.5, raw / 100);

  // Names — highest operational value for review (clerks need to
  // know who the document is about). Order by scanner confidence,
  // emit top N as discovered_party_1..N.
  const names = scanForNames(text).slice(0, MAX_PER_KIND);
  names.forEach((n, i) => out.push({
    key: `discovered_party_${i + 1}`,
    value: n.value,
    confidence: cap(n.confidence),
    matchedAnchor: `Discovered Party (${n.source})`,
  }));

  // Addresses
  const addresses = scanForAddresses(text).slice(0, MAX_PER_KIND);
  addresses.forEach((a, i) => out.push({
    key: `discovered_address_${i + 1}`,
    value: a.value,
    confidence: cap(a.confidence),
    matchedAnchor: `Discovered Address (${a.source})`,
  }));

  // Phones
  const phones = scanForPhones(text).slice(0, MAX_PER_KIND);
  phones.forEach((p, i) => out.push({
    key: `discovered_phone_${i + 1}`,
    value: p.value,
    confidence: cap(p.confidence),
    matchedAnchor: `Discovered Phone (${p.source})`,
  }));

  // Emails
  const emails = scanForEmails(text).slice(0, MAX_PER_KIND);
  emails.forEach((e, i) => out.push({
    key: `discovered_email_${i + 1}`,
    value: e.value,
    confidence: cap(e.confidence),
    matchedAnchor: `Discovered Email (${e.source})`,
  }));

  // Dates
  const dates = scanForDates(text).slice(0, MAX_PER_KIND);
  dates.forEach((d, i) => out.push({
    key: `discovered_date_${i + 1}`,
    value: d.value,
    confidence: cap(d.confidence),
    matchedAnchor: `Discovered Date (${d.source})`,
  }));

  // Case numbers
  const caseNumbers = scanForCaseNumbers(text).slice(0, MAX_PER_KIND);
  caseNumbers.forEach((c, i) => out.push({
    key: `discovered_case_number_${i + 1}`,
    value: c.value,
    confidence: cap(c.confidence),
    matchedAnchor: `Discovered Case # (${c.source})`,
  }));

  // Courts (usually just one)
  const courts = scanForCourts(text).slice(0, 2);
  courts.forEach((co, i) => out.push({
    key: `discovered_court_${i + 1}`,
    value: co.value,
    confidence: cap(co.confidence),
    matchedAnchor: `Discovered Court (${co.source})`,
  }));

  // Attorney block — single result; only emit if any field present
  const attorney = extractAttorneyBlock(text);
  if (attorney.name) out.push({
    key: 'discovered_attorney_name', value: attorney.name,
    confidence: 0.5, matchedAnchor: 'Discovered Attorney Name',
  });
  if (attorney.firm) out.push({
    key: 'discovered_attorney_firm', value: attorney.firm,
    confidence: 0.5, matchedAnchor: 'Discovered Attorney Firm',
  });
  if (attorney.barNumber) out.push({
    key: 'discovered_attorney_bar_number', value: attorney.barNumber,
    confidence: 0.5, matchedAnchor: 'Discovered Attorney Bar #',
  });
  // AttorneyBlock splits the address across two lines; rejoin for
  // the discovered field so the UI shows a single address row.
  const addr = [attorney.addressLine1, attorney.addressLine2].filter(Boolean).join(', ');
  if (addr) out.push({
    key: 'discovered_attorney_address', value: addr,
    confidence: 0.5, matchedAnchor: 'Discovered Attorney Address',
  });
  if (attorney.tel) out.push({
    key: 'discovered_attorney_phone', value: attorney.tel,
    confidence: 0.5, matchedAnchor: 'Discovered Attorney Phone',
  });
  if (attorney.email) out.push({
    key: 'discovered_attorney_email', value: attorney.email,
    confidence: 0.5, matchedAnchor: 'Discovered Attorney Email',
  });

  return out;
}
