import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({})),
}));
vi.mock('../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: () => () => {} }),
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'officer', id: 1, username: 'test' } }),
}));

describe('MobileHomePage (smoke)', () => {
  it('module loads without throwing', async () => {
    const mod = await import('../MobileHomePage');
    expect(mod.default).toBeDefined();
  });
});
