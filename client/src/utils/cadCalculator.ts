export type CalcOp = '+' | '-' | '×' | '÷';

export function applyOp(a: number, b: number, op: CalcOp): number | 'Error' {
  if (op === '÷' && b === 0) return 'Error';
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '×') return a * b;
  return a / b;
}

export function formatCalc(n: number): string {
  if (!Number.isFinite(n)) return 'Error';
  return String(parseFloat(n.toFixed(10)));
}

export function applyUnary(value: string, kind: 'negate' | 'percent' | 'sqrt' | 'square' | 'reciprocal'): string {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 'Error';
  if (kind === 'negate') return formatCalc(-n);
  if (kind === 'percent') return formatCalc(n / 100);
  if (kind === 'sqrt') return n < 0 ? 'Error' : formatCalc(Math.sqrt(n));
  if (kind === 'square') return formatCalc(n * n);
  if (n === 0) return 'Error';
  return formatCalc(1 / n);
}

/** Distance in miles for a pursuit / welfare window: miles = mph × (minutes / 60). */
export function pursuitMiles(mph: number, minutes: number): number {
  if (!Number.isFinite(mph) || !Number.isFinite(minutes) || minutes < 0) return NaN;
  return parseFloat((mph * (minutes / 60)).toFixed(4));
}

export function backspaceDisplay(display: string): string {
  if (display === 'Error') return '0';
  return display.length > 1 ? display.slice(0, -1) : '0';
}

export type MemoryOp = 'MC' | 'MR' | 'M+' | 'M-';

export function applyMemory(mem: number, display: string, op: MemoryOp): number {
  const n = parseFloat(display);
  if (op === 'MC') return 0;
  if (op === 'MR') return mem;
  if (!Number.isFinite(n)) return mem;
  if (op === 'M+') return mem + n;
  return mem - n;
}
