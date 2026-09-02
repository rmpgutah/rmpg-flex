// The recipient "scan to sign" QR on the Call for Service report is gated
// on `serve_queue_id`. That field was declared on CallPdfData and read by
// the generator, but nothing populated it end-to-end — so the badge never
// rendered on a printed run sheet even though both ends "supported" it.
//
// The break was in the MIDDLE: mapDbCall builds an explicit object rather
// than spreading the row, so an unmapped field is silently dropped. These
// pin the whole chain, because each link individually looked correct.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const MAPPER = readFileSync(join(ROOT, 'pages/dispatch/utils/dispatchMappers.ts'), 'utf8');
const GENERATOR = readFileSync(join(ROOT, 'utils/recordPdfGenerator.ts'), 'utf8');

describe('call report → serve receipt QR wiring', () => {
  it('mapDbCall carries serve_queue_id through', () => {
    expect(
      MAPPER,
      'mapDbCall does not spread the row, so serve_queue_id must be mapped '
      + 'explicitly or the call report QR gate never sees it.',
    ).toMatch(/serve_queue_id:\s*row\.serve_queue_id/);
  });

  it('the generator still gates the recipient badge on serve_queue_id', () => {
    expect(GENERATOR).toMatch(/isProcessServiceCall && data\.serve_queue_id/);
  });

  it('recipient QR badge is pinned to the last page', () => {
    // jsPDF draws on whatever page is current; a report that spilled would
    // strand the badge mid-document. The run sheet is handed over as a
    // stack and the scannable face has to be the bottom one.
    const pins = GENERATOR.match(/doc\.setPage\(doc\.getNumberOfPages\(\)\);/g) ?? [];
    expect(pins.length).toBeGreaterThanOrEqual(1);
  });

  it('mints the recipient token from the serve job, not the call', () => {
    // The officer's /api/cfs/:id/qr-token badge is multi-scan; the
    // recipient's is single-use and burned on signature. Sharing one
    // token would let an officer's status scan consume the recipient's.
    expect(GENERATOR).toMatch(/\/api\/serve-receipts\/\$\{data\.serve_queue_id\}\/token/);
  });
});
