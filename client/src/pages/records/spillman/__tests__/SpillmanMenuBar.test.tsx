import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import SpillmanMenuBar from '../SpillmanMenuBar';

describe('SpillmanMenuBar', () => {
  it('renders the standard Spillman menus', () => {
    render(<SpillmanMenuBar />);
    ['File', 'Edit', 'View', 'Record', 'Tools', 'Window', 'Help'].forEach((m) => {
      expect(screen.getByText(m)).toBeInTheDocument();
    });
  });

  it('fires onNew when the File menu New action is clicked', () => {
    const onNew = vi.fn();
    render(<SpillmanMenuBar onNew={onNew} />);
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByRole('menuitem', { name: /New/ }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
