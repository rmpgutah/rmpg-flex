import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SpillmanMenuBar, { type MenuSpec } from '../SpillmanMenuBar';

afterEach(cleanup);

describe('SpillmanMenuBar (generic)', () => {
  it('renders only menus that have at least one actionable item', () => {
    const menus: MenuSpec[] = [
      { name: 'File', items: [{ label: 'New', onClick: vi.fn() }] },
      { name: 'Empty', items: [{ label: 'Nothing' }] },
    ];
    render(<SpillmanMenuBar menus={menus} />);
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('Empty')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Empty'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a dropdown and fires the item handler, then closes', () => {
    const onNew = vi.fn();
    const menus: MenuSpec[] = [{ name: 'File', items: [{ label: 'New', onClick: onNew }] }];
    render(<SpillmanMenuBar menus={menus} />);
    fireEvent.click(screen.getByText('File'));
    const item = screen.getByRole('menuitem', { name: 'New' });
    fireEvent.click(item);
    expect(onNew).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
