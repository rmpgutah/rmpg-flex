import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Database } from 'lucide-react';
import DesktopIconGrid from './DesktopIconGrid';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import type { NavFunction } from '../../data/navCatalog';

// DesktopIconGrid calls useToast() unconditionally (for the Company Browser
// electron-only-unavailable path) — mock it the same way DesktopIconGrid.test.tsx
// does, since this file renders DesktopIconGrid outside a real ToastProvider.
vi.mock('../ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

// DesktopIconGrid also calls useAuth() unconditionally (to thread the current
// user's role into activateNavFunction's currentUserRole, for Company
// Browser's role gating) — mock it the same way DesktopIconGrid.test.tsx and
// DesktopTaskbar.test.tsx do, since this file renders outside a real
// AuthProvider.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));

const RECORDS_ICON: NavFunction[] = [
  { path: '/records', label: 'Records', icon: Database, description: 'r' },
];

function Harness() {
  const { windows } = useDesktopWindows();
  return (
    <>
      <DesktopIconGrid
        icons={RECORDS_ICON} positions={{ '/records': { x: 20, y: 20 } }}
        onReposition={vi.fn()} onUnpin={vi.fn()} groups={[]} onCreateGroup={vi.fn()} onUngroup={vi.fn()}
        iconSize="medium" viewMode="grid"
      />
      <ul>{windows.map(w => <li key={w.id}>{w.path}</li>)}</ul>
    </>
  );
}

function makeDataTransfer(payload: unknown) {
  return { getData: () => JSON.stringify(payload) } as unknown as DataTransfer;
}

describe('DesktopIconGrid — drag person onto Records icon', () => {
  it('dropping a person payload on the Records icon opens a window at /records?personId=<id>', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    const recordsIcon = screen.getByText('Records').closest('button')!;
    fireEvent.dragOver(recordsIcon);
    fireEvent.drop(recordsIcon, { dataTransfer: makeDataTransfer({ type: 'person', id: '42', name: 'Jane Doe' }) });
    expect(screen.getByText('/records?personId=42')).toBeInTheDocument();
  });
});
