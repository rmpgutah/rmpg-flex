// Spillman-style CAD command-line mnemonics, wired to existing DispatchPage
// handlers (NOT a dispatch engine). Grammar is deliberately tiny — P1 scope:
//   ac              → open the New Call modal
//   dc <unit> [c#]  → dispatch: assign unit to call (default: selected call)
//   uc <unit>       → unit clear: unassign unit from its current call
//   cc [c#]         → clear call with disposition (default: selected call)
import type { CallForService, Unit } from '../../../types';

export type CadCommand =
  | { kind: 'ac' }
  | { kind: 'dc'; unit: string; call: string | undefined }
  | { kind: 'uc'; unit: string }
  | { kind: 'cc'; call: string | undefined }
  | { kind: 'unknown'; input: string };

export function parseCadCommand(raw: string): CadCommand | null {
  const input = raw.trim();
  if (!input) return null;
  const [word, ...rest] = input.split(/\s+/);
  switch (word.toLowerCase()) {
    case 'ac':
      return { kind: 'ac' };
    case 'dc':
      return rest[0] ? { kind: 'dc', unit: rest[0], call: rest[1] } : { kind: 'unknown', input };
    case 'uc':
      return rest[0] ? { kind: 'uc', unit: rest[0] } : { kind: 'unknown', input };
    case 'cc':
      return { kind: 'cc', call: rest[0] };
    default:
      return { kind: 'unknown', input };
  }
}

export function findUnitByCallSign(units: Unit[], token: string): Unit | undefined {
  const t = token.trim().toLowerCase();
  return units.find((u) => (u.call_sign || '').toLowerCase() === t);
}

/** Match a call by exact call_number, or by numeric suffix ("451" → 2026-000451). */
export function findCallByNumber(calls: CallForService[], token: string): CallForService | undefined {
  const t = token.trim().toLowerCase();
  const exact = calls.find((c) => (c.call_number || '').toLowerCase() === t);
  if (exact) return exact;
  if (!/^\d+$/.test(t)) return undefined;
  return calls.find((c) => {
    const digits = (c.call_number || '').replace(/\D/g, '');
    return digits.endsWith(t) && Number(digits.slice(-t.length)) === Number(t);
  });
}
