// Smoke tests for the PSO Notice of Communication PDF — the document behind
// the "Notice-of-Communication-CFS26-00055.pdf opens blank" incident. The
// blank file turned out to be jsPDF's dataurlnewwindow HTML wrapper (fixed in
// openPdfDocument.ts), but these tests pin the OTHER half of the guarantee:
// the generator itself emits a real, multi-KB PDF with the form content, and
// the autofill mapper actually populates it from a CFS row.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateNoticeOfCommunication, psoResultLabel } from '../psoNoticePdfGenerator';
import { buildNoticeOfCommunicationFromCall } from '../../pages/dispatch/utils/psoNoticeAutofill';
import type { CallForService } from '../../types';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/admin/config/branding')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('', { status: 404 });
    })
  );
});

const failedCall = {
  id: 55,
  call_number: 'CFS26-00055',
  incident_type: 'pso_client_request',
  status: 'closed',
  disposition: 'PS No Access',
  location: '4376 W 3100 S, West Valley City, UT',
  caller_name: 'Acme Property Management',
  caller_phone: '801-555-0142',
  created_at: '2026-06-08 14:05:00',
  cleared_at: '2026-06-08 14:40:00',
  action_taken: 'Gate locked; no answer on callbox.',
  notes: [],
} as unknown as CallForService;

describe('buildNoticeOfCommunicationFromCall', () => {
  it('populates the payload from the failed CFS row', () => {
    const data = buildNoticeOfCommunicationFromCall(failedCall, {
      officerName: 'C. Zamora',
      officerBadge: '5721',
      redispatchCallNumber: 'CFS26-00060',
      nextWindow: 'June 10, 0900–1200',
    });
    expect(data.callNumber).toBe('CFS26-00055');
    expect(data.clientName).toBe('Acme Property Management');
    expect(data.serviceAddress).toContain('4376 W 3100 S');
    expect(data.attempts).toHaveLength(1);
    expect(data.attempts[0].date).toBe('2026-06-08');
    expect(data.attempts[0].result).toBe('PS No Access');
    expect(data.redispatchCallNumber).toBe('CFS26-00060');
  });
});

describe('generateNoticeOfCommunication', () => {
  it('emits a real PDF document with content (not a blank shell)', async () => {
    const data = buildNoticeOfCommunicationFromCall(failedCall, {
      officerName: 'C. Zamora',
      officerBadge: '5721',
    });
    const doc = await generateNoticeOfCommunication(data);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);

    const bytes = doc.output('arraybuffer');
    // A populated one-page notice is tens of KB (fonts + content streams).
    // A blank/failed render collapses to a few KB — fail loudly if so.
    expect(bytes.byteLength).toBeGreaterThan(10_000);

    // Valid PDF magic header — guards the corrupted-bytes failure mode.
    const head = new TextDecoder().decode(new Uint8Array(bytes.slice(0, 5)));
    expect(head).toBe('%PDF-');
  });
});

describe('psoResultLabel', () => {
  it('maps the live disposition codes to client-readable text', () => {
    expect(psoResultLabel('PS No Access')).toBe('Unable to access premises');
    expect(psoResultLabel('PS Non-Service')).toBe('Unable to complete service');
    expect(psoResultLabel('')).toBe('Service not completed');
  });
});
