import { describe, it, expect } from 'vitest';
import { applyOp, applyUnary, pursuitMiles, backspaceDisplay, applyMemory, formatCalc } from '../cadCalculator';

describe('cadCalculator', () => {
  it('applies ops and guards divide-by-zero', () => {
    expect(applyOp(6, 3, '÷')).toBe(2);
    expect(applyOp(1, 0, '÷')).toBe('Error');
    expect(formatCalc(1.23456789111)).toBe('1.2345678911');
  });

  it('unaries, backspace, memory, and pursuit distance', () => {
    expect(applyUnary('9', 'sqrt')).toBe('3');
    expect(applyUnary('-4', 'sqrt')).toBe('Error');
    expect(applyUnary('4', 'reciprocal')).toBe('0.25');
    expect(backspaceDisplay('12')).toBe('1');
    expect(applyMemory(10, '5', 'M+')).toBe(15);
    expect(applyMemory(10, '5', 'MC')).toBe(0);
    expect(pursuitMiles(60, 15)).toBe(15);
  });
});
