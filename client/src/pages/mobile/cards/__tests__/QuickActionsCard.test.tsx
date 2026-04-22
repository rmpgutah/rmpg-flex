import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

describe('QuickActionsCard (smoke)', () => {
  it('module loads', async () => {
    const mod = await import('../QuickActionsCard');
    expect(mod.default).toBeDefined();
  });
});

describe('QuickActionsCard', () => {
  beforeEach(() => { mockNavigate.mockReset(); });

  it('navigates on each button click', async () => {
    const { default: QuickActionsCard } = await import('../QuickActionsCard');
    render(<QuickActionsCard />);
    fireEvent.click(screen.getByRole('button', { name: /FI/i }));
    fireEvent.click(screen.getByRole('button', { name: /Citation/i }));
    fireEvent.click(screen.getByRole('button', { name: /Incident/i }));
    expect(mockNavigate).toHaveBeenCalledTimes(3);
    const calls = mockNavigate.mock.calls.map(c => c[0]);
    expect(calls.some(p => p.includes('field-interviews') || p.includes('/fi'))).toBe(true);
    expect(calls.some(p => p.includes('citations'))).toBe(true);
    expect(calls.some(p => p.includes('incidents'))).toBe(true);
  });
});
