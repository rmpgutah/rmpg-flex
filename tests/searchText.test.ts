import { describe, it, expect } from 'vitest';
import { codeCandidates, escapeLike, codedLike } from '../src/utils/searchText';

describe('codeCandidates', () => {
  it('adds the snake_case form of a multi-word term (additive core)', () => {
    const c = codeCandidates('Traffic Stop');
    expect(c).toContain('Traffic Stop');  // raw term kept
    expect(c).toContain('traffic_stop');  // snake form for coded columns
  });

  it('empty term yields no candidates', () => {
    expect(codeCandidates('   ')).toEqual([]);
  });

  it('dedupes', () => {
    const c = codeCandidates('burglary');
    expect(new Set(c).size).toBe(c.length);
  });

  // Reverse-map assertions: priority words the user would realistically type
  // that do NOT snake_case into the stored code (stored = "P1"/"P2"/"P3"/"P4").
  // Evidence: PRIORITY_LABELS in client/src/utils/statusLabels.ts:
  //   P1 → "P1 — Emergency", P2 → "P2 — Urgent",
  //   P3 → "P3 — Routine",   P4 → "P4 — Scheduled"
  it('maps "emergency" → P1 (priority code, cannot be snake_cased from label)', () => {
    const c = codeCandidates('emergency');
    expect(c).toContain('P1');
  });

  it('maps "urgent" → P2', () => {
    const c = codeCandidates('urgent');
    expect(c).toContain('P2');
  });

  it('maps "routine" → P3', () => {
    const c = codeCandidates('routine');
    expect(c).toContain('P3');
  });

  it('maps "scheduled" → P4', () => {
    const c = codeCandidates('scheduled');
    expect(c).toContain('P4');
  });

  // Status codes where the stored value omits spaces that snake_case would keep.
  // Evidence: CALL_STATUS_LABELS / UNIT_STATUS_LABELS in statusLabels.ts:
  //   enroute → "En Route", onscene → "On Scene"
  it('maps "en route" → enroute (stored code, not en_route)', () => {
    const c = codeCandidates('en route');
    expect(c).toContain('enroute');
  });

  it('maps "on scene" → onscene (stored code, not on_scene)', () => {
    const c = codeCandidates('on scene');
    expect(c).toContain('onscene');
  });

  // INCIDENT_STATUS_LABELS: submitted → "Submitted for Review",
  // returned → "Returned for Revision"
  it('maps "submitted for review" → submitted', () => {
    const c = codeCandidates('submitted for review');
    expect(c).toContain('submitted');
  });

  it('maps "returned for revision" → returned', () => {
    const c = codeCandidates('returned for revision');
    expect(c).toContain('returned');
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_x')).toBe('50\\%\\_x');
  });

  it('escapes backslash', () => {
    expect(escapeLike('C:\\path')).toBe('C:\\\\path');
  });

  it('leaves plain strings untouched', () => {
    expect(escapeLike('traffic_stop')).toBe('traffic\\_stop');
  });

  it('empty string returns empty', () => {
    expect(escapeLike('')).toBe('');
  });
});

describe('codedLike', () => {
  it('builds an OR-of-LIKE clause with escaped, wildcard-wrapped binds', () => {
    const { sql, binds } = codedLike('incident_type', 'Traffic Stop');
    expect(sql).toBe("(incident_type LIKE ? ESCAPE '\\' OR incident_type LIKE ? ESCAPE '\\')");
    expect(binds).toEqual(['%Traffic Stop%', '%traffic\\_stop%']);
    // Note: the underscore in traffic_stop is a LIKE wildcard and is correctly
    // escaped by escapeLike — '%traffic\_stop%' matches only the literal code.
  });

  it('returns a never-match clause for an empty term', () => {
    expect(codedLike('x', '  ')).toEqual({ sql: '0', binds: [] });
  });

  it('includes all candidates in binds (raw + snake + reverse-map codes)', () => {
    const { binds } = codedLike('status', 'emergency');
    expect(binds).toContain('%emergency%');
    expect(binds).toContain('%P1%');
  });
});
