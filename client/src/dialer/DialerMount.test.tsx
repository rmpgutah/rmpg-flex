import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialerMount from './DialerMount';

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => { const e = Object.assign(new Error('x'), { status: 409, code: 'dialer_unlinked' }); throw e; }),
}));

beforeEach(() => localStorage.clear());

describe('DialerMount', () => {
  test('mounts the native softphone provider and renders its children', async () => {
    render(<MemoryRouter><DialerMount><span>page</span></DialerMount></MemoryRouter>);
    expect(screen.getByText('page')).toBeInTheDocument();
  });

  // P6 regression guard: the legacy iframe panel is deleted, so a stale
  // kill-switch flag in a dispatcher's browser must not change what mounts.
  test('ignores a stale rmpg_dialer_iframe flag', async () => {
    localStorage.setItem('rmpg_dialer_iframe', '1');
    render(<MemoryRouter><DialerMount><span>page</span></DialerMount></MemoryRouter>);
    expect(screen.getByText('page')).toBeInTheDocument();
    expect(screen.queryByTitle('Dial Connect')).not.toBeInTheDocument();
  });
});
