import { describe, it, expect } from 'vitest';
import { formatActivity } from './caseActivity';

describe('formatActivity', () => {
  it('labels case creation with the case number', () => {
    const r = formatActivity('case.created', JSON.stringify({ case_number: '26-000042-CR', title: 'X' }));
    expect(r.label).toContain('26-000042-CR');
    expect(r.color).toBe('#22c55e');
  });

  it('renders a status change with the target status and disposition', () => {
    const r = formatActivity('status.changed', { to: 'closed', disposition: 'cleared' });
    expect(r.label).toBe('Status -> closed (cleared)');
    expect(r.color).toBe('#f59e0b');
  });

  it('singularizes the entity name on link events and shows the id', () => {
    expect(formatActivity('link.added', { entity: 'vehicles', entity_id: 7 }).label).toBe('Linked vehicle #7');
    expect(formatActivity('link.removed', { entity: 'evidence', entity_id: 3 }).label).toBe('Unlinked evidence #3');
  });

  it('formats solvability score', () => {
    expect(formatActivity('solvability.calculated', { score: 75 }).label).toBe('Solvability calculated: 75/100');
  });

  it('parses a JSON string detail the same as an object', () => {
    const a = formatActivity('case.updated', JSON.stringify({ fields: ['title', 'priority'] }));
    const b = formatActivity('case.updated', { fields: ['title', 'priority'] });
    expect(a.label).toBe(b.label);
    expect(a.label).toBe('Case updated: title, priority');
  });

  it('tolerates malformed detail JSON without throwing', () => {
    expect(() => formatActivity('note.added', '{not json')).not.toThrow();
    expect(formatActivity('note.added', '{not json').label).toBe('Note added');
  });

  it('degrades unknown actions to a readable label', () => {
    expect(formatActivity('weird.future_action').label).toBe('weird future action');
  });

  it('omits the id suffix when no entity_id is present', () => {
    expect(formatActivity('link.added', { entity: 'persons' }).label).toBe('Linked person');
  });
});
