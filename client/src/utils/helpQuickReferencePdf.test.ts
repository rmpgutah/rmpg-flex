import { describe, it, expect } from 'vitest';
import { buildHelpQuickReferencePdf, type HelpQuickReferenceInput } from './helpQuickReferencePdf';

const SAMPLE: HelpQuickReferenceInput = {
  shortcutGroups: [
    {
      title: 'Global',
      shortcuts: [
        { keys: ['Ctrl', 'K'], description: 'Open global search' },
        { keys: ['?'], description: 'Show keyboard shortcuts modal' },
        { keys: ['Esc'], description: 'Close modal / panel' },
      ],
    },
    {
      title: 'F-Keys',
      shortcuts: [
        { keys: ['F1'], description: 'Dashboard' },
        { keys: ['F2'], description: 'Dispatch' },
      ],
    },
  ],
  priorities: [
    { level: 'P1', label: 'EMERGENCY', desc: 'Immediate threat to life' },
    { level: 'P2', label: 'URGENT', desc: 'In-progress crime or injury' },
  ],
  unitStatuses: [
    { code: 'AVL', label: 'Available', desc: 'Ready to receive calls' },
    { code: 'ENR', label: 'Enroute', desc: 'Traveling to call location' },
  ],
  cadCommands: [
    { cmd: '10-4', desc: 'Look up any 10-code' },
    { cmd: 'BOLO <text>', desc: 'Broadcast BOLO alert' },
  ],
  appVersion: '5.8.4',
};

describe('buildHelpQuickReferencePdf', () => {
  it('produces a 2-page jsPDF document', () => {
    const doc = buildHelpQuickReferencePdf(SAMPLE);
    const total = (doc as unknown as { internal: { getNumberOfPages: () => number } })
      .internal.getNumberOfPages();
    expect(total).toBe(2);
  });

  it('returns a valid PDF blob (non-empty bytes)', () => {
    const doc = buildHelpQuickReferencePdf(SAMPLE);
    const blob = doc.output('blob');
    expect(blob.size).toBeGreaterThan(500);
    expect(blob.type).toBe('application/pdf');
  });

  it('handles odd-numbered shortcut groups (left/right column split)', () => {
    const odd: HelpQuickReferenceInput = {
      ...SAMPLE,
      shortcutGroups: [
        { title: 'A', shortcuts: [{ keys: ['1'], description: 'one' }] },
        { title: 'B', shortcuts: [{ keys: ['2'], description: 'two' }] },
        { title: 'C', shortcuts: [{ keys: ['3'], description: 'three' }] },
      ],
    };
    // Should not throw — left column gets 2 groups, right column gets 1.
    expect(() => buildHelpQuickReferencePdf(odd)).not.toThrow();
  });

  it('handles empty tables without throwing', () => {
    const empty: HelpQuickReferenceInput = {
      shortcutGroups: [],
      priorities: [],
      unitStatuses: [],
      cadCommands: [],
      appVersion: '5.8.4',
    };
    expect(() => buildHelpQuickReferencePdf(empty)).not.toThrow();
  });
});
