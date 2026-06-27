import { render, screen, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import { FeatureFlagsProvider, useFeatureFlags } from '../FeatureFlagsContext';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../hooks/useApi';

function Inspector({ flag }: { flag: string }) {
  const flags = useFeatureFlags();
  return <div data-testid={flag}>{String((flags as any)[flag])}</div>;
}

beforeEach(() => vi.clearAllMocks());

test('exposes default flags (all true except dev_diagnostics) before API resolves', () => {
  (apiFetch as any).mockReturnValue(new Promise(() => {})); // never resolves
  render(<FeatureFlagsProvider><Inspector flag="draw" /></FeatureFlagsProvider>);
  expect(screen.getByTestId('draw').textContent).toBe('true');
});

test('dev_diagnostics defaults to false', () => {
  (apiFetch as any).mockReturnValue(new Promise(() => {}));
  render(<FeatureFlagsProvider><Inspector flag="dev_diagnostics" /></FeatureFlagsProvider>);
  expect(screen.getByTestId('dev_diagnostics').textContent).toBe('false');
});

test('merges API response over defaults', async () => {
  (apiFetch as any).mockResolvedValue({ draw: false });
  render(<FeatureFlagsProvider><Inspector flag="draw" /></FeatureFlagsProvider>);
  await waitFor(() => expect(screen.getByTestId('draw').textContent).toBe('false'));
});

test('keeps defaults when API throws', async () => {
  (apiFetch as any).mockRejectedValue(new Error('network'));
  render(<FeatureFlagsProvider><Inspector flag="ruler" /></FeatureFlagsProvider>);
  await waitFor(() => expect(screen.getByTestId('ruler').textContent).toBe('true'));
});
