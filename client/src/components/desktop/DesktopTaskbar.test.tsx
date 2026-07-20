import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEffect } from 'react';

const apiFetchMock = vi.fn().mockResolvedValue({ count: 0 });
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));
const addToastMock = vi.fn();
vi.mock('../ToastProvider', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigateMock }));

import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import DesktopTaskbar from './DesktopTaskbar';
import { Radio, Package } from 'lucide-react';
import type { NavFunction } from '../../data/navCatalog';

const icons: NavFunction[] = [{ path: '/dispatch', label: 'Dispatch Console', icon: Radio, description: 'd' }];
const catalog: NavFunction[] = [
  { path: '/dispatch', label: 'Dispatch Console', icon: Radio, description: 'd', windowSize: { width: 1200, height: 900 } },
  { path: '/impound', label: 'Impound', icon: Package, description: 'imp', notWindowable: 'test fixture: explicitly excluded' },
];

function Harness() {
  const { openWindow, windows } = useDesktopWindows();
  return (
    <>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>simulate-open</button>
      <DesktopTaskbar icons={icons} catalog={catalog} />
      <ul>{windows.map(w => <li key={w.id}>{w.path}</li>)}</ul>
    </>
  );
}

function CapHarness() {
  const { openWindow } = useDesktopWindows();
  useEffect(() => {
    for (let i = 0; i < 10; i++) openWindow(`/p${i}`, `P${i}`);
  }, [openWindow]);
  return <DesktopTaskbar icons={icons} catalog={catalog} />;
}

describe('DesktopTaskbar', () => {
  beforeEach(() => {
    apiFetchMock.mockClear();
    navigateMock.mockClear();
    addToastMock.mockClear();
    sessionStorage.clear();
  });

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

  it('selecting a windowable search result opens a floating window instead of navigating', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Open app launcher'));
    fireEvent.change(screen.getByPlaceholderText(/search modules/i), { target: { value: 'Dispatch' } });
    fireEvent.click(screen.getByText('Dispatch Console'));
    expect(screen.getByText('/dispatch')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('selecting a non-windowable search result navigates instead of opening a window', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Open app launcher'));
    fireEvent.change(screen.getByPlaceholderText(/search modules/i), { target: { value: 'Impound' } });
    fireEvent.click(screen.getByText('Impound'));
    expect(navigateMock).toHaveBeenCalledWith('/impound');
  });

  it('shows a toast instead of opening a window when the window cap is already hit', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><CapHarness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Open app launcher'));
    fireEvent.change(screen.getByPlaceholderText(/search modules/i), { target: { value: 'Dispatch' } });
    fireEvent.click(screen.getByText('Dispatch Console'));
    expect(addToastMock).toHaveBeenCalledWith('Close a window to open another', 'error');
  });
});
