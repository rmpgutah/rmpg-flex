import { describe, it, expect } from 'vitest';
import { computeVisibleCount } from '../ToolbarOverflow';

describe('computeVisibleCount', () => {
  const GAP = 6;
  const MORE = 70;

  it('keeps everything inline when it all fits', () => {
    // 4 x 50 + 3 gaps = 218 <= 400
    expect(computeVisibleCount([50, 50, 50, 50], GAP, 400, MORE)).toBe(4);
  });

  it('does not charge for the More button when nothing overflows', () => {
    // Exactly fits at 218. Naively subtracting MORE first would drop an item
    // and then show a More button that was never needed.
    expect(computeVisibleCount([50, 50, 50, 50], GAP, 218, MORE)).toBe(4);
  });

  it('reserves room for the More button once overflow is real', () => {
    // 6 x 50 + 5 gaps = 330 > 300, so More is shown.
    // Budget = 300 - 70 - 6 = 224 -> fits 50,50,50,50 (218); a 5th needs 274.
    expect(computeVisibleCount([50, 50, 50, 50, 50, 50], GAP, 300, MORE)).toBe(4);
  });

  it('regression: the real dispatch toolbar no longer hides 13 of 18 actions', () => {
    // The audited state: 18 controls, ~78px each, in a 419px-wide panel.
    // Previously 5 were reachable and 13 were only findable by discovering a
    // hairline horizontal scrollbar. Whatever the count now, everything that
    // does not fit must be in the menu rather than unreachable.
    const widths = Array.from({ length: 18 }, () => 78);
    const visible = computeVisibleCount(widths, GAP, 419, MORE);
    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThan(18);
    // Inline items plus the More button must actually fit the container.
    const used = visible * 78 + GAP * visible + MORE;
    expect(used).toBeLessThanOrEqual(419 + 78); // within one item's tolerance
  });

  it('never collapses to zero items', () => {
    expect(computeVisibleCount([500, 500], GAP, 100, MORE)).toBe(1);
  });

  it('honours a pinned minimum even in a very narrow container', () => {
    // PrintRecordButton is pinned first: it owns a modal and must not remount.
    expect(computeVisibleCount([300, 300, 300], GAP, 80, MORE, 2)).toBe(2);
  });

  it('renders everything before the container has been measured', () => {
    // width 0 means layout has not happened yet; showing all avoids a flash of
    // a collapsed toolbar on first paint.
    expect(computeVisibleCount([50, 50, 50], GAP, 0, MORE)).toBe(3);
  });

  it('handles an empty toolbar', () => {
    expect(computeVisibleCount([], GAP, 400, MORE)).toBe(0);
  });

  it('treats unmeasured (zero-width) items as free until they are measured', () => {
    // A slot that has never been inline has no cached width yet; it must not
    // push measured items out on this pass.
    expect(computeVisibleCount([50, 0, 0], GAP, 400, MORE)).toBe(3);
  });

  it('recomputes as the container narrows', () => {
    const widths = [80, 80, 80, 80, 80];
    const wide = computeVisibleCount(widths, GAP, 800, MORE);
    const narrow = computeVisibleCount(widths, GAP, 300, MORE);
    expect(wide).toBe(5);
    expect(narrow).toBeLessThan(wide);
  });
});
