// Unit tests for the formatters utility — locks the input-masking
// contract used by every phone/fax field across the app.

import { describe, it, expect } from 'vitest';
import {
  formatPhoneInput, formatPhone,
  toDisplayLabel, toSpokenLabel, formatLabel, toTitleCase,
} from '../formatters';
import { humanizeType, titleCase, cleanDisplay } from '../statusLabels';

describe('formatPhoneInput (live input masking)', () => {
  it('returns empty string for empty input', () => {
    expect(formatPhoneInput('')).toBe('');
  });

  it('progressively formats as the user types', () => {
    expect(formatPhoneInput('8')).toBe('(8');
    expect(formatPhoneInput('801')).toBe('(801');
    expect(formatPhoneInput('8015')).toBe('(801) 5');
    expect(formatPhoneInput('801555')).toBe('(801) 555');
    expect(formatPhoneInput('8015551')).toBe('(801) 555-1');
    expect(formatPhoneInput('8015551234')).toBe('(801) 555-1234');
  });

  it('strips non-digit characters', () => {
    expect(formatPhoneInput('801-555-1234')).toBe('(801) 555-1234');
    expect(formatPhoneInput('(801) 555 1234')).toBe('(801) 555-1234');
    expect(formatPhoneInput('801.555.1234')).toBe('(801) 555-1234');
  });

  it('strips a leading 1 country code', () => {
    expect(formatPhoneInput('18015551234')).toBe('(801) 555-1234');
    expect(formatPhoneInput('+1 (801) 555-1234')).toBe('(801) 555-1234');
  });

  it('caps input at 10 digits — extra digits are ignored', () => {
    expect(formatPhoneInput('80155512349999')).toBe('(801) 555-1234');
  });

  it('is idempotent on already-formatted values', () => {
    const out = formatPhoneInput('(801) 555-1234');
    expect(formatPhoneInput(out)).toBe('(801) 555-1234');
  });
});

describe('formatPhone (display formatter)', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone(undefined)).toBe('');
    expect(formatPhone('')).toBe('');
  });

  it('formats raw 10-digit strings', () => {
    expect(formatPhone('8015551234')).toBe('(801) 555-1234');
  });

  it('strips a leading 1 from 11-digit numbers', () => {
    expect(formatPhone('18015551234')).toBe('(801) 555-1234');
  });

  it('returns the raw input when it cannot be formatted', () => {
    expect(formatPhone('123')).toBe('123');
    expect(formatPhone('extension 1234')).toBe('extension 1234');
  });
});

// ── Acronym-aware labels (PSO must never render as "Pso") ──────────
// Regression guard for the "weak lowercase acronym" bug: any label that
// presents as PSO Client Request must show "PSO Client Request" visually
// and announce "P. S. O. Client Request" when spoken.
describe('acronym-aware display labels', () => {
  it('toDisplayLabel keeps acronyms ALL-CAPS', () => {
    expect(toDisplayLabel('pso_client_request')).toBe('PSO Client Request');
    expect(toDisplayLabel('dv_in_progress')).toBe('DV In Progress');
    expect(toDisplayLabel('active_warrant')).toBe('Active Warrant');
    expect(toDisplayLabel('ems_dispatch')).toBe('EMS Dispatch');
  });

  // Regression guard for the newly-added law-enforcement acronyms. If any of
  // these regress, dispatch/ALPR/records surfaces would render "Alpr Read"
  // or "Swat Response" instead of "ALPR Read" / "SWAT Response".
  it('toDisplayLabel covers the extended LE acronym set', () => {
    expect(toDisplayLabel('alpr_read')).toBe('ALPR Read');
    expect(toDisplayLabel('cad_update')).toBe('CAD Update');
    expect(toDisplayLabel('swat_response')).toBe('SWAT Response');
    expect(toDisplayLabel('k9_handler')).toBe('K9 Handler');
    expect(toDisplayLabel('cdl_violation')).toBe('CDL Violation');
    expect(toDisplayLabel('vin_check')).toBe('VIN Check');
    expect(toDisplayLabel('sor_match')).toBe('SOR Match');
    expect(toDisplayLabel('doc_release')).toBe('DOC Release');
    expect(toDisplayLabel('mva_report')).toBe('MVA Report');
    expect(toDisplayLabel('fbi_lookup')).toBe('FBI Lookup');
  });

  // Regression for the PersonHistoryPanel screenshot bug: a local `formatType`
  // helper was returning raw lowercase `pso client request` for the dispatch
  // calls list. Direct call mirrors the production code path now (toDisplayLabel
  // imported from formatters).
  it('renders the PersonHistoryPanel dispatch-calls case correctly', () => {
    expect(toDisplayLabel('pso_client_request')).toBe('PSO Client Request');
    expect(toDisplayLabel('officer_assist')).toBe('Officer Assist');
    expect(toDisplayLabel('alarm_response')).toBe('Alarm Response');
  });

  it('formatLabel keeps acronyms ALL-CAPS', () => {
    expect(formatLabel('pso_client_request')).toBe('PSO Client Request');
  });

  it('toTitleCase uppercases acronyms but preserves names', () => {
    expect(toTitleCase('pso client request')).toBe('PSO Client Request');
    expect(toTitleCase('McDonald')).toBe('McDonald');
  });

  it('statusLabels resolvers route unmapped values through the acronym path', () => {
    // pso_client_request is in the map (already correct); an UNMAPPED future
    // PSO type must still come back proper via the fallback.
    expect(humanizeType('pso_client_request')).toBe('PSO Client Request');
    expect(humanizeType('pso_rush_request')).toBe('PSO Rush Request');
    expect(titleCase('cfs_review')).toBe('CFS Review');
    expect(cleanDisplay('ncic_hit')).toBe('NCIC Hit');
  });
});

describe('toSpokenLabel (TTS — spell out acronyms)', () => {
  it('spells PSO as letters so the voice never says "Pso"', () => {
    expect(toSpokenLabel('pso_client_request')).toBe('P. S. O. Client Request');
    expect(toSpokenLabel('dv_in_progress')).toBe('D. V. In Progress');
  });

  it('leaves non-acronym labels as ordinary words', () => {
    expect(toSpokenLabel('active_warrant')).toBe('Active Warrant');
  });
});
