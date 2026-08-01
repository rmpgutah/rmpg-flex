import { describe, it, expect } from 'vitest';
import { toDisplayLabel as workerLabel, ACRONYMS as workerAcronyms } from '../src/utils/displayLabel';
import { toDisplayLabel as clientLabel, ACRONYMS as clientAcronyms } from '../client/src/utils/formatters';

// The Worker and the React client share no build, so src/utils/displayLabel.ts
// is a deliberate mirror of client/src/utils/formatters.ts. This test is the
// only thing preventing the two copies from drifting apart — a label that
// renders "PSO Client Request" in the SPA must render identically in a
// Worker-generated notification or TTS phrase.
describe('worker/client display-label parity', () => {
  it('exposes the same acronym set', () => {
    expect([...workerAcronyms].sort()).toEqual([...clientAcronyms].sort());
  });

  const CASES = [
    'pso_client_request',
    'in_progress',
    'dv_in_progress',
    'active_warrant',
    'ems_dispatch',
    'alpr_read',
    'cad_update',
    'swat_response',
    'k9_handler',
    'vin_check',
    'sor_match',
    'doc_release',
    'offense_level',
    'dl_status',
    'underReview',
    'supplementType',
    'third_degree_felony',
    'not_stolen',
    'client_viewer',
    'N/A',
    '—',
    '',
  ];

  it('produces identical output for every representative label', () => {
    for (const c of CASES) {
      expect(workerLabel(c), `mismatch for ${JSON.stringify(c)}`).toBe(clientLabel(c));
    }
  });

  it('agrees on null/undefined and on the hyphen-collapse trap', () => {
    expect(workerLabel(null)).toBe(clientLabel(null));
    expect(workerLabel(undefined)).toBe(clientLabel(undefined));
    // Both collapse hyphen-only placeholders — fallbacks belong OUTSIDE the call.
    expect(workerLabel('--')).toBe('');
    expect(clientLabel('--')).toBe('');
  });

  it('agrees per-acronym so a one-sided addition fails loudly', () => {
    for (const a of workerAcronyms) {
      expect(workerLabel(`${a}_check`), `acronym ${a}`).toBe(clientLabel(`${a}_check`));
    }
  });
});
