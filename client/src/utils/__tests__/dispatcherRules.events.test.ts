import { describe, it, expect } from 'vitest';
import { EVENT_RULES } from '../dispatcherRules/events';
import type { BrainContext, DispatcherRule } from '../dispatcherRules/types';

function findRule(id: string): DispatcherRule {
  const r = EVENT_RULES.find((rule) => rule.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function ctxForEvent(type: string, payload: any): BrainContext {
  return { transcript: [], event: { type, payload } };
}

describe('event rules', () => {
  it('exports exactly 6 rules, all event-triggered', () => {
    expect(EVENT_RULES).toHaveLength(6);
    for (const r of EVENT_RULES) expect(r.trigger).toBe('event');
  });

  // ─── citation-issued ────────────────────────────────────
  describe('citation-issued', () => {
    const rule = findRule('citation-issued');
    it('matches server nested shape (production broadcast)', () => {
      const ctx = ctxForEvent('citation_issued', {
        citation: { citation_number: 'RN-26-0142', officer_name: '4-Bravo', fine_amount: 85 },
      });
      expect(rule.match(ctx)).toBe(true);
      const spoken = rule.compose(ctx);
      expect(spoken).toContain('RN-26-0142');
      expect(spoken).toContain('4-Bravo');
      expect(spoken).toContain('$85');
    });
    it('also matches flat shape (future broadcast)', () => {
      const ctx = ctxForEvent('citation_created', {
        citation_number: 'RN-1', officer_call_sign: '4-Bravo',
      });
      expect(rule.match(ctx)).toBe(true);
      expect(rule.compose(ctx)).toContain('RN-1');
      expect(rule.compose(ctx)).toContain('4-Bravo');
    });
    it('skips the "by officer" and fine clauses when absent', () => {
      const ctx = ctxForEvent('citation_created', { citation_number: 'RN-1' });
      expect(rule.compose(ctx)).toBe('Citation RN-1 issued.');
    });
    it('entityKey keys on the citation number', () => {
      const ctx = ctxForEvent('citation_created', { citation_number: 'RN-99' });
      expect(rule.entityKey!(ctx)).toBe('RN-99');
    });
  });

  // ─── incident-created ───────────────────────────────────
  describe('incident-created', () => {
    const rule = findRule('incident-created');
    it('speaks incident number + source call', () => {
      const ctx = ctxForEvent('incident_created', { incident_number: 'RN-26-0301', source_call: 'CN-26-0457' });
      expect(rule.match(ctx)).toBe(true);
      expect(rule.compose(ctx)).toBe('Incident RN-26-0301 opened from call CN-26-0457.');
    });
  });

  // ─── warrant-entered ────────────────────────────────────
  describe('warrant-entered', () => {
    const rule = findRule('warrant-entered');
    it('speaks subject + class + bail', () => {
      const ctx = ctxForEvent('warrant_entered', {
        warrant_id: 42, subject_name: 'Doe, John', offense_class: 'felony', bail_amount: 50000,
      });
      expect(rule.match(ctx)).toBe(true);
      const spoken = rule.compose(ctx);
      expect(spoken).toContain('Doe, John');
      expect(spoken).toContain('felony');
      expect(spoken).toContain('$50000');
      expect(rule.severity).toBe('moderate');
    });
    it('omits bail when missing', () => {
      const ctx = ctxForEvent('warrant_entered', { warrant_id: 43, subject_name: 'Smith, J' });
      expect(rule.compose(ctx)).toBe('New warrant on Smith, J, offense class unknown.');
    });
  });

  // ─── evidence-logged ────────────────────────────────────
  describe('evidence-logged', () => {
    const rule = findRule('evidence-logged');
    it('speaks tag number + case number', () => {
      const ctx = ctxForEvent('evidence_logged', { tag_number: 'E-26-0089', case_number: '26-0301' });
      expect(rule.match(ctx)).toBe(true);
      expect(rule.compose(ctx)).toBe('Evidence tag E-26-0089 logged for case 26-0301.');
    });
    it('omits case clause when missing', () => {
      const ctx = ctxForEvent('evidence_logged', { tag_number: 'E-1' });
      expect(rule.compose(ctx)).toBe('Evidence tag E-1 logged.');
    });
  });

  // ─── arrest-booked ──────────────────────────────────────
  describe('arrest-booked', () => {
    const rule = findRule('arrest-booked');
    it('speaks subject + charge + officer (nested shape from server)', () => {
      const ctx = ctxForEvent('arrest_created', {
        arrest: { id: 7, subject_name: 'Doe, J', charge: 'felony theft', officer_name: '4-Bravo' },
      });
      expect(rule.match(ctx)).toBe(true);
      const spoken = rule.compose(ctx);
      expect(spoken).toContain('Doe, J');
      expect(spoken).toContain('felony theft');
      expect(spoken).toContain('4-Bravo');
      expect(rule.severity).toBe('moderate');
    });
    it('also accepts flat shape', () => {
      const ctx = ctxForEvent('arrest_created', {
        arrest_id: 7, subject_name: 'Smith, J',
      });
      expect(rule.match(ctx)).toBe(true);
      expect(rule.compose(ctx)).toContain('Smith, J');
    });
  });

  // ─── hr-approval ────────────────────────────────────────
  describe('hr-approval', () => {
    const rule = findRule('hr-approval');
    it('speaks the officer name', () => {
      const ctx = ctxForEvent('leave_approved', { leave_id: 12, officer_name: 'Smith' });
      expect(rule.match(ctx)).toBe(true);
      expect(rule.compose(ctx)).toBe('Leave request approved for Smith.');
    });
    it('does not match when officer_name missing', () => {
      const ctx = ctxForEvent('leave_approved', { leave_id: 12 });
      expect(rule.match(ctx)).toBe(false);
    });
  });
});
