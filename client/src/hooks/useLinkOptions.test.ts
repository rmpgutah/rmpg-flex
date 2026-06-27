import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('./useApi', () => ({
  apiFetch: vi.fn(),
}));
import { apiFetch } from './useApi';
import { useLinkOptions, __resetLinkOptionsCache } from './useLinkOptions';

describe('useLinkOptions', () => {
  beforeEach(() => { __resetLinkOptionsCache(); vi.clearAllMocks(); });

  it('falls back to defaults when the fetch rejects', async () => {
    (apiFetch as any).mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useLinkOptions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.options.person_role.some((o) => o.value === 'suspect')).toBe(true);
  });

  it('merges DB rows over defaults', async () => {
    (apiFetch as any).mockResolvedValue({
      person_role: [{ value: 'suspect', label: 'Primary Suspect', sort_order: 5, is_active: 1 }],
    });
    const { result } = renderHook(() => useLinkOptions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.options.person_role[0].label).toBe('Primary Suspect');
  });
});
