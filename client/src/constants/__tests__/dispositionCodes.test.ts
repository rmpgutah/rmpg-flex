// Locks in the disposition source-of-truth contract: unique codes, the
// process-service group hoists to the top for PSO / process_service calls,
// and the flat default list + code set stay consistent with the groups.
import { describe, it, expect } from 'vitest';
import {
  DISPOSITION_GROUPS,
  DEFAULT_DISPOSITIONS,
  DEFAULT_DISPOSITION_CODES,
  dispositionGroupsForIncident,
} from '../dispositionCodes';

describe('disposition codes', () => {
  it('has no duplicate codes across all groups', () => {
    const codes = DEFAULT_DISPOSITIONS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('flat list and code set derive from the groups', () => {
    const fromGroups = DISPOSITION_GROUPS.flatMap((g) => g.codes);
    expect(DEFAULT_DISPOSITIONS).toEqual(fromGroups);
    expect(DEFAULT_DISPOSITION_CODES.size).toBe(fromGroups.length);
  });

  it('exposes the short-coded process-service outcomes (PS/### in increments of 5)', () => {
    // Anchored on the live-configured PS/055 = Personal/Individual.
    for (const code of ['PS/055', 'PS/060', 'PS/065', 'PS/080']) {
      expect(DEFAULT_DISPOSITION_CODES.has(code)).toBe(true);
    }
  });

  it('uses short mnemonic codes for general dispositions (not verbose phrases)', () => {
    for (const code of ['RTF', 'GOA', 'ARR', 'CIT', 'UTL']) {
      expect(DEFAULT_DISPOSITION_CODES.has(code)).toBe(true);
    }
    // The old verbose phrase-codes must be gone.
    expect(DEFAULT_DISPOSITION_CODES.has('Report Taken')).toBe(false);
    expect(DEFAULT_DISPOSITION_CODES.has('PS Served')).toBe(false);
  });

  it('every process-service code matches the PS/### pattern in increments of 5', () => {
    const ps = DISPOSITION_GROUPS.find((g) => g.processService)!;
    for (const d of ps.codes) {
      expect(d.code).toMatch(/^PS\/\d{3}$/);
      expect(Number(d.code.split('/')[1]) % 5).toBe(0);
    }
  });

  it('hoists the Process Service group to the top for process-service calls', () => {
    for (const t of ['pso_client_request', 'process_service']) {
      const groups = dispositionGroupsForIncident(t);
      expect(groups[0].processService).toBe(true);
      expect(groups[0].label).toBe('Process Service');
      // No group is dropped — only reordered.
      expect(groups.length).toBe(DISPOSITION_GROUPS.length);
    }
  });

  it('preserves natural order for non-process-service calls', () => {
    const groups = dispositionGroupsForIncident('burglary');
    expect(groups).toEqual(DISPOSITION_GROUPS);
    expect(groups[0].label).toBe('Common Dispositions');
  });

  it('preserves natural order when incident type is missing', () => {
    expect(dispositionGroupsForIncident(undefined)).toEqual(DISPOSITION_GROUPS);
    expect(dispositionGroupsForIncident(null)).toEqual(DISPOSITION_GROUPS);
  });
});
