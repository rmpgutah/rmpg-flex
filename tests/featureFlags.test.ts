import { describe, it, expect } from 'vitest';
import featureFlags from '../src/routes/featureFlags';

function fakeEnv(rows: Array<{ config_key: string; config_value: string }>) {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: rows }),
        }),
      }),
    },
  };
}

describe('GET /api/feature-flags', () => {
  it('returns true for all 4 flags when no rows are saved (fail-open default)', async () => {
    const res = await featureFlags.request('/', {}, fakeEnv([]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      feature_warrants: true,
      feature_fleet: true,
      feature_evidence: true,
      feature_patrol_checkpoints: true,
    });
  });

  it('returns false only for the specific flag saved as 0', async () => {
    const res = await featureFlags.request('/', {}, fakeEnv([
      { config_key: 'feature_fleet', config_value: '0' },
    ]));
    const body = await res.json();
    expect(body).toEqual({
      feature_warrants: true,
      feature_fleet: false,
      feature_evidence: true,
      feature_patrol_checkpoints: true,
    });
  });

  it('treats any non-"0" saved value as enabled (matches the "1"/"0" string convention)', async () => {
    const res = await featureFlags.request('/', {}, fakeEnv([
      { config_key: 'feature_warrants', config_value: '1' },
    ]));
    const body = await res.json() as Record<string, boolean>;
    expect(body.feature_warrants).toBe(true);
  });
});
