// ============================================================
// Serve Scheduler — drag-and-drop DOM wiring
// ============================================================
// These cover the parts of the 2026-07-26 drag-drop repair that pure helper
// tests structurally cannot: whether the right ELEMENTS carry the right
// handlers. The original bug was not bad math — layoutDayChips/snapToBand were
// always correct — it was that chips painted over the drop cells never opted
// into the drop, so occupied bands silently swallowed every gesture.
//
// jsdom has no DataTransfer, so each test hands fireEvent a stub. That is
// sufficient here: what is under test is which handler runs and what it
// forwards, not the browser's own transfer plumbing.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import WeekTimeline from '../WeekTimeline';
import MonthGrid from '../MonthGrid';
import type { ScheduleSlot } from '../../../utils/schedulerView';

const ANCHOR = '2026-06-21'; // a Sunday

const slot = (over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id: 1, queue_id: 10, attempt: 0, attempt_number: 1,
  scheduled_date: ANCHOR, window_start: '08:00', window_end: '10:00',
  window_label: 'morning', notify_at: '2026-06-21T07:00', notify_before_secs: 3600,
  recipient_name: 'Jane Rodriguez', recipient_address: '123 Main',
  recipient_city: 'SLC', recipient_state: 'UT',
  case_number: '240-1', priority: 'normal', deadline: null,
  status: 'pending', notified: 0, dismissed: 0,
  officer_id: null, manually_moved: 0, auto_replan_source: null,
  urgency_tier: 'standard',
  ...over,
});

/** Minimal stand-in for the DataTransfer jsdom doesn't implement. */
function transfer(payload: unknown) {
  return {
    getData: () => (payload === undefined ? '' : JSON.stringify(payload)),
    setData: vi.fn(),
    effectAllowed: '',
    dropEffect: '',
  };
}

const payloadFor = (s: ScheduleSlot) => ({
  slot_id: s.id, originating_date: s.scheduled_date, officer_id: s.officer_id,
});

beforeEach(cleanup);

describe('WeekTimeline drag-drop wiring', () => {
  // Chips are keyed by their AttemptChip title; band cells have no text, so
  // reach them positionally through the grid's children.
  const chipFor = (container: HTMLElement, s: ScheduleSlot) =>
    container.querySelector<HTMLElement>(`[title*="${s.case_number}"]`)!;

  it('drops onto an empty band and snaps to that band window', () => {
    const onSlotDrop = vi.fn();
    const s = slot();
    const { container } = render(
      <WeekTimeline anchorYmd={ANCHOR} slots={[s]} todayYmd={ANCHOR} onSlotDrop={onSlotDrop} />,
    );
    // Row index 5 → band row 6 → 16:00–18:00 per snapToBand.
    const cell = container.querySelector<HTMLElement>(`[data-testid="band-cell-${ANCHOR}-5"]`)!;
    fireEvent.drop(cell, { dataTransfer: transfer(payloadFor(s)) });
    expect(onSlotDrop).toHaveBeenCalledTimes(1);
    const [, target] = onSlotDrop.mock.calls[0];
    expect(target).toEqual({ date: ANCHOR, window_start: '16:00', window_end: '18:00' });
  });

  it('accepts a drop landing ON an existing chip — the silent-no-op regression', () => {
    // Before the fix the chip had no dragover/drop of its own, so the browser
    // refused the drop outright: no call, no error, nothing on screen.
    const onSlotDrop = vi.fn();
    const s = slot();
    const { container } = render(
      <WeekTimeline anchorYmd={ANCHOR} slots={[s]} todayYmd={ANCHOR} onSlotDrop={onSlotDrop} />,
    );
    const wrapper = chipFor(container, s).parentElement!;
    // Drop a DIFFERENT slot onto the occupied band so it isn't a same-band no-op.
    const dragged = slot({ id: 2, case_number: '240-2', scheduled_date: '2026-06-23' });
    fireEvent.drop(wrapper, { dataTransfer: transfer(payloadFor(dragged)) });
    // slots only contains `s`, so an unknown id is correctly ignored — re-render
    // with both present to prove the handler resolves and forwards.
    cleanup();
    const second = render(
      <WeekTimeline anchorYmd={ANCHOR} slots={[s, dragged]} todayYmd={ANCHOR} onSlotDrop={onSlotDrop} />,
    );
    const occupied = chipFor(second.container, s).parentElement!;
    fireEvent.drop(occupied, { dataTransfer: transfer(payloadFor(dragged)) });
    expect(onSlotDrop).toHaveBeenCalled();
    const calls = onSlotDrop.mock.calls;
    const [movedSlot, target] = calls[calls.length - 1];
    expect(movedSlot.id).toBe(2);
    expect(target.date).toBe(ANCHOR);
    expect(target).toHaveProperty('window_start');
  });

  it('marks a chip-covered band droppable via preventDefault on dragover', () => {
    const s = slot();
    const { container } = render(
      <WeekTimeline anchorYmd={ANCHOR} slots={[s]} todayYmd={ANCHOR} onSlotDrop={vi.fn()} />,
    );
    const wrapper = chipFor(container, s).parentElement!;
    const evt = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'dataTransfer', { value: transfer(undefined) });
    wrapper.dispatchEvent(evt);
    // An un-prevented dragover is exactly what made these bands undroppable.
    expect(evt.defaultPrevented).toBe(true);
  });

  it('ignores a same-day, same-band drop instead of issuing a no-op PATCH', () => {
    const onSlotDrop = vi.fn();
    const s = slot();
    const { container } = render(
      <WeekTimeline anchorYmd={ANCHOR} slots={[s]} todayYmd={ANCHOR} onSlotDrop={onSlotDrop} />,
    );
    const wrapper = chipFor(container, s).parentElement!;
    fireEvent.drop(wrapper, { dataTransfer: transfer(payloadFor(s)) });
    expect(onSlotDrop).not.toHaveBeenCalled();
  });

  it('clears the drag ghost on dragend', () => {
    const s = slot();
    const { container } = render(
      <WeekTimeline anchorYmd={ANCHOR} slots={[s]} todayYmd={ANCHOR} onSlotDrop={vi.fn()} />,
    );
    const chip = chipFor(container, s);
    fireEvent.dragStart(chip, { dataTransfer: transfer(undefined) });
    expect(chip.style.opacity).toBe('0.4');
    fireEvent.dragEnd(chip, { dataTransfer: transfer(undefined) });
    // Left set, the chip stays ghosted until the next refetch.
    expect(chip.style.opacity).toBe('');
  });

  it('does not forward drops when onSlotDrop is withheld (non-manager)', () => {
    const s = slot();
    const { container } = render(
      <WeekTimeline anchorYmd={ANCHOR} slots={[s]} todayYmd={ANCHOR} />,
    );
    const wrapper = chipFor(container, s).parentElement!;
    // No handler ⇒ nothing to assert but the absence of a throw.
    expect(() => fireEvent.drop(wrapper, { dataTransfer: transfer(payloadFor(s)) })).not.toThrow();
  });
});

describe('MonthGrid drag-drop wiring', () => {
  it('renders draggable chips so month view has a drag SOURCE at all', () => {
    // Previously month view drew only aggregate tier badges, leaving every drop
    // handler in this component unreachable.
    const s = slot();
    const { container } = render(
      <MonthGrid anchorYmd={ANCHOR} slots={[s]} todayYmd={ANCHOR} onSlotDrop={vi.fn()} />,
    );
    const draggables = container.querySelectorAll('[draggable="true"]');
    expect(draggables.length).toBeGreaterThan(0);
  });

  it('puts the slot payload on dragstart', () => {
    const s = slot();
    const { container } = render(
      <MonthGrid anchorYmd={ANCHOR} slots={[s]} todayYmd={ANCHOR} onSlotDrop={vi.fn()} />,
    );
    const chip = container.querySelector<HTMLElement>('[draggable="true"]')!;
    const dt = transfer(undefined);
    fireEvent.dragStart(chip, { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith('application/json', JSON.stringify(payloadFor(s)));
  });

  it('forwards a drop on a different day, keeping the existing window', () => {
    const onSlotDrop = vi.fn();
    const s = slot();
    const { container } = render(
      <MonthGrid anchorYmd={ANCHOR} slots={[s]} todayYmd={ANCHOR} onSlotDrop={onSlotDrop} />,
    );
    const cells = container.querySelectorAll<HTMLElement>('[role="button"]');
    // Find a day cell that is not the slot's own date.
    const other = Array.from(cells).find((el) => !el.textContent?.includes('RODRIGUEZ'))!;
    fireEvent.drop(other, { dataTransfer: transfer(payloadFor(s)) });
    expect(onSlotDrop).toHaveBeenCalledTimes(1);
    const [, target] = onSlotDrop.mock.calls[0];
    expect(target.window_start).toBe('08:00');
    expect(target.window_end).toBe('10:00');
    expect(target.date).not.toBe(ANCHOR);
  });

  it('ignores a drop back onto the originating day', () => {
    const onSlotDrop = vi.fn();
    const s = slot();
    const { container } = render(
      <MonthGrid anchorYmd={ANCHOR} slots={[s]} todayYmd={ANCHOR} onSlotDrop={onSlotDrop} />,
    );
    const own = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'))
      .find((el) => el.textContent?.includes('RODRIGUEZ'))!;
    fireEvent.drop(own, { dataTransfer: transfer(payloadFor(s)) });
    expect(onSlotDrop).not.toHaveBeenCalled();
  });

  it('caps chips per cell and reports the remainder', () => {
    const many = [1, 2, 3, 4, 5].map((id) =>
      slot({ id, case_number: `240-${id}`, recipient_name: `Person${id}` }));
    const { container } = render(
      <MonthGrid anchorYmd={ANCHOR} slots={many} todayYmd={ANCHOR} onSlotDrop={vi.fn()} />,
    );
    expect(container.querySelectorAll('[draggable="true"]').length).toBe(3);
    expect(container.textContent).toContain('+2 more');
  });
});
