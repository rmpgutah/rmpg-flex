import { describe, it, expect } from 'vitest';

// Minimal D1-like stub matching queryFirst contract.
function makeDb(row: Record<string, unknown> | null) {
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => row,
      }),
    }),
  };
}

// Import after the test environment is set (avoids top-level await issues).
async function loadGetServeConfig() {
  const mod = await import('../src/utils/serveConfig');
  return mod.getServeConfig;
}

describe('getServeConfig', () => {
  it('returns defaults when no row exists', async () => {
    const getServeConfig = await loadGetServeConfig();
    const cfg = await getServeConfig(makeDb(null) as any);
    expect(cfg.mileage_rate).toBe(0.67);
    expect(cfg.business_hours_start).toBe('08:00');
    expect(cfg.business_hours_end).toBe('20:00');
    expect(cfg.business_hours_days).toEqual([1, 2, 3, 4, 5]);
    expect(cfg.auto_geocode_on_intake).toBe(true);
    expect(cfg.geocode_confidence_min).toBe(0.6);
    expect(cfg.approaching_hours).toBe(48);
  });

  it('parses business_hours_days JSON string from DB', async () => {
    const getServeConfig = await loadGetServeConfig();
    const cfg = await getServeConfig(
      makeDb({ business_hours_days: '[1,2,3,4,5,6]' }) as any,
    );
    expect(cfg.business_hours_days).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('treats auto_geocode_on_intake=0 as false', async () => {
    const getServeConfig = await loadGetServeConfig();
    const cfg = await getServeConfig(
      makeDb({ auto_geocode_on_intake: 0 }) as any,
    );
    expect(cfg.auto_geocode_on_intake).toBe(false);
  });

  it('overrides defaults with stored values', async () => {
    const getServeConfig = await loadGetServeConfig();
    const cfg = await getServeConfig(
      makeDb({ mileage_rate: 0.70, geocode_confidence_min: 0.8 }) as any,
    );
    expect(cfg.mileage_rate).toBe(0.70);
    expect(cfg.geocode_confidence_min).toBe(0.8);
  });
});
