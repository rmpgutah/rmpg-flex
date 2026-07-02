import { describe, it, expect } from 'vitest';
import { agendaItemToEvent, isDraggableSource, SOURCE_COLORS } from './agendaToCalendarEvents';

const baseItem = {
  key: 'serve:42',
  source: 'serve' as const,
  id: 42,
  date: '2026-07-10',
  start: '09:00',
  end: '11:00',
  title: 'Serve attempt #1 — John Doe',
  subtitle: '123 Main St',
  officer_id: 7,
  status: 'pending',
  link: '/serve-intake/scheduler?schedule_id=42',
};

describe('isDraggableSource', () => {
  it('allows serve, shift, and custom', () => {
    expect(isDraggableSource('serve')).toBe(true);
    expect(isDraggableSource('shift')).toBe(true);
    expect(isDraggableSource('custom')).toBe(true);
  });

  it('blocks court', () => {
    expect(isDraggableSource('court')).toBe(false);
  });
});

describe('agendaItemToEvent', () => {
  it('maps a timed item to start/end ISO strings', () => {
    const ev = agendaItemToEvent(baseItem);
    expect(ev.id).toBe('serve:42');
    expect(ev.start).toBe('2026-07-10T09:00:00');
    expect(ev.end).toBe('2026-07-10T11:00:00');
    expect(ev.title).toBe('Serve attempt #1 — John Doe');
    expect(ev.editable).toBe(true);
    expect(ev.backgroundColor).toBe(SOURCE_COLORS.serve);
  });

  it('maps an all-day item (no start time) as allDay', () => {
    const ev = agendaItemToEvent({ ...baseItem, start: null, end: null });
    expect(ev.allDay).toBe(true);
    expect(ev.start).toBe('2026-07-10');
    expect(ev.end).toBeUndefined();
  });

  it('marks court items non-editable regardless of the base editable flag', () => {
    const ev = agendaItemToEvent({ ...baseItem, source: 'court' });
    expect(ev.editable).toBe(false);
  });

  it('carries source and original id through extendedProps for the drop handler', () => {
    const ev = agendaItemToEvent(baseItem);
    expect(ev.extendedProps).toEqual({ source: 'serve', originalId: 42, officerId: 7 });
  });
});
