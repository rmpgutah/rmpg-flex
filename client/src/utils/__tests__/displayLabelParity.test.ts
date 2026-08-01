import { describe, it, expect } from 'vitest';
import { toDisplayLabel as clientLabel, ACRONYMS as clientAcronyms } from '../formatters';
// The Worker's mirror of this module. Dependency-free pure TS, so pulling it
// into the client program is safe.
//
// ⚠️ This test MUST live on the client side, not in tests/. The Worker's
// tsconfig.test.json (`types: ["node", "@cloudflare/workers-types"]`, no DOM,
// no react) type-checks tests/**, so a worker-side test importing
// client/src/utils/formatters drags the whole client module graph into the
// Worker's type environment and detonates it — `Cannot find name 'window'`,
// `Cannot find module 'react'`, hundreds of errors. The client tsconfig is the
// permissive one (DOM + react), so parity is checked in this direction only.
// Note `npm run typecheck` is `tsc --noEmit && tsc -p tsconfig.test.json
// --noEmit`; only the second pass covers tests/, so `tsc -p tsconfig.json`
// alone does NOT catch that.
import { toDisplayLabel as workerLabel, ACRONYMS as workerAcronyms } from '../../../../src/utils/displayLabel';

// src/utils/displayLabel.ts is a deliberate mirror of formatters.ts because the
// Worker and the React client share no build. This test is the only thing
// preventing the two copies from drifting: a label that renders
// "PSO Client Request" in the SPA must render identically in a
// Worker-generated notification, client email or TTS phrase.
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
