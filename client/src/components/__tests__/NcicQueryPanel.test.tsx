import { describe, it, expect } from 'vitest';
import { QUICK_QUERIES } from '../NcicQueryPanel';

// The NcicQueryPanel itself is 1000+ lines of WebSocket / terminal /
// context-menu integration — the live behavior is harder to unit-test
// without a heavier harness. These tests lock the contract bits that
// are easy to break in a refactor: the exported QUICK_QUERIES shape +
// invariants the rest of the panel depends on.

describe('QUICK_QUERIES', () => {
  it('has at least the core 5 verb prefixes operators use most', () => {
    const prefixes = QUICK_QUERIES.map((q) => q.prefix.trim());
    // XREF (QX) / Person (QH) / Vehicle (QV) / Warrant (QW) / DL (QD)
    // are the five most-frequent NCIC verbs in dispatch (see runQuery's
    // switch statement). Any future trim of QUICK_QUERIES MUST keep
    // these five — that's the floor for "useful quick row".
    for (const required of ['QX', 'QH', 'QV', 'QW', 'QD']) {
      expect(prefixes).toContain(required);
    }
  });

  it('every entry has a trailing space after the verb', () => {
    // The prefix is meant to be inserted directly into the input — so
    // the operator's first keystroke types the term, not a separator.
    // A missing trailing space would make "QX SMITH" come out as "QXSMITH".
    for (const q of QUICK_QUERIES) {
      expect(q.prefix.endsWith(' ')).toBe(true);
    }
  });

  it('every entry has a non-empty label + descriptive subtitle', () => {
    for (const q of QUICK_QUERIES) {
      expect(q.label.length).toBeGreaterThan(0);
      expect(q.desc.length).toBeGreaterThan(3);
    }
  });

  it('labels are unique (no duplicate buttons)', () => {
    const labels = QUICK_QUERIES.map((q) => q.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('prefixes are unique (no two buttons inserting the same verb)', () => {
    const prefixes = QUICK_QUERIES.map((q) => q.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
