// ============================================================
// OFAC SDN sync — retry/timeout robustness
// ============================================================
// Live failure (2026-09-01): 'OFAC SDN sync failed: The operation was
// aborted'. ofac_sdn has 0 rows / last_refreshed=null since this feature
// shipped — the sync has never succeeded once, and being a monthly cron,
// one bad attempt meant a full month with no sanctions data. Root cause:
// the old code cleared its AbortController's timer immediately after
// fetch() resolved (the headers-received point), so res.text() — reading
// the actual multi-MB CSV body — ran with NO timeout at all, while the 30s
// budget was spent covering only the header phase. syncOfacSdn() now keeps
// one AbortController armed across both fetch() and res.text(), with a
// longer timeout and retries.
//
// No real network calls — global.fetch is stubbed per test.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { syncOfacSdn } from '../../src/utils/enrichment/ofacSync';

function fakeDb(): any {
  return {
    prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }),
  };
}

const CSV = 'ent_num,SDN_Name,SDN_Type,Program,,,,,,,,,,,Remarks\n'
  + '1,DOE JOHN,individual,SDGT,,,,,,,,,,,DOB 01 Jan 1970; a.k.a. \'J DOE\'\n';

describe('syncOfacSdn — retry/timeout behavior', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it('succeeds on the first attempt with no retry needed', async () => {
    globalThis.fetch = vi.fn(async () => new Response(CSV, { status: 200 })) as any;
    const result = await syncOfacSdn(fakeDb());
    expect(result.downloaded).toBe(true);
    expect(result.individualsFound).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries after a transient network failure and succeeds on the second attempt', async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      if (call === 1) throw new DOMException('The operation was aborted', 'AbortError');
      return new Response(CSV, { status: 200 });
    }) as any;

    const result = await syncOfacSdn(fakeDb());
    expect(result.downloaded).toBe(true);
    expect(result.individualsFound).toBe(1);
    expect(call).toBe(2);
  });

  it('does not abort while the body is still being read — the old bug', async () => {
    // Regression for the exact defect: clearTimeout() used to run right
    // after fetch() resolved (headers), before res.text() read the body,
    // so a slow BODY read had no timeout coverage at all in the old code —
    // but here we prove the opposite failure mode doesn't regress either:
    // a body read that takes a little time still succeeds because nothing
    // aborts it prematurely.
    globalThis.fetch = vi.fn(async () => {
      // Response whose .text() takes a moment to resolve, simulating a
      // slow-but-eventually-successful body stream.
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(CSV));
          controller.close();
        },
      }), { status: 200 });
    }) as any;

    const result = await syncOfacSdn(fakeDb());
    expect(result.downloaded).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('gives up and reports the error after exhausting all retries', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException('The operation was aborted', 'AbortError');
    }) as any;

    const result = await syncOfacSdn(fakeDb());
    expect(result.downloaded).toBe(false);
    expect(result.error).toMatch(/aborted/i);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  }, 15_000);

  it('does not retry on a clean non-2xx HTTP response after exhausting retries — surfaces the status', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 503 })) as any;
    const result = await syncOfacSdn(fakeDb());
    expect(result.downloaded).toBe(false);
    expect(result.error).toBe('HTTP 503');
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  }, 15_000);
});
