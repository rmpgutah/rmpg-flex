// The barcode check-digit contract, from the client side.
//
// `receiptBarcodeCheck` is duplicated in src/routes/serveReceipt.ts. That
// duplication is deliberate — /src and /client/src share no build, and
// importing across the boundary drags DOM-typed client code into the
// Worker's tsconfig, which has no DOM lib (the suite passes and `tsc`
// fails). So the contract lives in a table asserted identically on both
// sides: tests/serveReceipt.test.ts holds the same PINNED_CHECKS.
//
// The Worker resolves what this module encodes. Drift on either side
// stops every scanned paper copy resolving — including copies already
// filed with a court, which nobody can reprint.
import { describe, it, expect } from 'vitest';
import { receiptBarcodeCheck } from '../servePdfGenerator';

const PINNED_CHECKS: Array<[number, string]> = [
  [1, '2'], [42, 'E'], [4471, 'H'], [100000, '2'], [999999, 'R'],
];

describe('receiptBarcodeCheck — client mirror', () => {
  it('matches the values the Worker is also held to', () => {
    expect(PINNED_CHECKS.map(([id]) => receiptBarcodeCheck(id)))
      .toEqual(PINNED_CHECKS.map(([, check]) => check));
  });

  it('catches a transposition, which a plain sum would not', () => {
    // Position-weighted for exactly this: 4471 and 4417 sum identically,
    // and a transposed pair is the classic hand-transcription error.
    expect(receiptBarcodeCheck(4471)).not.toBe(receiptBarcodeCheck(4417));
  });

  it('differs for ids one digit apart', () => {
    // The point of the digit: a misread must fail to resolve rather than
    // resolve to a different real receipt.
    expect(receiptBarcodeCheck(4471)).not.toBe(receiptBarcodeCheck(4472));
    expect(receiptBarcodeCheck(4471)).not.toBe(receiptBarcodeCheck(4371));
  });

  it('is a single base-36 character', () => {
    for (const [id] of PINNED_CHECKS) {
      expect(receiptBarcodeCheck(id)).toMatch(/^[0-9A-Z]$/);
    }
  });
});
