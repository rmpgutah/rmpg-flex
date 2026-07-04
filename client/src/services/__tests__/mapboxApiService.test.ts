import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../hooks/useApi';
import { coordsToParam } from '../mapboxApiService';

describe('coordsToParam', () => {
  it('joins [lng, lat] pairs with commas and semicolons', () => {
    expect(coordsToParam([[-111.891, 40.7608], [-111.9, 40.75]])).toBe(
      '-111.891,40.7608;-111.9,40.75'
    );
  });

  it('handles a single coordinate pair with no trailing semicolon', () => {
    expect(coordsToParam([[-111.891, 40.7608]])).toBe('-111.891,40.7608');
  });
});
