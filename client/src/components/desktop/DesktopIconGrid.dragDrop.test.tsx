import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Database } from 'lucide-react';
import DesktopIconGrid from './DesktopIconGrid';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import type { NavFunction } from '../../data/navCatalog';

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
