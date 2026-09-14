import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialerMount from './DialerMount';

vi.mock('../components/DialerPanel', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../components/DialerPanel');
  return { ...actual, default: () => <div data-testid="legacy-iframe-panel" /> };
});
vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => { const e = Object.assign(new Error('x'), { status: 409, code: 'dialer_unlinked' }); throw e; }),
}));

beforeEach(() => localStorage.clear());

describe('DialerMount', () => {
  test('mounts the legacy iframe panel when rmpg_dialer_iframe=1', async () => {
    localStorage.setItem('rmpg_dialer_iframe', '1');
    render(<MemoryRouter><DialerMount><span>page</span></DialerMount></MemoryRouter>);
    expect(await screen.findByTestId('legacy-iframe-panel')).toBeInTheDocument();
    expect(screen.getByText('page')).toBeInTheDocument();
  });

  test('mounts the native softphone provider by default (no iframe)', async () => {
    render(<MemoryRouter><DialerMount><span>page</span></DialerMount></MemoryRouter>);
    expect(screen.queryByTestId('legacy-iframe-panel')).not.toBeInTheDocument();
    expect(screen.getByText('page')).toBeInTheDocument();
  });
});
