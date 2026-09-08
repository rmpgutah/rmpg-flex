// client/src/components/desktop/DesktopRecycleBin.test.tsx
//
// Regression pin for the 2026-09 desktop-suite hang. DesktopRecycleBin used
// to refresh its item list from a dependency-less effect:
//
//   useEffect(() => { setItems(getDeletedIcons()); });
//
// `getDeletedIcons()` returns a fresh array each call, so every render queued
// another state update and the component re-rendered forever. In a browser
// that pins a core; under React's `act()` it never yields, so
// DesktopPage.test.tsx ran until the worker hit the V8 heap limit (~8 GB,
// ~60 min) and vitest reported the file as neither passed nor failed. Any
// test here completing at all is the primary assertion; the localStorage
// read-count check makes the loop fail fast instead of by timeout.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DesktopRecycleBin from './DesktopRecycleBin';
import {
  addDeletedIcon,
  emptyRecycleBin,
  getDeletedIcons,
  subscribeRecycleBin,
  RECYCLE_BIN_CHANGE_EVENT,
} from '../../utils/recycleBinPreferences';

describe('DesktopRecycleBin', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders without a render loop (bounded localStorage reads after mount)', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    render(<DesktopRecycleBin onRestore={vi.fn()} />);
    expect(screen.getByRole('button', { name: /recycle bin, empty/i })).toBeInTheDocument();
    // A settled mount reads the snapshot a handful of times (initial render,
    // useSyncExternalStore's consistency re-check, StrictMode-style double
    // render). The old implementation reads it once per render, forever.
    expect(getItem.mock.calls.length).toBeLessThan(20);
  });

  it('reflects icons deleted elsewhere via the store change event, without polling', () => {
    render(<DesktopRecycleBin onRestore={vi.fn()} />);
    expect(screen.getByRole('button', { name: /recycle bin, empty/i })).toBeInTheDocument();

    act(() => { addDeletedIcon({ path: '/dispatch', label: 'Dispatch Console' }); });
    expect(screen.getByRole('button', { name: /recycle bin, 1 items/i })).toBeInTheDocument();

    act(() => { addDeletedIcon({ path: '/map', label: 'Live Map' }); });
    expect(screen.getByRole('button', { name: /recycle bin, 2 items/i })).toBeInTheDocument();
  });

  it('restores a single icon from the popover and calls onRestore', () => {
    addDeletedIcon({ path: '/dispatch', label: 'Dispatch Console' });
    const onRestore = vi.fn();
    render(<DesktopRecycleBin onRestore={onRestore} />);

    fireEvent.doubleClick(screen.getByRole('button', { name: /recycle bin, 1 items/i }));
    fireEvent.click(screen.getByText('Restore'));

    expect(onRestore).toHaveBeenCalledWith('/dispatch', 'Dispatch Console');
    expect(getDeletedIcons()).toEqual([]);
    expect(screen.getByRole('button', { name: /recycle bin, empty/i })).toBeInTheDocument();
  });

  it('Empty Recycle Bin clears storage and the badge', () => {
    addDeletedIcon({ path: '/dispatch', label: 'Dispatch Console' });
    render(<DesktopRecycleBin onRestore={vi.fn()} />);

    fireEvent.contextMenu(screen.getByRole('button', { name: /recycle bin, 1 items/i }));
    fireEvent.click(screen.getByText('Empty Recycle Bin'));

    expect(getDeletedIcons()).toEqual([]);
    expect(screen.getByRole('button', { name: /recycle bin, empty/i })).toBeInTheDocument();
  });

  it('store mutators notify subscribers and unsubscribe detaches the listener', () => {
    const cb = vi.fn();
    const unsubscribe = subscribeRecycleBin(cb);
    addDeletedIcon({ path: '/a', label: 'A' });
    emptyRecycleBin();
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    window.dispatchEvent(new Event(RECYCLE_BIN_CHANGE_EVENT));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
