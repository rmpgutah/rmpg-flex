import { describe, it, expect, vi } from 'vitest';
import { FlexCamRemuxDO } from '../../src/durable-objects/FlexCamRemuxDO';

// Lightweight DO stubs — these test the state-machine logic directly
// without spinning up Miniflare. Pattern mirrors WelfareWatchDO tests.

const makeStorage = () => {
  const data = new Map<string, unknown>();
  let alarmAt: number | null = null;
  return {
    get: vi.fn(async (k: string) => data.get(k)),
    put: vi.fn(async (k: string, v: unknown) => { data.set(k, v); }),
    delete: vi.fn(async (k: string) => { data.delete(k); }),
    setAlarm: vi.fn(async (t: number) => { alarmAt = t; }),
    getAlarm: vi.fn(async () => alarmAt),
    deleteAlarm: vi.fn(async () => { alarmAt = null; }),
  };
};

const makeState = () => ({ storage: makeStorage(), id: { toString: () => 'rmx-42' } });

const makeEnv = (overrides: Partial<any> = {}) => ({
  DB: {
    prepare: vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ meta: { changes: 1 } })),
    })),
  },
  UPLOADS: { get: vi.fn(), put: vi.fn() },
  ...overrides,
});

describe('FlexCamRemuxDO', () => {
  it('enqueue sets state to queued and schedules an alarm', async () => {
    const state = makeState();
    const env = makeEnv();
    const dop = new FlexCamRemuxDO(state as any, env as any);
    await dop.enqueue(42);
    expect(state.storage.put).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({ state: 'queued', requestId: 42, attempts: 0 }),
    );
    expect(state.storage.setAlarm).toHaveBeenCalled();
  });

  it('re-enqueue while working is a no-op (returns current state)', async () => {
    const state = makeState();
    await state.storage.put('state', { state: 'working', requestId: 42, attempts: 1 });
    const env = makeEnv();
    const dop = new FlexCamRemuxDO(state as any, env as any);
    const result = await dop.enqueue(42);
    expect(result.state).toBe('working');
    expect(state.storage.setAlarm).not.toHaveBeenCalled();
  });

  it('alarm transitions queued → working → ready on success', async () => {
    const state = makeState();
    await state.storage.put('state', { state: 'queued', requestId: 42, attempts: 0 });

    vi.doMock('../../src/utils/footage/concat', () => ({
      remuxMp4ToFmp4: vi.fn(async () => ({ state: 'ready', sha256: 'abc', bytes: 1000, skipped: [] })),
    }));

    const env = makeEnv({
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn(async () => ({ results: [{ seq: 0, r2_key: 'k0' }, { seq: 1, r2_key: 'k1' }] })),
          run: vi.fn(async () => ({ meta: { changes: 1 } })),
        })),
      },
    });
    const dop = new FlexCamRemuxDO(state as any, env as any);
    await dop.alarm();

    const final = await state.storage.get('state');
    expect((final as any).state).toBe('ready');
    vi.doUnmock('../../src/utils/footage/concat');
  });

  it('alarm increments attempts and reschedules on failure (until cap)', async () => {
    const state = makeState();
    await state.storage.put('state', { state: 'queued', requestId: 42, attempts: 0 });
    vi.doMock('../../src/utils/footage/concat', () => ({
      remuxMp4ToFmp4: vi.fn(async () => ({ state: 'failed', errorCode: 'mp4box_parse_failed', errorMessage: 'boom', skipped: [] })),
    }));
    const env = makeEnv({
      DB: { prepare: vi.fn(() => ({ bind: vi.fn().mockReturnThis(), all: vi.fn(async () => ({ results: [{ seq: 0, r2_key: 'k0' }] })), run: vi.fn() })) },
    });
    const dop = new FlexCamRemuxDO(state as any, env as any);
    await dop.alarm();
    const final = await state.storage.get('state');
    expect((final as any).attempts).toBe(1);
    expect((final as any).state).toBe('queued'); // rescheduled, not terminal yet
    expect(state.storage.setAlarm).toHaveBeenCalled();
    vi.doUnmock('../../src/utils/footage/concat');
  });

  it('alarm marks failed after 3 attempts', async () => {
    const state = makeState();
    await state.storage.put('state', { state: 'queued', requestId: 42, attempts: 2 });
    vi.doMock('../../src/utils/footage/concat', () => ({
      remuxMp4ToFmp4: vi.fn(async () => ({ state: 'failed', errorCode: 'mp4box_parse_failed', errorMessage: 'boom', skipped: [] })),
    }));
    const env = makeEnv({
      DB: { prepare: vi.fn(() => ({ bind: vi.fn().mockReturnThis(), all: vi.fn(async () => ({ results: [{ seq: 0, r2_key: 'k0' }] })), run: vi.fn() })) },
    });
    const dop = new FlexCamRemuxDO(state as any, env as any);
    await dop.alarm();
    const final = await state.storage.get('state');
    expect((final as any).attempts).toBe(3);
    expect((final as any).state).toBe('failed');
    vi.doUnmock('../../src/utils/footage/concat');
  });
});
