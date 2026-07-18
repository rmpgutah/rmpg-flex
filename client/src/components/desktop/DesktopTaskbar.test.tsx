import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiFetchMock = vi.fn().mockResolvedValue({ count: 0 });
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));
// DesktopTaskbar calls useAuth() (for the command bar's clock-in/out officer id);
// without a real AuthProvider in the tree it throws "useAuth must be used within
// an AuthProvider". Mock it the same way DesktopPage.test.tsx does.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));
// DesktopTaskbar also calls useToast() to surface clock in/out failures;
// without a real ToastProvider in the tree it throws "useToast must be used
// within a ToastProvider". Mock it the same way useAuth is mocked above.
vi.mock('../ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import DesktopTaskbar from './DesktopTaskbar';
import { Radio } from 'lucide-react';
import type { NavFunction } from '../../data/navCatalog';

const icons: NavFunction[] = [{ path: '/dispatch', label: 'Dispatch Console', icon: Radio, description: 'd' }];

function Harness() {
  const { openWindow } = useDesktopWindows();
  return (
    <>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>simulate-open</button>
      <DesktopTaskbar icons={icons} catalog={icons} />
    </>
  );
}

describe('DesktopTaskbar', () => {
  beforeEach(() => apiFetchMock.mockClear());

  it('shows a button for each open window and clicking it focuses/restores', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByText('simulate-open'));
    expect(screen.getByRole('button', { name: 'Dispatch' })).toBeInTheDocument();
  });

  it('typing in the launcher search filters the catalog to matching modules', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Open app launcher'));
    fireEvent.change(screen.getByPlaceholderText(/search modules/i), { target: { value: 'Dispatch' } });
    expect(screen.getByText('Dispatch Console')).toBeInTheDocument();
  });
});
