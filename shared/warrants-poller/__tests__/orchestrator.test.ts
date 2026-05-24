import { describe, it, expect, vi } from 'vitest';
import { runPoll } from '../orchestrator.ts';
import { BaseWarrantSource, type SourceMode } from '../sources/base.ts';
import { makeMemoryDataStore } from '../adapters/memory-datastore.ts';
import type { AlertSink, WarrantRecord } from '../types.ts';

// Fake list-poll source for orchestrator testing. Real list-poll adapters
// don't exist yet (UCJIS centralization — see README), so we need a
// fixture to exercise the pipeline.
class FakeListSource extends BaseWarrantSource {
  readonly id: string;
  readonly displayName = 'Fake list source';
  readonly mode: SourceMode = 'list-poll';
  private readonly records: WarrantRecord[];
  private readonly throwOnPoll: boolean;

  constructor(id: string, records: WarrantRecord[], throwOnPoll = false) {
    super({ minIntervalMs: 0 });
    this.id = id;
    this.records = records;
    this.throwOnPoll = throwOnPoll;
  }

  async pollAll(): Promise<WarrantRecord[]> {
    if (this.throwOnPoll) throw new Error('source unavailable');
    return this.records;
  }
}

function makeWarrant(over: Partial<WarrantRecord> = {}): WarrantRecord {
  return {
    source: 'fake',
    sourceWarrantId: 'W1',
    subjectName: 'SMITH, JOHN',
    charges: ['THEFT'],
    fetchedAt: new Date().toISOString(),
    ...over,
  };
}

describe('runPoll() pipeline', () => {
  it('inserts new warrants and counts them as inserted', async () => {
    const source = new FakeListSource('s1', [makeWarrant()]);
    const store = makeMemoryDataStore();

    const [result] = await runPoll({ sources: [source], store });

    expect(result.ok).toBe(true);
    expect(result.warrantsFound).toBe(1);
    expect(result.warrantsInserted).toBe(1);
    expect(result.warrantsUpdated).toBe(0);
    expect(store.snapshot().warrants).toHaveLength(1);
  });

  it('counts re-seen warrants as updated, not inserted', async () => {
    const source = new FakeListSource('s1', [makeWarrant()]);
    const store = makeMemoryDataStore();

    await runPoll({ sources: [source], store });
    const [second] = await runPoll({ sources: [source], store });

    expect(second.warrantsInserted).toBe(0);
    expect(second.warrantsUpdated).toBe(1);
    expect(store.snapshot().warrants).toHaveLength(1); // dedup, not duplicate
  });

  it('cross-links new warrants to known persons (MNI)', async () => {
    const source = new FakeListSource('s1', [
      makeWarrant({ subjectName: 'SMITH, JOHN', dob: '1985-03-14' }),
    ]);
    const store = makeMemoryDataStore({
      persons: [{ id: 42, fullName: 'SMITH, JOHN', dob: '1985-03-14' }],
    });

    const [result] = await runPoll({ sources: [source], store });

    expect(result.personMatches).toBe(1);
    expect(store.snapshot().links).toEqual([
      expect.objectContaining({ warrantId: 1, personId: 42 }),
    ]);
  });

  it('does NOT cross-link on updates (only on first-seen warrants)', async () => {
    const source = new FakeListSource('s1', [
      makeWarrant({ subjectName: 'SMITH, JOHN', dob: '1985-03-14' }),
    ]);
    const store = makeMemoryDataStore({
      persons: [{ id: 42, fullName: 'SMITH, JOHN', dob: '1985-03-14' }],
    });

    await runPoll({ sources: [source], store });
    const [second] = await runPoll({ sources: [source], store });

    expect(second.personMatches).toBe(0); // already linked on first poll
    expect(store.snapshot().links).toHaveLength(1);
  });

  it('fires alert sink on new warrants for known persons', async () => {
    const alert: AlertSink = { newWarrantForKnownPerson: vi.fn(async () => {}) };
    const source = new FakeListSource('s1', [
      makeWarrant({ subjectName: 'SMITH, JOHN', dob: '1985-03-14' }),
    ]);
    const store = makeMemoryDataStore({
      persons: [{ id: 42, fullName: 'SMITH, JOHN', dob: '1985-03-14' }],
    });

    await runPoll({ sources: [source], store, alerts: alert });
    expect(alert.newWarrantForKnownPerson).toHaveBeenCalledTimes(1);
  });

  it('does not abort poll if alert sink throws', async () => {
    const alert: AlertSink = {
      newWarrantForKnownPerson: vi.fn(async () => {
        throw new Error('alert sink offline');
      }),
    };
    const source = new FakeListSource('s1', [
      makeWarrant({ subjectName: 'SMITH, JOHN', dob: '1985-03-14' }),
    ]);
    const store = makeMemoryDataStore({
      persons: [{ id: 42, fullName: 'SMITH, JOHN', dob: '1985-03-14' }],
    });

    const [result] = await runPoll({ sources: [source], store, alerts: alert });
    expect(result.ok).toBe(true); // alert failure must not poison the poll
    expect(result.warrantsInserted).toBe(1);
  });

  it('isolates per-source failures via Promise.allSettled', async () => {
    const ok = new FakeListSource('ok', [makeWarrant({ sourceWarrantId: 'W-OK' })]);
    const bad = new FakeListSource('bad', [], /* throwOnPoll */ true);
    const store = makeMemoryDataStore();

    const results = await runPoll({ sources: [ok, bad], store });

    const okResult = results.find((r) => r.source === 'ok')!;
    const badResult = results.find((r) => r.source === 'bad')!;
    expect(okResult.ok).toBe(true);
    expect(okResult.warrantsInserted).toBe(1);
    expect(badResult.ok).toBe(false);
    expect(badResult.error).toMatch(/source unavailable/);
    // The healthy source's data still landed even though the other failed.
    expect(store.snapshot().warrants).toHaveLength(1);
  });

  it('records audit for every source, including failed ones', async () => {
    const ok = new FakeListSource('ok', [makeWarrant()]);
    const bad = new FakeListSource('bad', [], true);
    const store = makeMemoryDataStore();

    await runPoll({ sources: [ok, bad], store });

    const audit = store.snapshot().audit;
    expect(audit).toHaveLength(2);
    expect(audit.map((a) => a.source).sort()).toEqual(['bad', 'ok']);
    expect(audit.find((a) => a.source === 'bad')?.ok).toBe(false);
  });

  it('skips query-lookup sources (only list-poll runs through orchestrator)', async () => {
    class FakeLookupSource extends BaseWarrantSource {
      readonly id = 'lookup-only';
      readonly displayName = 'Lookup only';
      readonly mode: SourceMode = 'query-lookup';
    }
    const list = new FakeListSource('list', [makeWarrant()]);
    const lookup = new FakeLookupSource();
    const store = makeMemoryDataStore();

    const results = await runPoll({ sources: [list, lookup], store });
    expect(results).toHaveLength(1); // lookup-only source skipped
    expect(results[0].source).toBe('list');
  });
});
