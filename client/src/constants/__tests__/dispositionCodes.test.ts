// Locks in the disposition source-of-truth contract:
//   • DISPOSITION_GROUPS = 4 general groups, no PS codes.
//   • PSO_DISPOSITION_GROUPS = 10 PS categories (53 codes from processServiceCodes).
//   • dispositionGroupsForIncident():
//       – PSO/process-service calls → PSO_DISPOSITION_GROUPS only (not a mix).
//       – All other calls           → DISPOSITION_GROUPS only (no PS codes).
//   • Lookup maps (DEFAULT_DISPOSITION_CODES / DESCRIPTION / COLOR) cover ALL
//     codes: general + PSO + legacy PS/0## backward-compat.
import { describe, it, expect } from 'vitest';
import {
  DISPOSITION_GROUPS,
  PSO_DISPOSITION_GROUPS,
  DEFAULT_DISPOSITIONS,
  DEFAULT_DISPOSITION_CODES,
  dispositionGroupsForIncident,
} from '../dispositionCodes';

describe('disposition codes', () => {
  it('general groups have no duplicate codes', () => {
    const codes = DISPOSITION_GROUPS.flatMap((g) => g.codes).map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('PSO groups have no duplicate codes', () => {
    const codes = PSO_DISPOSITION_GROUPS.flatMap((g) => g.codes).map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('general groups contain no process-service codes', () => {
    const allGeneral = DISPOSITION_GROUPS.flatMap((g) => g.codes);
    expect(allGeneral.every((d) => !d.code.startsWith('PS/'))).toBe(true);
    expect(DISPOSITION_GROUPS.some((g) => g.processService)).toBe(false);
  });

  it('PSO groups all carry processService:true', () => {
    expect(PSO_DISPOSITION_GROUPS.every((g) => g.processService === true)).toBe(true);
  });

  it('DEFAULT_DISPOSITIONS equals the flat list of general groups (non-PSO fallback)', () => {
    const fromGeneralGroups = DISPOSITION_GROUPS.flatMap((g) => g.codes);
    expect(DEFAULT_DISPOSITIONS).toEqual(fromGeneralGroups);
  });

  it('DEFAULT_DISPOSITION_CODES is a superset covering general + PSO + legacy codes', () => {
    // General mnemonic codes
    for (const code of ['RTF', 'GOA', 'ARR', 'CIT', 'UTL']) {
      expect(DEFAULT_DISPOSITION_CODES.has(code)).toBe(true);
    }
    // New structured PSO codes (PS/##.##)
    for (const code of ['PS/05.01', 'PS/10.01', 'PS/00.01', 'PS/15.01', 'PS/40.01']) {
      expect(DEFAULT_DISPOSITION_CODES.has(code)).toBe(true);
    }
    // Legacy PS/0## codes (backward-compat — stored on pre-v1249 CFS records)
    for (const code of ['PS/055', 'PS/060', 'PS/065', 'PS/080', 'PS/115']) {
      expect(DEFAULT_DISPOSITION_CODES.has(code)).toBe(true);
    }
    // Old verbose phrase-codes must be absent
    expect(DEFAULT_DISPOSITION_CODES.has('Report Taken')).toBe(false);
    expect(DEFAULT_DISPOSITION_CODES.has('PS Served')).toBe(false);
  });

  it('PSO codes follow the PS/##.## structured format', () => {
    const psoCodes = PSO_DISPOSITION_GROUPS.flatMap((g) => g.codes);
    for (const d of psoCodes) {
      expect(d.code).toMatch(/^PS\/\d{2}\.\d{2}$/);
    }
  });

  it('PSO groups cover all 10 categories from processServiceCodes', () => {
    expect(PSO_DISPOSITION_GROUPS.length).toBe(10);
    const labels = PSO_DISPOSITION_GROUPS.map((g) => g.label);
    expect(labels.some((l) => l.includes('Non-Service'))).toBe(true);
    expect(labels.some((l) => l.includes('Personal Service'))).toBe(true);
    expect(labels.some((l) => l.includes('Administrative'))).toBe(true);
  });

  it('returns ONLY PSO groups for process-service calls (no general dispositions)', () => {
    for (const t of ['pso_client_request', 'process_service', 'civil_paper_service']) {
      const groups = dispositionGroupsForIncident(t);
      expect(groups.length).toBe(PSO_DISPOSITION_GROUPS.length);
      expect(groups.every((g) => g.processService === true)).toBe(true);
      // Confirms general codes (RTF, ARR, etc.) are absent
      const allCodes = groups.flatMap((g) => g.codes).map((d) => d.code);
      expect(allCodes.some((c) => c === 'RTF')).toBe(false);
    }
  });

  it('preserves natural order for non-process-service calls, no PS codes', () => {
    const groups = dispositionGroupsForIncident('burglary');
    expect(groups).toEqual(DISPOSITION_GROUPS);
    expect(groups[0].label).toBe('Common Dispositions');
    // No PS codes leak into general calls
    const allCodes = groups.flatMap((g) => g.codes).map((d) => d.code);
    expect(allCodes.some((c) => c.startsWith('PS/'))).toBe(false);
  });

  it('preserves natural order when incident type is missing', () => {
    expect(dispositionGroupsForIncident(undefined)).toEqual(DISPOSITION_GROUPS);
    expect(dispositionGroupsForIncident(null)).toEqual(DISPOSITION_GROUPS);
  });
});
