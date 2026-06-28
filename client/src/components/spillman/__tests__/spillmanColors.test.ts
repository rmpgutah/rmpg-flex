import { describe, it, expect } from 'vitest';
import { priorityColor, unitStatusColor } from '../spillmanColors';

describe('priorityColor', () => {
  it('maps priorities 1..9 to their CSS var', () => {
    expect(priorityColor(1)).toBe('var(--spm-pri-1)');
    expect(priorityColor(9)).toBe('var(--spm-pri-9)');
  });
  it('accepts numeric strings', () => {
    expect(priorityColor('2')).toBe('var(--spm-pri-2)');
  });
  it('returns inherit for out-of-range, zero, null, or junk', () => {
    expect(priorityColor(0)).toBe('inherit');
    expect(priorityColor(10)).toBe('inherit');
    expect(priorityColor(null)).toBe('inherit');
    expect(priorityColor(undefined)).toBe('inherit');
    expect(priorityColor('x')).toBe('inherit');
  });
});

describe('unitStatusColor', () => {
  it('maps known statuses case-insensitively', () => {
    expect(unitStatusColor('AVAIL')).toBe('var(--spm-stat-avail)');
    expect(unitStatusColor('available')).toBe('var(--spm-stat-avail)');
    expect(unitStatusColor('ENRT')).toBe('var(--spm-stat-enrt)');
    expect(unitStatusColor('en route')).toBe('var(--spm-stat-enrt)');
    expect(unitStatusColor(' busy ')).toBe('var(--spm-stat-busy)');
    expect(unitStatusColor('OOS')).toBe('var(--spm-stat-busy)');
    expect(unitStatusColor('XBSY')).toBe('var(--spm-stat-xbsy)');
  });
  it('returns inherit for OMDT, unknown, or empty', () => {
    expect(unitStatusColor('OMDT')).toBe('inherit');
    expect(unitStatusColor('whatever')).toBe('inherit');
    expect(unitStatusColor(null)).toBe('inherit');
    expect(unitStatusColor('')).toBe('inherit');
  });
});
