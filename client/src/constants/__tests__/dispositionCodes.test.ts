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

  it('exposes the core process-service outcomes', () => {
    for (const code of ['PS Served', 'PS Sub-Served', 'PS Posted', 'PS Non-Service']) {
      expect(DEFAULT_DISPOSITION_CODES.has(code)).toBe(true);
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
